const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // GET — verify token and return role
    if (req.method === 'GET') {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token' });
        }
        const token = authHeader.split(' ')[1];
        const tokenData = await kv.get(`token:${token}`);
        if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });
        return res.status(200).json({ success: true, role: tokenData.role, repName: tokenData.repName || '' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { password, role, repName } = req.body;

        if (!password || !role) {
            return res.status(400).json({ error: 'Password and role are required' });
        }

        const SALES_PASSWORD = process.env.SALES_PASSWORD || 'coresales2026';
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'coreadmin2026';

        let authenticated = false;
        let token = '';

        if (role === 'sales' && password === SALES_PASSWORD) {
            authenticated = true;
            token = 'sales_' + Buffer.from(Date.now().toString() + '_sales').toString('base64');
            await kv.set(`token:${token}`, { role: 'sales', repName: repName || '', created: Date.now() }, { ex: 86400 });
        } else if (role === 'admin' && password === ADMIN_PASSWORD) {
            authenticated = true;
            token = 'admin_' + Buffer.from(Date.now().toString() + '_admin').toString('base64');
            await kv.set(`token:${token}`, { role: 'admin', created: Date.now() }, { ex: 86400 });
        }

        if (authenticated) {
            return res.status(200).json({ success: true, token, role });
        } else {
            return res.status(401).json({ error: 'Invalid password' });
        }
    } catch (error) {
        console.error('Auth error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
