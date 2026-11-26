const { kv } = require('@vercel/kv');
const nodemailer = require('nodemailer');
const { generateEstimatePDF } = require('./_estimatePdf');

const { createPayLink, publicView, getLink, startCheckout, voidLink } = require('./_paylink');

// Routes (one function — the Hobby plan caps us at 12):
//   GET  /api/payment?action=link&code=…      public: what the /pay/<code> page shows
//   POST /api/payment?action=checkout {code}  public: open a fresh Stripe Checkout for that link
//   POST /api/payment?action=link             signed in: create a pay link, return its URL (no email)
//   POST /api/payment?action=void {code}      signed in: switch a link off
//   POST /api/payment                         signed in: portal flow — create a link and email it with the invoice
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://corexteriors.ca');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    const action = String((req.query && req.query.action) || '');
    const fail = (err) => {
        if (!err.status) console.error('Payment API error:', err);
        return res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' });
    };

    try {
        if (action === 'link' && req.method === 'GET') {
            res.setHeader('Cache-Control', 'no-store');
            const link = await getLink(kv, req.query.code);
            if (!link) return res.status(404).json({ success: false, error: 'This payment link was not found.' });
            return res.status(200).json({ success: true, link: publicView(link) });
        }
        if (action === 'checkout' && req.method === 'POST') {
            const url = await startCheckout(kv, (req.body || {}).code);
            return res.status(200).json({ success: true, url });
        }
    } catch (err) {
        return fail(err);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'No token provided' });
        const tokenData = await kv.get(`token:${token}`);
        if (!tokenData) return res.status(401).json({ error: 'Invalid token' });
        const repName = tokenData.repName || 'Core Exteriors Team';
        const body = req.body || {};

        if (action === 'link') {
            const { code, url, link } = await createPayLink(kv, body, repName);
            return res.status(200).json({ success: true, code, url, link: publicView(link) });
        }
        if (action === 'void') {
            const link = await voidLink(kv, body.code);
            if (!link) return res.status(404).json({ success: false, error: 'Link not found.' });
            return res.status(200).json({ success: true, link: publicView(link) });
        }

        const { clientName, clientEmail, amount, description, leadId, paymentType, estimate, signatureData } = body;
        if (!clientEmail || !amount) {
            return res.status(400).json({ error: 'Client email and amount are required' });
        }
        const isDeposit = paymentType === 'deposit';
        const { code, url: payUrl, link } = await createPayLink(kv, {
            clientName, clientEmail, amount, description, leadId,
            type: isDeposit ? 'deposit' : 'full',
            estimateNumber: estimate && estimate.estimateNumber,
        }, repName);

        // Update lead with pending payment info
        if (leadId) {
            const lead = await kv.get(`lead:${leadId}`);
            if (lead) {
                lead.payCode = code;
                lead.paymentStatus = 'Pending';
                lead.paymentMethod = 'Credit Card';
                lead.paymentAmount = parseFloat(amount);
                lead.paymentType = paymentType || 'full';
                lead.updatedAt = new Date().toISOString();
                await kv.set(`lead:${leadId}`, lead);
            }
        }

        const estData = estimate || { clientName, email: clientEmail };

        // Generate invoice PDF to attach
        let invoicePdfBytes = null;
        try {
            invoicePdfBytes = await generateEstimatePDF(estData, { docType: 'INVOICE', signatureData: signatureData || null });
        } catch (err) {
            console.error('Invoice PDF error in payment:', err.message);
        }

        // Send email: payment button in body + invoice PDF attached
        let emailSent = false;
        try {
            emailSent = await sendPaymentEmail({
                clientName: clientName || 'Valued Customer',
                clientEmail,
                amount: link.amountCents / 100,
                feeAmount: link.feeCents / 100,
                checkoutUrl: payUrl,
                isDeposit,
                description: description || 'Exterior Services',
                repName,
                invoicePdfBytes,
                estimateNumber: estData.estimateNumber,
            });
        } catch (err) {
            console.error('Payment email error:', err.message);
        }

        return res.status(200).json({ success: true, emailSent, payCode: code });
    } catch (error) {
        return fail(error);
    }
};

async function sendPaymentEmail({ clientName, clientEmail, amount, feeAmount, checkoutUrl, isDeposit, description, repName, invoicePdfBytes, estimateNumber }) {
    const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailPass) return false;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });

    const amountStr = '$' + amount.toFixed(2) + ' CAD';
    const feeStr = '$' + feeAmount.toFixed(2) + ' CAD';
    const totalStr = '$' + (amount + feeAmount).toFixed(2) + ' CAD';
    const label = isDeposit ? 'Deposit' : 'Payment';
    const contractNum = estimateNumber || '';

    const attachments = [];
    if (invoicePdfBytes) {
        attachments.push({
            filename: contractNum
                ? 'CoreExteriors_Invoice_' + contractNum.replace(/ /g, '_') + '.pdf'
                : 'CoreExteriors_Invoice.pdf',
            content: Buffer.from(invoicePdfBytes),
            contentType: 'application/pdf',
        });
    }

    await transporter.sendMail({
        from: '"Core Exteriors" <' + gmailUser + '>',
        to: clientEmail,
        subject: `Your Core Exteriors Service Agreement & ${label} Link — ${amountStr}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#0a1628;padding:24px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">Core Exteriors</h1>
    <p style="color:#8899aa;margin:6px 0 0;font-size:13px">Professional Exterior Services — London, Ontario</p>
  </div>
  <div style="padding:32px;background:#f8f9fa;border:1px solid #e9ecef;border-top:none">
    <p style="font-size:16px">Hi <strong>${clientName}</strong>,</p>
    <p>Thank you for choosing Core Exteriors! Your signed service agreement is attached. To confirm your booking, please complete your ${label.toLowerCase()} of <strong style="color:#27ae60;font-size:18px">${amountStr}</strong> using the button below.</p>
    <p style="color:#666;font-size:13px;margin-bottom:6px"><strong>Services:</strong> ${description}</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${checkoutUrl}"
         style="display:inline-block;background:#F5B800;color:#1A1A1A;font-size:17px;font-weight:700;padding:16px 40px;border-radius:50px;text-decoration:none;letter-spacing:.3px">
        &#128179; Pay Securely Now &mdash; ${totalStr}
      </a>
    </div>
    <div style="background:#fff8e8;border:1px solid #F5B800;border-radius:8px;padding:14px;font-size:13px;color:#7a5500;margin:16px 0">
      <strong>Reminder:</strong> A 25% deposit is due at signing. Your 10-day cooling off period is in effect from today.
    </div>
    <div style="background:#fff8e8;border:1px solid #F5B800;border-radius:8px;padding:14px;font-size:13px;color:#7a5500;margin:16px 0">
      <strong>Card payment note:</strong> Credit card payments include a 5% processing fee (${feeStr}), already included in the ${totalStr} total above. E-transfer, cash, and cheque have no fee.
    </div>
    <div style="background:#fff;border:1px solid #e9ecef;border-radius:10px;padding:16px;font-size:13px;color:#555;margin-top:16px">
      <strong>&#128274; Secure Payment</strong><br>
      Powered by Stripe &mdash; your card details are never shared with us.
    </div>
    <p style="margin-top:16px;font-size:13px;color:#888">Your secure payment page is at <a href="${checkoutUrl}" style="color:#0a1628">${checkoutUrl.replace('https://','')}</a>. Questions? Call us at <strong>519-712-1431</strong> or reply to this email.</p>
    <p style="margin-top:16px">Best regards,<br><strong>${repName}</strong><br>Core Exteriors<br>
      <a href="mailto:corexteriors@gmail.com" style="color:#0a1628">corexteriors@gmail.com</a>
    </p>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON, N6H 1N6 &nbsp;|&nbsp; 519-712-1431 &nbsp;|&nbsp; corexteriors.ca</p>
  </div>
</div>`,
        attachments,
    });

    return true;
}
