// All form fields for the event modal — purely presentational.
// Receives values and setters from useEventForm via EventModal; no data fetching here.

import type { Calendar } from '../../types/database'
import LocationPicker from '../shared/LocationPicker'
import RecurrencePicker from './RecurrencePicker'
import type { EditScope } from './RecurrenceScopeChoice'
import type { RecurrenceEndType } from '../../utils/rrule'

interface EventFormProps {
  // Scope context — controls whether the recurrence picker is visible
  isNew:       boolean
  scopeChosen: EditScope | null
  isRecurring: boolean

  // Basic fields
  title:          string
  setTitle:       (v: string) => void
  description:    string
  setDescription: (v: string) => void
  startDateTime:  string
  setStartDateTime: (v: string) => void
  endDateTime:    string
  setEndDateTime: (v: string) => void
  allDay:         boolean
  setAllDay:      (v: boolean) => void

  // Location
  locationName:    string
  locationId:      string | null
  onLocationChange: (name: string, id: string | null) => void

  // Recurrence
  recurrenceRule:         string
  setRecurrenceRule:      (v: string) => void
  isCustomRecurrenceRule: boolean | string
  customInterval:         number
  setCustomInterval:      (n: number) => void
  customDays:             string[]
  setCustomDays:          (days: string[]) => void
  customEndType:          RecurrenceEndType
  setCustomEndType:       (t: RecurrenceEndType) => void
  customEndDate:          string
  setCustomEndDate:       (d: string) => void
  customEndCount:         number
  setCustomEndCount:      (n: number) => void
  recurrenceOptions:      { label: string; value: string }[]

  // Calendar assignments
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
  startDateTime, setStartDateTime,
  endDateTime, setEndDateTime,
  allDay, setAllDay,
  locationName, locationId, onLocationChange,
  recurrenceRule, setRecurrenceRule,
  isCustomRecurrenceRule,
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
        <label htmlFor="event-title">Title *</label>
        <input
          id="event-title"
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
          id="event-all-day"
          type="checkbox"
          checked={allDay}
          onChange={e => setAllDay(e.target.checked)}
        />
        <label htmlFor="event-all-day" style={{ textTransform: 'none', letterSpacing: 'normal', fontSize: '0.9rem', cursor: 'pointer' }}>
          All day
        </label>
      </div>

      {/* Start / End times */}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="event-start">{allDay ? 'Start date' : 'Start (Eastern Time)'}</label>
          <input
            id="event-start"
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? startDateTime.slice(0, 10) : startDateTime}
            onChange={e => setStartDateTime(allDay ? e.target.value + 'T00:00' : e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="event-end">{allDay ? 'End date' : 'End (Eastern Time)'}</label>
          <input
            id="event-end"
            type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? endDateTime.slice(0, 10) : endDateTime}
            onChange={e => setEndDateTime(allDay ? e.target.value + 'T00:00' : e.target.value)}
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
          startDateTime={startDateTime}
          recurrenceRule={recurrenceRule}
          isCustomRecurrenceRule={isCustomRecurrenceRule}
          onRuleChange={value => {
            if (value !== '__custom__') setRecurrenceRule(value)
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

      {/* Calendar assignments */}
      {calendars.length > 0 && (
        <div className="form-group">
          <label>Calendars</label>
          <div className="calendar-picker">
            {calendars.map(calendar => (
              <label key={calendar.id} className="calendar-picker-option">
                <input
                  type="checkbox"
                  checked={selectedCalendarIds.includes(calendar.id)}
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedCalendarIds(prev => [...prev, calendar.id])
                    } else {
                      setSelectedCalendarIds(prev => prev.filter(id => id !== calendar.id))
                    }
                  }}
                />
                <span className="calendar-picker-dot" style={{ backgroundColor: calendar.color }} />
                <span>{calendar.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="form-group">
        <label htmlFor="event-description">Description</label>
        <textarea
          id="event-description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional notes"
        />
      </div>
    </div>
  )
}
