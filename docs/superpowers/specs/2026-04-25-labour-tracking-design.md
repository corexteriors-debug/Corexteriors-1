# Labour Tracking System — Design Spec
**Date:** 2026-04-25
**Project:** Core Exteriors (corexteriors.ca)

---

## Overview

A mobile-first labour management system that lets each worker sign in with a personal PIN, view their day's jobs from the Google Calendar, track time (day, job, and lunch), and upload job completion photos. All activity is visible to the admin in a new "Labour" tab in the existing admin dashboard. No email notifications — dashboard only.

---

## Scope

**In scope:**
- Per-worker PIN login at `corexteriors.ca/labour`
- Today's jobs pulled from existing Google Calendar integration
- Three-layer time tracking: day clock-in/out, per-job clock-in/out, lunch out/in
- Multiple photo uploads per job (stored in Vercel Blob)
- Admin Labour tab: worker management + daily activity viewer

**Out of scope:**
- Email notifications
- Worker self-registration
- Payroll calculations
- Historical reporting beyond date picker

---

## Files

### New
| File | Purpose |
|------|---------|
| `labour.html` | Mobile-first worker portal (PIN login + daily work screen) |
| `api/labour.js` | Worker account CRUD + time log read/write |
| `api/labour-photo.js` | Photo upload handler → Vercel Blob |

### Modified
| File | Change |
|------|--------|
| `admin.html` | Add "Labour" tab with worker management + daily activity panels |
| `api/auth.js` | Add PIN verification endpoint for workers |

---

## Data Storage

### Vercel KV (existing service)

**Worker accounts:**
```
worker:{workerId}   →  { id, name, pin, active: true }
workers:index       →  [ workerId, workerId, ... ]
```
- `workerId` is a short UUID generated on creation
- PIN is a 4-digit string stored as plaintext (low-sensitivity internal tool)
- `active` flag allows deactivating without deleting

**Daily time logs:**
```
labour:{YYYY-MM-DD}:{workerId}  →  {
  dayClockIn:   "HH:MM",
  dayClockOut:  "HH:MM" | null,
  lunchOut:     "HH:MM" | null,
  lunchIn:      "HH:MM" | null,
  jobs: [
    {
      calendarEventId: string,
      jobTitle:        string,
      clockIn:         "HH:MM",
      clockOut:        "HH:MM" | null,
      photos:          string[]   // Vercel Blob URLs
    }
  ]
}
```

### Vercel Blob (new, no extra account needed)

**Photo path structure:**
```
labour/{YYYY-MM-DD}/{workerId}/{calendarEventId}/{timestamp}.jpg
```

---

## API Endpoints

### `api/labour.js`
| Method | Action | Auth |
|--------|--------|------|
| `POST /api/labour?action=verify-pin` | Verify PIN, return worker name | None |
| `GET /api/labour?action=workers` | List all workers | Admin token |
| `POST /api/labour?action=add-worker` | Create worker (name + PIN) | Admin token |
| `POST /api/labour?action=delete-worker` | Deactivate worker | Admin token |
| `POST /api/labour?action=log` | Write time event (clockIn, clockOut, lunch, etc.) | Worker PIN |
| `GET /api/labour?action=daily&date=YYYY-MM-DD` | Get all worker logs for a date | Admin token |

### `api/labour-photo.js`
| Method | Action | Auth |
|--------|--------|------|
| `POST /api/labour-photo` | Upload photo to Vercel Blob, return URL, append to job log | Worker PIN |

---

## Worker Mobile Portal (`labour.html`)

### Screen 1 — PIN Login
- Core Exteriors logo
- Large numpad (0–9), 4-digit PIN entry
- Identifies worker by PIN alone (no username)
- Error state on wrong PIN

### Screen 2 — Home (Today's Jobs)
- Worker name + today's date
- **Clock In for Day** button (green when active → becomes **Clock Out for Day**)
- List of today's calendar events: address, service type, scheduled time
- No pricing shown anywhere
- Tap a job → Screen 3

### Screen 3 — Job Detail
- Job address, service type, notes (no price)
- **Clock In to Job** → **Clock Out of Job**
- **Start Lunch** / **End Lunch** (available while clocked into a job)
- **Upload Photos** (camera + library, multiple, shows thumbnails)
- Submit locks the job as complete
- Back arrow → Screen 2

---

## Admin Labour Tab (`admin.html`)

### Worker Management Panel
- Table: Name | PIN (masked as ••••) | Status badge | Actions
- **Add Worker** form: name + 4-digit PIN
- Deactivate button per worker

### Daily Activity Panel
- Date picker (defaults to today)
- One row per worker: Name | Day In | Lunch Out | Lunch In | Day Out | Total Hours
- Expandable per-job rows: Job Name | Job In | Job Out | Duration | Photo thumbnails
- Click thumbnail → full-size photo lightbox
- Status badges:
  - 🟢 Clocked in for day
  - 🟡 On lunch
  - 🔵 On a job
  - ⚫ Not started or done

---

## Security Notes

- Worker PIN auth is intentionally lightweight (internal tool, not customer-facing)
- Admin actions (add/delete workers, view logs) require existing admin Bearer token
- Photos stored in Vercel Blob with non-guessable paths (UUID + timestamp)
- No worker can see another worker's data — each session is PIN-scoped

---

## Dependencies

| Service | Usage | Already configured? |
|---------|-------|-------------------|
| Vercel KV | Worker accounts + time logs | Yes |
| Vercel Blob | Photo storage | No — needs `BLOB_READ_WRITE_TOKEN` env var |
| Google Calendar API | Today's job list | Yes (`api/calendar.js`) |
| Existing admin auth | Admin tab protection | Yes |
