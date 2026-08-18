# Labour Photo Drive Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every worker-uploaded job photo (before/after/other) also gets copied into an organized Google Drive folder tree, without changing how the app itself stores or displays photos today.

**Architecture:** A new helper module `api/_googleDrive.js` resolves (and KV-caches) a `{date}/{jobTitle}/{Before|After|Other}` folder chain under a fixed root folder, then uploads the photo. `api/labour-photo.js` calls it, awaited, wrapped so failures never affect the worker-facing response. A one-time local script creates the root folder and shares it with `corexteriors@gmail.com`.

**Tech Stack:** `googleapis` (already a dependency, same package used for Calendar), `@vercel/kv` (already used throughout `api/labour.js` / `api/labour-photo.js`), Node's built-in `stream.Readable`.

**Spec:** `docs/superpowers/specs/2026-08-18-labour-photo-drive-backup-design.md`

---

### Task 1: Create the Drive backup helper module

**Files:**
- Create: `api/_googleDrive.js`

- [ ] **Step 1: Write the module**

```javascript
const { kv } = require('@vercel/kv');
const { google } = require('googleapis');
const { Readable } = require('stream');

const TAG_FOLDER_NAMES = { before: 'Before', after: 'After' };

function buildDriveClient() {
    const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    if (!email || !key) {
        console.warn('Drive backup: missing GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY, skipping');
        return null;
    }
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/drive.file'] });
    return google.drive({ version: 'v3', auth });
}

function escapeDriveName(name) {
    return String(name).replace(/'/g, "\\'");
}

async function findOrCreateFolder(drive, name, parentId) {
    const q = `name='${escapeDriveName(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const list = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });
    if (list.data.files && list.data.files.length) return list.data.files[0].id;
    const created = await drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
        fields: 'id',
    });
    return created.data.id;
}

// Resolves (creating + KV-caching as needed) the {date}/{jobTitle}/{Before|After|Other}
// folder chain under the fixed root folder, then uploads the photo into it.
// Never throws — any failure is logged and swallowed so a Drive outage can never
// break a worker's photo upload. See docs/superpowers/specs/2026-08-18-labour-photo-drive-backup-design.md.
async function backupPhotoToDrive({ date, jobId, jobTitle, tag, workerName, buffer, mimeType, fileExt }) {
    try {
        const rootId = (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim();
        if (!rootId) { console.warn('Drive backup: missing GOOGLE_DRIVE_ROOT_FOLDER_ID, skipping'); return; }
        const drive = buildDriveClient();
        if (!drive) return;

        const tagKey  = (tag === 'before' || tag === 'after') ? tag : 'other';
        const tagName = TAG_FOLDER_NAMES[tagKey] || 'Other';

        const dateCacheKey = `drive-folder:${date}`;
        let dateFolderId = await kv.get(dateCacheKey);
        if (!dateFolderId) {
            dateFolderId = await findOrCreateFolder(drive, date, rootId);
            await kv.set(dateCacheKey, dateFolderId);
        }

        const jobCacheKey = `drive-folder:${date}:${jobId}`;
        let jobFolderId = await kv.get(jobCacheKey);
        if (!jobFolderId) {
            jobFolderId = await findOrCreateFolder(drive, jobTitle || 'Job', dateFolderId);
            await kv.set(jobCacheKey, jobFolderId);
        }

        const tagCacheKey = `drive-folder:${date}:${jobId}:${tagKey}`;
        let tagFolderId = await kv.get(tagCacheKey);
        if (!tagFolderId) {
            tagFolderId = await findOrCreateFolder(drive, tagName, jobFolderId);
            await kv.set(tagCacheKey, tagFolderId);
        }

        const time = new Date().toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour12: false }).replace(/:/g, '');
        const safeName = (workerName || 'worker').replace(/[\\/'"]/g, '');
        const fileName = `${safeName}-${time}.${fileExt}`;

        await drive.files.create({
            requestBody: { name: fileName, parents: [tagFolderId] },
            media: { mimeType, body: Readable.from(buffer) },
            fields: 'id',
        });
    } catch (err) {
        console.error('Drive backup failed:', err.message);
    }
}

module.exports = { backupPhotoToDrive };
```

- [ ] **Step 2: Verify it loads and the failure path is silent**

There's no test framework in this repo (matches the rest of the labour portal — see spec's Testing section). Verify by requiring the module with no env vars set and confirming it warns and returns without throwing:

Run:
```bash
node -e "
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = '';
process.env.GOOGLE_PRIVATE_KEY = '';
process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = '';
const { backupPhotoToDrive } = require('./api/_googleDrive.js');
backupPhotoToDrive({ date: '2026-08-18', jobId: 'x', jobTitle: 'Test', tag: 'before', workerName: 'John', buffer: Buffer.from('a'), mimeType: 'image/jpeg', fileExt: 'jpg' })
  .then(() => console.log('OK: resolved without throwing'))
  .catch(e => { console.error('FAIL: threw', e); process.exit(1); });
"
```
Expected output: a `Drive backup: missing GOOGLE_DRIVE_ROOT_FOLDER_ID, skipping` warning, then `OK: resolved without throwing`. (`@vercel/kv` will warn about missing `KV_REST_API_URL`/token too if not set locally — that's expected outside Vercel and doesn't affect this check, since the function returns before ever calling `kv.get`.)

- [ ] **Step 3: Commit**

```bash
git add api/_googleDrive.js
git commit -m "$(cat <<'EOF'
Add Google Drive backup helper for labour photos

Resolves a date/job/tag folder chain (KV-cached) under a fixed root
folder and uploads a copy of each photo there. Never throws — a Drive
outage can't break the worker-facing upload.
EOF
)"
```

---

### Task 2: Wire the Drive backup into the photo upload endpoint

**Files:**
- Modify: `api/labour-photo.js`

- [ ] **Step 1: Add `workerName` to the verified session**

In `api/labour-photo.js`, find:

```javascript
async function verifyWorkerSession(token) {
    if (!token) return null;
    const session = await kv.get(`worker-session:${token}`);
    if (!session) return null;
    const worker = await kv.get(`worker:${session.workerId}`);
    if (!worker || !worker.active) return null;
    return session;
}
```

Replace the final line so the worker's display name (already fetched, just not returned) comes back with the session:

```javascript
async function verifyWorkerSession(token) {
    if (!token) return null;
    const session = await kv.get(`worker-session:${token}`);
    if (!session) return null;
    const worker = await kv.get(`worker:${session.workerId}`);
    if (!worker || !worker.active) return null;
    return { ...session, workerName: worker.name };
}
```

- [ ] **Step 2: Import the helper**

At the top of `api/labour-photo.js`, next to the existing requires:

```javascript
const { kv } = require('@vercel/kv');
const { put } = require('@vercel/blob');
const { backupPhotoToDrive } = require('./_googleDrive');
```

- [ ] **Step 3: Call it after the KV write succeeds**

Find:

```javascript
        await kv.set(logKey, log);
        return res.status(200).json({ success: true, url: blob.url, tag: normalizedTag });
```

Replace with:

```javascript
        await kv.set(logKey, log);

        await backupPhotoToDrive({
            date,
            jobId: calendarEventId,
            jobTitle: jobTitle || 'Job',
            tag: normalizedTag,
            workerName: session.workerName,
            buffer,
            mimeType,
            fileExt: mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1],
        });

        return res.status(200).json({ success: true, url: blob.url, tag: normalizedTag });
```

(`date`, `buffer`, and `mimeType` are all already in scope from earlier in this same function — `date` from `const date = todayKey();`, `buffer`/`mimeType` from the data-URL decode a few lines above.)

- [ ] **Step 4: Verify the file still parses and the call site is well-formed**

Run:
```bash
node --check api/labour-photo.js
```
Expected: no output (success). A syntax error would print a `SyntaxError` with a line number.

- [ ] **Step 5: Commit**

```bash
git add api/labour-photo.js
git commit -m "$(cat <<'EOF'
Copy uploaded labour photos to Google Drive alongside Blob storage

Fire-and-await (not fire-and-forget — Vercel functions can be frozen
after the response, so this must complete first) call into the new
Drive backup helper. Response shape to the worker is unchanged either
way, per the design doc's failure-isolation requirement.
EOF
)"
```

---

### Task 3: One-time root folder setup script

**Files:**
- Create: `scripts/setup-drive-folder.js`

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
// One-time setup: creates (or finds) the root Drive folder for labour photo
// backups and shares it with corexteriors@gmail.com. Run manually, once —
// not deployed, not part of any request path.
//
// Requires GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in the
// environment. These already exist in Vercel's Production env for this
// project (used by api/calendar.js). To run locally:
//
//   vercel env pull .env.drive-setup --environment=production
//   set -a; source .env.drive-setup; set +a
//   node scripts/setup-drive-folder.js
//   rm .env.drive-setup   # contains ALL project secrets — delete right after

const { google } = require('googleapis');

const ROOT_FOLDER_NAME = 'Core Exteriors – Labour Photos';
const SHARE_WITH = 'corexteriors@gmail.com';

async function main() {
    const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    if (!email || !key) {
        console.error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY in environment.');
        process.exit(1);
    }
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/drive.file'] });
    const drive = google.drive({ version: 'v3', auth });

    const existing = await drive.files.list({
        q: `name='${ROOT_FOLDER_NAME}' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
    });

    let folderId;
    if (existing.data.files && existing.data.files.length) {
        folderId = existing.data.files[0].id;
        console.log(`Folder already exists: ${folderId}`);
    } else {
        const created = await drive.files.create({
            requestBody: { name: ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id',
        });
        folderId = created.data.id;
        console.log(`Created folder: ${folderId}`);
    }

    const perms = await drive.permissions.list({ fileId: folderId, fields: 'permissions(id, emailAddress, role)' });
    const alreadyShared = (perms.data.permissions || []).some(p => p.emailAddress === SHARE_WITH);
    if (alreadyShared) {
        console.log(`Already shared with ${SHARE_WITH}`);
    } else {
        await drive.permissions.create({
            fileId: folderId,
            requestBody: { type: 'user', role: 'writer', emailAddress: SHARE_WITH },
            sendNotificationEmail: true,
        });
        console.log(`Shared with ${SHARE_WITH}`);
    }

    console.log('\nSet this in Vercel (Production env vars):');
    console.log(`GOOGLE_DRIVE_ROOT_FOLDER_ID=${folderId}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Verify it parses**

Run:
```bash
node --check scripts/setup-drive-folder.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-drive-folder.js
git commit -m "$(cat <<'EOF'
Add one-time script to create and share the Drive backup root folder
EOF
)"
```

- [ ] **Step 4: Run it against real credentials (requires user's `vercel` login)**

```bash
vercel env pull .env.drive-setup --environment=production --yes
```
Then, in the same shell (Git Bash):
```bash
set -a; source .env.drive-setup; set +a
node scripts/setup-drive-folder.js
```
Expected output ends with a line like:
```
GOOGLE_DRIVE_ROOT_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
```
Copy that ID — it's needed in Task 4. Then immediately delete the pulled secrets file:
```bash
rm .env.drive-setup
```

- [ ] **Step 5: Confirm the share landed**

Check `corexteriors@gmail.com`'s Google Drive → "Shared with me" → confirm "Core Exteriors – Labour Photos" appears. (Manual check — ask the user to confirm, or check via the Gmail/Drive account directly if accessible in this session.)

---

### Task 4: Add the env var and smoke-test end to end

**Files:** none (Vercel dashboard/CLI + live app)

- [ ] **Step 1: Add the env var to Vercel**

```bash
vercel env add GOOGLE_DRIVE_ROOT_FOLDER_ID production
```
Paste the folder ID from Task 3 Step 4 when prompted.

- [ ] **Step 2: Push the code changes and let auto-deploy run**

```bash
git push origin main
```
(GitHub is linked to Vercel — this triggers a Production deploy automatically, per this project's existing deploy setup.)

- [ ] **Step 3: Confirm the deploy succeeded**

```bash
vercel ls --scope core-exteriors-projects
```
Confirm the latest deployment for `corexteriors-main` is Ready.

- [ ] **Step 4: Upload a real test photo from the worker app**

Using the test worker (PIN `1234`, worker "test" — see project memory), open labour.html, open any job, tap "Add Before Photo", pick any image.

Confirm:
- The photo appears normally in the app (existing behavior, unaffected)
- Within a minute, the same photo appears in Drive at `Core Exteriors – Labour Photos/{today's date}/{job title}/Before/`

- [ ] **Step 5: Confirm failure isolation**

Temporarily remove `GOOGLE_DRIVE_ROOT_FOLDER_ID` from Vercel Production env, redeploy (or just check the Function logs after a real request — the `console.warn('Drive backup: missing GOOGLE_DRIVE_ROOT_FOLDER_ID, skipping')` line proves the branch is reached), upload another test photo, and confirm it still succeeds normally in the app. Then restore the env var.

- [ ] **Step 6: Final commit if anything changed during smoke testing**

```bash
git status
```
If nothing changed, nothing to commit — this step just confirms a clean tree after verification.
