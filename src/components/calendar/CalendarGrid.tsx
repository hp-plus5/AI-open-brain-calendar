// Thin wrapper around the FullCalendar component.
// Owns the calendar ref and plugin list; receives events and handlers as props.

import React, { useRef, useState, useEffect } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin     from '@fullcalendar/daygrid'
import timeGridPlugin    from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import rrulePlugin       from '@fullcalendar/rrule'
import type { EventInput, EventClickArg, DateSelectArg, DateClickArg, EventDropArg, DatesSetArg } from '@fullcalendar/core'
import { useMediaQuery } from '../../hooks/useMediaQuery'

const DEFAULT_SLOT_HEIGHT = 24
const MIN_SLOT_HEIGHT     = 8
const MAX_SLOT_HEIGHT     = 80

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }
function touchDist(a: Touch, b: Touch) {
  return Math.sqrt((a.clientX - b.clientX) ** 2 + (a.clientY - b.clientY) ** 2)
}
function isInTimeGrid(t: EventTarget | null) {
  const el = t as Element | null
  if (!el) return false
  // Match elements inside the scrollable time grid body, or the scroller
  // container itself (e.g. when the cursor is over the native scrollbar).
  if (el.closest('.fc-timegrid-body')) return true
  const scroller = el.closest('.fc-scroller')
  return !!(scroller?.querySelector('.fc-timegrid-body'))
}

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
  const calendarRef  = useRef<FullCalendar>(null)
  const wrapperRef   = useRef<HTMLDivElement>(null)
  const isMobile     = useMediaQuery('(max-width: 768px)')
  const isMobileRef  = useRef(isMobile)

  const [slotMinHeight, setSlotMinHeight] = useState(DEFAULT_SLOT_HEIGHT)
  const slotMinHeightRef    = useRef(DEFAULT_SLOT_HEIGHT)
  const touchStartX         = useRef<number | null>(null)
  const pinchStartDistRef   = useRef<number | null>(null)
  const pinchStartHeightRef = useRef(DEFAULT_SLOT_HEIGHT)
  const animationFrameRef   = useRef<number | null>(null)

  useEffect(() => { isMobileRef.current = isMobile }, [isMobile])
  useEffect(() => { slotMinHeightRef.current = slotMinHeight }, [slotMinHeight])

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return

    function onTouchStart(e: TouchEvent) {
      if (!isMobileRef.current) return
      if (e.touches.length === 2 && isInTimeGrid(e.target)) {
        e.preventDefault()
        pinchStartDistRef.current   = touchDist(e.touches[0], e.touches[1])
        pinchStartHeightRef.current = slotMinHeightRef.current
        touchStartX.current         = null
      } else if (e.touches.length === 1) {
        touchStartX.current       = e.touches[0].clientX
        pinchStartDistRef.current = null
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!isMobileRef.current) return
      if (
        e.touches.length === 2 &&
        pinchStartDistRef.current !== null &&
        isInTimeGrid(e.target)
      ) {
        e.preventDefault()
        const scale     = touchDist(e.touches[0], e.touches[1]) / pinchStartDistRef.current
        const newHeight = clamp(Math.round(pinchStartHeightRef.current * scale), MIN_SLOT_HEIGHT, MAX_SLOT_HEIGHT)
        cancelAnimationFrame(animationFrameRef.current!)
        animationFrameRef.current = requestAnimationFrame(() => setSlotMinHeight(newHeight))
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (pinchStartDistRef.current !== null) {
        pinchStartDistRef.current = null
        touchStartX.current       = null
        return
      }
      if (touchStartX.current === null) return
      const delta     = e.changedTouches[0].clientX - touchStartX.current
      const THRESHOLD = 50
      if (delta > THRESHOLD) {
        calendarRef.current?.getApi().prev()
      } else if (delta < -THRESHOLD) {
        calendarRef.current?.getApi().next()
      }
      touchStartX.current = null
    }

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      if (!isInTimeGrid(e.target)) return
      e.preventDefault()
      // Real trackpad pinch on macOS fires tiny deltaY values (~1–5).
      // Scale by 0.5 and cap at 8 so mouse-wheel Ctrl+scroll isn't too jumpy.
      // Negate because spread fingers (zoom in = taller slots) fires deltaY < 0.
      const delta = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) * 0.5, 8)
      setSlotMinHeight(prev => clamp(Math.round(prev + delta), MIN_SLOT_HEIGHT, MAX_SLOT_HEIGHT))
    }

    // Use capture phase so we see the event before any FullCalendar internal
    // handlers that might call stopPropagation on the same element.
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd)
    el.addEventListener('wheel',      onWheel,      { passive: false, capture: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
      el.removeEventListener('wheel',      onWheel,      { capture: true })
    }
  }, [])

  function handleDateSelect(info: DateSelectArg) {
    onDateSelect(info)
    calendarRef.current?.getApi().unselect()
  }

  function handleDatesSet(info: DatesSetArg) {
    onDatesSet?.(info.view.currentStart)
  }

  return (
    <div
      ref={wrapperRef}
      className="calendar-grid-wrapper"
      style={{ '--slot-height': `${slotMinHeight}px` } as React.CSSProperties}
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
