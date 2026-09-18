const { kv } = require('@vercel/kv');

// Manager-scheduled door-hanger route assignments. A manager (admin) plans
// which rep should cover which area on which day; the rep sees it on their
// door-hangers.html page as "today's assignment" before they start walking.
// Status flow: planned -> in-progress (auto-set when the rep starts a route
// tagged with this assignment, see api/routes.js) -> done (manual close-out
// or once coverage crosses a threshold).

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
            const ids = (await kv.get('assignment_ids')) || [];
            ids.unshift(assignment.id);
            await kv.set('assignment_ids', ids);
            return res.status(201).json({ success: true, assignment });
        }

        // GET — admin sees all; sales sees their own
        if (req.method === 'GET') {
            const ids = (await kv.get('assignment_ids')) || [];
            const assignments = [];
            for (const id of ids) {
                const a = await kv.get(`assignment:${id}`);
                if (!a) continue;
                if (tokenData.role === 'admin' || a.repName === tokenData.repName) assignments.push(a);
            }
            return res.status(200).json({ success: true, assignments });
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
            const ids = ((await kv.get('assignment_ids')) || []).filter(i => i !== id);
            await kv.set('assignment_ids', ids);
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('Assignments error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
