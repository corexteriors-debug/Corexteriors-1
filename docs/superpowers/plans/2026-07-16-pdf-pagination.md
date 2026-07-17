# PDF Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimate and Invoice PDFs start a new page (with a repeated footer and a continuation header) instead of silently pushing content past the bottom of a single page when there are enough services to overflow it.

**Architecture:** Add a `drawFooter(pg)` helper (extracted from the existing one-time footer code) and a `newPageIfNeeded(needed, redrawTableHeader)` helper to each of `buildEstimate` and `buildInvoice`. Call the latter before each service row and once before the totals block. `page` becomes reassignable (`let` instead of `const`) so a page break just repoints it — every other `page.drawX(...)` call already references the `page` variable and needs no other change.

**Tech Stack:** `pdf-lib`. No test runner exists in this repo — verification is `node --check` plus generating real PDFs (including the exact 10-service stress case that originally exposed this bug) and visually inspecting them with the Read tool.

---

### Task 1: Create a feature branch and worktree

**Files:** none (git only)

- [ ] **Step 1: From the main repo directory, create the worktree**

```bash
git worktree add .worktrees/pdf-pagination -b fix/pdf-pagination
cd .worktrees/pdf-pagination
npm install
```

- [ ] **Step 2: Confirm baseline**

```bash
node --check api/_estimatePdf.js
```

Expected: no output (exit code 0).

---

### Task 2: Add pagination to `buildEstimate`

**Files:**
- Modify: `api/_estimatePdf.js` (inside `buildEstimate` — page declaration, new helpers, row loop, totals checkpoint, final footer)

- [ ] **Step 1: Confirm current state**

```bash
grep -n "const page = doc.addPage" api/_estimatePdf.js
grep -n "async function buildEstimate" api/_estimatePdf.js
grep -n "async function buildInvoice" api/_estimatePdf.js
```

Expected: TWO matches for `const page = doc.addPage` (one in `buildEstimate`, one in `buildInvoice` — you're only touching the FIRST one, inside `buildEstimate`, in this task). `buildEstimate` starts before `buildInvoice` in the file.

- [ ] **Step 2: Make `page` reassignable**

In `buildEstimate` (the function that starts `async function buildEstimate(est) {`), replace:
```javascript
    const doc  = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
```
With:
```javascript
    const doc  = await PDFDocument.create();
    let page = doc.addPage([612, 792]);
```

- [ ] **Step 3: Add `drawFooter` and `newPageIfNeeded` helpers**

Find this line in `buildEstimate` (right after the `services` filter, before the HEADER BAR comment):
```javascript
    const services  = (Array.isArray(est.services) ? est.services : []).filter(sv => sv.name && sv.price);

    // ── HEADER BAR (navy, full width) ────────────────────────────────────────
```

Replace it with:
```javascript
    const services  = (Array.isArray(est.services) ? est.services : []).filter(sv => sv.name && sv.price);

    function drawFooter(pg) {
        pg.drawRectangle({ x: 0, y: 0, width: W, height: 38, color: navy });
        const footerTxt = 'Core Exteriors  |  203 Cambridge St, London, ON, N6H 1N6  |  606 616 2026  |  corexteriors.ca';
        const ftw = font.widthOfTextAtSize(footerTxt, 8);
        pg.drawText(footerTxt, { x: (W - ftw) / 2, y: 14, size: 8, font, color: rgb(0.55, 0.63, 0.74) });
    }

    function newPageIfNeeded(needed, redrawTableHeader) {
        const BOTTOM_MARGIN = 130;
        if (y - needed >= BOTTOM_MARGIN) return;
        drawFooter(page);
        page = doc.addPage([612, 792]);
        page.drawRectangle({ x: 0, y: H - 40, width: W, height: 40, color: navy });
        page.drawText('CORE EXTERIORS  —  ESTIMATE (continued)', { x: ML, y: H - 25, size: 11, font: bold, color: white });
        y = H - 60;
        altRow = false;
        if (redrawTableHeader) {
            page.drawRectangle({ x: ML, y: y - 20, width: CW, height: 20, color: navy });
            page.drawText('SERVICE', { x: ML + 10, y: y - 14, size: 8.5, font: bold, color: white });
            page.drawText('AMOUNT',  { x: W - MR - 55, y: y - 14, size: 8.5, font: bold, color: white });
            y -= 20;
        }
    }

    // ── HEADER BAR (navy, full width) ────────────────────────────────────────
```

Note: `newPageIfNeeded` references `altRow`, which is declared with `let altRow = false;` further down in the function (inside the service-row section). This is safe — `newPageIfNeeded` is only ever *called* later, after that `let` has already executed, even though it's *defined* earlier in the file. Do not move the `let altRow = false;` declaration.

- [ ] **Step 4: Call `newPageIfNeeded` before each service row**

Find:
```javascript
    let altRow = false;
    const priceColW = 90;
    const nameMaxW = CW - 20 - priceColW;
    const lineH = 11;
    services.forEach(svc => {
        const nameLines = wrapText(s(svc.name), font, 9, nameMaxW);
        const rowH = 22 + (nameLines.length - 1) * lineH;
        if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });
```

Replace with:
```javascript
    let altRow = false;
    const priceColW = 90;
    const nameMaxW = CW - 20 - priceColW;
    const lineH = 11;
    services.forEach(svc => {
        const nameLines = wrapText(s(svc.name), font, 9, nameMaxW);
        const rowH = 22 + (nameLines.length - 1) * lineH;
        newPageIfNeeded(rowH, true);
        if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });
```

(Everything else inside the `.forEach` callback — drawing the wrapped lines, the price, the divider line, `y -= rowH`, `altRow = !altRow` — stays exactly as-is.)

- [ ] **Step 5: Call `newPageIfNeeded` before the totals block**

Find:
```javascript
    if (!services.length) {
        page.drawText('No services specified.', { x: ML + 10, y: y - 15, size: 9, font, color: gray });
        y -= 22;
    }

    y -= 12;

    // ── TOTALS (right-aligned block) ─────────────────────────────────────────
```

Replace with:
```javascript
    if (!services.length) {
        page.drawText('No services specified.', { x: ML + 10, y: y - 15, size: 9, font, color: gray });
        y -= 22;
    }

    y -= 12;
    newPageIfNeeded(110, false);

    // ── TOTALS (right-aligned block) ─────────────────────────────────────────
```

- [ ] **Step 6: Replace the one-time footer draw with a call to the new helper**

Find:
```javascript
    // ── FOOTER ───────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0, width: W, height: 38, color: navy });
    const footerTxt = 'Core Exteriors  |  203 Cambridge St, London, ON, N6H 1N6  |  606 616 2026  |  corexteriors.ca';
    const ftw = font.widthOfTextAtSize(footerTxt, 8);
    page.drawText(footerTxt, { x: (W - ftw) / 2, y: 14, size: 8, font, color: rgb(0.55, 0.63, 0.74) });

    return await doc.save();
}
```

This is the end of `buildEstimate` — replace with:
```javascript
    // ── FOOTER ───────────────────────────────────────────────────────────────
    drawFooter(page);

    return await doc.save();
}
```

Do NOT touch `buildInvoice` (a separate function further down the file) — that's Task 3.

- [ ] **Step 7: Syntax-check**

```bash
node --check api/_estimatePdf.js
```

Expected: no output (exit code 0).

- [ ] **Step 8: Generate the exact stress-test PDF that originally exposed this bug, and visually verify the fix**

Create a temporary script inside the worktree (delete it afterward, don't commit it):

```javascript
const { generateEstimatePDF } = require('./api/_estimatePdf.js');
const fs = require('fs');

(async () => {
    const areaNames = ['Front Driveway','Backyard Patio','Side Walkway','Pool Deck Surround','Front Porch Steps','Garden Path','Garage Apron','Fire Pit Area','Rear Patio Extension','Front Entrance Landing'];
    const areas = areaNames.map((n, i) => n + ': ' + (300 + i*40) + 'sqft Poly (' + ['Large','Medium','Small'][i%3] + ')' + (i%2===0 ? ', Sealer' : '') + (i%3===0 ? ', ' + (20+i*5) + 'sqft Relevel' : ''));
    const interlockName = 'Interlock – ' + areas.join(' | ');

    const services = [
        { name: interlockName, price: '11200.00' },
        { name: 'Deck Restoration', price: '1200.00' },
        { name: 'Gutter Cleaning – Front: 1-storey | Back: 2-storey, Extra Downspout', price: '350.00' },
        { name: 'Window Cleaning – 24 Windows (Full Service)', price: '620.00' },
        { name: 'Siding Soft Wash – 2 Story', price: '480.00' },
        { name: 'Garden Maintenance', price: '300.00' },
        { name: 'Pressure Washing – Full Driveway and Walkway, Pre-Treatment Applied', price: '450.00' },
        { name: 'Exterior Painting – Trim and Fascia, Two Coats, Premium Paint', price: '890.00' },
        { name: 'Graffiti Removal – Garage Door and Side Fence, Chemical Treatment', price: '275.00' },
        { name: 'Roof Cleaning – Moss and Algae Treatment, Full Roof Soft Wash', price: '650.00' },
    ];
    const subtotal = services.reduce((s,x)=>s+parseFloat(x.price),0);
    const hst = subtotal * 0.13;
    const total = subtotal + hst;

    const est = {
        estimateNumber: 'CE-2026-STRESS', clientName: 'Jordan Smith',
        address: '48 Maple Ridge Court, London, ON N6H 2X1', phone: '519-555-9821',
        email: 'jordan.smith@example.com', salesRep: 'Mike T.',
        services, subtotal: subtotal.toFixed(2), hst: hst.toFixed(2), total: total.toFixed(2),
    };

    const bytes = await generateEstimatePDF(est, { docType: 'ESTIMATE' });
    fs.writeFileSync('stress-test-estimate-paginated.pdf', bytes);
    console.log('Wrote stress-test-estimate-paginated.pdf, pages should now be > 1 if content overflowed');
})();
```

Run it with `node`, then use your Read tool on the resulting PDF (it can render multiple pages — read the whole file). Confirm:
- The document now has 2 pages (this specific 10-service/6-line-interlock case should overflow page 1).
- Page 1 shows as many complete service rows as fit, ending with a proper footer bar (not cut off mid-row).
- Page 2 starts with a "CORE EXTERIORS — ESTIMATE (continued)" header, a repeated SERVICE/AMOUNT column header, then the remaining service row(s), and — critically — the Subtotal/HST/TOTAL ESTIMATE block and Terms & Conditions are now fully visible somewhere in the document (not cut off).
- No row is split mid-way across the page break (a full row's text should never appear partially on one page and partially on the next).

If anything looks wrong, fix it before proceeding.

- [ ] **Step 9: Also regenerate one of the earlier, non-overflowing test cases to confirm single-page documents are unaffected**

Reuse the same script pattern with just 3 services (interlock 3-area, gutter, window — as used in the original text-wrapping fix's test) and confirm it still produces exactly 1 page, unchanged from before this task.

- [ ] **Step 10: Clean up temp files**

```bash
rm stress-test-*.js stress-test-*.pdf
```

- [ ] **Step 11: Commit**

```bash
git add api/_estimatePdf.js
git commit -m "fix: paginate estimate PDF when services overflow one page

buildEstimate drew everything onto a single page with no bounds
check, so a job with enough services (confirmed with a 10-service,
6-line-wrapped-interlock stress test) silently pushed the totals and
terms past the visible page. Now breaks to a new page — with a
repeated footer and a continuation header — before any row or the
totals block that wouldn't fit."
```

---

### Task 3: Add pagination to `buildInvoice`

**Files:**
- Modify: `api/_estimatePdf.js` (inside `buildInvoice` — page declaration, new helpers, row loop, totals checkpoint, final footer)

- [ ] **Step 1: Confirm current state**

```bash
grep -n "const page = doc.addPage" api/_estimatePdf.js
```

Expected: now only ONE match (inside `buildInvoice` — `buildEstimate`'s was changed to `let` in the prior task). Also confirm `drawFooter`/`newPageIfNeeded` don't already exist in `buildInvoice`:

```bash
grep -n "function drawFooter\|function newPageIfNeeded" api/_estimatePdf.js
```

Expected: each name appears exactly once so far (both inside `buildEstimate`, from the prior task) — you're adding a SECOND, separate pair of same-named local functions inside `buildInvoice`. This is safe: they're declared with `function` inside two different outer functions (`buildEstimate` and `buildInvoice`), so there's no collision — each is scoped to its own function body, exactly like `priceColW`/`nameMaxW`/`lineH` already are in both functions today.

- [ ] **Step 2: Make `page` reassignable**

In `buildInvoice`, replace:
```javascript
    const doc  = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
```
With:
```javascript
    const doc  = await PDFDocument.create();
    let page = doc.addPage([612, 792]);
```

- [ ] **Step 3: Add `drawFooter` and `newPageIfNeeded` helpers**

Find this line in `buildInvoice` (right after `dateSvc` is computed, before the HEADER comment):
```javascript
    const dateSvc   = visitRaw ? fmtDate(visitRaw) : 'To Be Confirmed';

    // ── HEADER: orange stripe + navy bar ─────────────────────────────────────
```

Replace with:
```javascript
    const dateSvc   = visitRaw ? fmtDate(visitRaw) : 'To Be Confirmed';

    function drawFooter(pg) {
        pg.drawRectangle({ x: 0, y: 0,  width: W, height: 44, color: navy });
        pg.drawRectangle({ x: 0, y: 44, width: W, height: 4,  color: orange });
        const footerTxt = 'Core Exteriors  •  HST# 745847632 RT0001  •  203 Cambridge St, London, ON N6H 1N6  •  519-712-1431  •  corexteriors.ca';
        const ftw = font.widthOfTextAtSize(footerTxt, 7.5);
        pg.drawText(footerTxt, { x: (W - ftw) / 2, y: 16, size: 7.5, font, color: rgb(0.55, 0.63, 0.74) });
    }

    function newPageIfNeeded(needed, redrawTableHeader) {
        const BOTTOM_MARGIN = 130;
        if (y - needed >= BOTTOM_MARGIN) return;
        drawFooter(page);
        page = doc.addPage([612, 792]);
        page.drawRectangle({ x: 0, y: H - 40, width: W, height: 40, color: navy });
        page.drawText('CORE EXTERIORS  —  INVOICE (continued)', { x: ML, y: H - 25, size: 11, font: bold, color: white });
        y = H - 60;
        altRow = false;
        if (redrawTableHeader) {
            page.drawRectangle({ x: ML, y: y - 24, width: CW, height: 24, color: navy });
            page.drawText('SERVICE', { x: ML + 12, y: y - 16, size: 8.5, font: bold, color: white });
            page.drawText('AMOUNT', { x: W - MR - bold.widthOfTextAtSize('AMOUNT', 8.5) - 12, y: y - 16, size: 8.5, font: bold, color: white });
            y -= 24;
        }
    }

    // ── HEADER: orange stripe + navy bar ─────────────────────────────────────
```

Same note as Task 2: `newPageIfNeeded` references `altRow`, declared later with `let altRow = false;` — safe because it's only called after that line has executed.

- [ ] **Step 4: Call `newPageIfNeeded` before each service row**

Find:
```javascript
    let altRow = false;
    const priceColW = 100;
    const nameMaxW = CW - 24 - priceColW;
    const lineH = 12;
    services.forEach(svc => {
        const nameLines = wrapText(s(svc.name), font, 10, nameMaxW);
        const rowH = 26 + (nameLines.length - 1) * lineH;
        if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });
```

Replace with:
```javascript
    let altRow = false;
    const priceColW = 100;
    const nameMaxW = CW - 24 - priceColW;
    const lineH = 12;
    services.forEach(svc => {
        const nameLines = wrapText(s(svc.name), font, 10, nameMaxW);
        const rowH = 26 + (nameLines.length - 1) * lineH;
        newPageIfNeeded(rowH, true);
        if (altRow) page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: lightGray });
```

- [ ] **Step 5: Call `newPageIfNeeded` before the totals block**

Find:
```javascript
    if (!services.length) {
        page.drawText('No services specified.', { x: ML + 12, y: y - 17, size: 9, font, color: gray });
        y -= 26;
    }

    y -= 12;

    // ── TOTALS ───────────────────────────────────────────────────────────────
```

Replace with:
```javascript
    if (!services.length) {
        page.drawText('No services specified.', { x: ML + 12, y: y - 17, size: 9, font, color: gray });
        y -= 26;
    }

    y -= 12;
    newPageIfNeeded(220, false);

    // ── TOTALS ───────────────────────────────────────────────────────────────
```

(220pt reserves room for the worst case: Subtotal + Discount + HST + TOTAL + Deposit Paid + Balance Owing, all six rows at 24pt each, plus the 20pt gap and the 56pt Payment Information box — `6*24 + 20 + 56 = 220`. This is a conservative reservation; on invoices without a discount or deposit, the actual content drawn will be shorter than what was reserved, which just means the page break may trigger slightly earlier than the bare minimum necessary — a safe bias, not a bug.)

- [ ] **Step 6: Replace the one-time footer draw with a call to the new helper**

Find:
```javascript
    // ── FOOTER ───────────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0,  width: W, height: 44, color: navy });
    page.drawRectangle({ x: 0, y: 44, width: W, height: 4,  color: orange });
    const footerTxt = 'Core Exteriors  •  HST# 745847632 RT0001  •  203 Cambridge St, London, ON N6H 1N6  •  519-712-1431  •  corexteriors.ca';
    const ftw = font.widthOfTextAtSize(footerTxt, 7.5);
    page.drawText(footerTxt, { x: (W - ftw) / 2, y: 16, size: 7.5, font, color: rgb(0.55, 0.63, 0.74) });

    return await doc.save();
}
```

This is the end of `buildInvoice` — replace with:
```javascript
    // ── FOOTER ───────────────────────────────────────────────────────────────
    drawFooter(page);

    return await doc.save();
}
```

- [ ] **Step 7: Syntax-check**

```bash
node --check api/_estimatePdf.js
```

Expected: no output (exit code 0).

- [ ] **Step 8: Generate the exact stress-test invoice PDF that originally exposed this bug, and visually verify the fix**

Reuse the Task 2 Step 8 script, but call `generateEstimatePDF({ ...est, invoiceNumber: 'INV-2026-STRESS', paymentStatus: 'Deposit', paymentAmount: 3000, paymentMethod: 'E-transfer' }, { docType: 'INVOICE' })` and write to `stress-test-invoice-paginated.pdf`.

Use your Read tool on the result and confirm:
- The document now has multiple pages.
- The BILL TO/FROM boxes and service table start on page 1 as before.
- Wherever the break happens, the Subtotal/HST/TOTAL/Deposit Paid/BALANCE OWING rows AND the PAYMENT INFORMATION box are now fully visible somewhere in the document — this is the specific content that was missing before this fix. Confirm the dollar amounts match what was requested (Subtotal $16,415.00, HST $2,133.95, TOTAL $18,548.95, Deposit Paid -$3,000.00, BALANCE OWING $15,548.95).
- No row split mid-way across a page break.
- The footer bar appears at the bottom of every page, not just the last one.

If anything looks wrong, fix it before proceeding.

- [ ] **Step 9: Regenerate a small, non-overflowing invoice (3 services) to confirm single-page invoices are unaffected**

Confirm it still produces exactly 1 page with the same visual layout as before this task (BILL TO/FROM, service table, totals, payment info, footer all on one page).

- [ ] **Step 10: Clean up temp files**

```bash
rm stress-test-*.js stress-test-*.pdf
```

- [ ] **Step 11: Commit**

```bash
git add api/_estimatePdf.js
git commit -m "fix: paginate invoice PDF when services overflow one page

Same fix as the estimate PDF (previous commit) — applied to the
separate, near-duplicate buildInvoice function. This is the function
where the original stress test found TOTAL, Deposit Paid, BALANCE
OWING, and the Payment Information box being pushed invisibly past
the bottom of the page."
```

---

### Task 4: Deploy and confirm in production

**Files:** none (deployment + manual verification)

- [ ] **Step 1: Push the branch and merge**

```bash
git push -u origin fix/pdf-pagination
git checkout main
git pull origin main
git merge fix/pdf-pagination
git push origin main
```

- [ ] **Step 2: Deploy to production**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
vercel --prod --scope core-exteriors-projects
```

Expected: deployment succeeds, aliased to `corexteriors.ca`. If the deployment queue is slow (this has happened before this session due to Vercel-side backlog, unrelated to this code), wait for it rather than re-triggering additional deploys — check `vercel ls --scope core-exteriors-projects` periodically instead of firing more deploy commands.

- [ ] **Step 3: Final production sanity check**

From the main repo (post-merge), directly re-run the same 10-service stress-test script one more time against the merged `api/_estimatePdf.js` (this is a pure function — no network/KV dependency — so this works without needing a live deployment) and visually confirm via the Read tool that the paginated output still looks correct on the exact code that's now live.

```bash
rm -f stress-test-*.pdf stress-test-*.js
```

- [ ] **Step 4: Clean up the worktree and branch**

```bash
git worktree remove .worktrees/pdf-pagination
git branch -d fix/pdf-pagination
git push origin --delete fix/pdf-pagination
```

---

## Self-Review Notes

- **Spec coverage:** Task 2 covers `buildEstimate`'s pagination (helpers, row-loop checkpoint, totals checkpoint, footer-per-page). Task 3 covers the identical treatment for `buildInvoice`. The spec's "whole rows only, never split mid-row" requirement is satisfied because `newPageIfNeeded` is always called with the row's full, already-computed `rowH` BEFORE any of that row's lines are drawn — so the break decision happens atomically, before any partial drawing.
- **Signature block and Notes pagination** are explicitly out of scope per the spec, and no task touches them.
- **Placeholder scan:** No TBDs; all code blocks are complete and copy-pasteable, including the full stress-test verification script.
- **Type/naming consistency:** `drawFooter(pg)` and `newPageIfNeeded(needed, redrawTableHeader)` have identical signatures in both Task 2 (`buildEstimate`) and Task 3 (`buildInvoice`) — only their internal drawing constants differ (matching each function's existing margins/fonts), consistent with how `priceColW`/`nameMaxW`/`lineH` already differ between the two functions from the earlier text-wrapping fix.
