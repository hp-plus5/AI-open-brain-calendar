// Sidebar showing the list of calendars with visibility checkboxes,
// rename inputs, and export buttons. Purely presentational.

import type { Calendar } from '../../types/database'

interface CalendarSidebarProps {
  calendars:            Calendar[]
  hiddenCalendarIds:    Set<string>
  renamingCalendarId:   string | null
  renamingCalendarName: string

  onToggle:          (calendarId: string) => void
  onStartRename:     (calendar: Calendar) => void
  onRenameChange:    (name: string) => void
  onRenameCommit:    (calendarId: string) => void
  onRenameKeyDown:   (e: React.KeyboardEvent, calendarId: string) => void
  onExport:          (calendar: Calendar) => void
}

export default function CalendarSidebar({
  calendars,
  hiddenCalendarIds,
  renamingCalendarId,
  renamingCalendarName,
  onToggle,
  onStartRename,
  onRenameChange,
  onRenameCommit,
  onRenameKeyDown,
  onExport,
}: CalendarSidebarProps) {
  return (
    <aside className="calendar-sidebar">
      <div className="sidebar-section-title">Calendars</div>
      {calendars.map(calendar => (
        <div key={calendar.id} className="sidebar-calendar-item">
          <label className="sidebar-calendar-label">
            <input
              type="checkbox"
              className="sidebar-calendar-checkbox"
              checked={!hiddenCalendarIds.has(calendar.id)}
              onChange={() => onToggle(calendar.id)}
            />
            <span className="sidebar-calendar-dot" style={{ backgroundColor: calendar.color }} />
            {renamingCalendarId === calendar.id ? (
              <input
                className="sidebar-calendar-rename-input"
                value={renamingCalendarName}
                autoFocus
                onChange={e => onRenameChange(e.target.value)}
                onBlur={() => onRenameCommit(calendar.id)}
                onKeyDown={e => onRenameKeyDown(e, calendar.id)}
                onClick={e => e.preventDefault()}
              />
            ) : (
              <span className="sidebar-calendar-name">{calendar.name}</span>
            )}
          </label>
          <div className="sidebar-calendar-actions">
            <button
              className="sidebar-export-btn"
              title={`Rename ${calendar.name}`}
              onClick={() => onStartRename(calendar)}
            >
              ✎
            </button>
            <button
              className="sidebar-export-btn"
              title={`Export ${calendar.name} as a calendar file`}
              onClick={() => onExport(calendar)}
            >
              ↓
            </button>
          </div>
        </div>
      ))}
    </aside>
  )
}
