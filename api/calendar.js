const { google } = require('googleapis');
const { kv } = require('@vercel/kv');

const TIMEZONE = 'America/Toronto';

function getCalendarClient() {
    const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    if (!email || !key) return null;

    const auth = new google.auth.JWT({
        email,
        key,
        scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    return google.calendar({ version: 'v3', auth });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://corexteriors.ca');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Auth check
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    const tokenData = await kv.get(`token:${token}`);
    if (!tokenData) return res.status(401).json({ error: 'Invalid token' });

    const calendarId = (process.env.GOOGLE_CALENDAR_ID || '').trim();
    const cal = getCalendarClient();

    if (!cal || !calendarId) {
        return res.status(503).json({ error: 'Google Calendar not configured' });
    }

    try {
        // ── GET: list events ─────────────────────────────────────────────────
        if (req.method === 'GET') {
            const now = new Date();
            const timeMin = req.query.start
                ? new Date(req.query.start).toISOString()
                : now.toISOString();
            const timeMax = req.query.end
                ? new Date(req.query.end).toISOString()
                : new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days

            const response = await cal.events.list({
                calendarId,
                timeMin,
                timeMax,
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 100,
            });

            const events = (response.data.items || []).map(e => ({
                id: e.id,
                title: e.summary || '',
                description: e.description || '',
                start: e.start.dateTime || e.start.date,
                end: e.end.dateTime || e.end.date,
                allDay: !e.start.dateTime,
                type: e.extendedProperties?.private?.eventType || 'other',
                leadId: e.extendedProperties?.private?.leadId || '',
                repName: e.extendedProperties?.private?.repName || '',
            }));

            return res.status(200).json({ success: true, events });
        }

        // ── POST: create event ───────────────────────────────────────────────
        if (req.method === 'POST') {
            const {
                title, description, date, startTime, endTime,
                allDay, repName, leadId, eventType,
            } = req.body;

            if (!title || !date) {
                return res.status(400).json({ error: 'title and date are required' });
            }

            let startObj, endObj;
            if (allDay) {
                startObj = { date };
                // end date is exclusive in Google Calendar all-day events
                const endDate = new Date(date);
                endDate.setDate(endDate.getDate() + 1);
                endObj = { date: endDate.toISOString().split('T')[0] };
            } else {
                const st = startTime || '09:00';
                const et = endTime || '10:00';
                startObj = { dateTime: `${date}T${st}:00`, timeZone: TIMEZONE };
                endObj   = { dateTime: `${date}T${et}:00`, timeZone: TIMEZONE };
            }

            // Color coding by event type
            // Google Calendar colorId: 1=Lavender,2=Sage,3=Grape,4=Flamingo,5=Banana,
            //   6=Tangerine,7=Peacock(blue),8=Graphite,9=Blueberry,10=Basil,11=Tomato
            const colorMap = {
                sales_visit: '7',   // Peacock (blue) — rep going to sell
                job: '10',          // Basil (green) — work being done
                unavailable: '8',   // Graphite — blocked off
                available: '2',     // Sage (light green) — rep available
            };

            const event = await cal.events.insert({
                calendarId,
                resource: {
                    summary: title,
                    description: description || '',
                    start: startObj,
                    end: endObj,
                    colorId: colorMap[eventType] || '7',
                    extendedProperties: {
                        private: {
                            eventType: eventType || 'other',
                            leadId: leadId || '',
                            repName: repName || '',
                        },
                    },
                },
            });

            // If tied to a lead, save the event ID on it
            if (leadId) {
                try {
                    const lead = await kv.get(`lead:${leadId}`);
                    if (lead) {
                        if (eventType === 'job') lead.jobEventId = event.data.id;
                        else lead.calendarEventId = event.data.id;
                        lead.updatedAt = new Date().toISOString();
                        if (eventType === 'job') lead.status = 'Scheduled';
                        await kv.set(`lead:${leadId}`, lead);
                    }
                } catch (_) {}
            }

            return res.status(201).json({
                success: true,
                eventId: event.data.id,
                eventLink: event.data.htmlLink,
            });
        }

        // ── DELETE: remove event ─────────────────────────────────────────────
        if (req.method === 'DELETE') {
            const { eventId, leadId } = req.body;
            if (!eventId) return res.status(400).json({ error: 'eventId required' });

            await cal.events.delete({ calendarId, eventId });

            // Clear from lead if provided
            if (leadId) {
                try {
                    const lead = await kv.get(`lead:${leadId}`);
                    if (lead) {
                        if (lead.jobEventId === eventId) delete lead.jobEventId;
                        if (lead.calendarEventId === eventId) delete lead.calendarEventId;
                        lead.updatedAt = new Date().toISOString();
                        await kv.set(`lead:${leadId}`, lead);
                    }
                } catch (_) {}
            }

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        console.error('Calendar API error:', err.message);
        return res.status(500).json({ error: err.message || 'Calendar error' });
    }
};
