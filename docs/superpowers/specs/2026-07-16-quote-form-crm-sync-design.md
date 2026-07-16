# Core Exteriors — Quote Form → CRM Sync
**Date:** 2026-07-16
**Scope:** `api/contact.js`, `script.js` (quoteForm handler), `contact.html` (contactForm handler), `admin.html` (leads display)
**Approach:** Save a lead record directly to Vercel KV from `api/contact.js`, in the same shape `admin.html` already renders — no new endpoint, no schema migration.

---

## Context

Core Exteriors' live CRM is `admin.html`, a token-authenticated dashboard that reads leads from Vercel KV via `api/leads.js` (`GET /api/leads`). It's actively maintained (commits as recent as 2026-06-06: labour portal, Google Calendar auto-populate).

Two other systems exist in the repo but are **not** the live CRM and are out of scope here:
- `admin-dashboard.html` + `admin-login.html` — superseded pair using `crm-service.js`, hardcoded password, only 2 commits total, no recent activity.
- `crm/` — a separate Next.js app (`core-exteriors-crm`). Last commit 2026-02-22. Not wired into `vercel.json`, no `.vercel` link of its own.

`crmService.saveLead()` in `crm-service.js` is dead code — defined but never called by any current form handler.

## Problem

Three public forms POST to `api/contact.js`:
- `index.html` "Get Your Free Quote" (`#quoteForm`, submitted via `script.js`)
- `commercial.html` "Request a Commercial Bid" (`#quoteForm`, submitted via `script.js`)
- `contact.html` contact form (`#contactForm`, submitted via inline handler in `contact.html`)

`api/contact.js` only sends two emails (team notification + customer confirmation). It never writes to the KV store `admin.html` reads. Every web inquiry is invisible in the CRM unless staff manually retype it from the notification email.

Separately, `commercial.html`'s "Company / Property Name" field is collected in the DOM but dropped before it ever reaches the server: `script.js`'s hardcoded `leadData` object (used by both `index.html` and `commercial.html`, since they share the `#quoteForm` id) never reads `formData.get('company')`.

## Design

### 1. `api/contact.js` writes a lead to KV

Add a `require('@vercel/kv')` and, after validating `name`/`email`/`phone`, build and `kv.set` a lead object using the same key scheme as `api/leads.js` (`lead:<id>` + append to the `lead_ids` index list), so it appears in `admin.html`'s existing `GET /api/leads` fetch with zero admin-side data-fetching changes.

**Field mapping** (form → lead record):

| Lead field | Source |
|---|---|
| `id` | `lead_${Date.now()}_${random}` — same pattern as `api/leads.js` |
| `clientName` | `name` (index/commercial), or `firstName + ' ' + lastName` (contact.html) |
| `phone`, `email`, `address` | passed through as-is (blank if not on that form) |
| `serviceType` | human-readable label via the existing `serviceLabels` map already in `contact.js` |
| `notes` | `message` field, blank if not on that form |
| `company` | `commercial.html` only — new field |
| `leadSource` | `'website-commercial'` if `company` was submitted, else `'website-residential'` |
| `pageSource` | which page/form submitted it (`index.html`, `commercial.html`, `contact.html`) — for staff context only |
| `status` | `'New'` (matches existing lifecycle: New → Contacted → Quoted → Closed → Lost) |
| `createdAt` / `updatedAt` | server-set ISO timestamp |

All other lead fields that `api/leads.js` supports (`services`, `subtotal`, `paymentStatus`, `jobDetails`, `survey`, etc.) are left at their defaults — those are populated later by staff via `admin.html`, same as today.

**Ordering and failure handling:** the KV write happens before the email-sending step, and is wrapped in its own try/catch (logged, non-blocking) so:
- A KV outage never breaks the customer's "thank you" confirmation or blocks the email send.
- A Gmail misconfiguration (missing `GMAIL_APP_PASSWORD`) never causes a real inquiry to vanish without a trace — the lead is already saved by the time that check runs.

**No auto-scheduling.** `api/leads.js`'s `createJobEvent()` auto-books a Google Calendar "job" event for every POST (defaulting to today, 9am, if no date given) — that's intended for sales-confirmed jobs. Because `contact.js` writes to KV directly rather than going through `api/leads.js`, website inquiries will **not** trigger this. They land as unscheduled "New" leads, same as any manually-entered lead, until staff schedule them from `admin.html`.

### 2. Fix the dropped `company` field

In `script.js`'s `quoteForm` submit handler, add `company: formData.get('company')` to `leadData` and include it in the JSON body sent to `/api/contact`. Harmless no-op on `index.html` (no such field, so `null`).

### 3. `admin.html` display updates

- When `lead.leadSource === 'website-commercial'`: show a small "🏢 Commercial" badge next to the client name, with the company name displayed beneath it (same position `address` is already shown in both the desktop table and mobile card views).
- Add `company` to the search-string concatenation in both `renderLeadsTable`'s and `renderLeadsCards`' filter logic, so staff can search leads by company name.
- No new table columns, no schema migration — purely additive to existing render functions.

## Out of scope

- `admin-dashboard.html`, `admin-login.html`, `crm-service.js`, `crm/` — confirmed dead/superseded, not touched.
- Google Sheet webhook push (`GOOGLE_SHEET_WEBHOOK`) that `api/leads.js` does for sales-created leads — not replicated for website leads; can be added later if wanted.
- Spam/duplicate protection on the public form — not requested, existing behavior unchanged.
