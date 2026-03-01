const { kv } = require('@vercel/kv');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { generateContractPDF } = require('./_contractPdf');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://corexteriors.ca');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Auth check
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'No token provided' });
        const tokenData = await kv.get(`token:${token}`);
        if (!tokenData) return res.status(401).json({ error: 'Invalid token' });

        const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
        if (!stripeKey) {
            return res.status(500).json({ success: false, error: 'Stripe not configured.' });
        }

        const stripe = new Stripe(stripeKey);
        const { clientName, clientEmail, clientPhone, amount, description, leadId, paymentType } = req.body;

        if (!clientEmail || !amount) {
            return res.status(400).json({ error: 'Client email and amount are required' });
        }

        const amountCents = Math.round(parseFloat(amount) * 100);
        if (amountCents < 50) {
            return res.status(400).json({ error: 'Amount must be at least $0.50' });
        }

        const isDeposit = paymentType === 'deposit';
        const productName = isDeposit ? 'Deposit — Core Exteriors' : 'Payment — Core Exteriors';

        // Create Stripe Checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: clientEmail,
            line_items: [{
                price_data: {
                    currency: 'cad',
                    product_data: {
                        name: productName,
                        description: description || `Service payment for ${clientName || 'Client'}`,
                    },
                    unit_amount: amountCents,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `https://corexteriors.ca/sales?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `https://corexteriors.ca/sales?payment=cancelled`,
            metadata: {
                leadId: leadId || '',
                clientName: clientName || '',
                paymentType: paymentType || 'full',
            },
        });

        // Update lead with pending payment info
        if (leadId) {
            const lead = await kv.get(`lead:${leadId}`);
            if (lead) {
                lead.stripeSessionId = session.id;
                lead.paymentStatus = 'Pending';
                lead.paymentMethod = 'Credit Card';
                lead.paymentAmount = parseFloat(amount);
                lead.paymentType = paymentType || 'full';
                lead.updatedAt = new Date().toISOString();
                await kv.set(`lead:${leadId}`, lead);
            }
        }

        const repName = tokenData.repName || 'Core Exteriors Team';
        const checkoutUrl = session.url; // kept server-side only — never sent to the sales rep

        // Fetch lead data to build the contract (if leadId provided)
        let leadData = null;
        if (leadId) {
            try { leadData = await kv.get(`lead:${leadId}`); } catch (_) {}
        }

        // Generate payment request PDF (with Stripe link)
        let paymentPdfBytes = null;
        try {
            paymentPdfBytes = await generatePaymentPDF({
                clientName: clientName || 'Valued Customer',
                clientEmail,
                amount: parseFloat(amount),
                checkoutUrl,
                isDeposit,
                description: description || 'Exterior Services',
                repName,
            });
        } catch (err) {
            console.error('Payment PDF error:', err);
        }

        // Generate contract PDF from lead data (no client signature at payment stage)
        let contractPdfBytes = null;
        if (leadData) {
            try {
                contractPdfBytes = await generateContractPDF(leadData, null);
            } catch (err) {
                console.error('Contract PDF error:', err);
            }
        }

        // Send email to customer (payment request + contract both attached)
        let emailSent = false;
        try {
            emailSent = await sendPaymentEmail({
                clientName: clientName || 'Valued Customer',
                clientEmail,
                amount: parseFloat(amount),
                checkoutUrl,
                isDeposit,
                description: description || 'Exterior Services',
                repName,
                paymentPdfBytes,
                contractPdfBytes,
            });
        } catch (err) {
            console.error('Payment email error:', err);
        }

        // Send SMS — short notification only (no URL to avoid carrier filtering)
        let smsSent = false;
        if (clientPhone) {
            try {
                smsSent = await sendPaymentSms({
                    clientName: clientName || 'there',
                    clientPhone,
                    amount: parseFloat(amount),
                    isDeposit,
                });
            } catch (err) {
                console.error('Payment SMS error:', err);
            }
        }

        // Return success WITHOUT exposing the checkout URL to the sales rep
        return res.status(200).json({
            success: true,
            emailSent,
            smsSent,
            sessionId: session.id,
            // checkoutUrl intentionally omitted
        });

    } catch (error) {
        console.error('Payment API error:', error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
    }
};

async function generatePaymentPDF({ clientName, clientEmail, amount, checkoutUrl, isDeposit, description, repName }) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 400]); // shorter page — payment request only
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();

    const darkBlue = rgb(0.04, 0.09, 0.16);
    const gold = rgb(0.96, 0.72, 0.0);
    const green = rgb(0.18, 0.68, 0.34);
    const gray = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.85, 0.85, 0.85);
    const black = rgb(0, 0, 0);
    const white = rgb(1, 1, 1);

    const amountStr = '$' + amount.toFixed(2) + ' CAD';
    const label = isDeposit ? 'Deposit' : 'Payment';
    const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    // Header
    page.drawRectangle({ x: 0, y: height - 65, width, height: 65, color: darkBlue });
    page.drawText('CORE EXTERIORS', { x: 50, y: height - 32, size: 18, font: bold, color: white });
    page.drawText('Professional Exterior Services — London, Ontario', { x: 50, y: height - 50, size: 9, font, color: rgb(0.6, 0.7, 0.8) });
    page.drawText('PAYMENT REQUEST', { x: width - 190, y: height - 32, size: 14, font: bold, color: gold });
    page.drawText(today, { x: width - 190, y: height - 50, size: 9, font, color: rgb(0.6, 0.7, 0.8) });

    let y = height - 85;

    // Gold divider
    page.drawRectangle({ x: 45, y, width: width - 90, height: 3, color: gold });
    y -= 20;

    // Client info
    page.drawText('PREPARED FOR', { x: 50, y, size: 8, font: bold, color: rgb(0.2, 0.4, 0.7) });
    y -= 16;
    page.drawText(clientName, { x: 50, y, size: 13, font: bold, color: black });
    y -= 14;
    page.drawText(clientEmail, { x: 50, y, size: 9, font, color: gray });
    y -= 22;

    // Divider
    page.drawLine({ start: { x: 45, y }, end: { x: width - 45, y }, thickness: 1, color: lightGray });
    y -= 18;

    // Service description
    page.drawText('SERVICE', { x: 50, y, size: 8, font: bold, color: rgb(0.2, 0.4, 0.7) });
    y -= 14;
    // Wrap description if needed
    const descWords = description.split(' ');
    let line = '';
    descWords.forEach(w => {
        if ((line + ' ' + w).trim().length > 75) {
            page.drawText(line.trim(), { x: 50, y, size: 10, font, color: black });
            y -= 14;
            line = w;
        } else {
            line += ' ' + w;
        }
    });
    if (line.trim()) { page.drawText(line.trim(), { x: 50, y, size: 10, font, color: black }); y -= 14; }
    y -= 10;

    // Divider
    page.drawLine({ start: { x: 45, y }, end: { x: width - 45, y }, thickness: 1, color: lightGray });
    y -= 18;

    // Amount box
    page.drawRectangle({ x: 45, y: y - 40, width: width - 90, height: 48, color: rgb(0.96, 0.99, 0.97), borderColor: green, borderWidth: 1 });
    page.drawText(label.toUpperCase() + ' AMOUNT DUE', { x: 55, y: y - 10, size: 9, font: bold, color: gray });
    page.drawText(amountStr, { x: 55, y: y - 28, size: 22, font: bold, color: green });
    page.drawText('Powered by Stripe — secure payment processing', { x: width - 270, y: y - 18, size: 8, font, color: gray });
    y -= 60;

    // Payment link
    page.drawText('SECURE PAYMENT LINK', { x: 50, y, size: 8, font: bold, color: rgb(0.2, 0.4, 0.7) });
    y -= 14;
    // Wrap the URL across lines so it fits
    const urlChunkSize = 80;
    for (let i = 0; i < checkoutUrl.length; i += urlChunkSize) {
        page.drawText(checkoutUrl.slice(i, i + urlChunkSize), { x: 50, y, size: 7.5, font, color: rgb(0.1, 0.3, 0.7) });
        y -= 11;
    }
    y -= 8;
    page.drawText('This link expires in 24 hours. Open it in any browser to pay securely.', { x: 50, y, size: 8, font, color: gray });
    y -= 20;

    // Footer
    page.drawRectangle({ x: 0, y: 0, width, height: 28, color: darkBlue });
    page.drawText(
        'Core Exteriors  |  203 Cambridge St, London, ON, N6H 1N6  |  606 616 2026  |  corexteriors.ca',
        { x: 65, y: 9, size: 7.5, font, color: rgb(0.6, 0.7, 0.8) }
    );

    return await doc.save();
}

async function sendPaymentEmail({ clientName, clientEmail, amount, checkoutUrl, isDeposit, description, repName, paymentPdfBytes, contractPdfBytes }) {
    const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailPass) return false;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });

    const amountStr = '$' + amount.toFixed(2) + ' CAD';
    const label = isDeposit ? 'Deposit' : 'Payment';

    const attachments = [];
    if (paymentPdfBytes) {
        attachments.push({
            filename: 'CoreExteriors_' + label + '_Request.pdf',
            content: Buffer.from(paymentPdfBytes),
            contentType: 'application/pdf',
        });
    }
    if (contractPdfBytes) {
        attachments.push({
            filename: 'CoreExteriors_Service_Agreement.pdf',
            content: Buffer.from(contractPdfBytes),
            contentType: 'application/pdf',
        });
    }

    await transporter.sendMail({
        from: '"Core Exteriors" <' + gmailUser + '>',
        to: clientEmail,
        subject: `Your Core Exteriors ${label} Link — ${amountStr}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#0a1628;padding:24px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">Core Exteriors</h1>
    <p style="color:#8899aa;margin:6px 0 0;font-size:13px">Professional Exterior Services — London, Ontario</p>
  </div>
  <div style="padding:32px;background:#f8f9fa;border:1px solid #e9ecef;border-top:none">
    <p style="font-size:16px">Hi <strong>${clientName}</strong>,</p>
    <p>Your secure payment link is ready. Click the button below to complete your ${label.toLowerCase()} of <strong style="color:#27ae60;font-size:18px">${amountStr}</strong>.</p>
    <p style="color:#666;font-size:13px;margin-bottom:6px"><strong>Services:</strong> ${description}</p>
    <div style="text-align:center;margin:32px 0">
      <a href="${checkoutUrl}"
         style="display:inline-block;background:#F5B800;color:#1A1A1A;font-size:17px;font-weight:700;padding:16px 40px;border-radius:50px;text-decoration:none;letter-spacing:.3px">
        💳 Pay Securely Now — ${amountStr}
      </a>
    </div>
    <div style="background:#fff;border:1px solid #e9ecef;border-radius:10px;padding:16px;font-size:13px;color:#555">
      <strong>🔒 Secure Payment</strong><br>
      Powered by Stripe — the world's most trusted payment platform. Your card details are never shared with us.
    </div>
    <p style="margin-top:16px;font-size:13px;color:#666">Your <strong>payment request</strong> and <strong>service agreement</strong> are attached as PDFs for your records.</p>
    <p style="margin-top:8px;font-size:13px;color:#888">This link expires in 24 hours. Questions? Call us at <strong>606 616 2026</strong> or reply to this email.</p>
    <p style="margin-top:16px">Best regards,<br><strong>${repName}</strong><br>Core Exteriors</p>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON, N6H 1N6 &nbsp;|&nbsp; 606 616 2026 &nbsp;|&nbsp; corexteriors.ca</p>
  </div>
</div>`,
        attachments,
    });

    return true;
}

async function sendPaymentSms({ clientName, clientPhone, amount, isDeposit }) {
    const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const fromPhone = (process.env.TWILIO_PHONE_NUMBER || '').trim();

    if (!accountSid || !authToken || !fromPhone) return false;

    const amountStr = '$' + amount.toFixed(2);
    const label = isDeposit ? 'deposit' : 'payment';

    // Clean phone number — ensure E.164 format
    let to = clientPhone.replace(/\D/g, '');
    if (to.length === 10) to = '+1' + to;
    else if (!to.startsWith('+')) to = '+' + to;

    // Short message — no URL (avoids carrier filtering & trial account URL restrictions)
    // The payment link is in the email attachment and email body
    const message = `Hi ${clientName}! Core Exteriors has sent your ${label} request of ${amountStr} CAD. Please check your email for the secure payment link. Questions? Call 606-616-2026.`;

    const body = new URLSearchParams({ To: to, From: fromPhone, Body: message });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.error('Twilio SMS error:', err);
    }

    return response.ok;
}
