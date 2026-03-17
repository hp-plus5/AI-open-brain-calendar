import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { fromZonedTime } from 'date-fns-tz'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import rrulePlugin from '@fullcalendar/rrule'
import JSZip from 'jszip'
import type { EventInput, EventClickArg, DateSelectArg, EventDropArg } from '@fullcalendar/core'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { CalendarEventWithLocation, Calendar } from '../types/database'
import EventModal from './EventModal'

// ─── Default calendar definitions ─────────────────────────────────────────────

const DEFAULT_CALENDARS = [
  { name: 'Work Holidays',   color: '#dc2626' },
  { name: 'Family Schedule', color: '#16a34a' },
  { name: 'CLE Events',      color: '#d97706' },
  { name: 'Personal',        color: '#7c3aed' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a UTC ISO string as an iCal-compatible UTC datetime (e.g. "20260301T090000Z") */
function toICalUTC(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * Format a UTC ISO string as a FLOATING iCal datetime in America/New_York (no Z suffix).
 * FullCalendar's rrule plugin treats DTSTART as already being in the calendar's timezone,
 * not as UTC — so we must pass the local wall-clock time, not the UTC time.
 */
const FC_TIMEZONE = 'America/New_York'
function toICalFloating(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FC_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const p: Record<string, string> = {}
  for (const { type, value } of parts) p[type] = value
  const h = p.hour === '24' ? '00' : p.hour
  return `${p.year}${p.month}${p.day}T${h}${p.minute}${p.second}`
}

/**
 * FullCalendar returns floating local-time strings (no Z/offset) for rrule occurrences
 * and date selections. Interpret them as Eastern time and return a proper UTC ISO string.
 * Date-only strings (all-day) are returned as-is.
 */
function fcStartToUTC(startStr: string): string {
  if (!startStr) return startStr
  // Already offset-aware — normalize to UTC ISO
  if (startStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(startStr)) {
    return new Date(startStr).toISOString()
  }
  // Date-only (all-day): no timezone conversion needed
  if (/^\d{4}-\d{2}-\d{2}$/.test(startStr)) return startStr
  // Floating datetime: treat as Eastern wall-clock time → UTC
  return fromZonedTime(new Date(startStr), FC_TIMEZONE).toISOString()
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
 * Get the effective calendar IDs for an event.
 * Exception/override rows fall back to the parent's calendars if they have none.
 */
function getEventCalendarIds(
  event: CalendarEventWithLocation,
  map: Map<string, string[]>
): string[] {
  const own = map.get(event.id) ?? []
  if (own.length > 0) return own
  if (event.parent_event_id) return map.get(event.parent_event_id) ?? []
  return []
}

/**
 * Transform CalendarEvent rows into FullCalendar EventInput objects.
 * Colors events by their first associated calendar.
 * Excludes events whose calendars are all hidden.
 */
function toFCEvents(
  dbEvents: CalendarEventWithLocation[],
  calendars: Calendar[],
  eventCalendarsMap: Map<string, string[]>,
  hiddenCalendarIds: Set<string>
): EventInput[] {
  const masters = dbEvents.filter(e => !e.parent_event_id)
  const exceptions = dbEvents.filter(e => !!e.parent_event_id)

  const byParent = new Map<string, CalendarEventWithLocation[]>()
  for (const exc of exceptions) {
    const key = exc.parent_event_id!
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(exc)
  }

  const fcEvents: EventInput[] = []

  for (const event of masters) {
    // Visibility: hidden if every assigned calendar is hidden
    const calIds = getEventCalendarIds(event, eventCalendarsMap)
    const isVisible = calIds.length === 0 || calIds.some(id => !hiddenCalendarIds.has(id))
    if (!isVisible) continue

    const firstCal = calendars.find(c => calIds.includes(c.id))
    const bgColor = firstCal?.color ?? '#3b82f6'

    const children = byParent.get(event.id) ?? []
    const cancelled = children.filter(c => c.is_cancelled)
    const overrides = children.filter(c => !c.is_cancelled)

    const base: EventInput = {
      id: event.id,
      title: event.title,
      allDay: event.all_day,
      backgroundColor: bgColor,
      borderColor: bgColor,
      extendedProps: { dbEvent: event },
    }

    if (event.recurrence_rule) {
      // For all-day events: compact date YYYYMMDD (rrule.js parses this correctly
      // and FC's regex matches DTSTART: prefix for all-day detection).
      // For timed events: floating Eastern datetime (no Z) so FC treats it as
      // local New_York wall-clock time, not UTC.
      const dtstart = event.all_day
        ? event.start_time.slice(0, 10).replace(/-/g, '')
        : toICalFloating(event.start_time)

      // Sanitize recurrence_rule: strip any leading "RRULE:" prefix and any embedded
      // DTSTART lines (both can appear in ICS-imported data and would corrupt the string
      // we build below, e.g. producing "RRULE:RRULE:FREQ=..." which rrule.js can't parse).
      const rawRule = event.recurrence_rule
        .split('\n')
        .map(l => l.trim())
        .filter(l => !l.startsWith('DTSTART'))
        .join('\n')
        .replace(/^RRULE:/i, '')

      // Embed EXDATEs directly in the iCal string — the separate `exdate` array
      // property on the FC event is processed by FC's own regex which has bugs
      // with all-day events. Passing them inline lets rrulestr parse them natively.
      // Note: use EXDATE:YYYYMMDD (not EXDATE;VALUE=DATE:) — rrule.js has the
      // same VALUE=DATE parsing bug as DTSTART; compact format works correctly.
      const exdateLines = [...cancelled, ...overrides]
        .map(c => c.recurrence_id)
        .filter((d): d is string => !!d)
        .map(d => event.all_day
          ? `EXDATE:${d.slice(0, 10).replace(/-/g, '')}`
          : `EXDATE:${toICalFloating(d)}`)

      // Note: DTSTART;VALUE=DATE: is silently broken in rrule.js — it ignores the
      // date part and falls back to new Date(). DTSTART:YYYYMMDD (no VALUE=DATE)
      // is parsed correctly for both all-day and timed events.
      const rruleStr = exdateLines.length > 0
        ? `DTSTART:${dtstart}\nRRULE:${rawRule}\n${exdateLines.join('\n')}`
        : `DTSTART:${dtstart}\nRRULE:${rawRule}`

      // DEBUG: log the full rrule string for each recurring event so mismatches are visible
      console.debug(
        `[FC rrule] "${event.title}" all_day=${event.all_day} start_time=${event.start_time}\n` +
        `  raw recurrence_rule: ${event.recurrence_rule}\n` +
        `  cancelled rows (recurrence_id): ${cancelled.map(c => c.recurrence_id).join(', ') || '(none)'}\n` +
        `  rrule string:\n${rruleStr.split('\n').map(l => '    ' + l).join('\n')}`
      )

      fcEvents.push({
        ...base,
        rrule: rruleStr,
        duration: event.end_time ? getDuration(event.start_time, event.end_time) : undefined,
      })

      for (const ov of overrides) {
        fcEvents.push({
          ...base,
          id: ov.id,
          title: ov.title,
          start: ov.all_day ? ov.start_time.slice(0, 10) : toICalFloating(ov.start_time),
          end: ov.end_time
            ? (ov.all_day ? ov.end_time.slice(0, 10) : toICalFloating(ov.end_time))
            : undefined,
          allDay: ov.all_day,
          extendedProps: { dbEvent: ov, isException: true },
        })
      }
    } else {
      // Non-recurring: pass floating Eastern time (no Z) so FullCalendar positions the
      // event at the correct Eastern wall-clock time regardless of its timezone plugin.
      fcEvents.push({
        ...base,
        start: event.all_day ? event.start_time.slice(0, 10) : toICalFloating(event.start_time),
        end: event.end_time
          ? (event.all_day ? event.end_time.slice(0, 10) : toICalFloating(event.end_time))
          : undefined,
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
  initialCalendarIds: string[]
}

interface CalendarViewProps {
  session: Session
}

export default function CalendarView({ session }: CalendarViewProps) {
  const [dbEvents, setDbEvents]               = useState<CalendarEventWithLocation[]>([])
  const [calendars, setCalendars]             = useState<Calendar[]>([])
  const [eventCalendarsMap, setEventCalendarsMap] = useState<Map<string, string[]>>(new Map())
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(new Set())
  const [modal, setModal]                     = useState<ModalState | null>(null)
  const [loadError, setLoadError]             = useState<string | null>(null)
  const calendarRef                           = useRef<FullCalendar>(null)
  const seedingStartedRef                     = useRef(false)
  const [renamingCalendarId, setRenamingCalendarId] = useState<string | null>(null)
  const [renamingCalendarName, setRenamingCalendarName] = useState('')

  // FullCalendar events recompute whenever data or visibility changes
  const fcEvents = useMemo(
    () => toFCEvents(dbEvents, calendars, eventCalendarsMap, hiddenCalendarIds),
    [dbEvents, calendars, eventCalendarsMap, hiddenCalendarIds]
  )

  // ─── Data Loading ──────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoadError(null)

    // Fetch all calendar events using pagination — Supabase caps a single request at 1 000 rows
    // by default; users with more events would silently lose cancelled/override rows.
    const PAGE = 1000
    let allEvents: CalendarEventWithLocation[] = []
    let from = 0
    let fetchError: string | null = null
    while (true) {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*, locations(id, name, address)')
        .order('start_time', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) { fetchError = error.message; break }
      if (!data || data.length === 0) break
      allEvents = allEvents.concat(data as CalendarEventWithLocation[])
      if (data.length < PAGE) break   // last page
      from += PAGE
    }

    const [calsResult, linksResult] = await Promise.all([
      supabase.from('calendars').select('*').order('name'),
      supabase.from('calendar_event_calendars').select('event_id, calendar_id'),
    ])

    if (fetchError) {
      setLoadError(fetchError)
      return
    }

    const events = allEvents
    const calList = (calsResult.data ?? []) as Calendar[]
    const links = (linksResult.data ?? []) as { event_id: string; calendar_id: string }[]

    const linksMap = new Map<string, string[]>()
    for (const link of links) {
      if (!linksMap.has(link.event_id)) linksMap.set(link.event_id, [])
      linksMap.get(link.event_id)!.push(link.calendar_id)
    }

    // Deduplicate by name — StrictMode can double-invoke the seeding, producing duplicate rows with different IDs
    const seenNames = new Set<string>()
    const uniqueCalList = calList.filter(c => seenNames.has(c.name) ? false : (seenNames.add(c.name), true))

    setDbEvents(events)
    setCalendars(uniqueCalList)
    setEventCalendarsMap(linksMap)

    // Seed default calendars on first use — guard against StrictMode double-invoke
    if (calList.length === 0 && !seedingStartedRef.current) {
      seedingStartedRef.current = true
      await seedDefaultCalendars(session.user.id, events)
      // Reload after seeding
      const [calsResult2, linksResult2] = await Promise.all([
        supabase.from('calendars').select('*').order('name'),
        supabase.from('calendar_event_calendars').select('event_id, calendar_id'),
      ])
      const calList2 = (calsResult2.data ?? []) as Calendar[]
      const links2 = (linksResult2.data ?? []) as { event_id: string; calendar_id: string }[]
      const linksMap2 = new Map<string, string[]>()
      for (const link of links2) {
        if (!linksMap2.has(link.event_id)) linksMap2.set(link.event_id, [])
        linksMap2.get(link.event_id)!.push(link.calendar_id)
      }
      const seenNames2 = new Set<string>()
      const uniqueCalList2 = calList2.filter(c => seenNames2.has(c.name) ? false : (seenNames2.add(c.name), true))
      setCalendars(uniqueCalList2)
      setEventCalendarsMap(linksMap2)
    }
  }, [session.user.id])

  useEffect(() => { void loadAll() }, [loadAll])

  // ─── Seed Default Calendars ────────────────────────────────────────────────

  async function seedDefaultCalendars(
    userId: string,
    existingEvents: CalendarEventWithLocation[]
  ) {
    const { data: created, error } = await supabase
      .from('calendars')
      .insert(DEFAULT_CALENDARS.map(d => ({ ...d, user_id: userId })))
      .select()
    if (error || !created) return

    // Assign all events whose title starts with "AmTrust" to Work Holidays
    const workHolidays = (created as Calendar[]).find(c => c.name === 'Work Holidays')
    if (!workHolidays) return

    const amtrustMasters = existingEvents.filter(
      e => !e.parent_event_id && e.title.toLowerCase().startsWith('amtrust')
    )
    if (amtrustMasters.length > 0) {
      await supabase.from('calendar_event_calendars').insert(
        amtrustMasters.map(e => ({
          event_id: e.id,
          calendar_id: workHolidays.id,
          user_id: userId,
        }))
      )
    }
  }

  // ─── Sign Out ──────────────────────────────────────────────────────────────

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  // ─── Calendar Visibility Toggle ────────────────────────────────────────────

  function handleToggleCalendar(calId: string) {
    setHiddenCalendarIds(prev => {
      const next = new Set(prev)
      if (next.has(calId)) next.delete(calId)
      else next.add(calId)
      return next
    })
  }

  // ─── Rename Calendar ──────────────────────────────────────────────────────

  function startRenamingCalendar(cal: Calendar) {
    setRenamingCalendarId(cal.id)
    setRenamingCalendarName(cal.name)
  }

  async function commitRenameCalendar(calId: string) {
    const name = renamingCalendarName.trim()
    setRenamingCalendarId(null)
    if (!name) return
    const { error } = await supabase.from('calendars').update({ name }).eq('id', calId)
    if (error) return
    setCalendars(prev => prev.map(c => c.id === calId ? { ...c, name } : c))
  }

  function handleRenameKeyDown(e: React.KeyboardEvent, calId: string) {
    if (e.key === 'Enter') void commitRenameCalendar(calId)
    if (e.key === 'Escape') setRenamingCalendarId(null)
  }

  // ─── Export Calendar as .ics.zip ──────────────────────────────────────────

  async function handleExportCalendar(cal: Calendar) {
    const { data: links } = await supabase
      .from('calendar_event_calendars')
      .select('event_id')
      .eq('calendar_id', cal.id)

    if (!links || links.length === 0) {
      alert('No events in this calendar to export.')
      return
    }

    const eventIds = (links as { event_id: string }[]).map(l => l.event_id)

    const [mastersResult, childrenResult] = await Promise.all([
      supabase
        .from('calendar_events')
        .select('*, locations(id, name, address)')
        .in('id', eventIds),
      supabase
        .from('calendar_events')
        .select('*, locations(id, name, address)')
        .in('parent_event_id', eventIds),
    ])

    const masterEvents = (mastersResult.data ?? []) as CalendarEventWithLocation[]
    if (masterEvents.length === 0) {
      alert('No events found.')
      return
    }

    const allForExport = [
      ...masterEvents,
      ...((childrenResult.data ?? []) as CalendarEventWithLocation[]),
    ]

    const icsContent = generateICS(cal.name, masterEvents, allForExport)
    const zip = new JSZip()
    const safeFilename = cal.name.replace(/[^a-zA-Z0-9_-]/g, '_')
    zip.file(`${safeFilename}.ics`, icsContent)
    const blob = await zip.generateAsync({ type: 'blob' })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeFilename}.ics.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ─── Calendar Interactions ─────────────────────────────────────────────────

  function handleDateSelect(selectInfo: DateSelectArg) {
    setModal({
      event: null,
      showScopeChoice: false,
      defaultStart: fcStartToUTC(selectInfo.startStr),
      defaultEnd: fcStartToUTC(selectInfo.endStr),
      defaultAllDay: selectInfo.allDay,
      initialCalendarIds: [],
    })
    calendarRef.current?.getApi().unselect()
  }

  function handleEventClick(clickInfo: EventClickArg) {
    const dbEvent = clickInfo.event.extendedProps.dbEvent as CalendarEventWithLocation
    const isRecurring = !!dbEvent.recurrence_rule && !dbEvent.parent_event_id
    // FullCalendar returns a floating Eastern string for rrule occurrences; convert to UTC
    const occurrenceStart = fcStartToUTC(clickInfo.event.startStr)
    const calIds = getEventCalendarIds(dbEvent, eventCalendarsMap)

    setModal({
      event: dbEvent,
      occurrenceStart,
      showScopeChoice: isRecurring,
      defaultStart: undefined,
      defaultEnd: undefined,
      initialCalendarIds: calIds,
    })
  }

  async function handleEventDrop(dropInfo: EventDropArg) {
    const dbEvent = dropInfo.event.extendedProps.dbEvent as CalendarEventWithLocation
    const isRecurring = !!dbEvent.recurrence_rule && !dbEvent.parent_event_id
    // FullCalendar returns floating Eastern strings; convert all to UTC for storage
    const newStart = fcStartToUTC(dropInfo.event.startStr)
    const newEnd = dropInfo.event.endStr ? fcStartToUTC(dropInfo.event.endStr) : null

    if (isRecurring) {
      const originalStart = fcStartToUTC(dropInfo.oldEvent.startStr)
      const { data: newRow, error } = await supabase
        .from('calendar_events')
        .insert({
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
        .select('id')
        .single()

      if (error) {
        alert(`Error moving event: ${error.message}`)
        dropInfo.revert()
        return
      }

      // Copy parent's calendar memberships to the new exception row
      if (newRow) {
        const parentId = dbEvent.parent_event_id ?? dbEvent.id
        const parentCalIds = eventCalendarsMap.get(parentId) ?? []
        if (parentCalIds.length > 0) {
          await supabase.from('calendar_event_calendars').insert(
            parentCalIds.map(calId => ({
              event_id: newRow.id,
              calendar_id: calId,
              user_id: session.user.id,
            }))
          )
        }
      }
    } else {
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

    void loadAll()
  }

  // ─── Modal ─────────────────────────────────────────────────────────────────

  function closeModal() { setModal(null) }
  function handleSaved() { setModal(null); void loadAll() }

  // ─── Render ────────────────────────────────────────────────────────────────

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
                <button
                  className="sidebar-export-btn"
                  title={`Export ${cal.name} as .ics.zip`}
                  onClick={() => handleExportCalendar(cal)}
                >
                  ↓
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
