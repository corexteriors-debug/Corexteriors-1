# Core Exteriors — UX, SEO & Credibility Improvements
**Date:** 2026-06-24  
**Scope:** All client-facing pages (excludes sales.html, admin, labour, outreach)  
**Approach:** B — Bug fixes + credibility layer + service page upgrade + SEO fixes

---

## Context

Core Exteriors is a static HTML site hosted on Vercel serving two audiences:
- **Homeowners** — price-sensitive, need reliability/credibility signals ("do you have a truck?")
- **Property managers** — not price-sensitive, need professionalism and ease of contact

Primary conversion goal: form submission first, then phone call.  
Key differentiators not yet on site: same-day communication, reliability, don't leave until job is done right.  
Reviews: averaged 5 stars.  
Founded: 2022.  
Coverage: $5M liability insurance.

---

## Section 1 — Bug Fixes

Fix these first. Everything else builds on top.

| Bug | Fix |
|-----|-----|
| Blog post logos broken (`../https://` prefix on R2 URLs) | Strip `../` from every R2 image/favicon URL in all 9 blog posts |
| Service page CTAs link to `index.html#contact` | Replace with `contact.html` on all 5 service pages |
| Service page canonicals include `.html` extension | Remove `.html` from canonicals on all 5 service pages (cleanUrls: true) |
| `privacy-policy.html` canonical includes `.html` | Change to `https://corexteriors.ca/privacy-policy` |
| All pages show `info@corexteriors.com` as display email | Replace with `corexteriors@gmail.com` site-wide — this is the real working inbox |
| `commercial.html` insurance table shows `$10,000,000` | Update to `$5,000,000` |
| Site shows "Est. 2023" in trust bar and footer | Change to "Est. 2022" everywhere |
| `contact.html` nav missing Winter Services link | Add it |
| All 9 blog posts nav missing Winter Services link | Add it to all 9 |

---

## Section 2 — Credibility Layer (Site-Wide)

Goal: answer the homeowner's unspoken question — "Is this a real, reliable company?"

### Trust bar
Add the 4-item trust bar to all 5 service pages (already exists on index.html):
`Averaged 5 Stars · $5M Insured · WSIB Compliant · Est. 2022`

Do NOT reference a review count anywhere — only "Averaged 5 Stars."

### Truck photo
- Pull truck photo from R2 CDN
- Add to homepage "Why Choose Us" section alongside reliability copy
- Add to each service page sidebar as a small credibility visual

### New selling points — communication + reliability
Add to the Why Choose Us section on index.html and each service page sidebar:
- "We respond same-day and keep you updated at every step"
- "We don't leave until the job is done right — guaranteed"

These are currently implied but never stated explicitly on the site.

### Social media links
Add Facebook and Instagram icons to the footer on every client-facing page:
- Facebook: `https://www.facebook.com/corexteriorslondon/`
- Instagram: `https://www.instagram.com/coreexteriors`

### Founded year
Change "Est. 2023" → "Est. 2022" in trust bar, footer copyright, and schema.

### AggregateRating in schema (index.html)
Update `reviewCount` from 25 to 30. Add HTML comment: `<!-- UPDATE reviewCount manually when new reviews come in -->`.

---

## Section 3 — Service Page Upgrade

Applies to all 5 service pages:
- `deck-restoration-london-ontario.html`
- `gutter-cleaning-london-ontario.html`
- `hardscape-optimization-london-ontario.html`
- `siding-cleaning-london-ontario.html`
- `window-cleaning-london-ontario.html`

### Hero photo
Replace SVG placeholder with a real before/after or action photo from R2 CDN.  
R2 base URL: `https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/`

| Service Page | Hero Image (webp + jpg fallback) |
|---|---|
| Gutter | `gutter-after.webp` / `gutter-after.jpg` |
| Deck | `deck-after.webp` / `deck-after.jpg` |
| Siding | `siding-masonville-after.webp` / `siding-masonville-after.jpg` |
| Hardscape | `hardscape/CSVS8207-HDR-scaled.webp` / `hardscape/CSVS8207-HDR-scaled.jpg` |
| Window | `sidewalk-byron-after.webp` / `sidewalk-byron-after.jpg` (best available exterior clean photo) |

### Truck photo
URL: `https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/fleet-trucks.jpg`  
Add to homepage Why Choose Us section and each service page sidebar.

### Sticky mobile CTA bar
Add the same sticky Call/Quote bar used on index.html and commercial.html to all 5 service pages and contact.html. Two buttons:
- "Call Now" → `tel:519-712-1431`
- "Get a Free Quote" → `contact.html`

### CTA buttons
Replace all `index.html#contact` links with `contact.html`. Two CTAs per page:
- Primary button: "Get a Free Quote" → `contact.html`
- Secondary: "Call 519-712-1431" → `tel:519-712-1431`

### Related blog posts
Add a "Related Reading" block at the bottom of each service page linking to 1–2 relevant blog posts:

| Service Page | Related Posts |
|---|---|
| Gutter cleaning | "How Often Should You Clean Your Gutters" + "Clogged Gutters & Water Damage" |
| Deck restoration | "5 Signs Your Deck Needs Restoration This Spring" |
| Siding cleaning | "Soft Wash vs Pressure Wash" |
| Hardscape | "Deck Building, Interlock & Outdoor Kitchens in London Ontario" |
| Window cleaning | "Spring Exterior Maintenance Checklist" |

### Sidebar trust signals
Each service page sidebar gets:
- "Averaged 5 Stars" badge
- Truck photo (small)
- Two new credibility lines (communication + reliability)
- "Get a Free Quote" → `contact.html`
- "Call 519-712-1431" → `tel:519-712-1431`

---

## Section 4 — SEO Fixes

### Title tags — shorten to under 60 characters

| File | New Title |
|------|-----------|
| `winter-services.html` | Snow Removal & Winter Services \| London, ON |
| `blog.html` | Exterior Maintenance Tips \| Core Exteriors |
| `deck-restoration-london-ontario.html` | Deck Restoration & Staining \| London, ON |
| `gutter-cleaning-london-ontario.html` | Gutter Cleaning London, Ontario \| Core Exteriors |
| `hardscape-optimization-london-ontario.html` | Hardscape & Patio Leveling \| London, ON |
| `siding-cleaning-london-ontario.html` | Siding Cleaning & House Washing \| London, ON |
| `blog/clogged-gutters-leakage-water-damage.html` | Clogged Gutters & Water Damage \| Core Exteriors |
| `blog/fall-leaf-spring-cleanup-london-ontario.html` | Fall & Spring Exterior Cleanup \| London, ON |
| `blog/deck-interlock-outdoor-kitchen-london-ontario.html` | Deck, Interlock & Outdoor Kitchens \| London, ON |

### index.html meta description
**Current:** ~270 character keyword dump  
**New:** "Core Exteriors delivers deck restoration, pressure washing, gutter cleaning, and more across London, Ontario. Averaged 5 stars. Free estimates." (155 chars)

### Schema additions

| Page | Schema to Add |
|------|--------------|
| `contact.html` | `LocalBusiness` + `ContactPage` |
| `commercial.html` | `LocalBusiness` |
| `blog.html` | `Blog` + `ItemList` |
| All 5 service pages | Full `Service` with `BreadcrumbList` + `FAQPage` |

### Canonical fixes
- All 5 service pages: remove `.html` from canonical URLs
- `privacy-policy.html`: change canonical to `https://corexteriors.ca/privacy-policy`

---

## Files Affected

**Bug fixes:** 9 blog posts, 5 service pages, contact.html, commercial.html, privacy-policy.html  
**Credibility:** index.html, commercial.html, 5 service pages, all footers  
**Service pages:** 5 service pages (hero, sidebar, CTA, related posts, sticky CTA)  
**SEO:** index.html, blog.html, winter-services.html, 5 service pages, 3 blog posts, contact.html, commercial.html  

**Total files touched:** ~25

---

## Section 5 — Google Analytics

Add the GA4 tag to every client-facing page `<head>` (before closing `</head>`):

```html
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-E2LSN9ENFB"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-E2LSN9ENFB');
</script>
```

**Pages to add it to:**
index.html, blog.html, contact.html, commercial.html, gallery.html, winter-services.html, privacy-policy.html, terms-of-service.html, deck-restoration-london-ontario.html, gutter-cleaning-london-ontario.html, hardscape-optimization-london-ontario.html, siding-cleaning-london-ontario.html, window-cleaning-london-ontario.html, and all 13 blog posts under `blog/`.

**Excludes:** sales.html, admin.html, admin-dashboard.html, admin-login.html, labour.html, outreach-finder.html

---

## What This Does NOT Change
- Page structure or visual design language
- Homepage hero or form
- Blog post content
- commercial.html layout
- Internal sales/admin/labour tools
