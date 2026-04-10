import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, STAGE_COLORS } from '@/lib/supabase'
import { useLocation } from 'wouter'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Search, ArrowRight, LayoutDashboard, Kanban, Users, FileSpreadsheet,
  DollarSign, Building2, BedDouble, Boxes, KeyRound, Wind, ListFilter, TrendingUp, Archive, Settings,
  ClipboardCheck, Brush, Bell, Activity, PieChart, AlertTriangle,
} from 'lucide-react'

const PAGE_ROUTES = [
  { name: 'Dashboard', path: '/', keywords: ['dashboard', 'home', 'overview', 'kpi'], icon: LayoutDashboard },
  { name: 'Pipeline', path: '/pipeline', keywords: ['pipeline', 'kanban', 'board', 'leads', 'stages'], icon: Kanban },
  { name: 'Clients', path: '/contacts', keywords: ['contacts', 'crm', 'client', 'people'], icon: Users },
  { name: 'Quote Sheet', path: '/quote-sheet', keywords: ['quote', 'quotes', 'new property', 'quote sheet'], icon: FileSpreadsheet },
  { name: 'Cost Tracking', path: '/cost-tracking', keywords: ['cost', 'tracking', 'profit', 'financial'], icon: DollarSign },
  { name: 'Property List', path: '/property-list', keywords: ['property', 'list', 'properties'], icon: Building2 },
  { name: 'Linen Requirements', path: '/linen-tracker', keywords: ['linen', 'linens', 'towels', 'beds', 'inventory', 'requirements'], icon: BedDouble },
  { name: 'Linen Inventory', path: '/linen-inventory', keywords: ['linen', 'inventory', 'count', 'par', 'sets', 'stock'], icon: Boxes },
  { name: 'Access Codes', path: '/access-codes', keywords: ['access', 'codes', 'door', 'wifi', 'auto'], icon: KeyRound },
  { name: 'AC Filters', path: '/ac-filters', keywords: ['ac', 'filter', 'filters', 'hvac', 'air'], icon: Wind },
  { name: 'Master List', path: '/master-list', keywords: ['master', 'list', 'all properties', 'admin'], icon: ListFilter },
  { name: 'Pro Forma', path: '/pro-forma', keywords: ['pro forma', 'proforma', 'projections', 'monthly'], icon: TrendingUp },
  { name: 'Previous Properties', path: '/previous-properties', keywords: ['previous', 'offboarded', 'archive'], icon: Archive },
  { name: 'Settings', path: '/settings', keywords: ['settings', 'users', 'config', 'configuration'], icon: Settings },
  { name: 'Revenue Report', path: '/revenue-report', keywords: ['revenue', 'report', 'income', 'monthly', 'trend'], icon: TrendingUp },
  { name: 'Verification', path: '/inspections', keywords: ['verification', 'verify', 'walkthrough', 'checklist', 'inspections'], icon: ClipboardCheck },
  { name: 'Cleaners', path: '/cleaners', keywords: ['cleaners', 'cleaning', 'roster', 'calendar', 'reconciliation'], icon: Brush },
  { name: 'Alerts', path: '/alerts', keywords: ['alerts', 'warnings', 'critical', 'notifications'], icon: Bell },
  { name: 'Activity', path: '/activity', keywords: ['activity', 'audit', 'log', 'history', 'changes'], icon: Activity },
  { name: 'Financial Dashboard', path: '/financial-dashboard', keywords: ['financial', 'dashboard', 'profit', 'margin', 'scenario'], icon: PieChart },
  { name: 'Issues', path: '/issues', keywords: ['issues', 'problems', 'cleaning', 'complaints', 'tracker'], icon: AlertTriangle },
]

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [, navigate] = useLocation()
  const { openPropertyModal } = usePropertyModal()
  const inputRef = useRef<HTMLInputElement>(null)
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const { data: properties } = useQuery({
    queryKey: ['/supabase/command-palette-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, address, contacts(full_name, email, phone), pipeline_stages!properties_stage_id_fkey(name, color)')
        .order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  const { data: contacts } = useQuery({
    queryKey: ['/supabase/command-palette-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, email, phone')
        .order('full_name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  // Focus input when opened — use requestAnimationFrame instead of setTimeout
  // to avoid stray keystrokes landing in the input before it's focused
  useEffect(() => {
    if (open) {
      setQuery('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => { setFocusedIndex(-1) }, [query])

  const q = query.trim().toLowerCase()

  const matchedPages = useMemo(() => {
    if (!q) return PAGE_ROUTES
    return PAGE_ROUTES.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.keywords.some(k => k.includes(q))
    )
  }, [q])

  // Recently viewed from localStorage
  const recentIds: string[] = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('tendwell-recent-views') || '[]') } catch { return [] }
  }, [open])
  const recentProperties = useMemo(() => {
    if (q || !properties) return []
    return recentIds.map(id => properties.find((p: any) => p.id === id)).filter(Boolean).slice(0, 5)
  }, [q, properties, recentIds])

  const matchedProperties = useMemo(() => {
    if (!q || !properties) return []
    return properties
      .filter((p: any) =>
        p.name?.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q) ||
        p.contacts?.full_name?.toLowerCase().includes(q) ||
        p.contacts?.email?.toLowerCase().includes(q) ||
        p.contacts?.phone?.toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [q, properties])

  const matchedContacts = useMemo(() => {
    if (!q || !contacts) return []
    return contacts
      .filter((c: any) =>
        c.full_name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q)
      )
      .slice(0, 5)
  }, [q, contacts])

  function handleSelectProperty(id: string) {
    onClose()
    openPropertyModal(id)
  }

  function handleSelectPage(path: string) {
    onClose()
    navigate(path)
  }

  const allResults = useMemo(() => {
    const items: { type: 'page' | 'recent' | 'property'; id: string; action: () => void }[] = []
    for (const page of matchedPages) {
      items.push({ type: 'page', id: `page-${page.path}`, action: () => { onClose(); navigate(page.path) } })
    }
    if (!q) {
      for (const p of recentProperties) {
        items.push({ type: 'recent', id: `recent-${(p as any).id}`, action: () => { onClose(); openPropertyModal((p as any).id) } })
      }
    }
    for (const p of matchedProperties) {
      items.push({ type: 'property', id: `prop-${p.id}`, action: () => { onClose(); openPropertyModal(p.id) } })
    }
    for (const c of matchedContacts) {
      items.push({ type: 'property' as const, id: `contact-${c.id}`, action: () => { onClose(); navigate('/contacts') } })
    }
    return items
  }, [matchedPages, recentProperties, matchedProperties, matchedContacts, q, onClose, navigate, openPropertyModal])

  const totalResults = matchedPages.length + matchedProperties.length + matchedContacts.length

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" data-testid="command-palette" onKeyDown={e => e.stopPropagation()}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search properties or navigate to a page</DialogDescription>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search properties or navigate to a page…"
            className="border-0 shadow-none focus-visible:ring-0 px-0 h-auto text-sm"
            data-testid="command-palette-input"
            onKeyDown={e => {
              if (e.key === 'Escape') { onClose(); return }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setFocusedIndex(i => Math.min(i + 1, allResults.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setFocusedIndex(i => Math.max(i - 1, -1))
              } else if (e.key === 'Enter') {
                if (focusedIndex >= 0 && focusedIndex < allResults.length) {
                  allResults[focusedIndex].action()
                } else if (allResults.length > 0) {
                  allResults[0].action()
                }
              }
            }}
          />
          <kbd className="hidden sm:inline text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Esc</kbd>
        </div>

        {totalResults === 0 && recentProperties.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No results found</div>
        ) : (
          <div className="max-h-80 overflow-y-auto py-1">
            {/* Pages group — always first */}
            {matchedPages.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Pages</div>
                {matchedPages.map((page, pageIdx) => (
                  <button
                    key={page.path}
                    onClick={() => handleSelectPage(page.path)}
                    className={`w-full flex items-center justify-between px-4 py-1.5 text-sm transition-colors text-left ${focusedIndex === pageIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                    data-testid={`cmd-page-${page.path}`}
                  >
                    <page.icon className="w-4 h-4 text-muted-foreground mr-2 flex-shrink-0" />
                    <span>{page.name}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  </button>
                ))}
              </>
            )}

            {/* Recently Viewed — on empty query only */}
            {recentProperties.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Recently Viewed</div>
                {recentProperties.map((p: any, recentIdx: number) => (
                  <button
                    key={`recent-${p.id}`}
                    onClick={() => handleSelectProperty(p.id)}
                    className={`w-full flex items-center justify-between px-4 py-1.5 text-sm transition-colors text-left ${focusedIndex === matchedPages.length + recentIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    <span className="font-medium truncate">{p.name}</span>
                  </button>
                ))}
              </>
            )}

            {matchedProperties.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Properties</div>
                {matchedProperties.map((p: any, propIdx: number) => {
                  const stageName = p.pipeline_stages?.name || ''
                  const color = p.pipeline_stages?.color || STAGE_COLORS[stageName] || '#6b7280'
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleSelectProperty(p.id)}
                      className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors text-left ${focusedIndex === matchedPages.length + (q ? 0 : recentProperties.length) + propIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                      data-testid={`cmd-property-${p.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-medium truncate block">{p.name}</span>
                        {p.address && <span className="text-xs text-muted-foreground truncate block">{p.address}</span>}
                      </div>
                      {stageName && (
                        <span
                          className="text-xs ml-2 px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{ backgroundColor: color + '20', color, border: `1px solid ${color}40` }}
                        >
                          {stageName}
                        </span>
                      )}
                    </button>
                  )
                })}
              </>
            )}

            {matchedContacts.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Clients</div>
                {matchedContacts.map((c: any, contactIdx: number) => (
                  <button
                    key={`contact-${c.id}`}
                    onClick={() => { onClose(); navigate('/contacts') }}
                    className={`w-full flex items-center justify-between px-4 py-1.5 text-sm transition-colors text-left ${focusedIndex === matchedPages.length + (q ? 0 : recentProperties.length) + matchedProperties.length + contactIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium truncate block">{c.full_name}</span>
                      {c.email && <span className="text-xs text-muted-foreground truncate block">{c.email}</span>}
                    </div>
                    <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  </button>
                ))}
              </>
            )}

          </div>
        )}

        <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-xs text-muted-foreground">
          <span><kbd className="bg-muted px-1 py-0.5 rounded">↑↓</kbd> to navigate</span>
          <span><kbd className="bg-muted px-1 py-0.5 rounded">↵</kbd> to select</span>
          <span><kbd className="bg-muted px-1 py-0.5 rounded">Esc</kbd> to close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
