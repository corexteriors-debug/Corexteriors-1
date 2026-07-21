const nodemailer = require('nodemailer');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const BROCHURES = {
    deck:      { file: 'CORE_Deck_Restoration_Residential_Brochure.pdf', label: 'Deck Restoration' },
    gutter:    { file: 'CORE_Gutter_Cleaning_and_Guards_Brochure.pdf', label: 'Gutter Cleaning & Guards' },
    interlock: { file: 'CORE_Interlock_Relevel_Polysand_Seal_Brochure.pdf', label: 'Interlock (Relevel/Polysand/Seal)' },
    window:    { file: 'CORE_Window_Cleaning_Residential_Brochure.pdf', label: 'Window Cleaning' },
    powerwash: { file: 'CORE_Power_Washing_Residential_Brochure.pdf', label: 'Power Washing' },
};
const BROCHURE_ORDER = ['deck', 'gutter', 'interlock', 'window', 'powerwash'];

// Latin-1 safe string helper (pdf-lib's StandardFonts can't encode arbitrary unicode)
function s(text) {
    if (!text && text !== 0) return '';
    return String(text)
        .replace(/[‘’`]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/…/g, '...')
        .replace(/[^\x00-\xFF]/g, '?');
}

// Called from api/invoice.js when req.body.action === 'brochures' — kept as a
// non-routable "_"-prefixed module (like _mailer.js/_estimatePdf.js) rather than
// its own api/*.js file, since this project's Hobby plan caps out at 12
// serverless functions and every routable api/*.js file counts against that.
module.exports.handleBrochuresRequest = async function handleBrochuresRequest(req, res) {
    try {
        const { clientName, address, phone, email, salesRep, selected } = req.body || {};
        if (!email) return res.status(400).json({ error: 'Client email is required' });

        const picked = BROCHURE_ORDER.filter(key => Array.isArray(selected) && selected.includes(key));
        if (!picked.length) return res.status(400).json({ error: 'At least one brochure must be selected' });

        const pdfBytes = await buildBrochurePacket({ clientName, address, phone, email, salesRep, picked });
        const emailSent = await sendBrochureEmail({ clientName, email, salesRep, picked, pdfBytes });

        return res.status(200).json({ success: true, emailSent });
    } catch (error) {
        console.error('Brochures error:', error);
        return res.status(500).json({ error: 'Failed to generate/send brochures: ' + error.message });
    }
};

// Builds one PDF: a personalized cover page followed by the full pages of
// each selected brochure, fetched from this site's own static /brochures/ files.
async function buildBrochurePacket({ clientName, address, phone, email, salesRep, picked }) {
    const doc  = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const W = 612, H = 792;
    const ML = 42, MR = 42;
    const CW = W - ML - MR;

    const navy      = rgb(0.04, 0.09, 0.20);
    const blue      = rgb(0.15, 0.35, 0.65);
    const white     = rgb(1, 1, 1);
    const black     = rgb(0, 0, 0);
    const gray      = rgb(0.45, 0.45, 0.45);
    const lightGray = rgb(0.94, 0.95, 0.96);
    const darkGray  = rgb(0.18, 0.18, 0.18);

    const page = doc.addPage([W, H]);
    const issueDate = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    // Header bar
    const HDR = 70;
    page.drawRectangle({ x: 0, y: H - HDR, width: W, height: HDR, color: navy });
    page.drawText('CORE EXTERIORS', { x: ML, y: H - HDR + 36, size: 24, font: bold, color: white });
    page.drawText('Professional Exterior Services', { x: ML, y: H - HDR + 18, size: 9, font, color: rgb(0.65, 0.72, 0.82) });
    const titleW = bold.widthOfTextAtSize('BROCHURES', 28);
    page.drawText('BROCHURES', { x: W - MR - titleW, y: H - HDR + 36, size: 28, font: bold, color: white });

    let y = H - HDR - 26;
    page.drawText('Date: ' + issueDate, { x: ML, y, size: 8.5, font, color: darkGray });
    const repTxt = 'Sales Rep: ' + s(salesRep || 'Core Exteriors Team');
    const repW   = font.widthOfTextAtSize(repTxt, 8.5);
    page.drawText(repTxt, { x: W - MR - repW, y, size: 8.5, font, color: darkGray });
    y -= 18;

    // PREPARED FOR box — name, property address, phone, email
    const boxH = 74;
    page.drawRectangle({ x: ML, y: y - boxH, width: CW, height: boxH, color: lightGray });
    page.drawRectangle({ x: ML, y: y - boxH, width: 3, height: boxH, color: blue });
    page.drawText('PREPARED FOR', { x: ML + 12, y: y - 14, size: 7.5, font: bold, color: blue });
    page.drawText(s(clientName || '—'), { x: ML + 12, y: y - 27, size: 12, font: bold, color: black });
    page.drawText(s(address || ''), { x: ML + 12, y: y - 41, size: 8.5, font, color: gray });
    const contactLine = [s(phone || ''), s(email || '')].filter(Boolean).join('  |  ');
    page.drawText(contactLine, { x: ML + 12, y: y - 54, size: 8.5, font, color: gray });
    y -= boxH + 24;

    // Included brochures list
    page.drawText('THIS PACKAGE INCLUDES', { x: ML, y, size: 9, font: bold, color: navy });
    y -= 18;
    picked.forEach(key => {
        page.drawText('-  ' + s(BROCHURES[key].label), { x: ML + 8, y, size: 10, font, color: darkGray });
        y -= 16;
    });

    // Footer bar
    page.drawRectangle({ x: 0, y: 0, width: W, height: 38, color: navy });
    const footerTxt = 'Core Exteriors  |  203 Cambridge St, London, ON, N6H 1N6  |  519-712-1431  |  corexteriors.ca';
    const ftw = font.widthOfTextAtSize(footerTxt, 8);
    page.drawText(footerTxt, { x: (W - ftw) / 2, y: 14, size: 8, font, color: rgb(0.55, 0.63, 0.74) });

    // Append each selected brochure's real pages, fixed order regardless of click order
    const siteUrl = (process.env.SITE_URL || 'https://corexteriors.ca').replace(/\/$/, '');
    for (const key of picked) {
        const { file } = BROCHURES[key];
        const resp = await fetch(`${siteUrl}/brochures/${encodeURIComponent(file)}`);
        if (!resp.ok) throw new Error(`Could not fetch brochure: ${file}`);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const srcDoc = await PDFDocument.load(bytes);
        const copiedPages = await doc.copyPages(srcDoc, srcDoc.getPageIndices());
        copiedPages.forEach(p => doc.addPage(p));
    }

    return doc.save();
}

async function sendBrochureEmail({ clientName, email, salesRep, picked, pdfBytes }) {
    const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailPass) return false;

    const adminEmail   = process.env.ADMIN_EMAIL || gmailUser;
    const repName      = salesRep || 'Core Exteriors Team';
    const brochureList = picked.map(key => BROCHURES[key].label).join(', ');

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
        from: '"Core Exteriors" <' + gmailUser + '>',
        to: email,
        cc: adminEmail,
        subject: 'More info from Core Exteriors: ' + brochureList,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#0a1628;padding:24px 32px;border-radius:12px 12px 0 0;border-bottom:4px solid #e67e22">
    <h1 style="color:#fff;margin:0;font-size:22px">Core Exteriors</h1>
    <p style="color:#8899aa;margin:6px 0 0;font-size:13px">Professional Exterior Services — London, Ontario</p>
  </div>
  <div style="padding:32px;background:#f8f9fa;border:1px solid #e9ecef;border-top:none">
    <p style="font-size:16px">Hi <strong>${clientName || 'there'}</strong>,</p>
    <p>As requested, please find attached more information about: <strong>${brochureList}</strong>.</p>
    <p>Questions? Reply to this email or call <strong>519-712-1431</strong>.</p>
    <p style="margin-top:16px">Best regards,<br><strong>${repName}</strong><br>Core Exteriors</p>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON &nbsp;|&nbsp; 519-712-1431 &nbsp;|&nbsp; corexteriors.ca</p>
  </div>
</div>`,
        attachments: [{
            filename: 'CoreExteriors_Brochures_' + (clientName || 'Client').replace(/[^a-z0-9]+/gi, '_') + '.pdf',
            content: Buffer.from(pdfBytes),
            contentType: 'application/pdf',
        }],
    });
    return true;
}
