// Thin orchestrator: manages scope-choice gate, wires useEventForm, renders EventForm.

import type { Session } from '@supabase/supabase-js'
import type { CalendarEventWithLocation, Calendar } from '../../types/database'
import { useEventForm } from '../../hooks/useEventForm'
import RecurrenceScopeChoice from './RecurrenceScopeChoice'
import EventForm from './EventForm'

export type { EditScope } from './RecurrenceScopeChoice'

export interface EventModalProps {
  /** If null, we're creating a new event */
  event:              CalendarEventWithLocation | null
  /** For recurring events: which occurrence was clicked (UTC ISO) */
  occurrenceStart?:   string
  /** Whether to show the recurrence-scope choice before the form */
  showScopeChoice?:   boolean
  /** Default start/end for new events created by clicking on the calendar grid */
  defaultStart?:      string
  defaultEnd?:        string
  defaultAllDay?:     boolean
  session:            Session
  calendars:          Calendar[]
  initialCalendarIds: string[]
  onClose:            () => void
  /** Called after a successful save or delete so CalendarView can reload data */
  onSaved:            () => void
}

export default function EventModal({
  event,
  occurrenceStart,
  showScopeChoice = false,
  defaultStart,
  defaultEnd,
  defaultAllDay = false,
  session,
  calendars,
  initialCalendarIds,
  onClose,
  onSaved,
}: EventModalProps) {
  const form = useEventForm({
    event, occurrenceStart, showScopeChoice,
    defaultStart, defaultEnd, defaultAllDay,
    session, initialCalendarIds, onSaved,
  })

  // Gate: show scope choice dialog before the form for recurring event clicks
  if (showScopeChoice && form.isRecurring && form.scopeChosen === null) {
    return (
      <RecurrenceScopeChoice
        onChoose={form.setScopeChosen}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">

        <div className="modal-header">
          <h2>{form.editingLabel}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <EventForm
          isNew={form.isNew}
          scopeChosen={form.scopeChosen}
          isRecurring={form.isRecurring}
          title={form.title}
          setTitle={form.setTitle}
          description={form.description}
          setDescription={form.setDescription}
          startDT={form.startDT}
          setStartDT={form.setStartDT}
          endDT={form.endDT}
          setEndDT={form.setEndDT}
          allDay={form.allDay}
          setAllDay={form.setAllDay}
          locationName={form.locationName}
          locationId={form.locationId}
          onLocationChange={(name, id) => { form.setLocationName(name); form.setLocationId(id) }}
          recurrenceRule={form.recurrenceRule}
          setRecurrenceRule={form.setRecurrenceRule}
          isCustomRrule={form.isCustomRrule}
          customInterval={form.customInterval}
          setCustomInterval={form.setCustomInterval}
          customDays={form.customDays}
          setCustomDays={form.setCustomDays}
          customEndType={form.customEndType}
          setCustomEndType={form.setCustomEndType}
          customEndDate={form.customEndDate}
          setCustomEndDate={form.setCustomEndDate}
          customEndCount={form.customEndCount}
          setCustomEndCount={form.setCustomEndCount}
          recurrenceOptions={form.recurrenceOptions}
          calendars={calendars}
          selectedCalendarIds={form.selectedCalendarIds}
          setSelectedCalendarIds={form.setSelectedCalendarIds}
          error={form.error}
        />

        <div className="modal-footer">
          {!form.isNew && (
            <div className="modal-footer-left">
              <button className="btn btn-danger" onClick={form.handleDelete} disabled={form.saving}>
                {(form.isRecurring && form.scopeChosen === 'this') || form.isOverride
                  ? 'Remove occurrence'
                  : 'Delete'}
              </button>
            </div>
          )}
          <button className="btn btn-secondary" onClick={onClose} disabled={form.saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={form.handleSave} disabled={form.saving}>
            {form.saving ? 'Saving…' : 'Save'}
          </button>
        </div>

      </div>
    </div>
  )
}
