const { kv } = require('@vercel/kv');
const { runFbLeadsSync } = require('./_syncFbLeads');
const { handleCrm } = require('./_crm');

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

// ── Relevel mailer prospects ────────────────────────────────────
// Street list from the lead scout (City of London open data, no owner names).
// rv_streets = [slug, ...] in rank order; rv:<slug> = { street, rank, plan, postal, houses: [...] }.
const RELEVEL_STATUSES = ['Not Mailed', 'Mailed', 'Door Knocked', 'Responded', 'Not Interested', 'Lead Created'];
const streetSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

function cleanHouse(raw, prev) {
    const address = cleanText(raw.address, 120).trim();
    if (!address) return null;
    return {
        address,
        postal: cleanText(raw.postal, 10),
        lotSqft: Math.round(Number(raw.lotSqft)) || 0,
        status: prev?.status || 'Not Mailed',
        note: prev?.note || '',
        leadId: prev?.leadId || '',
        updatedAt: prev?.updatedAt || '',
    };
}

async function handleRelevel(req, res, tokenData) {
    if (req.method === 'GET') {
        const slugs = (await kv.get('rv_streets')) || [];
        const rows = slugs.length ? await kv.mget(...slugs.map((s) => `rv:${s}`)) : [];
        return res.status(200).json({ success: true, statuses: RELEVEL_STATUSES, streets: rows.filter(Boolean) });
    }

    const { action } = req.body || {};

    // Import (or re-import) the street list. Keeps each house's status and note.
    if (req.method === 'POST' && action === 'relevel-import') {
        if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        const incoming = Array.isArray(req.body.streets) ? req.body.streets.slice(0, 300) : [];
        if (!incoming.length) return res.status(400).json({ error: 'No streets in the import' });
        const slugs = [];
        let houses = 0;
        for (const raw of incoming) {
            const street = cleanText(raw.street, 80).trim();
            const slug = streetSlug(street);
            if (!slug || slugs.includes(slug)) continue;
            const prev = (await kv.get(`rv:${slug}`)) || { houses: [] };
            const byAddr = new Map((prev.houses || []).map((h) => [h.address.toLowerCase(), h]));
            const list = (Array.isArray(raw.houses) ? raw.houses : []).slice(0, 400)
                .map((h) => cleanHouse(h, byAddr.get(String(h.address || '').trim().toLowerCase())))
                .filter(Boolean);
            if (!list.length) continue;
            await kv.set(`rv:${slug}`, {
                slug, street,
                rank: Math.round(Number(raw.rank)) || slugs.length + 1,
                plan: cleanText(raw.plan, 40),
                postal: cleanText(raw.postal, 60),
                houses: list,
                importedAt: new Date().toISOString(),
            });
            slugs.push(slug);
            houses += list.length;
        }
        const old = (await kv.get('rv_streets')) || [];
        for (const s of old) if (!slugs.includes(s)) await kv.del(`rv:${s}`);
        await kv.set('rv_streets', slugs);
        return res.status(200).json({ success: true, streets: slugs.length, houses });
    }

    // Set one house's status (address given) or every house on the street
    // (onlyFrom limits a street-wide change to houses currently in that status).
    if (req.method === 'PATCH' && action === 'relevel-status') {
        const { slug, address, status, note, leadId, onlyFrom } = req.body;
        if (status !== undefined && !RELEVEL_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${RELEVEL_STATUSES.join(', ')}` });
        }
        const row = await kv.get(`rv:${streetSlug(slug)}`);
        if (!row) return res.status(404).json({ error: 'Street not found' });
        const targets = address
            ? row.houses.filter((h) => h.address.toLowerCase() === String(address).toLowerCase())
            : row.houses.filter((h) => !onlyFrom || h.status === onlyFrom);
        if (!targets.length) return res.status(404).json({ error: 'House not found' });
        const now = new Date().toISOString();
        for (const h of targets) {
            if (status !== undefined) h.status = status;
            if (note !== undefined && address) h.note = cleanText(note, 500);
            if (leadId !== undefined && address) h.leadId = cleanText(leadId, 80);
            h.updatedAt = now;
            h.updatedBy = tokenData.repName || tokenData.role;
        }
        await kv.set(`rv:${row.slug}`, row);
        return res.status(200).json({ success: true, street: row });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // The agents' CRM (manager dashboard CRM tab + the Mac's sync). Does its own auth.
    if (req.query?.kind === 'crm') {
        try {
            return await handleCrm(req, res, { kv });
        } catch (err) {
            console.error('crm error:', err);
            return res.status(500).json({ error: 'CRM error' });
        }
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const tokenData = await kv.get(`token:${token}`);
    if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });

    try {
        // Relevel mailer prospects live beside the leads (one KV key per street) so
        // the Vercel function count stays put.
        // Review page ratings (written by api/contact.js), newest first.
        if (req.method === 'GET' && req.query?.kind === 'feedback') {
            if (tokenData.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
            return res.status(200).json({ success: true, feedback: (await kv.get('review_feedback')) || [] });
        }

        if (req.query?.kind === 'relevel' ||String(req.body?.action || '').startsWith('relevel-')) {
            return await handleRelevel(req, res, tokenData);
        }

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
