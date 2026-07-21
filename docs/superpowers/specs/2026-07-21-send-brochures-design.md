# Core Exteriors — Send Brochures Feature
**Date:** 2026-07-21
**Scope:** New "Send Brochures" modal in `sales.html`, new `api/brochures.js` endpoint, 5 static brochure PDFs added to the repo. Removes the existing "Set My Availability" button/modal.

---

## Context

Sales reps often need to send a client more detailed information about a specific service (e.g. "what does deck restoration involve?") without generating a full estimate. Core Exteriors has 5 professionally designed marketing brochures (Deck Restoration, Gutter Cleaning & Guards, Interlock Relevel/Polysand/Seal, Window Cleaning, Power Washing — each 10-14 pages, static PDFs with no fillable form fields). This feature lets a sales rep check off any combination of these brochures and email them to the client currently loaded in the sales form, with a personalized cover page built from the client details already on the form (name, address, phone, email).

The 5 brochures don't map 1:1 to the form's existing 6 service checkboxes (no Garden brochure; "Power Washing" isn't the same as "Siding Soft Wash"), so the brochure picker is an independent list, not tied to which services are checked/priced on the current estimate.

## UI — `sales.html`

**Removed:** the "📅 Set My Availability" button and its `availModal` (and any JS solely supporting it) are deleted entirely — unrelated cleanup requested alongside this feature.

**Added, in that same location:** a plain-text "Send Brochures" button (no emoji, matching the explicit no-emoji request for this feature) that opens a new modal:
- 5 checkboxes, independent of the service checkboxes: Deck Restoration, Gutter Cleaning & Guards, Interlock (Relevel/Polysand/Seal), Window Cleaning, Power Washing.
- A read-only summary line showing who it'll send to: `<clientName>` · `<clientEmail>` · `<clientAddress>` · `<clientPhone>`, pulled directly from the already-filled form fields (no re-entry).
- Validation: Send is blocked with an inline message if no client name, no valid email, or no brochures are checked.
- A "Send" button and a status message area (reusing the form's existing `msg`/toast conventions), plus a Cancel/close action.

## Storage

The 5 PDFs are added to the repo as plain static files (this is already a static-HTML site — blog posts, images, etc. are all served this way with zero extra infrastructure):
- `brochures/CORE_Deck_Restoration_Residential_Brochure.pdf`
- `brochures/CORE_Gutter_Cleaning_and_Guards_Brochure.pdf`
- `brochures/CORE_Interlock_Relevel_Polysand_Seal_Brochure.pdf` (renamed from the source file, dropping the stray " (5)" suffix)
- `brochures/CORE_Power_Washing_Residential_Brochure.pdf`
- `brochures/CORE_Window_Cleaning_Residential_Brochure.pdf`

## Backend — new `api/brochures.js`

Mirrors `api/invoice.js`'s existing auth/email conventions (Bearer token via `kv.get('token:<token>')`, same Gmail/nodemailer transport pattern used across this codebase):

- **Request:** `POST` with `{ clientName, address, phone, email, salesRep, selected: ['deck', 'gutter', 'interlock', 'window', 'powerwash'] }`.
- **Validation:** requires `email` and at least one entry in `selected`; 400 otherwise.
- **Build:** using `pdf-lib` (already a dependency), constructs one combined PDF:
  1. A personalized cover page — navy header bar with "Core Exteriors" branding (matching the existing "PREPARED FOR" box style already used in `_estimatePdf.js`), showing:
     - PREPARED FOR: `<clientName>`
     - Address: `<address>`
     - Phone: `<phone>`
     - Email: `<email>`
     - Date, and "Prepared by: `<salesRep>`" (matching the estimate PDF's existing convention of crediting the rep)
     - A short list of which brochures are included in this packet
  2. For each brochure in `selected` (fixed order: Deck, Gutter, Interlock, Window, Power Washing, regardless of the order the checkboxes were clicked in), fetch its bytes from the site's own public URL (`process.env.SITE_URL || 'https://corexteriors.ca'` + `/brochures/<filename>`, same env-var pattern already established elsewhere in this codebase) and `copyPages` its full contents into the combined document.
- **Send:** emails the combined PDF as a single attachment (filename: `CoreExteriors_Brochures_<ClientName>.pdf`) to `email`, cc'd to the admin address, using the same Gmail transport already used by `invoice.js`/`remind.js`.
- **No persistence:** this does not create or update a lead/KV record — it's informational material, not a legal document, so nothing needs to be tracked beyond the email send itself.
- **Response:** `{ success: true, emailSent: true/false }`, matching the shape `invoice.js` already returns.

## Out of Scope

- No fillable-form-field editing of the brochures themselves — they remain fixed, professionally designed marketing pages; only the cover page is dynamic.
- No tie-in to the service checkboxes or estimate pricing — the brochure picker is intentionally independent.
- No record-keeping of which brochures were sent to which client (no KV write) — can be added later if reporting on this becomes useful.
- No Garden brochure (doesn't exist yet) and no attempt to map "Power Washing" onto the existing "Siding Soft Wash" service checkbox — it's its own independent checklist item.
