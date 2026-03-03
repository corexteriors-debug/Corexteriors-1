// Generates a professional service agreement PDF from scratch.
// The _ prefix tells Vercel not to expose this as an API route.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

async function generateContractPDF(est, signatureData) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]); // Letter size
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();

    // Colors
    const darkBlue = rgb(0.04, 0.09, 0.16);
    const gold = rgb(0.96, 0.72, 0.0);
    const blue = rgb(0.2, 0.4, 0.7);
    const green = rgb(0.18, 0.68, 0.34);
    const black = rgb(0, 0, 0);
    const gray = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.85, 0.85, 0.85);
    const white = rgb(1, 1, 1);
    const softBg = rgb(0.96, 0.97, 0.98);

    const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    const contractNum = est.estimateNumber || 'CE-' + Date.now().toString(36).toUpperCase();
    const repName = est.salesRep || 'Core Exteriors Team';
    const clientName = est.clientName || 'Valued Customer';
    const address = est.address || est.clientAddress || '';
    const phone = est.phone || '';
    const email = est.email || '';

    // ─── HEADER BAR ─────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: darkBlue });
    page.drawText('CORE EXTERIORS', { x: 50, y: height - 38, size: 22, font: bold, color: white });
    page.drawText('Professional Exterior Services — London, Ontario', { x: 50, y: height - 56, size: 9, font, color: rgb(0.6, 0.7, 0.8) });
    // Gold accent line
    page.drawRectangle({ x: 0, y: height - 84, width, height: 4, color: gold });

    // Contract title & number on right
    page.drawText('SERVICE AGREEMENT', { x: width - 205, y: height - 38, size: 14, font: bold, color: gold });
    page.drawText(contractNum, { x: width - 205, y: height - 55, size: 9, font, color: rgb(0.6, 0.7, 0.8) });

    let y = height - 110;

    // ─── DATE LINE ──────────────────────────────────────────────────────────
    page.drawText('Date: ' + dateStr, { x: 50, y, size: 9, font, color: gray });
    page.drawText('Sales Rep: ' + repName, { x: 350, y, size: 9, font, color: gray });
    y -= 25;

    // ─── CLIENT INFORMATION BOX ─────────────────────────────────────────────
    page.drawRectangle({ x: 45, y: y - 65, width: width - 90, height: 70, color: softBg, borderColor: lightGray, borderWidth: 1 });
    page.drawText('CLIENT INFORMATION', { x: 55, y: y - 5, size: 8, font: bold, color: blue });
    y -= 20;
    page.drawText(clientName, { x: 55, y, size: 12, font: bold, color: black });
    y -= 15;
    const infoLine = [address, phone, email].filter(Boolean).join('  |  ');
    page.drawText(infoLine, { x: 55, y, size: 9, font, color: gray });
    y -= 40;

    // ─── SERVICES TABLE ─────────────────────────────────────────────────────
    page.drawText('SERVICES', { x: 50, y, size: 9, font: bold, color: blue });
    y -= 15;

    // Table header
    page.drawRectangle({ x: 45, y: y - 12, width: width - 90, height: 20, color: darkBlue });
    page.drawText('SERVICE DESCRIPTION', { x: 55, y: y - 7, size: 9, font: bold, color: white });
    page.drawText('AMOUNT', { x: width - 130, y: y - 7, size: 9, font: bold, color: white });
    y -= 28;

    // Service rows
    const services = Array.isArray(est.services) && est.services.length > 0
        ? est.services
        : (est.serviceType || '').split(', ').filter(Boolean).map(s => ({ name: s, price: '' }));

    services.forEach((svc, i) => {
        const bgColor = i % 2 === 0 ? softBg : white;
        page.drawRectangle({ x: 45, y: y - 10, width: width - 90, height: 20, color: bgColor });
        page.drawText('- ' + (svc.name || svc), { x: 55, y: y - 5, size: 10, font, color: black });
        if (svc.price) {
            page.drawText(svc.price, { x: width - 130, y: y - 5, size: 10, font, color: black });
        }
        y -= 20;
    });

    y -= 10;

    // ─── PRICING SUMMARY ────────────────────────────────────────────────────
    page.drawLine({ start: { x: 350, y }, end: { x: width - 45, y }, thickness: 1, color: lightGray });
    y -= 18;

    // Bundle discount
    if (est.bundleDiscount && est.bundleDiscount > 0) {
        page.drawText('Bundle Discount:', { x: 350, y, size: 10, font, color: gray });
        page.drawText('($' + Number(est.bundleDiscount).toFixed(2) + ')', { x: width - 130, y, size: 10, font, color: rgb(0.9, 0.5, 0.1) });
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

    page.drawLine({ start: { x: 350, y }, end: { x: width - 45, y }, thickness: 1.5, color: blue });
    y -= 20;

    // Total
    page.drawText('TOTAL:', { x: 350, y, size: 13, font: bold, color: darkBlue });
    page.drawText(est.total || '$0.00', { x: width - 130, y, size: 14, font: bold, color: green });
    y -= 35;

    // ─── TERMS & CONDITIONS ─────────────────────────────────────────────────
    page.drawLine({ start: { x: 45, y }, end: { x: width - 45, y }, thickness: 1, color: lightGray });
    y -= 18;
    page.drawText('TERMS & CONDITIONS', { x: 50, y, size: 9, font: bold, color: blue });
    y -= 16;

    const terms = [
        'This agreement is between the Client and Core Exteriors Ltd. for the services described above.',
        'A deposit of 25% is due at signing. The remaining balance is due upon completion of work.',
        'The Client has a 10-day cooling off period from the date of signing, as per Ontario Consumer Protection Act.',
        'Core Exteriors is fully insured ($2M liability) and WSIB compliant.',
        'Work will be completed in a workmanlike manner and in accordance with good trade practices.',
        'Core Exteriors will provide all materials, equipment, and labour necessary for the described services.',
        'This estimate is valid for 30 days from the date shown above.',
        'Cancellations after the cooling off period will forfeit the deposit unless mutually agreed otherwise.',
    ];

    terms.forEach(t => {
        const lines = wrapText('• ' + t, 90);
        lines.forEach(line => {
            page.drawText(line, { x: 55, y, size: 7.5, font, color: gray });
            y -= 11;
        });
        y -= 2;
    });

    y -= 8;

    // ─── SIGNATURES ─────────────────────────────────────────────────────────
    page.drawLine({ start: { x: 45, y }, end: { x: width - 45, y }, thickness: 1, color: lightGray });
    y -= 18;
    page.drawText('SIGNATURES', { x: 50, y, size: 9, font: bold, color: blue });
    y -= 25;

    // Client signature (left side)
    page.drawText('CLIENT', { x: 55, y, size: 7, font: bold, color: gray });
    y -= 5;

    // Embed client signature image if available
    if (signatureData && signatureData.startsWith('data:image/png;base64,')) {
        try {
            const pngBytes = Buffer.from(signatureData.replace('data:image/png;base64,', ''), 'base64');
            const sigImg = await doc.embedPng(pngBytes);
            const dims = sigImg.scaleToFit(200, 35);
            page.drawImage(sigImg, { x: 55, y: y - 35, width: dims.width, height: dims.height });
        } catch (_) {
            page.drawText('(Signed digitally)', { x: 55, y: y - 20, size: 9, font, color: gray });
        }
    }

    page.drawLine({ start: { x: 50, y: y - 40 }, end: { x: 260, y: y - 40 }, thickness: 1, color: black });
    page.drawText(clientName, { x: 55, y: y - 52, size: 9, font, color: black });
    page.drawText('Date: ' + dateStr, { x: 55, y: y - 64, size: 8, font, color: gray });

    // Contractor signature (right side)
    page.drawText('CONTRACTOR', { x: 335, y: y + 5, size: 7, font: bold, color: gray });
    page.drawText(repName, { x: 335, y: y - 18, size: 13, font: bold, color: darkBlue });
    page.drawLine({ start: { x: 330, y: y - 40 }, end: { x: width - 50, y: y - 40 }, thickness: 1, color: black });
    page.drawText(repName + ' — Core Exteriors Ltd.', { x: 335, y: y - 52, size: 8, font, color: gray });
    page.drawText('Date: ' + dateStr, { x: 335, y: y - 64, size: 8, font, color: gray });

    // ─── FOOTER BAR ─────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0, width, height: 35, color: darkBlue });
    page.drawText(
        'Core Exteriors Ltd.  |  203 Cambridge St, London, ON, N6H 1N6  |  606-616-2026  |  corexteriors.ca',
        { x: 65, y: 14, size: 7.5, font, color: rgb(0.6, 0.7, 0.8) }
    );
    page.drawRectangle({ x: 0, y: 35, width, height: 3, color: gold });

    // Merge with CONTRACT.pdf template
    try {
        const templatePath = path.join(__dirname, 'CONTRACT.pdf');
        const templateBytes = fs.readFileSync(templatePath);
        const templateDoc = await PDFDocument.load(templateBytes);
        const copiedPages = await doc.copyPages(templateDoc, templateDoc.getPageIndices());
        copiedPages.forEach(p => doc.addPage(p));
    } catch (_) {
        // If template not found, just send the generated page
    }

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

module.exports = { generateContractPDF };
