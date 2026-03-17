// Supabase operations for the `calendars` and `calendar_event_calendars` tables.
// No React — pure async functions that take/return plain data.

import { supabase } from '../lib/supabase'
import type { Calendar, CalendarEventWithLocation } from '../types/database'

// ─── Default calendar seed data ───────────────────────────────────────────────

export const DEFAULT_CALENDARS = [
  { name: 'Work Holidays',   color: '#dc2626' },
  { name: 'Family Schedule', color: '#16a34a' },
  { name: 'CLE Events',      color: '#d97706' },
  { name: 'Personal',        color: '#7c3aed' },
]

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function loadCalendars(): Promise<Calendar[]> {
  const { data, error } = await supabase.from('calendars').select('*').order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as Calendar[]
}

export async function loadEventLinks(): Promise<{ event_id: string; calendar_id: string }[]> {
  const { data, error } = await supabase
    .from('calendar_event_calendars')
    .select('event_id, calendar_id')
  if (error) throw new Error(error.message)
  return (data ?? []) as { event_id: string; calendar_id: string }[]
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function renameCalendar(calId: string, name: string): Promise<void> {
  const { error } = await supabase.from('calendars').update({ name }).eq('id', calId)
  if (error) throw new Error(error.message)
}

/**
 * Insert the default calendar set for a new user.
 * Also assigns existing "AmTrust" events to the Work Holidays calendar.
 * Guards against duplicate seeding are handled by the caller.
 */
export async function seedDefaultCalendars(
  userId: string,
  existingEvents: CalendarEventWithLocation[]
): Promise<void> {
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
        event_id:    e.id,
        calendar_id: workHolidays.id,
        user_id:     userId,
      }))
    )
  }
}
