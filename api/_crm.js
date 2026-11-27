// The agents' CRM inside the manager dashboard (admin.html → CRM tab).
//
// The CRM itself lives on Luke's Mac (core-exteriors-agents, scripts/tools/crm.mjs). The Mac's
// watcher pushes a read-only snapshot here every few minutes, pulls the changes Luke made in the
// dashboard, applies them through crm.mjs, and pushes again. "Ask an agent" questions queue the
// same way and run on the Mac. Nothing here sends, posts or charges anything.
//
// Routed from api/quick-leads.js (?kind=crm) so the Vercel function count stays at 12.
//
// KV:
//   crm:snapshot          the latest snapshot from the Mac (+ syncedAt)
//   crm:ops   (hash)      id -> { id, op, body, at }   changes waiting for the Mac
//   crm:results (list)    newest-first outcomes of applied changes (last 50)
//   crm:asks  (hash)      id -> { id, agent, message, sessionId, status, reply, at, doneAt }
//
// Auth: the admin dashboard token, or the Mac worker secret (MEASURE_WORKER_SECRET).
const { isWorker } = require('./_measure');

const OPS = ['move', 'lead', 'contact-upsert', 'opp-set', 'note', 'task-add', 'task-done', 'post-add', 'post-set', 'tag', 'dnd'];
const AGENTS = ['chief', 'sales', 'books', 'office', 'crew', 'studio', 'presence', 'research'];
const MAX_SNAPSHOT = 900_000;
const MAX_ASKS = 40;

const rid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const values = (h) => Object.values(h || {}).filter((x) => x && typeof x === 'object');

async function handleCrm(req, res, { kv }) {
    // auth.js falls back to a built-in admin password when ADMIN_PASSWORD isn't set, and this repo
    // is public. Client details and agent runs stay off until a real password is configured.
    if (!(process.env.ADMIN_PASSWORD || '').trim()) {
        return res.status(503).json({ error: 'The CRM tab is off until ADMIN_PASSWORD is set in Vercel.' });
    }
    const worker = isWorker(req);
    if (!worker) {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        const tokenData = token ? await kv.get(`token:${token}`) : null;
        if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });
        if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    }
    const action = String(req.query?.action || req.body?.action || '');

    // ── Mac worker ─────────────────────────────────────────────
    if (worker) {
        if (req.method === 'GET' && action === 'pull') {
            const [ops, asks] = await Promise.all([kv.hgetall('crm:ops'), kv.hgetall('crm:asks')]);
            return res.status(200).json({
                success: true,
                ops: values(ops).sort((a, b) => String(a.at).localeCompare(String(b.at))),
                asks: values(asks).filter((a) => a.status === 'queued').sort((a, b) => String(a.at).localeCompare(String(b.at))),
            });
        }
        if (req.method === 'POST' && action === 'push') {
            const snap = req.body?.snapshot;
            if (!snap || typeof snap !== 'object' || !Array.isArray(snap.contacts) || !Array.isArray(snap.opps)) {
                return res.status(400).json({ error: 'Bad snapshot' });
            }
            const size = JSON.stringify(snap).length;
            if (size > MAX_SNAPSHOT) return res.status(413).json({ error: `Snapshot too large (${size} bytes)` });
            await kv.set('crm:snapshot', { ...snap, syncedAt: new Date().toISOString() });
            return res.status(200).json({ success: true, size });
        }
        if (req.method === 'POST' && action === 'ack') {
            const done = Array.isArray(req.body?.done) ? req.body.done.slice(0, 100) : [];
            for (const d of done) {
                const id = String(d.id || '').slice(0, 80);
                if (!id) continue;
                const op = await kv.hget('crm:ops', id);
                await kv.hdel('crm:ops', id);
                await kv.lpush('crm:results', { id, op: op?.op || '', ok: Boolean(d.ok), error: String(d.error || '').slice(0, 300), summary: String(d.summary || '').slice(0, 200), at: new Date().toISOString() });
            }
            await kv.ltrim('crm:results', 0, 49);
            return res.status(200).json({ success: true, acked: done.length });
        }
        if (req.method === 'POST' && action === 'answer') {
            const id = String(req.body?.id || '').slice(0, 80);
            const ask = id ? await kv.hget('crm:asks', id) : null;
            if (!ask) return res.status(404).json({ error: 'No such question' });
            const status = ['working', 'done', 'error'].includes(req.body.status) ? req.body.status : 'done';
            await kv.hset('crm:asks', {
                [id]: {
                    ...ask, status,
                    reply: String(req.body.reply || '').slice(0, 20000),
                    sessionId: String(req.body.sessionId || ask.sessionId || '').slice(0, 64),
                    ...(status === 'working' ? { startedAt: new Date().toISOString() } : { doneAt: new Date().toISOString() }),
                },
            });
            return res.status(200).json({ success: true });
        }
        return res.status(400).json({ error: 'Unknown worker action' });
    }

    // ── Manager dashboard ──────────────────────────────────────
    if (req.method === 'GET') {
        const [snapshot, ops, asks, results] = await Promise.all([
            kv.get('crm:snapshot'), kv.hgetall('crm:ops'), kv.hgetall('crm:asks'), kv.lrange('crm:results', 0, 19),
        ]);
        return res.status(200).json({
            success: true,
            snapshot: snapshot || null,
            pending: values(ops).sort((a, b) => String(a.at).localeCompare(String(b.at))),
            asks: values(asks).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20),
            results: results || [],
        });
    }
    if (req.method === 'POST' && action === 'queue') {
        const op = String(req.body?.op || '');
        const body = req.body?.body && typeof req.body.body === 'object' ? req.body.body : {};
        if (!OPS.includes(op)) return res.status(400).json({ error: 'Unknown change' });
        if (JSON.stringify(body).length > 20000) return res.status(413).json({ error: 'Too large' });
        const entry = { id: rid('op'), op, body, at: new Date().toISOString() };
        await kv.hset('crm:ops', { [entry.id]: entry });
        return res.status(200).json({ success: true, queued: entry });
    }
    if (req.method === 'POST' && action === 'ask') {
        const agent = AGENTS.includes(req.body?.agent) ? req.body.agent : 'chief';
        const message = String(req.body?.message || '').trim().slice(0, 6000);
        if (!message) return res.status(400).json({ error: 'Empty message' });
        const sessionId = /^[0-9a-f-]{36}$/i.test(req.body?.sessionId || '') ? req.body.sessionId : '';
        const ask = { id: rid('ask'), agent, message, sessionId, status: 'queued', reply: '', at: new Date().toISOString() };
        await kv.hset('crm:asks', { [ask.id]: ask });
        // Keep the newest MAX_ASKS.
        const all = values(await kv.hgetall('crm:asks')).sort((a, b) => String(b.at).localeCompare(String(a.at)));
        const old = all.slice(MAX_ASKS).map((a) => a.id);
        if (old.length) await kv.hdel('crm:asks', ...old);
        return res.status(200).json({ success: true, ask });
    }
    return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = { handleCrm };
