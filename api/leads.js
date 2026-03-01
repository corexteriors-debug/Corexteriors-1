const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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
                subtotal: body.subtotal || '',
                hst: body.hst || '',
                total: body.total || '',
                survey: body.survey || {},
                legal: body.legal || {},
                hasSignature: body.hasSignature || false,
                status: 'New',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Store lead in Redis
            await kv.set(`lead:${lead.id}`, lead);

            // Add to lead index
            const leadIds = (await kv.get('lead_ids')) || [];
            leadIds.unshift(lead.id);
            await kv.set('lead_ids', leadIds);

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

            const { id, status, paymentStatus, paymentMethod } = req.body;

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
            }

            lead.updatedAt = new Date().toISOString();
            await kv.set(`lead:${id}`, lead);

            return res.status(200).json({ success: true, lead });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Leads API error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
