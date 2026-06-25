# Core Exteriors — UX, SEO & Credibility Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs, add Google Analytics, improve SEO across 25 pages, and upgrade service pages with real photos, credibility signals, and smoother CTAs.

**Architecture:** Static HTML site on Vercel. No build step. All changes are direct edits to `.html` files and `styles.css`. Batch operations use bash/sed. Verify each task with grep before committing.

**Tech Stack:** Static HTML/CSS, Vercel (cleanUrls: true), Cloudflare R2 CDN for images, JSON-LD schema, Google Analytics 4 (G-E2LSN9ENFB)

**R2 Base URL:** `https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/`  
**Repo dir:** `C:\Users\Mirkomil\Documents\Corexteriors-1\` (use `/c/Users/Mirkomil/Documents/Corexteriors-1/` in bash)

---

## Phase 1 — Bug Fixes

---

### Task 1: Fix broken blog post logo and favicon URLs

All 9 blog posts have `../https://` prepended to R2 CDN URLs — the logo, favicon, and og:image fail to load on every blog post.

**Files:**
- Modify: `blog/signs-deck-needs-restoration-spring.html`
- Modify: `blog/gutter-cleaning-frequency-london-ontario.html`
- Modify: `blog/soft-wash-vs-pressure-wash.html`
- Modify: `blog/wsib-compliant-contractors-ontario.html`
- Modify: `blog/spring-exterior-maintenance-checklist-london-ontario.html`
- Modify: `blog/how-we-price-below-franchise-competitors.html`
- Modify: `blog/exterior-cleaning-dorchester-ontario.html`
- Modify: `blog/gutter-cleaning-strathroy-ontario.html`
- Modify: `blog/pressure-washing-st-thomas-ontario.html`
- Modify: `blog/clogged-gutters-leakage-water-damage.html`
- Modify: `blog/commercial-exterior-maintenance-southern-ontario.html`
- Modify: `blog/deck-interlock-outdoor-kitchen-london-ontario.html`
- Modify: `blog/exterior-cleaning-dorchester-ontario.html`
- Modify: `blog/fall-leaf-spring-cleanup-london-ontario.html`

- [ ] **Step 1: Verify the broken pattern exists**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -rn "\.\./https://" blog/*.html | head -5
```
Expected: several matches with `../https://pub-0c3a...`

- [ ] **Step 2: Strip the `../` prefix from all blog posts**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
sed -i 's|\.\./https://|https://|g' blog/*.html
```

- [ ] **Step 3: Verify fix**

```bash
grep -rn "\.\./https://" blog/*.html
```
Expected: no output (zero matches)

- [ ] **Step 4: Verify logos now have correct URL**

```bash
grep -n "logo-letterform\|logo-letter\|logo-mark" blog/gutter-cleaning-frequency-london-ontario.html | head -3
```
Expected: URLs starting with `https://pub-0c3a...` not `../https://`

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
git add blog/*.html
git commit -m "fix: restore broken logo/favicon URLs in all blog posts (strip ../https:// prefix)"
```

---

### Task 2: Fix service page CTAs pointing to dead anchor

All 5 service pages and their footers link CTAs to `index.html#contact` — an anchor that no longer exists. Should point to `contact.html`.

**Files:**
- Modify: `deck-restoration-london-ontario.html`
- Modify: `gutter-cleaning-london-ontario.html`
- Modify: `hardscape-optimization-london-ontario.html`
- Modify: `siding-cleaning-london-ontario.html`
- Modify: `window-cleaning-london-ontario.html`

- [ ] **Step 1: Verify the broken links exist**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -rn "index\.html#contact" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
```
Expected: multiple matches across all 5 files

- [ ] **Step 2: Replace all occurrences**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
sed -i 's|index\.html#contact|contact.html|g' \
  deck-restoration-london-ontario.html \
  gutter-cleaning-london-ontario.html \
  hardscape-optimization-london-ontario.html \
  siding-cleaning-london-ontario.html \
  window-cleaning-london-ontario.html
```

- [ ] **Step 3: Verify no dead links remain**

```bash
grep -rn "index\.html#contact" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
```
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
git commit -m "fix: replace dead index.html#contact links with contact.html on all service pages"
```

---

### Task 3: Fix canonical URLs on service pages and privacy policy

`cleanUrls: true` in vercel.json means `.html` files are served without extension. Canonicals must match the live URL.

**Files:**
- Modify: `deck-restoration-london-ontario.html`
- Modify: `gutter-cleaning-london-ontario.html`
- Modify: `hardscape-optimization-london-ontario.html`
- Modify: `siding-cleaning-london-ontario.html`
- Modify: `window-cleaning-london-ontario.html`
- Modify: `privacy-policy.html`

- [ ] **Step 1: Check current canonical values**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -n "canonical" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html privacy-policy.html
```

- [ ] **Step 2: Strip .html from service page canonicals**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
sed -i 's|corexteriors\.ca/deck-restoration-london-ontario\.html|corexteriors.ca/deck-restoration-london-ontario|g' deck-restoration-london-ontario.html
sed -i 's|corexteriors\.ca/gutter-cleaning-london-ontario\.html|corexteriors.ca/gutter-cleaning-london-ontario|g' gutter-cleaning-london-ontario.html
sed -i 's|corexteriors\.ca/hardscape-optimization-london-ontario\.html|corexteriors.ca/hardscape-optimization-london-ontario|g' hardscape-optimization-london-ontario.html
sed -i 's|corexteriors\.ca/siding-cleaning-london-ontario\.html|corexteriors.ca/siding-cleaning-london-ontario|g' siding-cleaning-london-ontario.html
sed -i 's|corexteriors\.ca/window-cleaning-london-ontario\.html|corexteriors.ca/window-cleaning-london-ontario|g' window-cleaning-london-ontario.html
sed -i 's|corexteriors\.ca/privacy-policy\.html|corexteriors.ca/privacy-policy|g' privacy-policy.html
```

- [ ] **Step 3: Verify**

```bash
grep -n "canonical" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html privacy-policy.html
```
Expected: all canonicals end without `.html`

- [ ] **Step 4: Commit**

```bash
git add deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html privacy-policy.html
git commit -m "fix: remove .html from service page and privacy-policy canonical URLs"
```

---

### Task 4: Fix commercial.html — email, insurance table, founded year

**Files:**
- Modify: `commercial.html`

- [ ] **Step 1: Check what needs fixing**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -n "gmail\|10,000,000\|Est\. 202" commercial.html
```

- [ ] **Step 2: Fix email**

```bash
sed -i 's|corexteriors@gmail\.com|corexteriors@gmail.com|g' commercial.html
```
(This is a no-op if already correct — run the next check to confirm)

- [ ] **Step 3: Fix insurance table ($10,000,000 → $5,000,000)**

```bash
sed -i 's|\$10,000,000|\$5,000,000|g' commercial.html
```

- [ ] **Step 4: Fix Est. 2023 → Est. 2022 on commercial.html**

```bash
sed -i 's|Est\. 2023|Est. 2022|g' commercial.html
sed -i 's|Founded 2022|Est. 2022|g' commercial.html
```

- [ ] **Step 5: Verify**

```bash
grep -n "gmail\|000,000\|Est\. 20\|Founded" commercial.html
```
Expected: `corexteriors@gmail.com`, `$5,000,000`, `Est. 2022` only

- [ ] **Step 6: Commit**

```bash
git add commercial.html
git commit -m "fix: standardize commercial.html email, insurance amount, and founded year"
```

---

### Task 5: Fix founded year and email site-wide

**Files:**
- Modify: `index.html`
- Modify: `contact.html`
- Modify: `blog.html`
- Modify: `gallery.html`
- Modify: `winter-services.html`
- Modify: `terms-of-service.html`
- Modify: all 5 service pages
- Modify: all blog posts under `blog/`

- [ ] **Step 1: Find all Est. 2023 occurrences**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -rn "Est\. 2023\|2023-2026" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/"
```

- [ ] **Step 2: Replace Est. 2023 → Est. 2022 and fix copyright year**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
find . -name "*.html" \
  ! -path "./admin*" \
  ! -path "./sales.html" \
  ! -path "./labour.html" \
  ! -path "./outreach*" \
  ! -path "./images/*" \
  -exec sed -i 's|Est\. 2023|Est. 2022|g; s|2023-2026 Core Exteriors|2022-2026 Core Exteriors|g' {} \;
```

- [ ] **Step 3: Verify**

```bash
grep -rn "Est\. 2023\|2023-2026" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/"
```
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "fix: update founded year to Est. 2022 and copyright to 2022-2026 site-wide"
```

---

### Task 6: Standardize email to corexteriors@gmail.com site-wide

`info@corexteriors.com` appears on most pages but `corexteriors@gmail.com` is the real working inbox.

**Files:** All client-facing HTML files

- [ ] **Step 1: Find all info@corexteriors.com occurrences**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -rn "info@corexteriors\.com" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/"
```

- [ ] **Step 2: Replace site-wide**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
find . -name "*.html" \
  ! -path "./admin*" \
  ! -path "./sales.html" \
  ! -path "./labour.html" \
  ! -path "./outreach*" \
  ! -path "./images/*" \
  -exec sed -i 's|info@corexteriors\.com|corexteriors@gmail.com|g' {} \;
```

- [ ] **Step 3: Verify**

```bash
grep -rn "info@corexteriors\.com" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/"
```
Expected: no output

- [ ] **Step 4: Verify correct email is present**

```bash
grep -rn "corexteriors@gmail\.com" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/" | head -5
```
Expected: several matches

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "fix: standardize all display emails to corexteriors@gmail.com"
```

---

### Task 7: Add Winter Services to nav on contact.html and all blog posts

**Files:**
- Modify: `contact.html`
- Modify: all 13 files in `blog/`

- [ ] **Step 1: Check what the Winter Services nav item looks like on a working page**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -A1 -B1 "winter-services\|Winter Services" index.html | head -10
```

- [ ] **Step 2: Check what nav item is currently before/after the gap in contact.html**

```bash
grep -n "nav-link\|<li>" contact.html | head -20
```

- [ ] **Step 3: Add Winter Services link to contact.html nav**

Find the nav item for "Blog" and add Winter Services after it. In `contact.html`, find:
```html
<li><a href="blog.html" class="nav-link">Blog</a></li>
```
Replace with:
```html
<li><a href="blog.html" class="nav-link">Blog</a></li>
                    <li><a href="winter-services.html" class="nav-link">Winter Services</a></li>
```

Use the Edit tool for this targeted change.

- [ ] **Step 4: Add Winter Services to all blog post navs**

First confirm the pattern that's missing:
```bash
grep -L "winter-services" blog/*.html
```
Expected: all or most blog post files listed

Then add it after the Blog nav link in each blog post. The nav in blog posts links use `../` prefix. Find the Blog link pattern:
```bash
grep -n "blog\.html\|Blog" blog/gutter-cleaning-frequency-london-ontario.html | head -5
```

For each blog post, after `<a href="../blog.html" class="nav-link">Blog</a></li>` (or similar), add:
```html
<li><a href="../winter-services.html" class="nav-link">Winter Services</a></li>
```

Run for all blog posts:
```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
sed -i 's|<a href="\.\./blog\.html" class="nav-link">Blog</a></li>|<a href="../blog.html" class="nav-link">Blog</a></li>\n                    <li><a href="../winter-services.html" class="nav-link">Winter Services</a></li>|g' blog/*.html
```

- [ ] **Step 5: Verify**

```bash
grep -l "winter-services" blog/*.html | wc -l
```
Expected: 13 (all blog posts)

- [ ] **Step 6: Commit**

```bash
git add contact.html blog/*.html
git commit -m "fix: add Winter Services nav link to contact.html and all blog posts"
```

---

## Phase 2 — Google Analytics

---

### Task 8: Add GA4 tag to all client-facing pages

**Files:** index.html, blog.html, contact.html, commercial.html, gallery.html, winter-services.html, privacy-policy.html, terms-of-service.html, deck-restoration-london-ontario.html, gutter-cleaning-london-ontario.html, hardscape-optimization-london-ontario.html, siding-cleaning-london-ontario.html, window-cleaning-london-ontario.html, all 13 blog posts

- [ ] **Step 1: Verify GA tag is not already present**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -rn "G-E2LSN9ENFB\|gtag" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/"
```
Expected: no output

- [ ] **Step 2: Add GA4 tag to all client-facing pages**

The tag goes right after the opening `<head>` tag. Use sed to insert after `<head>`:

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1

GA_TAG='    <!-- Google tag (gtag.js) -->\n    <script async src="https://www.googletagmanager.com/gtag/js?id=G-E2LSN9ENFB"><\/script>\n    <script>\n      window.dataLayer = window.dataLayer || [];\n      function gtag(){dataLayer.push(arguments);}\n      gtag('\''js'\'', new Date());\n      gtag('\''config'\'', '\''G-E2LSN9ENFB'\'');\n    <\/script>'

TARGET_FILES=(
  index.html blog.html contact.html commercial.html gallery.html
  winter-services.html privacy-policy.html terms-of-service.html
  deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html
  hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html
  window-cleaning-london-ontario.html
)

for f in "${TARGET_FILES[@]}"; do
  sed -i "s|<head>|<head>\n${GA_TAG}|" "$f"
done

for f in blog/*.html; do
  sed -i "s|<head>|<head>\n${GA_TAG}|" "$f"
done
```

- [ ] **Step 3: Verify tag is present on key pages**

```bash
grep -l "G-E2LSN9ENFB" *.html blog/*.html | grep -v "admin\|sales\|labour\|outreach" | wc -l
```
Expected: ~26 files

```bash
grep -n "G-E2LSN9ENFB" index.html
```
Expected: line in `<head>` with gtag script

- [ ] **Step 4: Commit**

```bash
git add index.html blog.html contact.html commercial.html gallery.html winter-services.html privacy-policy.html terms-of-service.html deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html blog/*.html
git commit -m "feat: add Google Analytics GA4 (G-E2LSN9ENFB) to all client-facing pages"
```

---

## Phase 3 — SEO

---

### Task 9: Fix over-length title tags

9 title tags exceed 60 characters and get truncated by Google.

**Files:** blog.html, winter-services.html, deck-restoration-london-ontario.html, gutter-cleaning-london-ontario.html, hardscape-optimization-london-ontario.html, siding-cleaning-london-ontario.html, blog/clogged-gutters-leakage-water-damage.html, blog/fall-leaf-spring-cleanup-london-ontario.html, blog/deck-interlock-outdoor-kitchen-london-ontario.html

- [ ] **Step 1: Verify current titles**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -n "<title>" blog.html winter-services.html deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html blog/clogged-gutters-leakage-water-damage.html blog/fall-leaf-spring-cleanup-london-ontario.html blog/deck-interlock-outdoor-kitchen-london-ontario.html
```

- [ ] **Step 2: Update each title tag**

In `blog.html`:
```bash
sed -i 's|<title>Blog — Exterior Maintenance Tips | Core Exteriors | London, Ontario</title>|<title>Exterior Maintenance Tips | Core Exteriors</title>|g' blog.html
```

In `winter-services.html`:
```bash
sed -i 's|<title>Snow Removal, Fall Cleanup and Winter Services in London Ontario | Core Exteriors</title>|<title>Snow Removal \&amp; Winter Services | London, ON</title>|g' winter-services.html
```

In `deck-restoration-london-ontario.html`:
```bash
sed -i 's|<title>Deck Restoration \&amp; Staining Services | London, Ontario | Core Exteriors</title>|<title>Deck Restoration \&amp; Staining | London, ON</title>|g' deck-restoration-london-ontario.html
```

In `gutter-cleaning-london-ontario.html`:
```bash
sed -i 's|<title>Gutter Cleaning \&amp; Eavestrough Cleaning | London, Ontario | Core Exteriors</title>|<title>Gutter Cleaning London, Ontario | Core Exteriors</title>|g' gutter-cleaning-london-ontario.html
```

In `hardscape-optimization-london-ontario.html`:
```bash
sed -i 's|<title>Hardscape Optimization \&amp; Patio Leveling | London, Ontario | Core Exteriors</title>|<title>Hardscape \&amp; Patio Leveling | London, ON</title>|g' hardscape-optimization-london-ontario.html
```

In `siding-cleaning-london-ontario.html`:
```bash
sed -i 's|<title>Siding Cleaning \&amp; House Washing | London, Ontario | Core Exteriors</title>|<title>Siding Cleaning \&amp; House Washing | London, ON</title>|g' siding-cleaning-london-ontario.html
```

In `blog/clogged-gutters-leakage-water-damage.html`:
```bash
sed -i 's|<title>Clogged Gutters and Water Leakage: The Real Damage to Your Home | Core Exteriors</title>|<title>Clogged Gutters \&amp; Water Damage | Core Exteriors</title>|g' blog/clogged-gutters-leakage-water-damage.html
```

In `blog/fall-leaf-spring-cleanup-london-ontario.html`:
```bash
sed -i 's|<title>Fall Leaf Cleanup and Spring Exterior Cleanup in London Ontario | Core Exteriors</title>|<title>Fall \&amp; Spring Exterior Cleanup | London, ON</title>|g' blog/fall-leaf-spring-cleanup-london-ontario.html
```

In `blog/deck-interlock-outdoor-kitchen-london-ontario.html`:
```bash
sed -i 's|<title>Deck Building, Interlock, and Outdoor Kitchens in London Ontario | Core Exteriors</title>|<title>Deck, Interlock \&amp; Outdoor Kitchens | London, ON</title>|g' blog/deck-interlock-outdoor-kitchen-london-ontario.html
```

> **Note:** The `|` delimiter in sed avoids issues with `/` in paths. If any sed command produces no change, open the file, copy the exact title text, and use Edit tool instead.

- [ ] **Step 3: Verify all titles updated**

```bash
grep -n "<title>" blog.html winter-services.html deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html blog/clogged-gutters-leakage-water-damage.html blog/fall-leaf-spring-cleanup-london-ontario.html blog/deck-interlock-outdoor-kitchen-london-ontario.html
```
Each should be under 60 characters.

- [ ] **Step 4: Commit**

```bash
git add blog.html winter-services.html deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html blog/clogged-gutters-leakage-water-damage.html blog/fall-leaf-spring-cleanup-london-ontario.html blog/deck-interlock-outdoor-kitchen-london-ontario.html
git commit -m "seo: shorten 9 over-length title tags to under 60 characters"
```

---

### Task 10: Rewrite index.html meta description and fix AggregateRating

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Check current meta description**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -n 'name="description"' index.html
```

- [ ] **Step 2: Replace meta description**

Use Edit tool. Find:
```html
    <meta name="description" content="Core Exteriors provides deck building, fence installation, interlock, hardscaping, pressure washing, window cleaning, gutter cleaning, exterior painting, roof cleaning, lawn care and snow removal in London, Ontario. Free estimates. Fully insured and WSIB compliant.">
```
Replace with:
```html
    <meta name="description" content="Core Exteriors delivers deck restoration, pressure washing, gutter cleaning, and more across London, Ontario. Averaged 5 stars. Free estimates.">
```

- [ ] **Step 3: Fix AggregateRating reviewCount**

```bash
grep -n "reviewCount\|ratingValue" index.html
```

Use Edit tool. Change `"reviewCount": "25"` to `"reviewCount": "30"` and add a comment above the aggregateRating block:
```html
<!-- UPDATE reviewCount manually when new Google reviews come in -->
```

- [ ] **Step 4: Verify**

```bash
grep -n 'name="description"\|reviewCount' index.html
```
Expected: short description under 160 chars, reviewCount = 30

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "seo: rewrite index.html meta description and update review count to 30"
```

---

### Task 11: Add LocalBusiness + ContactPage schema to contact.html

**Files:**
- Modify: `contact.html`

- [ ] **Step 1: Verify no schema currently exists**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -n "application/ld+json" contact.html
```
Expected: no output

- [ ] **Step 2: Add schema before closing `</head>`**

Use Edit tool. Find `</head>` in `contact.html` and insert before it:

```html
    <!-- Schema: LocalBusiness + ContactPage -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "LocalBusiness",
          "name": "Core Exteriors",
          "url": "https://corexteriors.ca",
          "telephone": "+15197121431",
          "email": "corexteriors@gmail.com",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "203 Cambridge St",
            "addressLocality": "London",
            "addressRegion": "ON",
            "postalCode": "N6H 1N6",
            "addressCountry": "CA"
          },
          "areaServed": ["London", "St. Thomas", "Strathroy", "Dorchester"],
          "openingHours": ["Mo-Sa 08:00-18:00"]
        },
        {
          "@type": "ContactPage",
          "name": "Contact Core Exteriors",
          "url": "https://corexteriors.ca/contact",
          "description": "Get a free exterior maintenance quote from Core Exteriors. Serving London, St. Thomas, Strathroy, and Dorchester, Ontario."
        }
      ]
    }
    </script>
```

- [ ] **Step 3: Verify**

```bash
grep -n "application/ld+json" contact.html
```
Expected: one match

- [ ] **Step 4: Commit**

```bash
git add contact.html
git commit -m "seo: add LocalBusiness and ContactPage schema to contact.html"
```

---

### Task 12: Add LocalBusiness schema to commercial.html

**Files:**
- Modify: `commercial.html`

- [ ] **Step 1: Verify no schema currently exists**

```bash
grep -n "application/ld+json" commercial.html
```
Expected: no output

- [ ] **Step 2: Add schema before closing `</head>`**

Use Edit tool. Find `</head>` in `commercial.html` and insert before it:

```html
    <!-- Schema: LocalBusiness (Commercial) -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": "Core Exteriors",
      "url": "https://corexteriors.ca/commercial",
      "telephone": "+15197121431",
      "email": "corexteriors@gmail.com",
      "description": "Full-service commercial exterior maintenance for property managers across Southern Ontario. $5M insured, WSIB compliant, Working at Heights certified.",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "203 Cambridge St",
        "addressLocality": "London",
        "addressRegion": "ON",
        "postalCode": "N6H 1N6",
        "addressCountry": "CA"
      },
      "areaServed": ["London", "St. Thomas", "Strathroy", "Dorchester", "Hamilton", "Sarnia", "Niagara Falls"]
    }
    </script>
```

- [ ] **Step 3: Verify**

```bash
grep -n "application/ld+json" commercial.html
```

- [ ] **Step 4: Commit**

```bash
git add commercial.html
git commit -m "seo: add LocalBusiness schema to commercial.html"
```

---

### Task 13: Add Blog + ItemList schema to blog.html

**Files:**
- Modify: `blog.html`

- [ ] **Step 1: Check blog post URLs used in cards**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
grep -n 'href.*blog/' blog.html | head -15
```

- [ ] **Step 2: Add schema before `</head>`**

Use Edit tool. Find `</head>` in `blog.html` and insert before it:

```html
    <!-- Schema: Blog + ItemList -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Blog",
      "name": "Core Exteriors Blog",
      "url": "https://corexteriors.ca/blog",
      "description": "Practical exterior maintenance tips from London, Ontario's trusted pros.",
      "publisher": {
        "@type": "Organization",
        "name": "Core Exteriors",
        "url": "https://corexteriors.ca",
        "logo": {
          "@type": "ImageObject",
          "url": "https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/logo-mark.png"
        }
      },
      "mainEntity": {
        "@type": "ItemList",
        "itemListElement": [
          {"@type": "ListItem", "position": 1, "url": "https://corexteriors.ca/blog/signs-deck-needs-restoration-spring"},
          {"@type": "ListItem", "position": 2, "url": "https://corexteriors.ca/blog/gutter-cleaning-frequency-london-ontario"},
          {"@type": "ListItem", "position": 3, "url": "https://corexteriors.ca/blog/soft-wash-vs-pressure-wash"},
          {"@type": "ListItem", "position": 4, "url": "https://corexteriors.ca/blog/wsib-compliant-contractors-ontario"},
          {"@type": "ListItem", "position": 5, "url": "https://corexteriors.ca/blog/spring-exterior-maintenance-checklist-london-ontario"},
          {"@type": "ListItem", "position": 6, "url": "https://corexteriors.ca/blog/how-we-price-below-franchise-competitors"},
          {"@type": "ListItem", "position": 7, "url": "https://corexteriors.ca/blog/exterior-cleaning-dorchester-ontario"},
          {"@type": "ListItem", "position": 8, "url": "https://corexteriors.ca/blog/gutter-cleaning-strathroy-ontario"},
          {"@type": "ListItem", "position": 9, "url": "https://corexteriors.ca/blog/pressure-washing-st-thomas-ontario"},
          {"@type": "ListItem", "position": 10, "url": "https://corexteriors.ca/blog/clogged-gutters-leakage-water-damage"},
          {"@type": "ListItem", "position": 11, "url": "https://corexteriors.ca/blog/fall-leaf-spring-cleanup-london-ontario"},
          {"@type": "ListItem", "position": 12, "url": "https://corexteriors.ca/blog/commercial-exterior-maintenance-southern-ontario"},
          {"@type": "ListItem", "position": 13, "url": "https://corexteriors.ca/blog/deck-interlock-outdoor-kitchen-london-ontario"}
        ]
      }
    }
    </script>
```

- [ ] **Step 3: Verify**

```bash
grep -n "application/ld+json" blog.html
```

- [ ] **Step 4: Commit**

```bash
git add blog.html
git commit -m "seo: add Blog and ItemList schema to blog.html"
```

---

### Task 14: Upgrade schema on all 5 service pages

Each service page gets a full `Service` schema with `BreadcrumbList` and `FAQPage`.

**Files:**
- Modify: `gutter-cleaning-london-ontario.html`
- Modify: `deck-restoration-london-ontario.html`
- Modify: `siding-cleaning-london-ontario.html`
- Modify: `hardscape-optimization-london-ontario.html`
- Modify: `window-cleaning-london-ontario.html`

- [ ] **Step 1: Check existing schema on gutter page**

```bash
grep -n "application/ld+json" gutter-cleaning-london-ontario.html
```

- [ ] **Step 2: Replace schema in `gutter-cleaning-london-ontario.html`**

Use Edit tool. Find the existing `<script type="application/ld+json">` block and replace it entirely with:

```html
    <!-- Schema: Service + BreadcrumbList + FAQPage -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Service",
          "name": "Gutter Cleaning London Ontario",
          "url": "https://corexteriors.ca/gutter-cleaning-london-ontario",
          "description": "Professional gutter cleaning and eavestrough cleaning in London, Ontario. Debris removal, downspout flushing, and flow testing. Starting at $99.",
          "provider": {
            "@type": "LocalBusiness",
            "name": "Core Exteriors",
            "telephone": "+15197121431",
            "url": "https://corexteriors.ca"
          },
          "areaServed": ["London", "St. Thomas", "Strathroy", "Dorchester"],
          "offers": {
            "@type": "Offer",
            "priceCurrency": "CAD",
            "price": "99",
            "priceSpecification": {"@type": "PriceSpecification", "minPrice": "99", "priceCurrency": "CAD"}
          }
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://corexteriors.ca"},
            {"@type": "ListItem", "position": 2, "name": "Services", "item": "https://corexteriors.ca/#services"},
            {"@type": "ListItem", "position": 3, "name": "Gutter Cleaning", "item": "https://corexteriors.ca/gutter-cleaning-london-ontario"}
          ]
        },
        {
          "@type": "FAQPage",
          "mainEntity": [
            {
              "@type": "Question",
              "name": "How often should I clean my gutters in London, Ontario?",
              "acceptedAnswer": {"@type": "Answer", "text": "We recommend cleaning your gutters twice a year — once in spring and once in fall after leaves have dropped. London's wet climate makes regular cleaning essential to prevent water damage."}
            },
            {
              "@type": "Question",
              "name": "How much does gutter cleaning cost?",
              "acceptedAnswer": {"@type": "Answer", "text": "Gutter cleaning starts at $99 for most London-area homes. Final price depends on home size, number of storeys, and gutter length."}
            },
            {
              "@type": "Question",
              "name": "Are you insured for gutter cleaning?",
              "acceptedAnswer": {"@type": "Answer", "text": "Yes. Core Exteriors carries $5M general liability insurance and is fully WSIB compliant. We provide documentation on request before arriving at your property."}
            },
            {
              "@type": "Question",
              "name": "What areas do you serve for gutter cleaning?",
              "acceptedAnswer": {"@type": "Answer", "text": "We serve London, St. Thomas, Strathroy, and Dorchester, Ontario."}
            }
          ]
        }
      ]
    }
    </script>
```

- [ ] **Step 3: Add schema to `deck-restoration-london-ontario.html`**

Replace existing schema block with:

```html
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Service",
          "name": "Deck Restoration London Ontario",
          "url": "https://corexteriors.ca/deck-restoration-london-ontario",
          "description": "Professional deck restoration, power washing, sanding, staining and sealing in London, Ontario. Free estimates.",
          "provider": {
            "@type": "LocalBusiness",
            "name": "Core Exteriors",
            "telephone": "+15197121431",
            "url": "https://corexteriors.ca"
          },
          "areaServed": ["London", "St. Thomas", "Strathroy", "Dorchester"],
          "offers": {
            "@type": "Offer",
            "priceCurrency": "CAD",
            "priceSpecification": {"@type": "PriceSpecification", "minPrice": "1000", "maxPrice": "6000", "priceCurrency": "CAD"}
          }
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://corexteriors.ca"},
            {"@type": "ListItem", "position": 2, "name": "Services", "item": "https://corexteriors.ca/#services"},
            {"@type": "ListItem", "position": 3, "name": "Deck Restoration", "item": "https://corexteriors.ca/deck-restoration-london-ontario"}
          ]
        },
        {
          "@type": "FAQPage",
          "mainEntity": [
            {
              "@type": "Question",
              "name": "How much does deck restoration cost in London, Ontario?",
              "acceptedAnswer": {"@type": "Answer", "text": "Deck restoration typically costs between $1,000 and $6,000 depending on deck size, condition, and the scope of work (washing, sanding, staining, sealing)."}
            },
            {
              "@type": "Question",
              "name": "How long does deck restoration take?",
              "acceptedAnswer": {"@type": "Answer", "text": "Most residential decks are completed in 1–2 days. Larger or more damaged decks may take longer depending on drying time between coats."}
            },
            {
              "@type": "Question",
              "name": "How often should I restore my deck?",
              "acceptedAnswer": {"@type": "Answer", "text": "We recommend restoring and re-staining your deck every 2–3 years to prevent weathering, cracking, and mould buildup, especially in London's wet climate."}
            },
            {
              "@type": "Question",
              "name": "Do you guarantee your deck restoration work?",
              "acceptedAnswer": {"@type": "Answer", "text": "Yes. We do not leave the site until you are 100% satisfied. Our job-complete guarantee means we redo any unsatisfactory work at no additional cost."}
            }
          ]
        }
      ]
    }
    </script>
```

- [ ] **Step 4: Add schema to `siding-cleaning-london-ontario.html`**

```html
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Service",
          "name": "Siding Cleaning London Ontario",
          "url": "https://corexteriors.ca/siding-cleaning-london-ontario",
          "description": "Professional siding cleaning and house washing in London, Ontario. Soft wash removes mold, mildew and algae safely from vinyl, wood, and brick siding.",
          "provider": {
            "@type": "LocalBusiness",
            "name": "Core Exteriors",
            "telephone": "+15197121431",
            "url": "https://corexteriors.ca"
          },
          "areaServed": ["London", "St. Thomas", "Strathroy", "Dorchester"]
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://corexteriors.ca"},
            {"@type": "ListItem", "position": 2, "name": "Services", "item": "https://corexteriors.ca/#services"},
            {"@type": "ListItem", "position": 3, "name": "Siding Cleaning", "item": "https://corexteriors.ca/siding-cleaning-london-ontario"}
          ]
        },
        {
          "@type": "FAQPage",
          "mainEntity": [
            {
              "@type": "Question",
              "name": "Do you use soft wash or pressure washing for siding?",
              "acceptedAnswer": {"@type": "Answer", "text": "We use soft wash for vinyl, painted wood, and fiber cement siding — low pressure with a biodegradable cleaning solution. Soft wash is safer for siding and more effective at killing mold and algae at the root."}
            },
            {
              "@type": "Question",
              "name": "How often should siding be cleaned?",
              "acceptedAnswer": {"@type": "Answer", "text": "We recommend cleaning your siding every 1–2 years. London's humid climate promotes mold and algae growth, especially on north-facing and shaded surfaces."}
            },
            {
              "@type": "Question",
              "name": "Do you clean all types of siding?",
              "acceptedAnswer": {"@type": "Answer", "text": "Yes. We clean vinyl, wood, brick, stucco, and fiber cement siding. We adjust pressure and cleaning method based on your siding material."}
            }
          ]
        }
      ]
    }
    </script>
```

- [ ] **Step 5: Add schema to `hardscape-optimization-london-ontario.html`**

```html
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Service",
          "name": "Hardscape Optimization London Ontario",
          "url": "https://corexteriors.ca/hardscape-optimization-london-ontario",
          "description": "Professional hardscape optimization in London, Ontario. Interlock re-leveling, polymeric sand, patio repair and driveway cleaning.",
          "provider": {
            "@type": "LocalBusiness",
            "name": "Core Exteriors",
            "telephone": "+15197121431",
            "url": "https://corexteriors.ca"
          },
          "areaServed": ["London", "St. Thomas", "Strathroy", "Dorchester"],
          "offers": {
            "@type": "Offer",
            "priceCurrency": "CAD",
            "priceSpecification": {"@type": "PriceSpecification", "minPrice": "1000", "maxPrice": "6000", "priceCurrency": "CAD"}
          }
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://corexteriors.ca"},
            {"@type": "ListItem", "position": 2, "name": "Services", "item": "https://corexteriors.ca/#services"},
            {"@type": "ListItem", "position": 3, "name": "Hardscape Optimization", "item": "https://corexteriors.ca/hardscape-optimization-london-ontario"}
          ]
        },
        {
          "@type": "FAQPage",
          "mainEntity": [
            {
              "@type": "Question",
              "name": "What is hardscape optimization?",
              "acceptedAnswer": {"@type": "Answer", "text": "Hardscape optimization involves re-leveling sunken or uneven interlock pavers, replacing polymeric sand, cleaning surfaces, and restoring patios and driveways to their original condition — without full replacement."}
            },
            {
              "@type": "Question",
              "name": "Can sunken interlock be fixed without replacing everything?",
              "acceptedAnswer": {"@type": "Answer", "text": "Yes. In most cases we can lift, re-level, and re-set sunken pavers without full replacement. This is significantly less expensive and achieves excellent results."}
            },
            {
              "@type": "Question",
              "name": "How much does hardscape work cost?",
              "acceptedAnswer": {"@type": "Answer", "text": "Hardscape projects typically range from $1,000 to $6,000 depending on the size of the area and scope of work. We provide free estimates after a site assessment."}
            }
          ]
        }
      ]
    }
    </script>
```

- [ ] **Step 6: Add schema to `window-cleaning-london-ontario.html`**

```html
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Service",
          "name": "Window Cleaning London Ontario",
          "url": "https://corexteriors.ca/window-cleaning-london-ontario",
          "description": "Professional window cleaning in London, Ontario. Interior and exterior window washing, screen cleaning, and track cleaning. Free estimates.",
          "provider": {
            "@type": "LocalBusiness",
            "name": "Core Exteriors",
            "telephone": "+15197121431",
            "url": "https://corexteriors.ca"
          },
          "areaServed": ["London", "St. Thomas", "Strathroy", "Dorchester"]
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://corexteriors.ca"},
            {"@type": "ListItem", "position": 2, "name": "Services", "item": "https://corexteriors.ca/#services"},
            {"@type": "ListItem", "position": 3, "name": "Window Cleaning", "item": "https://corexteriors.ca/window-cleaning-london-ontario"}
          ]
        },
        {
          "@type": "FAQPage",
          "mainEntity": [
            {
              "@type": "Question",
              "name": "Do you clean both interior and exterior windows?",
              "acceptedAnswer": {"@type": "Answer", "text": "Yes. We clean both interior and exterior windows, including screens and tracks. We can do exterior-only if preferred."}
            },
            {
              "@type": "Question",
              "name": "How often should windows be professionally cleaned?",
              "acceptedAnswer": {"@type": "Answer", "text": "We recommend professional window cleaning 2–4 times per year. Spring and fall cleanings are most popular in London, Ontario."}
            },
            {
              "@type": "Question",
              "name": "Do you clean hard-to-reach windows?",
              "acceptedAnswer": {"@type": "Answer", "text": "Yes. We have equipment and techniques for all heights including second-storey and above. Safety is our top priority on every job."}
            }
          ]
        }
      ]
    }
    </script>
```

- [ ] **Step 7: Verify all 5 service pages have schema**

```bash
grep -l "application/ld+json" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html | wc -l
```
Expected: 5

- [ ] **Step 8: Commit**

```bash
git add deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
git commit -m "seo: upgrade schema on all 5 service pages (Service + BreadcrumbList + FAQPage)"
```

---

## Phase 4 — Credibility & UX

---

### Task 15: Add social media links to footer on all client-facing pages

Social links go in the `footer-brand` div, below the tagline.

**Files:** index.html, blog.html, contact.html, commercial.html, gallery.html, winter-services.html, privacy-policy.html, terms-of-service.html, all 5 service pages, all 13 blog posts

- [ ] **Step 1: Add CSS for social links to styles.css**

Open `styles.css` and add at the end:

```css
/* Footer social links */
.footer-social {
    display: flex;
    gap: 12px;
    margin-top: 12px;
}
.footer-social a {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: rgba(255,255,255,0.1);
    border-radius: 50%;
    color: #fff;
    text-decoration: none;
    transition: background 0.2s;
}
.footer-social a:hover {
    background: rgba(255,255,255,0.25);
}
.footer-social svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
}
```

- [ ] **Step 2: Define the social HTML block to insert**

The block to add after `<p class="footer-tagline">...</p>` in every footer:

```html
                    <div class="footer-social">
                        <a href="https://www.facebook.com/corexteriorslondon/" target="_blank" rel="noopener" aria-label="Core Exteriors on Facebook">
                            <svg viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                        </a>
                        <a href="https://www.instagram.com/coreexteriors" target="_blank" rel="noopener" aria-label="Core Exteriors on Instagram">
                            <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                        </a>
                    </div>
```

- [ ] **Step 3: Add to index.html footer**

Use Edit tool. In `index.html`, find:
```html
                    <p class="footer-tagline">Premium Exterior Maintenance.<br>London's Trusted Exterior Pros.</p>
                </div>
```
Replace with:
```html
                    <p class="footer-tagline">Premium Exterior Maintenance.<br>London's Trusted Exterior Pros.</p>
                    <div class="footer-social">
                        <a href="https://www.facebook.com/corexteriorslondon/" target="_blank" rel="noopener" aria-label="Core Exteriors on Facebook">
                            <svg viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                        </a>
                        <a href="https://www.instagram.com/coreexteriors" target="_blank" rel="noopener" aria-label="Core Exteriors on Instagram">
                            <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                        </a>
                    </div>
                </div>
```

- [ ] **Step 4: Repeat for all other pages**

Repeat Step 3 for each remaining client-facing page. The `footer-tagline` paragraph text may differ slightly per page but the insertion point is always after `</p>` closing the tagline and before `</div>` closing `footer-brand`.

Pages: blog.html, contact.html, commercial.html, gallery.html, winter-services.html, privacy-policy.html, terms-of-service.html, all 5 service pages, all 13 blog posts.

> **Note:** Some pages (service pages, blog posts) use a simplified footer. Look for the footer tagline paragraph and insert the social block after it. If a page has no tagline, add the social block as the last child of the first `<div>` inside `<footer>`.

- [ ] **Step 5: Verify**

```bash
grep -l "footer-social" *.html blog/*.html | grep -v "admin\|sales\|labour\|outreach" | wc -l
```
Expected: ~26 files

- [ ] **Step 6: Commit**

```bash
git add styles.css
git add index.html blog.html contact.html commercial.html gallery.html winter-services.html privacy-policy.html terms-of-service.html deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html blog/*.html
git commit -m "feat: add Facebook and Instagram links to footer on all client-facing pages"
```

---

### Task 16: Add credibility copy and truck photo to index.html Why Choose Us

Add a 4th advantage card for "Same-Day Communication" and insert the truck photo in the section.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Find the Why Choose Us section closing tag**

```bash
grep -n "advantage-card\|advantages-grid\|why-choose\|Job-Complete" index.html | tail -10
```

- [ ] **Step 2: Add 4th advantage card after the Job-Complete card**

Use Edit tool. Find the closing of the advantages grid (after the Job-Complete card's closing `</div>`):
```html
                </div>
            </div>
        </div>
    </section>

    <!-- Gallery Section -->
```

Insert the new card before the closing `</div></div></div>`:

```html
                <!-- Same-Day Communication -->
                <div class="advantage-card">
                    <div class="advantage-icon">
                        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M8 12 L56 12 L56 44 L36 44 L28 56 L28 44 L8 44 Z" />
                            <line x1="20" y1="24" x2="44" y2="24" stroke-width="2"/>
                            <line x1="20" y1="32" x2="36" y2="32" stroke-width="2"/>
                        </svg>
                    </div>
                    <h3 class="advantage-title">Same-Day Communication<span class="title-accent">Always Reachable</span></h3>
                    <p class="advantage-description">
                        We respond same-day and keep you updated at every step of the job. <strong>Real people, real answers</strong> — not voicemail.
                    </p>
                </div>
```

- [ ] **Step 3: Add truck photo below the advantages grid**

After the `</div>` that closes the advantages grid and before the `</div>` closing the why-choose section container, add:

```html
            <div style="margin-top:2.5rem;text-align:center">
                <img
                    src="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/fleet-trucks.jpg"
                    alt="Core Exteriors branded fleet trucks — professional exterior maintenance London Ontario"
                    style="max-width:100%;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12);"
                    loading="lazy"
                    width="900"
                    height="500"
                >
            </div>
```

- [ ] **Step 4: Verify**

```bash
grep -n "Same-Day Communication\|fleet-trucks" index.html
```
Expected: both strings found

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add communication card and truck photo to index.html Why Choose Us section"
```

---

### Task 17: Add trust bar to all 5 service pages

Service pages currently have 3 hero feature badges. Add the full trust bar section (as on index.html) below the hero.

**Files:** all 5 service pages

- [ ] **Step 1: Define the trust bar HTML to insert**

The trust bar to add after the `</section>` closing the service hero section on each page:

```html
    <!-- Trust Bar -->
    <section class="trust-bar-section" style="background:#f8f9fa;padding:1rem 0;border-bottom:1px solid #e9ecef;">
        <div class="trust-bar" style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:1.5rem;max-width:900px;margin:0 auto;padding:0 1rem;">
            <div class="trust-item">
                <svg class="trust-icon" viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;color:#f4a61e;margin-right:6px;vertical-align:middle;">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                <span style="font-weight:600;font-size:0.9rem;">Averaged 5 Stars</span>
            </div>
            <div class="trust-divider" style="width:1px;height:20px;background:#ccc;"></div>
            <div class="trust-item">
                <svg class="trust-icon" viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;color:#1a2a4a;margin-right:6px;vertical-align:middle;">
                    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
                </svg>
                <span style="font-weight:600;font-size:0.9rem;">$5M Insured</span>
            </div>
            <div class="trust-divider" style="width:1px;height:20px;background:#ccc;"></div>
            <div class="trust-item">
                <svg class="trust-icon" viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;color:#1a2a4a;margin-right:6px;vertical-align:middle;">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                </svg>
                <span style="font-weight:600;font-size:0.9rem;">WSIB Compliant</span>
            </div>
            <div class="trust-divider" style="width:1px;height:20px;background:#ccc;"></div>
            <div class="trust-item">
                <svg class="trust-icon" viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;color:#1a2a4a;margin-right:6px;vertical-align:middle;">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                <span style="font-weight:600;font-size:0.9rem;">Est. 2022</span>
            </div>
        </div>
    </section>
```

- [ ] **Step 2: Insert trust bar in each service page**

Use Edit tool for each page. Find the closing `</section>` of the service hero (identifiable by the surrounding `service-hero` class). Insert the trust bar HTML immediately after that `</section>`.

Do this for: `gutter-cleaning-london-ontario.html`, `deck-restoration-london-ontario.html`, `siding-cleaning-london-ontario.html`, `hardscape-optimization-london-ontario.html`, `window-cleaning-london-ontario.html`

- [ ] **Step 3: Verify**

```bash
grep -l "Averaged 5 Stars" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html | wc -l
```
Expected: 5

- [ ] **Step 4: Commit**

```bash
git add deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
git commit -m "feat: add trust bar (5 stars, insurance, WSIB, Est. 2022) to all service pages"
```

---

### Task 18: Replace SVG placeholders with real hero photos on service pages

**Files:** all 5 service pages

- [ ] **Step 1: Find the image placeholder in gutter-cleaning-london-ontario.html**

```bash
grep -n "image-placeholder\|service-hero-image" gutter-cleaning-london-ontario.html
```

- [ ] **Step 2: Replace placeholder in each service page**

For `gutter-cleaning-london-ontario.html`, use Edit tool. Find:
```html
            <div class="service-hero-image">
                <div class="image-placeholder">
                    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 24 L32 8 L56 24" />
                        <line x1="8" y1="24" x2="8" y2="28" />
                        <line x1="56" y1="24" x2="56" y2="28" />
                        <path d="M4 28 L12 28 L12 36 L4 40 Z" />
                        <path d="M52 28 L60 28 L60 40 L52 36 Z" />
                        <line x1="8" y1="40" x2="8" y2="56" />
                    </svg>
                    <span>Gutter Cleaning</span>
                </div>
            </div>
```
Replace with:
```html
            <div class="service-hero-image">
                <picture>
                    <source srcset="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/gutter-after.webp" type="image/webp">
                    <img src="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/gutter-after.jpg"
                        alt="Professional gutter cleaning result in London Ontario — Core Exteriors"
                        style="width:100%;height:100%;object-fit:cover;border-radius:12px;"
                        width="600" height="400">
                </picture>
            </div>
```

For `deck-restoration-london-ontario.html`, replace the image-placeholder div with:
```html
            <div class="service-hero-image">
                <picture>
                    <source srcset="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/deck-after.webp" type="image/webp">
                    <img src="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/deck-after.jpg"
                        alt="Professionally restored deck in London Ontario — Core Exteriors"
                        style="width:100%;height:100%;object-fit:cover;border-radius:12px;"
                        width="600" height="400">
                </picture>
            </div>
```

For `siding-cleaning-london-ontario.html`, replace with:
```html
            <div class="service-hero-image">
                <picture>
                    <source srcset="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/siding-masonville-after.webp" type="image/webp">
                    <img src="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/siding-masonville-after.jpg"
                        alt="Clean siding after professional soft wash in London Ontario — Core Exteriors"
                        style="width:100%;height:100%;object-fit:cover;border-radius:12px;"
                        width="600" height="400">
                </picture>
            </div>
```

For `hardscape-optimization-london-ontario.html`, replace with:
```html
            <div class="service-hero-image">
                <picture>
                    <source srcset="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/hardscape/CSVS8207-HDR-scaled.webp" type="image/webp">
                    <img src="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/hardscape/CSVS8207-HDR-scaled.jpg"
                        alt="Professionally restored interlock patio in London Ontario — Core Exteriors"
                        style="width:100%;height:100%;object-fit:cover;border-radius:12px;"
                        width="600" height="400">
                </picture>
            </div>
```

For `window-cleaning-london-ontario.html`, replace with:
```html
            <div class="service-hero-image">
                <picture>
                    <source srcset="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/sidewalk-byron-after.webp" type="image/webp">
                    <img src="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/sidewalk-byron-after.jpg"
                        alt="Clean exterior surfaces after professional cleaning in London Ontario — Core Exteriors"
                        style="width:100%;height:100%;object-fit:cover;border-radius:12px;"
                        width="600" height="400">
                </picture>
            </div>
```

- [ ] **Step 3: Verify no placeholders remain**

```bash
grep -l "image-placeholder" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
```
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
git commit -m "feat: replace SVG placeholders with real R2 hero photos on all service pages"
```

---

### Task 19: Add sticky mobile CTA bar to service pages and contact.html

**Files:** all 5 service pages, `contact.html`

- [ ] **Step 1: Define the sticky CTA HTML**

On service pages, the "Free Quote" button links to `contact.html` (not `#quoteForm` like on the homepage):

```html
    <!-- Sticky Mobile CTA -->
    <div class="sticky-cta" id="stickyCta">
        <a href="tel:519-712-1431" class="sticky-call">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
            </svg>
            <span>Call Now</span>
        </a>
        <a href="contact.html" class="sticky-quote">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
            </svg>
            <span>Free Quote</span>
        </a>
    </div>
```

- [ ] **Step 2: Insert in each service page**

Use Edit tool for each service page. Insert the sticky CTA HTML immediately before `<!-- Footer -->` (or before `<footer`).

Do this for: `gutter-cleaning-london-ontario.html`, `deck-restoration-london-ontario.html`, `siding-cleaning-london-ontario.html`, `hardscape-optimization-london-ontario.html`, `window-cleaning-london-ontario.html`

- [ ] **Step 3: Insert in contact.html**

Same insertion before `<footer` in `contact.html`. The "Free Quote" href on contact.html sticky bar should point to `#contact-form` (the form's ID on that page — verify the form has `id="contact-form"` or equivalent and adjust accordingly).

```bash
grep -n 'id="' contact.html | grep -i "form"
```
Use whatever ID the form has. If no ID, add `id="contact-form"` to the `<form>` tag.

- [ ] **Step 4: Verify**

```bash
grep -l "stickyCta" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html contact.html | wc -l
```
Expected: 6

- [ ] **Step 5: Commit**

```bash
git add deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html contact.html
git commit -m "feat: add sticky mobile Call/Quote CTA bar to all service pages and contact.html"
```

---

### Task 20: Add related blog posts section to service pages

**Files:** all 5 service pages, `styles.css`

- [ ] **Step 1: Add related posts CSS to styles.css**

Add at the end of `styles.css`:

```css
/* Related blog posts on service pages */
.related-posts {
    background: #f8f9fa;
    padding: 3rem 1.5rem;
}
.related-posts-container {
    max-width: 900px;
    margin: 0 auto;
}
.related-posts h2 {
    font-size: 1.4rem;
    color: #1a2a4a;
    margin-bottom: 1.5rem;
}
.related-posts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.25rem;
}
.related-post-card {
    display: block;
    background: #fff;
    border: 1px solid #e9ecef;
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    text-decoration: none;
    color: inherit;
    transition: box-shadow 0.2s, transform 0.2s;
}
.related-post-card:hover {
    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    transform: translateY(-2px);
}
.related-post-category {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #f4a61e;
    margin-bottom: 0.5rem;
}
.related-post-card h3 {
    font-size: 1rem;
    color: #1a2a4a;
    margin: 0 0 0.75rem;
    line-height: 1.4;
}
.related-post-link {
    font-size: 0.875rem;
    color: #3498db;
    font-weight: 600;
}
```

- [ ] **Step 2: Add related posts section to `gutter-cleaning-london-ontario.html`**

Use Edit tool. Insert before `<!-- Footer -->`:

```html
    <!-- Related Reading -->
    <section class="related-posts">
        <div class="related-posts-container">
            <h2>Related Reading</h2>
            <div class="related-posts-grid">
                <a href="blog/gutter-cleaning-frequency-london-ontario" class="related-post-card">
                    <span class="related-post-category">Gutter Maintenance</span>
                    <h3>How Often Should You Clean Your Gutters in London, Ontario?</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
                <a href="blog/clogged-gutters-leakage-water-damage" class="related-post-card">
                    <span class="related-post-category">Home Advice</span>
                    <h3>Clogged Gutters & Water Leakage: The Real Damage to Your Home</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
            </div>
        </div>
    </section>
```

- [ ] **Step 3: Add related posts section to `deck-restoration-london-ontario.html`**

Insert before `<!-- Footer -->`:

```html
    <!-- Related Reading -->
    <section class="related-posts">
        <div class="related-posts-container">
            <h2>Related Reading</h2>
            <div class="related-posts-grid">
                <a href="blog/signs-deck-needs-restoration-spring" class="related-post-card">
                    <span class="related-post-category">Deck Care</span>
                    <h3>5 Signs Your Deck Needs Restoration This Spring</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
                <a href="blog/deck-interlock-outdoor-kitchen-london-ontario" class="related-post-card">
                    <span class="related-post-category">Hardscape & Outdoor Living</span>
                    <h3>Deck Building, Interlock & Outdoor Kitchens in London Ontario</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
            </div>
        </div>
    </section>
```

- [ ] **Step 4: Add related posts section to `siding-cleaning-london-ontario.html`**

Insert before `<!-- Footer -->`:

```html
    <!-- Related Reading -->
    <section class="related-posts">
        <div class="related-posts-container">
            <h2>Related Reading</h2>
            <div class="related-posts-grid">
                <a href="blog/soft-wash-vs-pressure-wash" class="related-post-card">
                    <span class="related-post-category">Power Washing</span>
                    <h3>Soft Wash vs Pressure Wash: Which Is Right for Your Home?</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
                <a href="blog/spring-exterior-maintenance-checklist-london-ontario" class="related-post-card">
                    <span class="related-post-category">Seasonal Tips</span>
                    <h3>Spring Exterior Maintenance Checklist for London, Ontario</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
            </div>
        </div>
    </section>
```

- [ ] **Step 5: Add related posts section to `hardscape-optimization-london-ontario.html`**

Insert before `<!-- Footer -->`:

```html
    <!-- Related Reading -->
    <section class="related-posts">
        <div class="related-posts-container">
            <h2>Related Reading</h2>
            <div class="related-posts-grid">
                <a href="blog/deck-interlock-outdoor-kitchen-london-ontario" class="related-post-card">
                    <span class="related-post-category">Hardscape & Outdoor Living</span>
                    <h3>Deck Building, Interlock & Outdoor Kitchens in London Ontario</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
                <a href="blog/spring-exterior-maintenance-checklist-london-ontario" class="related-post-card">
                    <span class="related-post-category">Seasonal Tips</span>
                    <h3>Spring Exterior Maintenance Checklist for London, Ontario</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
            </div>
        </div>
    </section>
```

- [ ] **Step 6: Add related posts section to `window-cleaning-london-ontario.html`**

Insert before `<!-- Footer -->`:

```html
    <!-- Related Reading -->
    <section class="related-posts">
        <div class="related-posts-container">
            <h2>Related Reading</h2>
            <div class="related-posts-grid">
                <a href="blog/spring-exterior-maintenance-checklist-london-ontario" class="related-post-card">
                    <span class="related-post-category">Seasonal Tips</span>
                    <h3>Spring Exterior Maintenance Checklist for London, Ontario</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
                <a href="blog/soft-wash-vs-pressure-wash" class="related-post-card">
                    <span class="related-post-category">Power Washing</span>
                    <h3>Soft Wash vs Pressure Wash: Which Is Right for Your Home?</h3>
                    <span class="related-post-link">Read Article →</span>
                </a>
            </div>
        </div>
    </section>
```

- [ ] **Step 7: Verify**

```bash
grep -l "related-posts" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html | wc -l
```
Expected: 5

- [ ] **Step 8: Commit**

```bash
git add styles.css deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
git commit -m "feat: add related blog posts section to all service pages with CSS"
```

---

### Task 21: Upgrade service page sidebars with credibility signals

Add truck photo, communication/reliability copy, and stronger CTAs to the sidebar on each service page.

**Files:** all 5 service pages

- [ ] **Step 1: Define the credibility sidebar card HTML**

```html
                <div class="sidebar-card">
                    <img
                        src="https://pub-0c3adb3379354c6ca30653364ff800d8.r2.dev/fleet-trucks.jpg"
                        alt="Core Exteriors fleet truck — professional exterior services London Ontario"
                        style="width:100%;border-radius:8px;margin-bottom:0.75rem;"
                        loading="lazy"
                        width="320" height="180"
                    >
                    <ul style="list-style:none;padding:0;margin:0;font-size:0.875rem;line-height:1.8;">
                        <li>⭐ Averaged 5 Stars</li>
                        <li>✓ Same-day response</li>
                        <li>✓ We don't leave until you're 100% satisfied</li>
                        <li>✓ $5M insured & WSIB compliant</li>
                    </ul>
                </div>
```

- [ ] **Step 2: Insert in each service page sidebar**

Use Edit tool for each service page. Find the `<aside class="service-sidebar">` section. Insert the credibility card as the first card inside it (before the existing "Get a Free Quote" card).

Do this for all 5 service pages.

- [ ] **Step 3: Update sidebar CTAs to point to contact.html**

While editing each sidebar, also update the `href="index.html#contact"` on the "Request Free Estimate" sidebar link to `href="contact.html"`.

```bash
grep -n "index.html#contact\|sidebar-cta" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
```
(Should be zero after Task 2, but verify)

- [ ] **Step 4: Verify**

```bash
grep -l "fleet-trucks" deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html | wc -l
```
Expected: 5

- [ ] **Step 5: Commit**

```bash
git add deck-restoration-london-ontario.html gutter-cleaning-london-ontario.html hardscape-optimization-london-ontario.html siding-cleaning-london-ontario.html window-cleaning-london-ontario.html
git commit -m "feat: add truck photo and credibility signals to service page sidebars"
```

---

### Task 22: Final verification and deploy

- [ ] **Step 1: Run full site check**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1

echo "=== Checking for broken ../https:// in blog posts ==="
grep -rn "\.\./https://" blog/*.html | wc -l

echo "=== Checking for dead index.html#contact links ==="
grep -rn "index\.html#contact" *.html blog/*.html | grep -v "admin\|sales\|labour\|outreach"

echo "=== Checking email consistency ==="
grep -rn "info@corexteriors\.com" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/"

echo "=== Checking insurance amount ==="
grep -rn "\$2M\|\$10M\|10 Million\|2 Million" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/"

echo "=== Checking GA tag coverage ==="
grep -rl "G-E2LSN9ENFB" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/" | wc -l

echo "=== Checking social links ==="
grep -rl "corexteriorslondon" --include="*.html" | grep -v "admin\|sales\|labour\|outreach\|images/" | wc -l
```

Expected:
- `../https://`: 0
- `index.html#contact`: no output
- `info@corexteriors.com`: no output
- `$2M/$10M`: no output
- GA tag: ~26 files
- Social links: ~26 files

- [ ] **Step 2: Deploy to Vercel**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
vercel --prod --scope core-exteriors-projects
```

- [ ] **Step 3: Push to GitHub**

```bash
cd /c/Users/Mirkomil/Documents/Corexteriors-1
git push origin main
```

- [ ] **Step 4: Verify live site**

Open these URLs and confirm:
- `https://corexteriors.ca` — check trust bar shows Est. 2022, check Why Choose Us has 4th card + truck photo, check footer has social links
- `https://corexteriors.ca/gutter-cleaning-london-ontario` — check real hero photo, trust bar, sticky CTA, related posts
- `https://corexteriors.ca/blog/gutter-cleaning-frequency-london-ontario` — check logo loads correctly
- `https://corexteriors.ca/contact` — check Winter Services in nav, social links in footer

---

## Summary

| Phase | Tasks | Files Changed |
|-------|-------|--------------|
| Bug Fixes | 1–7 | 9 blog posts, 5 service pages, commercial.html, contact.html, ~26 pages |
| Google Analytics | 8 | ~26 pages |
| SEO | 9–14 | 9 title tags, index.html meta, 5 service pages schema, contact/commercial/blog schema |
| Credibility & UX | 15–21 | styles.css, index.html, 5 service pages, all footers |
| **Total** | **22** | **~30 files** |
