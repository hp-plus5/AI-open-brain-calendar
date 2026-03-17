import { useState, useEffect, useRef } from 'react'
import type { Location } from '../../types/database'
import { supabase } from '../../lib/supabase'

interface LocationPickerProps {
  value: string        // display name of currently selected location
  locationId: string | null
  onChange: (name: string, id: string | null) => void
}

/**
 * Autocomplete picker for locations.
 *
 * Behavior:
 * - As the user types, searches the `locations` table by name (ilike)
 * - Shows existing matches + a "Create new: …" option if no exact match
 * - Selecting an existing location sets locationId + name
 * - Selecting "Create new" sets name and locationId = null
 *   (the EventModal will create the location row on save)
 */
export default function LocationPicker({ value, locationId, onChange }: LocationPickerProps) {
  const [input, setInput] = useState(value)
  const [results, setResults] = useState<Location[]>([])
  const [open, setOpen] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Sync external value to input when it changes (e.g. modal reset)
  useEffect(() => {
    setInput(value)
  }, [value])

  // Search locations whenever input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!input.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('locations')
        .select('id, user_id, name, address, notes, metadata, created_at, updated_at')
        .ilike('name', `%${input.trim()}%`)
        .order('name')
        .limit(8)
      setResults(data ?? [])
      setOpen(true)
      setFocusedIdx(-1)
    }, 200)
  }, [input])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const hasExactMatch = results.some(r => r.name.toLowerCase() === input.trim().toLowerCase())
  // Show "create new" option when there's typed text and no exact match
  const showCreateNew = input.trim().length > 0 && !hasExactMatch

  function selectLocation(loc: Location) {
    setInput(loc.name)
    onChange(loc.name, loc.id)
    setOpen(false)
  }

  function selectCreateNew() {
    onChange(input.trim(), null)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const itemCount = results.length + (showCreateNew ? 1 : 0)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx(i => Math.min(i + 1, itemCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && focusedIdx >= 0) {
      e.preventDefault()
      if (focusedIdx < results.length) {
        selectLocation(results[focusedIdx])
      } else {
        selectCreateNew()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="location-picker" ref={wrapperRef}>
      <input
        type="text"
        value={input}
        placeholder="Search or add a location…"
        onChange={e => {
          setInput(e.target.value)
          // If user clears the field, clear the selection
          if (!e.target.value.trim()) onChange('', null)
        }}
        onFocus={() => input.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {/* Show the resolved location id in muted text below */}
      {locationId && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
          Saved location ✓
        </div>
      )}
      {!locationId && input.trim() && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
          Will create new location on save
        </div>
      )}
      {open && (results.length > 0 || showCreateNew) && (
        <div className="location-dropdown">
          {results.map((loc, i) => (
            <div
              key={loc.id}
              className={`location-option ${i === focusedIdx ? 'focused' : ''}`}
              onMouseDown={() => selectLocation(loc)}
            >
              <div className="location-option-name">{loc.name}</div>
              {loc.address && (
                <div className="location-option-address">{loc.address}</div>
              )}
            </div>
          ))}
          {showCreateNew && (
            <div
              className={`location-option location-option-new ${focusedIdx === results.length ? 'focused' : ''}`}
              onMouseDown={selectCreateNew}
            >
              Create new: "{input.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}
