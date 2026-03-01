const { google } = require('googleapis');
require('dotenv').config({ path: '.env.development.local' });

async function testIntegration() {
    try {
        console.log('Testing Google Integrations...');

        // Decode credentials
        const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64').toString());
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar.events'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // Test Residential Sheet
        console.log('Appending to Residential Sheet:', process.env.GOOGLE_SHEET_ID_RESIDENTIAL);
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID_RESIDENTIAL,
            range: 'A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[new Date().toISOString(), 'TEST CONNECTION', 'Residential Check', 'Success']],
            },
        });
        console.log('✅ Residential Sheet Access Confirmed');

        // Test Commercial Sheet
        console.log('Appending to Commercial Sheet:', process.env.GOOGLE_SHEET_ID_COMMERCIAL);
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID_COMMERCIAL,
            range: 'A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[new Date().toISOString(), 'TEST CONNECTION', 'Commercial Check', 'Success']],
            },
        });
        console.log('✅ Commercial Sheet Access Confirmed');

        console.log('All Integrations Verified!');
    } catch (error) {
        console.error('Integration Test Failed:', error.message);
        if (error.response) console.error(error.response.data);
    }
}

testIntegration();
