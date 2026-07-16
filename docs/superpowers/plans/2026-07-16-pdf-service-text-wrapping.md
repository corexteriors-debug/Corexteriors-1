# PDF Service Row Text Wrapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long service names (multi-area interlock, multi-entry gutter, long "Other" items) wrap onto multiple lines within their PDF table row instead of overflowing the page, at unchanged font size.

**Architecture:** Add a pixel-accurate `wrapText()` helper to `api/_estimatePdf.js`, then use it in both `buildEstimate`'s and `buildInvoice`'s service-row-drawing loops, making each row's height dynamic based on how many lines its (possibly wrapped) name needs.

**Tech Stack:** `pdf-lib` (already a dependency). No test runner exists in this repo — verification is `node --check` for syntax, plus generating real PDFs locally and visually inspecting them with the Read tool (which can render PDF pages).

---

### Task 1: Create a feature branch and worktree

**Files:** none (git only)

- [ ] **Step 1: From the main repo directory, create the worktree**

```bash
git worktree add .worktrees/pdf-text-wrap -b fix/pdf-service-text-wrap
cd .worktrees/pdf-text-wrap
npm install
```

Expected: worktree created, dependencies installed (mirrors the main checkout's `node_modules`).

- [ ] **Step 2: Confirm baseline**

```bash
node --check api/_estimatePdf.js
```

Expected: no output (exit code 0).

---

### Task 2: Add `wrapText()` helper and apply it to `buildEstimate`'s service rows

**Files:**
- Modify: `api/_estimatePdf.js:1-17` (add helper after the `s()` function)
- Modify: `api/_estimatePdf.js:104-120` (service-row loop inside `buildEstimate`)

- [ ] **Step 1: Confirm current state**

```bash
grep -n "^function s(text)" api/_estimatePdf.js
grep -n "let altRow = false;" api/_estimatePdf.js
```

Expected: `function s(text)` at line 8, and TWO matches for `let altRow = false;` (one in `buildEstimate` around line 104, one in `buildInvoice` around line 299 — you're only touching the FIRST one in this task).

- [ ] **Step 2: Add the `wrapText` helper right after the `s()` function**

Find:
```javascript
function fmtDate(iso) {
```

Insert immediately before it:
```javascript
// ── Pixel-accurate word wrap (unlike the char-count guess used for Notes below) ─
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

function fmtDate(iso) {
```

- [ ] **Step 3: Replace `buildEstimate`'s service-row loop**

This is the FIRST occurrence of `let altRow = false;` in the file (inside `buildEstimate`, which uses `size: 9` and starts with `const rowH = 22;`). Replace:

```javascript
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
```

With:

```javascript
    let altRow = false;
    const priceColW = 90;
    const nameMaxW = CW - 20 - priceColW;
    const lineH = 11;
    services.forEach(svc => {
        const nameLines = wrapText(s(svc.name), font, 9, nameMaxW);
        const rowH = 22 + (nameLines.length - 1) * lineH;
        if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });
        nameLines.forEach((line, i) => {
            page.drawText(line, { x: ML + 10, y: y - 15 - i * lineH, size: 9, font, color: black });
        });
        const priceStr = '$' + s(String(svc.price || '0').replace(/^\$/, ''));
        const pw = bold.widthOfTextAtSize(priceStr, 9);
        page.drawText(priceStr, { x: W - MR - pw - 8, y: y - 15, size: 9, font: bold, color: darkGray });
        page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.3, color: midGray });
        y -= rowH;
        altRow = !altRow;
    });
```

Do NOT touch the `if (!services.length) { ... }` block directly below it, or anything in `buildInvoice` (further down the file) — that's Task 3.

- [ ] **Step 4: Syntax-check**

```bash
node --check api/_estimatePdf.js
```

Expected: no output (exit code 0).

- [ ] **Step 5: Generate a real test PDF with multiple interlock areas and visually verify**

Create a temporary script (do not commit this file):

```bash
cat > /tmp/test-wrap.js <<'EOF'
const { generateEstimatePDF } = require('./api/_estimatePdf.js');
const fs = require('fs');

(async () => {
    const est = {
        estimateNumber: 'TEST-001',
        clientName: 'Test Client',
        address: '123 Test St, London, ON',
        phone: '519-555-1234',
        email: 'test@example.com',
        salesRep: 'Test Rep',
        services: [
            { name: 'Interlock – Front Driveway: 450sqft Poly (Large), Sealer | Back Patio: 200sqft Poly (Medium), 50sqft Relevel | Side Walkway: 120sqft Poly (Small), Sealer', price: '2450.00' },
            { name: 'Gutter Cleaning – Front: 1-storey | Back: 2-storey, Extra Downspout', price: '350.00' },
            { name: 'Window Cleaning – 12 Windows (Full Service)', price: '480.00' },
        ],
        subtotal: '3280.00',
        hst: '426.40',
        total: '3706.40',
    };
    const bytes = await generateEstimatePDF(est, { docType: 'ESTIMATE' });
    fs.writeFileSync('/tmp/test-estimate.pdf', bytes);
    console.log('Wrote /tmp/test-estimate.pdf');
})();
EOF
node /tmp/test-wrap.js
```

Expected: `Wrote /tmp/test-estimate.pdf` with no errors.

Then use the Read tool on `/tmp/test-estimate.pdf` (it supports rendering PDF pages) to visually confirm:
- The long Interlock service name wraps onto multiple lines, fully readable, at the same font size as the other rows (not shrunk).
- The price ($2,450.00) is aligned to the right, next to the FIRST line of the wrapped name.
- The Gutter row also wraps correctly (2 entries).
- The Window row (short, single-line) looks unchanged from before.
- No text overlaps, runs off the page edge, or overlaps the price column.
- Rows below (totals, terms) are pushed down appropriately and still fit on the page without overlapping the footer.

If anything looks wrong, fix it before proceeding — this is the primary verification for this task since there's no automated test suite.

- [ ] **Step 6: Clean up the temp script**

```bash
rm /tmp/test-wrap.js /tmp/test-estimate.pdf
```

- [ ] **Step 7: Commit**

```bash
git add api/_estimatePdf.js
git commit -m "fix: wrap long service names onto multiple lines in estimate PDF

Multi-area interlock and multi-entry gutter service names were being
drawn as a single line with no width check, running off the page
edge or into the price column. Wraps at the same font size instead
of shrinking or truncating."
```

---

### Task 3: Apply the same wrapping to `buildInvoice`'s service rows

**Files:**
- Modify: `api/_estimatePdf.js` (service-row loop inside `buildInvoice`, around line 299-315 in the original file — line numbers will have shifted after Task 2's edits, re-locate by content)

- [ ] **Step 1: Confirm current state**

```bash
grep -n "let altRow = false;" api/_estimatePdf.js
```

Expected: still TWO matches — the first (already fixed in Task 2, inside `buildEstimate`) now looks different (has `nameMaxW`/`lineH` lines right after it), and the second (inside `buildInvoice`, still using the OLD unwrapped pattern with `const rowH = 26;` and `size: 10`). You're editing the second one.

- [ ] **Step 2: Replace `buildInvoice`'s service-row loop**

Find (the SECOND `let altRow = false;` block, the one with `rowH = 26` and `size: 10`):

```javascript
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
```

With:

```javascript
    let altRow = false;
    const priceColW = 100;
    const nameMaxW = CW - 24 - priceColW;
    const lineH = 12;
    services.forEach(svc => {
        const nameLines = wrapText(s(svc.name), font, 10, nameMaxW);
        const rowH = 26 + (nameLines.length - 1) * lineH;
        if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });
        nameLines.forEach((line, i) => {
            page.drawText(line, { x: ML + 12, y: y - 17 - i * lineH, size: 10, font, color: black });
        });
        const priceStr = '$' + s(String(svc.price || '0').replace(/^\$/, ''));
        const pw = bold.widthOfTextAtSize(priceStr, 10);
        page.drawText(priceStr, { x: W - MR - pw - 12, y: y - 17, size: 10, font: bold, color: darkGray });
        page.drawLine({ start: { x: ML, y: y - rowH }, end: { x: W - MR, y: y - rowH }, thickness: 0.3, color: midGray });
        y -= rowH;
        altRow = !altRow;
    });
```

Note: `priceColW`, `nameMaxW`, and `lineH` are declared fresh here as local `const`s inside `buildInvoice` — this is a SEPARATE function from `buildEstimate`, so there's no name collision even though the variable names match. Do not try to share/import these across functions.

- [ ] **Step 3: Syntax-check**

```bash
node --check api/_estimatePdf.js
```

Expected: no output (exit code 0).

- [ ] **Step 4: Generate a real test invoice PDF and visually verify**

```bash
cat > /tmp/test-wrap-invoice.js <<'EOF'
const { generateEstimatePDF } = require('./api/_estimatePdf.js');
const fs = require('fs');

(async () => {
    const est = {
        estimateNumber: 'TEST-001',
        invoiceNumber: 'INV-TEST-001',
        clientName: 'Test Client',
        address: '123 Test St, London, ON',
        phone: '519-555-1234',
        email: 'test@example.com',
        salesRep: 'Test Rep',
        paymentStatus: 'Unpaid',
        services: [
            { name: 'Interlock – Front Driveway: 450sqft Poly (Large), Sealer | Back Patio: 200sqft Poly (Medium), 50sqft Relevel | Side Walkway: 120sqft Poly (Small), Sealer', price: '2450.00' },
            { name: 'Gutter Cleaning – Front: 1-storey | Back: 2-storey, Extra Downspout', price: '350.00' },
            { name: 'Window Cleaning – 12 Windows (Full Service)', price: '480.00' },
        ],
        subtotal: '3280.00',
        hst: '426.40',
        total: '3706.40',
    };
    const bytes = await generateEstimatePDF(est, { docType: 'INVOICE' });
    fs.writeFileSync('/tmp/test-invoice.pdf', bytes);
    console.log('Wrote /tmp/test-invoice.pdf');
})();
EOF
node /tmp/test-wrap-invoice.js
```

Expected: `Wrote /tmp/test-invoice.pdf` with no errors.

Then use the Read tool on `/tmp/test-invoice.pdf` to visually confirm the same things as Task 2 Step 5 (multi-line wrapping, readable font size, correct price alignment, no overlap, totals/payment box below still positioned correctly and not overlapping the footer).

- [ ] **Step 5: Clean up**

```bash
rm /tmp/test-wrap-invoice.js /tmp/test-invoice.pdf
```

- [ ] **Step 6: Commit**

```bash
git add api/_estimatePdf.js
git commit -m "fix: wrap long service names onto multiple lines in invoice PDF

Same fix as the estimate PDF (previous commit) — applied to the
separate, near-duplicate service-row loop in buildInvoice."
```

---

### Task 4: Deploy and confirm in production

**Files:** none (deployment + manual verification)

There is no staging PDF-generation endpoint separate from production — `_estimatePdf.js` is invoked by `api/invoice.js` and the estimate/contract flow in `sales.html`/`admin.html`. Verification here is: confirm the fix deploys cleanly, and re-run the same local generation test one more time against the merged code as a final sanity check before considering this done (real end-to-end testing through the sales portal UI is best done by you, since it requires generating an estimate through the actual form with real interlock area inputs — the local script in Tasks 2/3 already exercises the exact same code path `generateEstimatePDF` uses, so this is a formality, not a new functional risk).

- [ ] **Step 1: Push the branch and merge**

```bash
git push -u origin fix/pdf-service-text-wrap
git checkout main
git pull origin main
git merge fix/pdf-service-text-wrap
git push origin main
```

- [ ] **Step 2: Deploy to production**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
vercel --prod --scope core-exteriors-projects
```

Expected: deployment succeeds, aliased to `corexteriors.ca`.

- [ ] **Step 3: Clean up the worktree and branch**

```bash
git worktree remove .worktrees/pdf-text-wrap
git branch -d fix/pdf-service-text-wrap
git push origin --delete fix/pdf-service-text-wrap
```

- [ ] **Step 4: Tell the user to spot-check with a real estimate**

Ask the user to create a test estimate in `sales.html` with 2-3 interlock areas (or gutter entries) filled in, generate the PDF, and confirm it looks right in production — since this is a visually-driven fix, a real human look at a real generated document is the final word, beyond what local script-based verification can fully substitute for.

---

## Self-Review Notes

- **Spec coverage:** Task 2 covers the `wrapText` helper and `buildEstimate`'s fix (the spec's primary reported case — interlock). Task 3 covers `buildInvoice`'s identical fix. The "covers other services too" requirement is satisfied by construction — `wrapText` is applied generically to `svc.name` regardless of which service produced it, not just interlock.
- **Placeholder scan:** No TBDs; all code blocks are complete and copy-pasteable.
- **Type/naming consistency:** `wrapText(text, font, size, maxWidth)` signature is used identically in both Task 2 and Task 3 call sites (`wrapText(s(svc.name), font, 9, nameMaxW)` and `wrapText(s(svc.name), font, 10, nameMaxW)` respectively) — only the font size argument differs, matching each function's existing font size.
- **Out-of-scope items** (Notes wrapping, pagination) are explicitly called out in the design spec and intentionally have no corresponding task here.
