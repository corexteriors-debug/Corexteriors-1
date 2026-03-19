// Generates a single-page service agreement PDF matching the Core Exteriors contract layout.
// Checkboxes are auto-checked from sales technician form data.
// Contractor signature is loaded from api/contractor-sig.png if present.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs   = require('fs');

// ─── Sanitize text for pdf-lib StandardFonts (Latin-1 only) ─────────────────
function s(text) {
    if (!text && text !== 0) return '';
    return String(text)
        .replace(/[\u2018\u2019\u0060]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/\u00B3/g, '3')
        .replace(/[^\x00-\xFF]/g, '?');
}

// generateContractPDF(est, signatureData, paymentUrl)
// paymentUrl is optional — if provided it is printed in the PDF so the client
// can see the payment link directly on the document.
async function generateContractPDF(est, signatureData, paymentUrl) {
    const doc  = await PDFDocument.create();
    const page = doc.addPage([612, 792]); // Letter — single page
    const { width, height } = page.getSize();

    const font   = await doc.embedFont(StandardFonts.Helvetica);
    const bold   = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

    const navy      = rgb(0.08, 0.12, 0.28);
    const black     = rgb(0, 0, 0);
    const gray      = rgb(0.45, 0.45, 0.45);
    const lightGray = rgb(0.80, 0.80, 0.80);
    const rowAlt    = rgb(0.97, 0.97, 0.97);
    const white     = rgb(1, 1, 1);

    const L = 50;   // left margin
    const R = 562;  // right margin
    let y = height - 36;

    // ─── LOGO ────────────────────────────────────────────────────────────────
    try {
        const logoBytes = fs.readFileSync(path.join(__dirname, '../images/logo-mark.png'));
        const logoImg   = await doc.embedPng(logoBytes);
        const logoDims  = logoImg.scaleToFit(40, 40);
        page.drawImage(logoImg, {
            x: (width - logoDims.width) / 2,
            y: y - logoDims.height,
            width: logoDims.width,
            height: logoDims.height,
        });
        y -= logoDims.height + 5;
    } catch (_) { y -= 8; }

    // ─── HEADING ─────────────────────────────────────────────────────────────
    const heading = 'CORE EXTERIORS';
    page.drawText(heading, { x: (width - bold.widthOfTextAtSize(heading, 18)) / 2, y, size: 18, font: bold, color: navy });
    y -= 14;

    const sub = 'Exterior Cleaning Service Agreement';
    page.drawText(sub, { x: (width - font.widthOfTextAtSize(sub, 10)) / 2, y, size: 10, font, color: gray });
    y -= 11;

    const contact = '203 Cambridge St, London ON N6H 1N6  |  519-712-1431  |  corexteriors@gmail.com';
    page.drawText(contact, { x: (width - font.widthOfTextAtSize(contact, 7.5)) / 2, y, size: 7.5, font, color: gray });
    y -= 10;

    const biz = 'ON Business No. 1001470729  |  HST 745847632 RT0001';
    page.drawText(biz, { x: (width - font.widthOfTextAtSize(biz, 7.5)) / 2, y, size: 7.5, font, color: gray });
    y -= 12;

    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.8, color: lightGray });
    y -= 12;

    // ─── CLIENT INFO ─────────────────────────────────────────────────────────
    const clientName     = s(est.clientName    || '');
    const serviceAddress = s(est.address       || est.clientAddress || '');
    const midX           = L + (R - L) / 2 + 10;

    page.drawText('Client Full Name:', { x: L,    y, size: 8.5, font: bold, color: black });
    page.drawText('Service Address:',  { x: midX, y, size: 8.5, font: bold, color: black });
    y -= 12;
    page.drawText(clientName,     { x: L,    y, size: 9.5, font, color: black });
    page.drawText(serviceAddress, { x: midX, y, size: 9.5, font, color: black });
    y -= 7;
    page.drawLine({ start: { x: L,    y }, end: { x: midX - 12, y }, thickness: 0.5, color: lightGray });
    page.drawLine({ start: { x: midX, y }, end: { x: R,          y }, thickness: 0.5, color: lightGray });
    y -= 10;

    const visitDateRaw = est.survey?.visitDate || est.saleDate || '';
    let dateOfService;
    if (visitDateRaw) {
        const parts = visitDateRaw.slice(0, 10).split('-').map(Number);
        dateOfService = new Date(parts[0], parts[1] - 1, parts[2])
            .toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    } else {
        dateOfService = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    page.drawText('Date of Service:', { x: L, y, size: 8.5, font: bold, color: black });
    y -= 12;
    page.drawText(dateOfService, { x: L, y, size: 9.5, font, color: black });
    y -= 7;
    page.drawLine({ start: { x: L, y }, end: { x: midX - 12, y }, thickness: 0.5, color: lightGray });
    y -= 14;

    // ─── SERVICE AND QUOTATION TABLE ─────────────────────────────────────────
    page.drawText('Service and Quotation', { x: L, y, size: 10, font: bold, color: black });
    y -= 12;

    const cbX    = L + 5;
    const descX  = L + 22;
    const qtyX   = R - 160;
    const priceX = R - 44;
    const rowH   = 18; // tighter rows — key to fitting on one page

    // Table header
    page.drawRectangle({ x: L, y: y - rowH + 5, width: R - L, height: rowH, color: rgb(0.93, 0.93, 0.93) });
    page.drawLine({ start: { x: L,          y: y + 5 }, end: { x: L,          y: y - rowH + 5 }, thickness: 0.5, color: lightGray });
    page.drawLine({ start: { x: R,          y: y + 5 }, end: { x: R,          y: y - rowH + 5 }, thickness: 0.5, color: lightGray });
    page.drawLine({ start: { x: L,          y: y - rowH + 5 }, end: { x: R,   y: y - rowH + 5 }, thickness: 0.5, color: lightGray });
    page.drawLine({ start: { x: qtyX - 5,   y: y + 5 }, end: { x: qtyX - 5,  y: y - rowH + 5 }, thickness: 0.4, color: lightGray });
    page.drawLine({ start: { x: priceX - 5, y: y + 5 }, end: { x: priceX - 5, y: y - rowH + 5 }, thickness: 0.4, color: lightGray });
    page.drawText('Service Description', { x: descX,  y: y - 10, size: 8.5, font: bold, color: black });
    page.drawText('Quantity',            { x: qtyX,   y: y - 10, size: 8.5, font: bold, color: black });
    page.drawText('Price',               { x: priceX, y: y - 10, size: 8.5, font: bold, color: black });
    y -= rowH;

    // Service row helpers
    const services   = Array.isArray(est.services)  ? est.services  : [];
    const jobDetails = est.jobDetails || {};

    function isSelected(key) {
        if (jobDetails[key]) return true;
        return services.some(sv => sv.name && sv.name.toLowerCase().includes(key.toLowerCase()));
    }
    function svcPrice(key) {
        const match = services.find(sv => sv.name && sv.name.toLowerCase().includes(key.toLowerCase()));
        if (!match) return '';
        const p = (match.price || '').toString().replace(/^\$/, '');
        return p ? '$' + p : '';
    }
    function deckQty() {
        const d = jobDetails.deck; if (!d) return '';
        const p = [];
        if (d.sqft)      p.push(d.sqft + ' sq ft');
        if (d.condition) p.push('Cond. ' + d.condition + '/5');
        if (d.rails)     p.push('Rails/Stairs');
        if (d.linft)     p.push(d.linft + ' lin ft rotten');
        return p.join(', ');
    }
    function gutterQty() {
        const g = jobDetails.gutter; if (!g) return '';
        return (g.stories ? g.stories + '-storey' : '') + (g.deepClean ? ', Deep Clean' : '');
    }
    function interlockQty() {
        const i = jobDetails.interlock; if (!i) return '';
        const p = [];
        if (i.sqft)                              p.push(i.sqft + ' sq ft');
        if (i.severity && i.severity !== 'none') p.push(i.severity + ' re-level');
        if (i.seal)                              p.push('Sealing');
        return p.join(', ');
    }
    function windowQty() {
        const w = jobDetails.window; if (!w) return '';
        return (w.count ? w.count + ' units' : '') +
               (w.type  ? ' (' + (w.type === 'full' ? 'Int+Ext' : 'Ext only') + ')' : '');
    }
    function sidingQty() {
        const sv = jobDetails.siding; if (!sv) return '';
        return (sv.stories ? sv.stories + '-storey' : '') + (sv.condition ? ', ' + sv.condition : '');
    }
    function gardenQty() {
        const g = jobDetails.garden; if (!g) return '';
        const p = [];
        if (g.mulch)                            p.push(g.mulch + ' yd3 mulch');
        if (g.weeding && g.weeding !== 'none')  p.push(g.weeding + ' weeding');
        if (g.overgrowth)                       p.push(g.overgrowth + 'h overgrowth');
        if (g.edging)                           p.push(g.edging + ' lin ft edging');
        return p.join(', ');
    }

    const rows = [
        { label: 'Deck Restoration', checked: isSelected('deck'),      qty: deckQty(),      price: svcPrice('deck') },
        { label: 'Gutter Cleaning',  checked: isSelected('gutter'),    qty: gutterQty(),    price: svcPrice('gutter') },
        { label: 'Interlock',        checked: isSelected('interlock') || isSelected('hardscape'), qty: interlockQty(), price: svcPrice('interlock') || svcPrice('hardscape') },
        { label: 'Windows',          checked: isSelected('window'),    qty: windowQty(),    price: svcPrice('window') },
        { label: 'Sidings',          checked: isSelected('siding'),    qty: sidingQty(),    price: svcPrice('siding') },
        { label: 'Garden',           checked: isSelected('garden'),    qty: gardenQty(),    price: svcPrice('garden') },
        { label: 'Others:',          checked: false,                   qty: '',             price: '' },
    ];

    rows.forEach((row, i) => {
        const rowY = y;
        const bg   = i % 2 === 0 ? white : rowAlt;
        page.drawRectangle({ x: L, y: rowY - rowH + 3, width: R - L, height: rowH, color: bg });
        page.drawLine({ start: { x: L, y: rowY - rowH + 3 }, end: { x: R, y: rowY - rowH + 3 }, thickness: 0.3, color: lightGray });
        page.drawLine({ start: { x: L, y: rowY + 3 }, end: { x: L, y: rowY - rowH + 3 }, thickness: 0.5, color: lightGray });
        page.drawLine({ start: { x: R, y: rowY + 3 }, end: { x: R, y: rowY - rowH + 3 }, thickness: 0.5, color: lightGray });
        page.drawLine({ start: { x: qtyX - 5,   y: rowY + 3 }, end: { x: qtyX - 5,   y: rowY - rowH + 3 }, thickness: 0.3, color: lightGray });
        page.drawLine({ start: { x: priceX - 5, y: rowY + 3 }, end: { x: priceX - 5, y: rowY - rowH + 3 }, thickness: 0.3, color: lightGray });

        drawCheckbox(page, cbX, rowY - 6, row.checked);
        page.drawText(row.label, { x: descX, y: rowY - 11, size: 9.5, font: bold, color: black });

        if (row.qty) {
            const maxQtyW = priceX - qtyX - 8;
            let qtyText = s(row.qty);
            while (qtyText.length > 3 && font.widthOfTextAtSize(qtyText, 7.5) > maxQtyW) {
                qtyText = qtyText.slice(0, -4) + '...';
            }
            page.drawText(qtyText, { x: qtyX, y: rowY - 11, size: 7.5, font, color: gray });
        }

        const priceText = row.price || '$';
        page.drawText(priceText, { x: R - font.widthOfTextAtSize(priceText, 9.5) - 5, y: rowY - 11, size: 9.5, font, color: black });
        y -= rowH;
    });

    y -= 2;

    // ─── TOTALS ROW ──────────────────────────────────────────────────────────
    const totalRowH = 20;
    const colW = (R - L) / 3;
    [0, 1, 2].forEach(i => {
        page.drawRectangle({ x: L + i * colW, y: y - totalRowH + 3, width: colW, height: totalRowH, borderColor: lightGray, borderWidth: 0.7, color: white });
    });

    const subtotal = (est.subtotal || '$0.00').replace(/^\$/, '');
    const hst      = (est.hst      || '$0.00').replace(/^\$/, '');
    const total    = (est.total    || '$0.00').replace(/^\$/, '');

    page.drawText('Contract Price: $' + subtotal, { x: L + 5,             y: y - 12, size: 8.5, font: bold, color: black });
    page.drawText('HST (13%): $'      + hst,      { x: L + colW + 5,      y: y - 12, size: 8.5, font: bold, color: black });
    page.drawText('Total Due: $'      + total,     { x: L + colW * 2 + 5, y: y - 12, size: 8.5, font: bold, color: black });
    y -= totalRowH + 12;

    // ─── TIMELINE ────────────────────────────────────────────────────────────
    page.drawText('Timeline', { x: L, y, size: 10, font: bold, color: black });
    y -= 12;

    let completionDate = 'TBD';
    if (visitDateRaw) {
        const parts = visitDateRaw.slice(0, 10).split('-').map(Number);
        completionDate = new Date(parts[0], parts[1] - 1, parts[2] + 1)
            .toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    const halfW = (R - L) / 2 - 4;
    page.drawRectangle({ x: L,             y: y - 18, width: halfW, height: 22, borderColor: lightGray, borderWidth: 0.5, color: white });
    page.drawRectangle({ x: L + halfW + 8, y: y - 18, width: halfW, height: 22, borderColor: lightGray, borderWidth: 0.5, color: white });
    page.drawText('Start Date:  ' + dateOfService, { x: L + 6,          y: y - 10, size: 8.5, font: bold, color: black });
    page.drawText('Completion: ' + completionDate, { x: L + halfW + 14, y: y - 10, size: 8.5, font: bold, color: black });
    y -= 28;

    const depositNote = '25% deposit due at signing. Balance due upon completion.';
    page.drawText(depositNote, { x: (width - italic.widthOfTextAtSize(depositNote, 8)) / 2, y, size: 8, font: italic, color: gray });
    y -= 16;

    // ─── PAYMENT LINK (if provided) ──────────────────────────────────────────
    if (paymentUrl) {
        const payLabel = 'Pay online: ';
        const payLabelW = bold.widthOfTextAtSize(payLabel, 7.5);
        const maxUrlW = R - L - payLabelW - 2;
        let urlText = paymentUrl;
        while (urlText.length > 10 && font.widthOfTextAtSize(urlText, 7) > maxUrlW) {
            urlText = urlText.slice(0, -3) + '..';
        }
        page.drawText(payLabel, { x: L, y, size: 7.5, font: bold, color: navy });
        page.drawText(urlText, { x: L + payLabelW, y, size: 7, font, color: rgb(0.1, 0.3, 0.75) });
        y -= 13;
    }

    // ─── TERMS & CONDITIONS ──────────────────────────────────────────────────
    page.drawText('Terms & Conditions', { x: L, y, size: 10, font: bold, color: black });
    y -= 5;
    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.5, color: lightGray });
    y -= 10;

    const termsList = [
        { label: 'Insurance & Safety:',       text: 'CORE EXTERIORS maintains $10 million in General Liability Insurance and is fully covered by WSIB, ensuring protection for both the property and our workers.' },
        { label: 'Weather & Site Conditions:', text: 'Scheduled dates are subject to change based on weather or site accessibility.' },
        { label: 'Amendments & Changes:',      text: 'If during the performance of services, the scope of work is found to differ significantly from the initial assessment (e.g., unexpected surface fragility or incorrect measurements), CORE EXTERIORS reserves the right to adjust the contract price. Any changes will be agreed upon with the Client before proceeding.' },
        { label: 'Liability:',                 text: 'CORE EXTERIORS is not responsible for pre-existing defects, loose materials, or water intrusion from prior construction issues. Total liability is limited to the contract amount.' },
        { label: 'Exclusions:',                text: 'Structural repairs, paint touch-ups, sealing, or landscaping restoration are not included unless specified.' },
    ];

    termsList.forEach(term => {
        const full    = term.label + ' ' + term.text;
        const wrapped = wrapText(full, 115); // wider wrap = fewer lines
        wrapped.forEach((line, idx) => {
            if (idx === 0) {
                const lw = bold.widthOfTextAtSize(term.label, 7.5);
                page.drawText(term.label,                    { x: L,      y, size: 7.5, font: bold, color: black });
                page.drawText(line.slice(term.label.length), { x: L + lw, y, size: 7.5, font,       color: black });
            } else {
                page.drawText(line, { x: L, y, size: 7.5, font, color: black });
            }
            y -= 9; // tight line height — key to fitting T&Cs on one page
        });
    });

    y -= 12;

    // ─── SIGNATURES ──────────────────────────────────────────────────────────
    const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    const sigHalf = (R - L) / 2 - 16;
    const sigAreaH = 44; // height reserved for signature images

    // ── Client signature (left) ───────────────────────────────────────────
    if (signatureData) {
        try {
            const b64      = signatureData.includes(',') ? signatureData.split(',')[1] : signatureData;
            const sigImg   = await doc.embedPng(Buffer.from(b64, 'base64'));
            const dims     = sigImg.scaleToFit(sigHalf - 10, sigAreaH);
            page.drawImage(sigImg, { x: L, y: y - dims.height, width: dims.width, height: dims.height });
        } catch (e) {
            console.error('Client sig embed error:', e.message);
        }
    }

    // ── Contractor signature (right) — loaded from api/contractor-sig.jpg ──
    const contractorSigX = R - sigHalf;
    try {
        const cSigBytes = fs.readFileSync(path.join(__dirname, 'contractor-sig.jpg'));
        const cSigImg   = await doc.embedJpg(cSigBytes);
        const dims      = cSigImg.scaleToFit(sigHalf - 10, sigAreaH);
        page.drawImage(cSigImg, { x: contractorSigX, y: y - dims.height, width: dims.width, height: dims.height });
    } catch (_) {
        // Fallback: italic text if image missing
        page.drawText('Core Exteriors Ltd.', {
            x: contractorSigX, y: y - 28,
            size: 14, font: italic, color: navy,
        });
    }

    // Signature lines
    page.drawLine({ start: { x: L,               y: y - sigAreaH }, end: { x: L + sigHalf,  y: y - sigAreaH }, thickness: 0.7, color: black });
    page.drawLine({ start: { x: contractorSigX,  y: y - sigAreaH }, end: { x: R,             y: y - sigAreaH }, thickness: 0.7, color: black });

    // Labels
    page.drawText('Client Signature',            { x: L,                  y: y - sigAreaH - 10, size: 7.5, font, color: gray });
    page.drawText('Date: ' + dateStr,            { x: L + 100,            y: y - sigAreaH - 10, size: 7.5, font, color: gray });
    page.drawText('Contractor Signature',        { x: contractorSigX,     y: y - sigAreaH - 10, size: 7.5, font, color: gray });
    page.drawText('Date: ' + dateStr,            { x: contractorSigX + 118, y: y - sigAreaH - 10, size: 7.5, font, color: gray });

    return await doc.save();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function drawCheckbox(page, x, y, checked) {
    const sz = 7;
    page.drawRectangle({ x, y: y - sz, width: sz, height: sz, borderColor: rgb(0, 0, 0), borderWidth: 0.8, color: rgb(1, 1, 1) });
    if (checked) {
        page.drawLine({ start: { x: x + 1,   y: y - 4   }, end: { x: x + 3,   y: y - 6   }, thickness: 1.2, color: rgb(0, 0, 0) });
        page.drawLine({ start: { x: x + 3,   y: y - 6   }, end: { x: x + 6.5, y: y - 0.5 }, thickness: 1.2, color: rgb(0, 0, 0) });
    }
}

function wrapText(text, maxChars) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    words.forEach(w => {
        if (!cur) { cur = w; }
        else if ((cur + ' ' + w).length <= maxChars) { cur += ' ' + w; }
        else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines;
}

module.exports = { generateContractPDF };
