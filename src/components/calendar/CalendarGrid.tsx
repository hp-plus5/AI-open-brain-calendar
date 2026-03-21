// Thin wrapper around the FullCalendar component.
// Owns the calendar ref and plugin list; receives events and handlers as props.

import { useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin     from '@fullcalendar/daygrid'
import timeGridPlugin    from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import rrulePlugin       from '@fullcalendar/rrule'
import type { EventInput, EventClickArg, DateSelectArg, DateClickArg, EventDropArg, DatesSetArg } from '@fullcalendar/core'

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

  function handleDateSelect(info: DateSelectArg) {
    onDateSelect(info)
    calendarRef.current?.getApi().unselect()
  }

  function handleDatesSet(info: DatesSetArg) {
    onDatesSet?.(info.view.currentStart)
  }

  return (
    <div className="calendar-grid-wrapper">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
        initialView="dayGridMonth"
        timeZone="America/New_York"
        headerToolbar={{
          left:   'prev,next today',
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
