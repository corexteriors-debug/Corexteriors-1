# Labour photos: copy to Google Drive for organizing

## Problem

Job photos uploaded by workers (before/after/other) are stored only in
Vercel Blob, referenced by URL from KV job logs. There's no organized,
human-browsable view of them — reviewing or organizing past job photos
means digging through the admin dashboard job-by-job. The site already
has a Google service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` /
`GOOGLE_PRIVATE_KEY`) used for Calendar; Drive access reuses the same
credentials.

## Non-goals

- Not replacing Vercel Blob. The app (`labour.html`, `admin.html`)
  keeps reading/displaying photos exactly as today — Blob URLs stored
  in KV job logs, unchanged.
- No backfill of photos uploaded before this change ships. Drive only
  gets photos uploaded going forward.
- No UI changes in `labour.html` or `admin.html`.
- No retry queue or user-visible error if the Drive copy fails — it's
  a best-effort backup, not a system of record.

## One-time setup: `scripts/setup-drive-folder.js`

A local, one-off script (not deployed, not a Vercel function):

1. Authenticates as the existing service account with scope
   `https://www.googleapis.com/auth/drive.file`.
2. Creates a root folder named `Core Exteriors – Labour Photos` in the
   service account's Drive (service accounts have their own Drive,
   separate from any human account — the app's photos would otherwise
   be invisible to us).
3. Shares that folder as Editor with `oblokulovmirkomil@gmail.com`, so
   it appears under "Shared with me" in normal Drive.
4. Prints the new folder's ID to stdout.

We take that ID and set it as `GOOGLE_DRIVE_ROOT_FOLDER_ID` in Vercel's
project env vars (and local `.env` for dev). Runtime code never
searches for or creates the root folder — it's a fixed, known ID.

This script is run once by hand after review; it is not part of the
request-handling code path.

## Runtime flow: `api/labour-photo.js`

After the existing Blob upload + KV `log.jobs[].photos` write succeeds
(unchanged), the handler additionally:

1. Resolves the date subfolder under `GOOGLE_DRIVE_ROOT_FOLDER_ID`
   (e.g. `2026-08-18`), creating it if it doesn't exist.
2. Resolves the job subfolder under that date folder, named from
   `jobTitle` (e.g. `123 Main St – Deck Restoration`), creating it if
   it doesn't exist.
3. Resolves a tag subfolder under the job folder — `Before`, `After`,
   or `Other` (untagged photos) — creating it if it doesn't exist.
4. Uploads the same photo buffer already used for the Blob `put()`
   call into that tag subfolder, named `{workerName}-{HHMMSS}.jpg`
   (e.g. `John-143210.jpg`). Worker name comes from the existing
   `worker:{workerId}` KV record already loaded during session
   verification. The tag no longer needs to be in the filename since
   the folder itself encodes it.

Resulting structure:

```
Core Exteriors – Labour Photos/
  2026-08-18/
    123 Main St – Deck Restoration/
      Before/
        John-091503.jpg
      After/
        John-143210.jpg
      Other/
        Sarah-120044.jpg
```

This whole block is wrapped in try/catch. Any failure — Drive API
error, quota, network — is logged with `console.error` and otherwise
ignored: the HTTP response to the worker (`{ success: true, url, tag }`)
is computed from the Blob/KV result only and is unaffected by Drive
outcome either way.

## Avoiding repeated folder lookups

Folder-by-name-under-parent is a Drive API list call, which is slower
and separately rate-limited from file uploads. Multiple photos
typically upload to the same job on the same day in one work session,
so resolved folder IDs are cached in KV once created:

- `drive-folder:{date}` → date folder ID
- `drive-folder:{date}:{jobId}` → job folder ID
- `drive-folder:{date}:{jobId}:{tag}` → tag subfolder ID (`before` /
  `after` / `other`)

On each upload, check KV first; only call Drive's folder-create/lookup
when the cache misses. This mirrors the existing
`labour-task-state:{date}:{eventId}` caching pattern already used
elsewhere in this API for per-day, per-job state.

## Known nuance: job folder naming isn't required to be unique

The KV cache key for a job folder is `drive-folder:{date}:{jobId}` —
correctness (never uploading to the wrong job's folder) depends only
on `jobId`, which is always unique. The folder's *display name* is
just `jobTitle` for human readability. If two different jobs on the
same day happen to share a title (e.g. two separate "Gutter Cleaning"
bookings at different addresses), they get two same-named sibling
folders under that date — each internally correct, just visually
ambiguous until opened. Not fixing this now (would need appending
address or a short ID suffix to every folder name, adding noise for
the common case where titles are already unique) — acceptable given
this is a browse-and-organize aid, not the system of record.

## Error handling summary

| Failure point | Behavior |
|---|---|
| Drive auth fails (bad/missing creds) | Logged, upload still succeeds via Blob |
| Drive folder create/lookup fails | Logged, upload still succeeds via Blob |
| Drive file upload fails | Logged, upload still succeeds via Blob |
| Blob upload fails (existing behavior) | Unchanged — request fails, worker sees the existing error/retry UI |

## Testing

No existing test framework in this repo (matches prior labour-portal
work, which was verified by direct code review + manual exercise
rather than an automated suite). Verification for this change:

- Manually run `scripts/setup-drive-folder.js` once against the real
  service account and confirm the folder appears under "Shared with
  me" for `oblokulovmirkomil@gmail.com`.
- After deploying, upload a real before/after/other photo from
  `labour.html` and confirm: (a) it still appears in the app/admin
  exactly as before, (b) it lands in Drive at
  `Core Exteriors – Labour Photos/{date}/{job title}/{Before|After|Other}/`.
- Temporarily break the Drive credentials (or simulate by throwing in
  the Drive branch) and confirm a photo upload still succeeds from the
  worker's point of view — proving the failure isolation actually
  holds.
