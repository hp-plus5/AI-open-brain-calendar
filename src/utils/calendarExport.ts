// Calendar export file generation and browser download helper.
// Produces iCalendar-formatted content (.ics) packed into a zip archive.
// No React imports — pure functions + one async download trigger.

import JSZip from 'jszip'
import type { CalendarEventWithLocation } from '../types/database'
import { toCalendarExportTimestamp } from './timezone'

// ─── Text escaping and line folding ───────────────────────────────────────────

/**
 * Escape special characters in a calendar export text field per RFC 5545 §3.3.11.
 * Backslashes, semicolons, commas, and newlines each have special meaning in the
 * iCalendar format and must be escaped when appearing in property values.
 */
export function escapeCalendarText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g,  '\\;')
    .replace(/,/g,  '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Fold a long calendar export line at 75 octets per RFC 5545 §3.1.
 * Continuation lines begin with a single space character.
 */
export function foldCalendarLine(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let remaining = line
  let isFirstChunk = true
  while (remaining.length > 0) {
    // First chunk gets 75 characters; continuation chunks get 74 to account for
    // the leading space that will be prepended when joining
    const limit = isFirstChunk ? 75 : 74
    chunks.push(remaining.slice(0, limit))
    remaining    = remaining.slice(limit)
    isFirstChunk = false
  }
  return chunks.join('\r\n ')
}

// ─── File content generation ──────────────────────────────────────────────────

/**
 * Generate the full iCalendar-formatted text for a calendar export file.
 * Handles recurring events (with RRULE), cancelled occurrences (EXDATE),
 * and edited single occurrences (RECURRENCE-ID override VEVENTs).
 */
export function generateCalendarExport(
  calendarName:  string,
  masterEvents:  CalendarEventWithLocation[],
  allEvents:     CalendarEventWithLocation[]
): string {
  // Index child exception/override rows by their parent event ID
  const childrenByParent = new Map<string, CalendarEventWithLocation[]>()
  for (const event of allEvents) {
    if (!event.parent_event_id) continue
    if (!childrenByParent.has(event.parent_event_id)) childrenByParent.set(event.parent_event_id, [])
    childrenByParent.get(event.parent_event_id)!.push(event)
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Open Brain Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeCalendarText(calendarName)}`,
  ]

  const stampTimestamp = toCalendarExportTimestamp(new Date().toISOString())

  for (const event of masterEvents) {
    const children  = childrenByParent.get(event.id) ?? []
    const cancelled = children.filter(child =>  child.is_cancelled)
    const overrides = children.filter(child => !child.is_cancelled)

    const eventLines: string[] = ['BEGIN:VEVENT']
    eventLines.push(`UID:${event.id}@open-brain-calendar`)
    eventLines.push(`DTSTAMP:${stampTimestamp}`)

    if (event.all_day) {
      eventLines.push(`DTSTART;VALUE=DATE:${event.start_time.slice(0, 10).replace(/-/g, '')}`)
      if (event.end_time) eventLines.push(`DTEND;VALUE=DATE:${event.end_time.slice(0, 10).replace(/-/g, '')}`)
    } else {
      eventLines.push(`DTSTART:${toCalendarExportTimestamp(event.start_time)}`)
      if (event.end_time) eventLines.push(`DTEND:${toCalendarExportTimestamp(event.end_time)}`)
    }

    eventLines.push(`SUMMARY:${escapeCalendarText(event.title)}`)
    if (event.description)        eventLines.push(`DESCRIPTION:${escapeCalendarText(event.description)}`)
    if (event.locations?.address) eventLines.push(`LOCATION:${escapeCalendarText(event.locations.address)}`)
    if (event.recurrence_rule)    eventLines.push(`RRULE:${event.recurrence_rule}`)

    // Each cancelled exception becomes an EXDATE entry that suppresses that occurrence
    for (const cancelledException of cancelled) {
      if (cancelledException.recurrence_id) {
        eventLines.push(`EXDATE:${toCalendarExportTimestamp(cancelledException.recurrence_id)}`)
      }
    }

    eventLines.push('END:VEVENT')
    lines.push(...eventLines.map(foldCalendarLine))

    // Each edited occurrence (override) becomes a separate VEVENT with a RECURRENCE-ID
    // that tells calendar clients this entry replaces a specific instance of the series
    for (const override of overrides) {
      const overrideLines: string[] = ['BEGIN:VEVENT']
      overrideLines.push(`UID:${event.id}@open-brain-calendar`)
      overrideLines.push(`DTSTAMP:${stampTimestamp}`)
      if (override.recurrence_id) {
        overrideLines.push(`RECURRENCE-ID:${toCalendarExportTimestamp(override.recurrence_id)}`)
      }

      if (override.all_day) {
        overrideLines.push(`DTSTART;VALUE=DATE:${override.start_time.slice(0, 10).replace(/-/g, '')}`)
        if (override.end_time) overrideLines.push(`DTEND;VALUE=DATE:${override.end_time.slice(0, 10).replace(/-/g, '')}`)
      } else {
        overrideLines.push(`DTSTART:${toCalendarExportTimestamp(override.start_time)}`)
        if (override.end_time) overrideLines.push(`DTEND:${toCalendarExportTimestamp(override.end_time)}`)
      }

      overrideLines.push(`SUMMARY:${escapeCalendarText(override.title)}`)
      if (override.description) overrideLines.push(`DESCRIPTION:${escapeCalendarText(override.description)}`)
      overrideLines.push('END:VEVENT')
      lines.push(...overrideLines.map(foldCalendarLine))
    }
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// ─── Download trigger ─────────────────────────────────────────────────────────

/**
 * Generate a calendar export file for the given events and trigger a browser
 * download of the result as a zip archive.
 */
export async function downloadCalendarExport(
  calendarName:  string,
  masterEvents:  CalendarEventWithLocation[],
  allEvents:     CalendarEventWithLocation[]
): Promise<void> {
  const fileContent   = generateCalendarExport(calendarName, masterEvents, allEvents)
  const zip           = new JSZip()
  const safeFilename  = calendarName.replace(/[^a-zA-Z0-9_-]/g, '_')
  zip.file(`${safeFilename}.ics`, fileContent)
  const blob = await zip.generateAsync({ type: 'blob' })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href     = url
  link.download = `${safeFilename}.ics.zip`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
