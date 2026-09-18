const { kv } = require('@vercel/kv');
const { hashPassword, verifyPassword } = require('./_authCrypto');

// Admin-managed per-rep credentials for door-hanger reps. Unlike the rest
// of the Sales portal (one shared password + a free-typed name), each door
// hanger rep gets their own username/password here — this is what api/auth.js
// checks against for role:'sales' logins that include a username, so a
// rep's identity is actually verified rather than just self-asserted.
//
// Deliberately scoped to door-hanger accounts only, not a rewrite of the
// existing shared Sales login used by sales.html for estimates — that
// stays as-is so this doesn't risk the revenue-generating estimate tool.

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
    if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    try {
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
    } catch (err) {
        console.error('Door hanger reps error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
