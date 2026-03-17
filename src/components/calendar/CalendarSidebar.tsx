// Sidebar showing the list of calendars with visibility checkboxes,
// rename inputs, and export buttons. Purely presentational.

import type { Calendar } from '../../types/database'

interface CalendarSidebarProps {
  calendars:           Calendar[]
  hiddenCalendarIds:   Set<string>
  renamingCalendarId:  string | null
  renamingCalendarName: string

  onToggle:          (calId: string) => void
  onStartRename:     (cal: Calendar) => void
  onRenameChange:    (name: string) => void
  onRenameCommit:    (calId: string) => void
  onRenameKeyDown:   (e: React.KeyboardEvent, calId: string) => void
  onExport:          (cal: Calendar) => void
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
      {calendars.map(cal => (
        <div key={cal.id} className="sidebar-calendar-item">
          <label className="sidebar-calendar-label">
            <input
              type="checkbox"
              className="sidebar-calendar-checkbox"
              checked={!hiddenCalendarIds.has(cal.id)}
              onChange={() => onToggle(cal.id)}
            />
            <span className="sidebar-calendar-dot" style={{ backgroundColor: cal.color }} />
            {renamingCalendarId === cal.id ? (
              <input
                className="sidebar-calendar-rename-input"
                value={renamingCalendarName}
                autoFocus
                onChange={e => onRenameChange(e.target.value)}
                onBlur={() => onRenameCommit(cal.id)}
                onKeyDown={e => onRenameKeyDown(e, cal.id)}
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
              onClick={() => onStartRename(cal)}
            >
              ✎
            </button>
            <button
              className="sidebar-export-btn"
              title={`Export ${cal.name} as .ics.zip`}
              onClick={() => onExport(cal)}
            >
              ↓
            </button>
          </div>
        </div>
      ))}
    </aside>
  )
}
