// Generates a service agreement PDF matching the official Core Exteriors contract layout.
// Checkboxes are auto-checked based on services selected by the sales technician.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs   = require('fs');

// ─── Sanitize text for pdf-lib StandardFonts (Latin-1 only) ─────────────────
// Replaces characters outside Latin-1 with safe ASCII equivalents so pdf-lib
// never throws "WinAnsi cannot encode" errors from user-entered text.
function s(text) {
    if (!text && text !== 0) return '';
    return String(text)
        .replace(/[\u2018\u2019\u0060]/g, "'")   // curly/backtick quotes → '
        .replace(/[\u201C\u201D]/g, '"')           // curly double quotes → "
        .replace(/[\u2013\u2014]/g, '-')           // en/em dash → -
        .replace(/\u2026/g, '...')                 // ellipsis → ...
        .replace(/\u00B3/g, '3')                   // ³ → 3  (pdf-lib Helvetica misses it)
        .replace(/[^\x00-\xFF]/g, '?');            // anything else non-Latin1 → ?
}

async function generateContractPDF(est, signatureData) {
    const doc  = await PDFDocument.create();
    const page = doc.addPage([612, 792]); // Letter size
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

    const L = 54;   // left margin
    const R = 558;  // right margin
    let y = height - 44;

    // ─── LOGO ────────────────────────────────────────────────────────────────
    try {
        const logoPath = path.join(__dirname, '../images/logo-mark.png');
        const logoBytes = fs.readFileSync(logoPath);
        const logoImg   = await doc.embedPng(logoBytes);
        const logoDims  = logoImg.scaleToFit(52, 52);
        page.drawImage(logoImg, {
            x: (width - logoDims.width) / 2,
            y: y - logoDims.height,
            width: logoDims.width,
            height: logoDims.height,
        });
        y -= logoDims.height + 8;
    } catch (_) {
        y -= 10;
    }

    // ─── HEADING ─────────────────────────────────────────────────────────────
    const heading = 'CORE EXTERIORS';
    page.drawText(heading, {
        x: (width - bold.widthOfTextAtSize(heading, 20)) / 2,
        y, size: 20, font: bold, color: navy,
    });
    y -= 17;

    const sub = 'Exterior Cleaning Service Agreement';
    page.drawText(sub, {
        x: (width - font.widthOfTextAtSize(sub, 11)) / 2,
        y, size: 11, font, color: gray,
    });
    y -= 13;

    const contact = '203 Cambridge St, London ON N6H 1N6  |  519-712-1431  |  corexteriors@gmail.com';
    page.drawText(contact, {
        x: (width - font.widthOfTextAtSize(contact, 8)) / 2,
        y, size: 8, font, color: gray,
    });
    y -= 11;

    const biz = 'ON Business No. 1001470729  |  HST 745847632 RT0001';
    page.drawText(biz, {
        x: (width - font.widthOfTextAtSize(biz, 8)) / 2,
        y, size: 8, font, color: gray,
    });
    y -= 14;

    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.8, color: lightGray });
    y -= 16;

    // ─── CLIENT INFO ─────────────────────────────────────────────────────────
    const clientName     = s(est.clientName    || '');
    const serviceAddress = s(est.address       || est.clientAddress || '');
    const midX           = L + (R - L) / 2 + 10;

    page.drawText('Client Full Name:', { x: L,    y, size: 9, font: bold, color: black });
    page.drawText('Service Address:',  { x: midX, y, size: 9, font: bold, color: black });
    y -= 14;
    page.drawText(clientName,     { x: L,    y, size: 10, font, color: black });
    page.drawText(serviceAddress, { x: midX, y, size: 10, font, color: black });
    y -= 8;
    page.drawLine({ start: { x: L,    y }, end: { x: midX - 14, y }, thickness: 0.5, color: lightGray });
    page.drawLine({ start: { x: midX, y }, end: { x: R,          y }, thickness: 0.5, color: lightGray });
    y -= 14;

    // Use visitDate from survey form, fall back to saleDate, then today
    const visitDateRaw = est.survey?.visitDate || est.saleDate || '';
    let dateOfService;
    if (visitDateRaw) {
        // Parse as local date (YYYY-MM-DD) to avoid UTC timezone shift
        const parts = visitDateRaw.slice(0, 10).split('-').map(Number);
        dateOfService = new Date(parts[0], parts[1] - 1, parts[2])
            .toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    } else {
        dateOfService = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    page.drawText('Date of Service:', { x: L, y, size: 9, font: bold, color: black });
    y -= 13;
    page.drawText(dateOfService, { x: L, y, size: 10, font, color: black });
    y -= 8;
    page.drawLine({ start: { x: L, y }, end: { x: midX - 14, y }, thickness: 0.5, color: lightGray });
    y -= 18;

    // ─── SERVICE AND QUOTATION TABLE ─────────────────────────────────────────
    page.drawText('Service and Quotation', { x: L, y, size: 11, font: bold, color: black });
    y -= 14;

    // Column positions
    const cbX    = L + 6;      // checkbox x
    const descX  = L + 26;     // service label x
    const qtyX   = R - 166;    // quantity column start
    const priceX = R - 48;     // price column (right-aligned anchor)
    const rowH   = 22;

    // ── Table header ─────────────────────────────────────────────────────────
    // Gray background
    page.drawRectangle({ x: L, y: y - rowH + 6, width: R - L, height: rowH, color: rgb(0.93, 0.93, 0.93) });
    // Border lines only (no fill — fixes the black-header bug)
    page.drawLine({ start: { x: L, y: y + 6 },        end: { x: L, y: y - rowH + 6 },        thickness: 0.5, color: lightGray });
    page.drawLine({ start: { x: R, y: y + 6 },        end: { x: R, y: y - rowH + 6 },        thickness: 0.5, color: lightGray });
    page.drawLine({ start: { x: L, y: y - rowH + 6 }, end: { x: R, y: y - rowH + 6 },        thickness: 0.5, color: lightGray });
    page.drawLine({ start: { x: qtyX - 6,   y: y + 6 }, end: { x: qtyX - 6,   y: y - rowH + 6 }, thickness: 0.4, color: lightGray });
    page.drawLine({ start: { x: priceX - 6, y: y + 6 }, end: { x: priceX - 6, y: y - rowH + 6 }, thickness: 0.4, color: lightGray });
    // Header text (bold, visible on gray background)
    page.drawText('Service Description', { x: descX,  y: y - 11, size: 9, font: bold, color: black });
    page.drawText('Quantity',            { x: qtyX,   y: y - 11, size: 9, font: bold, color: black });
    page.drawText('Price',               { x: priceX, y: y - 11, size: 9, font: bold, color: black });
    y -= rowH;

    // ── Service rows ─────────────────────────────────────────────────────────
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
        if (g.mulch)                            p.push(g.mulch + ' yd3 mulch');  // yd3 avoids encoding issue
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
        page.drawRectangle({ x: L, y: rowY - rowH + 4, width: R - L, height: rowH, color: bg });
        page.drawLine({ start: { x: L, y: rowY - rowH + 4 }, end: { x: R, y: rowY - rowH + 4 }, thickness: 0.3, color: lightGray });
        page.drawLine({ start: { x: L, y: rowY + 4 },        end: { x: L, y: rowY - rowH + 4 }, thickness: 0.5, color: lightGray });
        page.drawLine({ start: { x: R, y: rowY + 4 },        end: { x: R, y: rowY - rowH + 4 }, thickness: 0.5, color: lightGray });
        page.drawLine({ start: { x: qtyX - 6,   y: rowY + 4 }, end: { x: qtyX - 6,   y: rowY - rowH + 4 }, thickness: 0.3, color: lightGray });
        page.drawLine({ start: { x: priceX - 6, y: rowY + 4 }, end: { x: priceX - 6, y: rowY - rowH + 4 }, thickness: 0.3, color: lightGray });

        drawCheckbox(page, cbX, rowY - 8, row.checked);
        page.drawText(row.label, { x: descX, y: rowY - 12, size: 10, font: bold, color: black });

        if (row.qty) {
            const maxQtyW = priceX - qtyX - 10;
            let qtyText = s(row.qty);
            while (qtyText.length > 3 && font.widthOfTextAtSize(qtyText, 8) > maxQtyW) {
                qtyText = qtyText.slice(0, -4) + '...';
            }
            page.drawText(qtyText, { x: qtyX, y: rowY - 12, size: 8, font, color: gray });
        }

        const priceText = row.price || '$';
        const priceW    = font.widthOfTextAtSize(priceText, 10);
        page.drawText(priceText, { x: R - priceW - 6, y: rowY - 12, size: 10, font, color: black });

        y -= rowH;
    });

    y -= 2;

    // ─── TOTALS ROW ──────────────────────────────────────────────────────────
    const totalRowH = 24;
    const colW = (R - L) / 3;
    [0, 1, 2].forEach(i => {
        page.drawRectangle({
            x: L + i * colW, y: y - totalRowH + 4,
            width: colW, height: totalRowH,
            borderColor: lightGray, borderWidth: 0.7, color: white,
        });
    });

    const subtotal = (est.subtotal || '$0.00').replace(/^\$/, '');
    const hst      = (est.hst      || '$0.00').replace(/^\$/, '');
    const total    = (est.total    || '$0.00').replace(/^\$/, '');

    page.drawText('Contract Price: $' + subtotal,   { x: L + 6,              y: y - 13, size: 9, font: bold, color: black });
    page.drawText('HST (13%): $'      + hst,        { x: L + colW + 6,       y: y - 13, size: 9, font: bold, color: black });
    page.drawText('Total Due: $'      + total,       { x: L + colW * 2 + 6,  y: y - 13, size: 9, font: bold, color: black });

    y -= totalRowH + 18;

    // ─── TIMELINE ────────────────────────────────────────────────────────────
    page.drawText('Timeline', { x: L, y, size: 11, font: bold, color: black });
    y -= 14;

    let completionDate = 'TBD';
    if (visitDateRaw) {
        const parts = visitDateRaw.slice(0, 10).split('-').map(Number);
        completionDate = new Date(parts[0], parts[1] - 1, parts[2] + 1)
            .toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    const halfW = (R - L) / 2 - 4;
    page.drawRectangle({ x: L,              y: y - 20, width: halfW, height: 26, borderColor: lightGray, borderWidth: 0.5, color: white });
    page.drawRectangle({ x: L + halfW + 8,  y: y - 20, width: halfW, height: 26, borderColor: lightGray, borderWidth: 0.5, color: white });
    page.drawText('Start Date:   ' + dateOfService, { x: L + 7,          y: y - 11, size: 9, font: bold, color: black });
    page.drawText('Completion:  ' + completionDate, { x: L + halfW + 15, y: y - 11, size: 9, font: bold, color: black });
    y -= 34;

    const note = '25% deposit due at signing. Balance due upon completion.';
    page.drawText(note, {
        x: (width - italic.widthOfTextAtSize(note, 8.5)) / 2,
        y, size: 8.5, font: italic, color: gray,
    });
    y -= 22;

    // ─── TERMS & CONDITIONS ──────────────────────────────────────────────────
    page.drawText('Terms & Conditions', { x: L, y, size: 11, font: bold, color: black });
    y -= 6;
    page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.5, color: lightGray });
    y -= 12;

    const termsList = [
        { label: 'Insurance & Safety:',        text: 'CORE EXTERIORS maintains $10 million in General Liability Insurance and is fully covered by WSIB, ensuring protection for both the property and our workers.' },
        { label: 'Weather & Site Conditions:',  text: 'Scheduled dates are subject to change based on weather or site accessibility.' },
        { label: 'Amendments & Changes:',       text: 'If during the performance of services, the scope of work is found to differ significantly from the initial assessment (e.g., unexpected surface fragility or incorrect measurements), CORE EXTERIORS reserves the right to adjust the contract price. Any changes will be agreed upon with the Client before proceeding.' },
        { label: 'Liability:',                  text: 'CORE EXTERIORS is not responsible for pre-existing defects, loose materials, or water intrusion from prior construction issues. Total liability is limited to the contract amount.' },
        { label: 'Exclusions:',                 text: 'Structural repairs, paint touch-ups, sealing, or landscaping restoration are not included unless specified.' },
    ];

    termsList.forEach(term => {
        const full    = term.label + ' ' + term.text;
        const wrapped = wrapText(full, 105);
        wrapped.forEach((line, idx) => {
            if (idx === 0) {
                const lw = bold.widthOfTextAtSize(term.label, 8);
                page.drawText(term.label,             { x: L,      y, size: 8, font: bold, color: black });
                page.drawText(line.slice(term.label.length), { x: L + lw, y, size: 8, font,      color: black });
            } else {
                page.drawText(line, { x: L, y, size: 8, font, color: black });
            }
            y -= 11;
        });
    });

    y -= 18;

    // ─── SIGNATURES ──────────────────────────────────────────────────────────
    const dateStr  = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    const sigHalf  = (R - L) / 2 - 20;

    if (signatureData) {
        try {
            const b64      = signatureData.includes(',') ? signatureData.split(',')[1] : signatureData;
            const pngBytes = Buffer.from(b64, 'base64');
            const sigImg   = await doc.embedPng(pngBytes);
            const dims     = sigImg.scaleToFit(160, 44);
            page.drawImage(sigImg, { x: L, y: y - dims.height, width: dims.width, height: dims.height });
        } catch (_) { /* no signature — leave blank */ }
    }

    page.drawLine({ start: { x: L,            y: y - 46 }, end: { x: L + sigHalf,      y: y - 46 }, thickness: 0.7, color: black });
    page.drawLine({ start: { x: R - sigHalf,  y: y - 46 }, end: { x: R,               y: y - 46 }, thickness: 0.7, color: black });

    page.drawText('Client Signature', { x: L,           y: y - 57, size: 8, font, color: gray });
    page.drawText('Date: ______________', { x: L + 90,  y: y - 57, size: 8, font, color: gray });
    page.drawText('Contractor Signature', { x: R - sigHalf, y: y - 57, size: 8, font, color: gray });
    page.drawText('Date: ______________', { x: R - sigHalf + 110, y: y - 57, size: 8, font, color: gray });

    return await doc.save();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function drawCheckbox(page, x, y, checked) {
    const sz = 8;
    page.drawRectangle({ x, y: y - sz, width: sz, height: sz, borderColor: rgb(0, 0, 0), borderWidth: 0.8, color: rgb(1, 1, 1) });
    if (checked) {
        page.drawLine({ start: { x: x + 1.5, y: y - 5 }, end: { x: x + 3.5, y: y - 7 }, thickness: 1.3, color: rgb(0, 0, 0) });
        page.drawLine({ start: { x: x + 3.5, y: y - 7 }, end: { x: x + 7,   y: y - 1 }, thickness: 1.3, color: rgb(0, 0, 0) });
    }
}

function wrapText(text, maxChars) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    words.forEach(w => {
        if (!cur) {
            cur = w;
        } else if ((cur + ' ' + w).length <= maxChars) {
            cur += ' ' + w;
        } else {
            lines.push(cur);
            cur = w;
        }
    });
    if (cur) lines.push(cur);
    return lines;
}

module.exports = { generateContractPDF };
