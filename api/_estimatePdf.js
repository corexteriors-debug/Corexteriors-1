// Generates Estimate and Invoice PDFs matching the Core Exteriors visual standards.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs   = require('fs');
const { kv } = require('@vercel/kv');

// ── Latin-1 safe string helper ────────────────────────────────────────────────
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

function fmtDate(iso) {
    if (!iso) return '';
    const [yr, mo, dy] = iso.slice(0, 10).split('-').map(Number);
    return new Date(yr, mo - 1, dy).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Public entry point ────────────────────────────────────────────────────────
async function generateEstimatePDF(est, opts = {}) {
    const docType = (opts.docType || 'ESTIMATE').toUpperCase();
    return docType === 'INVOICE' ? buildInvoice(est) : buildEstimate(est);
}

// ═════════════════════════════════════════════════════════════════════════════
//  ESTIMATE — matches CE 20260311 sample: navy header bar, PREPARED FOR box,
//             2-col service table, green TOTAL ESTIMATE, blue T&C section
// ═════════════════════════════════════════════════════════════════════════════
async function buildEstimate(est) {
    const doc  = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const W = 612, H = 792;
    const ML = 42, MR = 42;
    const CW = W - ML - MR;

    const navy      = rgb(0.04, 0.09, 0.20);
    const blue      = rgb(0.15, 0.35, 0.65);
    const green     = rgb(0.10, 0.55, 0.22);
    const white     = rgb(1, 1, 1);
    const black     = rgb(0, 0, 0);
    const gray      = rgb(0.45, 0.45, 0.45);
    const lightGray = rgb(0.94, 0.95, 0.96);
    const midGray   = rgb(0.82, 0.83, 0.84);
    const darkGray  = rgb(0.18, 0.18, 0.18);

    const issueDate = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    const docNum    = s(est.estimateNumber || '—');
    const services  = (Array.isArray(est.services) ? est.services : []).filter(sv => sv.name && sv.price);

    // ── HEADER BAR (navy, full width) ────────────────────────────────────────
    const HDR = 70;
    page.drawRectangle({ x: 0, y: H - HDR, width: W, height: HDR, color: navy });

    // Left: company name
    page.drawText('CORE EXTERIORS', { x: ML, y: H - HDR + 36, size: 24, font: bold, color: white });
    page.drawText('Professional Exterior Services', { x: ML, y: H - HDR + 18, size: 9, font, color: rgb(0.65, 0.72, 0.82) });

    // Right: document type + number
    const titleW = bold.widthOfTextAtSize('ESTIMATE', 28);
    page.drawText('ESTIMATE', { x: W - MR - titleW, y: H - HDR + 36, size: 28, font: bold, color: white });
    const numW = font.widthOfTextAtSize(docNum, 9);
    page.drawText(docNum, { x: W - MR - numW, y: H - HDR + 18, size: 9, font, color: rgb(0.65, 0.72, 0.82) });

    // ── DATE / SALES REP row ─────────────────────────────────────────────────
    let y = H - HDR - 26;
    page.drawText('Date: ' + issueDate, { x: ML, y, size: 8.5, font, color: darkGray });
    const repTxt = 'Sales Rep: ' + s(est.salesRep || 'Core Exteriors Team');
    const repW   = font.widthOfTextAtSize(repTxt, 8.5);
    page.drawText(repTxt, { x: W - MR - repW, y, size: 8.5, font, color: darkGray });
    y -= 18;

    // ── PREPARED FOR box ─────────────────────────────────────────────────────
    const boxH = 60;
    page.drawRectangle({ x: ML,     y: y - boxH,  width: CW,  height: boxH,  color: lightGray });
    page.drawRectangle({ x: ML,     y: y - boxH,  width: 3,   height: boxH,  color: blue });
    page.drawRectangle({ x: ML,     y: y - 1,     width: CW,  height: 1,     color: midGray });
    page.drawRectangle({ x: ML,     y: y - boxH,  width: CW,  height: 1,     color: midGray });
    page.drawText('PREPARED FOR', { x: ML + 12, y: y - 14, size: 7.5, font: bold, color: blue });
    page.drawText(s(est.clientName || '—'), { x: ML + 12, y: y - 27, size: 11, font: bold, color: black });
    const clientLine = [
        s(est.address || est.clientAddress || ''),
        s(est.phone || ''),
        s(est.email || ''),
    ].filter(Boolean).join('  |  ');
    page.drawText(clientLine, { x: ML + 12, y: y - 42, size: 8, font, color: gray });
    y -= boxH + 18;

    // ── SERVICE TABLE ────────────────────────────────────────────────────────
    // Header
    page.drawRectangle({ x: ML, y: y - 20, width: CW, height: 20, color: navy });
    page.drawText('SERVICE', { x: ML + 10, y: y - 14, size: 8.5, font: bold, color: white });
    page.drawText('AMOUNT',  { x: W - MR - 55, y: y - 14, size: 8.5, font: bold, color: white });
    y -= 20;

    let altRow = false;
    services.forEach(svc => {
        const rowH = 22;
        if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });
        page.drawText(s(svc.name), { x: ML + 10, y: y - 15, size: 9, font, color: black });
        const priceStr = '$' + s(String(svc.price || '0').replace(/^\$/, ''));
        const pw = bold.widthOfTextAtSize(priceStr, 9);
        page.drawText(priceStr, { x: W - MR - pw - 8, y: y - 15, size: 9, font: bold, color: darkGray });
        page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.3, color: midGray });
        y -= rowH;
        altRow = !altRow;
    });

    if (!services.length) {
        page.drawText('No services specified.', { x: ML + 10, y: y - 15, size: 9, font, color: gray });
        y -= 22;
    }

    y -= 12;

    // ── TOTALS (right-aligned block) ─────────────────────────────────────────
    const totW = 220, totX = W - MR - totW;
    const subtotalVal = s(String(est.subtotal || '0.00').replace(/^\$/, ''));
    const hstVal      = s(String(est.hst      || '0.00').replace(/^\$/, ''));
    const totalVal    = s(String(est.total    || '0.00').replace(/^\$/, ''));

    function simpleRow(label, val, labelColor, valColor) {
        const lc = labelColor || darkGray;
        const vc = valColor   || darkGray;
        page.drawText(label, { x: totX, y: y - 13, size: 9, font, color: lc });
        const vw = bold.widthOfTextAtSize(val, 9);
        page.drawText(val, { x: W - MR - vw - 4, y: y - 13, size: 9, font: bold, color: vc });
        page.drawLine({ start: { x: totX, y: y - 18 }, end: { x: W - MR, y: y - 18 }, thickness: 0.3, color: midGray });
        y -= 18;
    }

    simpleRow('Subtotal:', '$' + subtotalVal);
    simpleRow('HST (13%):', '$' + hstVal);

    // TOTAL ESTIMATE row — bold label, green value, slightly larger
    y -= 4;
    page.drawLine({ start: { x: totX, y }, end: { x: W - MR, y }, thickness: 0.8, color: navy });
    y -= 2;
    page.drawText('TOTAL ESTIMATE:', { x: totX, y: y - 15, size: 10, font: bold, color: darkGray });
    const totalStr = '$' + totalVal;
    const tw = bold.widthOfTextAtSize(totalStr, 12);
    page.drawText(totalStr, { x: W - MR - tw - 4, y: y - 16, size: 12, font: bold, color: green });
    y -= 28;

    // ── TERMS & CONDITIONS ───────────────────────────────────────────────────
    y -= 16;
    page.drawText('TERMS & CONDITIONS', { x: ML, y, size: 8.5, font: bold, color: blue });
    y -= 6;
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.5, color: midGray });
    y -= 14;

    const terms = [
        'This estimate is valid for 30 days from the date of issue.',
        'A 25% deposit is required to confirm the booking.',
        '10 day cooling off period applies as per Ontario consumer protection.',
        'Core Exteriors is fully insured and WSIB covered.',
    ];
    terms.forEach(t => {
        page.drawText('\u2022 ' + t, { x: ML + 6, y, size: 8, font, color: darkGray });
        y -= 13;
    });

    // Notes
    const notes = s(est.survey?.notes || est.notes || '');
    if (notes) {
        y -= 4;
        page.drawText('Notes:', { x: ML + 6, y, size: 8, font: bold, color: gray });
        y -= 13;
        const maxChars = 110;
        const noteLines = notes.match(/.{1,110}(\s|$)/g) || [notes];
        noteLines.slice(0, 3).forEach(line => {
            page.drawText(s(line.trim()), { x: ML + 6, y, size: 8, font, color: gray });
            y -= 13;
        });
    }

    // ── FOOTER ───────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0, width: W, height: 38, color: navy });
    const footerTxt = 'Core Exteriors  |  203 Cambridge St, London, ON, N6H 1N6  |  606 616 2026  |  corexteriors.ca';
    const ftw = font.widthOfTextAtSize(footerTxt, 8);
    page.drawText(footerTxt, { x: (W - ftw) / 2, y: 14, size: 8, font, color: rgb(0.55, 0.63, 0.74) });

    return await doc.save();
}

// ═════════════════════════════════════════════════════════════════════════════
//  INVOICE — matches INV-822425 sample: orange top bar, logo, two-column info
//            boxes, 3-col service table, deposit/balance rows, authorized by
// ═════════════════════════════════════════════════════════════════════════════
async function buildInvoice(est) {
    const doc  = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const W = 612, H = 792;
    const ML = 42, MR = 42;
    const CW = W - ML - MR;

    const navy      = rgb(0.04, 0.09, 0.20);
    const orange    = rgb(0.90, 0.49, 0.13);
    const green     = rgb(0.10, 0.55, 0.22);
    const white     = rgb(1, 1, 1);
    const black     = rgb(0, 0, 0);
    const gray      = rgb(0.45, 0.45, 0.45);
    const lightGray = rgb(0.94, 0.95, 0.96);
    const midGray   = rgb(0.82, 0.83, 0.84);
    const darkGray  = rgb(0.18, 0.18, 0.18);

    const issueDate = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    const docNum    = s(est.invoiceNumber || est.estimateNumber || '—');
    const services  = (Array.isArray(est.services) ? est.services : []).filter(sv => sv.name && sv.price);

    const visitRaw      = est.survey?.visitDate || est.saleDate || '';
    const dateOfService = visitRaw ? fmtDate(visitRaw) : 'To Be Confirmed';

    // ── ORANGE TOP STRIPE ────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: orange });

    // ── LOGO (left) ──────────────────────────────────────────────────────────
    const logoH = 54;
    const logoPaths = [
        path.join(__dirname, '../images/logo-wordmark.png'),
        path.join(process.cwd(), 'images/logo-wordmark.png'),
        path.join(process.cwd(), 'src/images/logo-wordmark.png'),
    ];
    let logoEmbedded = false;
    for (const logoPath of logoPaths) {
        try {
            const logoBytes = fs.readFileSync(logoPath);
            const logoImg   = await doc.embedPng(logoBytes);
            const logoW     = Math.round(logoH * 1024 / 546);
            page.drawImage(logoImg, { x: ML, y: H - 6 - logoH - 14, width: logoW, height: logoH });
            logoEmbedded = true;
            break;
        } catch (_) {}
    }
    if (!logoEmbedded) {
        page.drawText('CORE EXTERIORS', { x: ML, y: H - 6 - 28, size: 18, font: bold, color: navy });
    }

    // ── INVOICE TITLE + METADATA (right) ────────────────────────────────────
    const titleW = bold.widthOfTextAtSize('INVOICE', 32);
    page.drawText('INVOICE', { x: W - MR - titleW, y: H - 6 - 38, size: 32, font: bold, color: navy });

    const metaLX = W - MR - 200;
    const metaVX = W - MR - 90;
    let metaY = H - 6 - 56;

    const metaRows = [
        ['Invoice #',   docNum],
        ['Issue Date',  issueDate],
        ['Payment Due', 'Upon Completion'],
    ];
    metaRows.forEach(([lbl, val]) => {
        page.drawText(lbl, { x: metaLX, y: metaY, size: 8, font: bold, color: gray });
        page.drawText(s(val), { x: metaVX, y: metaY, size: 8, font, color: darkGray });
        metaY -= 13;
    });

    // Payment status badge
    const payStatus  = (est.paymentStatus || 'Unpaid').toLowerCase();
    const badgeColor = payStatus === 'paid'    ? green
                     : payStatus === 'deposit' ? orange
                     : rgb(0.75, 0.10, 0.10);
    const badgeLabel = payStatus === 'paid'    ? 'PAID IN FULL'
                     : payStatus === 'deposit' ? 'DEPOSIT PAID'
                     : 'UNPAID';
    const bW = 92, bH = 20;
    const bX = W - MR - bW;
    page.drawRectangle({ x: bX, y: metaY - 4, width: bW, height: bH, color: badgeColor });
    const blw = bold.widthOfTextAtSize(badgeLabel, 7.5);
    page.drawText(badgeLabel, { x: bX + (bW - blw) / 2, y: metaY + 4, size: 7.5, font: bold, color: white });

    // ── DIVIDER ──────────────────────────────────────────────────────────────
    let y = H - 6 - logoH - 24;
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.7, color: midGray });
    y -= 10;

    // ── BILL TO / FROM BOXES ─────────────────────────────────────────────────
    const boxH  = 90;
    const halfW = CW / 2 - 6;

    // BILL TO
    page.drawRectangle({ x: ML, y: y - boxH, width: halfW, height: boxH, color: lightGray });
    page.drawRectangle({ x: ML, y: y - 3,    width: halfW, height: 3,    color: orange });
    page.drawText('BILL TO', { x: ML + 10, y: y - 16, size: 7.5, font: bold, color: orange });
    page.drawText(s(est.clientName || '—'), { x: ML + 10, y: y - 30, size: 11, font: bold, color: navy });
    page.drawText(s(est.address || est.clientAddress || ''), { x: ML + 10, y: y - 44, size: 8.5, font, color: darkGray });
    page.drawText(s(est.phone || ''), { x: ML + 10, y: y - 57, size: 8.5, font, color: darkGray });
    page.drawText(s(est.email || ''), { x: ML + 10, y: y - 70, size: 8.5, font, color: gray });

    // FROM
    const rX = ML + halfW + 12;
    page.drawRectangle({ x: rX, y: y - boxH, width: halfW, height: boxH, color: lightGray });
    page.drawRectangle({ x: rX, y: y - 3,    width: halfW, height: 3,    color: navy });
    page.drawText('FROM', { x: rX + 10, y: y - 16, size: 7.5, font: bold, color: navy });
    page.drawText('Core Exteriors', { x: rX + 10, y: y - 30, size: 11, font: bold, color: navy });
    page.drawText('Rep: ' + s(est.salesRep || 'Core Exteriors Team'), { x: rX + 10, y: y - 44, size: 8.5, font, color: darkGray });
    page.drawText('Service Date: ' + s(dateOfService), { x: rX + 10, y: y - 57, size: 8.5, font, color: darkGray });
    page.drawText('Tel: 519-712-1431', { x: rX + 10, y: y - 70, size: 8.5, font, color: gray });

    y -= boxH + 16;

    // ── SERVICE TABLE ────────────────────────────────────────────────────────
    page.drawRectangle({ x: ML, y: y - 20, width: CW, height: 20, color: navy });
    page.drawText('Service',       { x: ML + 10,     y: y - 14, size: 8.5, font: bold, color: white });
    page.drawText('Qty / Details', { x: ML + 270,    y: y - 14, size: 8.5, font: bold, color: white });
    page.drawText('Price',         { x: W - MR - 42, y: y - 14, size: 8.5, font: bold, color: white });
    y -= 20;

    const jobDetails = est.jobDetails || {};
    function detailFor(svc) {
        const nm = (svc.name || '').toLowerCase();
        const p  = [];
        if (nm.includes('deck'))                   { const d = jobDetails.deck      || {}; if (d.sqft) p.push(d.sqft + ' sq ft'); if (d.condition) p.push('Cond ' + d.condition + '/5'); if (d.rails) p.push('Rails'); }
        else if (nm.includes('gutter'))            { const g = jobDetails.gutter    || {}; if (g.stories) p.push(g.stories + '-storey'); if (g.deepClean) p.push('Deep Clean'); }
        else if (nm.includes('interlock') || nm.includes('hardscape')) { const i = jobDetails.interlock || {}; if (i.sqft) p.push(i.sqft + ' sq ft'); if (i.seal) p.push('Seal'); }
        else if (nm.includes('window'))            { const w = jobDetails.window    || {}; if (w.count) p.push(w.count + ' units'); if (w.type) p.push(w.type === 'full' ? 'Int+Ext' : 'Ext only'); }
        else if (nm.includes('siding'))            { const sv2 = jobDetails.siding  || {}; if (sv2.stories) p.push(sv2.stories + '-storey'); }
        else if (nm.includes('garden'))            { const g = jobDetails.garden    || {}; if (g.mulch) p.push(g.mulch + ' yd3 mulch'); if (g.weeding && g.weeding !== 'none') p.push(g.weeding + ' weeding'); }
        return p.join(', ');
    }

    let altRow = false;
    services.forEach(svc => {
        const rowH = 22;
        if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });
        page.drawText(s(svc.name), { x: ML + 10, y: y - 15, size: 9, font, color: black });
        const detail = detailFor(svc);
        if (detail) page.drawText(s(detail), { x: ML + 270, y: y - 15, size: 8, font, color: gray });
        const priceStr = '$' + s(String(svc.price || '0').replace(/^\$/, ''));
        const pw = bold.widthOfTextAtSize(priceStr, 9);
        page.drawText(priceStr, { x: W - MR - pw - 6, y: y - 15, size: 9, font: bold, color: darkGray });
        page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.3, color: midGray });
        y -= rowH;
        altRow = !altRow;
    });

    if (!services.length) {
        page.drawText('No services specified.', { x: ML + 10, y: y - 15, size: 9, font, color: gray });
        y -= 22;
    }

    y -= 10;

    // ── TOTALS ───────────────────────────────────────────────────────────────
    const totW = 220, totX = W - MR - totW;
    const subtotalVal = s(String(est.subtotal || '0.00').replace(/^\$/, ''));
    const hstVal      = s(String(est.hst      || '0.00').replace(/^\$/, ''));
    const totalVal    = s(String(est.total    || '0.00').replace(/^\$/, ''));
    const depositAmt  = parseFloat(est.paymentAmount) || 0;
    const totalNum    = parseFloat(String(est.total || '0').replace(/[$,]/g, '')) || 0;
    const balanceNum  = Math.max(0, totalNum - depositAmt);

    function totRow(label, val, bgColor, valColor) {
        if (bgColor) page.drawRectangle({ x: totX, y: y - 22, width: totW, height: 22, color: bgColor });
        const f  = bgColor ? bold : font;
        const lc = bgColor ? white : darkGray;
        const vc = bgColor ? white : (valColor || darkGray);
        page.drawText(s(label), { x: totX + 10, y: y - 15, size: 9, font: f, color: lc });
        const vw = f.widthOfTextAtSize(val, 9);
        page.drawText(val, { x: totX + totW - vw - 8, y: y - 15, size: 9, font: f, color: vc });
        if (!bgColor) page.drawLine({ start: { x: totX, y: y - 22 }, end: { x: totX + totW, y: y - 22 }, thickness: 0.35, color: midGray });
        y -= 22;
    }

    totRow('Subtotal',  '$' + subtotalVal, null, null);
    totRow('HST (13%)', '$' + hstVal,      null, null);
    totRow('Total',     '$' + totalVal,    navy, null);

    if (depositAmt > 0) {
        const methodSuffix = est.paymentMethod ? '  (' + est.paymentMethod + ')' : '  (E-transfer)';
        totRow('Deposit Paid' + methodSuffix, '-$' + depositAmt.toFixed(2), null, green);
        const isFullyPaid = balanceNum <= 0;
        totRow(isFullyPaid ? 'PAID IN FULL' : 'BALANCE OWING',
               '$' + balanceNum.toFixed(2),
               isFullyPaid ? green : orange, null);
    } else {
        totRow('BALANCE OWING', '$' + totalNum.toFixed(2), orange, null);
    }

    y -= 18;

    // ── PAYMENT & TERMS ──────────────────────────────────────────────────────
    page.drawText('Payment & Terms', { x: ML, y, size: 9, font: bold, color: darkGray });
    y -= 6;
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.5, color: midGray });
    y -= 13;

    const terms = [
        'Payment is due upon completion of services.',
        'E-transfer: corexteriors@gmail.com  |  Cash, cheque, and credit card accepted.',
        'Core Exteriors carries $10M General Liability Insurance and is fully WSIB covered.',
        'Thank you for choosing Core Exteriors \u2014 it was a pleasure working with you!',
    ];
    terms.forEach(t => {
        page.drawText('\u2022 ' + s(t), { x: ML + 6, y, size: 8, font, color: darkGray });
        y -= 12;
    });

    // Notes
    const notes = s(est.survey?.notes || est.notes || '');
    if (notes) {
        y -= 4;
        page.drawText('Notes:', { x: ML + 6, y, size: 8, font: bold, color: gray });
        y -= 12;
        const noteLines = (notes.match(/.{1,110}(\s|$)/g) || [notes]);
        noteLines.slice(0, 3).forEach(line => {
            page.drawText(s(line.trim()), { x: ML + 6, y, size: 8, font, color: gray });
            y -= 12;
        });
    }

    // ── AUTHORIZED BY box ────────────────────────────────────────────────────
    if (y > 90) {
        y -= 8;
        const sigBoxH = 58, sigBoxW = 200;
        page.drawRectangle({ x: ML, y: y - sigBoxH, width: sigBoxW, height: sigBoxH, color: lightGray });
        page.drawRectangle({ x: ML, y: y,            width: sigBoxW, height: 2,       color: navy });
        page.drawText('AUTHORIZED BY', { x: ML + 8, y: y - 14, size: 6.5, font: bold, color: navy });
        page.drawText('Core Exteriors', { x: ML + 8, y: y - 26, size: 10, font: bold, color: navy });

        try {
            let sigImg = null;
            const savedSig = await kv.get('contractor_signature');
            if (savedSig) {
                const b64 = savedSig.includes(',') ? savedSig.split(',')[1] : savedSig;
                sigImg = await doc.embedPng(Buffer.from(b64, 'base64'));
            } else {
                const pngPath = path.join(__dirname, 'contractor-sig.png');
                const jpgPath = path.join(__dirname, 'contractor-sig.jpg');
                const sigPath = fs.existsSync(pngPath) ? pngPath : fs.existsSync(jpgPath) ? jpgPath : null;
                if (sigPath) {
                    sigImg = sigPath.endsWith('.png')
                        ? await doc.embedPng(fs.readFileSync(sigPath))
                        : await doc.embedJpg(fs.readFileSync(sigPath));
                }
            }
            if (sigImg) {
                const dims = sigImg.scaleToFit(sigBoxW - 16, 26);
                page.drawImage(sigImg, { x: ML + 8, y: y - sigBoxH + 8, width: dims.width, height: dims.height });
            }
        } catch (_) {}
    }

    // ── FOOTER ───────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0,  width: W, height: 38, color: navy });
    page.drawRectangle({ x: 0, y: 38, width: W, height: 3,  color: orange });
    const footerTxt = 'Core Exteriors  \u2022  HST# 745847632 RT0001  \u2022  519-712-1431  \u2022  corexteriors@gmail.com  \u2022  corexteriors.ca';
    const ftw = font.widthOfTextAtSize(footerTxt, 7.5);
    page.drawText(footerTxt, { x: (W - ftw) / 2, y: 14, size: 7.5, font, color: rgb(0.55, 0.63, 0.74) });

    return await doc.save();
}

module.exports = { generateEstimatePDF };
