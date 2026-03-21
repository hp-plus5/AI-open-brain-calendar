// Reusable sliding drawer primitive.
//
// On desktop (≥ 769px) CSS forces `transform: none` and `position: static`,
// so the drawer sits inline in normal document flow regardless of `isOpen`.
// On mobile (≤ 768px) CSS activates the fixed overlay and the backdrop.
// This means a single <Drawer> element works at both breakpoints without
// conditional rendering, keeping the DOM stable across resizes.

import { useEffect, useRef } from 'react'

export interface DrawerProps {
  isOpen:     boolean
  onClose:    () => void
  /** Descriptive label read by screen readers (required for accessibility) */
  ariaLabel:  string
  side?:      'left' | 'right'
  /** Extra class(es) forwarded to the panel element */
  className?: string
  children:   React.ReactNode
}

export default function Drawer({
  isOpen,
  onClose,
  ariaLabel,
  side = 'left',
  className = '',
  children,
}: DrawerProps) {
  const panelRef   = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (isOpen) {
      // Save the element that had focus before the drawer opened so we can
      // return focus to it when the drawer closes.
      triggerRef.current = document.activeElement

      // Move focus into the drawer so keyboard/AT users land inside it.
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    } else {
      // Return focus to the element that opened the drawer.
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus()
        triggerRef.current = null
      }
    }
  }, [isOpen])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  return (
    <>
      {/* Backdrop — click dismisses the drawer */}
      <div
        className={`drawer-backdrop${isOpen ? ' drawer-backdrop--visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`drawer drawer--${side}${isOpen ? ' drawer--open' : ''}${className ? ' ' + className : ''}`}
      >
        {children}
      </div>
    </>
  )
}
