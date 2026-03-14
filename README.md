# Open Brain Calendar

This application is built entirely by AI at Sam's begging, pleading, saying "that's wrong" repeatedly, and thanking.

A personal calendar UI backed by the Open Brain Supabase database. Events live in normalized relational tables (`calendar_events`, `locations`) separate from the freeform `thoughts` table. Deployed on Vercel; auth via Supabase email/password.

---

## Quick Start

```bash
npm install
cp .env.example .env   # then fill in the two values below
npm run dev            # http://localhost:5173
```

**`.env` values:**
```
VITE_SUPABASE_URL=https://<yourprojectid>.supabase.co
VITE_SUPABASE_ANON_KEY=<get from Supabase dashboard → Settings → API → anon public>
```

Vite must be restarted (Ctrl+C, then `npm run dev`) after creating or editing `.env`.

---

## Deploy to Vercel

```bash
vercel --prod
```

Set the same two `VITE_SUPABASE_*` environment variables in the Vercel project settings before deploying. Without them the build will succeed but the app will be blank.

---

## Project Structure

```
src/
  App.tsx                  Session check → shows Auth or CalendarView
  main.tsx                 Vite entry point
  index.css                Design tokens + all component styles (single file)

  lib/
    supabase.ts            createClient(url, anonKey) — throws at load if env missing

  types/
    database.ts            TypeScript interfaces: CalendarEvent, CalendarEventWithLocation, Location

  components/
    Auth.tsx               Supabase email/password login (no OAuth)
    CalendarView.tsx       FullCalendar instance + all CRUD logic
    EventModal.tsx         Create/edit form: title, time, all-day, location, recurrence, description
    LocationPicker.tsx     Debounced autocomplete over the locations table; inline create supported

Documentation/
  phase-1-plan.md          Original implementation plan with schema SQL, architecture, and future phases
```

---

## Database Schema

Two tables live alongside the existing `thoughts` table. Both follow the same `user_id` + RLS pattern.

### `locations`
Normalized place names. Referenced by `calendar_events.location_id`.

| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → auth.users, RLS |
| name | TEXT | e.g. "Coffee shop on Main St" |
| address | TEXT | optional |
| notes | TEXT | optional |
| metadata | JSONB | |

### `calendar_events`
Stores both master events and exception overrides in the same table.

| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → auth.users, RLS |
| title | TEXT | |
| start_time | TIMESTAMPTZ | always UTC |
| end_time | TIMESTAMPTZ | nullable |
| all_day | BOOLEAN | if true, time portion of start_time is ignored |
| location_id | UUID | FK → locations, nullable |
| recurrence_rule | TEXT | iCal RRULE string, e.g. `FREQ=WEEKLY;BYDAY=SA` |
| parent_event_id | UUID | FK → self; set on exception/override rows only |
| recurrence_id | TIMESTAMPTZ | original start_time of the overridden occurrence |
| is_cancelled | BOOLEAN | true = occurrence cancelled, still kept as exdate anchor |
| thought_id | UUID | FK → thoughts; Phase 2 semantic search hook |
| metadata | JSONB | `{ source: "ics_import", ical_uid: "..." }` for imported events |

---

## Recurring Event Model

This is the trickiest part of the codebase. Understanding it saves a lot of debugging time.

**Master event:** has `recurrence_rule` set, `parent_event_id` null. The rule is stored verbatim (e.g. `FREQ=WEEKLY;BYDAY=SA`). FullCalendar's rrule plugin expands it on the fly — no expanded rows are ever stored.

**Override row:** a child event inserted when the user edits "this occurrence." Has:
- `parent_event_id` → the master's `id`
- `recurrence_id` → the UTC ISO timestamp of the *original* occurrence being replaced
- its own `title`, `start_time`, etc. reflecting the edit

**Cancelled row:** same as override, but `is_cancelled = true` and no other fields change. Serves as an anchor so the master's rrule expansion knows to skip that date.

**`toFCEvents()` in `CalendarView.tsx`** translates these DB rows into FullCalendar events:
1. Master event → passed as `{ rrule: "DTSTART:...\nRRULE:...", duration: "PT1H", exdate: [...] }`
2. `exdate` = all child rows (both cancelled *and* overrides) mapped via `recurrence_id`. This suppresses the rrule-generated occurrence so it doesn't appear alongside the replacement.
3. Override rows → pushed as separate one-off events inheriting the master's color.
4. Cancelled rows → excluded entirely (only used to build `exdate`).

---

## Timezone Handling

All timestamps are stored as UTC. The UI displays and accepts input in **Eastern Time** (`America/New_York`).

**Timed events:** `utcToEasternInput()` / `easternInputToUTC()` in `EventModal.tsx` handle the round-trip using `date-fns-tz`.

**All-day events:** these are stored as UTC midnight (e.g. `2026-03-21T00:00:00Z`). Do **not** apply timezone conversion to them — `T00:00Z → T19:00 ET` would shift the displayed date back by one day. The `toInputDT(isoStr, isAllDay)` helper in `EventModal.tsx` short-circuits for all-day events and takes the date portion as-is.

FullCalendar is configured with `timeZone="America/New_York"`. For all-day events it returns date-only strings (`"2026-03-21"`) from `startStr`, not datetime strings.

---

## MCP Tools

Three calendar tools were added to the `open-brain-mcp` Edge Function in the `open-brain` repo:

| Tool | Description |
|---|---|
| `list_upcoming_events` | Events in next N days (default 7), with location |
| `get_events_for_date` | All events on a given `YYYY-MM-DD` date |
| `search_events` | ilike search across title + description |

Ask Claude Code or Claude Desktop: *"What do I have coming up this week?"* or *"When is my next dentist appointment?"*

---

## ICS Import

One-time import of a Google Calendar (or any) `.ics` export into the database:

```bash
# In the open-brain repo:
cd ../open-brain
npm install @supabase/supabase-js node-ical   # first time only
SUPABASE_SERVICE_KEY=<service_role_key> \
  node import-calendar-structured.mjs path/to/calendar.ics <USER_ID>
```

The service role key bypasses RLS and is required for bulk import. Get it from Supabase dashboard → Settings → API → `service_role` (secret). Get your user ID from Authentication → Users.

---

## Adding Future Features

The schema was designed with these phases in mind. See `Documentation/phase-1-plan.md` for full SQL.

- **Contacts + event attendees** — `contacts` table + `event_attendees` junction; enables "last time I met with X" queries
- **Tasks with prerequisites** — `tasks` table + `task_dependencies` DAG; `linked_event_id` lets deadlines cascade when events are rescheduled
- **Telegram calendar management** — new intent types in `ingest-thought`; already works via MCP today
- **Semantic search** — `calendar-embed` Edge Function writes event summaries to `thoughts` and stores `thought_id` back on the event row

All new tables should follow the same pattern: `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` with a matching RLS policy and `set_updated_at()` trigger.
