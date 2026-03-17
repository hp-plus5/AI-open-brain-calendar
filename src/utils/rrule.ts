// RRULE parsing, building, and recurrence preset helpers.
// No React imports — pure functions only.

// ─── Types ────────────────────────────────────────────────────────────────────

export type CustomEndType = 'never' | 'date' | 'count'

export interface CustomRecur {
  interval: number
  days:     string[]
  endType:  CustomEndType
  endDate:  string   // YYYY-MM-DD
  endCount: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const WEEKDAYS = [
  { abbr: 'SU', label: 'Su' },
  { abbr: 'MO', label: 'Mo' },
  { abbr: 'TU', label: 'Tu' },
  { abbr: 'WE', label: 'We' },
  { abbr: 'TH', label: 'Th' },
  { abbr: 'FR', label: 'Fr' },
  { abbr: 'SA', label: 'Sa' },
] as const

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a weekly BYDAY string from a Date (e.g. "MO") */
export function weekdayAbbr(d: Date): string {
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getDay()]
}

// ─── Parse / Build ────────────────────────────────────────────────────────────

/**
 * Parse a FREQ=WEEKLY RRULE string into the structured fields used by the
 * custom builder. Returns safe defaults for non-weekly or unrecognised rules.
 */
export function parseCustomRrule(rrule: string): CustomRecur {
  const defaults: CustomRecur = { interval: 1, days: [], endType: 'never', endDate: '', endCount: 1 }
  if (!rrule.startsWith('FREQ=WEEKLY')) return defaults
  const parts: Record<string, string> = {}
  rrule.split(';').forEach(part => {
    const eq = part.indexOf('=')
    if (eq !== -1) parts[part.slice(0, eq)] = part.slice(eq + 1)
  })
  let endDate = ''
  if (parts['UNTIL']) {
    const u = parts['UNTIL'].replace(/T.*$/, '')
    endDate = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`
  }
  return {
    interval: parseInt(parts['INTERVAL'] ?? '1', 10),
    days:     parts['BYDAY'] ? parts['BYDAY'].split(',') : [],
    endType:  parts['COUNT'] ? 'count' : parts['UNTIL'] ? 'date' : 'never',
    endDate,
    endCount: parseInt(parts['COUNT'] ?? '1', 10),
  }
}

/** Build a FREQ=WEEKLY RRULE string from structured fields. */
export function buildCustomRrule(c: CustomRecur): string {
  let rule = 'FREQ=WEEKLY'
  if (c.interval > 1)                            rule += `;INTERVAL=${c.interval}`
  if (c.days.length > 0)                         rule += `;BYDAY=${c.days.join(',')}`
  if (c.endType === 'count' && c.endCount > 0)   rule += `;COUNT=${c.endCount}`
  else if (c.endType === 'date' && c.endDate)    rule += `;UNTIL=${c.endDate.replace(/-/g, '')}T000000Z`
  return rule
}

// ─── Presets ──────────────────────────────────────────────────────────────────

/** Build the recurrence dropdown options based on the event's start date */
export function getRecurrenceOptions(startDateStr: string) {
  const day = weekdayAbbr(new Date(startDateStr))
  return [
    { label: 'Does not repeat',                                                  value: '' },
    { label: 'Every day',                                                        value: 'FREQ=DAILY' },
    { label: `Every week on ${WEEKDAY_NAMES[new Date(startDateStr).getDay()]}`,  value: `FREQ=WEEKLY;BYDAY=${day}` },
    { label: 'Every weekday (Mon–Fri)',                                          value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { label: 'Every month',                                                      value: 'FREQ=MONTHLY' },
    { label: 'Every year',                                                       value: 'FREQ=YEARLY' },
    { label: 'Custom…',                                                          value: '__custom__' },
  ]
}
