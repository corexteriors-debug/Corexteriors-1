# Labour photos: copy to Google Drive for organizing

## Problem

Job photos uploaded by workers (before/after/other) are stored only in
Vercel Blob, referenced by URL from KV job logs. There's no organized,
human-browsable view of them — reviewing or organizing past job photos
means digging through the admin dashboard job-by-job.

## Revision: service account auth doesn't work for file storage

The original version of this spec planned to reuse the existing Google
service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`,
already used for Calendar) for Drive access too. That was tried and
fails: as of Google's 2022 policy change, service accounts have **no
storage quota** to hold actual file bytes — they can create folders
(free, metadata-only) but uploading a photo fails with
`403 storageQuotaExceeded`. This isn't fixable in our code; it's a
platform constraint. The two ways around it are Shared Drives (a
Google Workspace/paid-business feature — not available on the plain
`corexteriors@gmail.com` consumer account) or **OAuth delegation**:
get one-time consent from a real Google account and upload against
*that account's* quota. This spec now uses OAuth delegation.

## Auth: OAuth delegation to corexteriors@gmail.com

A separate Google Cloud OAuth Client (type: **Desktop app**, so it can
use a loopback redirect without needing a public HTTPS callback URL)
is created in the same Google Cloud project as the existing service
account. A one-time local script performs the OAuth consent flow:
opens an authorization URL, the human signs in as
`corexteriors@gmail.com` and approves Drive access, and the script
exchanges the resulting code for an access + **refresh** token. Only
the refresh token needs to be kept — it's stored as
`GOOGLE_DRIVE_REFRESH_TOKEN` alongside the OAuth client's
`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`, all in
Vercel's Production env vars. Runtime code (`api/_googleDrive.js`)
builds a `google.auth.OAuth2` client from these three values instead
of `google.auth.JWT`; the `googleapis` library auto-refreshes the
access token from the refresh token as needed, so no re-consent is
ever required unless the token is explicitly revoked.

This changes *only* the auth mechanism. Folder structure, KV caching,
and failure isolation (below) are unchanged from the original design.

## Non-goals

- Not replacing Vercel Blob. The app (`labour.html`, `admin.html`)
  keeps reading/displaying photos exactly as today — Blob URLs stored
  in KV job logs, unchanged.
- No backfill of photos uploaded before this change ships. Drive only
  gets photos uploaded going forward.
- No UI changes in `labour.html` or `admin.html`.
- No retry queue or user-visible error if the Drive copy fails — it's
  a best-effort backup, not a system of record.

## One-time setup

Two local, one-off scripts (not deployed, not Vercel functions):

**`scripts/authorize-drive.js`** — performs the OAuth consent flow:
1. Starts a temporary HTTP server on `http://127.0.0.1:53682`.
2. Prints a Google authorization URL (scopes
   `https://www.googleapis.com/auth/drive.file` and
   `https://www.googleapis.com/auth/drive.readonly` — the second was
   added for the separate calendar-attachment-images feature, see
   `docs/superpowers/specs/2026-08-18-calendar-attachment-images-design.md`)
   for the human to open and approve while signed in as
   `corexteriors@gmail.com`.
3. Google redirects back to the loopback server with a code; the
   script exchanges it for tokens and prints the refresh token.

We set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (from
the Google Cloud OAuth Client, created by hand in Cloud Console — see
Task list) and `GOOGLE_DRIVE_REFRESH_TOKEN` (from this script's
output) in Vercel's Production env vars.

**`scripts/setup-drive-folder.js`** — creates the root Drive folder,
now authenticating as `corexteriors@gmail.com` via the refresh token
instead of the service account (it's uploading to that account's own
Drive now, so no separate sharing step is needed — the account already
owns the folder):
1. Creates a root folder named `Core Exteriors – Labour Photos`
   directly in `corexteriors@gmail.com`'s own Drive.
2. Prints the new folder's ID to stdout.

We take that ID and set it as `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Runtime
code never searches for or creates the root folder — it's a fixed,
known ID.

Both scripts are run once by hand after review; neither is part of
the request-handling code path.

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

## Known nuance: `findOrCreateFolder` isn't race-safe under concurrent requests

`findOrCreateFolder` is a check-then-create pattern (query for an
existing folder, create one if not found) with no locking. Confirmed
during smoke testing: firing several rapid automated test uploads to
the same not-yet-existing date/job folder within the same few-hundred
milliseconds produced two duplicate "2026-08-18" folders, because both
requests' existence checks ran before either had committed its create.
Real usage doesn't hit this — a worker taps one upload button at a
time, sequentially, so two requests racing to create the *same*
not-yet-existing folder in the same instant essentially can't happen.
Worst case if it ever did: a harmless duplicate sibling folder, not
data loss (the photo still uploads successfully either way). Not
adding KV-based locking for this — the cost doesn't match a scenario
this unlikely for a best-effort backup feature.

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

- Manually run `scripts/authorize-drive.js` once, approve as
  `corexteriors@gmail.com`, and confirm a refresh token is printed.
  Then run `scripts/setup-drive-folder.js` and confirm the folder
  appears directly in that account's own Drive (no sharing step
  needed — it's the owner).
- After deploying, upload a real before/after/other photo from
  `labour.html` and confirm: (a) it still appears in the app/admin
  exactly as before, (b) it lands in Drive at
  `Core Exteriors – Labour Photos/{date}/{job title}/{Before|After|Other}/`.
- Temporarily break the Drive credentials (or simulate by throwing in
  the Drive branch) and confirm a photo upload still succeeds from the
  worker's point of view — proving the failure isolation actually
  holds.
