const { kv } = require('@vercel/kv');

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

    try {
        // POST — create quick lead
        if (req.method === 'POST') {
            const { name, address, notes } = req.body;
            if (!name || !address) return res.status(400).json({ error: 'Name and address are required' });

            const lead = {
                id: `ql_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                name,
                address,
                notes: notes || '',
                salesRep: tokenData.repName || '',
                createdAt: new Date().toISOString()
            };

            await kv.set(`ql:${lead.id}`, lead);

            const ids = (await kv.get('ql_ids')) || [];
            ids.unshift(lead.id);
            await kv.set('ql_ids', ids);

            return res.status(201).json({ success: true, lead });
        }

        // GET — retrieve leads (admin sees all, sales sees own)
        if (req.method === 'GET') {
            const ids = (await kv.get('ql_ids')) || [];
            const leads = [];
            for (const id of ids) {
                const lead = await kv.get(`ql:${id}`);
                if (!lead) continue;
                if (tokenData.role === 'admin' || lead.salesRep === tokenData.repName) {
                    leads.push(lead);
                }
            }
            return res.status(200).json({ success: true, leads });
        }

        // DELETE — remove a lead (own leads only, or admin)
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
    } catch (err) {
        console.error('Quick leads error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
