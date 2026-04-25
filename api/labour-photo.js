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
        const { sessionToken, calendarEventId, jobTitle, photoData } = req.body || {};
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
