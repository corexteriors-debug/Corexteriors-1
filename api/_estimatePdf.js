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
    return docType === 'INVOICE' ? buildInvoice(est, opts.signatureData || null) : buildEstimate(est);
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
//  INVOICE — clean professional layout with HST# prominently shown
// ═════════════════════════════════════════════════════════════════════════════
async function buildInvoice(est, signatureData = null) {
    const doc  = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const W = 612, H = 792;
    const ML = 48, MR = 48;
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
    const visitRaw  = est.survey?.visitDate || est.saleDate || '';
    const dateSvc   = visitRaw ? fmtDate(visitRaw) : 'To Be Confirmed';

    // ── HEADER: orange stripe + navy bar ─────────────────────────────────────
    page.drawRectangle({ x: 0, y: H - 8,        width: W,  height: 8,  color: orange });
    page.drawRectangle({ x: 0, y: H - 8 - 82,   width: W,  height: 82, color: navy });

    page.drawText('CORE EXTERIORS', { x: ML, y: H - 8 - 36, size: 22, font: bold, color: white });
    page.drawText('Professional Exterior Services  |  corexteriors.ca', {
        x: ML, y: H - 8 - 56, size: 8.5, font, color: rgb(0.55, 0.65, 0.78),
    });

    const invW = bold.widthOfTextAtSize('INVOICE', 30);
    page.drawText('INVOICE', { x: W - MR - invW, y: H - 8 - 48, size: 30, font: bold, color: orange });

    // ── INVOICE META (right-aligned under header) ────────────────────────────
    let y = H - 8 - 82 - 18;
    const metaX = W - MR - 210;
    const valX  = W - MR - 10;

    function metaRow(lbl, val) {
        page.drawText(lbl, { x: metaX, y, size: 8.5, font: bold, color: gray });
        const vw = font.widthOfTextAtSize(s(val), 8.5);
        page.drawText(s(val), { x: valX - vw, y, size: 8.5, font, color: darkGray });
        y -= 14;
    }

    metaRow('Invoice #:', docNum);
    metaRow('Issue Date:', issueDate);
    metaRow('Service Date:', dateSvc);
    metaRow('Payment Due:', 'Upon Completion of Services');

    // Payment badge
    y -= 4;
    const payStatus  = (est.paymentStatus || 'Unpaid').toLowerCase();
    const badgeColor = payStatus === 'paid' ? green : payStatus.includes('deposit') ? orange : rgb(0.75, 0.10, 0.10);
    const badgeLabel = payStatus === 'paid' ? 'PAID IN FULL' : payStatus.includes('deposit') ? 'DEPOSIT PAID' : 'UNPAID';
    const bW = 104, bH = 22;
    page.drawRectangle({ x: W - MR - bW, y: y - 4, width: bW, height: bH, color: badgeColor });
    const blw = bold.widthOfTextAtSize(badgeLabel, 8);
    page.drawText(badgeLabel, { x: W - MR - bW + (bW - blw) / 2, y: y + 5, size: 8, font: bold, color: white });

    // ── DIVIDER ──────────────────────────────────────────────────────────────
    y = H - 8 - 82 - 18;  // reset y to below header for left column
    y -= 90;               // match height of meta block
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.6, color: midGray });
    y -= 16;

    // ── BILL TO / FROM ───────────────────────────────────────────────────────
    const boxH  = 100;
    const halfW = CW / 2 - 8;

    // BILL TO
    page.drawRectangle({ x: ML,     y: y - boxH, width: halfW, height: boxH, color: lightGray });
    page.drawRectangle({ x: ML,     y: y - boxH, width: 4,     height: boxH, color: orange });
    page.drawText('BILL TO', { x: ML + 14, y: y - 15, size: 7.5, font: bold, color: orange });
    page.drawText(s(est.clientName || '—'),                        { x: ML + 14, y: y - 31, size: 12,  font: bold, color: navy });
    page.drawText(s(est.address || est.clientAddress || ''),       { x: ML + 14, y: y - 48, size: 8.5, font,       color: darkGray });
    page.drawText(s(est.phone || ''),                              { x: ML + 14, y: y - 63, size: 8.5, font,       color: darkGray });
    page.drawText(s(est.email || ''),                              { x: ML + 14, y: y - 78, size: 8,   font,       color: gray });

    // FROM
    const rX = ML + halfW + 16;
    page.drawRectangle({ x: rX, y: y - boxH, width: halfW, height: boxH, color: lightGray });
    page.drawRectangle({ x: rX, y: y - boxH, width: 4,     height: boxH, color: navy });
    page.drawText('FROM',                                               { x: rX + 14, y: y - 15, size: 7.5, font: bold, color: navy });
    page.drawText('Core Exteriors',                                     { x: rX + 14, y: y - 31, size: 12,  font: bold, color: navy });
    page.drawText('Rep: ' + s(est.salesRep || 'Core Exteriors Team'),   { x: rX + 14, y: y - 48, size: 8.5, font,       color: darkGray });
    page.drawText('519-712-1431  |  corexteriors.ca',                   { x: rX + 14, y: y - 63, size: 8.5, font,       color: darkGray });
    page.drawText('HST# 745847632 RT0001',                              { x: rX + 14, y: y - 78, size: 8.5, font: bold, color: navy });

    y -= boxH + 20;

    // ── SERVICE TABLE ────────────────────────────────────────────────────────
    page.drawRectangle({ x: ML, y: y - 24, width: CW, height: 24, color: navy });
    page.drawText('SERVICE',                                                   { x: ML + 12,         y: y - 16, size: 8.5, font: bold, color: white });
    page.drawText('AMOUNT', { x: W - MR - bold.widthOfTextAtSize('AMOUNT', 8.5) - 12, y: y - 16, size: 8.5, font: bold, color: white });
    y -= 24;

    let altRow = false;
    services.forEach(svc => {
        const rowH = 26;
        if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });
        page.drawText(s(svc.name), { x: ML + 12, y: y - 17, size: 10, font, color: black });
        const priceStr = '$' + s(String(svc.price || '0').replace(/^\$/, ''));
        const pw = bold.widthOfTextAtSize(priceStr, 10);
        page.drawText(priceStr, { x: W - MR - pw - 12, y: y - 17, size: 10, font: bold, color: darkGray });
        page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.3, color: midGray });
        y -= rowH;
        altRow = !altRow;
    });

    if (!services.length) {
        page.drawText('No services specified.', { x: ML + 12, y: y - 17, size: 9, font, color: gray });
        y -= 26;
    }

    y -= 12;

    // ── TOTALS ───────────────────────────────────────────────────────────────
    const totW = 230, totX = W - MR - totW;
    const subtotalVal = s(String(est.subtotal || '0.00').replace(/^\$/, ''));
    const hstVal      = s(String(est.hst      || '0.00').replace(/^\$/, ''));
    const totalVal    = s(String(est.total    || '0.00').replace(/^\$/, ''));
    const depositAmt  = parseFloat(est.paymentAmount) || 0;
    const totalNum    = parseFloat(String(est.total || '0').replace(/[$,]/g, '')) || 0;
    const balanceNum  = Math.max(0, totalNum - depositAmt);

    function totRow(label, val, bgColor, valColor) {
        const rowH = 24;
        if (bgColor) page.drawRectangle({ x: totX, y: y - rowH, width: totW, height: rowH, color: bgColor });
        const f  = bgColor ? bold : font;
        const lc = bgColor ? white : darkGray;
        const vc = bgColor ? white : (valColor || darkGray);
        page.drawText(s(label), { x: totX + 12, y: y - 16, size: 9, font: f, color: lc });
        const vw = bold.widthOfTextAtSize(val, 9);
        page.drawText(val, { x: totX + totW - vw - 10, y: y - 16, size: 9, font: bold, color: vc });
        if (!bgColor) page.drawLine({ start: { x: totX, y: y - rowH }, end: { x: totX + totW, y: y - rowH }, thickness: 0.35, color: midGray });
        y -= rowH;
    }

    totRow('Subtotal',  '$' + subtotalVal, null,   null);
    const discAmt = parseFloat(est.discount) || 0;
    if (discAmt > 0) totRow('Discount', '-$' + discAmt.toFixed(2), null, green);
    totRow('HST (13%)', '$' + hstVal,      null,   null);
    totRow('TOTAL',     '$' + totalVal,    navy,   null);

    if (depositAmt > 0) {
        const methodNote = est.paymentMethod ? ' (' + est.paymentMethod + ')' : '';
        totRow('Deposit Paid' + methodNote, '-$' + depositAmt.toFixed(2), null, green);
        const paid = balanceNum <= 0;
        totRow(paid ? 'PAID IN FULL' : 'BALANCE OWING', '$' + balanceNum.toFixed(2), paid ? green : orange, null);
    } else {
        totRow('BALANCE OWING', '$' + totalNum.toFixed(2), orange, null);
    }

    y -= 20;

    // ── PAYMENT INFO BOX ─────────────────────────────────────────────────────
    const payBoxH = 56;
    page.drawRectangle({ x: ML, y: y - payBoxH, width: CW, height: payBoxH, color: lightGray });
    page.drawRectangle({ x: ML, y: y - payBoxH, width: 4,  height: payBoxH, color: navy });
    page.drawText('PAYMENT INFORMATION',                                       { x: ML + 14, y: y - 15, size: 8,   font: bold, color: navy });
    page.drawText('E-Transfer: corexteriors@gmail.com',                        { x: ML + 14, y: y - 31, size: 8.5, font,       color: darkGray });
    page.drawText('Cash, Cheque & Credit Card also accepted  |  519-712-1431', { x: ML + 14, y: y - 46, size: 8.5, font,       color: darkGray });
    y -= payBoxH + 14;

    // Notes
    const notes = s(est.survey?.notes || est.notes || '');
    if (notes) {
        page.drawText('Notes:', { x: ML, y, size: 8, font: bold, color: gray });
        y -= 13;
        (notes.match(/.{1,110}(\s|$)/g) || [notes]).slice(0, 3).forEach(line => {
            page.drawText(s(line.trim()), { x: ML, y, size: 8, font, color: gray });
            y -= 12;
        });
        y -= 6;
    }

    // ── CLIENT SIGNATURE ─────────────────────────────────────────────────────
    if (signatureData && y > 110) {
        try {
            const b64 = signatureData.includes(',') ? signatureData.split(',')[1] : signatureData;
            const sigImg = await doc.embedPng(Buffer.from(b64, 'base64'));
            const sigBoxW = 220, sigBoxH = 64;
            page.drawRectangle({ x: ML, y: y - sigBoxH, width: sigBoxW, height: sigBoxH, color: lightGray });
            page.drawRectangle({ x: ML, y: y - sigBoxH, width: 4,       height: sigBoxH, color: orange });
            page.drawText('CLIENT SIGNATURE', { x: ML + 14, y: y - 14, size: 7, font: bold, color: orange });
            page.drawText(s(est.clientName || ''), { x: ML + 14, y: y - 26, size: 8.5, font, color: darkGray });
            const dims = sigImg.scaleToFit(sigBoxW - 24, 28);
            page.drawImage(sigImg, { x: ML + 14, y: y - sigBoxH + 8, width: dims.width, height: dims.height });
            page.drawLine({ start: { x: ML + 14, y: y - sigBoxH + 18 }, end: { x: ML + sigBoxW - 14, y: y - sigBoxH + 18 }, thickness: 0.5, color: midGray });
            y -= sigBoxH + 12;
        } catch (_) {}
    }

    // ── FOOTER ───────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0,  width: W, height: 44, color: navy });
    page.drawRectangle({ x: 0, y: 44, width: W, height: 4,  color: orange });
    const footerTxt = 'Core Exteriors  \u2022  HST# 745847632 RT0001  \u2022  203 Cambridge St, London, ON N6H 1N6  \u2022  519-712-1431  \u2022  corexteriors.ca';
    const ftw = font.widthOfTextAtSize(footerTxt, 7.5);
    page.drawText(footerTxt, { x: (W - ftw) / 2, y: 16, size: 7.5, font, color: rgb(0.55, 0.63, 0.74) });

    return await doc.save();
}

module.exports = { generateEstimatePDF };
