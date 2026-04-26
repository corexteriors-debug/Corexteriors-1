const { kv } = require('@vercel/kv');
const { google } = require('googleapis');
const crypto = require('crypto');

const TIMEZONE = 'America/Toronto';
const ALLOWED_ORIGINS = ['https://corexteriors.ca', 'https://www.corexteriors.ca'];

function cors(req, res) {
    const origin = req.headers.origin || '';
    const allowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app');
    res.setHeader('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGINS[0]);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function verifyAdminToken(req) {
    const token = (req.headers.authorization || '').split(' ')[1] || '';
    if (!token) return false;
    const data = await kv.get(`token:${token}`);
    return data && data.role === 'admin';
}

async function verifyWorkerSession(token) {
    if (!token) return null;
    const session = await kv.get(`worker-session:${token}`);
    if (!session) return null;
    const worker = await kv.get(`worker:${session.workerId}`);
    if (!worker || !worker.active) return null;
    return session;
}

function nowISO() { return new Date().toISOString(); }

function todayKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

function hashPin(pin) {
    const secret = process.env.PIN_HMAC_SECRET;
    if (!secret) throw new Error('PIN_HMAC_SECRET env var is required');
    return crypto.createHmac('sha256', secret).update(String(pin)).digest('hex');
}

module.exports = async function handler(req, res) {
    cors(req, res);
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
        return res.status(500).json({ error: 'Server error. Please try again.' });
    }
};

async function verifyPin(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    const index = await kv.get('workers:index') || [];
    const workers = await Promise.all(index.map(id => kv.get(`worker:${id}`)));
    const pinHash = hashPin(pin);
    // Iterate ALL workers (no early return) to avoid timing side-channel
    let matched = null;
    for (const worker of workers) {
        if (worker && worker.active && worker.pinHash === pinHash) matched = worker;
    }
    if (matched) {
        const token = crypto.randomBytes(24).toString('hex');
        await kv.set(`worker-session:${token}`, { workerId: matched.id, name: matched.name }, { ex: 86400 });
        return res.status(200).json({ success: true, token, name: matched.name, workerId: matched.id });
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
        if (w && w.active && w.pinHash === hashPin(pin)) return res.status(409).json({ error: 'PIN already in use' });
    }

    const workerId = crypto.randomBytes(8).toString('hex');
    const worker = { id: workerId, name: String(name).trim(), pinHash: hashPin(pin), active: true };
    await kv.set(`worker:${workerId}`, worker);
    await kv.set('workers:index', [...index, workerId]);
    return res.status(201).json({ success: true, worker: { id: worker.id, name: worker.name, active: worker.active } });
}

async function listWorkers(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });
    const index = await kv.get('workers:index') || [];
    const workers = (await Promise.all(index.map(id => kv.get(`worker:${id}`)))).filter(Boolean);
    const safeWorkers = workers.map(({ pinHash: _h, ...rest }) => rest);
    return res.status(200).json({ success: true, workers: safeWorkers });
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

async function writeLog(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const { sessionToken, event, calendarEventId, jobTitle } = req.body || {};
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const VALID_EVENTS = ['dayClockIn', 'dayClockOut', 'lunchOut', 'lunchIn', 'jobClockIn', 'jobClockOut'];
    if (!event || !VALID_EVENTS.includes(event)) return res.status(400).json({ error: 'Invalid event' });

    const { workerId } = session;
    const date = todayKey();
    const key = `labour:${date}:${workerId}`;
    let log = await kv.get(key) || { dayClockIn: null, dayClockOut: null, lunchOut: null, lunchIn: null, jobs: [] };
    const ts = nowISO();

    if (event === 'dayClockIn')  log.dayClockIn  = ts;
    if (event === 'dayClockOut') log.dayClockOut = ts;
    if (event === 'lunchOut')    log.lunchOut    = ts;
    if (event === 'lunchIn')     log.lunchIn     = ts;

    if (event === 'jobClockIn') {
        if (!calendarEventId || !jobTitle) return res.status(400).json({ error: 'calendarEventId and jobTitle required' });
        if (!log.jobs.find(j => j.calendarEventId === calendarEventId)) {
            log.jobs.push({ calendarEventId, jobTitle, clockIn: ts, clockOut: null, photos: [] });
        }
    }

    if (event === 'jobClockOut') {
        if (!calendarEventId) return res.status(400).json({ error: 'calendarEventId required' });
        const job = log.jobs.find(j => j.calendarEventId === calendarEventId);
        if (!job) return res.status(404).json({ error: 'Job not clocked in' });
        job.clockOut = ts;
    }

    await kv.set(key, log);
    return res.status(200).json({ success: true, log });
}

function stripPricing(text) {
    if (!text) return '';
    return text.split('\n').filter(line => !/\$\d/.test(line)).join('\n').trim();
}

async function todayJobs(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    const sessionToken = (req.headers.authorization || '').split(' ')[1] || '';
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const email      = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const key        = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    const calendarId = (process.env.GOOGLE_CALENDAR_ID || '').trim();
    if (!email || !key || !calendarId) return res.status(503).json({ error: 'Calendar not configured' });

    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/calendar.readonly'] });
    const cal  = google.calendar({ version: 'v3', auth });

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    // Build Toronto-midnight timestamps by using the UTC offset for America/Toronto
    // toLocaleDateString already gave us the correct YYYY-MM-DD for Toronto,
    // so we append the time and let the browser/server parse with explicit offset.
    // Safer: format as strings and let Google Calendar interpret with timeZone param.
    const timeMin = `${todayStr}T00:00:00`;
    const timeMax = `${todayStr}T23:59:59`;

    const response = await cal.events.list({
        calendarId, timeMin, timeMax,
        timeZone: TIMEZONE,
        singleEvents: true, orderBy: 'startTime', maxResults: 50
    });

    const jobs = (response.data.items || [])
        .filter(e => (e.extendedProperties?.private?.eventType || 'job') !== 'unavailable')
        .map(e => ({
            id:          e.id,
            title:       e.summary || 'Job',
            description: stripPricing(e.description || ''),
            start:       e.start.dateTime || e.start.date,
            end:         e.end.dateTime   || e.end.date,
        }));

    const log = await kv.get(`labour:${todayStr}:${session.workerId}`) || null;
    return res.status(200).json({ success: true, jobs, log, date: todayStr });
}

async function dailyLogs(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });
    const date  = req.query.date || todayKey();
    const index = await kv.get('workers:index') || [];
    const results = await Promise.all(index.map(async (workerId) => {
        const raw = await kv.get(`worker:${workerId}`);
        const worker = raw ? (({ pinHash: _h, ...rest }) => rest)(raw) : null;
        return { worker, log: await kv.get(`labour:${date}:${workerId}`) || null };
    }));
    return res.status(200).json({ success: true, date, workers: results.filter(r => r.worker) });
}

async function editLog(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });

    const { workerId, date, field, value, jobIndex } = req.body || {};
    if (!workerId || !date || !field) return res.status(400).json({ error: 'workerId, date, field required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const VALID_FIELDS = ['dayClockIn', 'dayClockOut', 'lunchOut', 'lunchIn', 'jobClockIn', 'jobClockOut'];
    if (!VALID_FIELDS.includes(field)) return res.status(400).json({ error: 'Invalid field' });

    const key = `labour:${date}:${workerId}`;
    let log = await kv.get(key) || { dayClockIn: null, dayClockOut: null, lunchOut: null, lunchIn: null, jobs: [] };

    function toISO(timeStr) {
        if (!timeStr) return null;
        if (timeStr.includes('T')) return timeStr;
        if (!/^\d{2}:\d{2}$/.test(timeStr)) return null;
        // Determine Toronto UTC offset for this date using noon (avoids DST midnight edge cases)
        const noon = new Date(`${date}T12:00:00Z`);
        const parts = new Intl.DateTimeFormat('en', { timeZone: TIMEZONE, timeZoneName: 'shortOffset' }).formatToParts(noon);
        const tzName = (parts.find(p => p.type === 'timeZoneName') || {}).value || '';
        const match = tzName.match(/GMT([+-]\d+)/);
        const offsetHours = match ? parseInt(match[1]) : -5; // default EST if parse fails
        const sign = offsetHours >= 0 ? '+' : '-';
        const absH = String(Math.abs(offsetHours)).padStart(2, '0');
        const d = new Date(`${date}T${timeStr}:00${sign}${absH}:00`);
        if (isNaN(d.getTime())) return null;
        return d.toISOString();
    }

    if (field === 'dayClockIn')  log.dayClockIn  = toISO(value);
    if (field === 'dayClockOut') log.dayClockOut = toISO(value);
    if (field === 'lunchOut')    log.lunchOut    = toISO(value);
    if (field === 'lunchIn')     log.lunchIn     = toISO(value);
    if (field === 'jobClockIn'  && jobIndex != null && log.jobs[jobIndex]) log.jobs[jobIndex].clockIn  = toISO(value);
    if (field === 'jobClockOut' && jobIndex != null && log.jobs[jobIndex]) log.jobs[jobIndex].clockOut = toISO(value);

    await kv.set(key, log);
    return res.status(200).json({ success: true, log });
}
