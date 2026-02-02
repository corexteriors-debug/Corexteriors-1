import { NextResponse } from 'next/server';
import { updateLeadStatus } from '@/lib/db';
import { createCalendarEvent } from '@/lib/google';

export async function PATCH(
    request: Request,
    { params }: { params: { id: string } }
) {
    const id = parseInt(params.id);
    const { status, scheduledDate } = await request.json();

    try {
        const updatedLead = await updateLeadStatus(id, status);

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
