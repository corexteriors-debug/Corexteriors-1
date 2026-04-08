const { kv } = require('@vercel/kv');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { generateContractPDF } = require('./_contractPdf');
const { generateEstimatePDF } = require('./_estimatePdf');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://corexteriors.ca');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'No token provided' });
        const tokenData = await kv.get(`token:${token}`);
        if (!tokenData) return res.status(401).json({ error: 'Invalid token' });

        const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
        if (!stripeKey) {
            return res.status(500).json({ success: false, error: 'Stripe not configured.' });
        }

        const stripe = new Stripe(stripeKey);
        const { clientName, clientEmail, clientPhone, amount, description, leadId, paymentType, estimate, signatureData } = req.body;

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
        const checkoutUrl = session.url; // kept server-side only — never returned to the sales rep

        // Generate contract PDF with payment URL embedded so client can see it on paper
        let contractPdfBytes = null;
        const estData = estimate || { clientName, email: clientEmail };
        try {
            contractPdfBytes = await generateContractPDF(estData, signatureData || null, checkoutUrl);
            console.log('Contract PDF generated, size:', contractPdfBytes.length);
        } catch (err) {
            console.error('Contract PDF error:', err.message);
        }

        // Generate invoice PDF to attach alongside the contract
        let invoicePdfBytes = null;
        try {
            invoicePdfBytes = await generateEstimatePDF(estData, { docType: 'INVOICE' });
        } catch (err) {
            console.error('Invoice PDF error in payment:', err.message);
        }

        // Send ONE email: payment button in body + contract + invoice PDFs attached
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
                contractPdfBytes,
                invoicePdfBytes,
                estimateNumber: estData.estimateNumber,
            });
        } catch (err) {
            console.error('Payment email error:', err.message);
        }

        return res.status(200).json({
            success: true,
            emailSent,
            sessionId: session.id,
            // checkoutUrl intentionally omitted
        });

    } catch (error) {
        console.error('Payment API error:', error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
    }
};

async function sendPaymentEmail({ clientName, clientEmail, amount, checkoutUrl, isDeposit, description, repName, contractPdfBytes, invoicePdfBytes, estimateNumber }) {
    const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailPass) return false;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });

    const amountStr = '$' + amount.toFixed(2) + ' CAD';
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
    if (contractPdfBytes) {
        attachments.push({
            filename: contractNum
                ? 'CoreExteriors_Contract_' + contractNum.replace(/ /g, '_') + '.pdf'
                : 'CoreExteriors_Service_Agreement.pdf',
            content: Buffer.from(contractPdfBytes),
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
        &#128179; Pay Securely Now &mdash; ${amountStr}
      </a>
    </div>
    <div style="background:#fff8e8;border:1px solid #F5B800;border-radius:8px;padding:14px;font-size:13px;color:#7a5500;margin:16px 0">
      <strong>Reminder:</strong> A 25% deposit is due at signing. Your 10-day cooling off period is in effect from today.
    </div>
    <div style="background:#fff;border:1px solid #e9ecef;border-radius:10px;padding:16px;font-size:13px;color:#555;margin-top:16px">
      <strong>&#128274; Secure Payment</strong><br>
      Powered by Stripe &mdash; your card details are never shared with us.
    </div>
    <p style="margin-top:16px;font-size:13px;color:#888">This link expires in 24 hours. Questions? Call us at <strong>519-712-1431</strong> or reply to this email.</p>
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
