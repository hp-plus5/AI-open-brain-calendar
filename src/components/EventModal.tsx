import { useState, useEffect } from 'react'
import { toZonedTime, fromZonedTime, format as tzFormat } from 'date-fns-tz'
import type { CalendarEventWithLocation, Calendar } from '../types/database'
import LocationPicker from './LocationPicker'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

const TZ = 'America/New_York'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a UTC ISO string to an Eastern Time datetime-local string ("YYYY-MM-DDTHH:mm") */
function utcToEasternInput(utcIso: string): string {
  const zoned = toZonedTime(new Date(utcIso), TZ)
  return tzFormat(zoned, "yyyy-MM-dd'T'HH:mm", { timeZone: TZ })
}

/** Convert a datetime-local string (interpreted as Eastern Time) back to UTC ISO */
function easternInputToUTC(localStr: string): string {
  return fromZonedTime(new Date(localStr), TZ).toISOString()
}

/**
 * Convert an ISO string to a datetime-local input value ("YYYY-MM-DDTHH:mm").
 * All-day events: take the UTC date portion as-is — no timezone conversion.
 *   Reason: all-day events are stored as UTC midnight; converting to Eastern time
 *   would shift them to the previous day (e.g. 2026-03-15T00:00Z → 2026-03-14T19:00 ET).
 * Timed events: convert from UTC to Eastern Time for display.
 */
function toInputDT(isoStr: string, isAllDay: boolean): string {
  if (isAllDay) return isoStr.slice(0, 10) + 'T00:00'
  return utcToEasternInput(isoStr)
}

/** Derive a weekly BYDAY string from a Date (e.g. "MO") */
function weekdayAbbr(d: Date): string {
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getDay()]
}

/**
 * Given a clicked occurrence's start (UTC ISO or date-only string), compute the
 * occurrence's end time as a datetime-local input string, preserving the master
 * event's duration.
 */
function computeOccurrenceEndInput(
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

// ─── Custom Recurrence Builder ─────────────────────────────────────────────────

const WEEKDAYS = [
  { abbr: 'SU', label: 'Su' },
  { abbr: 'MO', label: 'Mo' },
  { abbr: 'TU', label: 'Tu' },
  { abbr: 'WE', label: 'We' },
  { abbr: 'TH', label: 'Th' },
  { abbr: 'FR', label: 'Fr' },
  { abbr: 'SA', label: 'Sa' },
] as const

type CustomEndType = 'never' | 'date' | 'count'

interface CustomRecur {
  interval:  number
  days:      string[]
  endType:   CustomEndType
  endDate:   string   // YYYY-MM-DD
  endCount:  number
}

/**
 * Parse a FREQ=WEEKLY RRULE string into the structured fields used by the
 * custom builder. Returns safe defaults for non-weekly or unrecognised rules.
 */
function parseCustomRrule(rrule: string): CustomRecur {
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
function buildCustomRrule(c: CustomRecur): string {
  let rule = 'FREQ=WEEKLY'
  if (c.interval > 1)               rule += `;INTERVAL=${c.interval}`
  if (c.days.length > 0)            rule += `;BYDAY=${c.days.join(',')}`
  if (c.endType === 'count' && c.endCount > 0)  rule += `;COUNT=${c.endCount}`
  else if (c.endType === 'date' && c.endDate)   rule += `;UNTIL=${c.endDate.replace(/-/g, '')}T000000Z`
  return rule
}

// ─── Recurrence Preset Options ────────────────────────────────────────────────

function getRecurrenceOptions(startDateStr: string) {
  const day = weekdayAbbr(new Date(startDateStr))
  return [
    { label: 'Does not repeat', value: '' },
    { label: 'Every day', value: 'FREQ=DAILY' },
    { label: `Every week on ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(startDateStr).getDay()]}`, value: `FREQ=WEEKLY;BYDAY=${day}` },
    { label: 'Every weekday (Mon–Fri)', value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { label: 'Every month', value: 'FREQ=MONTHLY' },
    { label: 'Every year', value: 'FREQ=YEARLY' },
    { label: 'Custom…', value: '__custom__' },
  ]
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditScope = 'this' | 'series'

export interface EventModalProps {
  /** If null, we're creating a new event */
  event: CalendarEventWithLocation | null
  /** For recurring events: which occurrence was clicked (UTC ISO) */
  occurrenceStart?: string
  /** Whether to show the recurrence-scope choice before the form */
  showScopeChoice?: boolean
  /** Default start/end time (Eastern) for new events from calendar click */
  defaultStart?: string
  defaultEnd?: string
  defaultAllDay?: boolean
  session: Session
  /** All calendars for the current user */
  calendars: Calendar[]
  /** Calendar IDs already associated with this event (pre-selects checkboxes) */
  initialCalendarIds: string[]
  onClose: () => void
  /** Called after a successful save or delete so CalendarView can refresh */
  onSaved: () => void
}

// ─── Recurrence Scope Choice ──────────────────────────────────────────────────

function RecurrenceScopeChoice({
  onChoose,
  onClose,
}: {
  onChoose: (scope: EditScope) => void
  onClose: () => void
}) {
  return (
    <div className="modal-overlay">
      <div className="modal recurrence-choice-modal">
        <div className="modal-header">
          <h2>Edit recurring event</h2>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="recurrence-choice-option" onClick={() => onChoose('this')}>
            <div>
              <div className="recurrence-choice-option-title">This event</div>
              <div className="recurrence-choice-option-desc">
                Only this occurrence is changed. Other instances stay the same.
              </div>
            </div>
          </div>
          <div className="recurrence-choice-option" onClick={() => onChoose('series')}>
            <div>
              <div className="recurrence-choice-option-title">All events in the series</div>
              <div className="recurrence-choice-option-desc">
                Every occurrence is updated, including past and future ones.
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

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
  const isNew = event === null
  const isRecurring = !!event?.recurrence_rule && !event?.parent_event_id
  // An override row is a child exception that was previously edited (parent_event_id is set,
  // recurrence_rule is null). It needs special delete handling — see handleDelete below.
  const isOverride = !isNew && !!event?.parent_event_id

  // If this is a recurring event click, show scope choice first
  const [scopeChosen, setScopeChosen] = useState<EditScope | null>(
    showScopeChoice && isRecurring ? null : 'series'
  )

  // ─── Form State ───────────────────────────────────────────────────────────

  // For all-day events, dates are pure calendar dates (no timezone conversion).
  // utcToEasternInput("2026-03-15T00:00:00Z") → "2026-03-14T19:00" which is wrong.
  // All-day dates stored as UTC midnight: just take the YYYY-MM-DD portion as-is.
  const isAllDayEvent = event?.all_day ?? defaultAllDay

  const defaultStartET = defaultStart
    ? toInputDT(defaultStart, defaultAllDay)
    : utcToEasternInput(new Date().toISOString()).slice(0, 16)

  const defaultEndET = defaultEnd
    ? toInputDT(defaultEnd, defaultAllDay)
    : ''

  const [title, setTitle] = useState(event?.title ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [startDT, setStartDT] = useState<string>(
    event
      ? toInputDT(
          scopeChosen === 'this' && occurrenceStart ? occurrenceStart : event.start_time,
          isAllDayEvent
        )
      : defaultStartET
  )
  const [endDT, setEndDT] = useState<string>(
    event?.end_time ? toInputDT(event.end_time, isAllDayEvent) : defaultEndET
  )
  const [allDay, setAllDay] = useState(event?.all_day ?? defaultAllDay)
  const [locationName, setLocationName] = useState(event?.locations?.name ?? '')
  const [locationId, setLocationId] = useState<string | null>(event?.location_id ?? null)
  const [recurrenceRule, setRecurrenceRule] = useState(event?.recurrence_rule ?? '')

  // Custom recurrence builder — pre-populated from existing rule when editing
  const initialCustom = parseCustomRrule(event?.recurrence_rule ?? '')
  const [customInterval, setCustomInterval]   = useState(initialCustom.interval)
  const [customDays,     setCustomDays]       = useState<string[]>(initialCustom.days)
  const [customEndType,  setCustomEndType]    = useState<CustomEndType>(initialCustom.endType)
  const [customEndDate,  setCustomEndDate]    = useState(initialCustom.endDate)
  const [customEndCount, setCustomEndCount]   = useState(initialCustom.endCount)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>(initialCalendarIds)

  // Update startDT/endDT when scope is chosen (for 'this', use the clicked occurrence time)
  useEffect(() => {
    if (event && scopeChosen === 'this' && occurrenceStart) {
      setStartDT(toInputDT(occurrenceStart, event.all_day))
      // Recompute end time: occurrence start + master event duration
      if (event.end_time) {
        setEndDT(computeOccurrenceEndInput(
          occurrenceStart,
          event.start_time,
          event.end_time,
          event.all_day
        ))
      }
    }
  }, [scopeChosen, event, occurrenceStart])

  const recurrenceOptions = getRecurrenceOptions(startDT)
  const isCustomRrule = recurrenceRule && !recurrenceOptions.some(o => o.value === recurrenceRule && o.value !== '__custom__')

  // If we haven't chosen scope yet, show the choice dialog
  if (showScopeChoice && isRecurring && scopeChosen === null) {
    return <RecurrenceScopeChoice onChoose={setScopeChosen} onClose={onClose} />
  }

  // ─── Calendar Memberships ──────────────────────────────────────────────────

  async function saveCalendarMemberships(eventId: string) {
    // Replace existing memberships for this event
    await supabase.from('calendar_event_calendars').delete().eq('event_id', eventId)
    if (selectedCalendarIds.length > 0) {
      const { error: linkErr } = await supabase.from('calendar_event_calendars').insert(
        selectedCalendarIds.map(calId => ({
          event_id: eventId,
          calendar_id: calId,
          user_id: session.user.id,
        }))
      )
      if (linkErr) throw linkErr
    }
  }

  // ─── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!title.trim()) { setError('Title is required'); return }
    if (!startDT) { setError('Start time is required'); return }
    setSaving(true)
    setError(null)

    try {
      // If location name is set but no id, create the location row first
      let resolvedLocationId = locationId
      if (locationName.trim() && !locationId) {
        const { data: loc, error: locErr } = await supabase
          .from('locations')
          .insert({ user_id: session.user.id, name: locationName.trim() })
          .select('id')
          .single()
        if (locErr) throw locErr
        resolvedLocationId = loc.id
      } else if (!locationName.trim()) {
        resolvedLocationId = null
      }

      const startUTC = allDay ? startDT.slice(0, 10) + 'T00:00:00.000Z' : easternInputToUTC(startDT)
      const endUTC = endDT ? (allDay ? endDT.slice(0, 10) + 'T00:00:00.000Z' : easternInputToUTC(endDT)) : null
      const inCustomMode = recurrenceRule === '__custom__' || Boolean(isCustomRrule)
      const finalRrule = inCustomMode
        ? buildCustomRrule({ interval: customInterval, days: customDays, endType: customEndType, endDate: customEndDate, endCount: customEndCount })
        : recurrenceRule

      if (isNew) {
        // ── Create new event ──
        const { data: newRow, error: err } = await supabase
          .from('calendar_events')
          .insert({
            user_id: session.user.id,
            title: title.trim(),
            description: description.trim() || null,
            start_time: startUTC,
            end_time: endUTC,
            all_day: allDay,
            location_id: resolvedLocationId,
            recurrence_rule: finalRrule || null,
          })
          .select('id')
          .single()
        if (err) throw err
        await saveCalendarMemberships(newRow.id)

      } else if (scopeChosen === 'series' || !isRecurring) {
        // ── Edit entire series (or non-recurring event) ──
        const { error: err } = await supabase
          .from('calendar_events')
          .update({
            title: title.trim(),
            description: description.trim() || null,
            start_time: startUTC,
            end_time: endUTC,
            all_day: allDay,
            location_id: resolvedLocationId,
            recurrence_rule: finalRrule || null,
          })
          .eq('id', event!.id)
        if (err) throw err
        await saveCalendarMemberships(event!.id)

      } else {
        // ── Edit just this occurrence: create an exception child row ──
        const { data: newRow, error: err } = await supabase
          .from('calendar_events')
          .insert({
            user_id: session.user.id,
            title: title.trim(),
            description: description.trim() || null,
            start_time: startUTC,
            end_time: endUTC,
            all_day: allDay,
            location_id: resolvedLocationId,
            parent_event_id: event!.parent_event_id ?? event!.id,
            recurrence_id: occurrenceStart ? new Date(occurrenceStart).toISOString() : startUTC,
          })
          .select('id')
          .single()
        if (err) throw err
        await saveCalendarMemberships(newRow.id)
      }

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
      setSaving(false)
    }
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

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
        // Cancelling one occurrence of a master recurring event:
        // insert a cancelled child row so the rrule suppresses that date.
        const { error: err } = await supabase.from('calendar_events').insert({
          user_id: session.user.id,
          title: event.title,
          start_time: occurrenceStart ?? event.start_time,
          all_day: event.all_day,
          parent_event_id: event.parent_event_id ?? event.id,
          recurrence_id: occurrenceStart ?? event.start_time,
          is_cancelled: true,
        })
        if (err) throw err

      } else if (isOverride) {
        // Cancelling an already-edited occurrence (override row with parent_event_id set).
        // We must NOT delete the row — that would remove the recurrence_id anchor and let
        // the master's rrule regenerate the original occurrence.
        // Instead, flip is_cancelled = true so it stays as an exdate suppressor but
        // stops rendering as a visible one-off event.
        const { error: err } = await supabase
          .from('calendar_events')
          .update({ is_cancelled: true })
          .eq('id', event.id)
        if (err) throw err

      } else {
        // Delete the event entirely (cascades to child exception rows via FK).
        const { error: err } = await supabase
          .from('calendar_events')
          .delete()
          .eq('id', event.id)
        if (err) throw err
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
      setSaving(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const editingLabel = isNew
    ? 'New Event'
    : (scopeChosen === 'this' || isOverride)
      ? 'Edit This Occurrence'
      : 'Edit Event'

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{editingLabel}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

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
              onChange={(name, id) => { setLocationName(name); setLocationId(id) }}
            />
          </div>

          {/* Recurrence (only for new events or full-series edits) */}
          {(isNew || scopeChosen === 'series') && (
            <div className="form-group">
              <label htmlFor="evt-recur">Recurrence</label>
              <select
                id="evt-recur"
                value={isCustomRrule ? '__custom__' : recurrenceRule}
                onChange={e => {
                  if (e.target.value !== '__custom__') setRecurrenceRule(e.target.value)
                  else setRecurrenceRule('__custom__')
                }}
              >
                {getRecurrenceOptions(startDT).map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {(recurrenceRule === '__custom__' || Boolean(isCustomRrule)) && (
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
                      {WEEKDAYS.map(d => (
                        <button
                          key={d.abbr}
                          type="button"
                          aria-pressed={customDays.includes(d.abbr)}
                          title={['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][WEEKDAYS.findIndex(w => w.abbr === d.abbr)]}
                          className={`recur-day-btn${customDays.includes(d.abbr) ? ' active' : ''}`}
                          onClick={() => setCustomDays(prev =>
                            prev.includes(d.abbr) ? prev.filter(x => x !== d.abbr) : [...prev, d.abbr]
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

        <div className="modal-footer">
          {!isNew && (
            <div className="modal-footer-left">
              <button className="btn btn-danger" onClick={handleDelete} disabled={saving}>
                {(isRecurring && scopeChosen === 'this') || isOverride ? 'Remove occurrence' : 'Delete'}
              </button>
            </div>
          )}
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
