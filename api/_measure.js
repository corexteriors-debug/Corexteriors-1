// "Measure from address" job queue for the sales portal.
//
// The portal queues a job (address + services) and starts the cloud worker (a GitHub Actions run in
// core-exteriors-agents, .github/workflows/measure.yml). Luke's Mac watcher also polls the queue when
// it is on. Whichever worker claims the job measures the property from the aerial photo and Street
// View, prices the Good/Better/Best options, and posts the result back here.
// The portal polls the job and shows the numbers + photos to check before filling the estimate.
//
// Lives inside api/leads.js (?action=measure…) because the Hobby plan caps us at 12 functions.
// Pure: the caller passes kv and the auth result, so this can be tested without Vercel.

const JOB_TTL = 7 * 24 * 3600; // seconds
const QUEUE = 'measure_queue';
const SERVICES = ['gutter', 'window', 'siding', 'deck', 'interlock'];
const MAX_PHOTO_CHARS = 450000; // per photo (data URL); KV values must stay well under 1 MB

function newId() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const DISPATCH_CAP_PER_HOUR = 20;

// Starts one cloud worker run. Needs GITHUB_DISPATCH_TOKEN (fine-grained, Actions: write on the
// agents repo). Without it, jobs wait for the Mac. Never throws.
async function startCloudWorker(kv) {
    const token = (process.env.GITHUB_DISPATCH_TOKEN || '').trim();
    if (!token) return 'off';
    try {
        const hourKey = `measure_dispatch:${new Date().toISOString().slice(0, 13)}`;
        const used = Number(await kv.get(hourKey)) || 0;
        if (used >= DISPATCH_CAP_PER_HOUR) return 'capped';
        await kv.set(hourKey, used + 1, { ex: 3600 });
        const repo = process.env.MEASURE_WORKFLOW_REPO || 'corexteriors-debug/core-exteriors-agents';
        const ref = process.env.MEASURE_WORKFLOW_REF || 'main';
        const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/measure.yml/dispatches`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'corexteriors-portal',
            },
            body: JSON.stringify({ ref }),
        });
        return r.status === 204 ? 'started' : `HTTP ${r.status}`;
    } catch (err) {
        return 'error: ' + String(err.message || err).slice(0, 100);
    }
}

function isWorker(req) {
    const secret = (process.env.MEASURE_WORKER_SECRET || '').trim();
    const auth = req.headers.authorization || '';
    return Boolean(secret) && secret.length >= 24 && auth === `Bearer ${secret}`;
}

// Returns true when it handled the request.
async function handleMeasure(req, res, { kv, tokenData, worker }) {
    const action = req.query.action;

    // ---- Portal (signed-in sales rep or admin) --------------------------------
    if (action === 'measure' && req.method === 'POST') {
        if (!tokenData) return res.status(401).json({ error: 'Unauthorized' }), true;
        const address = String(req.body?.address || '').trim().slice(0, 200);
        const services = (Array.isArray(req.body?.services) ? req.body.services : []).filter(s => SERVICES.includes(s));
        if (address.length < 6) return res.status(400).json({ error: 'Enter the property address first.' }), true;
        if (!services.length) return res.status(400).json({ error: 'Tick at least one service to measure (gutters, windows, siding, deck, or interlock).' }), true;
        const job = {
            id: newId(), address, services, status: 'queued',
            rep: tokenData.repName || tokenData.role || '', createdAt: new Date().toISOString(),
        };
        await kv.set(`measure:${job.id}`, job, { ex: JOB_TTL });
        await kv.rpush(QUEUE, job.id);
        job.cloud = await startCloudWorker(kv);
        if (job.cloud !== 'started') console.warn('Measure cloud worker not started:', job.cloud);
        await kv.set(`measure:${job.id}`, job, { ex: JOB_TTL });
        return res.status(201).json({ success: true, job }), true;
    }
    if (action === 'measure' && req.method === 'GET') {
        if (!tokenData) return res.status(401).json({ error: 'Unauthorized' }), true;
        const job = await kv.get(`measure:${String(req.query.id || '')}`);
        if (!job) return res.status(404).json({ error: 'Measure job not found (they expire after 7 days).' }), true;
        return res.status(200).json({ success: true, job }), true;
    }

    // ---- Worker (Luke's Mac) --------------------------------------------------
    if (action === 'measure-next' && req.method === 'GET') {
        if (!worker) return res.status(401).json({ error: 'Unauthorized' }), true;
        for (let i = 0; i < 20; i++) {
            const id = await kv.lpop(QUEUE);
            if (!id) break;
            const job = await kv.get(`measure:${id}`);
            if (!job || job.status !== 'queued') continue;
            job.status = 'measuring';
            job.startedAt = new Date().toISOString();
            await kv.set(`measure:${id}`, job, { ex: JOB_TTL });
            return res.status(200).json({ success: true, job }), true;
        }
        return res.status(200).json({ success: true, job: null }), true;
    }
    if (action === 'measure-result' && req.method === 'POST') {
        if (!worker) return res.status(401).json({ error: 'Unauthorized' }), true;
        const id = String(req.body?.id || '');
        const job = await kv.get(`measure:${id}`);
        if (!job) return res.status(404).json({ error: 'Measure job not found.' }), true;
        const photos = {};
        for (const [k, v] of Object.entries(req.body?.photos || {})) {
            if (!['aerial1', 'aerial2', 'street'].includes(k)) continue;
            if (typeof v === 'string' && v.length <= MAX_PHOTO_CHARS && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(v)) photos[k] = v;
        }
        Object.assign(job, {
            status: req.body?.status === 'done' ? 'done' : 'failed',
            result: req.body?.result || null,
            error: req.body?.error ? String(req.body.error).slice(0, 500) : null,
            photos,
            finishedAt: new Date().toISOString(),
        });
        await kv.set(`measure:${id}`, job, { ex: JOB_TTL });
        return res.status(200).json({ success: true }), true;
    }
    return false;
}

module.exports = { handleMeasure, isWorker, SERVICES };
