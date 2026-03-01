import { google } from 'googleapis';

let auth: any = null;
try {
    const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (credentialsJson) {
        const credentials = JSON.parse(Buffer.from(credentialsJson, 'base64').toString());
        auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/calendar.events',
            ],
        });
    } else {
        console.warn('GOOGLE_SERVICE_ACCOUNT_JSON not set, Google integrations disabled.');
    }
} catch (e) {
    console.error('Failed to initialize Google auth:', e);
}


export async function appendToSheet(leadData: any) {
    if (!auth) {
        console.warn('Google auth not initialized, skipping sheet sync.');
        return;
    }
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = leadData.client_type === 'Commercial'
        ? process.env.GOOGLE_SHEET_ID_COMMERCIAL
        : process.env.GOOGLE_SHEET_ID_RESIDENTIAL;

    if (!spreadsheetId) {
        console.warn(`No spreadsheet ID found for client type: ${leadData.client_type}`);
        return;
    }


    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'A:K',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[
                new Date().toISOString(),
                leadData.name,
                leadData.email,
                leadData.phone,
                leadData.address,
                leadData.client_type,
                leadData.status,
                leadData.source,
                leadData.estimated_labor_hours,
                leadData.material_costs,
                leadData.gate_codes
            ]],
        },
    });
}

export async function createCalendarEvent(leadData: any, scheduledDate: string) {
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    await calendar.events.insert({
        calendarId,
        requestBody: {
            summary: `[${leadData.client_type}] ${leadData.name} - ${leadData.address}`,
            description: `Phone: ${leadData.phone}\nGate Code: ${leadData.gate_codes}\nNotes: ${leadData.commercial_instructions}`,
            start: { dateTime: new Date(scheduledDate).toISOString() },
            end: { dateTime: new Date(new Date(scheduledDate).getTime() + 2 * 60 * 60 * 1000).toISOString() }, // 2 hour block
        },
    });
}
