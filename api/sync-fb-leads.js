const { kv } = require('@vercel/kv');
const { google } = require('googleapis');

// Runs on a schedule via Vercel Cron (see vercel.json)
// Pulls new rows from the Facebook Lead Ads sheet (Sheet2 of the "Residential Leads - London"
// spreadsheet) and creates a quick-lead for each one, tagged source: 'Facebook Ads'.

const SHEET_RANGE = 'Sheet2';

// Columns Meta's Lead Ads sync always writes; anything else in the header row is a
// form-specific question and gets folded into the lead's notes.
const KNOWN_COLUMNS = new Set([
    'id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name',
    'campaign_id', 'campaign_name', 'form_id', 'form_name', 'is_organic',
    'platform', 'full_name', 'email', 'phone_number', 'lead_status',
]);

function getSheetsClient() {
    const clientEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    if (!clientEmail || !key) return null;
    const auth = new google.auth.JWT({
        email: clientEmail,
        key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return google.sheets({ version: 'v4', auth });
}

function isTestLead(row) {
    const name = (row.full_name || '').toLowerCase();
    const email = (row.email || '').toLowerCase();
    const phone = (row.phone_number || '').toLowerCase();
    return name.includes('dummy data') || phone.includes('dummy data') || email === 'test@meta.com';
}

function cleanPhone(raw) {
    return (raw || '').replace(/^p:/i, '').trim();
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).end();

    const cronSecret = (process.env.CRON_SECRET || '').trim();
    if (cronSecret) {
        const authHeader = req.headers.authorization || '';
        if (authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    const spreadsheetId = (process.env.GOOGLE_SHEET_ID_FB || '').trim();
    if (!spreadsheetId) {
        return res.status(500).json({ error: 'GOOGLE_SHEET_ID_FB not configured' });
    }

    const sheets = getSheetsClient();
    if (!sheets) {
        return res.status(500).json({ error: 'Google service account not configured' });
    }

    const results = { synced: 0, skippedTest: 0, skippedDuplicate: 0, skippedEmpty: 0, errors: 0, total: 0 };

    try {
        const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: SHEET_RANGE });
        const rows = resp.data.values || [];
        if (rows.length < 2) return res.status(200).json({ success: true, ...results });

        const headers = rows[0].map(h => (h || '').trim());
        const dataRows = rows.slice(1);
        results.total = dataRows.length;

        const syncedIds = new Set((await kv.get('fb_synced_ids')) || []);

        for (const rawRow of dataRows) {
            const row = {};
            headers.forEach((h, i) => { row[h] = rawRow[i] || ''; });

            const rowId = row.id || '';
            if (!rowId) { results.skippedEmpty++; continue; }
            if (syncedIds.has(rowId)) { results.skippedDuplicate++; continue; }

            if (!row.full_name && !row.email && !row.phone_number) {
                results.skippedEmpty++;
                syncedIds.add(rowId);
                continue;
            }

            if (isTestLead(row)) {
                results.skippedTest++;
                syncedIds.add(rowId);
                continue;
            }

            try {
                const extraAnswers = Object.entries(row)
                    .filter(([key, val]) => !KNOWN_COLUMNS.has(key) && val)
                    .map(([key, val]) => `${key.replace(/_/g, ' ')}: ${val}`);

                const noteParts = [
                    row.campaign_name ? `Campaign: ${row.campaign_name}` : '',
                    row.ad_name ? `Ad: ${row.ad_name}` : '',
                    row.form_name ? `Form: ${row.form_name}` : '',
                    ...extraAnswers,
                ].filter(Boolean);

                const lead = {
                    id: `ql_fb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    name: row.full_name || '',
                    address: '',
                    phone: cleanPhone(row.phone_number),
                    email: row.email || '',
                    salesRep: '',
                    estimateNumber: '',
                    source: 'Facebook Ads',
                    campaign: row.campaign_name || '',
                    adName: row.ad_name || '',
                    callStatus: 'New',
                    services: [],
                    serviceType: '',
                    subtotal: '', hst: '', total: '',
                    discount: 0, bundleDiscount: 0, estimatedValue: '',
                    visitDate: '', saleDate: '', saleTime: '',
                    paymentStatus: 'Unpaid', paymentMethod: '', paymentAmount: 0,
                    notes: noteParts.join(' | '),
                    jobDetails: null, survey: {}, legal: {}, hasSignature: false,
                    status: 'New',
                    createdAt: row.created_time || new Date().toISOString(),
                };

                await kv.set(`ql:${lead.id}`, lead);
                const ids = (await kv.get('ql_ids')) || [];
                ids.unshift(lead.id);
                await kv.set('ql_ids', ids);

                syncedIds.add(rowId);
                results.synced++;
            } catch (err) {
                console.error(`FB lead sync error for row ${rowId}:`, err.message);
                results.errors++;
            }
        }

        await kv.set('fb_synced_ids', Array.from(syncedIds));

        return res.status(200).json({ success: true, ...results });
    } catch (err) {
        console.error('FB leads sync error:', err);
        return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
};
