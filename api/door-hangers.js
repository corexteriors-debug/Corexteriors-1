const { kv } = require('@vercel/kv');

// Batch-confirm endpoint for the door-hanger campaign.
// A rep walks a route (api/routes.js records GPS breadcrumbs the whole time),
// then at the end taps the stops they actually placed a hanger at on a map
// and submits them all at once here. Each confirmed stop is checked against
// the rep's own recorded path (so a claimed stop has to have actually been
// walked), then either creates a new lead in the existing quick-leads
// pipeline, logs a non-actionable outcome, or flags a persistent
// do-not-solicit address — reusing the same `ql:*` KV pipeline the rest of
// the CRM (Facebook Ads / website leads) already writes to.

const MAX_STOP_DISTANCE_METERS = 30; // tolerance for "is this stop actually on the walked path"
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

function nearestPointDistance(stop, points) {
    let best = Infinity;
    for (const p of points) {
        const d = haversineMeters(stop, p);
        if (d < best) best = d;
    }
    return best;
}

function normalizeAddress(address) {
    return (address || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

// Find an existing quick-lead at (roughly) this address — exact normalized
// address match, or within ~40m if both records have coordinates.
async function findExistingLead(address, lat, lng) {
    const ids = (await kv.get('ql_ids')) || [];
    const normTarget = normalizeAddress(address);
    for (const id of ids) {
        const lead = await kv.get(`ql:${id}`);
        if (!lead) continue;
        if (normTarget && normalizeAddress(lead.address) === normTarget) return lead;
        if (lead.geoLat != null && lead.geoLng != null && lat != null && lng != null) {
            if (haversineMeters({ lat, lng }, { lat: lead.geoLat, lng: lead.geoLng }) <= 40) return lead;
        }
    }
    return null;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

            const route = await kv.get(`route:${routeId}`);
            if (!route) return res.status(404).json({ error: 'Route not found' });
            if (tokenData.role !== 'admin' && route.repName !== tokenData.repName) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const repName = route.repName;
            const results = [];

            for (const stop of confirmedStops) {
                const { lat, lng } = stop;
                const status = DH_STATUSES.includes(stop.status) ? stop.status : 'Hung';
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                    results.push({ ...stop, outcome: 'rejected', reason: 'Invalid coordinates' });
                    continue;
                }

                // Verification: this stop must actually be on the rep's recorded path.
                const distance = nearestPointDistance({ lat, lng }, route.points);
                if (!Number.isFinite(distance) || distance > MAX_STOP_DISTANCE_METERS) {
                    const dhId = `dh_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                    await kv.set(`dh:${dhId}`, {
                        id: dhId, repName, routeId, lat, lng, status,
                        flagged: true, flagReason: `${Math.round(distance)}m from recorded path`,
                        createdAt: new Date().toISOString(),
                    });
                    const dhIds = (await kv.get('dh_ids')) || [];
                    dhIds.unshift(dhId);
                    await kv.set('dh_ids', dhIds);
                    results.push({ ...stop, outcome: 'flagged_off_route', distanceMeters: Math.round(distance) });
                    continue;
                }

                const address = stop.address || await reverseGeocode(lat, lng);
                const addressKey = normalizeAddress(address) || `${lat.toFixed(5)},${lng.toFixed(5)}`;

                if (status === 'Do Not Solicit') {
                    await kv.set(`dns:${addressKey}`, { address, flaggedBy: repName, flaggedAt: new Date().toISOString() });
                    const dhId = `dh_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                    await kv.set(`dh:${dhId}`, { id: dhId, repName, routeId, lat, lng, address, status, createdAt: new Date().toISOString() });
                    const dhIds = (await kv.get('dh_ids')) || [];
                    dhIds.unshift(dhId);
                    await kv.set('dh_ids', dhIds);
                    results.push({ ...stop, outcome: 'do_not_solicit_recorded', address });
                    continue;
                }

                const dnsFlag = await kv.get(`dns:${addressKey}`);

                if (status !== 'Hung') {
                    // No Answer / Already Has One / No Safe Access — not sales-actionable, just a coverage log.
                    const dhId = `dh_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                    await kv.set(`dh:${dhId}`, { id: dhId, repName, routeId, lat, lng, address, status, createdAt: new Date().toISOString() });
                    const dhIds = (await kv.get('dh_ids')) || [];
                    dhIds.unshift(dhId);
                    await kv.set('dh_ids', dhIds);
                    results.push({ ...stop, outcome: 'logged', address });
                    continue;
                }

                if (dnsFlag) {
                    results.push({ ...stop, outcome: 'blocked_do_not_solicit', address });
                    continue;
                }

                // status === 'Hung' — create or update a real lead in the existing pipeline.
                const existing = await findExistingLead(address, lat, lng);
                if (existing) {
                    const note = `Door hanger placed ${new Date().toLocaleDateString('en-CA')} by ${repName}.`;
                    existing.notes = existing.notes ? `${existing.notes}\n${note}` : note;
                    existing.updatedAt = new Date().toISOString();
                    await kv.set(`ql:${existing.id}`, existing);
                    results.push({ ...stop, outcome: 'note_appended', address, leadId: existing.id });
                    continue;
                }

                const lead = {
                    id: `ql_dh_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    name: address || 'Door Hanger Lead',
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
                    notes: '', jobDetails: null, survey: {}, legal: {}, hasSignature: false,
                    status: 'New',
                    geoLat: lat, geoLng: lng, routeId,
                    createdAt: new Date().toISOString(),
                };
                await kv.set(`ql:${lead.id}`, lead);
                const ids = (await kv.get('ql_ids')) || [];
                ids.unshift(lead.id);
                await kv.set('ql_ids', ids);
                results.push({ ...stop, outcome: 'lead_created', address, leadId: lead.id });
            }

            return res.status(200).json({ success: true, results });
        }

        // GET — list door-hanger coverage log entries (admin: all, sales: own), for the coverage map.
        if (req.method === 'GET') {
            const ids = (await kv.get('dh_ids')) || [];
            const entries = [];
            for (const id of ids) {
                const entry = await kv.get(`dh:${id}`);
                if (!entry) continue;
                if (tokenData.role === 'admin' || entry.repName === tokenData.repName) entries.push(entry);
            }
            return res.status(200).json({ success: true, entries });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('Door hangers error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
