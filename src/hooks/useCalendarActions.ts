// UI state and handlers for the calendar sidebar:
// visibility toggling, calendar rename, and ICS export.

import { useState } from 'react'
import type { Calendar } from '../types/database'
import { renameCalendar } from '../services/calendarService'
import { fetchEventsForCalendar } from '../services/eventService'
import { downloadICSZip } from '../utils/icsExport'

interface UseCalendarActionsReturn {
  // Visibility
  hiddenCalendarIds:    Set<string>
  handleToggleCalendar: (calId: string) => void

  // Rename
  renamingCalendarId:     string | null
  renamingCalendarName:   string
  setRenamingCalendarName: React.Dispatch<React.SetStateAction<string>>
  startRenamingCalendar:  (cal: Calendar) => void
  commitRenameCalendar:   (calId: string) => Promise<void>
  handleRenameKeyDown:    (e: React.KeyboardEvent, calId: string) => void

  // Export
  handleExportCalendar: (cal: Calendar) => Promise<void>
}

export function useCalendarActions(
  /** Called with the updated calendar list after a successful rename */
  onCalendarRenamed: (calId: string, newName: string) => void
): UseCalendarActionsReturn {
  const [hiddenCalendarIds,   setHiddenCalendarIds]   = useState<Set<string>>(new Set())
  const [renamingCalendarId,  setRenamingCalendarId]  = useState<string | null>(null)
  const [renamingCalendarName, setRenamingCalendarName] = useState('')

  // ─── Visibility ──────────────────────────────────────────────────────────

  function handleToggleCalendar(calId: string) {
    setHiddenCalendarIds(prev => {
      const next = new Set(prev)
      if (next.has(calId)) next.delete(calId)
      else next.add(calId)
      return next
    })
  }

  // ─── Rename ──────────────────────────────────────────────────────────────

  function startRenamingCalendar(cal: Calendar) {
    setRenamingCalendarId(cal.id)
    setRenamingCalendarName(cal.name)
  }

  async function commitRenameCalendar(calId: string) {
    const name = renamingCalendarName.trim()
    setRenamingCalendarId(null)
    if (!name) return
    try {
      await renameCalendar(calId, name)
      onCalendarRenamed(calId, name)
    } catch {
      // Non-fatal: silently ignore rename failure (name reverts visually on next reload)
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent, calId: string) {
    if (e.key === 'Enter')  void commitRenameCalendar(calId)
    if (e.key === 'Escape') setRenamingCalendarId(null)
  }

  // ─── Export ──────────────────────────────────────────────────────────────

  async function handleExportCalendar(cal: Calendar) {
    const result = await fetchEventsForCalendar(cal.id)
    if (!result) {
      alert('No events in this calendar to export.')
      return
    }
    await downloadICSZip(cal.name, result.masterEvents, result.allEvents)
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
