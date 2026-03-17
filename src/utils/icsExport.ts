// ICS calendar format generation and browser download helper.
// No React imports — pure functions + one async download trigger.

import JSZip from 'jszip'
import type { CalendarEventWithLocation } from '../types/database'
import { toICalUTC } from './timezone'

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/** Fold long iCal lines at 75 octets per RFC 5545 §3.1 */
export function foldICSLine(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let remaining = line
  let first = true
  while (remaining.length > 0) {
    const limit = first ? 75 : 74
    chunks.push(remaining.slice(0, limit))
    remaining = remaining.slice(limit)
    first = false
  }
  return chunks.join('\r\n ')
}

// ─── ICS generation ───────────────────────────────────────────────────────────

export function generateICS(
  calendarName: string,
  masterEvents: CalendarEventWithLocation[],
  allEvents: CalendarEventWithLocation[]
): string {
  const childrenByParent = new Map<string, CalendarEventWithLocation[]>()
  for (const e of allEvents) {
    if (!e.parent_event_id) continue
    if (!childrenByParent.has(e.parent_event_id)) childrenByParent.set(e.parent_event_id, [])
    childrenByParent.get(e.parent_event_id)!.push(e)
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Open Brain Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(calendarName)}`,
  ]

  const stamp = toICalUTC(new Date().toISOString())

  for (const event of masterEvents) {
    const children  = childrenByParent.get(event.id) ?? []
    const cancelled = children.filter(c => c.is_cancelled)
    const overrides = children.filter(c => !c.is_cancelled)

    const ev: string[] = ['BEGIN:VEVENT']
    ev.push(`UID:${event.id}@open-brain-calendar`)
    ev.push(`DTSTAMP:${stamp}`)

    if (event.all_day) {
      ev.push(`DTSTART;VALUE=DATE:${event.start_time.slice(0, 10).replace(/-/g, '')}`)
      if (event.end_time) ev.push(`DTEND;VALUE=DATE:${event.end_time.slice(0, 10).replace(/-/g, '')}`)
    } else {
      ev.push(`DTSTART:${toICalUTC(event.start_time)}`)
      if (event.end_time) ev.push(`DTEND:${toICalUTC(event.end_time)}`)
    }

    ev.push(`SUMMARY:${escapeICS(event.title)}`)
    if (event.description)        ev.push(`DESCRIPTION:${escapeICS(event.description)}`)
    if (event.locations?.address) ev.push(`LOCATION:${escapeICS(event.locations.address)}`)
    if (event.recurrence_rule)    ev.push(`RRULE:${event.recurrence_rule}`)

    for (const c of cancelled) {
      if (c.recurrence_id) ev.push(`EXDATE:${toICalUTC(c.recurrence_id)}`)
    }

    ev.push('END:VEVENT')
    lines.push(...ev.map(foldICSLine))

    // Override occurrences as separate VEVENTs with RECURRENCE-ID
    for (const ov of overrides) {
      const ovLines: string[] = ['BEGIN:VEVENT']
      ovLines.push(`UID:${event.id}@open-brain-calendar`)
      ovLines.push(`DTSTAMP:${stamp}`)
      if (ov.recurrence_id) ovLines.push(`RECURRENCE-ID:${toICalUTC(ov.recurrence_id)}`)

      if (ov.all_day) {
        ovLines.push(`DTSTART;VALUE=DATE:${ov.start_time.slice(0, 10).replace(/-/g, '')}`)
        if (ov.end_time) ovLines.push(`DTEND;VALUE=DATE:${ov.end_time.slice(0, 10).replace(/-/g, '')}`)
      } else {
        ovLines.push(`DTSTART:${toICalUTC(ov.start_time)}`)
        if (ov.end_time) ovLines.push(`DTEND:${toICalUTC(ov.end_time)}`)
      }

      ovLines.push(`SUMMARY:${escapeICS(ov.title)}`)
      if (ov.description) ovLines.push(`DESCRIPTION:${escapeICS(ov.description)}`)
      ovLines.push('END:VEVENT')
      lines.push(...ovLines.map(foldICSLine))
    }
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// ─── Download trigger ─────────────────────────────────────────────────────────

/** Generate and trigger a browser download of a .ics.zip for the given events */
export async function downloadICSZip(
  calendarName: string,
  masterEvents: CalendarEventWithLocation[],
  allEvents: CalendarEventWithLocation[]
): Promise<void> {
  const icsContent  = generateICS(calendarName, masterEvents, allEvents)
  const zip         = new JSZip()
  const safeFilename = calendarName.replace(/[^a-zA-Z0-9_-]/g, '_')
  zip.file(`${safeFilename}.ics`, icsContent)
  const blob = await zip.generateAsync({ type: 'blob' })

  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = `${safeFilename}.ics.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
