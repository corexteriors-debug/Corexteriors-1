# Labour Tracking System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first labour tracking system where workers sign in with a PIN, view today's calendar jobs, clock in/out (day, job, lunch), upload completion photos, and admins see all activity in a new dashboard tab.

**Architecture:** New `api/labour.js` handles all worker auth (PIN → session token in KV), time log reads/writes, and calendar fetching for workers. A separate `api/labour-photo.js` handles photo uploads to Vercel Blob. The worker portal is a single `labour.html` page with three screens managed by JS show/hide. The admin Labour tab is appended to the existing `admin.html`. All user-provided content rendered via innerHTML is escaped through a dedicated `esc()` helper to prevent XSS.

**Tech Stack:** Vercel KV (worker accounts + time logs), Vercel Blob (photos), Google Calendar API (today's jobs via service account), vanilla JS + Canvas API (photo compression), `esc()` helper for all innerHTML rendering.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `api/labour.js` | Create | Worker PIN auth, CRUD, time log events, today's jobs, admin daily read + edit |
| `api/labour-photo.js` | Create | Upload photos to Vercel Blob, append URL to log |
| `labour.html` | Create | Mobile worker portal — PIN login, job list, job detail + time tracking, offline queue |
| `admin.html` | Modify | Add Labour tab button + tab content (worker mgmt + daily activity) |
| `package.json` | Modify | Add `@vercel/blob` dependency |

---

## KV Data Shapes (reference for all tasks)

```
workers:index                    → string[]
worker:{workerId}                → { id, name, pin, active }
worker-session:{token}           → { workerId, name }   (ex: 86400s)
labour:{YYYY-MM-DD}:{workerId}   → {
  dayClockIn:  ISO string | null,
  dayClockOut: ISO string | null,
  lunchOut:    ISO string | null,
  lunchIn:     ISO string | null,
  jobs: [{
    calendarEventId: string,
    jobTitle:        string,
    clockIn:         ISO string,
    clockOut:        ISO string | null,
    photos:          string[]
  }]
}
```

---

## Task 1: Install @vercel/blob + scaffold api/labour.js (worker accounts)

**Files:**
- Modify: `package.json`
- Create: `api/labour.js`

- [ ] **Step 1: Install @vercel/blob**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
npm install @vercel/blob
```

Expected: `@vercel/blob` appears in `package.json` dependencies.

- [ ] **Step 2: Create api/labour.js with CORS helpers and routing scaffold**

Create `api/labour.js` with this full content:

```js
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
```

- [ ] **Step 3: Add verifyPin**

Append to `api/labour.js`:

```js
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
```

- [ ] **Step 4: Add addWorker**

```js
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
```

- [ ] **Step 5: Add listWorkers + deactivateWorker**

```js
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
```

- [ ] **Step 6: Verify syntax**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
node -e "require('./api/labour.js')" 2>&1
```

Expected: No output.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
git add api/labour.js package.json package-lock.json
git commit -m "feat: add labour API scaffold with worker account CRUD and PIN auth"
```

---

## Task 2: Time log + today's jobs endpoints

**Files:**
- Modify: `api/labour.js`

- [ ] **Step 1: Add writeLog**

Append to `api/labour.js`:

```js
async function writeLog(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const { sessionToken, event, calendarEventId, jobTitle } = req.body;
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

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
        if (job) job.clockOut = ts;
    }

    await kv.set(key, log);
    return res.status(200).json({ success: true, log });
}
```

- [ ] **Step 2: Add todayJobs**

```js
// Strip any line containing a price ($ followed by digits) from descriptions
function stripPricing(text) {
    return text.split('\n').filter(line => !/\$\d/.test(line)).join('\n').trim();
}

async function todayJobs(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    const sessionToken = (req.headers.authorization || '').replace('Bearer ', '');
    const session = await verifyWorkerSession(sessionToken);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const email      = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const key        = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    const calendarId = (process.env.GOOGLE_CALENDAR_ID || '').trim();
    if (!email || !key || !calendarId) return res.status(503).json({ error: 'Calendar not configured' });

    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/calendar.readonly'] });
    const cal  = google.calendar({ version: 'v3', auth });

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const timeMin  = new Date(`${todayStr}T00:00:00`).toISOString();
    const timeMax  = new Date(`${todayStr}T23:59:59`).toISOString();

    const response = await cal.events.list({ calendarId, timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 50 });

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
```

- [ ] **Step 3: Add dailyLogs + editLog**

```js
async function dailyLogs(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });
    const date  = req.query.date || todayKey();
    const index = await kv.get('workers:index') || [];
    const results = await Promise.all(index.map(async (workerId) => ({
        worker: await kv.get(`worker:${workerId}`),
        log:    await kv.get(`labour:${date}:${workerId}`) || null
    })));
    return res.status(200).json({ success: true, date, workers: results.filter(r => r.worker) });
}

async function editLog(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!await verifyAdminToken(req)) return res.status(401).json({ error: 'Admin only' });

    const { workerId, date, field, value, jobIndex } = req.body;
    if (!workerId || !date || !field) return res.status(400).json({ error: 'workerId, date, field required' });

    const key = `labour:${date}:${workerId}`;
    let log = await kv.get(key) || { dayClockIn: null, dayClockOut: null, lunchOut: null, lunchIn: null, jobs: [] };

    function toISO(timeStr) {
        if (!timeStr) return null;
        if (timeStr.includes('T')) return timeStr;
        return new Date(`${date}T${timeStr}:00`).toISOString();
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
```

- [ ] **Step 4: Verify syntax**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
node -e "require('./api/labour.js')" 2>&1
```

Expected: No output.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
git add api/labour.js
git commit -m "feat: add time log, today-jobs, daily read, and admin edit endpoints"
```

---

## Task 3: Photo upload API

**Files:**
- Create: `api/labour-photo.js`

- [ ] **Step 1: Create api/labour-photo.js**

```js
const { kv } = require('@vercel/kv');
const { put } = require('@vercel/blob');

const TIMEZONE = 'America/Toronto';
function todayKey() { return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }); }
async function verifyWorkerSession(token) { return token ? await kv.get(`worker-session:${token}`) : null; }

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const { sessionToken, calendarEventId, jobTitle, photoData } = req.body;
        // photoData: base64 data URL, compressed client-side to ~1MB

        const session = await verifyWorkerSession(sessionToken);
        if (!session) return res.status(401).json({ error: 'Invalid session' });
        if (!calendarEventId || !photoData) return res.status(400).json({ error: 'calendarEventId and photoData required' });

        const { workerId } = session;
        const date = todayKey();
        const path = `labour/${date}/${workerId}/${calendarEventId}/${Date.now()}.jpg`;

        const base64 = photoData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');

        const blob = await put(path, buffer, { access: 'public', contentType: 'image/jpeg' });

        // Append photo URL to the job's entry in the daily log
        const logKey = `labour:${date}:${workerId}`;
        let log = await kv.get(logKey) || { dayClockIn: null, dayClockOut: null, lunchOut: null, lunchIn: null, jobs: [] };

        const job = log.jobs.find(j => j.calendarEventId === calendarEventId);
        if (job) {
            job.photos.push(blob.url);
        } else {
            // Photo uploaded without a clock-in — create a job stub
            log.jobs.push({ calendarEventId, jobTitle: jobTitle || 'Job', clockIn: new Date().toISOString(), clockOut: null, photos: [blob.url] });
        }

        await kv.set(logKey, log);
        return res.status(200).json({ success: true, url: blob.url });

    } catch (err) {
        console.error('Photo upload error:', err.message);
        return res.status(500).json({ error: err.message });
    }
};
```

- [ ] **Step 2: Verify syntax**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
node -e "require('./api/labour-photo.js')" 2>&1
```

Expected: No output.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
git add api/labour-photo.js
git commit -m "feat: add photo upload API to Vercel Blob with job log append"
```

---

## Task 4: Worker portal — labour.html

**Files:**
- Create: `labour.html`

**Security note:** All user-provided strings rendered into the DOM use the `esc()` helper defined at the top of the script block, which escapes `&`, `<`, `>`, and `"` before insertion via innerHTML template literals.

- [ ] **Step 1: Create labour.html**

Create `labour.html` with this full content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Core Exteriors — Worker Portal</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a1628; color: #fff; min-height: 100vh; }
        .screen { display: none; min-height: 100vh; flex-direction: column; }
        .screen.active { display: flex; }

        /* PIN */
        #screen-pin { align-items: center; justify-content: center; padding: 2rem 1.5rem; gap: 2rem; }
        .logo { font-size: 1.4rem; font-weight: 700; color: #4fc3f7; text-align: center; }
        .logo span { color: #fff; }
        .pin-display { display: flex; gap: .75rem; justify-content: center; }
        .pin-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #4fc3f7; background: transparent; transition: background .15s; }
        .pin-dot.filled { background: #4fc3f7; }
        .numpad { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; width: 100%; max-width: 300px; }
        .num-btn { background: #1a2a45; border: none; border-radius: 12px; color: #fff; font-size: 1.6rem; font-weight: 600; padding: 1.1rem; cursor: pointer; transition: background .1s; user-select: none; }
        .num-btn:active { background: #253a5e; }
        .num-btn.del { font-size: 1.2rem; color: #4fc3f7; }
        .num-btn.empty { background: transparent; pointer-events: none; }
        .pin-error { color: #ef5350; font-size: .9rem; text-align: center; min-height: 1.2em; }
        .pin-label { color: #aaa; font-size: .95rem; }

        /* Home */
        #screen-home { padding: 0; }
        .home-header { background: #1a2a45; padding: 1.25rem 1.25rem .75rem; }
        .worker-name { font-size: 1.1rem; font-weight: 700; }
        .worker-date { font-size: .85rem; color: #aaa; }
        .day-clock-btn { margin: 1rem 1.25rem; padding: 1rem; border: none; border-radius: 12px; font-size: 1rem; font-weight: 600; cursor: pointer; width: calc(100% - 2.5rem); }
        .btn-in   { background: #2e7d32; color: #fff; }
        .btn-out  { background: #c62828; color: #fff; }
        .btn-done { background: #333; color: #888; pointer-events: none; }
        .section-title { padding: .75rem 1.25rem .4rem; font-size: .8rem; color: #aaa; text-transform: uppercase; letter-spacing: .5px; }
        .jobs-list { padding: 0 1.25rem 6rem; display: flex; flex-direction: column; gap: .75rem; }
        .job-card { background: #1a2a45; border-radius: 12px; padding: 1rem; cursor: pointer; }
        .job-card:active { background: #253a5e; }
        .job-card-title { font-weight: 600; font-size: 1rem; margin-bottom: .3rem; }
        .job-card-time { font-size: .82rem; color: #aaa; }
        .job-card-status { font-size: .78rem; margin-top: .4rem; }
        .status-active { color: #4caf50; }
        .status-done { color: #888; }
        .sync-banner { background: #e65100; color: #fff; text-align: center; padding: .5rem; font-size: .82rem; display: none; }
        .sync-banner.visible { display: block; }

        /* Job detail */
        #screen-job { padding: 0; }
        .job-header { background: #1a2a45; padding: 1rem 1.25rem; display: flex; align-items: center; gap: .75rem; }
        .back-btn { background: none; border: none; color: #4fc3f7; font-size: 1.4rem; cursor: pointer; padding: .25rem; line-height: 1; }
        .job-header-title { font-size: 1rem; font-weight: 700; flex: 1; }
        .job-detail-body { padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
        .detail-card { background: #1a2a45; border-radius: 12px; padding: 1rem; }
        .detail-label { font-size: .75rem; color: #aaa; text-transform: uppercase; margin-bottom: .3rem; }
        .detail-value { font-size: .95rem; line-height: 1.5; }
        .action-btns { display: flex; flex-direction: column; gap: .75rem; }
        .action-btn { border: none; border-radius: 12px; padding: 1rem; font-size: 1rem; font-weight: 600; cursor: pointer; width: 100%; }
        .action-btn:active { opacity: .8; }
        .btn-green  { background: #2e7d32; color: #fff; }
        .btn-red    { background: #c62828; color: #fff; }
        .btn-orange { background: #e65100; color: #fff; }
        .btn-blue   { background: #1565c0; color: #fff; }
        .btn-grey   { background: #333; color: #888; pointer-events: none; }
        .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; margin-top: .5rem; }
        .photo-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; cursor: pointer; }

        /* Loading */
        .loading { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.6); align-items: center; justify-content: center; z-index: 999; }
        .loading.visible { display: flex; }
        .spinner { width: 40px; height: 40px; border: 3px solid #4fc3f7; border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>

<div class="loading" id="loading"><div class="spinner"></div></div>

<!-- SCREEN 1: PIN LOGIN -->
<div class="screen active" id="screen-pin">
    <div class="logo">CORE <span>EXTERIORS</span></div>
    <div class="pin-label">Enter your PIN</div>
    <div class="pin-display">
        <div class="pin-dot" id="dot0"></div>
        <div class="pin-dot" id="dot1"></div>
        <div class="pin-dot" id="dot2"></div>
        <div class="pin-dot" id="dot3"></div>
    </div>
    <div class="numpad">
        <button class="num-btn" onclick="pinPress('1')">1</button>
        <button class="num-btn" onclick="pinPress('2')">2</button>
        <button class="num-btn" onclick="pinPress('3')">3</button>
        <button class="num-btn" onclick="pinPress('4')">4</button>
        <button class="num-btn" onclick="pinPress('5')">5</button>
        <button class="num-btn" onclick="pinPress('6')">6</button>
        <button class="num-btn" onclick="pinPress('7')">7</button>
        <button class="num-btn" onclick="pinPress('8')">8</button>
        <button class="num-btn" onclick="pinPress('9')">9</button>
        <div class="num-btn empty"></div>
        <button class="num-btn" onclick="pinPress('0')">0</button>
        <button class="num-btn del" onclick="pinDel()">&#x232B;</button>
    </div>
    <div class="pin-error" id="pinError"></div>
</div>

<!-- SCREEN 2: HOME -->
<div class="screen" id="screen-home">
    <div class="sync-banner" id="syncBanner">Syncing offline events&hellip;</div>
    <div class="home-header">
        <div class="worker-name" id="workerName">Worker</div>
        <div class="worker-date" id="workerDate"></div>
    </div>
    <button class="day-clock-btn btn-in" id="dayClockBtn" onclick="toggleDayClock()">Clock In for Day</button>
    <div class="section-title">Today&rsquo;s Jobs</div>
    <div class="jobs-list" id="jobsList"></div>
</div>

<!-- SCREEN 3: JOB DETAIL -->
<div class="screen" id="screen-job">
    <div class="job-header">
        <button class="back-btn" onclick="showScreen('home')">&#x2039;</button>
        <div class="job-header-title" id="jobDetailTitle">Job</div>
    </div>
    <div class="job-detail-body">
        <div class="detail-card">
            <div class="detail-label">Description / Notes</div>
            <div class="detail-value" id="jobDetailDesc"></div>
        </div>
        <div class="detail-card">
            <div class="detail-label">Scheduled Time</div>
            <div class="detail-value" id="jobDetailTime"></div>
        </div>
        <div class="action-btns" id="jobActionBtns"></div>
        <div class="detail-card">
            <div class="detail-label">Completion Photos</div>
            <div class="photo-grid" id="photoGrid"></div>
            <button class="action-btn btn-blue" style="margin-top:.75rem" onclick="triggerPhotoUpload()">&#x1F4F7; Add Photos</button>
            <input type="file" id="photoInput" accept="image/*" multiple capture="environment" style="display:none" onchange="handlePhotoSelect(event)">
        </div>
    </div>
</div>

<script>
// ── Security: all user data rendered via innerHTML must go through esc() ───────
function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// ── State ──────────────────────────────────────────────────────────────────────
let pin = '';
let sessionToken = localStorage.getItem('labour_token') || null;
let workerName   = localStorage.getItem('labour_name')  || null;
let currentJobs  = [];
let todayLog     = null;
let currentJob   = null;

// ── Screens ───────────────────────────────────────────────────────────────────
function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + name).classList.add('active');
}
function showLoading(v) { document.getElementById('loading').classList.toggle('visible', v); }

// ── PIN input ─────────────────────────────────────────────────────────────────
function pinPress(digit) {
    if (pin.length >= 4) return;
    pin += digit;
    updateDots();
    if (pin.length === 4) submitPin();
}
function pinDel() {
    pin = pin.slice(0, -1);
    updateDots();
    document.getElementById('pinError').textContent = '';
}
function updateDots() {
    for (let i = 0; i < 4; i++) {
        document.getElementById('dot' + i).classList.toggle('filled', i < pin.length);
    }
}
async function submitPin() {
    showLoading(true);
    try {
        const r = await fetch('/api/labour?action=verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });
        const data = await r.json();
        if (data.success) {
            sessionToken = data.token;
            workerName   = data.name;
            localStorage.setItem('labour_token', sessionToken);
            localStorage.setItem('labour_name', workerName);
            await loadHome();
        } else {
            document.getElementById('pinError').textContent = 'Incorrect PIN. Try again.';
            pin = ''; updateDots();
        }
    } catch {
        document.getElementById('pinError').textContent = 'Connection error. Try again.';
        pin = ''; updateDots();
    }
    showLoading(false);
}

// ── Home screen ───────────────────────────────────────────────────────────────
async function loadHome() {
    // textContent used for user-provided name — no XSS risk
    document.getElementById('workerName').textContent = workerName || 'Worker';
    document.getElementById('workerDate').textContent = new Date().toLocaleDateString('en-CA', {
        timeZone: 'America/Toronto', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    showScreen('home');
    await syncOfflineQueue();
    await refreshJobs();
}

async function refreshJobs() {
    try {
        const r = await fetch('/api/labour?action=today-jobs', {
            headers: { 'Authorization': 'Bearer ' + sessionToken }
        });
        if (r.status === 401) { logout(); return; }
        const data = await r.json();
        currentJobs = data.jobs || [];
        todayLog    = data.log;
        renderHome();
    } catch {
        document.getElementById('jobsList').textContent = 'Could not load jobs. Check your connection.';
    }
}

function renderHome() {
    const btn = document.getElementById('dayClockBtn');
    if (todayLog?.dayClockIn && !todayLog?.dayClockOut) {
        btn.textContent = 'Clock Out for Day';
        btn.className = 'day-clock-btn btn-out';
    } else if (todayLog?.dayClockOut) {
        btn.textContent = 'Day Complete';
        btn.className = 'day-clock-btn btn-done';
    } else {
        btn.textContent = 'Clock In for Day';
        btn.className = 'day-clock-btn btn-in';
    }

    const list = document.getElementById('jobsList');
    if (!currentJobs.length) {
        list.textContent = 'No jobs scheduled for today.';
        return;
    }
    // esc() applied to all job data from server before innerHTML insertion
    list.innerHTML = currentJobs.map(job => {
        const log = todayLog?.jobs?.find(j => j.calendarEventId === job.id);
        const statusHtml = log
            ? (log.clockOut
                ? `<div class="job-card-status status-done">&#x2713; Completed</div>`
                : `<div class="job-card-status status-active">&#x25CF; In progress</div>`)
            : '';
        return `<div class="job-card" onclick="openJob('${esc(job.id)}')">
            <div class="job-card-title">${esc(job.title)}</div>
            <div class="job-card-time">${esc(fmtTime(job.start))}</div>
            ${statusHtml}
        </div>`;
    }).join('');
}

// ── Day clock ─────────────────────────────────────────────────────────────────
async function toggleDayClock() {
    const event = (todayLog?.dayClockIn && !todayLog?.dayClockOut) ? 'dayClockOut' : 'dayClockIn';
    await logEvent({ event });
    await refreshJobs();
}

// ── Job detail ────────────────────────────────────────────────────────────────
function openJob(jobId) {
    currentJob = currentJobs.find(j => j.id === jobId);
    if (!currentJob) return;
    // textContent for user data avoids innerHTML XSS
    document.getElementById('jobDetailTitle').textContent = currentJob.title;
    document.getElementById('jobDetailDesc').textContent  = currentJob.description || '—';
    document.getElementById('jobDetailTime').textContent  = fmtTime(currentJob.start) + (currentJob.end ? ' – ' + fmtTime(currentJob.end) : '');
    renderJobActions();
    renderPhotoGrid();
    showScreen('job');
}

function renderJobActions() {
    const log = todayLog?.jobs?.find(j => j.calendarEventId === currentJob.id);
    const btns = document.getElementById('jobActionBtns');
    if (!log?.clockIn) {
        btns.innerHTML = `<button class="action-btn btn-green" onclick="jobClockIn()">Clock In to Job</button>`;
    } else if (!log.clockOut) {
        const onLunch = todayLog?.lunchOut && !todayLog?.lunchIn;
        btns.innerHTML = onLunch
            ? `<button class="action-btn btn-orange" onclick="lunchEnd()">End Lunch Break</button>
               <button class="action-btn btn-red" onclick="jobClockOut()">Clock Out of Job</button>`
            : `<button class="action-btn btn-orange" onclick="lunchStart()">Start Lunch Break</button>
               <button class="action-btn btn-red" onclick="jobClockOut()">Clock Out of Job</button>`;
    } else {
        btns.innerHTML = `<button class="action-btn btn-grey">Job Complete &#x2713;</button>`;
    }
}

async function jobClockIn()  { await logEvent({ event: 'jobClockIn', calendarEventId: currentJob.id, jobTitle: currentJob.title }); await refreshJobs(); renderJobActions(); }
async function jobClockOut() { await logEvent({ event: 'jobClockOut', calendarEventId: currentJob.id }); await refreshJobs(); renderJobActions(); }
async function lunchStart()  { await logEvent({ event: 'lunchOut' }); await refreshJobs(); renderJobActions(); }
async function lunchEnd()    { await logEvent({ event: 'lunchIn' });  await refreshJobs(); renderJobActions(); }

// ── Offline queue ─────────────────────────────────────────────────────────────
async function logEvent(payload) {
    const queue = getQueue();
    queue.push({ ...payload, _ts: Date.now() });
    saveQueue(queue);
    if (!navigator.onLine) return;
    await syncOfflineQueue();
}

function getQueue()   { return JSON.parse(localStorage.getItem('labour_queue') || '[]'); }
function saveQueue(q) { localStorage.setItem('labour_queue', JSON.stringify(q)); }

async function syncOfflineQueue() {
    const queue = getQueue();
    if (!queue.length) return;
    document.getElementById('syncBanner').classList.add('visible');
    const remaining = [];
    for (const item of queue) {
        const { _ts, ...payload } = item;
        try {
            const r = await fetch('/api/labour?action=log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionToken, ...payload })
            });
            if (!r.ok) remaining.push(item);
        } catch { remaining.push(item); }
    }
    saveQueue(remaining);
    if (!remaining.length) document.getElementById('syncBanner').classList.remove('visible');
}

window.addEventListener('online', syncOfflineQueue);

// ── Photo upload ──────────────────────────────────────────────────────────────
function triggerPhotoUpload() { document.getElementById('photoInput').click(); }

async function handlePhotoSelect(event) {
    for (const file of Array.from(event.target.files)) {
        const compressed = await compressImage(file, 1024);
        await uploadPhoto(compressed);
    }
    event.target.value = '';
}

function compressImage(file, maxPx) {
    return new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = url;
    });
}

async function uploadPhoto(base64) {
    if (!currentJob) return;
    const grid = document.getElementById('photoGrid');
    const pending = document.createElement('div');
    pending.style.cssText = 'background:#1a2a45;border-radius:8px;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:1.5rem';
    pending.textContent = '\u23F3'; // hourglass
    grid.appendChild(pending);
    try {
        const r = await fetch('/api/labour-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken, calendarEventId: currentJob.id, jobTitle: currentJob.title, photoData: base64 })
        });
        const data = await r.json();
        if (data.success) {
            const img = document.createElement('img');
            img.className = 'photo-thumb';
            img.src = data.url;
            img.addEventListener('click', () => window.open(data.url, '_blank'));
            pending.replaceWith(img);
            await refreshJobs();
        } else {
            pending.textContent = '\u2717';
        }
    } catch { pending.textContent = '\u2717'; }
}

function renderPhotoGrid() {
    const log    = todayLog?.jobs?.find(j => j.calendarEventId === currentJob?.id);
    const grid   = document.getElementById('photoGrid');
    const photos = log?.photos || [];
    // Build photo elements via DOM to avoid innerHTML with URLs
    grid.innerHTML = '';
    photos.forEach(url => {
        const img = document.createElement('img');
        img.className = 'photo-thumb';
        img.src = url;
        img.addEventListener('click', () => window.open(url, '_blank'));
        grid.appendChild(img);
    });
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtTime(iso) {
    if (!iso) return '\u2014';
    return new Date(iso).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit', hour12: true });
}

function logout() {
    localStorage.removeItem('labour_token');
    localStorage.removeItem('labour_name');
    sessionToken = null; workerName = null; pin = '';
    updateDots();
    showScreen('pin');
}

// Auto-login if session token already stored
(async () => {
    if (sessionToken && workerName) {
        showLoading(true);
        try { await loadHome(); } catch { logout(); }
        showLoading(false);
    }
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Open labour.html in a browser and verify PIN screen renders with no console errors**

Open `labour.html` directly in Chrome. Open DevTools console. Expected: PIN screen visible, no errors.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
git add labour.html
git commit -m "feat: add mobile worker portal with PIN login, job list, job detail, offline queue, and photo upload"
```

---

## Task 5: Admin Labour tab — worker management + daily activity

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Add Labour tab button**

Find in `admin.html` (~line 941):
```html
                <button class="tab-btn" data-tab="materials">🧮 Materials</button>
            </div>
```

Change to:
```html
                <button class="tab-btn" data-tab="materials">🧮 Materials</button>
                <button class="tab-btn" data-tab="labour">👷 Labour</button>
            </div>
```

- [ ] **Step 2: Add Labour tab content**

Find in `admin.html` the closing tags after the materials tab content (~line 1197):
```html
            </div>
        </div>
    </div>
```

Insert the Labour tab HTML immediately **before** those three closing tags:

```html
            <!-- ========== TAB: LABOUR ========== -->
            <div class="tab-content" id="tab-labour">

                <!-- Worker Management -->
                <div class="table-card" style="margin-bottom:1.5rem">
                    <div class="table-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem">
                        <h2>&#x1F477; Workers</h2>
                        <button onclick="showAddWorkerForm()" style="padding:.5rem 1rem;background:#1565c0;border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:.85rem">+ Add Worker</button>
                    </div>
                    <div id="addWorkerForm" style="display:none;padding:1rem;border-top:1px solid rgba(255,255,255,.1)">
                        <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end">
                            <div>
                                <label style="font-size:.8rem;color:#aaa;display:block;margin-bottom:.3rem">Name</label>
                                <input id="newWorkerName" placeholder="Worker name" style="background:#0a1628;border:1px solid #333;border-radius:8px;padding:.5rem .75rem;color:#fff;font-size:.9rem">
                            </div>
                            <div>
                                <label style="font-size:.8rem;color:#aaa;display:block;margin-bottom:.3rem">4-Digit PIN</label>
                                <input id="newWorkerPin" placeholder="e.g. 5291" maxlength="4" style="background:#0a1628;border:1px solid #333;border-radius:8px;padding:.5rem .75rem;color:#fff;font-size:.9rem;width:110px">
                            </div>
                            <button onclick="saveNewWorker()" style="background:#2e7d32;border:none;border-radius:8px;padding:.5rem 1rem;color:#fff;cursor:pointer;font-size:.9rem">Save</button>
                            <button onclick="document.getElementById('addWorkerForm').style.display='none'" style="background:#333;border:none;border-radius:8px;padding:.5rem 1rem;color:#aaa;cursor:pointer;font-size:.9rem">Cancel</button>
                        </div>
                        <div id="addWorkerMsg" style="margin-top:.5rem;font-size:.85rem"></div>
                    </div>
                    <div class="table-scroll">
                        <table id="workersTable">
                            <thead><tr><th>Name</th><th>PIN</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody id="workersBody">
                                <tr><td colspan="4" style="color:#888;text-align:center;padding:1.5rem">Open this tab to load workers</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Daily Activity -->
                <div class="table-card">
                    <div class="table-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem">
                        <h2>&#x1F4CB; Daily Activity</h2>
                        <div style="display:flex;gap:.5rem;align-items:center">
                            <input type="date" id="labourDatePicker" style="background:#0a1628;border:1px solid #333;border-radius:8px;padding:.4rem .75rem;color:#fff;font-size:.85rem">
                            <button onclick="loadDailyLogs()" style="background:#1565c0;border:none;border-radius:8px;padding:.4rem .75rem;color:#fff;cursor:pointer;font-size:.85rem">Load</button>
                        </div>
                    </div>
                    <div id="dailyLogsContainer" style="padding:.75rem">
                        <p style="color:#888;text-align:center;padding:1.5rem">Select a date and click Load</p>
                    </div>
                </div>

            </div>
```

- [ ] **Step 3: Add auto-load trigger**

Find (~line 2887):
```js
        document.querySelector('[data-tab="calendar"]').addEventListener('click', loadCalendarEvents);
```

Add immediately after:
```js
        document.querySelector('[data-tab="labour"]').addEventListener('click', () => { loadWorkers(); loadDailyLogs(); });
```

- [ ] **Step 4: Add Labour JS — worker management functions**

Find the closing `</script>` tag near the end of `admin.html`. Add all the following functions before it:

```js
// ══ LABOUR TAB ════════════════════════════════════════════════════════════════

// Security: all worker/job names rendered via innerHTML use labEsc() to prevent XSS
function labEsc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

function showAddWorkerForm() {
    document.getElementById('addWorkerForm').style.display = 'block';
    document.getElementById('newWorkerName').focus();
}

async function loadWorkers() {
    const token = localStorage.getItem('admin_token') || '';
    try {
        const r = await fetch('/api/labour?action=list-workers', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await r.json();
        if (data.success) renderWorkersTable(data.workers);
    } catch(e) { console.error('loadWorkers:', e); }
}

function renderWorkersTable(workers) {
    const tbody = document.getElementById('workersBody');
    if (!workers.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:#888;text-align:center;padding:1.5rem">No workers yet</td></tr>';
        return;
    }
    // labEsc() applied to all worker.name values before innerHTML insertion
    tbody.innerHTML = workers.map(w => `
        <tr>
            <td>${labEsc(w.name)}</td>
            <td style="letter-spacing:.15em;color:#aaa">&#x2022;&#x2022;&#x2022;&#x2022;</td>
            <td><span style="color:${w.active ? '#4caf50' : '#888'}">${w.active ? '&#x25CF; Active' : '&#x25CB; Inactive'}</span></td>
            <td>${w.active ? `<button onclick="deactivateWorker('${labEsc(w.id)}')" style="background:#c62828;border:none;border-radius:6px;padding:.3rem .7rem;color:#fff;cursor:pointer;font-size:.8rem">Deactivate</button>` : '&mdash;'}</td>
        </tr>`).join('');
}

async function saveNewWorker() {
    const name = document.getElementById('newWorkerName').value.trim();
    const pin  = document.getElementById('newWorkerPin').value.trim();
    const msg  = document.getElementById('addWorkerMsg');
    if (!name || !pin) { msg.style.color='#ef5350'; msg.textContent='Name and PIN are required.'; return; }
    if (!/^\d{4}$/.test(pin)) { msg.style.color='#ef5350'; msg.textContent='PIN must be exactly 4 digits.'; return; }
    const token = localStorage.getItem('admin_token') || '';
    try {
        const r = await fetch('/api/labour?action=add-worker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ name, pin })
        });
        const data = await r.json();
        if (data.success) {
            msg.style.color = '#4caf50';
            // textContent used here — name is a local variable, not rendered via innerHTML
            msg.textContent = 'Worker added: ' + name + ' (PIN ' + pin + ')';
            document.getElementById('newWorkerName').value = '';
            document.getElementById('newWorkerPin').value  = '';
            await loadWorkers();
        } else {
            msg.style.color = '#ef5350';
            msg.textContent = data.error || 'Failed to add worker.';
        }
    } catch { msg.style.color='#ef5350'; msg.textContent='Connection error.'; }
}

async function deactivateWorker(workerId) {
    if (!confirm('Deactivate this worker? They will no longer be able to log in.')) return;
    const token = localStorage.getItem('admin_token') || '';
    try {
        await fetch('/api/labour?action=deactivate-worker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ workerId })
        });
        await loadWorkers();
    } catch(e) { console.error(e); }
}
```

- [ ] **Step 5: Add Labour JS — daily activity functions**

Continue appending (still before `</script>`):

```js
// Set date picker to today when page loads
document.addEventListener('DOMContentLoaded', () => {
    const dp = document.getElementById('labourDatePicker');
    if (dp) dp.value = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
});

async function loadDailyLogs() {
    const date  = document.getElementById('labourDatePicker').value;
    const token = localStorage.getItem('admin_token') || '';
    const container = document.getElementById('dailyLogsContainer');
    container.textContent = 'Loading\u2026';
    try {
        const r = await fetch('/api/labour?action=daily&date=' + date, { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await r.json();
        if (!data.success) { container.textContent = 'Error loading logs.'; return; }
        renderDailyLogs(data.workers, date);
    } catch { container.textContent = 'Connection error.'; }
}

function renderDailyLogs(workers, date) {
    const container = document.getElementById('dailyLogsContainer');
    if (!workers.length) { container.textContent = 'No workers found.'; return; }

    // Build HTML with labEsc() on all worker/job name strings
    container.innerHTML = workers.map(({ worker, log }) => {
        if (!worker) return '';
        const statusLabel = !log ? '\u26AB Not started'
            : (log.lunchOut && !log.lunchIn) ? '\uD83D\uDFE1 On lunch'
            : (log.dayClockIn && !log.dayClockOut) ? '\uD83D\uDFE2 Clocked in'
            : log.dayClockOut ? '\u2713 Done' : '\u26AB Not started';
        const totalHours = calcTotalHours(log);

        return `<div style="background:#1a2a45;border-radius:12px;margin-bottom:1rem;overflow:hidden">
            <div style="padding:1rem;display:flex;justify-content:space-between;align-items:center;cursor:pointer"
                 onclick="toggleLabourRow('lrow-${labEsc(worker.id)}')">
                <div>
                    <div style="font-weight:700">${labEsc(worker.name)}</div>
                    <div style="font-size:.8rem;color:#aaa;margin-top:.2rem">${statusLabel}</div>
                </div>
                <div style="text-align:right;font-size:.85rem;color:#aaa">${totalHours ? totalHours + ' hrs' : '&mdash;'}</div>
            </div>
            <div id="lrow-${labEsc(worker.id)}" style="display:none;border-top:1px solid rgba(255,255,255,.07);padding:1rem">
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem;margin-bottom:1rem">
                    ${labTimeField('Day In',    log?.dayClockIn,  worker.id, date, 'dayClockIn',  null)}
                    ${labTimeField('Day Out',   log?.dayClockOut, worker.id, date, 'dayClockOut', null)}
                    ${labTimeField('Lunch Out', log?.lunchOut,    worker.id, date, 'lunchOut',    null)}
                    ${labTimeField('Lunch In',  log?.lunchIn,     worker.id, date, 'lunchIn',     null)}
                </div>
                ${(log?.jobs || []).map((job, i) => `
                    <div style="background:#0f1e35;border-radius:8px;padding:.75rem;margin-bottom:.75rem">
                        <div style="font-weight:600;margin-bottom:.5rem">${labEsc(job.jobTitle)}</div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem;margin-bottom:.75rem">
                            ${labTimeField('Job In',  job.clockIn,  worker.id, date, 'jobClockIn',  i)}
                            ${labTimeField('Job Out', job.clockOut, worker.id, date, 'jobClockOut', i)}
                        </div>
                        ${job.photos?.length
                            ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">
                                ${job.photos.map(url => `<img src="${labEsc(url)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer" onclick="window.open(this.src,'_blank')">`).join('')}
                               </div>`
                            : '<div style="font-size:.8rem;color:#555">No photos</div>'}
                    </div>`).join('')}
            </div>
        </div>`;
    }).join('');
}

function toggleLabourRow(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function labTimeField(label, isoValue, workerId, date, field, jobIndex) {
    const val = isoValue
        ? new Date(isoValue).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hour12: false })
        : '';
    const jiAttr = jobIndex != null ? `data-jobindex="${jobIndex}"` : '';
    return `<div>
        <div style="font-size:.72rem;color:#aaa;margin-bottom:.25rem">${label}</div>
        <input type="time" value="${labEsc(val)}"
            data-worker="${labEsc(workerId)}" data-date="${labEsc(date)}" data-field="${labEsc(field)}" ${jiAttr}
            onchange="adminEditTime(this)"
            style="background:#0a1628;border:1px solid #333;border-radius:6px;padding:.35rem .5rem;color:#fff;font-size:.85rem;width:100%">
    </div>`;
}

async function adminEditTime(input) {
    const token    = localStorage.getItem('admin_token') || '';
    const workerId = input.dataset.worker;
    const date     = input.dataset.date;
    const field    = input.dataset.field;
    const jobIndex = input.dataset.jobindex !== undefined ? parseInt(input.dataset.jobindex) : undefined;
    const value    = input.value;
    try {
        const r = await fetch('/api/labour?action=edit-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ workerId, date, field, value, jobIndex })
        });
        const data = await r.json();
        input.style.borderColor = data.success ? '#4caf50' : '#ef5350';
        setTimeout(() => { input.style.borderColor = '#333'; }, 1500);
    } catch { input.style.borderColor = '#ef5350'; }
}

function calcTotalHours(log) {
    if (!log?.dayClockIn || !log?.dayClockOut) return null;
    let ms = new Date(log.dayClockOut) - new Date(log.dayClockIn);
    if (log.lunchOut && log.lunchIn) ms -= (new Date(log.lunchIn) - new Date(log.lunchOut));
    return (ms / 3600000).toFixed(1);
}
```

- [ ] **Step 6: Verify script tag balance**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
node -e "
const fs = require('fs');
const html = fs.readFileSync('admin.html','utf8');
const open  = (html.match(/<script/gi)  || []).length;
const close = (html.match(/<\/script>/gi) || []).length;
console.log('script open:', open, '| script close:', close, open === close ? '(OK)' : '(MISMATCH - fix before committing)');
" 2>&1
```

Expected: `script open: 1 | script close: 1 (OK)`

- [ ] **Step 7: Commit and push**

```bash
cd C:/Users/Mirkomil/Documents/corexteriors
git add admin.html
git commit -m "feat: add Labour tab to admin with worker management and daily activity panels"
git push origin main
```

---

## Task 6: Vercel environment variable + end-to-end smoke test

**No code changes — Vercel dashboard + browser testing only.**

- [ ] **Step 1: Add BLOB_READ_WRITE_TOKEN in Vercel**

1. Go to vercel.com → team "Core Exterior's projects" → project `corexteriors-main`
2. Storage tab → Create a Blob store (if none exists) → copy `BLOB_READ_WRITE_TOKEN`
3. Settings → Environment Variables → Add:
   - Name: `BLOB_READ_WRITE_TOKEN`
   - Value: (paste token)
   - Environments: Production + Preview + Development
4. Save → Redeploy (or push a commit to trigger deploy)

- [ ] **Step 2: Wait for deployment to be Ready**

Check Vercel dashboard → Deployments → latest should show "Ready" green badge.

- [ ] **Step 3: Add a test worker from admin**

1. Log in to `corexteriors.ca/admin` as admin
2. Click Labour tab → Workers panel → Add Worker
3. Enter name: "Test Worker", PIN: "1234" → Save
4. Verify the worker appears in the table as Active

- [ ] **Step 4: Smoke test worker login**

```
Open: https://corexteriors.ca/labour
Enter PIN: 1 2 3 4
Expected: Home screen shows "Test Worker" and today's date
Expected: Today's jobs list appears (from calendar)
```

- [ ] **Step 5: Smoke test day clock + job clock**

```
Tap "Clock In for Day"
Expected: Button turns red → "Clock Out for Day"

Tap a job card
Expected: Job detail screen with address, description (no prices), time

Tap "Clock In to Job"
Expected: Lunch + Clock Out buttons appear

Tap back arrow → job card shows "● In progress"
```

- [ ] **Step 6: Smoke test photo upload**

```
Open a job detail screen
Tap "Add Photos" → select 1 photo from camera roll
Expected: Hourglass thumbnail → replaced by photo thumbnail

Go to admin → Labour tab → Daily Activity → Load (today's date)
Tap the worker row to expand
Expected: Job row shows the photo thumbnail
Click thumbnail → photo opens full size in new tab
```

- [ ] **Step 7: Smoke test admin time edit**

```
In admin daily activity, tap the "Day In" time field for the test worker
Change the time by 1 minute
Expected: Field border flashes green briefly → time saved
Reload the page and re-open the Labour tab → verify edited time persists
```

- [ ] **Step 8: Deactivate test worker**

```
Admin → Labour tab → Workers → click Deactivate on "Test Worker"
Open corexteriors.ca/labour → enter PIN 1234
Expected: "Incorrect PIN. Try again." error
```
