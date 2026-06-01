const { kv } = require('@vercel/kv');

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAILTO_RE = /mailto:([^?#"'\s>]+)/gi;
const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com'];
const CONTACT_PATHS = ['/contact', '/contact-us', '/about', '/about-us'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function extractEmails(html) {
    const found = new Set();
    let m;
    const mr = new RegExp(MAILTO_RE.source, 'gi');
    while ((m = mr.exec(html)) !== null) {
        const addr = m[1].split('?')[0].trim();
        if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(addr)) found.add(addr.toLowerCase());
    }
    const er = new RegExp(EMAIL_RE.source, 'g');
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

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const tokenData = await kv.get(`token:${authHeader.split(' ')[1]}`);
    if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });

    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });

    let normalized = String(url).trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

    try {
        const html = await fetchHtml(normalized, 7000);
        if (!html) return res.status(200).json({ reachable: false, reason: 'Site did not respond' });

        const emails = extractEmails(html);
        if (emails.length) return res.status(200).json({ reachable: true, contactMethod: 'email', details: emails[0] });

        let origin = normalized;
        try { origin = new URL(normalized).origin; } catch {}

        for (const path of CONTACT_PATHS) {
            const cHtml = await fetchHtml(`${origin}${path}`, 4000);
            if (!cHtml) continue;
            const cEmails = extractEmails(cHtml);
            if (cEmails.length) return res.status(200).json({ reachable: true, contactMethod: 'email', details: cEmails[0] });
            if (hasContactForm(cHtml)) return res.status(200).json({ reachable: true, contactMethod: 'contact-form', details: `${origin}${path}` });
            break;
        }

        const social = extractSocial(html);
        if (social.length) return res.status(200).json({ reachable: true, contactMethod: 'social', details: social.slice(0, 3).join(' | ') });

        return res.status(200).json({ reachable: false, reason: 'No contact info found' });
    } catch (err) {
        return res.status(200).json({ reachable: false, reason: err.message });
    }
};
