import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, STAGE_COLORS } from '@/lib/supabase'
import { useLocation } from 'wouter'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Search, ArrowRight } from 'lucide-react'

const PAGE_ROUTES = [
  { name: 'Dashboard', path: '/', keywords: ['dashboard', 'home', 'overview', 'kpi'] },
  { name: 'Pipeline', path: '/pipeline', keywords: ['pipeline', 'kanban', 'board', 'leads', 'stages'] },
  { name: 'Quote Sheet', path: '/quote-sheet', keywords: ['quote', 'quotes', 'new property', 'quote sheet'] },
  { name: 'Cost Tracking', path: '/cost-tracking', keywords: ['cost', 'tracking', 'profit', 'financial'] },
  { name: 'Property List', path: '/property-list', keywords: ['property', 'list', 'properties'] },
  { name: 'Linen Tracker', path: '/linen-tracker', keywords: ['linen', 'linens', 'towels', 'beds', 'inventory'] },
  { name: 'Access Codes', path: '/access-codes', keywords: ['access', 'codes', 'door', 'wifi', 'auto'] },
  { name: 'AC Filters', path: '/ac-filters', keywords: ['ac', 'filter', 'filters', 'hvac', 'air'] },
  { name: 'Master List', path: '/master-list', keywords: ['master', 'list', 'all properties', 'admin'] },
  { name: 'Pro Forma', path: '/pro-forma', keywords: ['pro forma', 'proforma', 'projections', 'monthly'] },
  { name: 'Previous Properties', path: '/previous-properties', keywords: ['previous', 'offboarded', 'archive'] },
  { name: 'Settings', path: '/settings', keywords: ['settings', 'users', 'config', 'configuration'] },
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

  const { data: properties } = useQuery({
    queryKey: ['/supabase/command-palette-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, pipeline_stages!properties_stage_id_fkey(name, color)')
        .order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

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
      .filter((p: any) => p.name?.toLowerCase().includes(q))
      .slice(0, 6)
  }, [q, properties])

  function handleSelectProperty(id: string) {
    onClose()
    openPropertyModal(id)
  }

  function handleSelectPage(path: string) {
    onClose()
    navigate(path)
  }

  const totalResults = matchedPages.length + matchedProperties.length

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" data-testid="command-palette">
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
              if (e.key === 'Escape') onClose()
              // Enter selects first property if any, else first page
              if (e.key === 'Enter') {
                if (matchedProperties.length > 0) handleSelectProperty(matchedProperties[0].id)
                else if (matchedPages.length > 0) handleSelectPage(matchedPages[0].path)
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
                {matchedPages.map(page => (
                  <button
                    key={page.path}
                    onClick={() => handleSelectPage(page.path)}
                    className="w-full flex items-center justify-between px-4 py-1.5 text-sm hover:bg-muted transition-colors text-left"
                    data-testid={`cmd-page-${page.path}`}
                  >
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
                {recentProperties.map((p: any) => (
                  <button
                    key={`recent-${p.id}`}
                    onClick={() => handleSelectProperty(p.id)}
                    className="w-full flex items-center justify-between px-4 py-1.5 text-sm hover:bg-muted transition-colors text-left"
                  >
                    <span className="font-medium truncate">{p.name}</span>
                  </button>
                ))}
              </>
            )}

            {matchedProperties.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Properties</div>
                {matchedProperties.map((p: any) => {
                  const stageName = p.pipeline_stages?.name || ''
                  const color = p.pipeline_stages?.color || STAGE_COLORS[stageName] || '#6b7280'
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleSelectProperty(p.id)}
                      className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-muted transition-colors text-left"
                      data-testid={`cmd-property-${p.id}`}
                    >
                      <span className="font-medium truncate">{p.name}</span>
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

            {/* Pages group already rendered above */}
            {false && matchedPages.length > 0 && (
              <></>
            )}
          </div>
        )}

        <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-xs text-muted-foreground">
          <span><kbd className="bg-muted px-1 py-0.5 rounded">↵</kbd> to select</span>
          <span><kbd className="bg-muted px-1 py-0.5 rounded">Esc</kbd> to close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
