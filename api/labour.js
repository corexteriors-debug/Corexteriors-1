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

// ── Punch helpers ─────────────────────────────────────────────────────────────

// Normalize a stored log to always have a punches[] array.
// Migrates legacy dayClockIn/dayClockOut fields transparently.
function normalizePunches(log) {
    if (!log) return { punches: [], jobs: [] };
    if (Array.isArray(log.punches)) return log;
    const punches = [];
    if (log.dayClockIn) {
        punches.push({ in: log.dayClockIn, out: log.dayClockOut || null });
    }
    return { ...log, punches };
}

// Sum of all completed punch durations in minutes
function calcTotalMinutes(punches) {
    return punches.reduce((sum, p) => {
        if (!p.in || !p.out) return sum;
        return sum + Math.max(0, (new Date(p.out) - new Date(p.in)) / 60000);
    }, 0);
}

function fmtMinutes(mins) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Router ────────────────────────────────────────────────────────────────────

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
        if (action === 'clock-in')          return await clockIn(req, res);
        if (action === 'clock-out')         return await clockOut(req, res);
        if (action === 'crew-status')       return await crewStatus(req, res);
        if (action === 'complete-task')     return await completeTask(req, res);
        if (action === 'today-jobs')        return await todayJobs(req, res);
        if (action === 'week-jobs')         return await weekJobs(req, res);
        if (action === 'daily')             return await dailyLogs(req, res);
        if (action === 'edit-log')          return await editLog(req, res);
        if (action === 'add-job')           return await addJob(req, res);
        if (action === 'remove-job')        return await removeJob(req, res);
        if (action === 'list-jobs')         return await listJobs(req, res);
        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('Labour API error:', err.message);
        return res.status(500).json({ error: 'Server error. Please try again.' });
    }
};

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyPin(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    const index = await kv.get('workers:index') || [];
    const workers = await Promise.all(index.map(id => kv.get(`worker:${id}`)));
    const pinHash = hashPin(pin);
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

// ── Clock in / out (punch model) ──────────────────────────────────────────────

async function clockIn(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const sessionToken = (req.headers.authorization || '').split(' ')[1] || '';
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const { workerId } = session;
    const date = todayKey();
    const key = `labour:${date}:${workerId}`;
    const raw = await kv.get(key);
    const log = normalizePunches(raw);

    const lastPunch = log.punches[log.punches.length - 1];
    if (lastPunch && !lastPunch.out) {
        return res.status(409).json({ error: 'Already clocked in' });
    }

    log.punches.push({ in: nowISO(), out: null });
    await kv.set(key, log);

    const totalMinutes = calcTotalMinutes(log.punches);
    return res.status(200).json({ success: true, punches: log.punches, totalMinutes });
}

async function clockOut(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const sessionToken = (req.headers.authorization || '').split(' ')[1] || '';
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const { workerId } = session;
    const date = todayKey();
    const key = `labour:${date}:${workerId}`;
    const raw = await kv.get(key);
    const log = normalizePunches(raw);

    // Find the last open punch (no out)
    const openIdx = log.punches.map((p, i) => (!p.out ? i : -1)).filter(i => i >= 0).pop();
    if (openIdx === undefined) {
        return res.status(409).json({ error: 'Not clocked in' });
    }

    log.punches[openIdx].out = nowISO();
    await kv.set(key, log);

    const totalMinutes = calcTotalMinutes(log.punches);
    return res.status(200).json({ success: true, punches: log.punches, totalMinutes });
}

// ── Legacy log action (keeps offline queue working) ───────────────────────────
// dayClockIn → appends open punch; dayClockOut → closes last open punch

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
    const raw = await kv.get(key);
    const log = normalizePunches(raw);
    const ts = nowISO();

    if (event === 'dayClockIn') {
        const lastPunch = log.punches[log.punches.length - 1];
        if (!lastPunch || lastPunch.out) log.punches.push({ in: ts, out: null });
    }
    if (event === 'dayClockOut') {
        const openIdx = log.punches.map((p, i) => (!p.out ? i : -1)).filter(i => i >= 0).pop();
        if (openIdx !== undefined) log.punches[openIdx].out = ts;
    }
    // lunchOut / lunchIn kept for queue backward compat — treated as clock-out/in
    if (event === 'lunchOut') {
        const lastPunch = log.punches[log.punches.length - 1];
        if (lastPunch && !lastPunch.out) log.punches[log.punches.length - 1].out = ts;
    }
    if (event === 'lunchIn') {
        const lastPunch = log.punches[log.punches.length - 1];
        if (!lastPunch || lastPunch.out) log.punches.push({ in: ts, out: null });
    }

    if (!Array.isArray(log.jobs)) log.jobs = [];

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

// ── Crew status ───────────────────────────────────────────────────────────────

async function crewStatus(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    const sessionToken = (req.headers.authorization || '').split(' ')[1] || '';
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const todayStr = todayKey();
    const index = await kv.get('workers:index') || [];
    const crew = (await Promise.all(index.map(async (workerId) => {
        const worker = await kv.get(`worker:${workerId}`);
        if (!worker || !worker.active) return null;
        const raw = await kv.get(`labour:${todayStr}:${workerId}`);
        const log = normalizePunches(raw);
        const isIn = log.punches.some(p => p.in && !p.out);
        return isIn ? { id: worker.id, name: worker.name } : null;
    }))).filter(Boolean);

    return res.status(200).json({ success: true, crew });
}

// ── Complete task ─────────────────────────────────────────────────────────────

async function completeTask(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const sessionToken = (req.headers.authorization || '').split(' ')[1] || '';
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const { date, jobId, taskIndex } = req.body || {};
    if (!date || !jobId || taskIndex == null) return res.status(400).json({ error: 'date, jobId, taskIndex required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

    const jobs = await kv.get(`labour-jobs:${date}`) || [];
    const job = jobs.find(j => j.id === jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!Array.isArray(job.tasks) || job.tasks[taskIndex] === undefined) return res.status(404).json({ error: 'Task not found' });

    job.tasks[taskIndex].done = !job.tasks[taskIndex].done;
    await kv.set(`labour-jobs:${date}`, jobs);
    return res.status(200).json({ success: true, task: job.tasks[taskIndex] });
}

// ── Jobs / Calendar ───────────────────────────────────────────────────────────

function stripPricing(text) {
    if (!text) return '';
    return text.split('\n').filter(line => !/\$\d/.test(line)).join('\n').trim();
}

async function jobsForDate(dateStr, calClient) {
    const kvJobs = (await kv.get(`labour-jobs:${dateStr}`) || []).map(j => ({
        id:          j.id,
        title:       j.title,
        description: j.description || '',
        address:     j.address || '',
        notes:       j.notes || '',
        materials:   Array.isArray(j.materials) ? j.materials : [],
        tasks:       Array.isArray(j.tasks) ? j.tasks : [],
        start:       `${dateStr}T00:00:00`,
        end:         `${dateStr}T23:59:59`,
        source:      'manual',
    }));
    let calJobs = [];
    if (calClient) {
        try {
            const response = await calClient.events.list({
                calendarId: process.env.GOOGLE_CALENDAR_ID.trim(),
                timeMin: `${dateStr}T00:00:00`,
                timeMax: `${dateStr}T23:59:59`,
                timeZone: TIMEZONE,
                singleEvents: true, orderBy: 'startTime', maxResults: 50
            });
            calJobs = (response.data.items || [])
                .filter(e => (e.extendedProperties?.private?.eventType || 'job') !== 'unavailable')
                .map(e => ({
                    id:          e.id,
                    title:       e.summary || 'Job',
                    description: stripPricing(e.description || ''),
                    address:     e.location || '',
                    notes:       '',
                    materials:   [],
                    tasks:       [],
                    start:       e.start.dateTime || e.start.date,
                    end:         e.end.dateTime   || e.end.date,
                    source:      'calendar',
                }));
        } catch (calErr) {
            console.error(`Calendar fetch error for ${dateStr} (non-fatal):`, calErr.message);
        }
    }
    return [...kvJobs, ...calJobs];
}

function buildCalClient() {
    const email      = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const key        = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    const calendarId = (process.env.GOOGLE_CALENDAR_ID || '').trim();
    if (!email || !key || !calendarId) return null;
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/calendar.readonly'] });
    return google.calendar({ version: 'v3', auth });
}

function weekDates(dateStr) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    const day = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
        const dd = new Date(monday);
        dd.setUTCDate(monday.getUTCDate() + i);
        return dd.toISOString().slice(0, 10);
    });
}

async function todayJobs(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    const sessionToken = (req.headers.authorization || '').split(' ')[1] || '';
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const todayStr = todayKey();
    const jobs = await jobsForDate(todayStr, buildCalClient());
    const raw  = await kv.get(`labour:${todayStr}:${session.workerId}`);
    const log  = normalizePunches(raw);
    const totalMinutes = calcTotalMinutes(log.punches);
    return res.status(200).json({ success: true, jobs, punches: log.punches, totalMinutes, date: todayStr });
}

async function weekJobs(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    const sessionToken = (req.headers.authorization || '').split(' ')[1] || '';
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const todayStr = todayKey();
    const cal      = buildCalClient();
    const dates    = weekDates(todayStr);

    const days = await Promise.all(dates.map(async (dateStr) => {
        const jobs = await jobsForDate(dateStr, cal);
        const raw  = await kv.get(`labour:${dateStr}:${session.workerId}`);
        const log  = normalizePunches(raw);
        const totalMinutes = calcTotalMinutes(log.punches);
        return {
            date: dateStr,
            isToday: dateStr === todayStr,
            jobs,
            punches: log.punches,
            totalMinutes,
        };
    }));

    const weekTotalMinutes = days.reduce((sum, d) => sum + d.totalMinutes, 0);
    return res.status(200).json({ success: true, today: todayStr, days, weekTotalMinutes });
}

// ── Admin: daily logs ─────────────────────────────────────────────────────────

async function dailyLogs(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });
    const date  = req.query.date || todayKey();
    const index = await kv.get('workers:index') || [];
    const results = await Promise.all(index.map(async (workerId) => {
        const raw    = await kv.get(`worker:${workerId}`);
        const worker = raw ? (({ pinHash: _h, ...rest }) => rest)(raw) : null;
        const logRaw = await kv.get(`labour:${date}:${workerId}`);
        const log    = logRaw ? normalizePunches(logRaw) : null;
        const totalMinutes = log ? calcTotalMinutes(log.punches) : 0;
        return { worker, log, totalMinutes };
    }));
    return res.status(200).json({ success: true, date, workers: results.filter(r => r.worker) });
}

// ── Admin: edit log ───────────────────────────────────────────────────────────

async function editLog(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });

    const { workerId, date, field, value, jobIndex, punchIndex } = req.body || {};
    if (!workerId || !date || !field) return res.status(400).json({ error: 'workerId, date, field required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

    const VALID_FIELDS = ['punchIn', 'punchOut', 'jobClockIn', 'jobClockOut',
                          // legacy field names kept for backward compat
                          'dayClockIn', 'dayClockOut', 'lunchOut', 'lunchIn'];
    if (!VALID_FIELDS.includes(field)) return res.status(400).json({ error: 'Invalid field' });

    const key = `labour:${date}:${workerId}`;
    const raw = await kv.get(key);
    const log = normalizePunches(raw || {});
    if (!Array.isArray(log.jobs)) log.jobs = [];

    function toISO(timeStr) {
        if (!timeStr) return null;
        if (timeStr.includes('T')) return timeStr;
        if (!/^\d{2}:\d{2}$/.test(timeStr)) return null;
        const noon = new Date(`${date}T12:00:00Z`);
        const parts = new Intl.DateTimeFormat('en', { timeZone: TIMEZONE, timeZoneName: 'shortOffset' }).formatToParts(noon);
        const tzName = (parts.find(p => p.type === 'timeZoneName') || {}).value || '';
        const match = tzName.match(/GMT([+-]\d+)/);
        const offsetHours = match ? parseInt(match[1]) : -5;
        const sign = offsetHours >= 0 ? '+' : '-';
        const absH = String(Math.abs(offsetHours)).padStart(2, '0');
        const d = new Date(`${date}T${timeStr}:00${sign}${absH}:00`);
        if (isNaN(d.getTime())) return null;
        return d.toISOString();
    }

    // Punch edits
    if ((field === 'punchIn' || field === 'dayClockIn') && punchIndex != null && log.punches[punchIndex]) {
        log.punches[punchIndex].in = toISO(value);
    }
    if ((field === 'punchOut' || field === 'dayClockOut') && punchIndex != null && log.punches[punchIndex]) {
        log.punches[punchIndex].out = toISO(value);
    }
    // Legacy: if no punchIndex given, operate on punch[0]
    if (field === 'dayClockIn'  && punchIndex == null) {
        if (!log.punches[0]) log.punches[0] = { in: null, out: null };
        log.punches[0].in  = toISO(value);
    }
    if (field === 'dayClockOut' && punchIndex == null) {
        if (!log.punches[0]) log.punches[0] = { in: null, out: null };
        log.punches[0].out = toISO(value);
    }

    if (field === 'jobClockIn'  && jobIndex != null && log.jobs[jobIndex]) log.jobs[jobIndex].clockIn  = toISO(value);
    if (field === 'jobClockOut' && jobIndex != null && log.jobs[jobIndex]) log.jobs[jobIndex].clockOut = toISO(value);

    await kv.set(key, log);
    const totalMinutes = calcTotalMinutes(log.punches);
    return res.status(200).json({ success: true, log, totalMinutes });
}

// ── Admin: jobs CRUD ──────────────────────────────────────────────────────────

async function addJob(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });
    const { date, title, description, address, notes, materials, tasks } = req.body || {};
    if (!date || !title) return res.status(400).json({ error: 'date and title required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

    const id = crypto.randomBytes(8).toString('hex');
    const job = {
        id,
        title:       String(title).trim(),
        description: String(description || '').trim(),
        address:     String(address || '').trim(),
        notes:       String(notes || '').trim(),
        materials:   Array.isArray(materials) ? materials.map(String) : [],
        tasks:       Array.isArray(tasks) ? tasks.map(t => ({ label: String(t), done: false })) : [],
    };
    const jobs = await kv.get(`labour-jobs:${date}`) || [];
    jobs.push(job);
    await kv.set(`labour-jobs:${date}`, jobs);
    return res.status(201).json({ success: true, job });
}

async function removeJob(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });
    const { date, jobId } = req.body || {};
    if (!date || !jobId) return res.status(400).json({ error: 'date and jobId required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const jobs = (await kv.get(`labour-jobs:${date}`) || []).filter(j => j.id !== jobId);
    await kv.set(`labour-jobs:${date}`, jobs);
    return res.status(200).json({ success: true });
}

async function listJobs(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });
    const date = req.query.date || todayKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const jobs = await kv.get(`labour-jobs:${date}`) || [];
    return res.status(200).json({ success: true, date, jobs });
}
