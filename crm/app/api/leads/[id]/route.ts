import { NextResponse } from 'next/server';
import { updateLeadStatus } from '@/lib/db';
import { createCalendarEvent } from '@/lib/google';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(
    request: Request,
    { params }: RouteParams
) {
    const { id } = await params;
    const leadId = parseInt(id);
    const { status, scheduledDate } = await request.json();

    try {
        const updatedLead = await updateLeadStatus(leadId, status);

        // If status changes to 'Scheduled', create a calendar event
        if (status === 'Scheduled' && scheduledDate) {
            await createCalendarEvent(updatedLead, scheduledDate);
        }

        return NextResponse.json(updatedLead);
    } catch (error) {
        console.error('Update failed:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
