// Supabase operations for the `calendar_events`, `calendar_event_calendars`,
// and `locations` tables. No React — pure async functions.

import { supabase } from '../lib/supabase'
import type { CalendarEventWithLocation, CalendarEventInsert } from '../types/database'

const PAGE = 1000

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Load all calendar events with pagination.
 * Supabase caps a single request at 1 000 rows by default; users with many events
 * (e.g. large recurring series + exceptions) would silently lose rows without this.
 */
export async function loadEvents(): Promise<{ events: CalendarEventWithLocation[]; error: string | null }> {
  let allEvents: CalendarEventWithLocation[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*, locations(id, name, address)')
      .order('start_time', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) return { events: [], error: error.message }
    if (!data || data.length === 0) break
    allEvents = allEvents.concat(data as CalendarEventWithLocation[])
    if (data.length < PAGE) break  // last page
    from += PAGE
  }

  return { events: allEvents, error: null }
}

/**
 * Fetch master events belonging to a calendar plus their child exception rows.
 * Returns null if the calendar has no events (for export flow).
 */
export async function fetchEventsForCalendar(calendarId: string): Promise<{
  masterEvents: CalendarEventWithLocation[]
  allEvents:    CalendarEventWithLocation[]
} | null> {
  const { data: links } = await supabase
    .from('calendar_event_calendars')
    .select('event_id')
    .eq('calendar_id', calendarId)

  if (!links || links.length === 0) return null

  const eventIds = (links as { event_id: string }[]).map(l => l.event_id)

  const [mastersResult, childrenResult] = await Promise.all([
    supabase
      .from('calendar_events')
      .select('*, locations(id, name, address)')
      .in('id', eventIds),
    supabase
      .from('calendar_events')
      .select('*, locations(id, name, address)')
      .in('parent_event_id', eventIds),
  ])

  const masterEvents = (mastersResult.data ?? []) as CalendarEventWithLocation[]
  if (masterEvents.length === 0) return null

  return {
    masterEvents,
    allEvents: [
      ...masterEvents,
      ...((childrenResult.data ?? []) as CalendarEventWithLocation[]),
    ],
  }
}

// ─── Location ─────────────────────────────────────────────────────────────────

/** Create a new location row and return its id */
export async function createLocation(userId: string, name: string): Promise<string> {
  const { data, error } = await supabase
    .from('locations')
    .insert({ user_id: userId, name })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// ─── Event CRUD ───────────────────────────────────────────────────────────────

/** Create a new calendar event row and return the new id */
export async function createEvent(payload: CalendarEventInsert): Promise<string> {
  const { data, error } = await supabase
    .from('calendar_events')
    .insert(payload)
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/** Update an existing calendar event */
export async function updateEvent(
  eventId: string,
  payload: Partial<CalendarEventInsert>
): Promise<void> {
  const { error } = await supabase
    .from('calendar_events')
    .update(payload)
    .eq('id', eventId)
  if (error) throw error
}

/** Delete a calendar event entirely (cascades to child exception rows via FK) */
export async function deleteEvent(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('calendar_events')
    .delete()
    .eq('id', eventId)
  if (error) throw error
}

// ─── Recurrence exception helpers ─────────────────────────────────────────────

/**
 * Insert a cancelled child row to suppress one rrule occurrence.
 * The master's rrule will skip dates that have a matching cancelled exception row.
 */
export async function cancelOccurrence(
  userId: string,
  parentId: string,
  recurrenceId: string,
  title: string,
  allDay: boolean
): Promise<void> {
  const { error } = await supabase.from('calendar_events').insert({
    user_id:          userId,
    title,
    start_time:       recurrenceId,
    all_day:          allDay,
    parent_event_id:  parentId,
    recurrence_id:    recurrenceId,
    is_cancelled:     true,
  })
  if (error) throw error
}

/**
 * Flip is_cancelled = true on an existing override row.
 * We must NOT delete the row — that would remove the recurrence_id anchor and let
 * the master's rrule regenerate the original occurrence.
 */
export async function cancelOverride(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('calendar_events')
    .update({ is_cancelled: true })
    .eq('id', eventId)
  if (error) throw error
}

/**
 * Create a drag-and-drop exception row for one occurrence of a recurring event.
 * Returns the new row's id so calendar memberships can be copied to it.
 */
export async function dropRecurringOccurrence(
  userId: string,
  dbEvent: CalendarEventWithLocation,
  originalStart: string,
  newStart: string,
  newEnd: string | null
): Promise<string> {
  const { data: newRow, error } = await supabase
    .from('calendar_events')
    .insert({
      user_id:         userId,
      title:           dbEvent.title,
      description:     dbEvent.description,
      start_time:      newStart,
      end_time:        newEnd,
      all_day:         dbEvent.all_day,
      location_id:     dbEvent.location_id,
      parent_event_id: dbEvent.parent_event_id ?? dbEvent.id,
      recurrence_id:   originalStart,
      is_cancelled:    false,
    })
    .select('id')
    .single()
  if (error) throw error
  return newRow.id
}

// ─── Calendar memberships ─────────────────────────────────────────────────────

/** Replace all calendar memberships for an event (delete existing, insert new) */
export async function saveCalendarMemberships(
  eventId: string,
  calendarIds: string[],
  userId: string
): Promise<void> {
  await supabase.from('calendar_event_calendars').delete().eq('event_id', eventId)
  if (calendarIds.length > 0) {
    const { error } = await supabase.from('calendar_event_calendars').insert(
      calendarIds.map(calId => ({ event_id: eventId, calendar_id: calId, user_id: userId }))
    )
    if (error) throw error
  }
}

/** Copy calendar memberships from a parent event to a child exception row */
export async function copyCalendarMemberships(
  fromEventId: string,
  toEventId: string,
  userId: string,
  calendarIdsMap: Map<string, string[]>
): Promise<void> {
  const parentCalIds = calendarIdsMap.get(fromEventId) ?? []
  if (parentCalIds.length === 0) return
  await supabase.from('calendar_event_calendars').insert(
    parentCalIds.map(calId => ({ event_id: toEventId, calendar_id: calId, user_id: userId }))
  )
}
