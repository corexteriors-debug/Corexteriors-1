const { kv } = require('@vercel/kv');

// GPS breadcrumb capture for door-hanger reps walking a route.
// A rep starts a route, the client flushes small batches of {lat,lng,ts}
// points as they walk, then ends the route. api/door-hangers.js later
// checks confirmed stops for plausible "dwell" near these points.
//
// Note on trust: a stop being close to a recorded point is not, by itself,
// meaningful proof — the client picks stop coordinates FROM these same
// points. The actual trust signal here is whether the *route itself* looks
// like a genuine walk (continuous, walking-speed movement) rather than a
// fabricated burst of points. That's what MAX_WALK_SPEED_MPS below is for:
// it can't stop a determined attacker with API access, but it does catch
// the realistic case (a route driven or teleported rather than walked).

const MAX_WALK_SPEED_MPS = 4.5; // ~16 km/h, generous for a fast walk/jog with GPS jitter
const SUSPICIOUS_SEGMENT_RATIO = 0.25; // flag the route if >25% of segments exceed walking speed

function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

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

    try {
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
    } catch (err) {
        console.error('Routes error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
