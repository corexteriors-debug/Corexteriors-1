const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');

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

    try {
        const { estimate, documentType, leadId } = req.body;
        const docType = documentType === 'invoice' ? 'invoice' : 'estimate';
        if (!estimate || !estimate.clientName || !estimate.email) {
            return res.status(400).json({ error: 'Client data with email is required' });
        }

        // ── Create Stripe Checkout Session for invoices ──────────────
        let checkoutUrl = null;
        let stripeAmount = null;
        let isDeposit = false;
        if (docType === 'invoice') {
            const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
            if (stripeKey) {
                try {
                    const stripe = new Stripe(stripeKey);
                    const totalNum = parseFloat(String(estimate.total || '0').replace(/[$,]/g, '')) || 0;

                    // Use deposit amount if admin selected Deposit and specified an amount
                    const { paymentStatus, paymentAmount } = req.body;
                    isDeposit = paymentStatus === 'Deposit';
                    if (isDeposit && paymentAmount && parseFloat(paymentAmount) > 0) {
                        stripeAmount = parseFloat(paymentAmount);
                    } else {
                        stripeAmount = totalNum;
                    }

                    if (stripeAmount >= 0.50) {
                        const amountCents = Math.round(stripeAmount * 100);
                        const productLabel = isDeposit ? 'Deposit — Core Exteriors' : 'Invoice Payment — Core Exteriors';
                        const session = await stripe.checkout.sessions.create({
                            payment_method_types: ['card'],
                            customer_email: estimate.email,
                            line_items: [{
                                price_data: {
                                    currency: 'cad',
                                    product_data: {
                                        name: productLabel,
                                        description: estimate.serviceType
                                            ? `Services: ${estimate.serviceType}`
                                            : `Invoice ${estimate.estimateNumber || ''} for ${estimate.clientName}`,
                                    },
                                    unit_amount: amountCents,
                                },
                                quantity: 1,
                            }],
                            mode: 'payment',
                            success_url: 'https://corexteriors.ca/?payment=success',
                            cancel_url: 'https://corexteriors.ca/?payment=cancelled',
                            metadata: {
                                leadId: leadId || '',
                                clientName: estimate.clientName || '',
                                paymentType: isDeposit ? 'deposit' : 'full',
                            },
                        });
                        checkoutUrl = session.url;
                        console.log('Stripe session created for invoice:', session.id, isDeposit ? '(deposit)' : '(full)');
                    }
                } catch (stripeErr) {
                    console.error('Stripe session error (non-fatal):', stripeErr.message);
                    // Continue without payment link — email will still be sent
                }
            } else {
                console.warn('STRIPE_SECRET_KEY not set — invoice sent without payment link');
            }
        }

        // Generate PDF
        const pdfBytes = await generateInvoicePDF(estimate, docType, checkoutUrl);

        // Send email
        const emailSent = await sendInvoiceEmail(estimate, pdfBytes, docType, checkoutUrl, isDeposit, stripeAmount);

        return res.status(200).json({ success: true, emailSent });
    } catch (error) {
        console.error('Invoice error:', error);
        return res.status(500).json({ error: 'Failed to generate/send invoice: ' + error.message });
    }
};

async function generateInvoicePDF(est, docType, checkoutUrl) {
    const isInvoice = docType === 'invoice';
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]); // Letter size
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();

    const blue = rgb(0.2, 0.4, 0.7);
    const darkBlue = rgb(0.04, 0.09, 0.16);
    const green = rgb(0.18, 0.68, 0.34);
    const gray = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.85, 0.85, 0.85);
    const black = rgb(0, 0, 0);
    const white = rgb(1, 1, 1);

    let y = height - 50;

    // Header bar
    page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: darkBlue });
    page.drawText('CORE EXTERIORS', { x: 50, y: height - 45, size: 22, font: fontBold, color: white });
    page.drawText('Professional Exterior Services', { x: 50, y: height - 65, size: 10, font, color: rgb(0.6, 0.7, 0.8) });
    page.drawText(isInvoice ? 'INVOICE' : 'ESTIMATE', { x: width - 150, y: height - 45, size: 20, font: fontBold, color: white });
    page.drawText(est.estimateNumber || '', { x: width - 150, y: height - 62, size: 9, font, color: rgb(0.6, 0.7, 0.8) });

    y = height - 110;

    // Date & Rep
    page.drawText('Date: ' + new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }), { x: 50, y, size: 9, font, color: gray });
    page.drawText('Sales Rep: ' + (est.salesRep || ''), { x: 350, y, size: 9, font, color: gray });
    y -= 30;

    // Client info box
    page.drawRectangle({ x: 45, y: y - 55, width: width - 90, height: 60, color: rgb(0.96, 0.96, 0.98), borderColor: lightGray, borderWidth: 1 });
    page.drawText('PREPARED FOR', { x: 55, y: y - 5, size: 8, font: fontBold, color: blue });
    page.drawText(est.clientName || '', { x: 55, y: y - 20, size: 11, font: fontBold, color: black });
    const clientDetails = [est.address, est.phone, est.email].filter(Boolean).join('  |  ');
    page.drawText(clientDetails, { x: 55, y: y - 35, size: 9, font, color: gray });
    y -= 85;

    // Services table header
    page.drawRectangle({ x: 45, y: y - 15, width: width - 90, height: 20, color: darkBlue });
    page.drawText('SERVICE', { x: 55, y: y - 10, size: 9, font: fontBold, color: white });
    page.drawText('AMOUNT', { x: width - 130, y: y - 10, size: 9, font: fontBold, color: white });
    y -= 30;

    // Service rows
    const services = est.services || [];
    services.forEach((svc, i) => {
        const bgColor = i % 2 === 0 ? rgb(0.98, 0.98, 1) : white;
        page.drawRectangle({ x: 45, y: y - 12, width: width - 90, height: 22, color: bgColor });
        page.drawText(svc.name || '', { x: 55, y: y - 7, size: 10, font, color: black });
        page.drawText(svc.price || '', { x: width - 130, y: y - 7, size: 10, font, color: black });
        y -= 22;
    });

    y -= 15;

    // Divider
    page.drawLine({ start: { x: 350, y }, end: { x: width - 45, y }, thickness: 1, color: lightGray });
    y -= 20;

    // Bundle discount
    if (est.bundleDiscount && est.bundleDiscount > 0) {
        page.drawText('Bundle Discount:', { x: 350, y, size: 10, font, color: gray });
        page.drawText('($' + est.bundleDiscount.toFixed(2) + ')', { x: width - 130, y, size: 10, font, color: rgb(0.9, 0.5, 0.1) });
        y -= 18;
    }

    // Subtotal
    page.drawText('Subtotal:', { x: 350, y, size: 10, font, color: gray });
    page.drawText(est.subtotal || '$0.00', { x: width - 130, y, size: 10, font, color: black });
    y -= 18;

    // HST
    page.drawText('HST (13%):', { x: 350, y, size: 10, font, color: gray });
    page.drawText(est.hst || '$0.00', { x: width - 130, y, size: 10, font, color: black });
    y -= 5;

    page.drawLine({ start: { x: 350, y }, end: { x: width - 45, y }, thickness: 1, color: blue });
    y -= 20;

    // Total
    page.drawText(isInvoice ? 'TOTAL DUE:' : 'TOTAL ESTIMATE:', { x: 350, y, size: 12, font: fontBold, color: darkBlue });
    page.drawText(est.total || '$0.00', { x: width - 130, y, size: 14, font: fontBold, color: green });
    y -= 40;

    // Payment link notice on PDF
    if (checkoutUrl && isInvoice) {
        page.drawRectangle({ x: 45, y: y - 25, width: width - 90, height: 30, color: rgb(0.96, 0.93, 0.84), borderColor: rgb(0.95, 0.72, 0), borderWidth: 1 });
        page.drawText('PAY ONLINE:', { x: 55, y: y - 10, size: 9, font: fontBold, color: rgb(0.48, 0.33, 0) });
        page.drawText('Check your email for a secure payment link, or visit corexteriors.ca', { x: 145, y: y - 10, size: 9, font, color: rgb(0.48, 0.33, 0) });
        y -= 45;
    }

    // Notes
    if (est.notes) {
        page.drawText('NOTES', { x: 55, y, size: 9, font: fontBold, color: blue });
        y -= 15;
        const noteLines = wrapText(est.notes, 80);
        noteLines.forEach(line => {
            page.drawText(line, { x: 55, y, size: 9, font, color: gray });
            y -= 14;
        });
        y -= 10;
    }

    // Terms
    y = Math.min(y, 150);
    page.drawLine({ start: { x: 45, y }, end: { x: width - 45, y }, thickness: 1, color: lightGray });
    y -= 18;
    page.drawText('TERMS & CONDITIONS', { x: 55, y, size: 8, font: fontBold, color: blue });
    y -= 14;
    const terms = isInvoice ? [
        'Payment is due upon receipt unless otherwise agreed.',
        'A 25% deposit is required to confirm the booking.',
        '10 day cooling off period applies as per Ontario consumer protection.',
        'Core Exteriors is fully insured and WSIB covered.',
    ] : [
        'This estimate is valid for 30 days from the date of issue.',
        'A 25% deposit is required to confirm the booking.',
        '10 day cooling off period applies as per Ontario consumer protection.',
        'Core Exteriors is fully insured and WSIB covered.',
    ];
    terms.forEach(t => {
        page.drawText('• ' + t, { x: 55, y, size: 7.5, font, color: gray });
        y -= 12;
    });

    // Footer
    page.drawRectangle({ x: 0, y: 0, width, height: 35, color: darkBlue });
    page.drawText('Core Exteriors  |  203 Cambridge St, London, ON, N6H 1N6  |  606 616 2026  |  corexteriors.ca', { x: 80, y: 14, size: 8, font, color: rgb(0.6, 0.7, 0.8) });

    return await doc.save();
}

function wrapText(text, maxChars) {
    const words = text.split(' ');
    const lines = [];
    let current = '';
    words.forEach(w => {
        if ((current + ' ' + w).length > maxChars) {
            lines.push(current.trim());
            current = w;
        } else {
            current += ' ' + w;
        }
    });
    if (current.trim()) lines.push(current.trim());
    return lines;
}

async function sendInvoiceEmail(est, pdfBytes, docType, checkoutUrl, isDeposit, stripeAmount) {
    const isInvoice = docType === 'invoice';
    const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    if (!gmailPass) {
        console.error('GMAIL_APP_PASSWORD not set');
        return false;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass }
    });

    const filePrefix = isInvoice ? 'CoreExteriors_Invoice_' : 'CoreExteriors_Estimate_';
    const fileName = filePrefix + (est.estimateNumber || 'Unknown').replace(/ /g, '_') + '.pdf';
    const totalDisplay = est.total || '$0.00';
    const payAmountDisplay = stripeAmount ? '$' + stripeAmount.toFixed(2) : totalDisplay;
    const payLabel = isDeposit ? 'Pay Deposit' : 'Pay Now';

    // Build payment button HTML (only for invoices with a checkout URL)
    const paymentButtonHtml = (isInvoice && checkoutUrl) ? `
          <div style="text-align:center;margin:28px 0">
            <a href="${checkoutUrl}"
               style="display:inline-block;background:#F5B800;color:#1A1A1A;font-size:17px;font-weight:700;padding:16px 40px;border-radius:50px;text-decoration:none;letter-spacing:.3px">
              &#128179; ${payLabel} — ${payAmountDisplay} CAD
            </a>
          </div>
          <div style="background:#fff8e8;border:1px solid #F5B800;border-radius:8px;padding:14px;font-size:13px;color:#7a5500;margin:16px 0">
            <strong>Secure Payment:</strong> Click the button above to pay securely via Stripe. Your card details are never shared with us.
          </div>
    ` : '';

    const paymentNote = (isInvoice && checkoutUrl)
        ? 'You can pay securely online using the button above, or contact us to arrange an alternative payment method.'
        : (isInvoice
            ? 'Payment is due upon receipt unless otherwise agreed. Please contact us if you have any questions about this invoice.'
            : 'This estimate is valid for 30 days. A 25% deposit is required to confirm your booking.');

    const mailOptions = {
        from: '"Core Exteriors" <' + gmailUser + '>',
        to: est.email,
        subject: isInvoice
            ? 'Your Invoice from Core Exteriors | ' + (est.estimateNumber || '')
            : 'Your Estimate from Core Exteriors | ' + (est.estimateNumber || ''),
        html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
        <div style="background:#0a1628;padding:20px 30px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:22px">Core Exteriors</h1>
          <p style="color:#8899aa;margin:5px 0 0;font-size:13px">Professional Exterior Services</p>
        </div>
        <div style="padding:30px;background:#f8f9fa;border:1px solid #e9ecef">
          <p>Hi <strong>${est.clientName}</strong>,</p>
          <p>${isInvoice
              ? 'Thank you for choosing Core Exteriors! Please find your invoice attached as a PDF.'
              : 'Thank you for your interest in Core Exteriors! Please find your estimate attached as a PDF.'
          }</p>
          <table style="width:100%;margin:20px 0;border-collapse:collapse">
            <tr style="background:#0a1628;color:#fff">
              <td style="padding:10px 15px;font-weight:bold;border-radius:8px 0 0 0">${isInvoice ? 'Invoice #' : 'Estimate #'}</td>
              <td style="padding:10px 15px;text-align:right;border-radius:0 8px 0 0">${est.estimateNumber || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding:10px 15px;border-bottom:1px solid #e9ecef">${isInvoice ? 'Total Due' : 'Total Estimate'}</td>
              <td style="padding:10px 15px;text-align:right;font-weight:bold;color:#27ae60;font-size:18px;border-bottom:1px solid #e9ecef">${totalDisplay}</td>
            </tr>
          </table>
          ${paymentButtonHtml}
          <p style="color:#666;font-size:13px">${paymentNote}</p>
          <p>If you have any questions, feel free to reply to this email or call us at <strong>606 616 2026</strong>.</p>
          <p style="margin-top:20px">Best regards,<br><strong>${est.salesRep || 'Core Exteriors Team'}</strong><br>Core Exteriors</p>
        </div>
        <div style="background:#0a1628;padding:15px 30px;border-radius:0 0 12px 12px;text-align:center">
          <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON, N6H 1N6 | 606 616 2026 | corexteriors.ca</p>
        </div>
      </div>
    `,
        attachments: [{
            filename: fileName,
            content: Buffer.from(pdfBytes),
            contentType: 'application/pdf'
        }]
    };

    await transporter.sendMail(mailOptions);
    return true;
}
