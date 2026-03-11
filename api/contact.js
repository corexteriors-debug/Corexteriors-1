const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { name, email, phone, address, service, message } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'Name, email, and phone are required' });
        }

        const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
        const gmailPass = process.env.GMAIL_APP_PASSWORD;

        if (!gmailPass) {
            console.error('GMAIL_APP_PASSWORD not configured');
            return res.status(500).json({ error: 'Email service not configured' });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailUser, pass: gmailPass }
        });

        const serviceLabels = {
            deck: 'Deck Restoration',
            hardscape: 'Hardscape Optimization',
            siding: 'Siding Cleaning',
            gutter: 'Gutter Maintenance',
            window: 'Window Cleaning',
            multiple: 'Multiple Services',
            other: 'Other'
        };
        const serviceLabel = serviceLabels[service] || service || 'Not specified';
        const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });

        // 1. Email to Core Exteriors team — new lead notification
        await transporter.sendMail({
            from: `"Core Exteriors Website" <${gmailUser}>`,
            to: gmailUser,
            replyTo: email,
            subject: `🔔 New Quote Request — ${name}`,
            html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#0a1628;padding:24px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">New Lead from Website</h1>
    <p style="color:#8899aa;margin:6px 0 0;font-size:13px">${now}</p>
  </div>
  <div style="padding:28px 32px;background:#fff;border:1px solid #e9ecef;border-top:none">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:8px 0;color:#888;width:120px"><strong>Name</strong></td><td style="padding:8px 0">${name}</td></tr>
      <tr><td style="padding:8px 0;color:#888"><strong>Email</strong></td><td style="padding:8px 0"><a href="mailto:${email}">${email}</a></td></tr>
      <tr><td style="padding:8px 0;color:#888"><strong>Phone</strong></td><td style="padding:8px 0"><a href="tel:${phone}">${phone}</a></td></tr>
      <tr><td style="padding:8px 0;color:#888"><strong>Address</strong></td><td style="padding:8px 0">${address || 'Not provided'}</td></tr>
      <tr><td style="padding:8px 0;color:#888"><strong>Service</strong></td><td style="padding:8px 0">${serviceLabel}</td></tr>
      ${message ? `<tr><td style="padding:8px 0;color:#888;vertical-align:top"><strong>Message</strong></td><td style="padding:8px 0">${message.replace(/\n/g, '<br>')}</td></tr>` : ''}
    </table>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">Core Exteriors · corexteriors.ca</p>
  </div>
</div>`
        });

        // 2. Confirmation email to the customer
        await transporter.sendMail({
            from: `"Core Exteriors" <${gmailUser}>`,
            to: email,
            subject: `Thanks for reaching out, ${name.split(' ')[0]}! — Core Exteriors`,
            html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#0a1628;padding:24px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">Core Exteriors</h1>
    <p style="color:#8899aa;margin:6px 0 0;font-size:13px">Professional Exterior Services — London, Ontario</p>
  </div>
  <div style="padding:28px 32px;background:#f8f9fa;border:1px solid #e9ecef;border-top:none">
    <p style="font-size:16px">Hi <strong>${name.split(' ')[0]}</strong>,</p>
    <p>Thank you for your interest in our <strong>${serviceLabel}</strong> services! We've received your request and a member of our team will get back to you within <strong>24 hours</strong> with a detailed quote.</p>
    <div style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin:20px 0">
      <p style="margin:0 0 8px;font-size:13px;color:#888"><strong>Your Request Summary</strong></p>
      <p style="margin:4px 0;font-size:14px">📋 <strong>Service:</strong> ${serviceLabel}</p>
      ${address ? `<p style="margin:4px 0;font-size:14px">📍 <strong>Address:</strong> ${address}</p>` : ''}
      ${message ? `<p style="margin:4px 0;font-size:14px">💬 <strong>Details:</strong> ${message}</p>` : ''}
    </div>
    <p>In the meantime, feel free to reach us anytime:</p>
    <ul style="list-style:none;padding:0;font-size:14px;line-height:2">
      <li>📞 <strong><a href="tel:519-712-1431" style="color:#1a2a4a">519-712-1431</a></strong></li>
      <li>📧 <strong><a href="mailto:corexteriors@gmail.com" style="color:#1a2a4a">corexteriors@gmail.com</a></strong></li>
    </ul>
    <p>We look forward to working with you!</p>
    <p style="font-weight:600;color:#1a2a4a;margin-bottom:0">— The Core Exteriors Team</p>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON, N6H 1N6 &nbsp;|&nbsp; 519-712-1431 &nbsp;|&nbsp; corexteriors.ca</p>
  </div>
</div>`
        });

        return res.status(200).json({ success: true, message: 'Emails sent successfully' });

    } catch (error) {
        console.error('Contact API error:', error);
        return res.status(500).json({ error: 'Failed to send email. Please try again.' });
    }
};
