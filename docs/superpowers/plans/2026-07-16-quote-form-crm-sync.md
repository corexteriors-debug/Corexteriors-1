# Quote Form → CRM Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every quote-form submission (homepage, commercial, contact page) creates a lead record in the same Vercel KV store `admin.html` reads, instead of only sending an email.

**Architecture:** `api/contact.js` gains a direct `@vercel/kv` write (same key scheme as `api/leads.js`: `lead:<id>` + `lead_ids` index) that runs before email is sent, so a lead is never lost even if Gmail is misconfigured. `script.js` and `contact.html` are fixed to send `company` and `source`, fields the server needs but currently drops. `admin.html` gets a small display update to surface commercial leads.

**Tech Stack:** Vanilla JS (`api/*.js` Vercel serverless functions), `@vercel/kv`, static HTML/JS front end. No test runner exists in this repo (`npm test` is a stub) — verification is `node --check` for syntax plus a manual curl + browser smoke test at the end.

---

### Task 1: Create a feature branch

**Files:** none (git only)

- [ ] **Step 1: Create and switch to a feature branch**

```bash
git checkout -b feature/quote-form-crm-sync
```

Expected: `Switched to a new branch 'feature/quote-form-crm-sync'`

---

### Task 2: Fix `script.js` to stop dropping `company`, and forward `source`

**Files:**
- Modify: `script.js:279-306`

The `quoteForm` handler (shared by `index.html` and `commercial.html`, since both use `id="quoteForm"`) builds a `leadData` object and a request body that both omit `company` (present only on `commercial.html`) and never send `source` to the server at all, even though it's already computed client-side for analytics.

- [ ] **Step 1: Read current state to confirm line numbers still match**

```bash
grep -n "leadData = {" -A 10 script.js
```

Expected: shows the block starting at `const leadData = {` with `name, phone, email, address, service, message, source` fields (no `company`).

- [ ] **Step 2: Add `company` to `leadData` and include `company` + `source` in the fetch body**

Replace:
```javascript
            const formData = new FormData(quoteForm);
            const leadData = {
                name: formData.get('name'),
                phone: formData.get('phone'),
                email: formData.get('email'),
                address: formData.get('address'),
                service: formData.get('service'),
                message: formData.get('message'),
                source: window.location.pathname.split('/').pop() || 'index.html'
            };
```

With:
```javascript
            const formData = new FormData(quoteForm);
            const leadData = {
                name: formData.get('name'),
                phone: formData.get('phone'),
                email: formData.get('email'),
                address: formData.get('address'),
                service: formData.get('service'),
                message: formData.get('message'),
                company: formData.get('company'),
                source: window.location.pathname.split('/').pop() || 'index.html'
            };
```

Replace:
```javascript
                const response = await fetch('/api/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: leadData.name,
                        phone: leadData.phone,
                        email: leadData.email,
                        address: leadData.address,
                        service: leadData.service,
                        message: leadData.message || ''
                    })
                });
```

With:
```javascript
                const response = await fetch('/api/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: leadData.name,
                        phone: leadData.phone,
                        email: leadData.email,
                        address: leadData.address,
                        service: leadData.service,
                        message: leadData.message || '',
                        company: leadData.company || '',
                        source: leadData.source
                    })
                });
```

- [ ] **Step 3: Syntax-check the file**

```bash
node --check script.js
```

Expected: no output (exit code 0).

- [ ] **Step 4: Commit**

```bash
git add script.js
git commit -m "fix: forward company and source fields from quote form to API"
```

---

### Task 3: Fix `contact.html` to send `source`

**Files:**
- Modify: `contact.html:423-431`

`contact.html`'s contact form has its own inline submit handler (separate from `script.js`) and never sends a `source` field at all, so the server can't tell a contact-page submission apart from a homepage one.

- [ ] **Step 1: Confirm current state**

```bash
grep -n "const leadData = {" -A 8 contact.html
```

Expected: shows `name, email, phone, address, service, message` with no `source`.

- [ ] **Step 2: Add `source` to the leadData object**

Replace:
```javascript
                const formData = new FormData(contactForm);
                const leadData = {
                    name: `${formData.get('firstName')} ${formData.get('lastName')}`,
                    email: formData.get('email'),
                    phone: formData.get('phone'),
                    address: formData.get('address'),
                    service: formData.get('service'),
                    message: formData.get('message')
                };
```

With:
```javascript
                const formData = new FormData(contactForm);
                const leadData = {
                    name: `${formData.get('firstName')} ${formData.get('lastName')}`,
                    email: formData.get('email'),
                    phone: formData.get('phone'),
                    address: formData.get('address'),
                    service: formData.get('service'),
                    message: formData.get('message'),
                    source: 'contact.html'
                };
```

The existing `fetch('/api/contact', { ... body: JSON.stringify(leadData) })` call a few lines below already sends the whole `leadData` object as-is (unlike `script.js`, it doesn't enumerate individual fields), so no further change is needed there — `source` will be included automatically.

- [ ] **Step 3: Confirm the fetch body still sends the whole object**

```bash
grep -n "body: JSON.stringify(leadData)" contact.html
```

Expected: one match, inside the `fetch('/api/contact', ...)` call.

- [ ] **Step 4: Commit**

```bash
git add contact.html
git commit -m "fix: tag contact page submissions with their source"
```

---

### Task 4: Save a lead to Vercel KV from `api/contact.js`

**Files:**
- Modify: `api/contact.js` (whole file — see below for exact before/after)

This is the core of the fix. `api/contact.js` currently only sends two emails. It needs to also write a lead record using the same KV key scheme `api/leads.js` uses (`lead:<id>` + `lead_ids` index), so `admin.html`'s existing `GET /api/leads` fetch picks it up with no changes needed on the read side.

- [ ] **Step 1: Read the current file to confirm nothing has changed underneath**

```bash
node --check api/contact.js
```

Expected: no output (exit code 0) — confirms the starting file is valid before we touch it.

- [ ] **Step 2: Add the KV import and a lead-saving helper, and call it before the Gmail check**

Replace the top of the file:
```javascript
const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
```

With:
```javascript
const nodemailer = require('nodemailer');
const { kv } = require('@vercel/kv');

async function saveLeadToCrm({ name, email, phone, address, serviceLabel, message, company, source }) {
    const lead = {
        id: `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        clientName: name || '',
        phone: phone || '',
        email: email || '',
        address: address || '',
        serviceType: serviceLabel || '',
        notes: message || '',
        company: company || '',
        leadSource: company ? 'website-commercial' : 'website-residential',
        pageSource: source || '',
        estimatedValue: '',
        salesRep: '',
        estimateNumber: '',
        services: [],
        bundleDiscount: 0,
        discount: 0,
        subtotal: '',
        hst: '',
        total: '',
        saleDate: '',
        saleTime: '',
        paymentStatus: 'Unpaid',
        paymentMethod: '',
        paymentAmount: 0,
        jobDetails: null,
        survey: {},
        legal: {},
        hasSignature: false,
        createdByAdmin: false,
        status: 'New',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    await kv.set(`lead:${lead.id}`, lead);
    const leadIds = (await kv.get('lead_ids')) || [];
    leadIds.unshift(lead.id);
    await kv.set('lead_ids', leadIds);

    return lead;
}

module.exports = async (req, res) => {
```

- [ ] **Step 3: Call `saveLeadToCrm` right after validation, before the Gmail check**

Replace:
```javascript
    try {
        const { name, email, phone, address, service, message } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'Name, email, and phone are required' });
        }

        const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
        const gmailPass = process.env.GMAIL_APP_PASSWORD;

        if (!gmailPass) {
            console.error('GMAIL_APP_PASSWORD not configured');
            return res.status(500).json({ error: 'Email service not configured' });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailUser, pass: gmailPass }
        });

        const serviceLabels = {
```

With:
```javascript
    try {
        const { name, email, phone, address, service, message, company, source } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'Name, email, and phone are required' });
        }

        const serviceLabels = {
```

(This moves `serviceLabels` up so it's available for the CRM save below, and defers the Gmail transport setup until after the lead is saved.)

- [ ] **Step 4: Insert the CRM save and move Gmail setup after it**

Find this block (now right after the `serviceLabels` map, which stays where it was — only the code above it moved):
```javascript
        const serviceLabel = serviceLabels[service] || service || 'Not specified';
        const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });

        // 1. Email to Core Exteriors team — new lead notification
```

Replace it with:
```javascript
        const serviceLabel = serviceLabels[service] || service || 'Not specified';
        const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });

        // Save to CRM first so the inquiry isn't lost even if email fails
        try {
            await saveLeadToCrm({ name, email, phone, address, serviceLabel, message, company, source });
        } catch (crmError) {
            console.error('Failed to save lead to CRM:', crmError);
        }

        const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
        const gmailPass = process.env.GMAIL_APP_PASSWORD;

        if (!gmailPass) {
            console.error('GMAIL_APP_PASSWORD not configured');
            return res.status(500).json({ error: 'Email service not configured' });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailUser, pass: gmailPass }
        });

        // 1. Email to Core Exteriors team — new lead notification
```

- [ ] **Step 5: Syntax-check the whole file**

```bash
node --check api/contact.js
```

Expected: no output (exit code 0).

- [ ] **Step 6: Sanity-check the final structure**

```bash
grep -n "require('@vercel/kv')\|saveLeadToCrm\|const gmailPass" api/contact.js
```

Expected: 3-4 matches — the `require`, the function definition, the call inside the try block, and the `gmailPass` line now appearing *after* the `saveLeadToCrm` call.

- [ ] **Step 7: Commit**

```bash
git add api/contact.js
git commit -m "feat: save quote-form submissions as CRM leads

Website inquiries previously only triggered an email and were never
saved to the KV store admin.html reads from. Save happens before
email is attempted so a Gmail misconfiguration can't drop a lead."
```

---

### Task 5: Show commercial leads in `admin.html`'s desktop table

**Files:**
- Modify: `admin.html:1718` (search string)
- Modify: `admin.html:1764-1768` (client name cell)

- [ ] **Step 1: Confirm current state**

```bash
grep -n "l.clientName + ' ' + l.phone + ' ' + l.address + ' ' + l.email + ' ' + l.serviceType + ' ' + l.estimateNumber" admin.html
grep -n "<strong>\${esc(lead.clientName)}</strong>" admin.html
```

Expected: one match each, around lines 1718 and 1765.

- [ ] **Step 2: Add `company` to the desktop search string**

Replace:
```javascript
                    const s = (l.clientName + ' ' + l.phone + ' ' + l.address + ' ' + l.email + ' ' + l.serviceType + ' ' + l.estimateNumber).toLowerCase();
```

With:
```javascript
                    const s = (l.clientName + ' ' + l.phone + ' ' + l.address + ' ' + l.email + ' ' + l.serviceType + ' ' + l.estimateNumber + ' ' + (l.company || '')).toLowerCase();
```

- [ ] **Step 3: Add the commercial badge + company name to the client-name cell**

Replace:
```javascript
                        <td>
                            <strong>${esc(lead.clientName)}</strong>
                            ${lead.email ? '<br><span style="color:rgba(255,255,255,.4);font-size:.75rem">' + esc(lead.email) + '</span>' : ''}
                            ${lead.address ? '<br><span style="color:rgba(255,255,255,.35);font-size:.75rem">' + esc(lead.address) + '</span>' : ''}
                        </td>
```

With:
```javascript
                        <td>
                            <strong>${esc(lead.clientName)}</strong>
                            ${lead.leadSource === 'website-commercial' ? '<br><span style="background:rgba(230,126,34,.15);border:1px solid rgba(230,126,34,.3);color:#e67e22;border-radius:20px;padding:1px 8px;font-size:.68rem;display:inline-block;margin-top:2px">🏢 Commercial' + (lead.company ? ' · ' + esc(lead.company) : '') + '</span>' : ''}
                            ${lead.email ? '<br><span style="color:rgba(255,255,255,.4);font-size:.75rem">' + esc(lead.email) + '</span>' : ''}
                            ${lead.address ? '<br><span style="color:rgba(255,255,255,.35);font-size:.75rem">' + esc(lead.address) + '</span>' : ''}
                        </td>
```

- [ ] **Step 4: Sanity-check for balanced template literals**

```bash
node --check admin.html 2>&1 | head -5
```

Expected: `node --check` will fail because `admin.html` isn't a `.js` file (SyntaxError from the HTML tags) — that's expected and not a real signal here. Instead, extract just the inline script and check it:

```bash
sed -n '/<script>/,/<\/script>/p' admin.html | sed '1d;$d' > /tmp/admin-inline.js
node --check /tmp/admin-inline.js
```

Expected: no output (exit code 0). If there are multiple `<script>` blocks and this grabs the wrong one, instead just visually re-read the two edited regions with the Read tool to confirm the template literal backticks and `${...}` braces are balanced.

- [ ] **Step 5: Commit**

```bash
git add admin.html
git commit -m "feat: show commercial badge and company name on desktop leads table"
```

---

### Task 6: Show commercial leads in `admin.html`'s mobile card view

**Files:**
- Modify: `admin.html:1872` (search string)
- Modify: `admin.html:1911-1918` (card header)

- [ ] **Step 1: Confirm current state**

```bash
grep -n "l.clientName + ' ' + l.phone + ' ' + l.address + ' ' + l.email + ' ' + l.serviceType).toLowerCase" admin.html
grep -n "lead-card-name" admin.html
```

Expected: one match each.

- [ ] **Step 2: Add `company` to the mobile search string**

Replace:
```javascript
                    const s = (l.clientName + ' ' + l.phone + ' ' + l.address + ' ' + l.email + ' ' + l.serviceType).toLowerCase();
```

With:
```javascript
                    const s = (l.clientName + ' ' + l.phone + ' ' + l.address + ' ' + l.email + ' ' + l.serviceType + ' ' + (l.company || '')).toLowerCase();
```

- [ ] **Step 3: Add the commercial badge to the card header**

Replace:
```javascript
                return `<div class="lead-card">
                    <div class="lead-card-header">
                        <div>
                            <div class="lead-card-name">${esc(lead.clientName)}</div>
                            <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-top:2px">${esc(lead.address || '')}</div>
                        </div>
                        <div class="lead-card-date">${dateDisplay}</div>
                    </div>
```

With:
```javascript
                return `<div class="lead-card">
                    <div class="lead-card-header">
                        <div>
                            <div class="lead-card-name">${esc(lead.clientName)}${lead.leadSource === 'website-commercial' ? ' <span style="background:rgba(230,126,34,.15);border:1px solid rgba(230,126,34,.3);color:#e67e22;border-radius:20px;padding:1px 8px;font-size:.65rem">🏢 Commercial</span>' : ''}</div>
                            <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-top:2px">${esc(lead.company ? lead.company + ' · ' : '') + esc(lead.address || '')}</div>
                        </div>
                        <div class="lead-card-date">${dateDisplay}</div>
                    </div>
```

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat: show commercial badge and company name on mobile leads cards"
```

---

### Task 7: Deploy to a preview and smoke-test end to end

**Files:** none (deployment + manual verification)

This repo has no automated test runner, and the behavior we need to confirm (a KV write actually landing and rendering correctly in `admin.html`) requires live Vercel KV — so verification here is a real preview deployment plus a manual check, not a unit test.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/quote-form-crm-sync
```

Expected: push succeeds; if GitHub↔Vercel integration is connected (confirmed earlier for this repo), this triggers a Preview deployment automatically.

- [ ] **Step 2: Find the preview URL**

```bash
vercel ls --scope core-exteriors-projects 2>&1 | head -10
```

Look for the most recent deployment tied to `feature/quote-form-crm-sync` — note its URL (something like `https://corexteriors-main-<hash>-core-exteriors-projects.vercel.app`).

- [ ] **Step 3: Submit a test residential lead against the preview**

```bash
curl -s -X POST "https://<preview-url>/api/contact" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Residential","email":"test-residential@example.com","phone":"5195551234","address":"123 Test St","service":"gutters","message":"Smoke test lead","company":"","source":"index.html"}'
```

Expected: JSON response `{"success":true,...}` (HTTP 200). If it 500s with "Email service not configured," that's fine for this smoke test — Preview environments may not have `GMAIL_APP_PASSWORD` set — the important thing to verify next is that the KV write still happened despite the email failing.

- [ ] **Step 4: Submit a test commercial lead against the preview**

```bash
curl -s -X POST "https://<preview-url>/api/contact" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test PM","email":"test-commercial@example.com","phone":"5195555678","address":"","service":"","message":"","company":"Test Property Group","source":"commercial.html"}'
```

Expected: JSON response `{"success":true,...}` (or the same email-not-configured 500 as above).

- [ ] **Step 5: Verify both leads landed in the CRM**

Open `https://<preview-url>/admin.html` in a browser, log in, and confirm:
- "Test Residential" appears in the Leads list with status "New" and service "Gutter Cleaning."
- "Test PM" appears with a 🏢 Commercial badge showing "Test Property Group," and searching "Test Property Group" in the leads search box filters down to it.

- [ ] **Step 6: Delete the two test leads**

In `admin.html`, use the 🗑 Delete button on both "Test Residential" and "Test PM" rows so they don't pollute the real leads list.

- [ ] **Step 7: Merge to main**

```bash
git checkout main
git pull origin main
git merge feature/quote-form-crm-sync
git push origin main
```

Expected: fast-forward or clean merge; push to `main` triggers the real Production deployment (per this repo's existing GitHub↔Vercel auto-deploy).

- [ ] **Step 8: Confirm production deploy succeeded**

```bash
vercel ls --scope core-exteriors-projects 2>&1 | head -5
```

Expected: a new deployment for `main` in "Ready" state pointing at `corexteriors.ca`.

---

## Self-Review Notes

- **Spec coverage:** Task 4 covers the field mapping table and ordering/failure-handling requirements from the spec. Task 2/3 cover the dropped `company` field bug and `source` propagation. Tasks 5/6 cover the admin badge + company display + search on both desktop and mobile. The "no auto-scheduling" spec point required no task — it's satisfied by construction, since Task 4's `saveLeadToCrm` never calls `api/leads.js`'s `createJobEvent`.
- **Out-of-scope items** (Google Sheet webhook, spam protection, the dead `admin-dashboard.html`/`crm/` systems) are intentionally untouched — no tasks reference them.
- **Type/field consistency:** `leadSource`, `pageSource`, and `company` are named identically in Task 4 (where they're written) and Tasks 5/6 (where they're read) — verified by re-reading both sides while writing this plan.
