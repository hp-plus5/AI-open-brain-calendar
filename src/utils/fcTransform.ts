// Transform database event rows into FullCalendar EventInput objects.
// No React imports — pure functions only.

import type { EventInput } from '@fullcalendar/core'
import type { CalendarEventWithLocation, Calendar } from '../types/database'
import { toICalFloating, getDuration } from './timezone'

// ─── Calendar membership ──────────────────────────────────────────────────────

/**
 * Get the effective calendar IDs for an event.
 * Exception/override rows fall back to the parent's calendars if they have none.
 */
export function getEventCalendarIds(
  event: CalendarEventWithLocation,
  map: Map<string, string[]>
): string[] {
  const own = map.get(event.id) ?? []
  if (own.length > 0) return own
  if (event.parent_event_id) return map.get(event.parent_event_id) ?? []
  return []
}

// ─── Main transformer ─────────────────────────────────────────────────────────

/**
 * Transform CalendarEvent rows into FullCalendar EventInput objects.
 * Colors events by their first associated calendar.
 * Excludes events whose calendars are all hidden.
 */
export function toFCEvents(
  dbEvents: CalendarEventWithLocation[],
  calendars: Calendar[],
  eventCalendarsMap: Map<string, string[]>,
  hiddenCalendarIds: Set<string>
): EventInput[] {
  const masters    = dbEvents.filter(e => !e.parent_event_id)
  const exceptions = dbEvents.filter(e => !!e.parent_event_id)

  const byParent = new Map<string, CalendarEventWithLocation[]>()
  for (const exc of exceptions) {
    const key = exc.parent_event_id!
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(exc)
  }

  const fcEvents: EventInput[] = []

  for (const event of masters) {
    // Visibility: hidden if every assigned calendar is hidden
    const calIds = getEventCalendarIds(event, eventCalendarsMap)
    const isVisible = calIds.length === 0 || calIds.some(id => !hiddenCalendarIds.has(id))
    if (!isVisible) continue

    const firstCal = calendars.find(c => calIds.includes(c.id))
    const bgColor  = firstCal?.color ?? '#3b82f6'

    const children  = byParent.get(event.id) ?? []
    const cancelled = children.filter(c => c.is_cancelled)
    const overrides = children.filter(c => !c.is_cancelled)

    const base: EventInput = {
      id:              event.id,
      title:           event.title,
      allDay:          event.all_day,
      backgroundColor: bgColor,
      borderColor:     bgColor,
      extendedProps:   { dbEvent: event },
    }

    if (event.recurrence_rule) {
      // For all-day events: compact date YYYYMMDD (rrule.js parses this correctly
      // and FC's regex matches DTSTART: prefix for all-day detection).
      // For timed events: floating Eastern datetime (no Z) so FC treats it as
      // local New_York wall-clock time, not UTC.
      const dtstart = event.all_day
        ? event.start_time.slice(0, 10).replace(/-/g, '')
        : toICalFloating(event.start_time)

      // Sanitize recurrence_rule: strip any leading "RRULE:" prefix and any embedded
      // DTSTART lines (both can appear in ICS-imported data and would corrupt the string
      // we build below, e.g. producing "RRULE:RRULE:FREQ=..." which rrule.js can't parse).
      const rawRule = event.recurrence_rule
        .split('\n')
        .map(l => l.trim())
        .filter(l => !l.startsWith('DTSTART'))
        .join('\n')
        .replace(/^RRULE:/i, '')

      // Embed EXDATEs directly in the iCal string — the separate `exdate` array
      // property on the FC event is processed by FC's own regex which has bugs
      // with all-day events. Passing them inline lets rrulestr parse them natively.
      // Note: use EXDATE:YYYYMMDD (not EXDATE;VALUE=DATE:) — rrule.js has the
      // same VALUE=DATE parsing bug as DTSTART; compact format works correctly.
      const exdateLines = [...cancelled, ...overrides]
        .map(c => c.recurrence_id)
        .filter((d): d is string => !!d)
        .map(d => event.all_day
          ? `EXDATE:${d.slice(0, 10).replace(/-/g, '')}`
          : `EXDATE:${toICalFloating(d)}`)

      // Note: DTSTART;VALUE=DATE: is silently broken in rrule.js — it ignores the
      // date part and falls back to new Date(). DTSTART:YYYYMMDD (no VALUE=DATE)
      // is parsed correctly for both all-day and timed events.
      const rruleStr = exdateLines.length > 0
        ? `DTSTART:${dtstart}\nRRULE:${rawRule}\n${exdateLines.join('\n')}`
        : `DTSTART:${dtstart}\nRRULE:${rawRule}`

      // DEBUG: log the full rrule string for each recurring event so mismatches are visible
      console.debug(
        `[FC rrule] "${event.title}" all_day=${event.all_day} start_time=${event.start_time}\n` +
        `  raw recurrence_rule: ${event.recurrence_rule}\n` +
        `  cancelled rows (recurrence_id): ${cancelled.map(c => c.recurrence_id).join(', ') || '(none)'}\n` +
        `  rrule string:\n${rruleStr.split('\n').map(l => '    ' + l).join('\n')}`
      )

      fcEvents.push({
        ...base,
        rrule:    rruleStr,
        duration: event.end_time ? getDuration(event.start_time, event.end_time) : undefined,
      })

      for (const ov of overrides) {
        fcEvents.push({
          ...base,
          id:    ov.id,
          title: ov.title,
          start: ov.all_day ? ov.start_time.slice(0, 10) : toICalFloating(ov.start_time),
          end:   ov.end_time
            ? (ov.all_day ? ov.end_time.slice(0, 10) : toICalFloating(ov.end_time))
            : undefined,
          allDay:        ov.all_day,
          extendedProps: { dbEvent: ov, isException: true },
        })
      }
    } else {
      // Non-recurring: pass floating Eastern time (no Z) so FullCalendar positions the
      // event at the correct Eastern wall-clock time regardless of its timezone plugin.
      fcEvents.push({
        ...base,
        start: event.all_day ? event.start_time.slice(0, 10) : toICalFloating(event.start_time),
        end:   event.end_time
          ? (event.all_day ? event.end_time.slice(0, 10) : toICalFloating(event.end_time))
          : undefined,
      })
    }
  }

  return fcEvents
}
