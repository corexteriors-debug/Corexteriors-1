# Post-Job Review Request Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 7 days after a job is marked completed, automatically email the client a star-rating request; 5-star ratings redirect to the Google Business Profile review page, 4-and-under stay as private feedback visible in a new admin Reviews tab.

**Architecture:** Extends the existing Vercel KV store with a `review:<id>` collection (mirrors the existing `lead:<id>` pattern), adds a second daily cron (`api/reviewrequest.js`) that mirrors `api/remind.js`'s structure exactly, and reuses the existing admin token/Bearer-auth pattern for the two new admin-facing endpoints. Business logic that can be tested without touching KV/network (the 7-day-due check, rating validation, id generation, email HTML) lives in a pure module `api/_reviewLogic.js` so it can be unit-tested with plain Node `assert` — this repo has no test runner, so this is the only place true TDD applies; the KV/network-touching endpoints are verified manually via `vercel dev` + `curl`, the same way `api/remind.js` and `api/leads.js` were originally verified. All new browser-side rendering (the landing page and the admin Reviews table) builds DOM nodes with `createElement`/`textContent` rather than template-literal HTML injection, so dynamic values (names, comments) can never be interpreted as markup.

**Tech Stack:** Vercel serverless functions (Node, CommonJS), `@vercel/kv`, `nodemailer` (Gmail). No test runner exists in this repo — pure logic is verified with `node`'s built-in `assert` module run directly; everything else is verified with `vercel dev` + `curl` against local KV/Gmail (pulled via `vercel env pull`).

---

### Task 1: Create a feature branch and worktree

**Files:** none (git only)

- [ ] **Step 1: From the main repo directory, create the worktree**

```bash
git worktree add .worktrees/review-automation -b feature/review-automation
cd .worktrees/review-automation
npm install
```

- [ ] **Step 2: Pull real environment variables for local testing**

```bash
vercel env pull .env.local
```

Expected: creates `.env.local` with `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `CRON_SECRET`, `ADMIN_PASSWORD` (these already exist in the Vercel project because `api/remind.js` and `api/leads.js` depend on them today).

- [ ] **Step 3: Confirm baseline**

```bash
node --check api/leads.js
node --check api/remind.js
```

Expected: no output (exit code 0) for both.

---

### Task 2: Pure review logic module (`api/_reviewLogic.js`) — TDD

**Files:**
- Create: `api/_reviewLogic.js`
- Create: `api/_reviewLogic.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/_reviewLogic.test.js`:

```javascript
const assert = require('assert');
const { isReviewDue, isValidRating, generateReviewId, buildReviewEmailHtml } = require('./_reviewLogic');

// isReviewDue
assert.strictEqual(isReviewDue('2026-07-01', '2026-07-08'), true, 'exactly 7 days later should be due');
assert.strictEqual(isReviewDue('2026-07-01', '2026-07-07'), false, '6 days later should not be due');
assert.strictEqual(isReviewDue('2026-07-01', '2026-07-09'), false, '8 days later should not be due');
assert.strictEqual(isReviewDue('', '2026-07-08'), false, 'empty jobCompletedDate should not be due');
assert.strictEqual(isReviewDue(null, '2026-07-08'), false, 'null jobCompletedDate should not be due');

// isValidRating
assert.strictEqual(isValidRating(1), true);
assert.strictEqual(isValidRating(5), true);
assert.strictEqual(isValidRating(0), false);
assert.strictEqual(isValidRating(6), false);
assert.strictEqual(isValidRating(3.5), false);
assert.strictEqual(isValidRating('5'), false, 'string ratings should be rejected');

// generateReviewId
const id1 = generateReviewId();
const id2 = generateReviewId();
assert.ok(id1.startsWith('review_'), 'id should start with review_');
assert.notStrictEqual(id1, id2, 'ids should be unique');

// buildReviewEmailHtml
const emailHtml = buildReviewEmailHtml({ clientName: 'Jane Doe', jobType: 'Deck Restoration', reviewId: 'review_123', siteUrl: 'https://corexteriors.ca' });
assert.ok(emailHtml.includes('Jane Doe'), 'should include client name');
assert.ok(emailHtml.includes('Deck Restoration'), 'should include job type');
assert.ok(emailHtml.includes('https://corexteriors.ca/review?id=review_123&rating=5'), 'should include 5-star link');
assert.ok(emailHtml.includes('https://corexteriors.ca/review?id=review_123&rating=1'), 'should include 1-star link');

console.log('All _reviewLogic tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node api/_reviewLogic.test.js`
Expected: `Error: Cannot find module './_reviewLogic'`

- [ ] **Step 3: Write the implementation**

Create `api/_reviewLogic.js`:

```javascript
function isReviewDue(jobCompletedDate, today) {
    if (!jobCompletedDate || !today) return false;
    const [jy, jm, jd] = jobCompletedDate.split('-').map(Number);
    const [ty, tm, td] = today.split('-').map(Number);
    if (!jy || !jm || !jd || !ty || !tm || !td) return false;
    const jobDate = new Date(jy, jm - 1, jd);
    const todayDate = new Date(ty, tm - 1, td);
    const diffDays = Math.round((todayDate - jobDate) / 86400000);
    return diffDays === 7;
}

function isValidRating(rating) {
    return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

function generateReviewId() {
    return `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function buildReviewEmailHtml({ clientName, jobType, reviewId, siteUrl }) {
    const starLink = (count) => {
        const stars = '⭐'.repeat(count);
        return `<a href="${siteUrl}/review?id=${reviewId}&rating=${count}" style="display:inline-block;margin:0 6px;font-size:22px;text-decoration:none;color:#F5B800">${stars}</a>`;
    };

    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#0a1628;padding:24px 32px;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">Core Exteriors</h1>
    <p style="color:#8899aa;margin:6px 0 0;font-size:13px">Professional Exterior Services — London, Ontario</p>
  </div>
  <div style="padding:32px;background:#f8f9fa;border:1px solid #e9ecef;border-top:none;text-align:center">
    <p style="font-size:16px;text-align:left">Hi <strong>${clientName}</strong>, thanks again for choosing Core Exteriors for your <strong>${jobType}</strong> job.</p>
    <p style="font-size:15px;text-align:left">Mind leaving a quick rating? Takes 10 seconds.</p>
    <div style="margin:24px 0">
      ${[1, 2, 3, 4, 5].map(starLink).join('')}
    </div>
    <p style="font-size:12px;color:#888;text-align:left">Tap the stars that match your experience.</p>
  </div>
  <div style="background:#0a1628;padding:14px 32px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:#8899aa;font-size:11px;margin:0">203 Cambridge St, London, ON, N6H 1N6 &nbsp;|&nbsp; 519-712-1431 &nbsp;|&nbsp; corexteriors.ca</p>
  </div>
</div>`;
}

module.exports = { isReviewDue, isValidRating, generateReviewId, buildReviewEmailHtml };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node api/_reviewLogic.test.js`
Expected: `All _reviewLogic tests passed`

- [ ] **Step 5: Commit**

```bash
git add api/_reviewLogic.js api/_reviewLogic.test.js
git commit -m "feat: add pure review-logic module (due-date check, rating validation, email HTML)"
```

---

### Task 3: Shared mailer helper (`api/_mailer.js`)

**Files:**
- Create: `api/_mailer.js`

- [ ] **Step 1: Write the implementation**

Create `api/_mailer.js` (extracts the nodemailer/Gmail transport setup that `api/remind.js` currently inlines — used only by the new review-request code paths, existing files are left untouched):

```javascript
const nodemailer = require('nodemailer');

async function sendMail({ to, subject, html }) {
    const gmailUser = process.env.GMAIL_USER || 'corexteriors@gmail.com';
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailPass) throw new Error('Gmail not configured');

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
        from: '"Core Exteriors" <' + gmailUser + '>',
        to,
        subject,
        html,
    });
}

module.exports = { sendMail };
```

- [ ] **Step 2: Verify syntax**

Run: `node --check api/_mailer.js`
Expected: no output (exit code 0)

- [ ] **Step 3: Commit**

```bash
git add api/_mailer.js
git commit -m "feat: add shared nodemailer helper for review-request emails"
```

---

### Task 4: Add `jobCompletedDate` to the lead PATCH allowlist

**Files:**
- Modify: `api/leads.js:225` (destructure) and `api/leads.js:254-258` (allowlist assignment)

- [ ] **Step 1: Confirm current state**

```bash
grep -n "const { id, status, paymentStatus" api/leads.js
```

Expected: one match, the destructure line inside the `PATCH` handler.

- [ ] **Step 2: Add the field to the destructure**

In `api/leads.js`, find (inside the `PATCH` handler):
```javascript
            const { id, status, paymentStatus, paymentMethod, paymentAmount, clientName, phone, email, address, notes } = req.body;
```
Replace with:
```javascript
            const { id, status, paymentStatus, paymentMethod, paymentAmount, clientName, phone, email, address, notes, jobCompletedDate } = req.body;
```

- [ ] **Step 3: Add the field assignment**

Find:
```javascript
            if (notes !== undefined) lead.notes = notes;

            lead.updatedAt = new Date().toISOString();
```
Replace with:
```javascript
            if (notes !== undefined) lead.notes = notes;
            if (jobCompletedDate !== undefined) lead.jobCompletedDate = jobCompletedDate;

            lead.updatedAt = new Date().toISOString();
```

- [ ] **Step 4: Verify syntax**

Run: `node --check api/leads.js`
Expected: no output (exit code 0)

- [ ] **Step 5: Manual verification**

```bash
vercel dev &
sleep 3
# Get an admin token
curl -s -X POST http://localhost:3000/api/auth -H "Content-Type: application/json" -d '{"password":"<your ADMIN_PASSWORD>","role":"admin"}'
```
Expected: JSON with a `token` field. Copy it, then:
```bash
curl -s -X PATCH http://localhost:3000/api/leads -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d '{"id":"<an existing lead id>","jobCompletedDate":"2026-07-01"}'
```
Expected: `{"success":true,"lead":{...,"jobCompletedDate":"2026-07-01",...}}`

- [ ] **Step 6: Commit**

```bash
git add api/leads.js
git commit -m "feat: allow jobCompletedDate on lead PATCH"
```

---

### Task 5: Register the second cron in `vercel.json`

**Files:**
- Modify: `vercel.json:98-103`

- [ ] **Step 1: Add the cron entry**

In `vercel.json`, find:
```json
    "crons": [
        {
            "path": "/api/remind",
            "schedule": "0 13 * * *"
        }
    ],
```
Replace with:
```json
    "crons": [
        {
            "path": "/api/remind",
            "schedule": "0 13 * * *"
        },
        {
            "path": "/api/reviewrequest",
            "schedule": "0 14 * * *"
        }
    ],
```

- [ ] **Step 2: Verify JSON validity**

Run: `node -e "require('./vercel.json'); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: register daily cron for review-request emails"
```

---

### Task 6: Review-request cron endpoint (`api/reviewrequest.js`)

**Files:**
- Create: `api/reviewrequest.js`

- [ ] **Step 1: Write the implementation**

Create `api/reviewrequest.js` (mirrors `api/remind.js`'s structure):

```javascript
const { kv } = require('@vercel/kv');
const { isReviewDue, generateReviewId, buildReviewEmailHtml } = require('./_reviewLogic');
const { sendMail } = require('./_mailer');

// Runs daily via Vercel Cron (see vercel.json)
// Sends a review-request email to clients whose job was completed exactly 7 days ago

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).end();

    const cronSecret = (process.env.CRON_SECRET || '').trim();
    if (cronSecret) {
        const authHeader = req.headers.authorization || '';
        if (authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    const today = getTodayDate('America/Toronto');
    const siteUrl = (process.env.SITE_URL || 'https://corexteriors.ca').replace(/\/$/, '');

    try {
        const leadIds = (await kv.get('lead_ids')) || [];
        const results = { sent: 0, skipped: 0, errors: 0 };

        for (const id of leadIds) {
            const lead = await kv.get(`lead:${id}`);
            if (!lead) continue;

            if (!lead.jobCompletedDate) { results.skipped++; continue; }
            if (lead.reviewEmailSent) { results.skipped++; continue; }
            if (!lead.email) { results.skipped++; continue; }
            if (lead.status === 'Lost') { results.skipped++; continue; }
            if (!isReviewDue(lead.jobCompletedDate, today)) { results.skipped++; continue; }

            try {
                const reviewId = generateReviewId();
                const jobType = lead.serviceType || 'exterior services';

                const review = {
                    id: reviewId,
                    leadId: id,
                    clientName: lead.clientName,
                    jobType,
                    jobCompletedDate: lead.jobCompletedDate,
                    rating: null,
                    comment: null,
                    routedToGoogle: false,
                    emailSentAt: new Date().toISOString(),
                    ratedAt: null,
                    status: 'new',
                };
                await kv.set(`review:${reviewId}`, review);
                const reviewIds = (await kv.get('review_ids')) || [];
                reviewIds.unshift(reviewId);
                await kv.set('review_ids', reviewIds);

                const emailHtml = buildReviewEmailHtml({ clientName: lead.clientName, jobType, reviewId, siteUrl });

                await sendMail({
                    to: lead.email,
                    subject: 'Quick favour? Rate your Core Exteriors experience',
                    html: emailHtml,
                });

                lead.reviewEmailSent = true;
                lead.reviewEmailSentAt = new Date().toISOString();
                lead.updatedAt = new Date().toISOString();
                await kv.set(`lead:${id}`, lead);

                results.sent++;
            } catch (err) {
                console.error(`Review request email failed for lead ${id}:`, err.message);
                results.errors++;
            }
        }

        console.log('Review request cron result:', results);
        return res.status(200).json({ success: true, date: today, ...results });
    } catch (err) {
        console.error('Review request cron error:', err);
        return res.status(500).json({ error: err.message });
    }
};

function getTodayDate(timeZone) {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return `${y}-${m}-${d}`;
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check api/reviewrequest.js`
Expected: no output (exit code 0)

- [ ] **Step 3: Manual verification**

With `vercel dev` running from Task 4 Step 5 (restart it if you stopped it, so it picks up `vercel.json` and the new file):

```bash
# Create a test lead with jobCompletedDate = 7 days ago (use `date -d "-7 days" +%Y-%m-%d` on Linux, or compute manually)
curl -s -X POST http://localhost:3000/api/leads -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d '{"clientName":"Test Client","phone":"5195551234","email":"you@example.com","serviceType":"Deck Restoration","jobCompletedDate":"<today-minus-7-days>"}'
```
Expected: `{"success":true,"lead":{...}}` — note the returned `lead.id`.

```bash
curl -s http://localhost:3000/api/reviewrequest -H "Authorization: Bearer <CRON_SECRET from .env.local>"
```
Expected: `{"success":true,"date":"<today>","sent":1,"skipped":0,"errors":0}` (skipped may be higher if other leads exist in KV — that's fine, just confirm `sent` is at least 1 and `errors` is 0). Confirm the email arrived at the test address.

- [ ] **Step 4: Commit**

```bash
git add api/reviewrequest.js
git commit -m "feat: add daily cron that sends review-request emails 7 days after job completion"
```

---

### Task 7: Landing page endpoint (`api/review.js`)

**Files:**
- Create: `api/review.js`

- [ ] **Step 1: Write the implementation**

Create `api/review.js`:

```javascript
const { kv } = require('@vercel/kv');
const { isValidRating } = require('./_reviewLogic');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Missing review id' });
        const review = await kv.get(`review:${id}`);
        if (!review) return res.status(404).json({ error: 'Review not found' });
        return res.status(200).json({ clientName: review.clientName, jobType: review.jobType });
    }

    if (req.method === 'POST') {
        const { id, rating, comment } = req.body || {};
        if (!id) return res.status(400).json({ error: 'Missing review id' });
        if (!isValidRating(rating)) return res.status(400).json({ error: 'Rating must be an integer 1-5' });

        const review = await kv.get(`review:${id}`);
        if (!review) return res.status(404).json({ error: 'Review not found' });

        review.rating = rating;
        review.comment = comment ? String(comment).slice(0, 2000) : null;
        review.ratedAt = new Date().toISOString();
        review.routedToGoogle = rating === 5;

        await kv.set(`review:${id}`, review);

        const response = { success: true };
        if (rating === 5) response.redirectUrl = process.env.GOOGLE_REVIEW_URL || '';
        return res.status(200).json(response);
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
```

- [ ] **Step 2: Verify syntax**

Run: `node --check api/review.js`
Expected: no output (exit code 0)

- [ ] **Step 3: Manual verification**

Using the review id created by the cron in Task 6 Step 3 (check `review_ids` — or just note the id logged by the cron run, or fetch it via a temporary log line if needed):
```bash
curl -s "http://localhost:3000/api/review?id=<reviewId>"
```
Expected: `{"clientName":"Test Client","jobType":"Deck Restoration"}`

```bash
curl -s -X POST http://localhost:3000/api/review -H "Content-Type: application/json" -d '{"id":"<reviewId>","rating":5}'
```
Expected: `{"success":true,"redirectUrl":"https://g.page/r/Cd4lmTyS9JZ7EAI/review"}`

```bash
curl -s -X POST http://localhost:3000/api/review -H "Content-Type: application/json" -d '{"id":"<reviewId>","rating":3,"comment":"Crew was late"}'
```
Expected: `{"success":true}` (no `redirectUrl` for non-5-star ratings)

- [ ] **Step 4: Commit**

```bash
git add api/review.js
git commit -m "feat: add landing-page endpoint for submitting star ratings"
```

---

### Task 8: Star-rating landing page (`review.html`)

**Files:**
- Create: `review.html`

- [ ] **Step 1: Write the page**

Create `review.html`. The script builds all dynamic content with `createElement`/`textContent` rather than string-based HTML assignment, so client-supplied values (name, job type) can never be interpreted as markup:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rate Your Experience — Core Exteriors</title>
<meta name="robots" content="noindex, nofollow">
<style>
  body { font-family: Arial, sans-serif; background:#0a1628; color:#333; margin:0; padding:0; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { background:#fff; border-radius:16px; padding:36px 28px; max-width:420px; width:90%; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,.3); }
  h1 { font-size:20px; color:#0a1628; margin:0 0 8px; }
  p { font-size:15px; color:#555; }
  textarea { width:100%; min-height:100px; border:1px solid #ddd; border-radius:8px; padding:10px; font-family:inherit; font-size:14px; margin-top:12px; box-sizing:border-box; }
  button { background:#F5B800; border:none; color:#0a1628; font-weight:700; padding:10px 24px; border-radius:8px; cursor:pointer; font-size:14px; margin-top:14px; }
</style>
</head>
<body>
  <div class="card" id="card">
    <p id="loading">Loading...</p>
  </div>

<script>
(async function () {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const rating = parseInt(params.get('rating'), 10);
    const card = document.getElementById('card');

    function clearCard() {
        while (card.firstChild) card.removeChild(card.firstChild);
    }

    function addEl(parent, tag, text, styleText) {
        const el = document.createElement(tag);
        if (text) el.textContent = text;
        if (styleText) el.style.cssText = styleText;
        parent.appendChild(el);
        return el;
    }

    if (!id || !(rating >= 1 && rating <= 5)) {
        clearCard();
        addEl(card, 'h1', 'Invalid link');
        addEl(card, 'p', 'This review link is missing or invalid.');
        return;
    }

    let context;
    try {
        const r = await fetch('/api/review?id=' + encodeURIComponent(id));
        if (!r.ok) throw new Error('not found');
        context = await r.json();
    } catch (e) {
        clearCard();
        addEl(card, 'h1', 'Link not found');
        addEl(card, 'p', 'We could not find this review request. It may have expired.');
        return;
    }

    const stars = '⭐'.repeat(rating);

    if (rating === 5) {
        clearCard();
        addEl(card, 'div', stars, 'font-size:32px;margin:16px 0');
        addEl(card, 'h1', 'Thanks, ' + context.clientName + '!');
        addEl(card, 'p', 'Redirecting you to Google to post your review...');
        try {
            const r = await fetch('/api/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, rating }),
            });
            const data = await r.json();
            if (data.redirectUrl) location.href = data.redirectUrl;
        } catch (e) {
            addEl(card, 'p', 'Something went wrong — please try again shortly.');
        }
        return;
    }

    clearCard();
    addEl(card, 'div', stars, 'font-size:32px;margin:16px 0');
    addEl(card, 'h1', 'Thanks for the feedback, ' + context.clientName);
    addEl(card, 'p', "We're sorry it wasn't a full 5-star experience for your " + context.jobType + ' job. Let us know what happened so we can make it right:');

    const textarea = document.createElement('textarea');
    textarea.id = 'comment';
    textarea.placeholder = 'Tell us more (optional)';
    card.appendChild(textarea);

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit';
    card.appendChild(submitBtn);

    const thanksMsg = addEl(card, 'p', "Thanks — we've received your feedback.", 'display:none;color:#1a6b3a;font-weight:600');

    submitBtn.addEventListener('click', async () => {
        const comment = textarea.value.trim();
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        try {
            await fetch('/api/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, rating, comment }),
            });
            textarea.style.display = 'none';
            submitBtn.style.display = 'none';
            thanksMsg.style.display = 'block';
        } catch (e) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
            alert('Something went wrong — please try again.');
        }
    });
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Manual verification**

With `vercel dev` running, open in a browser:
```
http://localhost:3000/review?id=<reviewId>&rating=4
```
Expected: page loads, shows "Thanks for the feedback, Test Client", a comment box, and a Submit button. Type a comment, click Submit, confirm it changes to the "Thanks — we've received your feedback." message with no errors in the browser console.

Then test the 5-star path:
```
http://localhost:3000/review?id=<a fresh reviewId>&rating=5
```
Expected: briefly shows "Thanks, Test Client! Redirecting you to Google..." then navigates to `https://g.page/r/Cd4lmTyS9JZ7EAI/review`.

- [ ] **Step 3: Commit**

```bash
git add review.html
git commit -m "feat: add star-rating landing page with strict Google-review gating"
```

---

### Task 9: Admin reviews endpoint (`api/reviews.js`)

**Files:**
- Create: `api/reviews.js`

- [ ] **Step 1: Write the implementation**

Create `api/reviews.js`:

```javascript
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const tokenData = await kv.get(`token:${token}`);
    if (!tokenData || tokenData.role !== 'admin') {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (req.method === 'GET') {
        const reviewIds = (await kv.get('review_ids')) || [];
        const reviews = [];
        for (const id of reviewIds) {
            const review = await kv.get(`review:${id}`);
            if (review) reviews.push(review);
        }
        reviews.sort((a, b) => new Date(b.emailSentAt) - new Date(a.emailSentAt));
        return res.status(200).json({ reviews });
    }

    if (req.method === 'PATCH') {
        const { id, status } = req.body || {};
        if (!id) return res.status(400).json({ error: 'Review id is required' });
        const validStatuses = ['new', 'read', 'resolved'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }
        const review = await kv.get(`review:${id}`);
        if (!review) return res.status(404).json({ error: 'Review not found' });
        review.status = status;
        await kv.set(`review:${id}`, review);
        return res.status(200).json({ success: true, review });
    }

    return res.status(405).json({ error: 'Method not allowed' });
};
```

- [ ] **Step 2: Verify syntax**

Run: `node --check api/reviews.js`
Expected: no output (exit code 0)

- [ ] **Step 3: Manual verification**

```bash
curl -s http://localhost:3000/api/reviews -H "Authorization: Bearer <admin token>"
```
Expected: `{"reviews":[...]}` including the test review record(s) from earlier tasks, most recent `emailSentAt` first.

```bash
curl -s -X PATCH http://localhost:3000/api/reviews -H "Content-Type: application/json" -H "Authorization: Bearer <admin token>" -d '{"id":"<reviewId>","status":"resolved"}'
```
Expected: `{"success":true,"review":{...,"status":"resolved",...}}`

- [ ] **Step 4: Commit**

```bash
git add api/reviews.js
git commit -m "feat: add admin endpoint to list and update review records"
```

---

### Task 10: "Mark Completed" button in `admin.html`

**Files:**
- Modify: `admin.html` (lead row action cell, around line 1808-1812; new function near `setPayment`, around line 2410)

- [ ] **Step 1: Add the button/status display to the lead row**

In `admin.html`, find (inside `renderLeads()`'s row template):
```javascript
                        <td style="white-space:nowrap">
                            <button onclick="openEditLead('${lead.id}')" style="background:rgba(230,126,34,.15);border:1px solid rgba(230,126,34,.3);color:#e67e22;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;margin-right:4px">✏️ Edit</button>
                            <button onclick="moveToLead('${lead.id}')" style="background:rgba(52,152,219,.15);border:1px solid rgba(52,152,219,.3);color:#3498db;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;margin-right:4px" title="Move back to Leads">📋 To Lead</button>
                            <button onclick="deleteLead('${lead.id}')" style="background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.3);color:#e74c3c;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem">🗑 Delete</button>
                        </td>
```
Replace with:
```javascript
                        <td style="white-space:nowrap">
                            ${lead.jobCompletedDate
                                ? `<span style="color:#2ecc71;font-size:.72rem;white-space:nowrap;margin-right:4px" title="Review request email sends 7 days after this date">✅ Done ${esc(lead.jobCompletedDate)}</span>`
                                : `<button onclick="markCompleted('${lead.id}')" style="background:rgba(46,204,113,.15);border:1px solid rgba(46,204,113,.3);color:#2ecc71;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;margin-right:4px">✅ Mark Completed</button>`
                            }
                            <button onclick="openEditLead('${lead.id}')" style="background:rgba(230,126,34,.15);border:1px solid rgba(230,126,34,.3);color:#e67e22;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;margin-right:4px">✏️ Edit</button>
                            <button onclick="moveToLead('${lead.id}')" style="background:rgba(52,152,219,.15);border:1px solid rgba(52,152,219,.3);color:#3498db;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;margin-right:4px" title="Move back to Leads">📋 To Lead</button>
                            <button onclick="deleteLead('${lead.id}')" style="background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.3);color:#e74c3c;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem">🗑 Delete</button>
                        </td>
```

(This snippet only extends the existing per-row template literal — which is returned as a string and assigned in bulk elsewhere in `renderLeads()`, unchanged by this task — with the same escaping convention, `esc()`, already used throughout that function.)

- [ ] **Step 2: Add the `markCompleted` function**

In `admin.html`, find (right after `setPayment`, before `// FILTERS`):
```javascript
        // FILTERS
        document.getElementById('searchInput').addEventListener('input', renderLeads);
```
Replace with:
```javascript
        // MARK JOB COMPLETED (triggers review-request email 7 days later)
        async function markCompleted(id) {
            const today = new Date().toISOString().slice(0, 10);
            const date = prompt('Job completed date (YYYY-MM-DD):', today);
            if (!date) return;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Invalid date format', 'error'); return; }
            try {
                const r = await fetch(`${API_BASE}/leads`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ id, jobCompletedDate: date }) });
                if (r.ok) {
                    const l = allLeads.find(x => x.id === id);
                    if (l) l.jobCompletedDate = date;
                    renderLeads();
                    toast('Marked completed — review request sends in 7 days', 'success');
                } else {
                    toast('Failed to update', 'error');
                }
            } catch (e) { toast('Failed to update', 'error') }
        }

        // FILTERS
        document.getElementById('searchInput').addEventListener('input', renderLeads);
```

- [ ] **Step 3: Manual verification**

With `vercel dev` running, open `http://localhost:3000/admin` (or `admin.html` directly), log in, go to the Sales tab, click "✅ Mark Completed" on a lead, accept the default date in the prompt. Confirm the button is replaced with "✅ Done <date>" and a "Marked completed" toast appears. Refresh the page and confirm the lead still shows "✅ Done <date>" (i.e., it persisted).

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat: add Mark Completed action to lead rows"
```

---

### Task 11: Reviews tab in `admin.html`

**Files:**
- Modify: `admin.html` (tab bar around line 937-946, tab-content section around line 1288-1305, tab-click handler around line 1642-1650, new JS functions after `buildJobDetailsRow` around line 1857)

- [ ] **Step 1: Add the tab button**

In `admin.html`, find:
```html
                <button class="tab-btn" data-tab="payroll">💵 Payroll</button>
```
Replace with:
```html
                <button class="tab-btn" data-tab="payroll">💵 Payroll</button>
                <button class="tab-btn" data-tab="reviews">⭐ Reviews</button>
```

- [ ] **Step 2: Add the tab content**

In `admin.html`, find:
```html
            <div class="tab-content" id="tab-payroll">
                <div class="table-card" style="margin-bottom:1.5rem">
                    <div class="table-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem">
                        <h2>💵 Biweekly Payroll</h2>
                        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
                            <button onclick="shiftPayroll(-1)" title="Previous period" style="background:#1a2a45;border:none;border-radius:8px;color:#fff;font-size:1.1rem;width:36px;height:36px;cursor:pointer;line-height:1">‹</button>
                            <input type="date" id="payrollFromPicker" style="background:#0a1628;border:1px solid #333;border-radius:8px;padding:.4rem .75rem;color:#fff;font-size:.85rem" onchange="loadPayroll()">
                            <button onclick="shiftPayroll(1)" title="Next period" style="background:#1a2a45;border:none;border-radius:8px;color:#fff;font-size:1.1rem;width:36px;height:36px;cursor:pointer;line-height:1">›</button>
                            <button onclick="goCurrentPayroll()" style="background:#333;border:none;border-radius:8px;padding:.4rem .75rem;color:#aaa;font-size:.8rem;cursor:pointer;height:36px">Today</button>
                        </div>
                    </div>
                    <div id="payrollContainer" style="padding:.75rem">
                        <p style="color:#888;text-align:center;padding:1.5rem">Open this tab to load payroll</p>
                    </div>
                </div>
            </div>

        </div>
    </div>
```
Replace with:
```html
            <div class="tab-content" id="tab-payroll">
                <div class="table-card" style="margin-bottom:1.5rem">
                    <div class="table-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem">
                        <h2>💵 Biweekly Payroll</h2>
                        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
                            <button onclick="shiftPayroll(-1)" title="Previous period" style="background:#1a2a45;border:none;border-radius:8px;color:#fff;font-size:1.1rem;width:36px;height:36px;cursor:pointer;line-height:1">‹</button>
                            <input type="date" id="payrollFromPicker" style="background:#0a1628;border:1px solid #333;border-radius:8px;padding:.4rem .75rem;color:#fff;font-size:.85rem" onchange="loadPayroll()">
                            <button onclick="shiftPayroll(1)" title="Next period" style="background:#1a2a45;border:none;border-radius:8px;color:#fff;font-size:1.1rem;width:36px;height:36px;cursor:pointer;line-height:1">›</button>
                            <button onclick="goCurrentPayroll()" style="background:#333;border:none;border-radius:8px;padding:.4rem .75rem;color:#aaa;font-size:.8rem;cursor:pointer;height:36px">Today</button>
                        </div>
                    </div>
                    <div id="payrollContainer" style="padding:.75rem">
                        <p style="color:#888;text-align:center;padding:1.5rem">Open this tab to load payroll</p>
                    </div>
                </div>
            </div>

            <!-- ========== TAB: REVIEWS ========== -->
            <div class="tab-content" id="tab-reviews">
                <div class="table-card">
                    <div class="table-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
                        <h2>⭐ Reviews <span id="reviewCount" style="color:rgba(255,255,255,.3);font-weight:400;font-size:.85rem"></span></h2>
                        <select id="reviewFilter" onchange="renderReviews()">
                            <option value="all">All</option>
                            <option value="low">4-Star and Under</option>
                            <option value="five">5-Star</option>
                        </select>
                    </div>
                    <div class="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Client</th>
                                    <th>Job</th>
                                    <th>Rating</th>
                                    <th>Comment</th>
                                    <th>Routed to Google</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody id="reviewsBody">
                                <tr><td colspan="7" class="loading">Loading reviews...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

        </div>
    </div>
```

- [ ] **Step 3: Load reviews when the tab is opened**

In `admin.html`, find:
```javascript
                if (btn.dataset.tab === 'salesleads') loadQLLeads();
```
Replace with:
```javascript
                if (btn.dataset.tab === 'salesleads') loadQLLeads();
                if (btn.dataset.tab === 'reviews') loadReviews();
```

- [ ] **Step 4: Add the reviews JS functions**

In `admin.html`, find (the end of `buildJobDetailsRow`, right before the mobile-card-render comment):
```javascript
            if (chips.length === 0) return '';
            return `<tr><td colspan="11" style="padding:.15rem 1rem .65rem;border-bottom:1px solid rgba(255,255,255,.06)"><div style="display:flex;flex-wrap:wrap;gap:.35rem">${chips.map(c => `<span style="background:rgba(52,152,219,.1);border:1px solid rgba(52,152,219,.2);color:rgba(255,255,255,.65);border-radius:20px;padding:2px 11px;font-size:.72rem;white-space:nowrap">${esc(c)}</span>`).join('')}</div></td></tr>`;
        }

        // ── MOBILE CARD RENDER ────────────────────────────────────────
```
Replace with:
```javascript
            if (chips.length === 0) return '';
            return `<tr><td colspan="11" style="padding:.15rem 1rem .65rem;border-bottom:1px solid rgba(255,255,255,.06)"><div style="display:flex;flex-wrap:wrap;gap:.35rem">${chips.map(c => `<span style="background:rgba(52,152,219,.1);border:1px solid rgba(52,152,219,.2);color:rgba(255,255,255,.65);border-radius:20px;padding:2px 11px;font-size:.72rem;white-space:nowrap">${esc(c)}</span>`).join('')}</div></td></tr>`;
        }

        // ── REVIEWS TAB ──────────────────────────────────────────────
        // Rows are built with createElement/textContent (not template-string
        // HTML assignment) so client comments can never be interpreted as markup.
        let allReviews = [];

        async function loadReviews() {
            try {
                const r = await fetch(`${API_BASE}/reviews`, { headers: { 'Authorization': `Bearer ${authToken}` } });
                if (r.status === 401) { localStorage.removeItem('admin_token'); location.reload(); return }
                const d = await r.json();
                allReviews = d.reviews || [];
                renderReviews();
            } catch (e) {
                const tbody = document.getElementById('reviewsBody');
                while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 7;
                td.className = 'empty-state';
                td.textContent = 'Failed to load. Please refresh.';
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
        }

        function renderReviews() {
            const filter = document.getElementById('reviewFilter').value;
            const filtered = allReviews.filter(rv => {
                if (filter === 'five') return rv.rating === 5;
                if (filter === 'low') return rv.rating !== null && rv.rating <= 4;
                return true;
            });

            document.getElementById('reviewCount').textContent = `(${filtered.length} of ${allReviews.length})`;
            const tbody = document.getElementById('reviewsBody');
            while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

            if (filtered.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 7;
                td.className = 'empty-state';
                const h3 = document.createElement('h3');
                h3.textContent = 'No reviews found';
                td.appendChild(h3);
                tr.appendChild(td);
                tbody.appendChild(tr);
                return;
            }

            filtered.forEach(rv => {
                const date = rv.emailSentAt ? new Date(rv.emailSentAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
                const tr = document.createElement('tr');

                const addCell = (text) => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); return td; };

                addCell(date);
                addCell(rv.clientName);
                addCell(rv.jobType);
                addCell(rv.rating ? '⭐'.repeat(rv.rating) : 'Not rated yet');
                const commentTd = addCell(rv.comment || '—');
                commentTd.style.maxWidth = '220px';
                addCell(rv.routedToGoogle ? '✅ Yes' : '—');

                const statusTd = document.createElement('td');
                const dropdown = document.createElement('div');
                dropdown.className = 'dropdown';
                const statusBtn = document.createElement('button');
                statusBtn.className = 'badge';
                statusBtn.textContent = rv.status;
                statusBtn.addEventListener('click', () => toggleDrop('rvstatus-' + rv.id));
                const menu = document.createElement('div');
                menu.className = 'dropdown-menu';
                menu.id = 'rvstatus-' + rv.id;
                [['new', '🔵 New'], ['read', '🟡 Read'], ['resolved', '🟢 Resolved']].forEach(([value, label]) => {
                    const optBtn = document.createElement('button');
                    optBtn.textContent = label;
                    optBtn.addEventListener('click', () => setReviewStatus(rv.id, value));
                    menu.appendChild(optBtn);
                });
                dropdown.appendChild(statusBtn);
                dropdown.appendChild(menu);
                statusTd.appendChild(dropdown);
                tr.appendChild(statusTd);

                tbody.appendChild(tr);
            });
        }

        async function setReviewStatus(id, status) {
            try {
                const r = await fetch(`${API_BASE}/reviews`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }, body: JSON.stringify({ id, status }) });
                if (r.ok) { const rv = allReviews.find(x => x.id === id); if (rv) rv.status = status; renderReviews(); toast('Review status updated', 'success') }
            } catch (e) { toast('Failed to update', 'error') }
        }

        // ── MOBILE CARD RENDER ────────────────────────────────────────
```

- [ ] **Step 5: Manual verification**

With `vercel dev` running, log into `/admin`, click the "⭐ Reviews" tab. Confirm the table loads with the test review record(s) created in Task 6/7. Change the filter dropdown to "5-Star" and "4-Star and Under" and confirm the table filters correctly. Click the status badge on a row, pick "🟢 Resolved", confirm the badge updates and a toast appears. Refresh and confirm the status persisted.

- [ ] **Step 6: Commit**

```bash
git add admin.html
git commit -m "feat: add Reviews tab to admin dashboard"
```

---

### Task 12: Set the Google review URL in Vercel

**Files:** none (Vercel dashboard/CLI only — do this before the cron goes live in production)

- [ ] **Step 1: Add the environment variable**

```bash
vercel env add GOOGLE_REVIEW_URL production
```
When prompted for the value, enter: `https://g.page/r/Cd4lmTyS9JZ7EAI/review`

- [ ] **Step 2: Confirm it's set**

```bash
vercel env ls
```
Expected: `GOOGLE_REVIEW_URL` appears in the list for the Production environment.

---

### Task 13: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full flow smoke test**

With `vercel dev` running and `.env.local` pulled (including `GOOGLE_REVIEW_URL` — re-run `vercel env pull .env.local` after Task 12 to pick it up locally too):

1. Create a fresh test lead via `POST /api/leads` with your own email address and no `jobCompletedDate`.
2. Log into `/admin`, find that lead in the Sales tab, click "✅ Mark Completed", set the date to 7 days ago.
3. Call `GET /api/reviewrequest` with the `CRON_SECRET` bearer token.
4. Confirm the email arrives with 5 clickable star links.
5. Click the 4-star link in the email (or paste its URL into a browser) — confirm the comment-box landing page appears, submit a comment, confirm the thank-you message shows.
6. In `/admin` → Reviews tab, confirm this review now shows the 4-star rating, the comment, and "Routed to Google: —".
7. Repeat steps 1-3 with a second test lead, then click its 5-star link — confirm it redirects to `https://g.page/r/Cd4lmTyS9JZ7EAI/review`.
8. In `/admin` → Reviews tab, confirm this second review shows the 5-star rating and "Routed to Google: ✅ Yes".

Expected: all 8 steps behave as described, with no console errors in the browser and no `errors` in the cron's JSON response.

- [ ] **Step 2: Re-run the cron immediately to confirm dedup**

```bash
curl -s http://localhost:3000/api/reviewrequest -H "Authorization: Bearer <CRON_SECRET>"
```
Expected: the two test leads from Step 1 are now `skipped` (their `reviewEmailSent` flag is `true`), confirming no duplicate emails would be sent.

---

## Self-Review Notes

- **Spec coverage:** Trigger logic (Task 6), email content (Task 2/6), strict branching (Task 7/8), data storage (Tasks 2/6/9), admin page (Tasks 10/11) — all five spec sections have a corresponding task.
- **Type consistency checked:** `jobCompletedDate` (lead field), `review:<id>` shape (`id, leadId, clientName, jobType, jobCompletedDate, rating, comment, routedToGoogle, emailSentAt, ratedAt, status`), and function names (`isReviewDue`, `isValidRating`, `generateReviewId`, `buildReviewEmailHtml`, `sendMail`, `markCompleted`, `loadReviews`, `renderReviews`, `setReviewStatus`) are consistent across every task that references them.
- **No backfill task included** — matches the spec's explicit "Out of Scope" call-out that this applies going forward only.
