const { kv } = require('@vercel/kv');

const OVERPASS_URL = process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter';
const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_FIELD_MASK = 'places.id,places.displayName,places.websiteUri,places.primaryType';

async function fetchOverpass(coords, limit) {
    const [south, west, north, east] = coords;
    const q = `[out:json][timeout:60];
(
  node["name"]["website"](${south},${west},${north},${east});
  node["name"]["contact:website"](${south},${west},${north},${east});
  way["name"]["website"](${south},${west},${north},${east});
  way["name"]["contact:website"](${south},${west},${north},${east});
);
out center tags;`.trim();

    const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'CoreExteriors-LeadFinder/1.0 (corexteriors.ca)',
        },
        body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(65000),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Overpass error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const seen = new Set();
    const businesses = [];

    for (const el of data.elements ?? []) {
        if (businesses.length >= limit) break;
        const name = el.tags?.name?.trim();
        const website = (el.tags?.website || el.tags?.['contact:website'] || '').trim();
        if (!name || !website) continue;
        const id = `osm:${el.type}/${el.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const tags = el.tags || {};
        const type = tags.shop || tags.amenity || tags.craft || tags.office || '';
        businesses.push({ name, website, placeId: id, source: 'osm', type });
    }
    return businesses;
}

async function fetchPlaces(apiKey, query, locationBias, limit) {
    const body = { textQuery: query, pageSize: Math.min(limit, 20) };
    if (locationBias) {
        const parts = String(locationBias).split(',').map(Number);
        if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
            body.locationBias = {
                circle: { center: { latitude: parts[0], longitude: parts[1] }, radius: parts[2] },
            };
        }
    }

    const res = await fetch(PLACES_SEARCH_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': PLACES_FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Places API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const businesses = [];
    for (const p of data.places ?? []) {
        if (!p.websiteUri) continue;
        const rawName = p.displayName;
        const name = (typeof rawName === 'string' ? rawName : rawName?.text ?? '').trim();
        businesses.push({ name, website: p.websiteUri.trim(), placeId: p.id ?? '', source: 'google', type: p.primaryType ?? '' });
        if (businesses.length >= limit) break;
    }
    return businesses;
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

    const { mode = 'overpass', query, bbox, limit = 50, locationBias } = req.body || {};
    const cap = Math.min(Math.max(1, Number(limit) || 50), 200);

    try {
        let businesses;
        if (mode === 'overpass') {
            if (!bbox) return res.status(400).json({ error: 'bbox required (south,west,north,east)' });
            const coords = String(bbox).split(',').map(Number);
            if (coords.length !== 4 || coords.some(n => !Number.isFinite(n))) {
                return res.status(400).json({ error: 'bbox must be four numbers: south,west,north,east' });
            }
            businesses = await fetchOverpass(coords, cap);
        } else if (mode === 'text') {
            const apiKey = process.env.GOOGLE_MAPS_API_KEY;
            if (!apiKey) return res.status(500).json({ error: 'Google Maps API key not configured on server' });
            if (!query) return res.status(400).json({ error: 'query required for text mode' });
            businesses = await fetchPlaces(apiKey, String(query), locationBias, cap);
        } else {
            return res.status(400).json({ error: 'mode must be "overpass" or "text"' });
        }

        return res.status(200).json({ success: true, businesses, total: businesses.length });
    } catch (err) {
        console.error('outreach-finder error:', err);
        return res.status(500).json({ error: err.message });
    }
};
