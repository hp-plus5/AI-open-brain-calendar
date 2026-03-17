// Recurrence select dropdown + custom weekly recurrence builder.
// Purely presentational — all state lives in useEventForm.

import { WEEKDAYS } from '../../utils/rrule'
import type { CustomEndType } from '../../utils/rrule'

interface RecurrencePickerProps {
  startDT:        string
  recurrenceRule: string
  isCustomRrule:  boolean | string
  onRuleChange:   (value: string) => void

  // Custom builder fields
  customInterval:    number
  setCustomInterval: (n: number) => void
  customDays:        string[]
  setCustomDays:     (days: string[]) => void
  customEndType:     CustomEndType
  setCustomEndType:  (t: CustomEndType) => void
  customEndDate:     string
  setCustomEndDate:  (d: string) => void
  customEndCount:    number
  setCustomEndCount: (n: number) => void

  recurrenceOptions: { label: string; value: string }[]
}

const WEEKDAY_FULL_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function RecurrencePicker({
  recurrenceRule,
  isCustomRrule,
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
  const showCustomBuilder = recurrenceRule === '__custom__' || Boolean(isCustomRrule)

  return (
    <div className="form-group">
      <label htmlFor="evt-recur">Recurrence</label>

      <select
        id="evt-recur"
        value={isCustomRrule ? '__custom__' : recurrenceRule}
        onChange={e => onRuleChange(e.target.value)}
      >
        {recurrenceOptions.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {showCustomBuilder && (
        <div className="custom-recur">

          {/* ── Interval ── */}
          <div className="custom-recur-row">
            <span>Every</span>
            <input
              type="number"
              min={1}
              max={52}
              value={customInterval}
              onChange={e => setCustomInterval(Math.max(1, parseInt(e.target.value) || 1))}
              className="recur-inline-num"
            />
            <span>week{customInterval !== 1 ? 's' : ''}</span>
          </div>

          {/* ── Day toggles ── */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Repeat on</label>
            <div className="recur-day-btns">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d.abbr}
                  type="button"
                  aria-pressed={customDays.includes(d.abbr)}
                  title={WEEKDAY_FULL_NAMES[i]}
                  className={`recur-day-btn${customDays.includes(d.abbr) ? ' active' : ''}`}
                  onClick={() => setCustomDays(
                    customDays.includes(d.abbr)
                      ? customDays.filter(x => x !== d.abbr)
                      : [...customDays, d.abbr]
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── End condition ── */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Ends</label>
            <div className="recur-end-options">

              <label className="recur-end-option">
                <input type="radio" name="recur-end" checked={customEndType === 'never'}
                  onChange={() => setCustomEndType('never')} />
                <span>Never</span>
              </label>

              <label className="recur-end-option">
                <input type="radio" name="recur-end" checked={customEndType === 'date'}
                  onChange={() => setCustomEndType('date')} />
                <span>On</span>
                {customEndType === 'date' && (
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => setCustomEndDate(e.target.value)}
                    className="recur-inline-date"
                  />
                )}
              </label>

              <label className="recur-end-option">
                <input type="radio" name="recur-end" checked={customEndType === 'count'}
                  onChange={() => setCustomEndType('count')} />
                <span>After</span>
                {customEndType === 'count' && (
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={customEndCount}
                    onChange={e => setCustomEndCount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="recur-inline-num"
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
