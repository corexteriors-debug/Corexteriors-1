// Cloudflare Worker — outreach-scrape
// Deploy at: Workers & Pages > Create Worker > paste this code
// Env vars required: OUTREACH_SECRET

const MAILTO_RE = /mailto:([^?#"'\s>]+)/gi;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com'];
const CONTACT_PATHS = ['/contact', '/contact-us', '/about', '/about-us'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
}

function extractEmails(html) {
    const found = new Set();
    let m;
    const mr = new RegExp(MAILTO_RE.source, 'gi');
    while ((m = mr.exec(html)) !== null) {
        const addr = m[1].split('?')[0].trim();
        if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(addr)) found.add(addr.toLowerCase());
    }
    const er = new RegExp(EMAIL_PATTERN.source, 'g');
    while ((m = er.exec(html)) !== null) {
        const addr = m[0].toLowerCase();
        if (!IMAGE_EXTS.some(ext => addr.endsWith(ext))) found.add(addr);
    }
    return [...found];
}

function extractSocial(html) {
    const found = new Set();
    const re = /href=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const href = m[1];
        if (SOCIAL_DOMAINS.some(d => href.includes(d))) found.add(href);
    }
    return [...found];
}

function hasContactForm(html) {
    return /<form[\s\S]{0,2000}?(?:<input[^>]*type=["']?email|<textarea)/i.test(html);
}

async function fetchHtml(url, ms) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'text/html' },
            signal: AbortSignal.timeout(ms),
            redirect: 'follow',
        });
        if (!res.ok) return null;
        if (!(res.headers.get('content-type') || '').includes('html')) return null;
        return await res.text();
    } catch {
        return null;
    }
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 200, headers: corsHeaders() });
        }
        if (request.method !== 'POST') {
            return json({ error: 'Method not allowed' }, 405);
        }

        const auth = request.headers.get('Authorization') || '';
        if (!env.OUTREACH_SECRET || auth !== `Bearer ${env.OUTREACH_SECRET}`) {
            return json({ error: 'Unauthorized' }, 401);
        }

        let body;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

        const { url } = body;
        if (!url) return json({ error: 'url required' }, 400);

        let normalized = String(url).trim();
        if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

        try {
            const html = await fetchHtml(normalized, 7000);
            if (!html) return json({ reachable: false, reason: 'Site did not respond' });

            const emails = extractEmails(html);
            if (emails.length) return json({ reachable: true, contactMethod: 'email', details: emails[0] });

            let origin = normalized;
            try { origin = new URL(normalized).origin; } catch {}

            for (const path of CONTACT_PATHS) {
                const cHtml = await fetchHtml(`${origin}${path}`, 4000);
                if (!cHtml) continue;
                const cEmails = extractEmails(cHtml);
                if (cEmails.length) return json({ reachable: true, contactMethod: 'email', details: cEmails[0] });
                if (hasContactForm(cHtml)) return json({ reachable: true, contactMethod: 'contact-form', details: `${origin}${path}` });
                break;
            }

            const social = extractSocial(html);
            if (social.length) return json({ reachable: true, contactMethod: 'social', details: social.slice(0, 3).join(' | ') });

            return json({ reachable: false, reason: 'No contact info found' });
        } catch (err) {
            return json({ reachable: false, reason: err.message });
        }
    },
};
