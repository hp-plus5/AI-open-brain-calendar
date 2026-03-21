// Transform database event rows into FullCalendar EventInput objects.
// No React imports — pure functions only.

import type { EventInput } from '@fullcalendar/core'
import type { CalendarEventWithLocation, Calendar } from '../types/database'
import { toFullCalendarLocalTimestamp, getDuration } from './timezone'

// ─── Calendar membership ──────────────────────────────────────────────────────

/**
 * Get the effective calendar IDs for an event.
 * Exception and override rows fall back to the parent's calendars if they have
 * no memberships of their own.
 */
export function getEventCalendarIds(
  event: CalendarEventWithLocation,
  map:   Map<string, string[]>
): string[] {
  const ownCalendarIds = map.get(event.id) ?? []
  if (ownCalendarIds.length > 0) return ownCalendarIds
  if (event.parent_event_id) return map.get(event.parent_event_id) ?? []
  return []
}

// ─── Main transformer ─────────────────────────────────────────────────────────

/**
 * Transform CalendarEvent rows from the database into FullCalendar EventInput
 * objects. Colors each event by its first associated calendar. Events whose
 * every calendar is hidden are excluded from the output.
 */
export function toFullCalendarEvents(
  dbEvents:          CalendarEventWithLocation[],
  calendars:         Calendar[],
  eventCalendarsMap: Map<string, string[]>,
  hiddenCalendarIds: Set<string>
): EventInput[] {
  // Split master events from their exception/override children
  const masterEvents = dbEvents.filter(event => !event.parent_event_id)
  const exceptions   = dbEvents.filter(event => !!event.parent_event_id)

  // Index exception rows by their parent event ID for fast lookup
  const exceptionsByParent = new Map<string, CalendarEventWithLocation[]>()
  for (const exception of exceptions) {
    const parentId = exception.parent_event_id!
    if (!exceptionsByParent.has(parentId)) exceptionsByParent.set(parentId, [])
    exceptionsByParent.get(parentId)!.push(exception)
  }

  const fullCalendarEvents: EventInput[] = []

  for (const event of masterEvents) {
    // Visibility: hide the event only if every one of its calendars is hidden
    const calendarIds = getEventCalendarIds(event, eventCalendarsMap)
    const isVisible   = calendarIds.length === 0 || calendarIds.some(id => !hiddenCalendarIds.has(id))
    if (!isVisible) continue

    const firstCalendar  = calendars.find(calendar => calendarIds.includes(calendar.id))
    const backgroundColor = firstCalendar?.color ?? '#3b82f6'

    const children   = exceptionsByParent.get(event.id) ?? []
    const cancelled  = children.filter(child => child.is_cancelled)
    const overrides  = children.filter(child => !child.is_cancelled)

    // Base fields shared by both recurring and non-recurring events
    const base: EventInput = {
      id:              event.id,
      title:           event.title,
      allDay:          event.all_day,
      backgroundColor,
      borderColor:     backgroundColor,
      extendedProps:   { dbEvent: event },
    }

    if (event.recurrence_rule) {
      // For all-day events: compact date YYYYMMDD (rrule.js parses this correctly
      // and FullCalendar's regex matches DTSTART: prefix for all-day detection).
      // For timed events: floating Eastern datetime (no Z) so FullCalendar treats it
      // as local New_York wall-clock time, not UTC.
      const dtstart = event.all_day
        ? event.start_time.slice(0, 10).replace(/-/g, '')
        : toFullCalendarLocalTimestamp(event.start_time)

      // Sanitize the stored recurrence rule: strip any leading "RRULE:" prefix and any
      // embedded DTSTART lines (both can appear in calendar file-imported data and would corrupt
      // the string we build below, e.g. producing "RRULE:RRULE:FREQ=..." which rrule.js
      // cannot parse).
      const rawRecurrenceRule = event.recurrence_rule
        .split('\n')
        .map(line => line.trim())
        .filter(line => !line.startsWith('DTSTART'))
        .join('\n')
        .replace(/^RRULE:/i, '')

      // Embed EXDATEs directly in the iCal string rather than using the separate
      // `exdate` array property on the FullCalendar event. FullCalendar's own regex
      // for parsing the exdate property has bugs with all-day events; passing them
      // inline lets rrulestr parse them natively.
      // Note: use EXDATE:YYYYMMDD (not EXDATE;VALUE=DATE:) — rrule.js has the same
      // VALUE=DATE parsing bug as DTSTART; the compact format works correctly.
      const exdateLines = [...cancelled, ...overrides]
        .map(child => child.recurrence_id)
        .filter((recurrenceId): recurrenceId is string => !!recurrenceId)
        .map(recurrenceId => event.all_day
          ? `EXDATE:${recurrenceId.slice(0, 10).replace(/-/g, '')}`
          : `EXDATE:${toFullCalendarLocalTimestamp(recurrenceId)}`)

      // Note: DTSTART;VALUE=DATE: is silently broken in rrule.js — it ignores the
      // date part and falls back to new Date(). DTSTART:YYYYMMDD (no VALUE=DATE)
      // is parsed correctly for both all-day and timed events.
      const recurrenceRuleString = exdateLines.length > 0
        ? `DTSTART:${dtstart}\nRRULE:${rawRecurrenceRule}\n${exdateLines.join('\n')}`
        : `DTSTART:${dtstart}\nRRULE:${rawRecurrenceRule}`

      console.debug(
        `[FullCalendar rrule] "${event.title}" all_day=${event.all_day} start_time=${event.start_time}\n` +
        `  raw recurrence_rule: ${event.recurrence_rule}\n` +
        `  cancelled rows (recurrence_id): ${cancelled.map(child => child.recurrence_id).join(', ') || '(none)'}\n` +
        `  rrule string:\n${recurrenceRuleString.split('\n').map(line => '    ' + line).join('\n')}`
      )

      fullCalendarEvents.push({
        ...base,
        rrule:    recurrenceRuleString,
        duration: event.end_time ? getDuration(event.start_time, event.end_time) : undefined,
      })

      // Override occurrences (edited single instances) appear as separate FullCalendar
      // events so they display at their new time rather than the original recurrence time
      for (const override of overrides) {
        fullCalendarEvents.push({
          ...base,
          id:    override.id,
          title: override.title,
          start: override.all_day
            ? override.start_time.slice(0, 10)
            : toFullCalendarLocalTimestamp(override.start_time),
          end:   override.end_time
            ? (override.all_day
                ? override.end_time.slice(0, 10)
                : toFullCalendarLocalTimestamp(override.end_time))
            : undefined,
          allDay:        override.all_day,
          extendedProps: { dbEvent: override, isException: true },
        })
      }
    } else {
      // Non-recurring: pass floating Eastern time (no Z) so FullCalendar positions the
      // event at the correct Eastern wall-clock time regardless of its timezone plugin
      fullCalendarEvents.push({
        ...base,
        start: event.all_day
          ? event.start_time.slice(0, 10)
          : toFullCalendarLocalTimestamp(event.start_time),
        end:   event.end_time
          ? (event.all_day
              ? event.end_time.slice(0, 10)
              : toFullCalendarLocalTimestamp(event.end_time))
          : undefined,
      })
    }
  }

  return fullCalendarEvents
}
