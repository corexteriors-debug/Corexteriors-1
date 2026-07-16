# Core Exteriors — PDF Service Row Text Wrapping
**Date:** 2026-07-16
**Scope:** `api/_estimatePdf.js` only
**Approach:** Wrap long service names onto multiple lines within their table row, at unchanged font size, with dynamic row height.

---

## Context

`api/_estimatePdf.js` generates the Estimate and Invoice PDFs handed to clients. Each has a SERVICE table where every selected service becomes one row: service name on the left, price on the right (`buildEstimate` around line 105, `buildInvoice` around line 300 — two separate, near-duplicate loops).

`sales.html`'s estimate builder constructs the service name for multi-area/multi-entry services by joining each area into one string:
- Interlock (`sales.html:2197`): `'Interlock – ' + areas.join(' | ')`, e.g. `Interlock – Front Driveway: 450sqft Poly (Large), Sealer | Back Patio: 200sqft Poly (Medium), 50sqft Relevel`
- Gutter (`sales.html:2178`): same pattern, `'Gutter Cleaning – ' + gutterLines.join(' | ')`

## Problem

`page.drawText(s(svc.name), { x: ML + 10, y: y - 15, size: 9, font, color: black })` draws this string on a single line at a fixed x position with no width check. pdf-lib does not auto-wrap or clip — the text simply keeps extending past the page's right edge (running into or past the price column, or off the page entirely) whenever the joined string is wider than the available column width. This is what happens when a sales rep enters 2+ interlock areas (or gutter entries) on an estimate.

## Fix

### 1. Add a pixel-accurate word-wrap helper

```javascript
function wrapText(text, font, size, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? current + ' ' + word : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
            current = candidate;
        } else {
            lines.push(current);
            current = word;
        }
    }
    if (current) lines.push(current);
    return lines;
}
```

This measures actual glyph width via `font.widthOfTextAtSize` (already used elsewhere in this file for right-aligning prices), unlike the existing Notes-section wrap (`notes.match(/.{1,110}(\s|$)/g)`), which guesses a fixed character count. `!current` guard prevents an infinite loop / dropped word if a single word alone is wider than `maxWidth` (rare, but a single very long area name could do this) — it gets placed on its own line rather than blocked forever.

### 2. Make each service row's height dynamic in both `buildEstimate` and `buildInvoice`

Reserve space for the price column, wrap the name into that width, compute row height from the number of lines, draw each line, and size the alternating background + divider to the actual row height:

```javascript
const priceColW = 90; // reserved width for the right-aligned price text
const nameMaxW = CW - 20 - priceColW; // 10pt left pad + 10pt gap before price
const lineH = 11; // matches current 9pt font's comfortable line spacing

services.forEach(svc => {
    const nameLines = wrapText(s(svc.name), font, 9, nameMaxW);
    const rowH = 22 + (nameLines.length - 1) * lineH; // 22 = today's single-line row height

    if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });

    nameLines.forEach((line, i) => {
        page.drawText(line, { x: ML + 10, y: y - 15 - i * lineH, size: 9, font, color: black });
    });

    const priceStr = '$' + s(String(svc.price || '0').replace(/^\$/, ''));
    const pw = bold.widthOfTextAtSize(priceStr, 9);
    page.drawText(priceStr, { x: W - MR - pw - 8, y: y - 15, size: 9, font: bold, color: darkGray }); // aligned to first line, same as today

    page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.3, color: midGray });
    y -= rowH;
    altRow = !altRow;
});
```

Same shape applies to `buildInvoice`'s loop, with its own existing constants (`rowH` base `26`, font size `10`, its own `CW`/`ML`/`MR`).

Font size is unchanged (9pt estimate, 10pt invoice) — rows simply grow taller instead of text shrinking or overflowing, per your requirement that text stay visible and readable.

### 3. Why this covers "other services too"

The wrap is applied to `svc.name` generically in the shared row-drawing loop — it isn't interlock-specific. Any service with a long name (gutter's multi-entry join, or a sales rep typing an unusually long "Other" custom item name) gets the same treatment automatically, with no per-service branching needed.

## Out of scope

- The Notes section's char-count-based wrap (`match(/.{1,110}(\s|$)/g)`, used in both `buildEstimate` and `buildInvoice`) has the same class of bug in theory (a string of unusually wide characters could still overflow) but is far less likely to actually trigger in practice, and isn't what was reported. Not touched by this fix.
- No pagination / second-page support is added. If a very large number of services (or one row wrapping to many lines) pushes content past the totals/footer area, that's a pre-existing limitation of this single-page PDF layout, not introduced by this change, and not addressed here.
