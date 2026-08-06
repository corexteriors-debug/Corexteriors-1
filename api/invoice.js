const { kv } = require('@vercel/kv');
const { put } = require('@vercel/blob');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');
const { generateEstimatePDF } = require('./_estimatePdf');
const { buildBrochureAttachments } = require('./_brochures');

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
        const { estimate, documentType, signatureData, paymentRequest, selectedBrochures } = req.body;
        if (!estimate || !estimate.clientName || !estimate.email) {
            return res.status(400).json({ error: 'Estimate data with client email is required' });
        }

        const isInvoice = documentType === 'invoice';
        const docType   = isInvoice ? 'INVOICE' : 'ESTIMATE';
        const pdfBytes  = await generateEstimatePDF(estimate, { docType, signatureData: signatureData || null });

        // Optionally create a Stripe checkout session and embed the link in the email
        let checkoutUrl = null;
        let cardFeeAmount = 0;
        if (paymentRequest && paymentRequest.amount >= 0.50) {
            const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
            if (stripeKey) {
                try {
                    const stripe = new Stripe(stripeKey);
                    const amountCents = Math.round(parseFloat(paymentRequest.amount) * 100);
                    // Credit card payments carry a 5% processing fee, itemized as its
                    // own line so it's disclosed at checkout rather than folded silently
                    // into the total.
                    const feeCents = Math.round(amountCents * 0.05);
                    cardFeeAmount = feeCents / 100;
                    const isDeposit = paymentRequest.type === 'deposit';
                    const session = await stripe.checkout.sessions.create({
                        payment_method_types: ['card'],
                        customer_email: estimate.email,
                        line_items: [
                            {
                                price_data: {
                                    currency: 'cad',
                                    product_data: {
                                        name: isDeposit ? 'Deposit — Core Exteriors' : 'Payment — Core Exteriors',
                                        description: paymentRequest.description || `Services for ${estimate.clientName}`,
                                    },
                                    unit_amount: amountCents,
                                },
                                quantity: 1,
                            },
                            {
                                price_data: {
                                    currency: 'cad',
                                    product_data: {
                                        name: 'Card Processing Fee (5%)',
                                        description: 'Applies to credit card payments only',
                                    },
                                    unit_amount: feeCents,
                                },
                                quantity: 1,
                            },
                        ],
                        mode: 'payment',
                        success_url: `https://corexteriors.ca/sales?payment=success&session_id={CHECKOUT_SESSION_ID}`,
                        cancel_url: `https://corexteriors.ca/sales?payment=cancelled`,
                        metadata: {
                            clientName: estimate.clientName || '',
                            estimateNumber: estimate.estimateNumber || '',
                            paymentType: paymentRequest.type || 'deposit',
                        },
                    });
                    checkoutUrl = session.url;
                } catch (stripeErr) {
                    console.error('Stripe session error in invoice:', stripeErr.message);
                }
            }
        }

        // Personalize any selected brochures (client info drawn onto their own
        // existing page 1) and attach them to this same email, rather than a
        // separate send.
        let brochures = { attachments: [], labels: [] };
        if (Array.isArray(selectedBrochures) && selectedBrochures.length) {
            try {
                brochures = await buildBrochureAttachments({
                    clientName: estimate.clientName,
                    address: estimate.address,
                    phone: estimate.phone,
                    email: estimate.email,
                    selected: selectedBrochures,
                });
            } catch (brochureErr) {
                console.error('Brochure attachment error:', brochureErr.message);
            }
        }

        let photoUrls = [];
        if (Array.isArray(estimate.photos) && estimate.photos.length) {
            try {
                photoUrls = await uploadSitePhotos(estimate.photos, estimate.estimateNumber || estimate.invoiceNumber);
            } catch (photoErr) {
                console.error('Site photo upload error:', photoErr.message);
            }
        }

        const emailSent = await sendDocEmail(estimate, pdfBytes, docType, checkoutUrl, paymentRequest, brochures, photoUrls, cardFeeAmount);

        return res.status(200).json({ success: true, emailSent, paymentLinkSent: !!checkoutUrl });
    } catch (error) {
        console.error('Invoice error:', error);
        return res.status(500).json({ error: 'Failed to generate/send document: ' + error.message });
    }
};

// Site photos arrive as compressed JPEG dataURLs from sales.html. Upload each to
// Vercel Blob and link to the real HTTPS URL — cid-embedded images display fine
// in Gmail but aren't followable as <a href> click targets, so a plain https
// link is what actually lets the client open the full-size photo.
async function uploadSitePhotos(photos, ref) {
    const MAX_PHOTOS = 10;
    const list = (Array.isArray(photos) ? photos : []).slice(0, MAX_PHOTOS);
    const results = await Promise.allSettled(list.map((dataUrl, i) => {
        const match = (dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) return Promise.reject(new Error('Invalid photo format'));
        const ext = (match[1].split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
        const safeRef = (ref || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
        const path = `estimate-photos/${safeRef}/${Date.now()}-${i}.${ext}`;
        return put(path, Buffer.from(match[2], 'base64'), { access: 'public', contentType: match[1], addRandomSuffix: true });
    }));
    return results.filter(r => r.status === 'fulfilled').map(r => r.value.url);
}

async function sendDocEmail(est, pdfBytes, docType, checkoutUrl, paymentRequest, brochures, photoUrls, cardFeeAmount) {
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

    // Payment button block — shown only when a Stripe checkout URL is available
    const paymentBlock = checkoutUrl && paymentRequest ? (() => {
        const isDeposit = paymentRequest.type === 'deposit';
        const baseAmount = parseFloat(paymentRequest.amount);
        const feeAmount  = cardFeeAmount || 0;
        const amountStr  = '$' + (baseAmount + feeAmount).toFixed(2) + ' CAD';
        const feeStr     = '$' + feeAmount.toFixed(2) + ' CAD';
        const payLabel  = isDeposit ? 'Deposit' : 'Payment';
        return `
           <div style="margin:24px 0;text-align:center">
             <p style="font-size:14px;color:#555;margin-bottom:12px">
               ${isDeposit ? 'To confirm your booking, a <strong>25% deposit</strong> is required:' : 'Complete your payment securely below:'}
             </p>
             <a href="${checkoutUrl}"
                style="display:inline-block;background:#F5B800;color:#1A1A1A;font-size:16px;font-weight:700;padding:14px 36px;border-radius:50px;text-decoration:none;letter-spacing:.3px">
               &#128179; Pay ${payLabel} &mdash; ${amountStr}
             </a>
             <p style="font-size:11px;color:#999;margin-top:10px">&#128274; Powered by Stripe &mdash; your card details are never shared with us. Link expires in 24 hours.</p>
             <p style="font-size:12px;color:#7a5500;margin-top:6px">Includes a 5% credit card processing fee (${feeStr}). E-transfer, cash, and cheque have no fee.</p>
           </div>`;
    })() : '';

    const bodyNote = isInvoice
        ? `<p>Please find your invoice attached. Payment is due upon completion of services.</p>
           ${paymentBlock || `<div style="background:#e8f5e9;border:1px solid #27ae60;border-radius:8px;padding:14px;font-size:13px;color:#1b5e20;margin:16px 0">
             <strong>Payment:</strong> E-transfer to <strong>corexteriors@gmail.com</strong> — Cash, cheque, and credit card also accepted (credit card payments include a 5% processing fee).
           </div>`}`
        : `<p>Please find your estimate attached. This estimate is valid for 30 days.</p>
           ${paymentBlock || `<div style="background:#e8f5e9;border:1px solid #27ae60;border-radius:8px;padding:14px;font-size:13px;color:#1b5e20;margin:16px 0">
             <strong>To confirm your booking:</strong> A 25% deposit is required. E-transfer to <strong>corexteriors@gmail.com</strong> or call us. Credit card payments include a 5% processing fee.
           </div>`}`;

    const brochureLabels = (brochures && brochures.labels) || [];
    const brochureNote = brochureLabels.length
        ? `<p>We've also attached a brochure with more info on: <strong>${brochureLabels.join(', ')}</strong>.</p>`
        : '';

    const photoGallery = (photoUrls && photoUrls.length)
        ? `<p style="margin-bottom:8px">Site photos (click a photo to view full size):</p>
           <div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px">
             ${photoUrls.map(url => `<a href="${url}" target="_blank"><img src="${url}" width="140" height="140" style="width:140px;height:140px;object-fit:cover;border-radius:8px;border:1px solid #e9ecef"></a>`).join('')}
           </div>`
        : '';

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
    ${brochureNote}
    ${photoGallery}
    <p>Questions? Reply to this email or call <strong>519-712-1431</strong>.</p>
    <p style="margin-top:16px">Best regards,<br><strong>${repName}</strong><br>Core Exteriors</p>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON &nbsp;|&nbsp; 519-712-1431 &nbsp;|&nbsp; corexteriors.ca</p>
  </div>
</div>`,
        attachments: [
            {
                filename,
                content: Buffer.from(pdfBytes),
                contentType: 'application/pdf',
            },
            ...((brochures && brochures.attachments) || []),
        ],
    });
    return true;
}
