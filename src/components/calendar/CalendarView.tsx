// Top-level view: owns modal state and event-drop handling; composes everything else.

import { useState, useMemo } from 'react'
import type { EventClickArg, DateSelectArg, EventDropArg } from '@fullcalendar/core'
import type { Session } from '@supabase/supabase-js'
import type { CalendarEventWithLocation } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useCalendarData } from '../../hooks/useCalendarData'
import { useCalendarActions } from '../../hooks/useCalendarActions'
import { toFullCalendarEvents, getEventCalendarIds } from '../../utils/calendarTransform'
import { fullCalendarStringToUTC } from '../../utils/timezone'
import { dropRecurringOccurrence, copyCalendarMemberships, updateEvent } from '../../services/eventService'
import CalendarGrid from './CalendarGrid'
import CalendarSidebar from './CalendarSidebar'
import EventModal from '../event/EventModal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModalState {
  event:              CalendarEventWithLocation | null
  occurrenceStart?:   string
  showScopeChoice:    boolean
  defaultStart?:      string
  defaultEnd?:        string
  defaultAllDay?:     boolean
  initialCalendarIds: string[]
}

interface CalendarViewProps {
  session: Session
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CalendarView({ session }: CalendarViewProps) {
  const {
    dbEvents, calendars, eventCalendarsMap, loadError,
    reload, setCalendars,
  } = useCalendarData(session.user.id)

  // When a calendar is renamed, update it in local state immediately so the
  // sidebar reflects the new name without waiting for a full data reload.
  const actions = useCalendarActions((calendarId, newName) => {
    setCalendars(prev => prev.map(calendar =>
      calendar.id === calendarId ? { ...calendar, name: newName } : calendar
    ))
  })

  const [modal, setModal] = useState<ModalState | null>(null)

  // ─── FullCalendar event list (memoized) ─────────────────────────────────

  // Re-computed only when the underlying data or hidden-calendar set changes.
  const fullCalendarEvents = useMemo(
    () => toFullCalendarEvents(dbEvents, calendars, eventCalendarsMap, actions.hiddenCalendarIds),
    [dbEvents, calendars, eventCalendarsMap, actions.hiddenCalendarIds]
  )

  // ─── Calendar interactions ──────────────────────────────────────────────

  function handleDateSelect(selectInfo: DateSelectArg) {
    setModal({
      event:              null,
      showScopeChoice:    false,
      // Convert the FullCalendar floating-time string to a UTC ISO string
      defaultStart:       fullCalendarStringToUTC(selectInfo.startStr),
      defaultEnd:         fullCalendarStringToUTC(selectInfo.endStr),
      defaultAllDay:      selectInfo.allDay,
      initialCalendarIds: [],
    })
  }

  function handleEventClick(clickInfo: EventClickArg) {
    const dbEvent       = clickInfo.event.extendedProps.dbEvent as CalendarEventWithLocation
    const isRecurring   = !!dbEvent.recurrence_rule && !dbEvent.parent_event_id
    const occurrenceStart = fullCalendarStringToUTC(clickInfo.event.startStr)
    const calendarIds   = getEventCalendarIds(dbEvent, eventCalendarsMap)

    setModal({
      event:              dbEvent,
      occurrenceStart,
      showScopeChoice:    isRecurring,
      initialCalendarIds: calendarIds,
    })
  }

  async function handleEventDrop(dropInfo: EventDropArg) {
    const dbEvent     = dropInfo.event.extendedProps.dbEvent as CalendarEventWithLocation
    const isRecurring = !!dbEvent.recurrence_rule && !dbEvent.parent_event_id
    const newStart    = fullCalendarStringToUTC(dropInfo.event.startStr)
    const newEnd      = dropInfo.event.endStr ? fullCalendarStringToUTC(dropInfo.event.endStr) : null

    try {
      if (isRecurring) {
        // Dragging one occurrence of a recurring event creates an exception child row.
        const originalStart = fullCalendarStringToUTC(dropInfo.oldEvent.startStr)
        const newId = await dropRecurringOccurrence(
          session.user.id, dbEvent, originalStart, newStart, newEnd
        )
        // Copy parent's calendar memberships to the new exception row so it
        // appears in the same calendars as the rest of the series.
        const parentId = dbEvent.parent_event_id ?? dbEvent.id
        await copyCalendarMemberships(parentId, newId, session.user.id, eventCalendarsMap)
      } else {
        await updateEvent(dbEvent.id, { start_time: newStart, end_time: newEnd })
      }
      reload()
    } catch (e) {
      alert(`Error moving event: ${e instanceof Error ? e.message : String(e)}`)
      dropInfo.revert()
    }
  }

  // ─── Modal ──────────────────────────────────────────────────────────────

  function closeModal()  { setModal(null) }
  function handleSaved() { setModal(null); reload() }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="calendar-layout">
      <header className="calendar-topbar">
        <span className="calendar-topbar-title">Open Brain Calendar</span>
        <div className="calendar-topbar-actions">
          <button
            className="btn btn-primary"
            onClick={() => setModal({ event: null, showScopeChoice: false, initialCalendarIds: [] })}
          >
            + New Event
          </button>
          <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="calendar-content">
        <CalendarSidebar
          calendars={calendars}
          hiddenCalendarIds={actions.hiddenCalendarIds}
          renamingCalendarId={actions.renamingCalendarId}
          renamingCalendarName={actions.renamingCalendarName}
          onToggle={actions.handleToggleCalendar}
          onStartRename={actions.startRenamingCalendar}
          onRenameChange={actions.setRenamingCalendarName}
          onRenameCommit={actions.commitRenameCalendar}
          onRenameKeyDown={actions.handleRenameKeyDown}
          onExport={actions.handleExportCalendar}
        />

        <div className="calendar-main">
          {loadError && (
            <div className="error-banner" style={{ marginBottom: 12 }}>
              Failed to load events: {loadError}
            </div>
          )}
          <CalendarGrid
            events={fullCalendarEvents}
            onDateSelect={handleDateSelect}
            onEventClick={handleEventClick}
            onEventDrop={handleEventDrop}
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
          calendars={calendars}
          initialCalendarIds={modal.initialCalendarIds}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
