require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const googleSheets = require('./google-sheets');

// Initialize Google Sheets on startup
(async () => {
  await googleSheets.initialize();
})();

// Budget tracking - conservative cost estimates (USD)
// Text Search Pro: ~$32/1000, Place Details Enterprise: ~$17/1000
// Using slightly higher estimates for safety margin
const COST_PER_TEXT_SEARCH = 0.04;
const COST_PER_PLACE_DETAILS = 0.02;
const BUDGET_LIMIT_USD = parseFloat(process.env.BUDGET_LIMIT_USD || '150');
const BUDGET_FILE = path.join(__dirname, '.budget-used.json');

function readBudget() {
  try {
    const data = fs.readFileSync(BUDGET_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { usedUsd: 0, lastReset: new Date().toISOString() };
  }
}

function writeBudget(data) {
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(data, null, 2));
}

function getRemainingBudget() {
  const { usedUsd } = readBudget();
  return Math.max(0, BUDGET_LIMIT_USD - usedUsd);
}

// London, Ontario coordinates (center)
const LONDON_ON = {
  low: { latitude: 42.88, longitude: -81.35 },
  high: { latitude: 43.10, longitude: -81.10 },
};

// Sleep helper for rate limiting
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Text Search (New) - find places
async function textSearch(textQuery, includedType = null, pageToken = null) {
  const body = {
    textQuery: `${textQuery} London Ontario Canada`,
    locationRestriction: {
      rectangle: {
        low: LONDON_ON.low,
        high: LONDON_ON.high,
      },
    },
    pageSize: 20,
    regionCode: 'CA',
  };

  if (includedType) body.includedType = includedType;
  if (pageToken) body.pageToken = pageToken;

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.primaryType,places.types,nextPageToken',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Places API error: ${res.status} - ${err}`);
  }

  return res.json();
}

// Place Details - get phone, website, etc.
async function getPlaceDetails(placeId) {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}?regionCode=CA`,
    {
      headers: {
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask':
          'id,displayName,formattedAddress,primaryType,types,nationalPhoneNumber,internationalPhoneNumber,websiteUri',
      },
    }
  );

  if (!res.ok) return null;
  return res.json();
}

// Search categories for London ON properties
const SEARCH_QUERIES = [
  { query: 'apartment building', type: 'apartment_building' },
  { query: 'apartment complex', type: 'apartment_complex' },
  { query: 'condominium', type: 'condominium_complex' },
  { query: 'condo building', type: 'condominium_complex' },
  { query: 'commercial building', type: null },
  { query: 'office building', type: null },
  { query: 'property management', type: 'real_estate_agency' },
  { query: 'strata building', type: null },
  { query: 'residential complex', type: 'housing_complex' },
];

app.get('/api/health', (req, res) => {
  const { usedUsd, lastReset } = readBudget();
  const remaining = getRemainingBudget();
  res.json({
    ok: !!GOOGLE_API_KEY,
    message: GOOGLE_API_KEY
      ? 'API key configured'
      : 'Set GOOGLE_PLACES_API_KEY in .env',
    budget: {
      limitUsd: BUDGET_LIMIT_USD,
      usedUsd: Math.round(usedUsd * 100) / 100,
      remainingUsd: Math.round(remaining * 100) / 100,
      lastReset,
    },
    googleSheets: {
      enabled: googleSheets.isReady(),
      configured: !!process.env.GOOGLE_SHEET_ID,
      autoSync: process.env.AUTO_SYNC_SHEETS === 'true',
    },
  });
});

app.post('/api/budget/reset', (req, res) => {
  writeBudget({ usedUsd: 0, lastReset: new Date().toISOString() });
  res.json({ ok: true, message: 'Budget reset to $0' });
});

// Google Sheets endpoints
app.post('/api/sheets/test', async (req, res) => {
  try {
    const { spreadsheetId } = req.body;
    const result = await googleSheets.testConnection(spreadsheetId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sheets/sync', async (req, res) => {
  try {
    const { places, spreadsheetId } = req.body;

    if (!places || !Array.isArray(places)) {
      return res.status(400).json({ error: 'Invalid places data' });
    }

    const result = await googleSheets.syncToSheet(places, spreadsheetId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sheets/config', (req, res) => {
  try {
    const { spreadsheetId, autoSync } = req.body;

    // Update .env file with new configuration
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    if (spreadsheetId !== undefined) {
      if (envContent.includes('GOOGLE_SHEET_ID=')) {
        envContent = envContent.replace(
          /GOOGLE_SHEET_ID=.*/,
          `GOOGLE_SHEET_ID=${spreadsheetId}`
        );
      } else {
        envContent += `\nGOOGLE_SHEET_ID=${spreadsheetId}\n`;
      }
    }

    if (autoSync !== undefined) {
      if (envContent.includes('AUTO_SYNC_SHEETS=')) {
        envContent = envContent.replace(
          /AUTO_SYNC_SHEETS=.*/,
          `AUTO_SYNC_SHEETS=${autoSync}`
        );
      } else {
        envContent += `\nAUTO_SYNC_SHEETS=${autoSync}\n`;
      }
    }

    fs.writeFileSync(envPath, envContent);

    // Update process.env
    if (spreadsheetId !== undefined) process.env.GOOGLE_SHEET_ID = spreadsheetId;
    if (autoSync !== undefined) process.env.AUTO_SYNC_SHEETS = String(autoSync);

    res.json({ ok: true, message: 'Configuration saved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/search', async (req, res) => {
  if (!GOOGLE_API_KEY) {
    return res
      .status(500)
      .json({ error: 'API key not configured. Set GOOGLE_PLACES_API_KEY in .env' });
  }

  const { queries = SEARCH_QUERIES, maxPlaces = 100 } = req.body;
  const maxPlacesNum = Math.min(Math.max(1, parseInt(maxPlaces, 10) || 80), 100);

  // Pre-check: estimate max cost for this run
  const maxTextSearches = Math.min(queries.length * 3, 30); // ~3 pages per query
  const estimatedCost =
    maxTextSearches * COST_PER_TEXT_SEARCH +
    maxPlacesNum * COST_PER_PLACE_DETAILS;
  const remaining = getRemainingBudget();

  if (estimatedCost > remaining) {
    return res.status(402).json({
      error: `Estimated cost $${estimatedCost.toFixed(2)} exceeds remaining budget $${remaining.toFixed(2)}. Reduce maxPlaces or reset budget.`,
      remainingUsd: remaining,
      estimatedCost,
    });
  }

  const seenIds = new Set();
  const results = [];
  let totalFetched = 0;
  let textSearchCount = 0;
  let placeDetailsCount = 0;

  try {
    for (const { query, type } of queries) {
      if (totalFetched >= maxPlacesNum) break;

      let pageToken = null;
      let pageCount = 0;
      const maxPages = 3; // ~60 results per query max from API

      do {
        const data = await textSearch(query, type || undefined, pageToken);
        textSearchCount++;
        pageToken = data.nextPageToken || null;
        pageCount++;

        for (const place of data.places || []) {
          const id = place.id || (place.name || '').replace('places/', '');
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);

          const name =
            place.displayName?.text || place.displayName || 'Unknown';
          const address = place.formattedAddress || '';
          const primaryType = place.primaryType || place.types?.[0] || '';

          results.push({
            id,
            name,
            address,
            phone: null,
            email: null,
            website: null,
            type: primaryType,
            types: place.types || [],
          });
          totalFetched++;

          if (totalFetched >= maxPlacesNum) break;
        }

        if (pageToken) await sleep(300);
      } while (pageToken && pageCount < maxPages);

      await sleep(400);
    }

    // Enrich with Place Details (phone, website) - rate limited
    const BATCH_SIZE = 5;
    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);
      const projectedCost =
        textSearchCount * COST_PER_TEXT_SEARCH +
        (placeDetailsCount + batch.length) * COST_PER_PLACE_DETAILS;
      const { usedUsd } = readBudget();
      if (usedUsd + projectedCost > BUDGET_LIMIT_USD) {
        break; // Stop early to stay under budget
      }
      const details = await Promise.all(
        batch.map((r) => getPlaceDetails(r.id))
      );
      placeDetailsCount += batch.length;

      batch.forEach((r, j) => {
        const d = details[j];
        if (d) {
          r.phone = d.nationalPhoneNumber || d.internationalPhoneNumber || null;
          r.website = d.websiteUri || null;
          r.email = null; // Google doesn't provide email - user can add manually or check website
        }
      });

      await sleep(500);
    }

    // Record this run's cost
    const runCost =
      textSearchCount * COST_PER_TEXT_SEARCH +
      placeDetailsCount * COST_PER_PLACE_DETAILS;
    const budget = readBudget();
    budget.usedUsd = (budget.usedUsd || 0) + runCost;
    writeBudget(budget);

    // Auto-sync to Google Sheets if enabled
    let sheetsSyncResult = null;
    if (process.env.AUTO_SYNC_SHEETS === 'true' && googleSheets.isReady()) {
      try {
        sheetsSyncResult = await googleSheets.syncToSheet(results);
        console.log(`✓ Synced ${results.length} leads to Google Sheets`);
      } catch (sheetError) {
        console.error('Google Sheets sync failed:', sheetError.message);
        // Don't fail the request if Sheets sync fails
      }
    }

    res.json({
      places: results,
      costThisRun: Math.round(runCost * 100) / 100,
      budgetRemaining: getRemainingBudget(),
      sheetsSynced: !!sheetsSyncResult,
      sheetsResult: sheetsSyncResult,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  London Lead Finder running at http://localhost:${PORT}\n`);
  if (!GOOGLE_API_KEY) {
    console.log('  ⚠️  Set GOOGLE_PLACES_API_KEY in .env to enable search\n');
  }
});
