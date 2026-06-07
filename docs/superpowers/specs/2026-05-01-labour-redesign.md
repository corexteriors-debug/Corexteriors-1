# Labour Section Redesign — Core Exteriors
**Date:** 2026-05-01  
**Repo:** corexteriors-debug/Corexteriors-1  
**Files affected:** `labour.html`, `api/labour.js`, `admin.html`

---

## Context

The existing labour section provides basic PIN-based clock-in/out for field workers, but it has several UX gaps that create friction for crews working on-site:

- A single clock-in/clock-out per day means workers can't log lunch breaks or mid-day departures without admin intervention
- Workers can only see today's jobs — they have no visibility into the rest of the week
- Jobs are shown as assigned per-worker, but in practice the whole crew works the same schedule
- There is no job detail screen — workers can't see addresses, notes, materials, or tasks from their phone
- No weather, no navigation, no before/after photos tied to a job

**Goal:** Rebuild the worker-facing labour portal to be genuinely useful on-site — covering the full day from arrival to sign-off.

---

## Design Decisions

### 1. Multi-Punch Clock In/Out

**Replace** the single `dayClockIn` / `dayClockOut` / `lunchIn` / `lunchOut` fields with a `punches[]` array.

Each punch: `{ in: <timestamp>, out: <timestamp> | null }`

- Workers can clock in and out as many times as needed throughout the day
- Lunch is just a clock-out + clock-in — no separate lunch button
- Total hours = sum of all completed `(out - in)` durations for the day
- Admin can view and edit individual punches via the existing `edit-log` endpoint (extend to support punch index)

**UI:** One large toggle button on the home screen:
- Green **CLOCK IN** when worker is off-site
- Red **CLOCK OUT** when worker is on-site
- Punch timeline below showing every in/out pair with duration for the day
- Total hours auto-calculated and shown at bottom of timeline

### 2. Shared Company-Wide Schedule (No Per-Worker Job Assignment)

All workers see the **same week schedule** — not individually assigned jobs.

- The week view pulls from the existing Google Calendar + manual `labour-jobs:{date}` KV store
- No changes needed to job storage — remove the concept of "assigned workers" from the worker-facing view
- Workers see all jobs for each day of the week; they clock against whichever job they're physically on

### 3. Tab Layout: Today / My Week

**Today tab (home)**
- Weather strip (temp, rain chance, city) — fetched from a free weather API (wttr.in or Open-Meteo) using the browser's geolocation
- Worker name + live status badge (● ACTIVE / ● OFF SITE)
- Large clock in/out toggle button with current session time
- Punch timeline for the day
- Quick actions row: 📸 Photo · 🏁 Job Done · ⚠️ Report
- Hours summary: today total + week total

**My Week tab**
- Mon–Sun grid, today highlighted and scrolled into view
- Each day: date label + list of job names for that day
- Past days show hours logged (greyed); future days show job count
- Tap any day to expand and see jobs; tap a job to open Job Detail

### 4. Job Detail Page

Accessible by tapping any job from the week view or today's job card.

| Section | Content |
|---|---|
| 📍 Navigate | Address as tappable link → opens Google Maps |
| 👷 Crew on site | Workers who have clocked in today (pulled live from KV) |
| 📋 Customer notes | Gate codes, parking, special instructions (admin-set) |
| 🧱 Materials | List of supplies needed for this job (admin-set) |
| ✅ Task checklist | Items admin created; workers tick off on-site |
| 📸 Photos | Camera button — before/after shots tagged to this job + date |

---

## Data Model Changes

### `labour:{date}:{workerId}` (existing, extended)

```
Before:
  dayClockIn, dayClockOut, lunchIn, lunchOut, jobs[]

After:
  punches: [{ in: timestamp, out: timestamp|null }, ...]
  jobs: [{ jobId, clockIn, clockOut, photos[], completedTasks[] }]
```

### `labour-jobs:{date}` (existing, extended)

Add optional fields per job entry:
```
{
  id, title, description, start, end,
  address,          // NEW — for Maps link
  notes,            // NEW — customer/site notes
  materials: [],    // NEW — supply list
  tasks: []         // NEW — checklist items
}
```

---

## API Changes (`api/labour.js`)

| Action | Change |
|---|---|
| `clock-in` | Append `{ in: now, out: null }` to `punches[]` instead of setting `dayClockIn` |
| `clock-out` | Set `out: now` on the last open punch in `punches[]` |
| `get-day` | Return full `punches[]` array + calculated `totalMinutes` |
| `complete-task` | Mark a task index as done within the job's `completedTasks[]` |
| `crew-status` | NEW — return list of workers currently clocked in today (for Job Detail crew view) |
| `edit-log` | Extend to accept `punchIndex` for editing individual punch times |

Backward compatibility: if a log has legacy `dayClockIn`/`dayClockOut` fields, treat them as a single punch on read.

---

## Admin Changes (`admin.html`)

The Labour tab in admin needs:
1. **Job detail fields** — when creating/editing a manual job, add fields for: address, customer notes, materials (textarea), tasks (add/remove list)
2. **Punch-aware timesheet view** — daily log viewer shows `punches[]` timeline instead of single in/out pair
3. **Edit punch** — admin can click any punch time to correct it

---

## Files to Modify

| File | What changes |
|---|---|
| `labour.html` | Full UI rebuild: tab layout, toggle button, punch timeline, week view, job detail page |
| `api/labour.js` | clock-in/out rewritten for punches array; new `crew-status` and `complete-task` actions; job fields extended |
| `admin.html` | Job creation form extended; timesheet viewer updated for punches |

---

## Verification

1. Worker clocks in → punch timeline shows one open entry
2. Worker clocks out (lunch) → punch closes, total updates
3. Worker clocks back in → new punch opens
4. Week tab shows all jobs for the week (same for every worker)
5. Tapping a job opens detail with address, notes, materials, checklist
6. Admin sees full punch timeline in daily log view and can edit individual punches
7. Legacy logs (single in/out) still display correctly
