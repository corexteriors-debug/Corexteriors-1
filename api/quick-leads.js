const { kv } = require('@vercel/kv');
const { runFbLeadsSync } = require('./_syncFbLeads');

const CALL_STATUSES = ['New', 'Called', 'No Answer', 'Interested', 'Not Interested', 'Booked'];

function cleanText(value, max) {
    return String(value || '').slice(0, max);
}

function cleanBrochureUrl(value) {
    const raw = cleanText(value, 2000);
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.hostname !== 'sign.corexteriors.ca') return '';
        if (url.pathname !== '/api/file') return '';
        return url.toString();
    } catch {
        return '';
    }
}

function cleanGmailUrl(value) {
    const raw = cleanText(value, 2000);
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.hostname !== 'mail.google.com') return '';
        if (url.searchParams.get('authuser') !== 'corexteriors@gmail.com') return '';
        if (!url.hash.includes('compose=')) return '';
        return raw;
    } catch {
        return '';
    }
}

function cleanDraft(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const squareFeet = Number(raw.squareFeet);
    return {
        id: cleanText(raw.id, 80) || `draft_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        squareFeet: Number.isFinite(squareFeet) ? Math.round(squareFeet) : 0,
        service: cleanText(raw.service, 200),
        request: cleanText(raw.request, 500),
        subtotal: cleanText(raw.subtotal, 40),
        hst: cleanText(raw.hst, 40),
        total: cleanText(raw.total, 40),
        estimateNumber: cleanText(raw.estimateNumber, 40),
        notes: cleanText(raw.notes, 500),
        brochureUrl: cleanBrochureUrl(raw.brochureUrl),
        gmailUrl: cleanGmailUrl(raw.gmailUrl),
        createdAt: cleanText(raw.createdAt, 40) || new Date().toISOString(),
    };
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const tokenData = await kv.get(`token:${token}`);
    if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });

    try {
        // POST — create lead (from sales portal estimate or manual entry)
        if (req.method === 'POST') {
            const b = req.body;
            const name = b.name || b.clientName || '';
            const address = b.address || b.clientAddress || '';
            const phone = b.phone || '';
            const email = b.email || '';
            if (!name) return res.status(400).json({ error: 'Name is required' });
            if (!address && !phone && !email) return res.status(400).json({ error: 'At least one of address, phone, or email is required' });

            const lead = {
                id: `ql_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                // identity
                name,
                address,
                phone,
                email,
                salesRep:       b.salesRep || tokenData.repName || '',
                estimateNumber: b.estimateNumber || '',
                // lead origin & call tracking
                source:         b.source || 'Manual',
                campaign:       b.campaign || '',
                adName:         b.adName || '',
                callStatus:     CALL_STATUSES.includes(b.callStatus) ? b.callStatus : 'New',
                // services & pricing
                services:       b.services || [],
                serviceType:    b.serviceType || '',
                subtotal:       b.subtotal || '',
                hst:            b.hst || '',
                total:          b.total || '',
                discount:       b.discount || 0,
                bundleDiscount: b.bundleDiscount || 0,
                estimatedValue: b.estimatedValue || '',
                // scheduling
                visitDate:      b.survey?.visitDate || b.saleDate || b.visitDate || '',
                saleDate:       b.saleDate || '',
                saleTime:       b.saleTime || '',
                // payment
                paymentStatus:  b.paymentStatus || 'Unpaid',
                paymentMethod:  b.paymentMethod || '',
                paymentAmount:  parseFloat(b.paymentAmount) || 0,
                // extras
                notes:          b.notes || b.survey?.notes || '',
                jobDetails:     b.jobDetails || null,
                survey:         b.survey || {},
                legal:          b.legal || {},
                hasSignature:   b.hasSignature || false,
                status:         b.status || 'New',
                drafts:         Array.isArray(b.drafts) ? b.drafts.map(cleanDraft).filter(Boolean).slice(0, 20) : [],
                createdAt:      new Date().toISOString(),
            };

            await kv.set(`ql:${lead.id}`, lead);
            const ids = (await kv.get('ql_ids')) || [];
            ids.unshift(lead.id);
            await kv.set('ql_ids', ids);

            return res.status(201).json({ success: true, lead });
        }

        // GET — retrieve leads (admin sees all, sales sees own)
        if (req.method === 'GET') {
            const ids = (await kv.get('ql_ids')) || [];
            const leads = [];
            for (const id of ids) {
                const lead = await kv.get(`ql:${id}`);
                if (!lead) continue;
                if (tokenData.role === 'admin' || lead.salesRep === tokenData.repName) {
                    leads.push(lead);
                }
            }
            return res.status(200).json({ success: true, leads });
        }

        // PATCH — edit a lead, or (action: 'sync-fb-leads') trigger a manual FB Ads import
        if (req.method === 'PATCH') {
            if (req.body.action === 'sync-fb-leads') {
                if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
                const results = await runFbLeadsSync();
                return res.status(200).json({ success: true, ...results });
            }

            if (req.body.action === 'add-draft') {
                const { id, draft } = req.body;
                if (!id) return res.status(400).json({ error: 'ID required' });
                const lead = await kv.get(`ql:${id}`);
                if (!lead) return res.status(404).json({ error: 'Not found' });
                if (tokenData.role !== 'admin' && lead.salesRep !== tokenData.repName) {
                    return res.status(403).json({ error: 'Forbidden' });
                }
                const clean = cleanDraft(draft);
                if (!clean) return res.status(400).json({ error: 'Draft required' });
                lead.drafts = Array.isArray(lead.drafts) ? lead.drafts : [];
                const existing = lead.drafts.find((item) =>
                    (clean.estimateNumber && item.estimateNumber === clean.estimateNumber)
                    || (clean.squareFeet && item.squareFeet === clean.squareFeet)
                );
                if (existing) {
                    if (clean.brochureUrl) existing.brochureUrl = clean.brochureUrl;
                    if (clean.gmailUrl) existing.gmailUrl = clean.gmailUrl;
                    if (clean.service && !existing.service) existing.service = clean.service;
                } else {
                    lead.drafts.unshift(clean);
                    lead.drafts = lead.drafts.slice(0, 20);
                }
                lead.updatedAt = new Date().toISOString();
                await kv.set(`ql:${id}`, lead);
                return res.status(200).json({ success: true, lead });
            }

            const { id, name, address, notes, phone, email, callStatus, salesRep } = req.body;
            if (!id) return res.status(400).json({ error: 'ID required' });

            const lead = await kv.get(`ql:${id}`);
            if (!lead) return res.status(404).json({ error: 'Not found' });
            if (tokenData.role !== 'admin' && lead.salesRep !== tokenData.repName) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            if (name  !== undefined) lead.name  = name;
            if (address !== undefined) lead.address = address;
            if (notes !== undefined) lead.notes  = notes;
            if (phone !== undefined) lead.phone  = phone;
            if (email !== undefined) lead.email  = email;
            if (salesRep !== undefined) lead.salesRep = salesRep;
            if (callStatus !== undefined) {
                if (!CALL_STATUSES.includes(callStatus)) {
                    return res.status(400).json({ error: `Invalid call status. Must be one of: ${CALL_STATUSES.join(', ')}` });
                }
                lead.callStatus = callStatus;
            }
            lead.updatedAt = new Date().toISOString();

            await kv.set(`ql:${id}`, lead);
            return res.status(200).json({ success: true, lead });
        }

        // DELETE — remove a lead
        if (req.method === 'DELETE') {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'ID required' });

            const lead = await kv.get(`ql:${id}`);
            if (!lead) return res.status(404).json({ error: 'Not found' });
            if (tokenData.role !== 'admin' && lead.salesRep !== tokenData.repName) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            await kv.del(`ql:${id}`);
            const ids = ((await kv.get('ql_ids')) || []).filter(i => i !== id);
            await kv.set('ql_ids', ids);

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        console.error('Quick leads error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
