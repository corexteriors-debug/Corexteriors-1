const https = require('https');
const { google } = require('googleapis');
require('dotenv').config({ path: '.env.development.local' });

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SEARCH_QUERY = process.argv[2] || 'Property Management in London, Ontario';

if (!API_KEY) {
    console.error('❌ Missing GOOGLE_MAPS_API_KEY in .env.development.local');
    process.exit(1);
}

// Initialize Google Sheets Auth
let sheetsClient = null;
try {
    const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (credentialsJson) {
        const credentials = JSON.parse(Buffer.from(credentialsJson, 'base64').toString());
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        sheetsClient = google.sheets({ version: 'v4', auth });
        console.log('✅ Google Sheets authenticated!');
    } else {
        console.error('❌ Missing GOOGLE_SERVICE_ACCOUNT_JSON');
        process.exit(1);
    }
} catch (e) {
    console.error('❌ Failed to initialize Google auth:', e);
    process.exit(1);
}

// Helper to make HTTPS requests
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Search for places
async function searchPlaces(query) {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
    return await httpsGet(url);
}

// Get detailed place information (phone, website, etc.)
async function getPlaceDetails(placeId) {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,international_phone_number,website,formatted_address&key=${API_KEY}`;
    return await httpsGet(url);
}

// Write directly to Google Sheet with enhanced data
async function appendToSheet(lead) {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_COMMERCIAL;
    if (!spreadsheetId) {
        console.error('❌ Missing GOOGLE_SHEET_ID_COMMERCIAL');
        return false;
    }

    try {
        await sheetsClient.spreadsheets.values.append({
            spreadsheetId,
            range: 'A:K',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    new Date().toISOString(),
                    lead.name,
                    lead.address,
                    lead.phone || 'N/A',
                    lead.email || 'N/A',
                    lead.website || 'N/A',
                    'Commercial',
                    'New',
                    lead.source,
                    lead.notes,
                    lead.placeId
                ]],
            },
        });
        return true;
    } catch (e) {
        console.error('Sheet Error:', e.message);
        return false;
    }
}

async function scrapeAndImport() {
    console.log(`\n🔎 Searching Google Maps for: "${SEARCH_QUERY}"...\n`);

    try {
        const response = await searchPlaces(SEARCH_QUERY);

        if (response.status !== 'OK') {
            console.error(`❌ Google Maps Error: ${response.status}`, response.error_message || '');
            return;
        }

        const places = response.results;
        console.log(`✅ Found ${places.length} potential leads.\n`);

        let successCount = 0;
        for (const place of places) {
            console.log(`Processing: ${place.name}...`);

            // Fetch detailed information
            let details = null;
            try {
                const detailsResponse = await getPlaceDetails(place.place_id);
                if (detailsResponse.status === 'OK') {
                    details = detailsResponse.result;
                }
            } catch (e) {
                console.log(`   ⚠️  Could not fetch details: ${e.message}`);
            }

            const lead = {
                name: place.name,
                address: place.formatted_address,
                phone: details?.formatted_phone_number || details?.international_phone_number || null,
                email: null, // Google Places API doesn't provide email
                website: details?.website || null,
                source: 'Google Maps Scraper',
                notes: `Rating: ${place.rating || 'N/A'} (${place.user_ratings_total || 0} reviews)`,
                placeId: place.place_id
            };

            console.log(`   📞 Phone: ${lead.phone || 'Not found'}`);
            console.log(`   🌐 Website: ${lead.website || 'Not found'}`);

            const success = await appendToSheet(lead);
            if (success) {
                console.log(`   ✅ Added to Commercial Sheet!\n`);
                successCount++;
            } else {
                console.log(`   ❌ Failed to add!\n`);
            }

            // Rate limiting - be nice to Google's API
            await new Promise(r => setTimeout(r, 500));
        }

        console.log(`\n✨ Import Complete! Added ${successCount}/${places.length} leads to the Commercial Sheet.`);
        console.log(`📋 View your leads: https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID_COMMERCIAL}\n`);

    } catch (error) {
        console.error('Fatal Error:', error);
    }
}

scrapeAndImport();
