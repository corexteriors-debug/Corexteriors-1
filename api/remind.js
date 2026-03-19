const { kv } = require('@vercel/kv');
const nodemailer = require('nodemailer');

// Runs daily via Vercel Cron (see vercel.json)
// Sends a reminder email to clients whose job is scheduled for tomorrow

module.exports = async (req, res) => {
    // Only allow GET (Vercel Cron uses GET)
    if (req.method !== 'GET') return res.status(405).end();

    // Verify cron secret to prevent unauthorized calls
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    if (cronSecret) {
        const authHeader = req.headers.authorization || '';
        if (authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    // Get tomorrow's date in America/Toronto timezone (YYYY-MM-DD)
    const tomorrow = getTomorrowDate('America/Toronto');

    try {
        const leadIds = (await kv.get('lead_ids')) || [];
        const results = { sent: 0, skipped: 0, errors: 0 };

        for (const id of leadIds) {
            const lead = await kv.get(`lead:${id}`);
            if (!lead) continue;

            // Get scheduled date from saleDate or survey.visitDate
            const visitDateRaw = lead.survey?.visitDate || '';
            const visitDatePart = visitDateRaw.includes('T') ? visitDateRaw.split('T')[0] : visitDateRaw;
            const visitTimePart = visitDateRaw.includes('T') ? visitDateRaw.split('T')[1]?.slice(0, 5) : '';

            const scheduledDate = lead.saleDate || visitDatePart || '';
            const scheduledTime = lead.saleTime || visitTimePart || '';

            // Skip if no scheduled date, not tomorrow, already reminded, or no email
            if (!scheduledDate || scheduledDate !== tomorrow) { results.skipped++; continue; }
            if (lead.reminderSent) { results.skipped++; continue; }
            if (!lead.email) { results.skipped++; continue; }
            if (lead.status === 'Lost' || lead.status === 'Closed') { results.skipped++; continue; }

            try {
                await sendReminderEmail(lead, scheduledDate, scheduledTime);

                // Mark reminder as sent so we don't resend
                lead.reminderSent = true;
                lead.reminderSentAt = new Date().toISOString();
                lead.updatedAt = new Date().toISOString();
                await kv.set(`lead:${id}`, lead);

                results.sent++;
            } catch (err) {
                console.error(`Reminder email failed for lead ${id}:`, err.message);
                results.errors++;
            }
        }

        console.log('Reminder cron result:', results);
        return res.status(200).json({ success: true, date: tomorrow, ...results });

    } catch (err) {
        console.error('Remind cron error:', err);
        return res.status(500).json({ error: err.message });
    }
};

function getTomorrowDate(timeZone) {
    const now = new Date();
    // Get current date string in the target timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    // en-CA format is YYYY-MM-DD
    const parts = formatter.formatToParts(now);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;

    const todayLocal = new Date(Number(y), Number(m) - 1, Number(d));
    todayLocal.setDate(todayLocal.getDate() + 1);

    const ty = todayLocal.getFullYear();
    const tm = String(todayLocal.getMonth() + 1).padStart(2, '0');
    const td = String(todayLocal.getDate()).padStart(2, '0');
    return `${ty}-${tm}-${td}`;
}

function formatDisplayDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-CA', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
}

function formatDisplayTime(timeStr) {
    if (!timeStr) return '';
    const [h, min] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(min || 0).padStart(2, '0')} ${ampm}`;
}

async function sendReminderEmail(lead, scheduledDate, scheduledTime) {
    const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailPass) throw new Error('Gmail not configured');

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });

    const displayDate = formatDisplayDate(scheduledDate);
    const displayTime = scheduledTime ? ` at ${formatDisplayTime(scheduledTime)}` : '';
    const serviceType = lead.serviceType || 'exterior services';
    const repName = lead.salesRep || 'Core Exteriors Team';

    await transporter.sendMail({
        from: '"Core Exteriors" <' + gmailUser + '>',
        to: lead.email,
        subject: `Reminder: Core Exteriors arriving tomorrow — ${displayDate}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#0a1628;padding:24px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">Core Exteriors</h1>
    <p style="color:#8899aa;margin:6px 0 0;font-size:13px">Professional Exterior Services — London, Ontario</p>
  </div>
  <div style="padding:32px;background:#f8f9fa;border:1px solid #e9ecef;border-top:none">
    <p style="font-size:16px">Hi <strong>${lead.clientName}</strong>,</p>
    <p style="font-size:15px">This is a friendly reminder that our team will be at your property <strong>tomorrow</strong>:</p>
    <div style="background:#fff;border-left:4px solid #F5B800;border-radius:6px;padding:16px 20px;margin:20px 0">
      <p style="margin:0 0 8px;font-size:15px"><strong>📅 Date:</strong> ${displayDate}${displayTime}</p>
      <p style="margin:0 0 8px;font-size:15px"><strong>📍 Address:</strong> ${lead.address || 'On file'}</p>
      <p style="margin:0;font-size:15px"><strong>🛠️ Service:</strong> ${serviceType}</p>
    </div>
    <p style="font-size:14px;color:#555">Please ensure the work area is accessible. If you need to reschedule or have any questions, don't hesitate to reach out.</p>
    <div style="background:#fff;border:1px solid #e9ecef;border-radius:10px;padding:16px;font-size:13px;color:#555;margin-top:20px">
      <strong>📞 Contact Us</strong><br>
      Phone: <a href="tel:5197121431" style="color:#0a1628">519-712-1431</a><br>
      Email: <a href="mailto:${gmailUser}" style="color:#0a1628">${gmailUser}</a><br>
      Website: <a href="https://corexteriors.ca" style="color:#0a1628">corexteriors.ca</a>
    </div>
    <p style="margin-top:20px">We look forward to seeing you tomorrow!<br><br>Best regards,<br><strong>${repName}</strong><br>Core Exteriors</p>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON, N6H 1N6 &nbsp;|&nbsp; 519-712-1431 &nbsp;|&nbsp; corexteriors.ca</p>
  </div>
</div>`,
    });
}
