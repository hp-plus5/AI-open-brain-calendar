// Loads and owns all calendar/event data from Supabase.
// Returns the data + a reload() function for after mutations.

import { useState, useEffect, useCallback, useRef } from 'react'
import type { CalendarEventWithLocation, Calendar } from '../types/database'
import { loadEvents } from '../services/eventService'
import { loadCalendars, loadEventLinks, seedDefaultCalendars } from '../services/calendarService'

interface UseCalendarDataReturn {
  dbEvents:          CalendarEventWithLocation[]
  calendars:         Calendar[]
  eventCalendarsMap: Map<string, string[]>
  loadError:         string | null
  reload:            () => void
  /** Optimistic update: replace the calendars list in-place (e.g. after a rename) */
  setCalendars:      React.Dispatch<React.SetStateAction<Calendar[]>>
}

export function useCalendarData(userId: string): UseCalendarDataReturn {
  const [dbEvents,          setDbEvents]          = useState<CalendarEventWithLocation[]>([])
  const [calendars,         setCalendars]          = useState<Calendar[]>([])
  const [eventCalendarsMap, setEventCalendarsMap]  = useState<Map<string, string[]>>(new Map())
  const [loadError,         setLoadError]          = useState<string | null>(null)

  // Guard against StrictMode's double-invoke of effects triggering double seeding
  const seedingStartedRef = useRef(false)

  // Build a Map<event_id, calendar_id[]> from the flat join-table rows
  const buildEventCalendarsMap = (
    links: { event_id: string; calendar_id: string }[]
  ): Map<string, string[]> => {
    const map = new Map<string, string[]>()
    for (const link of links) {
      if (!map.has(link.event_id)) map.set(link.event_id, [])
      map.get(link.event_id)!.push(link.calendar_id)
    }
    return map
  }

  // Deduplicate calendars by name — StrictMode can double-invoke seeding,
  // producing duplicate rows with different IDs
  const deduplicateCalendarsByName = (calendarList: Calendar[]): Calendar[] => {
    const seenNames = new Set<string>()
    return calendarList.filter(calendar =>
      seenNames.has(calendar.name) ? false : (seenNames.add(calendar.name), true)
    )
  }

  const loadAll = useCallback(async () => {
    setLoadError(null)

    let eventsResult: Awaited<ReturnType<typeof loadEvents>>
    let calendarList: Calendar[]
    let eventLinks:   { event_id: string; calendar_id: string }[]

    try {
      ;[eventsResult, calendarList, eventLinks] = await Promise.all([
        loadEvents(),
        loadCalendars(),
        loadEventLinks(),
      ])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load data')
      return
    }

    if (eventsResult.error) {
      setLoadError(eventsResult.error)
      return
    }

    const uniqueCalendarList = deduplicateCalendarsByName(calendarList)
    setDbEvents(eventsResult.events)
    setCalendars(uniqueCalendarList)
    setEventCalendarsMap(buildEventCalendarsMap(eventLinks))

    // Seed default calendars on first use
    if (calendarList.length === 0 && !seedingStartedRef.current) {
      seedingStartedRef.current = true
      await seedDefaultCalendars(userId, eventsResult.events)
      // Reload calendars and links after seeding
      const [calendarList2, updatedLinks] = await Promise.all([loadCalendars(), loadEventLinks()])
      setCalendars(deduplicateCalendarsByName(calendarList2))
      setEventCalendarsMap(buildEventCalendarsMap(updatedLinks))
    }
  }, [userId])

  useEffect(() => { void loadAll() }, [loadAll])

  return { dbEvents, calendars, eventCalendarsMap, loadError, reload: loadAll, setCalendars }
}
