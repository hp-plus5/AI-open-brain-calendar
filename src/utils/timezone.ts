import { toZonedTime, fromZonedTime, format as tzFormat } from 'date-fns-tz'

/** The display/input timezone used throughout the app */
export const FC_TIMEZONE = 'America/New_York'

// ─── iCal formatting ──────────────────────────────────────────────────────────

/** Format a UTC ISO string as an iCal-compatible UTC datetime (e.g. "20260301T090000Z") */
export function toICalUTC(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * Format a UTC ISO string as a FLOATING iCal datetime in America/New_York (no Z suffix).
 * FullCalendar's rrule plugin treats DTSTART as already being in the calendar's timezone,
 * not as UTC — so we must pass the local wall-clock time, not the UTC time.
 */
export function toICalFloating(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FC_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const p: Record<string, string> = {}
  for (const { type, value } of parts) p[type] = value
  const h = p.hour === '24' ? '00' : p.hour
  return `${p.year}${p.month}${p.day}T${h}${p.minute}${p.second}`
}

// ─── FullCalendar ↔ UTC ───────────────────────────────────────────────────────

/**
 * FullCalendar returns floating local-time strings (no Z/offset) for rrule occurrences
 * and date selections. Interpret them as Eastern time and return a proper UTC ISO string.
 * Date-only strings (all-day) are returned as-is.
 */
export function fcStartToUTC(startStr: string): string {
  if (!startStr) return startStr
  // Already offset-aware — normalize to UTC ISO
  if (startStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(startStr)) {
    return new Date(startStr).toISOString()
  }
  // Date-only (all-day): no timezone conversion needed
  if (/^\d{4}-\d{2}-\d{2}$/.test(startStr)) return startStr
  // Floating datetime: treat as Eastern wall-clock time → UTC
  return fromZonedTime(new Date(startStr), FC_TIMEZONE).toISOString()
}

/** Compute an iCal duration string from two UTC ISO strings (e.g. "PT1H30M") */
export function getDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `PT${hours}H${minutes}M`
}

// ─── Form input ↔ UTC ─────────────────────────────────────────────────────────

/** Convert a UTC ISO string to an Eastern Time datetime-local string ("YYYY-MM-DDTHH:mm") */
export function utcToEasternInput(utcIso: string): string {
  const zoned = toZonedTime(new Date(utcIso), FC_TIMEZONE)
  return tzFormat(zoned, "yyyy-MM-dd'T'HH:mm", { timeZone: FC_TIMEZONE })
}

/** Convert a datetime-local string (interpreted as Eastern Time) back to UTC ISO */
export function easternInputToUTC(localStr: string): string {
  return fromZonedTime(new Date(localStr), FC_TIMEZONE).toISOString()
}

/**
 * Convert an ISO string to a datetime-local input value ("YYYY-MM-DDTHH:mm").
 * All-day events: take the UTC date portion as-is — no timezone conversion.
 *   Reason: all-day events are stored as UTC midnight; converting to Eastern time
 *   would shift them to the previous day (e.g. 2026-03-15T00:00Z → 2026-03-14T19:00 ET).
 * Timed events: convert from UTC to Eastern Time for display.
 */
export function toInputDT(isoStr: string, isAllDay: boolean): string {
  if (isAllDay) return isoStr.slice(0, 10) + 'T00:00'
  return utcToEasternInput(isoStr)
}

/**
 * Given a clicked occurrence's start (UTC ISO or date-only string), compute the
 * occurrence's end time as a datetime-local input string, preserving the master
 * event's duration.
 */
export function computeOccurrenceEndInput(
  occurrenceStart: string,
  masterStart: string,
  masterEnd: string,
  isAllDay: boolean
): string {
  if (isAllDay) {
    // All-day: duration in whole days (end is exclusive, so Jan 6–Jan 7 = 1 day)
    const startMs = new Date(masterStart.includes('T') ? masterStart : masterStart + 'T00:00:00Z').getTime()
    const endMs   = new Date(masterEnd.includes('T')   ? masterEnd   : masterEnd   + 'T00:00:00Z').getTime()
    const durationDays = Math.round((endMs - startMs) / 86400000)
    const occStartMs = new Date(occurrenceStart.includes('T') ? occurrenceStart : occurrenceStart + 'T00:00:00Z').getTime()
    const occEndMs = occStartMs + durationDays * 86400000
    return new Date(occEndMs).toISOString().slice(0, 10) + 'T00:00'
  } else {
    const durationMs = new Date(masterEnd).getTime() - new Date(masterStart).getTime()
    const occEndMs = new Date(occurrenceStart).getTime() + durationMs
    return utcToEasternInput(new Date(occEndMs).toISOString())
  }
}
