# Core Exteriors — PDF Pagination for Estimate/Invoice
**Date:** 2026-07-16
**Scope:** `api/_estimatePdf.js` only
**Approach:** Page-break-aware drawing at two points per document (service rows, totals block), whole-row breaks only, footer repeated on every page.

---

## Context

A prior fix (same day, earlier commits) made long service names wrap onto multiple lines instead of running off the page edge. A follow-up stress test — 10 services on one invoice, including a 10-area interlock job wrapping to 6 lines — revealed a deeper, pre-existing bug: `buildEstimate` and `buildInvoice` each call `doc.addPage(...)` exactly once and never check whether content still fits above the bottom margin. On the stress-test invoice, the TOTAL, Deposit Paid, BALANCE OWING rows, and the entire PAYMENT INFORMATION box were pushed past the visible page — present in the PDF's text layer, but invisible, cut off by the page boundary. A client looking at that invoice would not see how much they owe or how to pay.

## Problem

Neither `buildEstimate` nor `buildInvoice` has any pagination. `y` (the running vertical cursor) can go arbitrarily negative as more content is drawn, silently pushing everything below the page's visible area once enough services/wrapped lines accumulate.

## Fix

### 1. A `newPageIfNeeded(needed)` helper, one per function

Each of `buildEstimate` and `buildInvoice` gets its own local helper (different page dimensions, margins, and footer content), following the same shape:

```javascript
function newPageIfNeeded(needed) {
    const BOTTOM_MARGIN = 130; // always leave room for a full totals/payment block above the footer
    if (y - needed < BOTTOM_MARGIN) {
        drawFooter(page);
        page = doc.addPage([612, 792]);
        y = H - 50;
        // continuation header: doc type name + "(continued)", then re-draw the SERVICE/AMOUNT
        // table header row so a reader landing on this page has context
    }
}
```

- `drawFooter(page)` is extracted from the existing one-time footer-drawing code at the bottom of each function, so it can be called once per page instead of once per document.
- The continuation header is a slim navy bar (not the full logo/date/PREPARED FOR header — that's page-1-only context) with `CORE EXTERIORS — ESTIMATE (continued)` (or `INVOICE (continued)`), followed by a fresh SERVICE/AMOUNT column header so the numbers that follow are still legible without scrolling back to page 1.

### 2. Called at two points in each function

- **Before each service row**, using the row's already-computed height (`rowH`, from the wrapping fix): `newPageIfNeeded(rowH)`. Per your direction, a row that doesn't fit moves to the new page as a whole unit — never split mid-line.
- **Before the totals block starts**: `newPageIfNeeded(TOTALS_BLOCK_HEIGHT)`, where `TOTALS_BLOCK_HEIGHT` is a conservative fixed estimate (~110pt for estimate's Subtotal/HST/TOTAL; ~180pt for invoice's larger Subtotal/Discount/HST/TOTAL/Deposit/Balance + Payment Information box), so the totals and (for invoices) payment info never get separated from a service table that just barely fit on the previous page.

### 3. `page` and `y` become reassignable

Currently both are `const page = doc.addPage(...)` and `let y = ...`. `page` needs to become `let page` so `newPageIfNeeded` can repoint it at a freshly created page; every subsequent `page.drawText(...)`/`page.drawRectangle(...)`/`page.drawLine(...)` call already references the `page` variable directly, so reassigning it makes all later drawing calls automatically target the new page with no other changes needed.

### 4. Signature block (invoice only) — unchanged

`buildInvoice`'s client signature block already has defensive logic (`if (signatureData && y > 110)`) that skips drawing it if there's insufficient room, rather than overlapping other content. This fix doesn't touch that — it's optional content that already fails safely, unlike the totals/payment-info bug this fix targets. Not widening scope to make the signature page-break-aware too.

## Out of scope

- True flowing/reflowing layout — this remains a fixed-position PDF generator (via pdf-lib), not an HTML-like layout engine. Pagination only triggers at the two boundaries above (row start, totals-block start), which fully covers the observed failure mode.
- Making the signature block page-break-aware (see #4 above).
- Notes section pagination — Notes are drawn after totals/terms in `buildEstimate` and after totals/payment-info in `buildInvoice`. If notes are unusually long, they inherit the same "no further breaking" limitation as before this fix; not addressed here since the reported failure was in the service table + totals, not notes. Worth a follow-up if it comes up in practice.
