import { toZonedTime, fromZonedTime, format as tzFormat } from 'date-fns-tz'

/** The timezone used for display and form inputs throughout the app */
export const APP_TIMEZONE = 'America/New_York'

// ─── Calendar export formatting ───────────────────────────────────────────────

/**
 * Format a UTC ISO string as a UTC timestamp suitable for a calendar export file
 * (e.g. "20260301T090000Z"). Used in DTSTART, DTEND, EXDATE, and DTSTAMP fields.
 */
export function toCalendarExportTimestamp(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * Format a UTC ISO string as a LOCAL (floating) timestamp in Eastern Time, with no
 * timezone suffix (e.g. "20260301T090000"). Called "floating" because the iCalendar
 * spec treats a datetime without a Z or offset as being in whatever timezone the
 * calendar consumer is using. FullCalendar's rrule plugin expects DTSTART to be in
 * the calendar's display timezone rather than UTC, so we pass Eastern wall-clock time.
 */
export function toFullCalendarLocalTimestamp(iso: string): string {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   false,
  }).formatToParts(date)

  // Build a lookup from part type → value (e.g. { year: "2026", month: "03", ... })
  const partsByType: Record<string, string> = {}
  for (const { type, value } of parts) partsByType[type] = value

  // Intl.DateTimeFormat can return "24" for midnight in hour12:false mode; normalize it
  const hour = partsByType.hour === '24' ? '00' : partsByType.hour
  return `${partsByType.year}${partsByType.month}${partsByType.day}T${hour}${partsByType.minute}${partsByType.second}`
}

// ─── FullCalendar ↔ UTC ───────────────────────────────────────────────────────

/**
 * Convert a FullCalendar datetime string to a UTC ISO string.
 *
 * FullCalendar returns floating local-time strings (no Z or offset) for rrule
 * occurrences and date selections. This function interprets those as Eastern time
 * and converts them to proper UTC. Date-only strings (all-day events) pass through
 * unchanged since they carry no time component.
 */
export function fullCalendarStringToUTC(startStr: string): string {
  if (!startStr) return startStr
  // Already offset-aware — normalize to UTC ISO
  if (startStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(startStr)) {
    return new Date(startStr).toISOString()
  }
  // Date-only (all-day): no timezone conversion needed
  if (/^\d{4}-\d{2}-\d{2}$/.test(startStr)) return startStr
  // Floating datetime: treat as Eastern wall-clock time → UTC
  return fromZonedTime(new Date(startStr), APP_TIMEZONE).toISOString()
}

/** Compute a duration string from two UTC ISO strings (e.g. "PT1H30M") */
export function getDuration(start: string, end: string): string {
  const ms           = new Date(end).getTime() - new Date(start).getTime()
  const totalMinutes = Math.round(ms / 60000)
  const hours        = Math.floor(totalMinutes / 60)
  const minutes      = totalMinutes % 60
  return `PT${hours}H${minutes}M`
}

// ─── Form input ↔ UTC ─────────────────────────────────────────────────────────

/**
 * Convert a UTC ISO string to the Eastern Time value expected by an
 * HTML datetime-local input ("YYYY-MM-DDTHH:mm").
 */
export function utcToEasternTimeInput(utcIso: string): string {
  const zoned = toZonedTime(new Date(utcIso), APP_TIMEZONE)
  return tzFormat(zoned, "yyyy-MM-dd'T'HH:mm", { timeZone: APP_TIMEZONE })
}

/**
 * Convert the value from an HTML datetime-local input (which the user enters in
 * Eastern Time) back to a UTC ISO string for storage.
 */
export function easternTimeInputToUTC(localStr: string): string {
  return fromZonedTime(new Date(localStr), APP_TIMEZONE).toISOString()
}

/**
 * Convert a stored ISO string to the value expected by an HTML date or
 * datetime-local input ("YYYY-MM-DDTHH:mm").
 *
 * All-day events: use the UTC date portion directly — no timezone conversion.
 *   Reason: all-day events are stored as UTC midnight; converting to Eastern Time
 *   would shift them to the previous day (e.g. 2026-03-15T00:00Z → 2026-03-14T19:00 ET).
 * Timed events: convert from UTC to Eastern Time for display.
 */
export function toInputDateTime(isoStr: string, isAllDay: boolean): string {
  if (isAllDay) return isoStr.slice(0, 10) + 'T00:00'
  return utcToEasternTimeInput(isoStr)
}

/**
 * Given a clicked occurrence's start time (UTC ISO or date-only string), compute
 * the occurrence's end time as a datetime-local input string, preserving the master
 * event's duration.
 */
export function computeOccurrenceEndInput(
  occurrenceStart: string,
  masterStart:     string,
  masterEnd:       string,
  isAllDay:        boolean
): string {
  if (isAllDay) {
    // All-day duration is measured in whole days (the end date is exclusive,
    // so a Jan 6–Jan 7 event has a duration of 1 day)
    const startMs      = new Date(masterStart.includes('T') ? masterStart : masterStart + 'T00:00:00Z').getTime()
    const endMs        = new Date(masterEnd.includes('T')   ? masterEnd   : masterEnd   + 'T00:00:00Z').getTime()
    const durationDays = Math.round((endMs - startMs) / 86400000)
    const occStartMs   = new Date(occurrenceStart.includes('T') ? occurrenceStart : occurrenceStart + 'T00:00:00Z').getTime()
    const occEndMs     = occStartMs + durationDays * 86400000
    return new Date(occEndMs).toISOString().slice(0, 10) + 'T00:00'
  } else {
    const durationMs = new Date(masterEnd).getTime() - new Date(masterStart).getTime()
    const occEndMs   = new Date(occurrenceStart).getTime() + durationMs
    return utcToEasternTimeInput(new Date(occEndMs).toISOString())
  }
}
