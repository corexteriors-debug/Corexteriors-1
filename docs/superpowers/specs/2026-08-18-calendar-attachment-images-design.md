# Show manager-attached Calendar images to workers

## Problem

Managers sometimes attach an image to a job's Google Calendar event
(via Calendar's native "Add attachment" button) — e.g. a highlighted
photo showing which area needs work. Workers never see this in
`labour.html`. Confirmed two root causes:

1. `jobsForDate()` in `api/labour.js` never reads `event.attachments`
   at all — only title/description/location/times. This part of the
   feature was simply never built.
2. Even if it did, the attachment is a Drive file with its own
   permissions, separate from the calendar event. Confirmed by
   directly querying a real event ("Power washing", 2026-08-19) that
   has `image002.png` attached: our service account can see attachment
   *metadata* (title, fileId) on the event, but `drive.files.get`
   on that fileId returns "File not found" (Google's generic
   permission-denied response) — the service account has no access to
   the file's actual bytes.

The calendar itself is confirmed owned by `corexteriors@gmail.com`
(`event.organizer.email`, `self: true`), so the attachment very likely
lives in that same account's Drive — meaning the OAuth delegation
already planned in
`docs/superpowers/specs/2026-08-18-labour-photo-drive-backup-design.md`
(for the photo-backup feature) can solve this too, once its scope is
widened slightly (see below).

Workers authenticate via PIN only — no Google account, no Drive
access of their own — so even a working Drive credential can't just
hand them the raw `fileUrl`; the image must be proxied through our
own backend into a normal public URL.

## Shared dependency: one OAuth setup, two features

This spec and the photo-backup spec both need
`scripts/authorize-drive.js` run once (blocked on the user creating a
Google Cloud OAuth Client — see that spec's "One-time setup"). The
requested scope changes from `drive.file` alone to:

```
https://www.googleapis.com/auth/drive.file      (write — upload backup photos)
https://www.googleapis.com/auth/drive.readonly  (read  — see Calendar-attached files this app didn't create)
```

`drive.file` alone only grants access to files the app itself created
— it would never be able to read `image002.png`, which Calendar's own
upload flow created. `drive.readonly` (not the broader `drive` scope)
is the minimum addition that can read arbitrary existing files without
also granting delete/modify rights we don't need.

## Runtime flow

**`api/_googleDrive.js`** gains one more exported function:

```
mirrorAttachmentToBlob({ fileId, mimeType, fileName })
```

- Checks KV cache `calendar-attachment-blob:{fileId}` → blob URL.
  Cache-forever: once a manager attaches an image to an event, the
  fileId is stable and its content isn't expected to change during
  the job's life (same staleness tradeoff already accepted for the
  Drive folder-ID caches in the sibling spec).
- On cache miss: `drive.files.get({ fileId, alt: 'media' })` to fetch
  bytes (via the OAuth client, `drive.readonly` scope), `put()` into
  Vercel Blob (same as worker photo uploads), cache the URL, return it.
- Like `backupPhotoToDrive`, **never throws** — logs and returns `null`
  on any failure (missing OAuth env vars, file not accessible, Drive
  API error). A job's reference images are a nice-to-have, not a
  reason to break the job list.

**`jobsForDate()` in `api/labour.js`**, inside the per-event mapping
(where `parsed`/`tasks` are already built), adds:

```javascript
const imageAttachments = (e.attachments || [])
    .filter(a => a.mimeType && a.mimeType.startsWith('image/'));
const referenceImages = (await Promise.all(
    imageAttachments.map(a => mirrorAttachmentToBlob({
        fileId: a.fileId, mimeType: a.mimeType, fileName: a.title,
    }))
)).filter(Boolean);
```

added to the returned job object as `referenceImages: string[]` (blob
URLs). Non-image attachments (PDFs, docs) are ignored — out of scope,
the ask is specifically about photos. `kvJobs` (manually-added jobs,
not calendar-sourced) always get `referenceImages: []` — they have no
calendar event to attach anything to.

`mergeWorkerJobData()` doesn't need changes: it spreads the
`jobsForDate()`-provided job first (`...j`) before overlaying
worker-specific fields, so `referenceImages` passes through untouched.

## Frontend: `labour.html`

New read-only card in `renderJobDetail()`, titled "📎 Reference
Photos", rendered only when `job.referenceImages.length > 0`, placed
above the existing "📸 Photos" (before/after/other) card so it reads
as "here's what the manager attached" before "here's what you upload."
Same `renderPhotoThumb()`-style grid, but no upload buttons — purely
display, tapping an image opens it full-size in a new tab exactly like
existing photo thumbnails do.

## Non-goals

- Non-image attachments (PDF, docs) are not surfaced.
- No caching invalidation if a manager replaces the attached image on
  an existing event — the fileId changes when you re-attach in
  Calendar, so this isn't actually a problem in practice (a new
  fileId is just a cache miss, mirrors fresh).
- No admin-side UI changes — this spec is about what workers see.
- Not fixing `kvJobs` (manually-added, non-calendar jobs) to support
  attachments — they have no calendar event to attach to; if that's
  wanted later, it's a different feature (e.g. uploading a reference
  image directly in the manual-job editor).

## Testing

Same no-framework, manual-verification approach as the sibling spec:
after the OAuth setup and this code ship together, confirm on the real
"Power washing" job (already has a real attachment, already confirmed
via direct API query) that `referenceImages` appears in the API
response and renders as a thumbnail in `labour.html`'s job detail for
a worker.
