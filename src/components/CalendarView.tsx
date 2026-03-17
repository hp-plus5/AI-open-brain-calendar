import { useState, useEffect, useCallback, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import rrulePlugin from '@fullcalendar/rrule'
import JSZip from 'jszip'
import type { EventInput, EventClickArg, DateSelectArg, EventDropArg } from '@fullcalendar/core'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { CalendarEventWithLocation } from '../types/database'
import EventModal from './EventModal'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a UTC ISO string as an iCal-compatible UTC datetime (e.g. "20260301T090000Z") */
function toICalUTC(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** Compute an iCal duration string from two UTC ISO strings (e.g. "PT1H30M") */
function getDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `PT${hours}H${minutes}M`
}

/**
 * Transform CalendarEvent rows from Supabase into FullCalendar EventInput objects.
 *
 * Strategy:
 *  - Master recurring events   → use FullCalendar's rrule plugin with DTSTART + RRULE string.
 *                                 Cancelled child rows are supplied as `exdate` entries.
 *  - Override child events     → displayed as normal one-off events (different color).
 *  - Non-recurring single events → normal one-off events.
 *  - Cancelled child events    → excluded entirely (added to parent's exdate instead).
 */
function toFCEvents(dbEvents: CalendarEventWithLocation[]): EventInput[] {
  const masters = dbEvents.filter(e => !e.parent_event_id)
  const exceptions = dbEvents.filter(e => !!e.parent_event_id)

  // Group exceptions by their parent_event_id
  const byParent = new Map<string, CalendarEventWithLocation[]>()
  for (const exc of exceptions) {
    const key = exc.parent_event_id!
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(exc)
  }

  const fcEvents: EventInput[] = []

  for (const event of masters) {
    const children = byParent.get(event.id) ?? []
    const cancelled = children.filter(c => c.is_cancelled)
    const overrides = children.filter(c => !c.is_cancelled)

    const base: EventInput = {
      id: event.id,
      title: event.title,
      allDay: event.all_day,
      backgroundColor: '#3b82f6',
      borderColor: '#2563eb',
      extendedProps: { dbEvent: event },
    }

    if (event.recurrence_rule) {
      // Build DTSTART + RRULE string for the rrule plugin
      const dtstart = toICalUTC(event.start_time)
      const rruleStr = `DTSTART:${dtstart}\nRRULE:${event.recurrence_rule}`

      // Exdates: cancelled occurrences AND edited overrides.
      // Both must be excluded from the rrule expansion so the original occurrence
      // is not shown alongside the replacement override row.
      const exdates = [...cancelled, ...overrides]
        .map(c => c.recurrence_id)
        .filter((d): d is string => !!d)
        .map(d => toICalUTC(d))

      fcEvents.push({
        ...base,
        rrule: rruleStr,
        duration: event.end_time ? getDuration(event.start_time, event.end_time) : undefined,
        exdate: exdates.length > 0 ? exdates : undefined,
      })

      // Override (edited) occurrences: same color as the master so they read as
      // part of the same series. Spread `base` to inherit master colors, then
      // replace only the fields that are specific to this override instance.
      for (const ov of overrides) {
        fcEvents.push({
          ...base,
          id: ov.id,
          title: ov.title,
          start: ov.start_time,
          end: ov.end_time ?? undefined,
          allDay: ov.all_day,
          extendedProps: { dbEvent: ov, isException: true },
        })
      }
    } else {
      // Non-recurring single event
      fcEvents.push({
        ...base,
        start: event.start_time,
        end: event.end_time ?? undefined,
      })
    }
  }

  return fcEvents
}

// ─── ICS Generation ───────────────────────────────────────────────────────────

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function foldICSLine(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let remaining = line
  let first = true
  while (remaining.length > 0) {
    const limit = first ? 75 : 74
    chunks.push(remaining.slice(0, limit))
    remaining = remaining.slice(limit)
    first = false
  }
  return chunks.join('\r\n ')
}

function generateICS(
  calendarName: string,
  masterEvents: CalendarEventWithLocation[],
  allEvents: CalendarEventWithLocation[]
): string {
  const childrenByParent = new Map<string, CalendarEventWithLocation[]>()
  for (const e of allEvents) {
    if (!e.parent_event_id) continue
    if (!childrenByParent.has(e.parent_event_id)) childrenByParent.set(e.parent_event_id, [])
    childrenByParent.get(e.parent_event_id)!.push(e)
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Open Brain Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(calendarName)}`,
  ]

  const stamp = toICalUTC(new Date().toISOString())

  for (const event of masterEvents) {
    const children = childrenByParent.get(event.id) ?? []
    const cancelled = children.filter(c => c.is_cancelled)
    const overrides = children.filter(c => !c.is_cancelled)

    const ev: string[] = ['BEGIN:VEVENT']
    ev.push(`UID:${event.id}@open-brain-calendar`)
    ev.push(`DTSTAMP:${stamp}`)

    if (event.all_day) {
      ev.push(`DTSTART;VALUE=DATE:${event.start_time.slice(0, 10).replace(/-/g, '')}`)
      if (event.end_time) ev.push(`DTEND;VALUE=DATE:${event.end_time.slice(0, 10).replace(/-/g, '')}`)
    } else {
      ev.push(`DTSTART:${toICalUTC(event.start_time)}`)
      if (event.end_time) ev.push(`DTEND:${toICalUTC(event.end_time)}`)
    }

    ev.push(`SUMMARY:${escapeICS(event.title)}`)
    if (event.description) ev.push(`DESCRIPTION:${escapeICS(event.description)}`)
    if (event.locations?.address) ev.push(`LOCATION:${escapeICS(event.locations.address)}`)
    if (event.recurrence_rule) ev.push(`RRULE:${event.recurrence_rule}`)

    for (const c of cancelled) {
      if (c.recurrence_id) ev.push(`EXDATE:${toICalUTC(c.recurrence_id)}`)
    }

    ev.push('END:VEVENT')
    lines.push(...ev.map(foldICSLine))

    // Override occurrences as separate VEVENTs with RECURRENCE-ID
    for (const ov of overrides) {
      const ovLines: string[] = ['BEGIN:VEVENT']
      ovLines.push(`UID:${event.id}@open-brain-calendar`)
      ovLines.push(`DTSTAMP:${stamp}`)
      if (ov.recurrence_id) ovLines.push(`RECURRENCE-ID:${toICalUTC(ov.recurrence_id)}`)

      if (ov.all_day) {
        ovLines.push(`DTSTART;VALUE=DATE:${ov.start_time.slice(0, 10).replace(/-/g, '')}`)
        if (ov.end_time) ovLines.push(`DTEND;VALUE=DATE:${ov.end_time.slice(0, 10).replace(/-/g, '')}`)
      } else {
        ovLines.push(`DTSTART:${toICalUTC(ov.start_time)}`)
        if (ov.end_time) ovLines.push(`DTEND:${toICalUTC(ov.end_time)}`)
      }

      ovLines.push(`SUMMARY:${escapeICS(ov.title)}`)
      if (ov.description) ovLines.push(`DESCRIPTION:${escapeICS(ov.description)}`)
      ovLines.push('END:VEVENT')
      lines.push(...ovLines.map(foldICSLine))
    }
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// ─── CalendarView ─────────────────────────────────────────────────────────────

interface ModalState {
  event: CalendarEventWithLocation | null
  occurrenceStart?: string
  showScopeChoice: boolean
  defaultStart?: string
  defaultEnd?: string
  defaultAllDay?: boolean
}

interface CalendarViewProps {
  session: Session
}

export default function CalendarView({ session }: CalendarViewProps) {
  const [fcEvents, setFcEvents] = useState<EventInput[]>([])
  const [modal, setModal] = useState<ModalState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const calendarRef = useRef<FullCalendar>(null)

  // ─── Data Loading ────────────────────────────────────────────────────────

  const loadEvents = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*, locations(id, name, address)')
      .order('start_time', { ascending: true })

    if (error) {
      setLoadError(error.message)
      return
    }

    const events = (data ?? []) as CalendarEventWithLocation[]
    setFcEvents(toFCEvents(events))
  }, [])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  // ─── Sign Out ────────────────────────────────────────────────────────────

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  // ─── Calendar Interactions ───────────────────────────────────────────────

  /** Clicking a date/time slot opens the modal to create a new event */
  function handleDateSelect(selectInfo: DateSelectArg) {
    setModal({
      event: null,
      showScopeChoice: false,
      defaultStart: selectInfo.startStr,
      defaultEnd: selectInfo.endStr,
      defaultAllDay: selectInfo.allDay,
    })
    // Clear the selection highlight
    calendarRef.current?.getApi().unselect()
  }

  /** Clicking an existing event opens edit modal */
  function handleEventClick(clickInfo: EventClickArg) {
    const dbEvent = clickInfo.event.extendedProps.dbEvent as CalendarEventWithLocation
    const isRecurring = !!dbEvent.recurrence_rule && !dbEvent.parent_event_id
    const occurrenceStart = clickInfo.event.startStr  // the clicked occurrence's UTC start

    setModal({
      event: dbEvent,
      occurrenceStart,
      showScopeChoice: isRecurring,
      defaultStart: undefined,
      defaultEnd: undefined,
    })
  }

  /**
   * Drag-and-drop: update start/end time.
   * For recurring events, always creates an exception child row for just this occurrence.
   * For non-recurring events, updates the row in place.
   */
  async function handleEventDrop(dropInfo: EventDropArg) {
    const dbEvent = dropInfo.event.extendedProps.dbEvent as CalendarEventWithLocation
    const isRecurring = !!dbEvent.recurrence_rule && !dbEvent.parent_event_id
    const newStart = dropInfo.event.startStr
    const newEnd = dropInfo.event.endStr || null

    if (isRecurring) {
      // Create a child exception row for this moved occurrence
      const originalStart = dropInfo.oldEvent.startStr
      const { error } = await supabase.from('calendar_events').insert({
        user_id: session.user.id,
        title: dbEvent.title,
        description: dbEvent.description,
        start_time: newStart,
        end_time: newEnd,
        all_day: dbEvent.all_day,
        location_id: dbEvent.location_id,
        parent_event_id: dbEvent.parent_event_id ?? dbEvent.id,
        recurrence_id: originalStart,
        is_cancelled: false,
      })
      if (error) {
        alert(`Error moving event: ${error.message}`)
        dropInfo.revert()
        return
      }
    } else {
      // Update the existing row
      const { error } = await supabase
        .from('calendar_events')
        .update({ start_time: newStart, end_time: newEnd })
        .eq('id', dbEvent.id)
      if (error) {
        alert(`Error moving event: ${error.message}`)
        dropInfo.revert()
        return
      }
    }

    void loadEvents()
  }

  // ─── Modal Close + Saved ─────────────────────────────────────────────────

  function closeModal() {
    setModal(null)
  }

  function handleSaved() {
    setModal(null)
    void loadEvents()
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="calendar-layout">
      <header className="calendar-topbar">
        <span className="calendar-topbar-title">Open Brain Calendar</span>
        <div className="calendar-topbar-actions">
          <button
            className="btn btn-primary"
            onClick={() => setModal({ event: null, showScopeChoice: false })}
          >
            + New Event
          </button>
          <button className="btn btn-ghost" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="calendar-content">
        <aside className="calendar-sidebar">
          <div className="sidebar-section-title">Calendars</div>
          {calendars.map(cal => (
            <div key={cal.id} className="sidebar-calendar-item">
              <label className="sidebar-calendar-label">
                <input
                  type="checkbox"
                  className="sidebar-calendar-checkbox"
                  checked={!hiddenCalendarIds.has(cal.id)}
                  onChange={() => handleToggleCalendar(cal.id)}
                />
                <span className="sidebar-calendar-dot" style={{ backgroundColor: cal.color }} />
                {renamingCalendarId === cal.id ? (
                  <input
                    className="sidebar-calendar-rename-input"
                    value={renamingCalendarName}
                    autoFocus
                    onChange={e => setRenamingCalendarName(e.target.value)}
                    onBlur={() => void commitRenameCalendar(cal.id)}
                    onKeyDown={e => handleRenameKeyDown(e, cal.id)}
                    onClick={e => e.preventDefault()}
                  />
                ) : (
                  <span className="sidebar-calendar-name">{cal.name}</span>
                )}
              </label>
              <div className="sidebar-calendar-actions">
                <button
                  className="sidebar-export-btn"
                  title={`Rename ${cal.name}`}
                  onClick={() => startRenamingCalendar(cal)}
                >
                  ✎
                </button>
              </div>
            </div>
          ))}
        </aside>

        <div className="calendar-main">
          {loadError && (
            <div className="error-banner" style={{ marginBottom: 12 }}>
              Failed to load events: {loadError}
            </div>
          )}
          <div className="fc-wrapper">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
              initialView="dayGridMonth"
              timeZone="America/New_York"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay',
              }}
              height="100%"
              events={fcEvents}
              selectable={true}
              selectMirror={true}
              editable={true}
              dayMaxEvents={true}
              nowIndicator={true}
              select={handleDateSelect}
              eventClick={handleEventClick}
              eventDrop={handleEventDrop}
              moreLinkClick="popover"
            />
          </div>
        )}

        <div className="fc-wrapper">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
            initialView="dayGridMonth"
            timeZone="America/New_York"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay',
            }}
            height="100%"
            events={fcEvents}
            selectable={true}
            selectMirror={true}
            editable={true}
            dayMaxEvents={true}     // "more" link when too many events per day
            nowIndicator={true}
            select={handleDateSelect}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            // Clicking the "more" link opens a popover with event list
            moreLinkClick="popover"
          />
        </div>
      </div>

      {modal && (
        <EventModal
          event={modal.event}
          occurrenceStart={modal.occurrenceStart}
          showScopeChoice={modal.showScopeChoice}
          defaultStart={modal.defaultStart}
          defaultEnd={modal.defaultEnd}
          defaultAllDay={modal.defaultAllDay}
          session={session}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
