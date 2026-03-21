// Recurrence rule parsing, building, and dropdown preset helpers.
// No React imports — pure functions only.

// ─── Types ────────────────────────────────────────────────────────────────────

/** How a custom weekly recurrence series should end */
export type RecurrenceEndType = 'never' | 'date' | 'count'

/** All fields that drive the custom weekly recurrence builder UI */
export interface CustomRecurrenceConfig {
  interval:  number
  days:      string[]
  endType:   RecurrenceEndType
  /** ISO date string (YYYY-MM-DD) used when endType is 'date' */
  endDate:   string
  endCount:  number
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const WEEKDAYS = [
  { abbreviation: 'SU', label: 'Su' },
  { abbreviation: 'MO', label: 'Mo' },
  { abbreviation: 'TU', label: 'Tu' },
  { abbreviation: 'WE', label: 'We' },
  { abbreviation: 'TH', label: 'Th' },
  { abbreviation: 'FR', label: 'Fr' },
  { abbreviation: 'SA', label: 'Sa' },
] as const

const FULL_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the two-letter BYDAY abbreviation for a given Date
 * (e.g. a Monday returns "MO"). Used when building the default weekly preset.
 */
export function getWeekdayAbbreviation(date: Date): string {
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getDay()]
}

// ─── Parse / Build ────────────────────────────────────────────────────────────

/**
 * Parse a FREQ=WEEKLY recurrence rule string into the structured fields used by
 * the custom recurrence builder. Returns safe defaults for non-weekly or
 * unrecognised rules.
 */
export function parseCustomRecurrenceRule(recurrenceRule: string): CustomRecurrenceConfig {
  const defaults: CustomRecurrenceConfig = {
    interval: 1,
    days:     [],
    endType:  'never',
    endDate:  '',
    endCount: 1,
  }
  if (!recurrenceRule.startsWith('FREQ=WEEKLY')) return defaults

  // Split "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE" into a key → value map
  const parts: Record<string, string> = {}
  recurrenceRule.split(';').forEach(segment => {
    const equalsIndex = segment.indexOf('=')
    if (equalsIndex !== -1) parts[segment.slice(0, equalsIndex)] = segment.slice(equalsIndex + 1)
  })

  // UNTIL is stored as "YYYYMMDDTHHMMSSZ"; convert to "YYYY-MM-DD" for the date input
  let endDate = ''
  if (parts['UNTIL']) {
    const untilString = parts['UNTIL'].replace(/T.*$/, '')
    endDate = `${untilString.slice(0, 4)}-${untilString.slice(4, 6)}-${untilString.slice(6, 8)}`
  }

  return {
    interval: parseInt(parts['INTERVAL'] ?? '1', 10),
    days:     parts['BYDAY'] ? parts['BYDAY'].split(',') : [],
    endType:  parts['COUNT'] ? 'count' : parts['UNTIL'] ? 'date' : 'never',
    endDate,
    endCount: parseInt(parts['COUNT'] ?? '1', 10),
  }
}

/** Build a FREQ=WEEKLY recurrence rule string from the custom builder's state */
export function buildCustomRecurrenceRule(config: CustomRecurrenceConfig): string {
  let rule = 'FREQ=WEEKLY'
  if (config.interval > 1)                                   rule += `;INTERVAL=${config.interval}`
  if (config.days.length > 0)                                rule += `;BYDAY=${config.days.join(',')}`
  if (config.endType === 'count' && config.endCount > 0)     rule += `;COUNT=${config.endCount}`
  else if (config.endType === 'date' && config.endDate)      rule += `;UNTIL=${config.endDate.replace(/-/g, '')}T000000Z`
  return rule
}

// ─── Dropdown presets ─────────────────────────────────────────────────────────

/** Build the recurrence dropdown options based on the event's start date */
export function getRecurrenceOptions(startDateStr: string) {
  const dayAbbreviation = getWeekdayAbbreviation(new Date(startDateStr))
  return [
    { label: 'Does not repeat',                                                          value: '' },
    { label: 'Every day',                                                                value: 'FREQ=DAILY' },
    { label: `Every week on ${FULL_WEEKDAY_NAMES[new Date(startDateStr).getDay()]}`,     value: `FREQ=WEEKLY;BYDAY=${dayAbbreviation}` },
    { label: 'Every weekday (Mon–Fri)',                                                  value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { label: 'Every month',                                                              value: 'FREQ=MONTHLY' },
    { label: 'Every year',                                                               value: 'FREQ=YEARLY' },
    { label: 'Custom…',                                                                  value: '__custom__' },
  ]
}
