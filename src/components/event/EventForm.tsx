// All form fields for the event modal — purely presentational.
// Receives values and setters from useEventForm; no data fetching here.

import type { Calendar } from '../../types/database'
import LocationPicker from '../shared/LocationPicker'
import RecurrencePicker from './RecurrencePicker'
import type { EditScope } from './RecurrenceScopeChoice'
import type { CustomEndType } from '../../utils/rrule'

interface EventFormProps {
  // Scope
  isNew:          boolean
  scopeChosen:    EditScope | null
  isRecurring:    boolean

  // Basic fields
  title:          string
  setTitle:       (v: string) => void
  description:    string
  setDescription: (v: string) => void
  startDT:        string
  setStartDT:     (v: string) => void
  endDT:          string
  setEndDT:       (v: string) => void
  allDay:         boolean
  setAllDay:      (v: boolean) => void

  // Location
  locationName:    string
  locationId:      string | null
  onLocationChange: (name: string, id: string | null) => void

  // Recurrence
  recurrenceRule:    string
  setRecurrenceRule: (v: string) => void
  isCustomRrule:     boolean | string
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

  // Calendars
  calendars:              Calendar[]
  selectedCalendarIds:    string[]
  setSelectedCalendarIds: React.Dispatch<React.SetStateAction<string[]>>

  // Async state
  error: string | null
}

export default function EventForm({
  isNew, scopeChosen,
  title, setTitle,
  description, setDescription,
  startDT, setStartDT,
  endDT, setEndDT,
  allDay, setAllDay,
  locationName, locationId, onLocationChange,
  recurrenceRule, setRecurrenceRule,
  isCustomRrule,
  customInterval, setCustomInterval,
  customDays, setCustomDays,
  customEndType, setCustomEndType,
  customEndDate, setCustomEndDate,
  customEndCount, setCustomEndCount,
  recurrenceOptions,
  calendars, selectedCalendarIds, setSelectedCalendarIds,
  error,
}: EventFormProps) {
  return (
    <div className="modal-body">
      {error && <div className="error-banner">{error}</div>}

      {/* Title */}
      <div className="form-group">
        <label htmlFor="evt-title">Title *</label>
        <input
          id="evt-title"
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Event title"
          autoFocus
        />
      </div>

      {/* All-day toggle */}
      <div className="form-checkbox-row">
        <input
          id="evt-allday"
          type="checkbox"
          checked={allDay}
          onChange={e => setAllDay(e.target.checked)}
        />
        <label htmlFor="evt-allday" style={{ textTransform: 'none', letterSpacing: 'normal', fontSize: '0.9rem', cursor: 'pointer' }}>
          All day
        </label>
      </div>

      {/* Start / End times */}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="evt-start">{allDay ? 'Start date' : 'Start (ET)'}</label>
          <input
            id="evt-start"
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? startDT.slice(0, 10) : startDT}
            onChange={e => setStartDT(allDay ? e.target.value + 'T00:00' : e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="evt-end">{allDay ? 'End date' : 'End (ET)'}</label>
          <input
            id="evt-end"
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? endDT.slice(0, 10) : endDT}
            onChange={e => setEndDT(allDay ? e.target.value + 'T00:00' : e.target.value)}
          />
        </div>
      </div>

      {/* Location */}
      <div className="form-group">
        <label>Location</label>
        <LocationPicker
          value={locationName}
          locationId={locationId}
          onChange={onLocationChange}
        />
      </div>

      {/* Recurrence (only for new events or full-series edits) */}
      {(isNew || scopeChosen === 'series') && (
        <RecurrencePicker
          startDT={startDT}
          recurrenceRule={recurrenceRule}
          isCustomRrule={isCustomRrule}
          onRuleChange={v => {
            if (v !== '__custom__') setRecurrenceRule(v)
            else setRecurrenceRule('__custom__')
          }}
          customInterval={customInterval}
          setCustomInterval={setCustomInterval}
          customDays={customDays}
          setCustomDays={setCustomDays}
          customEndType={customEndType}
          setCustomEndType={setCustomEndType}
          customEndDate={customEndDate}
          setCustomEndDate={setCustomEndDate}
          customEndCount={customEndCount}
          setCustomEndCount={setCustomEndCount}
          recurrenceOptions={recurrenceOptions}
        />
      )}

      {/* Calendars */}
      {calendars.length > 0 && (
        <div className="form-group">
          <label>Calendars</label>
          <div className="calendar-picker">
            {calendars.map(cal => (
              <label key={cal.id} className="calendar-picker-option">
                <input
                  type="checkbox"
                  checked={selectedCalendarIds.includes(cal.id)}
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedCalendarIds(prev => [...prev, cal.id])
                    } else {
                      setSelectedCalendarIds(prev => prev.filter(id => id !== cal.id))
                    }
                  }}
                />
                <span className="calendar-picker-dot" style={{ backgroundColor: cal.color }} />
                <span>{cal.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="form-group">
        <label htmlFor="evt-desc">Description</label>
        <textarea
          id="evt-desc"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional notes"
        />
      </div>
    </div>
  )
}
