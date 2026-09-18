const { kv } = require('@vercel/kv');

// Batch-confirm endpoint for the door-hanger campaign.
// A rep walks a route (api/routes.js records GPS breadcrumbs the whole time),
// then at the end taps the stops they actually placed a hanger at on a map
// and submits them all at once here. Each confirmed stop is checked for a
// plausible "dwell" near the rep's own recorded path (not just proximity —
// see note below), deduped against existing ql:* leads (including leads
// from other sources that never stored coordinates), and either turned into
// a new lead, logged as non-actionable, or checked against a persistent
// do-not-solicit list — reusing the same `ql:*` KV pipeline the rest of the
// CRM (Facebook Ads / website leads) already writes to.
//
// Verification note: a stop's coordinates come from the rep's own recorded
// route, so simple proximity-to-path is close to a tautology — it can't
// catch someone confirming a stop on a route they fabricated. The real
// signal is DWELL: does the recorded path show the rep actually slowing
// down / lingering near this point (multiple GPS fixes spread over a few
// seconds), rather than a single fix from a fast pass-through or a
// fabricated straight-line burst of points. This can't stop a determined
// attacker with direct API access, but it does catch the realistic failure
// mode (driving a street instead of walking it, or synthetic data).

const MAX_STOP_DISTANCE_METERS = 30;      // a stop must have at least one recorded point this close
const MIN_DWELL_POINTS = 2;               // ...and at least this many recorded points nearby...
const MIN_DWELL_MS = 1500;                // ...spanning at least this much time (not one fast pass-through)
const DWELL_RADIUS_METERS = 15;
const DEDUPE_RADIUS_METERS = 40;
const MAX_STOPS_PER_SUBMIT = 300;
const DH_STATUSES = ['Hung', 'No Answer', 'Already Has One', 'No Safe Access', 'Do Not Solicit'];

function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// Checks a confirmed stop against the route's recorded points: is there a
// cluster of points nearby spread over enough time to look like a real
// stop, rather than a single drive-by fix or a point plucked from nowhere?
function dwellCheck(stop, points) {
    const nearby = points.filter(p => haversineMeters(stop, p) <= DWELL_RADIUS_METERS);
    if (!nearby.length) return { ok: false, reason: 'not on recorded path' };
    const minTs = Math.min(...nearby.map(p => p.ts));
    const maxTs = Math.max(...nearby.map(p => p.ts));
    if (nearby.length < MIN_DWELL_POINTS || (maxTs - minTs) < MIN_DWELL_MS) {
        return { ok: false, reason: `only a fast pass-through recorded (${nearby.length} fix(es), ${Math.round((maxTs - minTs) / 1000)}s)` };
    }
    return { ok: true };
}

// Extracts civic number + street name/suffix/direction, dropping city,
// province, postal code, and country noise so a verbose Google
// reverse-geocode result and a plainly-typed website-form address have a
// real chance of matching.
const STREET_SUFFIXES = {
    street: 'st', st: 'st', avenue: 'ave', ave: 'ave', road: 'rd', rd: 'rd',
    drive: 'dr', dr: 'dr', boulevard: 'blvd', blvd: 'blvd', court: 'ct', crt: 'ct', ct: 'ct',
    place: 'pl', pl: 'pl', crescent: 'cres', cres: 'cres', lane: 'ln', ln: 'ln',
    way: 'way', terrace: 'terr', terr: 'terr', circle: 'cir', cir: 'cir',
};
const DIRECTIONS = { west: 'w', w: 'w', east: 'e', e: 'e', north: 'n', n: 'n', south: 's', s: 's' };
const DROP_TOKENS = new Set(['canada', 'ontario', 'on', 'london']);

function normalizeAddress(address) {
    if (!address) return '';
    const tokens = address.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter(t => !DROP_TOKENS.has(t))
        .filter(t => !/^n\d[a-z]\d?[a-z]?\d?$/.test(t)); // drop Canadian postal-code fragments
    return tokens
        .map(t => STREET_SUFFIXES[t] || DIRECTIONS[t] || t)
        .join(' ')
        .trim();
}

async function reverseGeocode(lat, lng) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return '';
    try {
        const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`);
        const d = await r.json();
        return (d.results && d.results[0] && d.results[0].formatted_address) || '';
    } catch (e) {
        console.error('Reverse geocode failed:', e);
        return '';
    }
}

async function forwardGeocode(address) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key || !address) return null;
    try {
        const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
        const d = await r.json();
        const loc = d.results && d.results[0] && d.results[0].geometry && d.results[0].geometry.location;
        return loc ? { lat: loc.lat, lng: loc.lng } : null;
    } catch (e) {
        console.error('Forward geocode failed:', e);
        return null;
    }
}

// Finds an existing quick-lead at (roughly) this address, across ALL lead
// sources — not just other door-hanger entries. Website/Facebook/manual
// leads never store coordinates, so for those this lazily forward-geocodes
// their address once and caches the result back onto the lead record, so
// repeat lookups don't re-pay the geocoding cost.
async function findExistingLead(address, lat, lng) {
    const ids = (await kv.get('ql_ids')) || [];
    if (!ids.length) return null;
    const normTarget = normalizeAddress(address);
    const leads = await kv.mget(...ids.map(id => `ql:${id}`));

    let forwardGeocodeBudget = 25; // cap external calls per confirm to bound cost/latency
    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        if (!lead) continue;
        if (normTarget && lead.address && normalizeAddress(lead.address) === normTarget) return lead;

        let leadLat = lead.geoLat, leadLng = lead.geoLng;
        if ((leadLat == null || leadLng == null) && lead.address && lat != null && lng != null && forwardGeocodeBudget > 0) {
            forwardGeocodeBudget--;
            const geo = await forwardGeocode(lead.address);
            if (geo) {
                leadLat = geo.lat; leadLng = geo.lng;
                lead.geoLat = geo.lat; lead.geoLng = geo.lng;
                await kv.set(`ql:${lead.id}`, lead); // cache so future lookups skip the API call
            }
        }
        if (leadLat != null && leadLng != null && lat != null && lng != null) {
            if (haversineMeters({ lat, lng }, { lat: leadLat, lng: leadLng }) <= DEDUPE_RADIUS_METERS) return lead;
        }
    }
    return null;
}

// Checks the persistent do-not-solicit list by normalized address AND
// geo-proximity (mirroring findExistingLead), so it survives reverse-geocode
// drift between visits rather than relying on an exact key match.
async function findDnsMatch(address, lat, lng) {
    const ids = await kv.lrange('dns_ids', 0, -1);
    if (!ids.length) return null;
    const normTarget = normalizeAddress(address);
    const entries = await kv.mget(...ids.map(id => `dns:${id}`));
    for (const entry of entries) {
        if (!entry) continue;
        if (normTarget && entry.address && normalizeAddress(entry.address) === normTarget) return entry;
        if (entry.lat != null && entry.lng != null && lat != null && lng != null) {
            if (haversineMeters({ lat, lng }, { lat: entry.lat, lng: entry.lng }) <= DEDUPE_RADIUS_METERS) return entry;
        }
    }
    return null;
}

async function logCoverageEntry(entry) {
    const id = `dh_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    await kv.set(`dh:${id}`, { id, createdAt: new Date().toISOString(), ...entry });
    await kv.lpush('dh_ids', id);
    return id;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const tokenData = await kv.get(`token:${token}`);
    if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });
    if (tokenData.role !== 'sales' && tokenData.role !== 'admin') {
        return res.status(403).json({ error: 'Sales access required' });
    }

    try {
        if (req.method === 'POST') {
            const { routeId, confirmedStops } = req.body;
            if (!routeId) return res.status(400).json({ error: 'routeId required' });
            if (!Array.isArray(confirmedStops) || !confirmedStops.length) {
                return res.status(400).json({ error: 'confirmedStops array required' });
            }
            if (confirmedStops.length > MAX_STOPS_PER_SUBMIT) {
                return res.status(400).json({ error: `Too many stops in one submission (max ${MAX_STOPS_PER_SUBMIT})` });
            }

            const route = await kv.get(`route:${routeId}`);
            if (!route) return res.status(404).json({ error: 'Route not found' });
            if (tokenData.role !== 'admin' && route.repName !== tokenData.repName) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const repName = route.repName;
            const results = [];

            for (const stop of confirmedStops) {
                const { lat, lng } = stop;
                if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
                    results.push({ ...stop, outcome: 'rejected', reason: 'Invalid coordinates' });
                    continue;
                }
                if (!DH_STATUSES.includes(stop.status)) {
                    results.push({ ...stop, outcome: 'rejected', reason: 'Invalid or missing status' });
                    continue;
                }
                const status = stop.status;

                // Distance + dwell check against the rep's own recorded path.
                const nearest = route.points.reduce((min, p) => Math.min(min, haversineMeters({ lat, lng }, p)), Infinity);
                if (!Number.isFinite(nearest) || nearest > MAX_STOP_DISTANCE_METERS) {
                    await logCoverageEntry({
                        repName, routeId, lat, lng, status, flagged: true,
                        flagReason: `${Math.round(nearest)}m from recorded path`,
                    });
                    results.push({ ...stop, outcome: 'flagged_off_route', distanceMeters: Math.round(nearest) });
                    continue;
                }
                const dwell = dwellCheck({ lat, lng }, route.points);
                if (!dwell.ok) {
                    await logCoverageEntry({
                        repName, routeId, lat, lng, status, flagged: true,
                        flagReason: dwell.reason,
                    });
                    results.push({ ...stop, outcome: 'flagged_insufficient_dwell', reason: dwell.reason });
                    continue;
                }

                const address = await reverseGeocode(lat, lng);
                const routeNote = route.flagged ? ' ⚠ Route flagged for unusual speed — verify manually.' : '';

                if (status === 'Do Not Solicit') {
                    const existingDns = await findDnsMatch(address, lat, lng);
                    if (!existingDns) {
                        const dnsId = `dns_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                        await kv.set(`dns:${dnsId}`, { id: dnsId, address, lat, lng, flaggedBy: repName, flaggedAt: new Date().toISOString() });
                        await kv.lpush('dns_ids', dnsId);
                    }
                    await logCoverageEntry({ repName, routeId, lat, lng, address, status });
                    results.push({ ...stop, outcome: 'do_not_solicit_recorded', address });
                    continue;
                }

                if (status !== 'Hung') {
                    // No Answer / Already Has One / No Safe Access — not sales-actionable, just a coverage log.
                    await logCoverageEntry({ repName, routeId, lat, lng, address, status });
                    results.push({ ...stop, outcome: 'logged', address });
                    continue;
                }

                const dnsMatch = await findDnsMatch(address, lat, lng);
                if (dnsMatch) {
                    await logCoverageEntry({ repName, routeId, lat, lng, address, status, blocked: true });
                    results.push({ ...stop, outcome: 'blocked_do_not_solicit', address });
                    continue;
                }

                // status === 'Hung' — create or update a real lead in the existing pipeline.
                const existing = await findExistingLead(address, lat, lng);
                if (existing) {
                    const note = `Door hanger placed ${new Date().toLocaleDateString('en-CA')} by ${repName}.${routeNote}`;
                    existing.notes = existing.notes ? `${existing.notes}\n${note}` : note;
                    if (existing.geoLat == null) { existing.geoLat = lat; existing.geoLng = lng; }
                    existing.updatedAt = new Date().toISOString();
                    await kv.set(`ql:${existing.id}`, existing);
                    results.push({ ...stop, outcome: 'note_appended', address, leadId: existing.id });
                    continue;
                }

                const lead = {
                    id: `ql_dh_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    name: address || 'Door Hanger Lead (no address resolved)',
                    address,
                    phone: '',
                    email: '',
                    salesRep: repName,
                    estimateNumber: '',
                    source: 'Door Hanger',
                    campaign: 'London ON Snow Removal — Door Hangers',
                    adName: '',
                    callStatus: 'New',
                    services: [],
                    serviceType: 'Snow Removal',
                    subtotal: '', hst: '', total: '', discount: 0, bundleDiscount: 0, estimatedValue: '',
                    visitDate: '', saleDate: '', saleTime: '',
                    paymentStatus: 'Unpaid', paymentMethod: '', paymentAmount: 0,
                    notes: `No phone/email on file — this lead came from a door hanger, not a call-in. Follow up in person or by mail at the address above.${routeNote}`,
                    jobDetails: null, survey: {}, legal: {}, hasSignature: false,
                    status: 'New',
                    geoLat: lat, geoLng: lng, routeId,
                    createdAt: new Date().toISOString(),
                };
                await kv.set(`ql:${lead.id}`, lead);
                // ql_ids is a plain JSON array (api/quick-leads.js owns this key's shape) —
                // must match that pattern exactly, not the native-list pattern used for
                // this file's own new keys (dh_ids/dns_ids), or the two writers would
                // corrupt each other's storage format for this shared key.
                const qlIds = (await kv.get('ql_ids')) || [];
                qlIds.unshift(lead.id);
                await kv.set('ql_ids', qlIds);
                results.push({ ...stop, outcome: 'lead_created', address, leadId: lead.id });
            }

            return res.status(200).json({ success: true, results, routeFlagged: !!route.flagged });
        }

        // GET — list door-hanger coverage log entries (admin: all, sales: own), or ?type=dns for the do-not-solicit list.
        if (req.method === 'GET') {
            if (req.query.type === 'dns') {
                if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
                const ids = await kv.lrange('dns_ids', 0, -1);
                const entries = ids.length ? (await kv.mget(...ids.map(id => `dns:${id}`))).filter(Boolean) : [];
                return res.status(200).json({ success: true, entries });
            }

            const ids = await kv.lrange('dh_ids', 0, -1);
            if (!ids.length) return res.status(200).json({ success: true, entries: [] });
            const records = await kv.mget(...ids.map(id => `dh:${id}`));
            const entries = records.filter(entry => entry && (tokenData.role === 'admin' || entry.repName === tokenData.repName));
            return res.status(200).json({ success: true, entries });
        }

        // DELETE — remove a false-positive do-not-solicit entry (admin only)
        if (req.method === 'DELETE') {
            if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'ID required' });
            await kv.del(`dns:${id}`);
            await kv.lrem('dns_ids', 0, id);
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('Door hangers error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
