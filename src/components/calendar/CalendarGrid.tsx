// Thin wrapper around the FullCalendar component.
// Owns the calendar ref and plugin list; receives events and handlers as props.

import { useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin     from '@fullcalendar/daygrid'
import timeGridPlugin    from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import rrulePlugin       from '@fullcalendar/rrule'
import type { EventInput, EventClickArg, DateSelectArg, DateClickArg, EventDropArg, DatesSetArg } from '@fullcalendar/core'
import { useMediaQuery } from '../../hooks/useMediaQuery'

interface CalendarGridProps {
  events:        EventInput[]
  onDateSelect:  (info: DateSelectArg)  => void
  onDateClick:   (info: DateClickArg)   => void
  onEventClick:  (info: EventClickArg)  => void
  onEventDrop:   (info: EventDropArg)   => void
  onDatesSet?:   (date: Date)           => void
}

export default function CalendarGrid({
  events,
  onDateSelect,
  onDateClick,
  onEventClick,
  onEventDrop,
  onDatesSet,
}: CalendarGridProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const isMobile = useMediaQuery('(max-width: 768px)')
  const touchStartX = useRef<number | null>(null)

  function handleDateSelect(info: DateSelectArg) {
    onDateSelect(info)
    calendarRef.current?.getApi().unselect()
  }

  function handleDatesSet(info: DatesSetArg) {
    onDatesSet?.(info.view.currentStart)
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    const THRESHOLD = 50
    if (delta > THRESHOLD) {
      calendarRef.current?.getApi().prev()
    } else if (delta < -THRESHOLD) {
      calendarRef.current?.getApi().next()
    }
    touchStartX.current = null
  }

  return (
    <div
      className="calendar-grid-wrapper"
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
    >
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
        initialView="dayGridMonth"
        timeZone="America/New_York"
        headerToolbar={{
          left:   isMobile ? 'today' : 'prev,next today',
          center: '',
          right:  'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        height="100%"
        events={events}
        selectable={true}
        selectMirror={true}
        editable={true}
        dayMaxEvents={true}
        nowIndicator={true}
        select={handleDateSelect}
        dateClick={onDateClick}
        eventClick={onEventClick}
        eventDrop={onEventDrop}
        datesSet={handleDatesSet}
        moreLinkClick="popover"
      />
    </div>
  )
}
