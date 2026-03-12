const { kv } = require('@vercel/kv');
const { google } = require('googleapis');

function getCalendarClient() {
    const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    if (!email || !key) return null;
    const auth = new google.auth.JWT({
        email, key,
        scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    return google.calendar({ version: 'v3', auth });
}

const TIMEZONE = 'America/Toronto';

async function createJobEvent(lead) {
    const calendarId = (process.env.GOOGLE_CALENDAR_ID || '').trim();
    const cal = getCalendarClient();
    if (!cal || !calendarId) return null;

    // Accept date from admin entry (saleDate), sales portal survey (datetime-local), or fall back to today
    const visitDateRaw = lead.survey?.visitDate || '';
    const visitDatePart = visitDateRaw.includes('T') ? visitDateRaw.split('T')[0] : visitDateRaw;
    const visitTimePart = visitDateRaw.includes('T') ? visitDateRaw.split('T')[1]?.slice(0, 5) : '';
    const date = lead.saleDate || visitDatePart
        || new Date(lead.createdAt || Date.now()).toISOString().split('T')[0];

    const startTime = lead.saleTime || visitTimePart || lead.survey?.visitTime || '09:00';
    const [hh, mm] = startTime.split(':').map(Number);
    const startMs = (hh * 60 + (mm || 0)) * 60000;
    const endMs = startMs + 3 * 3600000;
    const endHour = String(Math.floor(endMs / 3600000) % 24).padStart(2, '0');
    const endMin  = String(Math.floor((endMs % 3600000) / 60000)).padStart(2, '0');
    const endTime = `${endHour}:${endMin}`;

    const lines = [
        `📋 ESTIMATE #: ${lead.estimateNumber || '—'}`,
        ``,
        `👤 CLIENT`,
        `Name:    ${lead.clientName}`,
        `Phone:   ${lead.phone || '—'}`,
        `Email:   ${lead.email || '—'}`,
        `Address: ${lead.address || '—'}`,
        ``,
        `🛠️ SERVICES`,
        `${lead.serviceType || '—'}`,
        ...(lead.services && lead.services.length
            ? lead.services.map(s => `  • ${s.name}${s.price ? ' — ' + s.price : ''}`)
            : []),
        ``,
        `💰 PRICING`,
        `Subtotal: ${lead.subtotal || '—'}`,
        ...(lead.discount ? [`Discount: -$${lead.discount}`] : []),
        `HST (13%): ${lead.hst || '—'}`,
        `Total:    ${lead.total || '—'}`,
        ``,
        `💳 PAYMENT`,
        `Status:  ${lead.paymentStatus || 'Unpaid'}`,
        ...(lead.paymentMethod ? [`Method:  ${lead.paymentMethod}`] : []),
        ...(lead.paymentAmount ? [`Amount:  $${parseFloat(lead.paymentAmount).toFixed(2)}`] : []),
        ``,
        `👷 SALES REP: ${lead.salesRep || '—'}`,
        ...(lead.notes ? [``, `📝 NOTES`, lead.notes] : []),
        ``,
        `─────────────────────`,
        `Core Exteriors | corexteriors.ca | 519-712-1431`,
    ];

    try {
        const event = await cal.events.insert({
            calendarId,
            resource: {
                summary: `🟢 Job — ${lead.clientName} | ${lead.serviceType || 'Service'}`,
                description: lines.join('\n'),
                start: { dateTime: `${date}T${startTime}:00`, timeZone: TIMEZONE },
                end:   { dateTime: `${date}T${endTime}:00`,   timeZone: TIMEZONE },
                colorId: '10', // Basil (green) — job
                extendedProperties: {
                    private: { eventType: 'job', leadId: lead.id, repName: lead.salesRep || '' },
                },
            },
        });
        return event.data.id;
    } catch (err) {
        console.error('Auto calendar job event error:', err.message);
        return null;
    }
}

module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Verify token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const tokenData = await kv.get(`token:${token}`);

    if (!tokenData) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        // POST - Create a new lead (sales or admin)
        if (req.method === 'POST') {
            if (!req.body.clientName || !req.body.phone) {
                return res.status(400).json({ error: 'Client name and phone are required' });
            }

            // Accept all fields from the estimate form
            const body = req.body;

            const lead = {
                id: `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                clientName: body.clientName || '',
                phone: body.phone || '',
                email: body.email || '',
                address: body.address || '',
                serviceType: body.serviceType || '',
                estimatedValue: body.estimatedValue || '',
                notes: body.notes || '',
                salesRep: body.salesRep || '',
                estimateNumber: body.estimateNumber || '',
                services: body.services || [],
                bundleDiscount: body.bundleDiscount || 0,
                discount: body.discount || 0,
                subtotal: body.subtotal || '',
                hst: body.hst || '',
                total: body.total || '',
                saleDate: body.saleDate || '',
                saleTime: body.saleTime || '',
                paymentStatus: body.paymentStatus || 'Unpaid',
                paymentMethod: body.paymentMethod || '',
                paymentAmount: parseFloat(body.paymentAmount) || 0,
                survey: body.survey || {},
                legal: body.legal || {},
                hasSignature: body.hasSignature || false,
                createdByAdmin: body.createdByAdmin || false,
                status: body.status || 'New',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Store lead in Redis
            await kv.set(`lead:${lead.id}`, lead);

            // Add to lead index
            const leadIds = (await kv.get('lead_ids')) || [];
            leadIds.unshift(lead.id);
            await kv.set('lead_ids', leadIds);

            // Auto-create Google Calendar job event (3 hrs, non-blocking)
            createJobEvent(lead).then(eventId => {
                if (eventId) {
                    lead.jobEventId = eventId;
                    kv.set(`lead:${lead.id}`, lead).catch(() => {});
                }
            }).catch(() => {});

            // Push to Google Sheet (non blocking)
            const sheetWebhook = process.env.GOOGLE_SHEET_WEBHOOK;
            if (sheetWebhook) {
                try {
                    await fetch(sheetWebhook, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            date: lead.createdAt,
                            name: lead.clientName,
                            address: lead.address,
                            phone: lead.phone,
                            email: lead.email,
                            amount: lead.total || ('$' + lead.estimatedValue),
                            services: lead.serviceType,
                            salesRep: lead.salesRep,
                            estimateNumber: lead.estimateNumber,
                            notes: lead.notes
                        })
                    });
                } catch (sheetErr) {
                    console.error('Google Sheet error:', sheetErr);
                }
            }

            return res.status(201).json({ success: true, lead });
        }

        // GET - Retrieve all leads (admin only)
        if (req.method === 'GET') {
            if (tokenData.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }

            const leadIds = (await kv.get('lead_ids')) || [];
            const leads = [];

            for (const id of leadIds) {
                const lead = await kv.get(`lead:${id}`);
                if (lead) {
                    leads.push(lead);
                }
            }

            return res.status(200).json({ success: true, leads });
        }

        // PATCH - Update lead fields (admin only)
        if (req.method === 'PATCH') {
            if (tokenData.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }

            const { id, status, paymentStatus, paymentMethod, paymentAmount, clientName, phone, email, address, notes } = req.body;

            if (!id) {
                return res.status(400).json({ error: 'Lead ID is required' });
            }

            const lead = await kv.get(`lead:${id}`);
            if (!lead) {
                return res.status(404).json({ error: 'Lead not found' });
            }

            if (status) {
                const validStatuses = ['New', 'Contacted', 'Quoted', 'Closed', 'Lost'];
                if (!validStatuses.includes(status)) {
                    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
                }
                lead.status = status;
            }

            if (paymentStatus !== undefined) {
                const validPay = ['Unpaid', 'Deposit', 'Paid'];
                if (!validPay.includes(paymentStatus)) {
                    return res.status(400).json({ error: `Invalid payment status` });
                }
                lead.paymentStatus = paymentStatus;
                lead.paymentMethod = paymentMethod || '';
                if (paymentAmount !== undefined) lead.paymentAmount = parseFloat(paymentAmount) || 0;
            }

            if (clientName !== undefined) lead.clientName = clientName;
            if (phone !== undefined) lead.phone = phone;
            if (email !== undefined) lead.email = email;
            if (address !== undefined) lead.address = address;
            if (notes !== undefined) lead.notes = notes;

            lead.updatedAt = new Date().toISOString();
            await kv.set(`lead:${id}`, lead);

            return res.status(200).json({ success: true, lead });
        }

        // DELETE - Remove a lead (admin only)
        if (req.method === 'DELETE') {
            if (tokenData.role !== 'admin') {
                return res.status(403).json({ error: 'Admin access required' });
            }

            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Lead ID is required' });

            const lead = await kv.get(`lead:${id}`);
            if (!lead) return res.status(404).json({ error: 'Lead not found' });

            await kv.del(`lead:${id}`);
            const leadIds = ((await kv.get('lead_ids')) || []).filter(i => i !== id);
            await kv.set('lead_ids', leadIds);

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Leads API error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
