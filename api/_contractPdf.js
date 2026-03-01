// Fills the real CONTRACT.pdf template with estimate data and an optional signature image.
// The _ prefix tells Vercel not to expose this as an API route.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function generateContractPDF(est, signatureData) {
    // Load the real CONTRACT.pdf template
    const templatePath = path.join(__dirname, 'CONTRACT.pdf');
    const templateBytes = fs.readFileSync(templatePath);
    const doc = await PDFDocument.load(templateBytes);

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const page = doc.getPages()[0];
    const white = rgb(1, 1, 1);
    const black = rgb(0, 0, 0);
    const darkBlue = rgb(0.1, 0.2, 0.5);
    const grey = rgb(0.35, 0.35, 0.35);

    const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    // ─── helpers ────────────────────────────────────────────────────────────
    // erase: white rectangle over the blank underscores only
    function erase(x, y, w, h) {
        page.drawRectangle({ x, y, width: w, height: h, color: white });
    }
    // write: text baseline at exact PDF y coordinate
    function write(text, x, y, size, f, color) {
        if (!text) return;
        page.drawText(String(text), { x, y, size: size || 10, font: f || font, color: color || black, maxWidth: 250 });
    }

    // ─── CLIENT NAME ─────────────────────────────────────────────────────────
    // Blank at y=590 x=116 (extracted from PDF streams)
    erase(116, 585, 182, 9);
    write(est.clientName || '', 116, 590, 10, bold);

    // ─── DATE ────────────────────────────────────────────────────────────────
    // Blank at y=573 x=76
    erase(76, 568, 218, 9);
    write(dateStr, 76, 573, 9);

    // ─── SERVICE ADDRESS ─────────────────────────────────────────────────────
    // Blank at y=575 x=312 (line below "Service Address:" label at y=590)
    erase(312, 570, 248, 9);
    const address = est.address || est.clientAddress || '';
    write(address, 312, 575, 9);

    // ─── SERVICES ────────────────────────────────────────────────────────────
    // Erase the full checkbox/service area between y=479 and y=533
    erase(44, 479, 520, 54);

    const services = Array.isArray(est.services) && est.services.length > 0
        ? est.services
        : (est.serviceType || '').split(', ').filter(Boolean).map(s => ({ name: s }));

    // Two-column layout; left col x=48, right col x=312
    const half = Math.ceil(services.length / 2);
    services.forEach((svc, i) => {
        const col = i < half ? 0 : 1;
        const row = col === 0 ? i : i - half;
        const x = col === 0 ? 48 : 312;
        const y = 524 - (row * 13);
        write(svc.name || svc, x, y, 10);
    });

    // ─── PRICING ─────────────────────────────────────────────────────────────
    // "Contract Price: $_____" is one text object at y=459 x=45.
    // "Contract Price: $" in Helvetica 11pt = 81pt → underscores start at x=126
    erase(126, 454, 170, 9);
    const subtotalNum = (est.subtotal || '$0.00').replace('$', '').trim();
    write(subtotalNum, 126, 459, 10, bold);

    // "HST (13%): $_____" at y=443 x=45.
    // "HST (13%): $" in Helvetica 11pt = 63pt → underscores start at x=108
    erase(108, 438, 170, 9);
    const hstNum = (est.hst || '$0.00').replace('$', '').trim();
    write(hstNum, 108, 443, 10);

    // "Total Due: $" label ends at x=108; blank text starts separately at x=108 y=426
    erase(108, 421, 170, 9);
    const totalNum = (est.total || '$0.00').replace('$', '').trim();
    write(totalNum, 108, 426, 10, bold);

    // ─── TIMELINE ────────────────────────────────────────────────────────────
    // "Start Date: _____" at y=459 x=312.
    // "Start Date: " in Helvetica 11pt = 56pt → underscores start at x=368
    erase(368, 454, 190, 9);
    const visitDate = (est.survey && est.survey.visitDate) ? est.survey.visitDate : 'TBD';
    write(visitDate, 368, 459, 9);

    // "Completion: _____" at y=443 x=312.
    // "Completion: " in Helvetica 11pt = 61pt → underscores start at x=373
    erase(373, 438, 185, 9);
    write(est.completionDate || 'Upon completion', 373, 443, 9);

    // ─── CLIENT SIGNATURE ────────────────────────────────────────────────────
    // Blank at y=266 x=45
    erase(45, 261, 222, 9);

    if (signatureData && signatureData.startsWith('data:image/png;base64,')) {
        try {
            const pngBytes = Buffer.from(signatureData.replace('data:image/png;base64,', ''), 'base64');
            const sigImg = await doc.embedPng(pngBytes);
            const dims = sigImg.scaleToFit(210, 20);
            page.drawImage(sigImg, { x: 46, y: 248, width: dims.width, height: dims.height });
        } catch (_) {
            write('(Signed digitally)', 48, 266, 9, font, grey);
        }
    }

    // "Date: __________" at y=242 x=45 — "Date: " = 29pt → blanks start at x=74
    erase(74, 237, 130, 9);
    write(dateStr, 74, 242, 9);

    // ─── CONTRACTOR SIGNATURE ────────────────────────────────────────────────
    // Blank at y=266 x=312
    erase(312, 261, 224, 9);
    const repName = est.salesRep || 'Core Exteriors';
    write(repName, 314, 266, 13, bold, darkBlue);

    // Contractor name/title printed below (between sig and date lines)
    write(repName + ' - Core Exteriors Ltd.', 314, 253, 8, font, grey);

    // "Date: __________" at y=242 x=312 — blanks start at x=341
    erase(341, 237, 130, 9);
    write(dateStr, 341, 242, 9);

    return await doc.save();
}

module.exports = { generateContractPDF };
