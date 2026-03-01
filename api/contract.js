const { kv } = require('@vercel/kv');
const nodemailer = require('nodemailer');
const { generateContractPDF } = require('./_contractPdf');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://corexteriors.ca');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const tokenData = await kv.get(`token:${token}`);
    if (!tokenData) return res.status(401).json({ error: 'Invalid token' });

    try {
        const { estimate, signatureData } = req.body;
        if (!estimate || !estimate.email) {
            return res.status(400).json({ error: 'Estimate with client email required' });
        }

        const pdfBytes = await generateContractPDF(estimate, signatureData);
        const emailSent = await sendContractEmail(estimate, pdfBytes);

        return res.status(200).json({ success: true, emailSent });
    } catch (error) {
        console.error('Contract error:', error);
        return res.status(500).json({ error: error.message || 'Contract generation failed' });
    }
};

async function sendContractEmail(est, pdfBytes) {
    const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailPass) return false;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });

    const contractNum = est.estimateNumber || 'N/A';
    const repName = est.salesRep || 'Core Exteriors Team';
    const adminEmail = process.env.ADMIN_EMAIL || gmailUser;
    const fileName = 'CoreExteriors_Contract_' + contractNum.replace(/ /g, '_') + '.pdf';

    await transporter.sendMail({
        from: '"Core Exteriors" <' + gmailUser + '>',
        to: est.email,
        cc: adminEmail,
        subject: 'Your Core Exteriors Service Agreement — ' + contractNum,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#0a1628;padding:24px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">Core Exteriors</h1>
    <p style="color:#8899aa;margin:6px 0 0;font-size:13px">Professional Exterior Services — London, Ontario</p>
  </div>
  <div style="padding:32px;background:#f8f9fa;border:1px solid #e9ecef;border-top:none">
    <p style="font-size:16px">Hi <strong>${est.clientName || 'Valued Customer'}</strong>,</p>
    <p>Thank you for choosing Core Exteriors! Your signed service agreement is attached. Please review it and keep a copy for your records.</p>
    <table style="width:100%;margin:20px 0;border-collapse:collapse">
      <tr style="background:#0a1628;color:#fff">
        <td style="padding:10px 15px;font-weight:bold">Contract #</td>
        <td style="padding:10px 15px;text-align:right">${contractNum}</td>
      </tr>
      <tr>
        <td style="padding:10px 15px;border-bottom:1px solid #e9ecef">Services</td>
        <td style="padding:10px 15px;text-align:right;border-bottom:1px solid #e9ecef">${est.serviceType || (est.services || []).map(s => s.name).join(', ')}</td>
      </tr>
      <tr>
        <td style="padding:10px 15px">Total</td>
        <td style="padding:10px 15px;text-align:right;font-weight:bold;color:#27ae60;font-size:18px">${est.total || '$0.00'}</td>
      </tr>
    </table>
    <div style="background:#fff8e8;border:1px solid #F5B800;border-radius:8px;padding:14px;font-size:13px;color:#7a5500;margin:16px 0">
      <strong>Reminder:</strong> A 20% deposit is due at signing. Your 10-day cooling off period is in effect from today.
    </div>
    <p>Questions? Reply to this email or call us at <strong>606-616-2026</strong>.</p>
    <p style="margin-top:16px">Best regards,<br><strong>${repName}</strong><br>Core Exteriors</p>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON, N6H 1N6 &nbsp;|&nbsp; 606 616 2026 &nbsp;|&nbsp; corexteriors.ca</p>
  </div>
</div>`,
        attachments: [{ filename: fileName, content: Buffer.from(pdfBytes), contentType: 'application/pdf' }],
    });

    return true;
}
