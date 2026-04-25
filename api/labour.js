const { kv } = require('@vercel/kv');
const { google } = require('googleapis');
const crypto = require('crypto');

const TIMEZONE = 'America/Toronto';

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function verifyAdminToken(req) {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return false;
    const data = await kv.get(`token:${token}`);
    return data && data.role === 'admin';
}

async function verifyWorkerSession(token) {
    if (!token) return null;
    return await kv.get(`worker-session:${token}`);
}

function nowISO() { return new Date().toISOString(); }

function todayKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

module.exports = async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    const action = req.query.action;
    try {
        if (action === 'verify-pin')        return await verifyPin(req, res);
        if (action === 'add-worker')        return await addWorker(req, res);
        if (action === 'list-workers')      return await listWorkers(req, res);
        if (action === 'deactivate-worker') return await deactivateWorker(req, res);
        if (action === 'log')               return await writeLog(req, res);
        if (action === 'today-jobs')        return await todayJobs(req, res);
        if (action === 'daily')             return await dailyLogs(req, res);
        if (action === 'edit-log')          return await editLog(req, res);
        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('Labour API error:', err.message);
        return res.status(500).json({ error: err.message || 'Server error' });
    }
};

async function verifyPin(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    const index = await kv.get('workers:index') || [];
    for (const workerId of index) {
        const worker = await kv.get(`worker:${workerId}`);
        if (worker && worker.active && worker.pin === String(pin)) {
            const token = crypto.randomBytes(24).toString('hex');
            await kv.set(`worker-session:${token}`, { workerId: worker.id, name: worker.name }, { ex: 86400 });
            return res.status(200).json({ success: true, token, name: worker.name, workerId: worker.id });
        }
    }
    return res.status(401).json({ error: 'Invalid PIN' });
}

async function addWorker(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });

    const { name, pin } = req.body;
    if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });
    if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });

    const index = await kv.get('workers:index') || [];
    for (const wid of index) {
        const w = await kv.get(`worker:${wid}`);
        if (w && w.active && w.pin === String(pin)) return res.status(409).json({ error: 'PIN already in use' });
    }

    const workerId = crypto.randomBytes(8).toString('hex');
    const worker = { id: workerId, name: String(name).trim(), pin: String(pin), active: true };
    await kv.set(`worker:${workerId}`, worker);
    await kv.set('workers:index', [...index, workerId]);
    return res.status(201).json({ success: true, worker });
}

async function listWorkers(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });
    const index = await kv.get('workers:index') || [];
    const workers = (await Promise.all(index.map(id => kv.get(`worker:${id}`)))).filter(Boolean);
    return res.status(200).json({ success: true, workers });
}

async function deactivateWorker(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });
    const { workerId } = req.body;
    if (!workerId) return res.status(400).json({ error: 'workerId required' });
    const worker = await kv.get(`worker:${workerId}`);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    worker.active = false;
    await kv.set(`worker:${workerId}`, worker);
    return res.status(200).json({ success: true });
}

// Stubs — implemented in Task 2
async function writeLog(req, res)  { return res.status(501).json({ error: 'Not implemented yet' }); }
async function todayJobs(req, res) { return res.status(501).json({ error: 'Not implemented yet' }); }
async function dailyLogs(req, res) { return res.status(501).json({ error: 'Not implemented yet' }); }
async function editLog(req, res)   { return res.status(501).json({ error: 'Not implemented yet' }); }
