# Core Exteriors — Claude Code Project Guide

## Business
- **Company**: Core Exteriors — exterior maintenance (pressure washing, gutter cleaning, deck restoration, soft wash, window cleaning, siding cleaning, hardscaping)
- **Service area**: London, Ontario + surrounding (St. Thomas, Strathroy, Dorchester)
- **Website**: corexteriors.ca
- **GitHub**: https://github.com/oblokulov/Corexteriors

## Deploy
```bash
cd /c/Users/Mirkomil/Documents/corexteriors-main/src && vercel --prod
```
- Deploy root is `src/` — always run vercel from here
- `cleanUrls: true` — `.html` files served without extension (e.g. `/blog/slug`)
- Local dev: `npx live-server` from `src/`

## Project Structure
```
src/
├── index.html                  # Homepage (LocalBusiness schema present)
├── blog.html                   # Blog index with cards
├── blog/                       # Individual SEO blog posts
├── sales.html                  # Internal sales tool (job details fields)
├── admin.html                  # Admin dashboard (renders leads + jobDetails)
├── admin-login.html            # Auth for admin
├── admin-dashboard.html        # Extended dashboard view
├── crm/                        # Next.js CRM app (separate)
├── api/                        # Vercel serverless functions
│   ├── leads.js                # Save leads to Vercel KV (includes jobDetails)
│   ├── _contractPdf.js         # Generate contract PDF with JOB SCOPE section
│   ├── _contractDocx.js        # Generate contract DOCX
│   ├── contract.js             # Contract endpoint
│   ├── invoice.js              # Invoice generation
│   ├── payment.js              # Stripe payment
│   ├── stripe-webhook.js       # Stripe webhook handler
│   ├── calendar.js             # Google Calendar integration
│   ├── contact.js              # Contact form handler
│   ├── followup.js             # Follow-up logic
│   ├── remind.js               # Daily reminder cron (runs 1pm UTC)
│   ├── quick-leads.js          # Quick lead capture
│   └── auth.js                 # Authentication
├── styles.css                  # Global styles
├── script.js                   # Global JS
├── Bussiness stuff/            # Business docs, contracts, templates
├── Commerical outreach n8n/    # n8n automation workflows (JSON exports)
└── london-lead-finder-main/    # Lead finder tool
```

## Blog Posts (src/blog/)
- `signs-deck-needs-restoration-spring.html`
- `gutter-cleaning-frequency-london-ontario.html`
- `soft-wash-vs-pressure-wash.html`
- `wsib-compliant-contractors-ontario.html`
- `spring-exterior-maintenance-checklist-london-ontario.html`
- `how-we-price-below-franchise-competitors.html`
- `exterior-cleaning-dorchester-ontario.html`
- `gutter-cleaning-strathroy-ontario.html`
- `pressure-washing-st-thomas-ontario.html`

## Service Pages
- `deck-restoration-london-ontario.html`
- `gutter-cleaning-london-ontario.html`
- `siding-cleaning-london-ontario.html`
- `window-cleaning-london-ontario.html`
- `hardscape-optimization-london-ontario.html`

## SEO — Done
- Blog split into individual pages with unique URLs, title tags, meta, canonical, JSON-LD
- BlogPosting + BreadcrumbList schema on each post
- LocalBusiness schema on index.html
- Image alt text on blog cards and post pages
- Location-specific posts for Dorchester, Strathroy, St. Thomas

## SEO — Pending
- Blog topic ideas (20 high-intent topics)
- Content calendar April–September 2026
- Internal linking strategy
- Google Business Profile optimization tips
- Backlink outreach templates

## Tech Stack
- Static HTML/CSS/JS — no framework on frontend
- Vercel for hosting + serverless functions
- Vercel KV for lead storage
- Stripe for payments
- Google Calendar API for scheduling
- pdf-lib + docxtemplater for contract/invoice PDF generation
- n8n for automation workflows

## Key Patterns
- All API routes are in `src/api/` as Vercel serverless functions
- Lead data includes `jobDetails` field (chips rendered in admin)
- Contract PDF (`_contractPdf.js`) and DOCX (`_contractDocx.js`) both have JOB SCOPE section built from jobDetails
- DOCX contract uses `CONTRACT_TEMPLATE.docx` + docxtemplater + signature image embedding
- Admin is password-protected via `auth.js`
- www → non-www redirect configured in vercel.json
- Daily reminder cron: `api/remind.js` runs at 1pm UTC via Vercel Cron, emails clients scheduled for tomorrow
- Cron protected by `CRON_SECRET` env var (Bearer token)
- Stripe payments + webhook handler in `api/payment.js` + `api/stripe-webhook.js`
- Google Calendar auto-updates when admin reschedules a job (`api/calendar.js`)

## Git / GitHub
- Repo: `https://github.com/oblokulov/Corexteriors`
- Branch: `main`
- Push: `git add <files> && git commit -m "message" && git push origin main`
- `node_modules/` is gitignored — never commit it
