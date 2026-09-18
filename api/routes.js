const { kv } = require('@vercel/kv');

// GPS breadcrumb capture for door-hanger reps walking a route.
// A rep starts a route, the client flushes small batches of {lat,lng,ts}
// points as they walk, then ends the route. api/door-hangers.js later
// verifies confirmed stops against these recorded points.

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
                const id = `route_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                const route = {
                    id,
                    repName: tokenData.repName || req.body.repName || '',
                    assignmentId: req.body.assignmentId || null,
                    startTime: new Date().toISOString(),
                    endTime: null,
                    status: 'active',
                    points: [],
                };
                await kv.set(`route:${id}`, route);
                const ids = (await kv.get('route_ids')) || [];
                ids.unshift(id);
                await kv.set('route_ids', ids);

                // If this route is working a scheduled assignment, flip it to in-progress.
                if (route.assignmentId) {
                    const assignment = await kv.get(`assignment:${route.assignmentId}`);
                    if (assignment && assignment.status === 'planned') {
                        assignment.status = 'in-progress';
                        await kv.set(`assignment:${route.assignmentId}`, assignment);
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
                const route = await kv.get(`route:${routeId}`);
                if (!route) return res.status(404).json({ error: 'Route not found' });
                if (tokenData.role !== 'admin' && route.repName !== tokenData.repName) {
                    return res.status(403).json({ error: 'Forbidden' });
                }
                if (route.status !== 'active') {
                    return res.status(400).json({ error: 'Route is not active' });
                }

                const clean = points
                    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
                    .map(p => ({ lat: p.lat, lng: p.lng, ts: p.ts || Date.now() }));
                route.points.push(...clean);
                // Cap stored points per route to keep KV records bounded on very long walks.
                if (route.points.length > 20000) route.points = route.points.slice(-20000);

                await kv.set(`route:${routeId}`, route);
                return res.status(200).json({ success: true, pointCount: route.points.length });
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

            const ids = (await kv.get('route_ids')) || [];
            const routes = [];
            for (const rid of ids) {
                const route = await kv.get(`route:${rid}`);
                if (!route) continue;
                if (tokenData.role === 'admin' || route.repName === tokenData.repName) {
                    // Omit full point arrays in the list view — callers fetch by id for detail.
                    const { points, ...summary } = route;
                    routes.push({ ...summary, pointCount: (points || []).length });
                }
            }
            return res.status(200).json({ success: true, routes });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('Routes error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
