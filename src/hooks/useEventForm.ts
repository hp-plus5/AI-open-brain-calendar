// All form state, validation, save, and delete logic for the event modal.
// Returns values + setters + handlers — no JSX.

import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { CalendarEventWithLocation } from '../types/database'
import type { EditScope } from '../components/event/RecurrenceScopeChoice'
import {
  toInputDateTime,
  utcToEasternTimeInput,
  easternTimeInputToUTC,
  computeOccurrenceEndInput,
} from '../utils/timezone'
import {
  parseCustomRecurrenceRule,
  buildCustomRecurrenceRule,
  getRecurrenceOptions,
} from '../utils/rrule'
import type { RecurrenceEndType, CustomRecurrenceConfig } from '../utils/rrule'
import {
  createEvent,
  updateEvent,
  deleteEvent,
  cancelOccurrence,
  cancelOverride,
  saveCalendarMemberships,
  createLocation,
} from '../services/eventService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseEventFormProps {
  event:              CalendarEventWithLocation | null
  occurrenceStart?:   string
  showScopeChoice?:   boolean
  defaultStart?:      string
  defaultEnd?:        string
  defaultAllDay?:     boolean
  session:            Session
  initialCalendarIds: string[]
  onSaved:            () => void
}

export interface UseEventFormReturn {
  // Scope (recurring events)
  scopeChosen:    EditScope | null
  setScopeChosen: React.Dispatch<React.SetStateAction<EditScope | null>>

  // Derived flags
  isNew:        boolean
  isRecurring:  boolean
  isOverride:   boolean
  editingLabel: string

  // Basic fields
  title:          string
  setTitle:       React.Dispatch<React.SetStateAction<string>>
  description:    string
  setDescription: React.Dispatch<React.SetStateAction<string>>
  startDateTime:  string
  setStartDateTime: React.Dispatch<React.SetStateAction<string>>
  endDateTime:    string
  setEndDateTime: React.Dispatch<React.SetStateAction<string>>
  allDay:         boolean
  setAllDay:      React.Dispatch<React.SetStateAction<boolean>>

  // Location
  locationName:    string
  setLocationName: React.Dispatch<React.SetStateAction<string>>
  locationId:      string | null
  setLocationId:   React.Dispatch<React.SetStateAction<string | null>>

  // Recurrence
  recurrenceRule:           string
  setRecurrenceRule:        React.Dispatch<React.SetStateAction<string>>
  recurrenceOptions:        ReturnType<typeof getRecurrenceOptions>
  isCustomRecurrenceRule:   boolean | string
  customInterval:           number
  setCustomInterval:        React.Dispatch<React.SetStateAction<number>>
  customDays:               string[]
  setCustomDays:            React.Dispatch<React.SetStateAction<string[]>>
  customEndType:            RecurrenceEndType
  setCustomEndType:         React.Dispatch<React.SetStateAction<RecurrenceEndType>>
  customEndDate:            string
  setCustomEndDate:         React.Dispatch<React.SetStateAction<string>>
  customEndCount:           number
  setCustomEndCount:        React.Dispatch<React.SetStateAction<number>>

  // Calendar assignments
  selectedCalendarIds:    string[]
  setSelectedCalendarIds: React.Dispatch<React.SetStateAction<string[]>>

  // Async state
  saving: boolean
  error:  string | null

  // Actions
  handleSave:   () => Promise<void>
  handleDelete: () => Promise<void>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEventForm({
  event,
  occurrenceStart,
  showScopeChoice = false,
  defaultStart,
  defaultEnd,
  defaultAllDay = false,
  session,
  initialCalendarIds,
  onSaved,
}: UseEventFormProps): UseEventFormReturn {
  const isNew      = event === null
  const isRecurring = !!event?.recurrence_rule && !event?.parent_event_id
  // An override row is a child exception previously edited (parent_event_id is set,
  // no recurrence_rule). It needs special delete handling — see handleDelete below.
  const isOverride = !isNew && !!event?.parent_event_id

  // ─── Scope ──────────────────────────────────────────────────────────────

  const [scopeChosen, setScopeChosen] = useState<EditScope | null>(
    showScopeChoice && isRecurring ? null : 'series'
  )

  // ─── Derived defaults ───────────────────────────────────────────────────

  const isAllDayEvent           = event?.all_day ?? defaultAllDay
  const defaultStartEasternTime = defaultStart
    ? toInputDateTime(defaultStart, defaultAllDay)
    : utcToEasternTimeInput(new Date().toISOString()).slice(0, 16)
  const defaultEndEasternTime   = defaultEnd ? toInputDateTime(defaultEnd, defaultAllDay) : ''

  // ─── Form state ─────────────────────────────────────────────────────────

  const [title,       setTitle]       = useState(event?.title ?? '')
  const [description, setDescription] = useState(event?.description ?? '')

  const [startDateTime, setStartDateTime] = useState<string>(
    event
      ? toInputDateTime(
          // For 'this' scope on a recurring event, seed the occurrence's own start time
          scopeChosen === 'this' && occurrenceStart ? occurrenceStart : event.start_time,
          isAllDayEvent
        )
      : defaultStartEasternTime
  )
  const [endDateTime, setEndDateTime] = useState<string>(
    event?.end_time ? toInputDateTime(event.end_time, isAllDayEvent) : defaultEndEasternTime
  )

  const [allDay,       setAllDay]      = useState(event?.all_day ?? defaultAllDay)
  const [locationName, setLocationName] = useState(event?.locations?.name ?? '')
  const [locationId,   setLocationId]   = useState<string | null>(event?.location_id ?? null)
  const [recurrenceRule, setRecurrenceRule] = useState(event?.recurrence_rule ?? '')

  // Custom recurrence builder — pre-populated from existing rule when editing
  const initialCustomRecurrence: CustomRecurrenceConfig = parseCustomRecurrenceRule(event?.recurrence_rule ?? '')
  const [customInterval,  setCustomInterval]  = useState(initialCustomRecurrence.interval)
  const [customDays,      setCustomDays]      = useState<string[]>(initialCustomRecurrence.days)
  const [customEndType,   setCustomEndType]   = useState<RecurrenceEndType>(initialCustomRecurrence.endType)
  const [customEndDate,   setCustomEndDate]   = useState(initialCustomRecurrence.endDate)
  const [customEndCount,  setCustomEndCount]  = useState(initialCustomRecurrence.endCount)

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>(initialCalendarIds)

  // ─── Scope side effect ──────────────────────────────────────────────────

  // When the user picks 'this occurrence', snap start/end to the clicked occurrence time
  useEffect(() => {
    if (event && scopeChosen === 'this' && occurrenceStart) {
      setStartDateTime(toInputDateTime(occurrenceStart, event.all_day))
      if (event.end_time) {
        setEndDateTime(computeOccurrenceEndInput(
          occurrenceStart,
          event.start_time,
          event.end_time,
          event.all_day
        ))
      }
    }
  }, [scopeChosen, event, occurrenceStart])

  // ─── Recurrence helpers ─────────────────────────────────────────────────

  const recurrenceOptions       = getRecurrenceOptions(startDateTime)
  // True when the stored rule doesn't match any preset option (meaning it's a custom rule)
  const isCustomRecurrenceRule  = recurrenceRule &&
    !recurrenceOptions.some(option => option.value === recurrenceRule && option.value !== '__custom__')

  // ─── Save ────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!title.trim())   { setError('Title is required'); return }
    if (!startDateTime)  { setError('Start time is required'); return }
    setSaving(true)
    setError(null)

    try {
      // Resolve location: create a new row if the user typed a name but didn't pick
      // an existing one from the dropdown
      let resolvedLocationId = locationId
      if (locationName.trim() && !locationId) {
        resolvedLocationId = await createLocation(session.user.id, locationName.trim())
      } else if (!locationName.trim()) {
        resolvedLocationId = null
      }

      const startUTC     = allDay
        ? startDateTime.slice(0, 10) + 'T00:00:00.000Z'
        : easternTimeInputToUTC(startDateTime)
      const endUTC       = endDateTime
        ? (allDay ? endDateTime.slice(0, 10) + 'T00:00:00.000Z' : easternTimeInputToUTC(endDateTime))
        : null
      const inCustomMode = recurrenceRule === '__custom__' || Boolean(isCustomRecurrenceRule)
      const finalRule    = inCustomMode
        ? buildCustomRecurrenceRule({
            interval: customInterval,
            days:     customDays,
            endType:  customEndType,
            endDate:  customEndDate,
            endCount: customEndCount,
          })
        : recurrenceRule

      if (isNew) {
        // ── Create new event ──
        const newId = await createEvent({
          user_id:         session.user.id,
          title:           title.trim(),
          description:     description.trim() || null,
          start_time:      startUTC,
          end_time:        endUTC,
          all_day:         allDay,
          location_id:     resolvedLocationId,
          recurrence_rule: finalRule || null,
        })
        await saveCalendarMemberships(newId, selectedCalendarIds, session.user.id)

      } else if (scopeChosen === 'series' || !isRecurring) {
        // ── Edit entire series (or non-recurring event) ──
        await updateEvent(event!.id, {
          title:           title.trim(),
          description:     description.trim() || null,
          start_time:      startUTC,
          end_time:        endUTC,
          all_day:         allDay,
          location_id:     resolvedLocationId,
          recurrence_rule: finalRule || null,
        })
        await saveCalendarMemberships(event!.id, selectedCalendarIds, session.user.id)

      } else {
        // ── Edit just this occurrence: create an exception child row ──
        const newId = await createEvent({
          user_id:         session.user.id,
          title:           title.trim(),
          description:     description.trim() || null,
          start_time:      startUTC,
          end_time:        endUTC,
          all_day:         allDay,
          location_id:     resolvedLocationId,
          parent_event_id: event!.parent_event_id ?? event!.id,
          recurrence_id:   occurrenceStart ? new Date(occurrenceStart).toISOString() : startUTC,
        })
        await saveCalendarMemberships(newId, selectedCalendarIds, session.user.id)
      }

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
      setSaving(false)
    }
  }

  // ─── Delete ──────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!event) return

    const removingOccurrence = (isRecurring && scopeChosen === 'this') || isOverride
    if (!confirm(removingOccurrence
      ? 'Remove this occurrence? The rest of the series will be unaffected.'
      : 'Delete this event? This cannot be undone.')) return

    setSaving(true)
    setError(null)

    try {
      if (isRecurring && scopeChosen === 'this') {
        // Cancel one occurrence of a master recurring event
        await cancelOccurrence(
          session.user.id,
          event.parent_event_id ?? event.id,
          occurrenceStart ?? event.start_time,
          event.title,
          event.all_day
        )
      } else if (isOverride) {
        // Cancel an already-edited override row (flip is_cancelled, don't delete the row)
        await cancelOverride(event.id)
      } else {
        // Delete the event entirely (cascades to children via foreign key)
        await deleteEvent(event.id)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
      setSaving(false)
    }
  }

  // ─── Derived label ───────────────────────────────────────────────────────

  const editingLabel = isNew
    ? 'New Event'
    : (scopeChosen === 'this' || isOverride) ? 'Edit This Occurrence' : 'Edit Event'

  return {
    scopeChosen, setScopeChosen,
    isNew, isRecurring, isOverride, editingLabel,
    title, setTitle,
    description, setDescription,
    startDateTime, setStartDateTime,
    endDateTime, setEndDateTime,
    allDay, setAllDay,
    locationName, setLocationName,
    locationId, setLocationId,
    recurrenceRule, setRecurrenceRule,
    recurrenceOptions, isCustomRecurrenceRule,
    customInterval, setCustomInterval,
    customDays, setCustomDays,
    customEndType, setCustomEndType,
    customEndDate, setCustomEndDate,
    customEndCount, setCustomEndCount,
    selectedCalendarIds, setSelectedCalendarIds,
    saving, error,
    handleSave, handleDelete,
  }
}
