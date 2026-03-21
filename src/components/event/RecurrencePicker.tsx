// Recurrence select dropdown + custom weekly recurrence builder.
// Purely presentational — all state lives in useEventForm.

import { WEEKDAYS } from '../../utils/rrule'
import type { RecurrenceEndType } from '../../utils/rrule'

// Full names used as accessible tooltip labels on the day-toggle buttons
const FULL_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface RecurrencePickerProps {
  startDateTime:  string
  recurrenceRule: string
  isCustomRecurrenceRule: boolean | string
  onRuleChange:   (value: string) => void

  // Custom weekly builder fields
  customInterval:    number
  setCustomInterval: (n: number) => void
  customDays:        string[]
  setCustomDays:     (days: string[]) => void
  customEndType:     RecurrenceEndType
  setCustomEndType:  (t: RecurrenceEndType) => void
  customEndDate:     string
  setCustomEndDate:  (d: string) => void
  customEndCount:    number
  setCustomEndCount: (n: number) => void

  recurrenceOptions: { label: string; value: string }[]
}

export default function RecurrencePicker({
  recurrenceRule,
  isCustomRecurrenceRule,
  onRuleChange,
  customInterval,
  setCustomInterval,
  customDays,
  setCustomDays,
  customEndType,
  setCustomEndType,
  customEndDate,
  setCustomEndDate,
  customEndCount,
  setCustomEndCount,
  recurrenceOptions,
}: RecurrencePickerProps) {
  const showCustomBuilder = recurrenceRule === '__custom__' || Boolean(isCustomRecurrenceRule)

  return (
    <div className="form-group">
      <label htmlFor="event-recurrence">Recurrence</label>

      <select
        id="event-recurrence"
        value={isCustomRecurrenceRule ? '__custom__' : recurrenceRule}
        onChange={e => onRuleChange(e.target.value)}
      >
        {recurrenceOptions.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>

      {showCustomBuilder && (
        <div className="custom-recurrence">

          {/* ── Interval ── */}
          <div className="custom-recurrence-row">
            <span>Every</span>
            <input
              type="number"
              min={1}
              max={52}
              value={customInterval}
              onChange={e => setCustomInterval(Math.max(1, parseInt(e.target.value) || 1))}
              className="recurrence-inline-number"
            />
            <span>week{customInterval !== 1 ? 's' : ''}</span>
          </div>

          {/* ── Day toggles ── */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Repeat on</label>
            <div className="recurrence-day-buttons">
              {WEEKDAYS.map((weekday, index) => (
                <button
                  key={weekday.abbreviation}
                  type="button"
                  aria-pressed={customDays.includes(weekday.abbreviation)}
                  title={FULL_WEEKDAY_NAMES[index]}
                  className={`recurrence-day-button${customDays.includes(weekday.abbreviation) ? ' active' : ''}`}
                  onClick={() => setCustomDays(
                    customDays.includes(weekday.abbreviation)
                      ? customDays.filter(day => day !== weekday.abbreviation)
                      : [...customDays, weekday.abbreviation]
                  )}
                >
                  {weekday.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── End condition ── */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Ends</label>
            <div className="recurrence-end-options">

              <label className="recurrence-end-option">
                <input type="radio" name="recurrence-end" checked={customEndType === 'never'}
                  onChange={() => setCustomEndType('never')} />
                <span>Never</span>
              </label>

              <label className="recurrence-end-option">
                <input type="radio" name="recurrence-end" checked={customEndType === 'date'}
                  onChange={() => setCustomEndType('date')} />
                <span>On</span>
                {customEndType === 'date' && (
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => setCustomEndDate(e.target.value)}
                    className="recurrence-inline-date"
                  />
                )}
              </label>

              <label className="recurrence-end-option">
                <input type="radio" name="recurrence-end" checked={customEndType === 'count'}
                  onChange={() => setCustomEndType('count')} />
                <span>After</span>
                {customEndType === 'count' && (
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={customEndCount}
                    onChange={e => setCustomEndCount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="recurrence-inline-number"
                  />
                )}
                <span>occurrence{customEndType === 'count' && customEndCount !== 1 ? 's' : ''}</span>
              </label>

            </div>
          </div>

        </div>
      )}
    </div>
  )
}
