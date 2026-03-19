// Fills CONTRACT_BASE.pdf (the official Core Exteriors template) with dynamic data.
// The template already contains: logo, headings, labels, table borders, T&C text,
// and the contractor's pre-signed signature. This module overlays only the
// variable fields (client info, checkmarks, quantities, prices, dates, client sig).
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs   = require('fs');

// Sanitize text for pdf-lib StandardFonts (Latin-1 only)
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

// ─── Coordinate map for CONTRACT_BASE.pdf (612 × 792 pt Letter) ─────────────
// All y values are from the BOTTOM of the page (pdf-lib convention).
// Calibrated from visual inspection of the template layout.
const C = {
    // Client info — values placed on the same line as the bold labels
    clientNameX:  155,   // after "Client Full Name: " label text
    clientNameY:  665,
    addrX:        395,   // after "Service Address: " in right column
    addrY:        665,
    dateX:        145,   // after "Date of Service: " label
    dateY:        628,

    // Service table — text baseline y per row (Deck→Others)
    rowsY: [575, 561, 547, 533, 519, 506, 491],
    cbX:   60,    // checkbox x (draw ✓ over existing □)
    qtyX:  372,   // quantity column text start
    priceMaxX: 555, // price right-aligns to here (after template's "$")

    // Totals row (Contract Price / HST / Total Due)
    totY:    473,
    subtX:   170,  // after "Contract Price: $"
    hstX:    333,  // after "HST (13%): $"
    totalX:  470,  // after "Total Due: $"

    // Timeline boxes
    tlY:      444,
    startX:   115,  // after "Start Date:"
    compX:    378,  // after "Completion:"

    // Payment URL (tiny, above T&C section)
    payY:     416,

    // Client signature image & date labels
    sigImgX:   54,
    sigImgY:   70,   // bottom of image (just above the underline)
    sigImgH:   46,   // max height for client signature image
    dateStrY:  57,   // y for date text below signature line
    clientDateX: 148,
    contrDateX:  390,
};

async function generateContractPDF(est, signatureData, paymentUrl) {
    // Load the official template (static content + contractor signature already inside)
    const templateBytes = fs.readFileSync(path.join(__dirname, 'CONTRACT_BASE.pdf'));
    const doc  = await PDFDocument.load(templateBytes);
    const page = doc.getPage(0);

    const font   = await doc.embedFont(StandardFonts.Helvetica);
    const bold   = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

    const black = rgb(0,   0,   0);
    const navy  = rgb(0.08, 0.12, 0.28);
    const gray  = rgb(0.45, 0.45, 0.45);
    const blue  = rgb(0.1,  0.3,  0.75);

    // ── Client info ───────────────────────────────────────────────────────────
    page.drawText(s(est.clientName || ''), {
        x: C.clientNameX, y: C.clientNameY, size: 10, font, color: black,
    });
    page.drawText(s(est.address || est.clientAddress || ''), {
        x: C.addrX, y: C.addrY, size: 10, font, color: black,
    });

    // Date of service (parse as local date to avoid UTC shift)
    const visitDateRaw = est.survey?.visitDate || est.saleDate || '';
    let dateOfService = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    if (visitDateRaw) {
        const [yr, mo, dy] = visitDateRaw.slice(0, 10).split('-').map(Number);
        dateOfService = new Date(yr, mo - 1, dy)
            .toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    page.drawText(dateOfService, { x: C.dateX, y: C.dateY, size: 10, font, color: black });

    // ── Service table rows ────────────────────────────────────────────────────
    const services   = Array.isArray(est.services) ? est.services : [];
    const jobDetails = est.jobDetails || {};

    function isSelected(key) {
        if (jobDetails[key]) return true;
        return services.some(sv => sv.name && sv.name.toLowerCase().includes(key.toLowerCase()));
    }
    function svcPrice(key) {
        const m = services.find(sv => sv.name && sv.name.toLowerCase().includes(key.toLowerCase()));
        if (!m) return '';
        return (m.price || '').toString().replace(/^\$/, '');
    }
    function deckQty() {
        const d = jobDetails.deck; if (!d) return '';
        const p = [];
        if (d.sqft)      p.push(d.sqft + ' sq ft');
        if (d.condition) p.push('Cond ' + d.condition + '/5');
        if (d.rails)     p.push('Rails');
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
        if (i.seal)                              p.push('Seal');
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

    const rowData = [
        { sel: isSelected('deck'),      qty: deckQty(),      price: svcPrice('deck') },
        { sel: isSelected('gutter'),    qty: gutterQty(),    price: svcPrice('gutter') },
        { sel: isSelected('interlock') || isSelected('hardscape'), qty: interlockQty(), price: svcPrice('interlock') || svcPrice('hardscape') },
        { sel: isSelected('window'),    qty: windowQty(),    price: svcPrice('window') },
        { sel: isSelected('siding'),    qty: sidingQty(),    price: svcPrice('siding') },
        { sel: isSelected('garden'),    qty: gardenQty(),    price: svcPrice('garden') },
        { sel: false, qty: '', price: '' }, // Others
    ];

    rowData.forEach((row, i) => {
        const ry = C.rowsY[i];

        // Checkmark drawn over the template's □ symbol
        if (row.sel) {
            drawCheckmark(page, C.cbX, ry);
        }

        // Quantity (truncate if too wide)
        if (row.qty) {
            const maxW = C.priceMaxX - C.qtyX - 8;
            let qt = s(row.qty);
            while (qt.length > 3 && font.widthOfTextAtSize(qt, 7.5) > maxW) qt = qt.slice(0, -4) + '...';
            page.drawText(qt, { x: C.qtyX, y: ry - 2, size: 7.5, font, color: black });
        }

        // Price (right-aligned before the right table edge)
        if (row.price) {
            const pt = s(row.price);
            const pw = font.widthOfTextAtSize(pt, 10);
            page.drawText(pt, { x: C.priceMaxX - pw, y: ry - 2, size: 10, font, color: black });
        }
    });

    // ── Totals ────────────────────────────────────────────────────────────────
    const subtotal = s((est.subtotal || '0.00').replace(/^\$/, ''));
    const hst      = s((est.hst      || '0.00').replace(/^\$/, ''));
    const total    = s((est.total    || '0.00').replace(/^\$/, ''));

    page.drawText(subtotal, { x: C.subtX,  y: C.totY, size: 9, font: bold, color: black });
    page.drawText(hst,      { x: C.hstX,   y: C.totY, size: 9, font: bold, color: black });
    page.drawText(total,    { x: C.totalX, y: C.totY, size: 9, font: bold, color: black });

    // ── Timeline ──────────────────────────────────────────────────────────────
    let completionDate = 'TBD';
    if (visitDateRaw) {
        const [yr, mo, dy] = visitDateRaw.slice(0, 10).split('-').map(Number);
        completionDate = new Date(yr, mo - 1, dy + 1)
            .toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    page.drawText(dateOfService,  { x: C.startX, y: C.tlY, size: 9, font, color: black });
    page.drawText(completionDate, { x: C.compX,  y: C.tlY, size: 9, font, color: black });

    // ── Payment URL (if provided) ─────────────────────────────────────────────
    // Placed just above the Terms & Conditions heading in the small gap
    if (paymentUrl) {
        const label  = 'Pay online: ';
        const labelW = bold.widthOfTextAtSize(label, 7);
        let urlTxt   = paymentUrl;
        const maxW   = 558 - 54 - labelW;
        while (urlTxt.length > 12 && font.widthOfTextAtSize(urlTxt, 6.5) > maxW) urlTxt = urlTxt.slice(0, -3) + '..';
        page.drawText(label,  { x: 54,           y: C.payY, size: 7,   font: bold, color: navy });
        page.drawText(urlTxt, { x: 54 + labelW,  y: C.payY, size: 6.5, font,       color: blue });
    }

    // ── Client signature ──────────────────────────────────────────────────────
    if (signatureData) {
        try {
            const b64    = signatureData.includes(',') ? signatureData.split(',')[1] : signatureData;
            const sigImg = await doc.embedPng(Buffer.from(b64, 'base64'));
            const dims   = sigImg.scaleToFit(200, C.sigImgH);
            // Draw with bottom edge just above the signature line
            page.drawImage(sigImg, {
                x: C.sigImgX,
                y: C.sigImgY,
                width:  dims.width,
                height: dims.height,
            });
        } catch (e) {
            console.error('Client sig embed error:', e.message);
        }
    }

    // Today's date under each signature block
    const todayStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    page.drawText(todayStr, { x: C.clientDateX, y: C.dateStrY, size: 7.5, font, color: gray });
    page.drawText(todayStr, { x: C.contrDateX,  y: C.dateStrY, size: 7.5, font, color: gray });

    return await doc.save();
}

// Draw a ✓ checkmark over the template's □ checkbox at position (x, baselineY)
function drawCheckmark(page, x, baselineY) {
    const c = rgb(0, 0, 0);
    // Short stroke (bottom-left of tick)
    page.drawLine({ start: { x: x + 1,   y: baselineY - 5 }, end: { x: x + 3,   y: baselineY - 7 }, thickness: 1.4, color: c });
    // Long stroke (up-right of tick)
    page.drawLine({ start: { x: x + 3,   y: baselineY - 7 }, end: { x: x + 7.5, y: baselineY - 0.5 }, thickness: 1.4, color: c });
}

module.exports = { generateContractPDF };
