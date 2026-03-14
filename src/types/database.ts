// TypeScript types mirroring the Supabase database schema.
// Update these if you add columns to the tables.

// The Supabase JS client requires Database['public'] to satisfy its internal
// GenericSchema interface, which expects Tables, Views, Functions, and Enums,
// and a Relationships array on every table entry. Without these, TypeScript
// can't resolve the Insert/Update generics and collapses them to `never`.
export interface Database {
  public: {
    Tables: {
      calendar_events: {
        Row: CalendarEvent
        Insert: CalendarEventInsert
        Update: CalendarEventUpdate
        Relationships: []
      }
      locations: {
        Row: Location
        Insert: LocationInsert
        Update: LocationUpdate
        Relationships: []
      }
    }
    Views:     { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums:     { [_ in never]: never }
  }
}

// ─── Calendar Events ───────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string
  user_id: string
  title: string
  description: string | null
  start_time: string          // ISO 8601 UTC
  end_time: string | null     // ISO 8601 UTC
  all_day: boolean
  location_id: string | null
  recurrence_rule: string | null  // RRULE string e.g. "FREQ=WEEKLY;BYDAY=MO"
  parent_event_id: string | null  // set on exception/override rows
  recurrence_id: string | null    // original start_time of the overridden occurrence
  is_cancelled: boolean
  thought_id: string | null       // future: link to thoughts table for semantic search
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// Only truly required fields (NOT NULL, no DB default) are mandatory.
// Everything else is optional — nullable columns can be omitted, and columns
// with DB defaults (all_day, is_cancelled, metadata) don't need to be supplied.
export type CalendarEventInsert = {
  id?:               string
  user_id:           string           // required
  title:             string           // required
  start_time:        string           // required
  description?:      string | null
  end_time?:         string | null
  all_day?:          boolean          // DB default: false
  location_id?:      string | null
  recurrence_rule?:  string | null
  parent_event_id?:  string | null
  recurrence_id?:    string | null
  is_cancelled?:     boolean          // DB default: false
  thought_id?:       string | null
  metadata?:         Record<string, unknown>  // DB default: {}
}

export type CalendarEventUpdate = Partial<CalendarEventInsert>

// CalendarEvent with location joined in (from Supabase .select('*, locations(...)'))
export interface CalendarEventWithLocation extends CalendarEvent {
  locations: Pick<Location, 'id' | 'name' | 'address'> | null
}

// ─── Locations ────────────────────────────────────────────────────────────────

export interface Location {
  id: string
  user_id: string
  name: string
  address: string | null
  notes: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type LocationInsert = {
  id?:       string
  user_id:   string   // required
  name:      string   // required
  address?:  string | null
  notes?:    string | null
  metadata?: Record<string, unknown>  // DB default: {}
}

export type LocationUpdate = Partial<LocationInsert>
