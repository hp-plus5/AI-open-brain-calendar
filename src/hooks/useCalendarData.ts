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
  /** Optimistic update: replace the calendars list in-place (e.g. after rename) */
  setCalendars:      React.Dispatch<React.SetStateAction<Calendar[]>>
}

export function useCalendarData(userId: string): UseCalendarDataReturn {
  const [dbEvents,          setDbEvents]          = useState<CalendarEventWithLocation[]>([])
  const [calendars,         setCalendars]          = useState<Calendar[]>([])
  const [eventCalendarsMap, setEventCalendarsMap]  = useState<Map<string, string[]>>(new Map())
  const [loadError,         setLoadError]          = useState<string | null>(null)
  const seedingStartedRef = useRef(false)

  const buildLinksMap = (links: { event_id: string; calendar_id: string }[]): Map<string, string[]> => {
    const map = new Map<string, string[]>()
    for (const link of links) {
      if (!map.has(link.event_id)) map.set(link.event_id, [])
      map.get(link.event_id)!.push(link.calendar_id)
    }
    return map
  }

  const dedupeByName = (list: Calendar[]): Calendar[] => {
    const seen = new Set<string>()
    return list.filter(c => seen.has(c.name) ? false : (seen.add(c.name), true))
  }

  const loadAll = useCallback(async () => {
    setLoadError(null)

    let eventsResult: Awaited<ReturnType<typeof loadEvents>>
    let calList: Calendar[]
    let links: { event_id: string; calendar_id: string }[]

    try {
      ;[eventsResult, calList, links] = await Promise.all([
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

    const uniqueCalList = dedupeByName(calList)
    setDbEvents(eventsResult.events)
    setCalendars(uniqueCalList)
    setEventCalendarsMap(buildLinksMap(links))

    // Seed default calendars on first use — guard against StrictMode double-invoke
    if (calList.length === 0 && !seedingStartedRef.current) {
      seedingStartedRef.current = true
      await seedDefaultCalendars(userId, eventsResult.events)
      // Reload calendars and links after seeding
      const [calList2, links2] = await Promise.all([loadCalendars(), loadEventLinks()])
      setCalendars(dedupeByName(calList2))
      setEventCalendarsMap(buildLinksMap(links2))
    }
  }, [userId])

  useEffect(() => { void loadAll() }, [loadAll])

  return { dbEvents, calendars, eventCalendarsMap, loadError, reload: loadAll, setCalendars }
}
