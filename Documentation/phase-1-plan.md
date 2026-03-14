# Plan: Calendar Feature for Open Brain

## Context

The user wants a personal calendar UI backed by their Open Brain's Supabase database. Events, locations, and attendees (phase 1) should live in structured, normalized tables — not the `thoughts` table — because they require reliable relational queries (date ranges, location lookups, future joins to contacts/tasks). The `thoughts` table is intentionally unstructured; calendar data is not. The two can coexist: a nullable `thought_id` column on `calendar_events` creates a forward hook for semantic search once that's desired.

Phase 1 covers: schema + RLS, calendar UI (React + FullCalendar on Vercel, Supabase email/password Auth), and new MCP tools for reading calendar data. Contacts, tasks, and cascading-deadline logic are deferred but the schema is designed so they attach cleanly later.

---

## Architecture

```
Vercel (React + FullCalendar + Supabase Auth)
    ↓ anon key + user JWT (RLS enforced)
Supabase PostgreSQL
    ├── calendar_events
    ├── locations
    └── thoughts

open-brain-mcp Edge Function (existing)
    └── + 3 new calendar tools (SQL queries, no embeddings)
```

No new Edge Function is needed for phase 1. The frontend calls Supabase directly using the standard anon key + Auth pattern. A `calendar-embed` Edge Function (to write event summaries into `thoughts` for semantic search) is a named future step, not phase 1.

---

## Step 1: Database Migration

Run via the Supabase Management API (same `curl` pattern used in existing setup):

```sql
-- ─────────────────────────────────────────────
-- Trigger helper (reusable for all new tables)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- Locations
-- ─────────────────────────────────────────────
CREATE TABLE locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  notes       TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX locations_user_id_idx ON locations(user_id);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own locations" ON locations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER locations_updated_at
  BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- Calendar Events
-- ─────────────────────────────────────────────
CREATE TABLE calendar_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ,
  all_day           BOOLEAN NOT NULL DEFAULT false,
  location_id       UUID REFERENCES locations(id) ON DELETE SET NULL,

  -- Recurrence (iCal RRULE format — e.g. "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10")
  -- Storing the rule (not expanded rows) is the same pattern used by Google Calendar,
  -- Apple Calendar, and Outlook. Frontend expands occurrences via rrule.js.
  recurrence_rule   TEXT,

  -- Exception handling: to edit or cancel one occurrence of a recurring series,
  -- insert a child row with parent_event_id → master, recurrence_id → the original
  -- start_time of that occurrence. The master event and all other siblings are untouched.
  parent_event_id   UUID REFERENCES calendar_events(id) ON DELETE CASCADE,
  recurrence_id     TIMESTAMPTZ,   -- maps directly to iCal RECURRENCE-ID property
  is_cancelled      BOOLEAN NOT NULL DEFAULT false,

  -- Forward hook: when calendar-embed is built (Phase 2), this links to the
  -- thoughts row so events are semantically searchable via search_thoughts MCP tool.
  thought_id        UUID REFERENCES thoughts(id) ON DELETE SET NULL,

  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX calendar_events_user_id_idx       ON calendar_events(user_id);
CREATE INDEX calendar_events_start_time_idx    ON calendar_events(start_time);
CREATE INDEX calendar_events_parent_event_idx  ON calendar_events(parent_event_id);
CREATE INDEX calendar_events_metadata_idx      ON calendar_events USING gin(metadata);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own events" ON calendar_events
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Why `user_id` on every table:** Single-user today, multi-user safe forever. RLS uses it. All future tables (contacts, tasks) follow the same pattern.

---

## Step 2: Supabase Auth Setup

In the Supabase dashboard → Authentication → Providers:
- **Email** — enable. Disable "Confirm email" for personal use, or leave on.

No Google or other OAuth providers are needed.

---

## Step 3: Calendar UI — New Repo

**Location:** `../dev/open-brain-calendar/` (separate repo, deploy to Vercel)

**Stack:**
- Vite + React + TypeScript
- `@fullcalendar/react` + `@fullcalendar/daygrid` + `@fullcalendar/timegrid` + `@fullcalendar/interaction` + `@fullcalendar/rrule` (MIT licensed core)
- `rrule` — parse and expand RRULE strings
- `@supabase/supabase-js` + `@supabase/auth-ui-react` — data + auth
- `date-fns` — date formatting

**Environment variables (Vercel + local `.env`):**
```
VITE_SUPABASE_URL=https://zbwxlfbalsrjvkuaxgog.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase dashboard → Settings → API>
```

**File structure:**
```
src/
  lib/
    supabase.ts        ← createClient(url, anonKey)
  types/
    database.ts        ← CalendarEvent, Location TypeScript interfaces
  components/
    Auth.tsx           ← <Auth /> from @supabase/auth-ui-react, wraps app
    CalendarView.tsx   ← FullCalendar instance; fetches events, handles CRUD
    EventModal.tsx     ← Create/edit event form (title, time, location, recurrence)
    LocationPicker.tsx ← Autocomplete over locations table
  App.tsx              ← Session check → Auth or CalendarView
  main.tsx
```

**FullCalendar configuration (key props):**
```tsx
<FullCalendar
  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
  initialView="dayGridMonth"       // default: month view
  timeZone="America/New_York"      // default: Eastern Time
  headerToolbar={{
    left: "prev,next today",
    center: "title",
    right: "dayGridMonth,timeGridWeek,timeGridDay"
  }}
  // ...event fetch, click, and drop handlers
/>
```

**Key behavior in `CalendarView.tsx`:**
- On mount: fetch `calendar_events` for visible date range from Supabase
- Pass RRULE events to FullCalendar's `rrule` plugin — it handles expansion automatically
- For exception rows (child events with `parent_event_id` set): fetch alongside master events
- On event click: open `EventModal` in edit mode; show "Edit this event / Edit all future / Edit entire series" for recurring events
- On drag-and-drop: update `start_time`/`end_time`; for recurring series, create a child exception row unless "edit entire series" was chosen
- On delete: same three-way choice; single occurrence → insert `is_cancelled = true` child row; entire series → delete master

**`EventModal.tsx` fields:**
- Title (required)
- Start/end datetime pickers (or all-day toggle)
- Location (search existing or create new inline)
- Description
- Recurrence rule (human-readable selector: None / Daily / Weekly / Monthly / Custom RRULE)

---

## Step 4: ICS Import Script

The schema mirrors iCal structure directly:
- `recurrence_rule` ← `RRULE:` property (stored verbatim)
- `recurrence_id` ← `RECURRENCE-ID:` property
- `parent_event_id` ← resolved by matching `RECURRENCE-ID` to a master event's `UID`
- `all_day` ← `DTSTART;VALUE=DATE` (no time component)
- `location_id` ← `LOCATION:` field → create or match a `locations` row

**Import script** (`import-calendar-structured.mjs` in the `open-brain` repo):
- ICS parser: `node-ical` npm package
- Supabase service role key (bypasses RLS during bulk import)
- Two-pass strategy: pass 1 inserts master events, pass 2 resolves exception rows using UID → id map

---

## Step 5: MCP Tool Additions to `open-brain-mcp`

**File:** `supabase/functions/open-brain-mcp/index.ts`

Three new tools added using exact existing patterns:

1. **`list_upcoming_events`** — events in next N days with location, sorted by start_time
2. **`get_events_for_date`** — all events on a given YYYY-MM-DD date
3. **`search_events`** — full-text ilike search across title + description

All use service role key (same as existing tools). Redeploy after adding.

---

## Future Extension Points

### Contacts
```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT, phone TEXT,
  current_employer TEXT,
  previous_employers TEXT[],   -- native Postgres array, no join table needed
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_attendees (
  event_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  role TEXT,
  PRIMARY KEY (event_id, contact_id)
);
```

### Tasks with prerequisites
```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT, due_date TIMESTAMPTZ,
  linked_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DAG: task_id cannot start until prerequisite_task_id is done
CREATE TABLE task_dependencies (
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  prerequisite_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, prerequisite_task_id)
);
```

### Chatbot → Calendar
Natural language calendar management via Telegram requires new intent types in `ingest-thought` (`calendar_update`, `calendar_create`, `calendar_search`) and new handlers. **Immediately available via MCP** once tools are built — ask Claude Code/Desktop "move my meeting with Dexter to next Tuesday."

### Semantic search (`thought_id` hook)
`calendar-embed` Edge Function writes event summary to `thoughts`, stores returned `thought_id` on the event row. Then `search_thoughts` in MCP surfaces events alongside other memories.

---

## Verification Checklist

1. Run migration → verify tables in Supabase Table Editor with correct columns, indexes, RLS policies
2. Open Vercel URL → verify login screen → sign in → calendar loads in month view, Eastern Time
3. Create event → verify row in Table Editor with correct `user_id`, `start_time`, `title`
4. Create weekly recurring event → verify multiple occurrences in UI → edit one occurrence → verify child row created with `parent_event_id` set, master row unchanged
5. Run ICS import script → verify rows with correct RRULE strings preserved verbatim
6. Ask Claude Code "what's coming up this week?" → verify MCP tools return calendar events
7. Test RLS: anon key without auth returns 0 rows; valid JWT returns user's rows only
