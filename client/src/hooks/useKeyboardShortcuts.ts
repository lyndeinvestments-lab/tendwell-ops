import { useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'wouter'

interface ShortcutHandlers {
  onOpenCheatSheet: () => void
  onNewItem?: () => void
}

const NAV_MAP: Record<string, string> = {
  d: '/dashboard',
  p: '/pipeline',
  c: '/contacts',
  q: '/quote-sheet',
  t: '/cost-tracking',
  l: '/property-list',
  n: '/linen-tracker',
  a: '/ac-filters',
  m: '/master-list',
  r: '/revenue-report',
  i: '/inspections',
  s: '/settings',
}

export function useKeyboardShortcuts({ onOpenCheatSheet, onNewItem }: ShortcutHandlers) {
  const [, navigate] = useLocation()
  const pendingG = useRef(false)
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    const tag = target.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return

    // ? opens cheat sheet
    if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      onOpenCheatSheet()
      return
    }

    // Escape closes modals (handled by Dialog components, but we dispatch for custom ones)
    if (e.key === 'Escape') return

    // G sequence
    if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !pendingG.current) {
      pendingG.current = true
      if (gTimer.current) clearTimeout(gTimer.current)
      gTimer.current = setTimeout(() => { pendingG.current = false }, 500)
      return
    }

    if (pendingG.current) {
      pendingG.current = false
      if (gTimer.current) clearTimeout(gTimer.current)
      const route = NAV_MAP[e.key.toLowerCase()]
      if (route) {
        e.preventDefault()
        navigate(route)
      }
      return
    }

    // N for new item
    if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      onNewItem?.()
    }
  }, [navigate, onOpenCheatSheet, onNewItem])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

export const SHORTCUT_SECTIONS = [
  {
    title: 'Navigation (G + key)',
    shortcuts: [
      { keys: ['G', 'D'], description: 'Dashboard' },
      { keys: ['G', 'P'], description: 'Pipeline' },
      { keys: ['G', 'C'], description: 'Clients' },
      { keys: ['G', 'Q'], description: 'Quote Sheet' },
      { keys: ['G', 'T'], description: 'Cost Tracking' },
      { keys: ['G', 'L'], description: 'Property List' },
      { keys: ['G', 'N'], description: 'Linen Requirements' },
      { keys: ['G', 'A'], description: 'AC Filters' },
      { keys: ['G', 'M'], description: 'Master List' },
      { keys: ['G', 'R'], description: 'Revenue Report' },
      { keys: ['G', 'I'], description: 'Inspections' },
      { keys: ['G', 'S'], description: 'Settings' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['N'], description: 'New item (context-dependent)' },
      { keys: ['?'], description: 'Open keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close modal/dialog' },
    ],
  },
  {
    title: 'Global',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Search / Command Palette' },
    ],
  },
]
