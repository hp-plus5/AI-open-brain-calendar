// Thin wrapper around the FullCalendar component.
// Owns the calendar ref and plugin list; receives events and handlers as props.

import { useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin     from '@fullcalendar/daygrid'
import timeGridPlugin    from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import rrulePlugin       from '@fullcalendar/rrule'
import type { EventInput, EventClickArg, DateSelectArg, EventDropArg } from '@fullcalendar/core'

interface CalendarGridProps {
  events:        EventInput[]
  onDateSelect:  (info: DateSelectArg)  => void
  onEventClick:  (info: EventClickArg)  => void
  onEventDrop:   (info: EventDropArg)   => void
}

export default function CalendarGrid({
  events,
  onDateSelect,
  onEventClick,
  onEventDrop,
}: CalendarGridProps) {
  const calendarRef = useRef<FullCalendar>(null)

  function handleDateSelect(info: DateSelectArg) {
    onDateSelect(info)
    calendarRef.current?.getApi().unselect()
  }

  return (
    <div className="fc-wrapper">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
        initialView="dayGridMonth"
        timeZone="America/New_York"
        headerToolbar={{
          left:   'prev,next today',
          center: 'title',
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
        eventClick={onEventClick}
        eventDrop={onEventDrop}
        moreLinkClick="popover"
      />
    </div>
  )
}
