const { kv } = require('@vercel/kv');
const { runFbLeadsSync } = require('./_syncFbLeads');
const { hashPassword } = require('./_authCrypto');

// This file is the Vercel Hobby plan's 12-serverless-function cap talking:
// the door-hanger campaign needed 4 more endpoints (GPS routes, batch
// confirm, manager assignments, rep accounts) than the plan allows as
// separate files, so they're folded in here as `?resource=` branches
// instead of new files. `?resource` unset/'leads' is the original
// quick-leads behavior (Sales Leads tab), untouched. Each branch below is
// materially the same code that would otherwise live in its own
// api/routes.js, api/door-hangers.js, api/assignments.js, api/dh-reps.js —
// kept as self-contained sections so it's still easy to split back out
// once/if the team moves off the Hobby plan's function limit.

const CALL_STATUSES = ['New', 'Called', 'No Answer', 'Interested', 'Not Interested', 'Booked'];

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const tokenData = await kv.get(`token:${token}`);
    if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });

    try {
        switch (req.query.resource) {
            case 'routes': return await handleRoutes(req, res, tokenData);
            case 'confirm': return await handleConfirm(req, res, tokenData);
            case 'assignments': return await handleAssignments(req, res, tokenData);
            case 'reps': return await handleReps(req, res, tokenData);
            default: return await handleLeads(req, res, tokenData);
        }
    } catch (err) {
        console.error('quick-leads error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

// ============================================================
// LEADS (default resource) — the original Sales Leads tab pipeline.
// ============================================================
async function handleLeads(req, res, tokenData) {
    // POST — create lead (from sales portal estimate or manual entry)
    if (req.method === 'POST') {
        const b = req.body;
        const name = b.name || b.clientName || '';
        const address = b.address || b.clientAddress || '';
        const phone = b.phone || '';
        const email = b.email || '';
        if (!name) return res.status(400).json({ error: 'Name is required' });
        if (!address && !phone && !email) return res.status(400).json({ error: 'At least one of address, phone, or email is required' });

        const lead = {
            id: `ql_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            // identity
            name,
            address,
            phone,
            email,
            salesRep:       b.salesRep || tokenData.repName || '',
            estimateNumber: b.estimateNumber || '',
            // lead origin & call tracking
            source:         b.source || 'Manual',
            campaign:       b.campaign || '',
            adName:         b.adName || '',
            callStatus:     CALL_STATUSES.includes(b.callStatus) ? b.callStatus : 'New',
            // services & pricing
            services:       b.services || [],
            serviceType:    b.serviceType || '',
            subtotal:       b.subtotal || '',
            hst:            b.hst || '',
            total:          b.total || '',
            discount:       b.discount || 0,
            bundleDiscount: b.bundleDiscount || 0,
            estimatedValue: b.estimatedValue || '',
            // scheduling
            visitDate:      b.survey?.visitDate || b.saleDate || b.visitDate || '',
            saleDate:       b.saleDate || '',
            saleTime:       b.saleTime || '',
            // payment
            paymentStatus:  b.paymentStatus || 'Unpaid',
            paymentMethod:  b.paymentMethod || '',
            paymentAmount:  parseFloat(b.paymentAmount) || 0,
            // extras
            notes:          b.notes || b.survey?.notes || '',
            jobDetails:     b.jobDetails || null,
            survey:         b.survey || {},
            legal:          b.legal || {},
            hasSignature:   b.hasSignature || false,
            status:         b.status || 'New',
            createdAt:      new Date().toISOString(),
        };

        await kv.set(`ql:${lead.id}`, lead);
        const ids = (await kv.get('ql_ids')) || [];
        ids.unshift(lead.id);
        await kv.set('ql_ids', ids);

        return res.status(201).json({ success: true, lead });
    }

    // GET — retrieve leads (admin sees all, sales sees own).
    // Batch-fetched via mget (one round trip) instead of one kv.get per
    // lead in a loop — with the door-hanger campaign now feeding this same
    // pipeline, this list only grows, and N sequential round trips was
    // going to get slow well before the campaign ended.
    if (req.method === 'GET') {
        const ids = (await kv.get('ql_ids')) || [];
        if (!ids.length) return res.status(200).json({ success: true, leads: [] });
        const records = await kv.mget(...ids.map(id => `ql:${id}`));
        const leads = records.filter(lead => lead && (tokenData.role === 'admin' || lead.salesRep === tokenData.repName));
        return res.status(200).json({ success: true, leads });
    }

    // PATCH — edit a lead, or (action: 'sync-fb-leads') trigger a manual FB Ads import
    if (req.method === 'PATCH') {
        if (req.body.action === 'sync-fb-leads') {
            if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
            const results = await runFbLeadsSync();
            return res.status(200).json({ success: true, ...results });
        }

        const { id, name, address, notes, phone, email, callStatus, salesRep } = req.body;
        if (!id) return res.status(400).json({ error: 'ID required' });

        const lead = await kv.get(`ql:${id}`);
        if (!lead) return res.status(404).json({ error: 'Not found' });
        if (tokenData.role !== 'admin' && lead.salesRep !== tokenData.repName) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (name  !== undefined) lead.name  = name;
        if (address !== undefined) lead.address = address;
        if (notes !== undefined) lead.notes  = notes;
        if (phone !== undefined) lead.phone  = phone;
        if (email !== undefined) lead.email  = email;
        if (salesRep !== undefined) lead.salesRep = salesRep;
        if (callStatus !== undefined) {
            if (!CALL_STATUSES.includes(callStatus)) {
                return res.status(400).json({ error: `Invalid call status. Must be one of: ${CALL_STATUSES.join(', ')}` });
            }
            lead.callStatus = callStatus;
        }
        lead.updatedAt = new Date().toISOString();

        await kv.set(`ql:${id}`, lead);
        return res.status(200).json({ success: true, lead });
    }

    // DELETE — remove a lead
    if (req.method === 'DELETE') {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID required' });

        const lead = await kv.get(`ql:${id}`);
        if (!lead) return res.status(404).json({ error: 'Not found' });
        if (tokenData.role !== 'admin' && lead.salesRep !== tokenData.repName) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await kv.del(`ql:${id}`);
        const ids = ((await kv.get('ql_ids')) || []).filter(i => i !== id);
        await kv.set('ql_ids', ids);

        return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ============================================================
// Shared geo helpers (routes + confirm resources)
// ============================================================
function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// ============================================================
// ROUTES (?resource=routes) — GPS breadcrumb capture for door-hanger reps
// walking a route. A rep starts a route, the client flushes small batches
// of {lat,lng,ts} points as they walk, then ends the route. The `confirm`
// resource below checks confirmed stops for plausible "dwell" near these
// points.
//
// Note on trust: a stop being close to a recorded point is not, by itself,
// meaningful proof — the client picks stop coordinates FROM these same
// points. The actual trust signal here is whether the *route itself* looks
// like a genuine walk (continuous, walking-speed movement) rather than a
// fabricated burst of points. That's what MAX_WALK_SPEED_MPS below is for:
// it can't stop a determined attacker with API access, but it does catch
// the realistic case (a route driven or teleported rather than walked).
// ============================================================
const MAX_WALK_SPEED_MPS = 4.5; // ~16 km/h, generous for a fast walk/jog with GPS jitter
const SUSPICIOUS_SEGMENT_RATIO = 0.25; // flag the route if >25% of segments exceed walking speed

function isValidCoord(p) {
    return Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
        Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

// Appends new points and returns how many looked like implausible
// (faster-than-walking) jumps from the previous point, so the caller can
// track a running suspicion ratio on the route.
function countSuspiciousSegments(prevPoint, newPoints) {
    let suspicious = 0;
    let prev = prevPoint;
    for (const p of newPoints) {
        if (prev) {
            const dtSec = Math.max(0.5, (p.ts - prev.ts) / 1000);
            const speed = haversineMeters(prev, p) / dtSec;
            if (speed > MAX_WALK_SPEED_MPS) suspicious++;
        }
        prev = p;
    }
    return suspicious;
}

async function handleRoutes(req, res, tokenData) {
    if (req.method === 'POST') {
        const { action } = req.body;

        // Start a new route
        if (action === 'start') {
            if (tokenData.role !== 'sales' && tokenData.role !== 'admin') {
                return res.status(403).json({ error: 'Sales access required' });
            }
            // repName is bound to the authenticated token only — never trust a
            // client-supplied name here, or a rep could start a route under
            // someone else's identity.
            const repName = tokenData.repName || '';
            if (!repName) {
                return res.status(400).json({ error: 'No rep name on this session. Please sign out and sign back in.' });
            }

            const assignmentId = req.body.assignmentId || null;
            if (assignmentId) {
                const assignment = await kv.get(`assignment:${assignmentId}`);
                if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
                if (tokenData.role !== 'admin' && assignment.repName !== repName) {
                    return res.status(403).json({ error: 'This assignment belongs to a different rep' });
                }
            }

            const id = `route_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const route = {
                id,
                repName,
                assignmentId,
                startTime: new Date().toISOString(),
                endTime: null,
                status: 'active',
                points: [],
                segmentCount: 0,
                suspiciousSegmentCount: 0,
                flagged: false,
            };
            await kv.set(`route:${id}`, route);
            await kv.lpush('route_ids', id);

            // If this route is working a scheduled assignment, flip it to in-progress.
            if (assignmentId) {
                const assignment = await kv.get(`assignment:${assignmentId}`);
                if (assignment && assignment.status === 'planned') {
                    assignment.status = 'in-progress';
                    await kv.set(`assignment:${assignmentId}`, assignment);
                }
            }

            return res.status(201).json({ success: true, route });
        }

        // Append a batch of breadcrumb points
        if (action === 'append') {
            const { routeId, points } = req.body;
            if (!routeId) return res.status(400).json({ error: 'routeId required' });
            if (!Array.isArray(points) || !points.length) {
                return res.status(400).json({ error: 'points array required' });
            }
            if (points.length > 2000) {
                return res.status(400).json({ error: 'Too many points in one batch' });
            }
            const route = await kv.get(`route:${routeId}`);
            if (!route) return res.status(404).json({ error: 'Route not found' });
            if (tokenData.role !== 'admin' && route.repName !== tokenData.repName) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            if (route.status !== 'active') {
                return res.status(400).json({ error: 'Route is not active' });
            }

            const clean = points
                .filter(isValidCoord)
                .map(p => ({ lat: p.lat, lng: p.lng, ts: p.ts || Date.now(), accuracy: Number.isFinite(p.accuracy) ? p.accuracy : null }))
                .sort((a, b) => a.ts - b.ts);

            if (clean.length) {
                const prevPoint = route.points[route.points.length - 1] || null;
                const suspicious = countSuspiciousSegments(prevPoint, clean);
                route.segmentCount += Math.max(0, clean.length - (prevPoint ? 0 : 1));
                route.suspiciousSegmentCount += suspicious;
                route.flagged = route.segmentCount > 4 && (route.suspiciousSegmentCount / route.segmentCount) > SUSPICIOUS_SEGMENT_RATIO;

                route.points.push(...clean);
                // Cap stored points per route to keep KV records bounded on very long walks.
                if (route.points.length > 20000) route.points = route.points.slice(-20000);
            }

            await kv.set(`route:${routeId}`, route);
            return res.status(200).json({ success: true, pointCount: route.points.length, flagged: route.flagged });
        }

        // End a route
        if (action === 'end') {
            const { routeId } = req.body;
            if (!routeId) return res.status(400).json({ error: 'routeId required' });
            const route = await kv.get(`route:${routeId}`);
            if (!route) return res.status(404).json({ error: 'Route not found' });
            if (tokenData.role !== 'admin' && route.repName !== tokenData.repName) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            route.status = 'completed';
            route.endTime = new Date().toISOString();
            await kv.set(`route:${routeId}`, route);
            return res.status(200).json({ success: true, route });
        }

        return res.status(400).json({ error: 'Unknown action' });
    }

    // GET a single route (?id=) or list routes (admin: all, sales: own)
    if (req.method === 'GET') {
        const { id } = req.query;
        if (id) {
            const route = await kv.get(`route:${id}`);
            if (!route) return res.status(404).json({ error: 'Not found' });
            if (tokenData.role !== 'admin' && route.repName !== tokenData.repName) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            return res.status(200).json({ success: true, route });
        }

        const ids = await kv.lrange('route_ids', 0, -1);
        if (!ids.length) return res.status(200).json({ success: true, routes: [] });

        const records = await kv.mget(...ids.map(rid => `route:${rid}`));
        const routes = records
            .filter(route => route && (tokenData.role === 'admin' || route.repName === tokenData.repName))
            .map(route => {
                // Omit full point arrays in the list view — callers fetch by id for detail.
                const { points, ...summary } = route;
                return { ...summary, pointCount: (points || []).length };
            });
        return res.status(200).json({ success: true, routes });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ============================================================
// CONFIRM (?resource=confirm) — batch-confirm endpoint for the door-hanger
// campaign. A rep walks a route (routes resource above records GPS
// breadcrumbs the whole time), then at the end taps the stops they
// actually placed a hanger at on a map and submits them all at once here.
// Each confirmed stop is checked for a plausible "dwell" near the rep's own
// recorded path (not just proximity — see note below), deduped against
// existing ql:* leads (including leads from other sources that never
// stored coordinates), and either turned into a new lead, logged as
// non-actionable, or checked against a persistent do-not-solicit list —
// reusing the same `ql:*` KV pipeline the rest of the CRM (Facebook Ads /
// website leads) already writes to.
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
// ============================================================
const MAX_STOP_DISTANCE_METERS = 30;      // a stop must have at least one recorded point this close
const MIN_DWELL_POINTS = 2;               // ...and at least this many recorded points nearby...
const MIN_DWELL_MS = 1500;                // ...spanning at least this much time (not one fast pass-through)
const DWELL_RADIUS_METERS = 15;
const DEDUPE_RADIUS_METERS = 40;
const MAX_STOPS_PER_SUBMIT = 300;
const DH_STATUSES = ['Hung', 'No Answer', 'Already Has One', 'No Safe Access', 'Do Not Solicit'];

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

async function handleConfirm(req, res, tokenData) {
    if (tokenData.role !== 'sales' && tokenData.role !== 'admin') {
        return res.status(403).json({ error: 'Sales access required' });
    }

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
            // ql_ids is a plain JSON array (owned by handleLeads above) — must
            // match that pattern exactly, not the native-list pattern used for
            // this section's own keys (dh_ids/dns_ids), or the two writers
            // would corrupt each other's storage format for this shared key.
            const qlIds = (await kv.get('ql_ids')) || [];
            qlIds.unshift(lead.id);
            await kv.set('ql_ids', qlIds);
            results.push({ ...stop, outcome: 'lead_created', address, leadId: lead.id });
        }

        return res.status(200).json({ success: true, results, routeFlagged: !!route.flagged });
    }

    // GET — paginated list of coverage log entries (admin: all, sales: own),
    // or ?type=dns for the do-not-solicit list. Paginated server-side via
    // native list ops (not "fetch everything, slice in the browser") so
    // this stays responsive once the campaign has generated thousands of
    // log entries — a full 10,000-hanger run will produce far more than
    // 10,000 coverage-log rows once every non-Hung outcome is counted.
    if (req.method === 'GET') {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        if (req.query.type === 'dns') {
            if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
            const total = await kv.llen('dns_ids');
            const ids = total ? await kv.lrange('dns_ids', offset, offset + limit - 1) : [];
            const entries = ids.length ? (await kv.mget(...ids.map(id => `dns:${id}`))).filter(Boolean) : [];
            return res.status(200).json({ success: true, entries, total, hasMore: offset + entries.length < total });
        }

        const total = await kv.llen('dh_ids');
        const ids = total ? await kv.lrange('dh_ids', offset, offset + limit - 1) : [];
        const records = ids.length ? await kv.mget(...ids.map(id => `dh:${id}`)) : [];
        const entries = records.filter(entry => entry && (tokenData.role === 'admin' || entry.repName === tokenData.repName));
        return res.status(200).json({ success: true, entries, total, hasMore: offset + ids.length < total });
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
}

// ============================================================
// ASSIGNMENTS (?resource=assignments) — manager-scheduled door-hanger route
// assignments. A manager (admin) plans which rep should cover which area
// on which day; the rep sees it on their door-hangers.html page as "today's
// assignment" before they start walking. Status flow: planned ->
// in-progress (auto-set when the rep starts a route tagged with this
// assignment, see the routes resource above) -> done (manual close-out or
// once coverage crosses a threshold).
// ============================================================
async function handleAssignments(req, res, tokenData) {
    // POST — create an assignment (admin only)
    if (req.method === 'POST') {
        if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        const { repName, date, area, notes, targetCount } = req.body;
        if (!repName || !date || !area) {
            return res.status(400).json({ error: 'repName, date, and area are required' });
        }
        const assignment = {
            id: `assignment_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            repName,
            date,          // 'YYYY-MM-DD'
            area,          // free text: street name(s) / neighborhood description
            notes: notes || '',
            targetCount: parseInt(targetCount, 10) || 0,
            status: 'planned',
            createdAt: new Date().toISOString(),
        };
        await kv.set(`assignment:${assignment.id}`, assignment);
        await kv.lpush('assignment_ids', assignment.id);
        return res.status(201).json({ success: true, assignment });
    }

    // GET — admin sees all (paginated); sales sees their own (door-hangers.html
    // doesn't pass limit/offset — assignment volume per rep is naturally low,
    // so the default page is generous enough to just mean "everything").
    if (req.method === 'GET') {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 500);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const total = await kv.llen('assignment_ids');
        const ids = total ? await kv.lrange('assignment_ids', offset, offset + limit - 1) : [];
        const records = ids.length ? await kv.mget(...ids.map(id => `assignment:${id}`)) : [];
        const assignments = records.filter(a => a && (tokenData.role === 'admin' || a.repName === tokenData.repName));
        return res.status(200).json({ success: true, assignments, total, hasMore: offset + ids.length < total });
    }

    // PATCH — update status/notes/target (admin, or the assigned rep updating status)
    if (req.method === 'PATCH') {
        const { id, status, notes, targetCount } = req.body;
        if (!id) return res.status(400).json({ error: 'ID required' });
        const assignment = await kv.get(`assignment:${id}`);
        if (!assignment) return res.status(404).json({ error: 'Not found' });
        if (tokenData.role !== 'admin' && assignment.repName !== tokenData.repName) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (status !== undefined) {
            if (!['planned', 'in-progress', 'done'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }
            assignment.status = status;
        }
        if (notes !== undefined) assignment.notes = notes;
        if (targetCount !== undefined) assignment.targetCount = parseInt(targetCount, 10) || 0;
        assignment.updatedAt = new Date().toISOString();
        await kv.set(`assignment:${id}`, assignment);
        return res.status(200).json({ success: true, assignment });
    }

    // DELETE — remove an assignment (admin only)
    if (req.method === 'DELETE') {
        if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID required' });
        await kv.del(`assignment:${id}`);
        await kv.lrem('assignment_ids', 0, id);
        return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

// ============================================================
// REPS (?resource=reps) — admin-managed per-rep credentials for door-hanger
// reps. Unlike the rest of the Sales portal (one shared password + a
// free-typed name), each door hanger rep gets their own username/password
// here — this is what api/auth.js checks against for role:'sales' logins
// that include a username, so a rep's identity is actually verified rather
// than just self-asserted.
//
// Deliberately scoped to door-hanger accounts only, not a rewrite of the
// existing shared Sales login used by sales.html for estimates — that
// stays as-is so this doesn't risk the revenue-generating estimate tool.
// ============================================================
async function handleReps(req, res, tokenData) {
    if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    // POST — create a new rep account
    if (req.method === 'POST') {
        const { name, username, password } = req.body;
        if (!name || !username || !password) {
            return res.status(400).json({ error: 'name, username, and password are required' });
        }
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
        const cleanUsername = username.trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) {
            return res.status(400).json({ error: 'Username must be 3-32 characters: letters, numbers, dots, dashes, underscores' });
        }
        const existing = await kv.get(`dhrep:${cleanUsername}`);
        if (existing) return res.status(409).json({ error: 'That username is already taken' });

        const { salt, hash } = hashPassword(password);
        const rep = {
            username: cleanUsername, name: name.trim(), salt, hash,
            active: true, createdAt: new Date().toISOString(),
        };
        await kv.set(`dhrep:${cleanUsername}`, rep);
        await kv.lpush('dhrep_ids', cleanUsername);

        const { salt: _s, hash: _h, ...safeRep } = rep;
        return res.status(201).json({ success: true, rep: safeRep });
    }

    // GET — list rep accounts, paginated (never returns password hashes)
    if (req.method === 'GET') {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const total = await kv.llen('dhrep_ids');
        const ids = total ? await kv.lrange('dhrep_ids', offset, offset + limit - 1) : [];
        const records = ids.length ? await kv.mget(...ids.map(u => `dhrep:${u}`)) : [];
        const reps = records.filter(Boolean).map(({ salt, hash, ...safe }) => safe);
        return res.status(200).json({ success: true, reps, total, hasMore: offset + ids.length < total });
    }

    // PATCH — rename, activate/deactivate, or reset a rep's password
    if (req.method === 'PATCH') {
        const { username, name, active, newPassword } = req.body;
        if (!username) return res.status(400).json({ error: 'username required' });
        const cleanUsername = username.trim().toLowerCase();
        const rep = await kv.get(`dhrep:${cleanUsername}`);
        if (!rep) return res.status(404).json({ error: 'Not found' });

        if (name !== undefined) rep.name = name.trim();
        if (active !== undefined) rep.active = !!active;
        if (newPassword !== undefined) {
            if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
            const { salt, hash } = hashPassword(newPassword);
            rep.salt = salt; rep.hash = hash;
        }
        rep.updatedAt = new Date().toISOString();
        await kv.set(`dhrep:${cleanUsername}`, rep);

        const { salt: _s, hash: _h, ...safeRep } = rep;
        return res.status(200).json({ success: true, rep: safeRep });
    }

    // DELETE — remove a rep account. Historical routes/leads keep their
    // repName as plain text, so deleting an account doesn't erase history.
    if (req.method === 'DELETE') {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'username required' });
        const cleanUsername = username.trim().toLowerCase();
        await kv.del(`dhrep:${cleanUsername}`);
        await kv.lrem('dhrep_ids', 0, cleanUsername);
        return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
