// Fills CONTRACT_TEMPLATE.docx with lead data using docxtemplater.
// Embeds the client signature image directly into the DOCX.
// Returns a Buffer containing the filled .docx file.
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const ImageModule = require('docxtemplater-image-module-free');
const fs = require('fs');
const path = require('path');

const CHECKED   = '\u2611'; // ☑
const UNCHECKED = '\u25a2'; // ▢

// 1×1 transparent PNG used when no signature is provided
const BLANK_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);

/**
 * Build the data object that maps to every {variable} in CONTRACT_TEMPLATE.docx.
 * @param {object} lead          – full lead record from Vercel KV
 * @param {string|null} signatureData – base64 PNG data URL from canvas (may be null)
 * @returns {{ data: object, sigBuffer: Buffer }}
 */
function buildTemplateData(lead, signatureData) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const clientName     = lead.clientName    || 'Client';
    const serviceAddress = lead.address       || lead.clientAddress || '';
    const repName        = lead.salesRep      || 'Core Exteriors';

    const dateOfService = lead.saleDate
        ? new Date(lead.saleDate).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
        : dateStr;

    // ── Which services are selected ──────────────────────────────────────────
    const services   = Array.isArray(lead.services) ? lead.services : [];
    const jobDetails = lead.jobDetails || {};

    function svcPrice(key) {
        const match = services.find(s => s.name && s.name.toLowerCase().includes(key.toLowerCase()));
        return match ? (match.price || '').replace(/^\$/, '') : '';
    }

    function isSelected(key) {
        if (jobDetails[key]) return true;
        return services.some(s => s.name && s.name.toLowerCase().includes(key.toLowerCase()));
    }

    const check = (key) => isSelected(key) ? CHECKED : UNCHECKED;

    // ── Job scope details (Quantity column) ──────────────────────────────────
    function deckQty() {
        const d = jobDetails.deck; if (!d) return '';
        const p = [];
        if (d.sqft)      p.push(d.sqft + ' sq ft');
        if (d.condition) p.push('Cond. ' + d.condition + '/5');
        if (d.rails)     p.push('Rails/Stairs');
        if (d.linft)     p.push(d.linft + ' lin ft (rotten)');
        return p.join(', ');
    }
    function gutterQty() {
        const g = jobDetails.gutter; if (!g) return '';
        return (g.stories ? g.stories + '-storey' : '') + (g.deepClean ? ', Deep Clean' : '');
    }
    function interlockQty() {
        const i = jobDetails.interlock; if (!i) return '';
        const p = [];
        if (i.sqft)                          p.push(i.sqft + ' sq ft');
        if (i.severity && i.severity !== 'none') p.push(i.severity + ' re-level');
        if (i.seal)                          p.push('Sealing');
        return p.join(', ');
    }
    function windowQty() {
        const w = jobDetails.window; if (!w) return '';
        return (w.count ? w.count + ' units' : '') +
               (w.type  ? ' (' + (w.type === 'full' ? 'Int+Ext' : 'Ext only') + ')' : '');
    }
    function sidingQty() {
        const s = jobDetails.siding; if (!s) return '';
        return (s.stories ? s.stories + '-storey' : '') + (s.condition ? ', ' + s.condition : '');
    }
    function gardenQty() {
        const g = jobDetails.garden; if (!g) return '';
        const p = [];
        if (g.mulch)                         p.push(g.mulch + ' yd³ mulch');
        if (g.weeding && g.weeding !== 'none') p.push(g.weeding + ' weeding');
        if (g.overgrowth)                    p.push(g.overgrowth + 'h overgrowth');
        if (g.edging)                        p.push(g.edging + ' lin ft edging');
        return p.join(', ');
    }

    // ── Pricing ──────────────────────────────────────────────────────────────
    const contractPrice = (lead.subtotal || '').replace(/^\$/, '') || '0.00';
    const hstAmount     = (lead.hst      || '').replace(/^\$/, '') || '0.00';
    const totalDue      = (lead.total    || '').replace(/^\$/, '') || '0.00';

    // ── Timeline ─────────────────────────────────────────────────────────────
    const startDate = dateOfService;
    const completionDate = lead.saleDate
        ? new Date(new Date(lead.saleDate).getTime() + 86400000)
            .toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'TBD';

    // ── Signature image ───────────────────────────────────────────────────────
    // Strip the data URL prefix if present; fall back to blank PNG
    let sigBuffer = BLANK_PNG;
    if (signatureData) {
        try {
            const b64 = signatureData.includes(',')
                ? signatureData.split(',')[1]
                : signatureData;
            sigBuffer = Buffer.from(b64, 'base64');
        } catch (_) {
            sigBuffer = BLANK_PNG;
        }
    }

    return {
        data: {
            // Image module looks up data.clientSig — pass the Buffer directly
            clientSig: sigBuffer,

            clientName,
            serviceAddress,
            dateOfService,

            deckCheck:      check('deck'),
            gutterCheck:    check('gutter'),
            interlockCheck: isSelected('interlock') || isSelected('hardscape') ? CHECKED : UNCHECKED,
            windowCheck:    check('window'),
            sidingCheck:    isSelected('siding') ? CHECKED : UNCHECKED,
            gardenCheck:    check('garden'),
            othersCheck:    UNCHECKED,

            deckQty:      deckQty(),
            gutterQty:    gutterQty(),
            interlockQty: interlockQty(),
            windowQty:    windowQty(),
            sidingQty:    sidingQty(),
            gardenQty:    gardenQty(),
            othersQty:    '',

            deckPrice:      svcPrice('deck'),
            gutterPrice:    svcPrice('gutter'),
            interlockPrice: svcPrice('interlock') || svcPrice('hardscape'),
            windowPrice:    svcPrice('window'),
            sidingPrice:    svcPrice('siding'),
            gardenPrice:    svcPrice('garden'),
            othersPrice:    '',

            contractPrice,
            hstAmount,
            totalDue,

            startDate,
            completionDate,

            // clientSig is handled by ImageModule via getImage below
            contractorName:       repName + ' — Core Exteriors Ltd.',
            clientSigDate:        dateStr,
            contractorSigDate:    dateStr,
        },
        sigBuffer,
    };
}

/**
 * Generate the filled contract as a Buffer.
 * @param {object} lead          – full lead record
 * @param {string|null} signatureData – base64 PNG data URL or null
 * @returns {Promise<Buffer>}
 */
async function generateContractDocx(lead, signatureData) {
    const templatePath = path.join(__dirname, 'CONTRACT_TEMPLATE.docx');
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);

    const { data, sigBuffer } = buildTemplateData(lead, signatureData);

    // Image module: {%clientSig} → the signature PNG buffer stored in data.clientSig
    const imageModule = new ImageModule({
        centered: false,
        fileType: 'docx',
        getImage(tagValue) {
            // tagValue is data.clientSig — a Buffer
            return Buffer.isBuffer(tagValue) ? tagValue : BLANK_PNG;
        },
        getSize() {
            return [220, 60]; // width × height in pixels
        },
    });

    const doc = new Docxtemplater(zip, {
        modules: [imageModule],
        paragraphLoop: true,
        linebreaks: true,
    });

    doc.render(data);

    return doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE',
    });
}

module.exports = { generateContractDocx };
