// UI state and handlers for the calendar sidebar:
// visibility toggling, calendar rename, and calendar export.

import { useState } from 'react'
import type { Calendar } from '../types/database'
import { renameCalendar } from '../services/calendarService'
import { fetchEventsForCalendar } from '../services/eventService'
import { downloadCalendarExport } from '../utils/calendarExport'

interface UseCalendarActionsReturn {
  // Visibility
  hiddenCalendarIds:    Set<string>
  handleToggleCalendar: (calendarId: string) => void

  // Rename
  renamingCalendarId:      string | null
  renamingCalendarName:    string
  setRenamingCalendarName: React.Dispatch<React.SetStateAction<string>>
  startRenamingCalendar:   (calendar: Calendar) => void
  commitRenameCalendar:    (calendarId: string) => Promise<void>
  handleRenameKeyDown:     (e: React.KeyboardEvent, calendarId: string) => void

  // Export
  handleExportCalendar: (calendar: Calendar) => Promise<void>
}

export function useCalendarActions(
  /** Called with the updated name after a successful rename, for optimistic UI update */
  onCalendarRenamed: (calendarId: string, newName: string) => void
): UseCalendarActionsReturn {
  const [hiddenCalendarIds,    setHiddenCalendarIds]    = useState<Set<string>>(new Set())
  const [renamingCalendarId,   setRenamingCalendarId]   = useState<string | null>(null)
  const [renamingCalendarName, setRenamingCalendarName] = useState('')

  // ─── Visibility ──────────────────────────────────────────────────────────

  function handleToggleCalendar(calendarId: string) {
    setHiddenCalendarIds(prev => {
      const next = new Set(prev)
      if (next.has(calendarId)) next.delete(calendarId)
      else next.add(calendarId)
      return next
    })
  }

  // ─── Rename ──────────────────────────────────────────────────────────────

  function startRenamingCalendar(calendar: Calendar) {
    setRenamingCalendarId(calendar.id)
    setRenamingCalendarName(calendar.name)
  }

  async function commitRenameCalendar(calendarId: string) {
    const trimmedName = renamingCalendarName.trim()
    setRenamingCalendarId(null)
    if (!trimmedName) return
    try {
      await renameCalendar(calendarId, trimmedName)
      onCalendarRenamed(calendarId, trimmedName)
    } catch {
      // Non-fatal: silently ignore rename failure (name reverts visually on next reload)
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent, calendarId: string) {
    if (e.key === 'Enter')  void commitRenameCalendar(calendarId)
    if (e.key === 'Escape') setRenamingCalendarId(null)
  }

  // ─── Export ──────────────────────────────────────────────────────────────

  async function handleExportCalendar(calendar: Calendar) {
    const result = await fetchEventsForCalendar(calendar.id)
    if (!result) {
      alert('No events in this calendar to export.')
      return
    }
    await downloadCalendarExport(calendar.name, result.masterEvents, result.allEvents)
  }

  return {
    hiddenCalendarIds,
    handleToggleCalendar,
    renamingCalendarId,
    renamingCalendarName,
    setRenamingCalendarName,
    startRenamingCalendar,
    commitRenameCalendar,
    handleRenameKeyDown,
    handleExportCalendar,
  }
}
