# Week tab: show next Monday for planning ahead

## Problem

The worker-facing Week tab in `labour.html` shows the current ISO week
(Monday–Sunday) computed from today's date. On Friday, Saturday, or
Sunday, the list ends at the current week's Sunday and never reaches
next Monday — workers can't see next Monday's job until the week rolls
over, which makes it hard to plan for it in advance.

## Change

`weekDates(dateStr)` in `api/labour.js` returns 7 dates (Mon–Sun of the
week containing `dateStr`). It will return 8 dates: the same 7, plus
the following Monday — unconditionally, every day of the week, not
just near the end of the week. A fixed-length list is simpler than
branching on day-of-week, and one extra row is harmless even on a
Monday.

`weekJobs()` builds `days[]` from `weekDates()` as before (one entry
per date, each with its own `jobs` and `totalMinutes`). The 8th entry
(next Monday) is included in `days[]` so it renders like any other day,
but excluded from `weekTotalMinutes` — that stat represents hours
worked in the current calendar week, and the extra day isn't part of
this week.

## Frontend

No changes to `labour.html` rendering. `renderWeekList()` already
iterates `weekDays` generically and renders one row per entry; an 8th
entry just appears as one more row at the bottom, labeled with its own
weekday/date like every other row (no "Next Week" divider — the date
label already makes it clear which Monday it is).

## Out of scope

- No date navigation UI (prev/next week paging) — that's a bigger
  feature than "let me see next Monday" and isn't part of this change.
- No change to `todayJobs()` or the Home tab.
- No change to how `weekTotalMinutes` / "This Week" hours are computed
  for the original 7 days.
