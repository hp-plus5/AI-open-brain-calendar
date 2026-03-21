// Generic open/close state for a sliding drawer panel.
// Automatically closes when the viewport shrinks into mobile range so
// that a desktop-visible sidebar doesn't pop open as an overlay.

import { useState, useCallback, useEffect } from 'react'
import { useMediaQuery } from './useMediaQuery'

const MOBILE_QUERY = '(max-width: 768px)'

interface UseDrawerReturn {
  isOpen: boolean
  open:   () => void
  close:  () => void
  toggle: () => void
}

export function useDrawer(): UseDrawerReturn {
  const [isOpen, setIsOpen] = useState(false)
  const isMobile = useMediaQuery(MOBILE_QUERY)

  // When the viewport crosses down into mobile width, close the drawer so it
  // doesn't appear as an open overlay on first paint in mobile layout.
  useEffect(() => {
    if (isMobile) setIsOpen(false)
  }, [isMobile])

  const open   = useCallback(() => setIsOpen(true),  [])
  const close  = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen(v => !v), [])

  return { isOpen, open, close, toggle }
}
