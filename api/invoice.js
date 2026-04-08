const { kv } = require('@vercel/kv');
const nodemailer = require('nodemailer');
const { generateEstimatePDF } = require('./_estimatePdf');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const tokenData = await kv.get(`token:${token}`);
    if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });

    try {
        const { estimate, documentType, signatureData } = req.body;
        if (!estimate || !estimate.clientName || !estimate.email) {
            return res.status(400).json({ error: 'Estimate data with client email is required' });
        }

        const isInvoice = documentType === 'invoice';
        const docType   = isInvoice ? 'INVOICE' : 'ESTIMATE';
        const pdfBytes  = await generateEstimatePDF(estimate, { docType, signatureData: signatureData || null });
        const emailSent = await sendDocEmail(estimate, pdfBytes, docType);

        return res.status(200).json({ success: true, emailSent });
    } catch (error) {
        console.error('Invoice error:', error);
        return res.status(500).json({ error: 'Failed to generate/send document: ' + error.message });
    }
};

async function sendDocEmail(est, pdfBytes, docType) {
    const gmailUser  = process.env.GMAIL_USER || 'corexteriors@gmail.com';
    const gmailPass  = process.env.GMAIL_APP_PASSWORD;
    if (!gmailPass) return false;

    const isInvoice  = docType === 'INVOICE';
    const ref        = est.invoiceNumber || est.estimateNumber || 'N/A';
    const repName    = est.salesRep || 'Core Exteriors Team';
    const adminEmail = process.env.ADMIN_EMAIL || gmailUser;
    const services   = (est.services || []).map(s => s.name).filter(Boolean).join(', ') || 'Exterior Services';
    const label      = isInvoice ? 'Invoice' : 'Estimate';
    const filename   = 'CoreExteriors_' + label + '_' + ref.replace(/ /g, '_') + '.pdf';

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });

    const bodyNote = isInvoice
        ? `<p>Please find your invoice attached. Payment is due upon completion of services.</p>
           <div style="background:#e8f5e9;border:1px solid #27ae60;border-radius:8px;padding:14px;font-size:13px;color:#1b5e20;margin:16px 0">
             <strong>Payment:</strong> E-transfer to <strong>corexteriors@gmail.com</strong> — Cash, cheque, and credit card also accepted.
           </div>`
        : `<p>Please find your estimate attached. This estimate is valid for 30 days.</p>
           <div style="background:#e8f5e9;border:1px solid #27ae60;border-radius:8px;padding:14px;font-size:13px;color:#1b5e20;margin:16px 0">
             <strong>To confirm your booking:</strong> A 25% deposit is required. E-transfer to <strong>corexteriors@gmail.com</strong> or call us.
           </div>`;

    await transporter.sendMail({
        from: '"Core Exteriors" <' + gmailUser + '>',
        to: est.email,
        cc: adminEmail,
        subject: 'Your ' + label + ' from Core Exteriors — ' + ref,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#0a1628;padding:24px 32px;border-radius:12px 12px 0 0;border-bottom:4px solid #e67e22">
    <h1 style="color:#fff;margin:0;font-size:22px">Core Exteriors</h1>
    <p style="color:#8899aa;margin:6px 0 0;font-size:13px">Professional Exterior Services — London, Ontario</p>
  </div>
  <div style="padding:32px;background:#f8f9fa;border:1px solid #e9ecef;border-top:none">
    <p style="font-size:16px">Hi <strong>${est.clientName || 'Valued Customer'}</strong>,</p>
    ${bodyNote}
    <table style="width:100%;margin:20px 0;border-collapse:collapse;border-radius:8px;overflow:hidden">
      <tr style="background:#0a1628;color:#fff">
        <td style="padding:10px 16px;font-weight:bold">${label} #</td>
        <td style="padding:10px 16px;text-align:right">${ref}</td>
      </tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e9ecef">Services</td><td style="padding:10px 16px;text-align:right;border-bottom:1px solid #e9ecef">${services}</td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e9ecef">Subtotal</td><td style="padding:10px 16px;text-align:right;border-bottom:1px solid #e9ecef">${est.subtotal || '$0.00'}</td></tr>
      <tr><td style="padding:10px 16px;border-bottom:1px solid #e9ecef">HST (13%)</td><td style="padding:10px 16px;text-align:right;border-bottom:1px solid #e9ecef">${est.hst || '$0.00'}</td></tr>
      <tr style="background:#0a1628;color:#fff"><td style="padding:10px 16px;font-weight:bold">Total</td><td style="padding:10px 16px;text-align:right;font-weight:bold;font-size:16px">${est.total || '$0.00'}</td></tr>
    </table>
    <p>Questions? Reply to this email or call <strong>519-712-1431</strong>.</p>
    <p style="margin-top:16px">Best regards,<br><strong>${repName}</strong><br>Core Exteriors</p>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON &nbsp;|&nbsp; 519-712-1431 &nbsp;|&nbsp; corexteriors.ca</p>
  </div>
</div>`,
        attachments: [{
            filename,
            content: Buffer.from(pdfBytes),
            contentType: 'application/pdf',
        }],
    });
    return true;
}
