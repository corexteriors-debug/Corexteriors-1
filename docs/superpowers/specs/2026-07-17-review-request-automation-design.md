# Core Exteriors — Post-Job Review Request Automation
**Date:** 2026-07-17
**Scope:** New review-request email flow, triggered 7 days after a job is marked completed, with star-rating gating between Google reviews and private feedback.

---

## Context

Core Exteriors wants to automatically ask clients to rate their experience 7 days after their job is actually finished (not booked), and route 5-star ratings to the public Google Business Profile review page while keeping lower ratings as private feedback the business can act on.

The existing codebase already has the building blocks this feature needs, and the design deliberately reuses them instead of introducing new infrastructure:

- **Storage**: leads live in Vercel KV (`@vercel/kv`), as `kv.set('lead:<id>', lead)` plus an index array `lead_ids`. No Postgres/Supabase exists in this project — this feature adds a second KV collection (`review:<id>` / `review_ids`) following the exact same shape, rather than adding a new database.
- **Cron + email pattern**: `api/remind.js` already runs daily (`vercel.json` cron `0 13 * * *`), loops all leads, checks a date condition, sends via nodemailer/Gmail, and sets a dedup flag on the lead (`reminderSent`/`reminderSentAt`). The new review-request cron mirrors this pattern exactly.
- **Admin auth**: `admin.html` logs in via `POST /api/auth` (password vs. `ADMIN_PASSWORD`/`SALES_PASSWORD` env vars), gets an opaque token stored in KV with a 7-day TTL, and sends it as `Authorization: Bearer <token>` on every request. New endpoints reuse this exact check — no new auth mechanism.
- **Lead updates**: `api/leads.js` already has a `PATCH` handler with an explicit field allowlist (`status`, `paymentStatus`, `clientName`, etc.). This feature adds `jobCompletedDate` to that allowlist rather than building a separate update endpoint.

## Data Model

### Lead record (extends existing schema in `api/leads.js`)
Two new fields, both added to the PATCH allowlist:
- `jobCompletedDate` (string, ISO date `YYYY-MM-DD`) — set manually by an admin via a "Mark Completed" action, defaulting to today but editable/backdatable. This is deliberately **not** auto-derived from `saleDate`/`survey.visitDate`, since those represent the booked/scheduled date, which can drift from when the job actually finished.
- `reviewEmailSent` (boolean) / `reviewEmailSentAt` (ISO timestamp) — dedup flag so the cron never sends the review request twice for the same lead, mirroring `reminderSent`/`reminderSentAt`.

### New KV collection: reviews
- `review:<id>` — one record per review-request sent. Shape:
  ```js
  {
    id,                // generated id for this review record
    leadId,            // FK back to the lead
    clientName,
    jobType,           // copied from lead.serviceType at send time
    jobCompletedDate,
    rating: null,      // 1-5, set when the client taps a star
    comment: null,     // set for 4-and-under ratings
    routedToGoogle: false,
    emailSentAt,       // ISO timestamp, set when the request email goes out
    ratedAt: null,     // ISO timestamp, set when the client submits a rating
    status: 'new'      // 'new' | 'read' | 'resolved'
  }
  ```
- `review_ids` — index array of all review record ids, same pattern as `lead_ids`.

## Trigger Logic

New cron endpoint: `api/reviewrequest.js`.
- Registered in `vercel.json` as a second cron entry: `"schedule": "0 14 * * *"` (2pm UTC — offset an hour from the existing reminder cron so the two never run concurrently).
- `GET`-only, authenticated via `Authorization: Bearer <CRON_SECRET>`, same check as `remind.js`.
- Logic:
  1. Load `lead_ids`, fetch each lead.
  2. Skip if: no `jobCompletedDate`, `reviewEmailSent` already true, no `email` on file, or `status` is `Lost`.
  3. Fire when `today === jobCompletedDate + 7 days` (date-only comparison, no time-of-day component).
  4. On fire: create the `review:<id>` record, send the request email, set `lead.reviewEmailSent = true` and `lead.reviewEmailSentAt = new Date().toISOString()`, `kv.set` the lead back.
  5. Return `{ sent, skipped, errors }`, same response shape as `remind.js`.

### Admin trigger for `jobCompletedDate`
`admin.html` gets a "Mark Completed" action per lead row: a date input (defaulting to today, editable for backdating) that calls `PATCH /api/leads` with `{ id, jobCompletedDate }`.

## Email

New shared helper `api/_mailer.js` extracts the nodemailer/Gmail transport setup that's currently duplicated across `remind.js`, `contact.js`, `invoice.js`, `followup.js`, and `payment.js`. This feature only uses the new helper for its own two files (`reviewrequest.js` and, if needed, `review.js`) — existing files are left untouched to keep this change scoped to the review feature.

Email content (tone matches existing client-facing copy):

> Hi {clientName}, thanks again for choosing Core Exteriors for your {jobType} job. Mind leaving a quick rating? Takes 10 seconds.
>
> ★ ★★ ★★★ ★★★★ ★★★★★

Each star count is its own link to `review.html?id=<reviewId>&rating=N` (N = 1 through 5). No embedded form in the email itself — clicking a star count is the entire interaction on the email side.

## Landing Page + Branching (strict gating)

New static page `review.html`, plus new endpoint `api/review.js`.

- **On load** (`GET /api/review?id=<reviewId>`): fetches `clientName`/`jobType` to render "Hi {clientName}, thanks for the {rating}★ rating" and pre-selects the star rating from the `rating` query param.
- **Rating = 5**: page redirects to the Google review link (`GOOGLE_REVIEW_URL` env var, value `https://g.page/r/Cd4lmTyS9JZ7EAI/review`). If the client typed a comment before the redirect fires, it's passed as a query param on a best-effort basis — **Google does not officially support pre-filling the review text box via URL parameters on this link format**, so this is attempted but not guaranteed; the client still must type/edit and hit "Post" on Google's side regardless. `POST /api/review` is called first to save `rating`, set `routedToGoogle = true`, and set `ratedAt`, before the redirect happens.
- **Rating ≤ 4**: page stays put, shows a comment textarea, `POST /api/review` saves `{ id, rating, comment }` to the review record (`routedToGoogle` stays `false`), shows a simple "thanks, we hear you" confirmation. Nothing is sent to Google.

### Review-gating disclosure

Per explicit decision: this implements **strict gating** — the email and landing page make it clear that a 5-star rating leads to a public Google review request, while lower ratings stay private. This is the pattern Google's review policies describe as prohibited ("selectively routing only satisfied customers to public review sites"), though it's extremely common in home-service software and enforcement is inconsistent. This is a known, accepted trade-off for this build — not a gap to fix later.

## Admin — Reviews Tab

Added as a new tab inside the existing `admin.html` single-page app (not a separate page), reusing its existing login/token/layout:
- New endpoint `api/reviews.js` (admin-only, same Bearer-token check as `api/leads.js`):
  - `GET` — list all `review:<id>` records, sorted by `emailSentAt` descending.
  - `PATCH` — update `status` (`new`/`read`/`resolved`) for a given review id.
- UI: table with columns for date, client/job, star rating badge, comment, routed-to-Google indicator. Filter dropdown: All / 4-and-under / 5-star. A "Mark resolved" toggle per row for the low-star ones that have been followed up on.

## New/Changed Files

| File | Change |
|---|---|
| `api/reviewrequest.js` | New — daily cron, sends review request emails |
| `api/review.js` | New — landing page's read/submit endpoint |
| `api/reviews.js` | New — admin list/update endpoint |
| `api/_mailer.js` | New — shared nodemailer/Gmail helper (used only by the two new send paths above) |
| `review.html` | New — star-rating landing + branching page |
| `api/leads.js` | Add `jobCompletedDate` to the PATCH allowlist |
| `admin.html` | Add "Mark Completed" action per lead row + new "Reviews" tab |
| `vercel.json` | Add second cron entry for `api/reviewrequest.js` |
| Vercel env vars | Add `GOOGLE_REVIEW_URL` = `https://g.page/r/Cd4lmTyS9JZ7EAI/review` |

## Out of Scope

- No new database (Postgres/Supabase) — everything lives in the existing Vercel KV.
- No refactor of the existing duplicated nodemailer setup in `remind.js`/`contact.js`/`invoice.js`/`followup.js`/`payment.js` — the new shared helper is additive, not a retrofit of existing files.
- No guarantee that Google pre-fills review text from a URL parameter — best-effort only, explicitly called out above.
- No backfill of `jobCompletedDate` for historical leads — the feature applies going forward only; old leads simply won't have review requests fire until (if ever) an admin marks them completed.
- No automatic "soft ask" mode — this build is strict gating only, per explicit decision above; a softer variant is a separate future feature if the strict version becomes a problem.
