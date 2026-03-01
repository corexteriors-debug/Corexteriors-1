import { NextResponse } from 'next/server';
import { createLead, getLeads } from '@/lib/db';
import { appendToSheet } from '@/lib/google';

export async function GET() {
    try {
        const leads = await getLeads();
        return NextResponse.json(leads);
    } catch (error) {
        console.error('Failed to fetch leads:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // 1. Save to Postgres
        const lead = await createLead(body);

        // 2. Sync to Google Sheets
        try {
            await appendToSheet(lead);
        } catch (sheetError) {
            console.error('Google Sheets sync failed:', sheetError);
            // We don't fail the whole request if sheets fail
        }

        return NextResponse.json(lead, { status: 201 });
    } catch (error: any) {
        console.error('Failed to create lead:', error);
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
}
