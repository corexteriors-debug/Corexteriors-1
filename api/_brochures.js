const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const BROCHURES = {
    deck:      { file: 'CORE_Deck_Restoration_Residential_Brochure.pdf', label: 'Deck Restoration' },
    gutter:    { file: 'CORE_Gutter_Cleaning_and_Guards_Brochure.pdf', label: 'Gutter Cleaning & Guards' },
    interlock: { file: 'CORE_Interlock_Relevel_Polysand_Seal_Brochure.pdf', label: 'Interlock (Relevel/Polysand/Seal)' },
    window:    { file: 'CORE_Window_Cleaning_Residential_Brochure.pdf', label: 'Window Cleaning' },
    powerwash: { file: 'CORE_Power_Washing_Residential_Brochure.pdf', label: 'Power Washing' },
};
const BROCHURE_ORDER = ['deck', 'gutter', 'interlock', 'window', 'powerwash'];

// Coordinates of the blank "Client Name / Property Address / Phone / Email"
// lines already printed on page 1 of each brochure — measured directly from
// each PDF's own text positions (pdfplumber). These are fixed, static
// marketing documents, so the coordinates only need updating if the source
// brochure files themselves are redesigned.
const FIELD_POSITIONS = {
    deck:      { clientName: [128.8, 532.5], address: [147.7, 515.5], phone: [106.6, 498.5], email: [103.2, 481.5], maxX: 402 },
    powerwash: { clientName: [128.8, 532.5], address: [147.7, 515.5], phone: [106.6, 498.5], email: [103.2, 481.5], maxX: 402 },
    window:    { clientName: [128.8, 532.5], address: [147.7, 515.5], phone: [106.6, 498.5], email: [103.2, 481.5], maxX: 402 },
    gutter:    { clientName: [128.8, 520.5], address: [147.7, 503.5], phone: [106.6, 486.5], email: [103.2, 469.5], maxX: 402 },
    // Interlock's blanks are literal underscore characters (not a vector line
    // like the other 4 brochures) at the same baseline as the labels, so the
    // drawn text needs a small +3pt lift to sit visually above the underscores
    // instead of overlapping them — verified by rendering the page to an image.
    interlock: { clientName: [125.4, 506.7], address: [147.7, 489.7], phone: [99.3, 472.7], email: [95.4, 455.7], maxX: 555 },
};

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

// Shrinks font size (in 0.5pt steps, floor 6pt) until text fits maxWidth
function fitSize(font, text, maxWidth, baseSize) {
    let size = baseSize;
    while (size > 6 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
    return size;
}

// Loads one brochure and draws the client's info directly onto the existing
// blank lines on its page 1 — no separate cover page, the brochure itself
// becomes the personalized document.
async function personalizeBrochure(key, { clientName, address, phone, email }) {
    const siteUrl = (process.env.SITE_URL || 'https://corexteriors.ca').replace(/\/$/, '');
    const { file } = BROCHURES[key];
    const resp = await fetch(`${siteUrl}/brochures/${encodeURIComponent(file)}`);
    if (!resp.ok) throw new Error(`Could not fetch brochure: ${file}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());

    const doc  = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const navy = rgb(0.04, 0.09, 0.20);
    const pos  = FIELD_POSITIONS[key];

    [
        ['clientName', clientName],
        ['address', address],
        ['phone', phone],
        ['email', email],
    ].forEach(([field, value]) => {
        const text = s(value || '');
        if (!text) return;
        const [x, y] = pos[field];
        const maxWidth = pos.maxX - x - 4;
        const size = fitSize(font, text, maxWidth, 9.5);
        page.drawText(text, { x, y, size, font, color: navy });
    });

    return doc.save();
}

// Returns { attachments, labels } for every selected brochure — attachments
// are ready to drop into nodemailer's `attachments` array alongside the
// estimate/invoice PDF; labels are human-readable names for the email body note.
async function buildBrochureAttachments({ clientName, address, phone, email, selected }) {
    const picked = BROCHURE_ORDER.filter(key => Array.isArray(selected) && selected.includes(key));
    const attachments = [];
    for (const key of picked) {
        const pdfBytes = await personalizeBrochure(key, { clientName, address, phone, email });
        attachments.push({
            filename: BROCHURES[key].file,
            content: Buffer.from(pdfBytes),
            contentType: 'application/pdf',
        });
    }
    return { attachments, labels: picked.map(key => BROCHURES[key].label) };
}

module.exports = { buildBrochureAttachments };
