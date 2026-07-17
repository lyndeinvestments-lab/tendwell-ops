import { useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { CATEGORIES, STATUSES } from '@/lib/issues'

/**
 * Status/category selects + search. Desktop renders the original inline
 * row (unchanged look). Mobile collapses the same controls behind a
 * "Filters" button (with an active-filter count badge) that opens a vaul
 * bottom-sheet Drawer.
 */
export function IssueFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  categoryFilter,
  onCategoryChange,
}: {
  search: string
  onSearchChange: (value: string) => void
  statusFilter: string
  onStatusChange: (value: string) => void
  categoryFilter: string
  onCategoryChange: (value: string) => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const activeCount = (statusFilter !== 'all' ? 1 : 0) + (categoryFilter !== 'all' ? 1 : 0) + (search.trim() ? 1 : 0)

  return (
    <>
      {/* Desktop: inline row, unchanged look */}
      <div className="hidden md:flex items-center gap-2 flex-wrap">
        <select value={statusFilter} onChange={e => onStatusChange(e.target.value)} className="h-8 text-xs border border-input rounded-md px-2 bg-background">
          <option value="all">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={categoryFilter} onChange={e => onCategoryChange(e.target.value)} className="h-8 text-xs border border-input rounded-md px-2 bg-background">
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input type="search" placeholder="Search…" value={search} onChange={e => onSearchChange(e.target.value)} className="pl-8 pr-7 h-8 w-full sm:w-56 text-sm" />
          {search && <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {/* Mobile: Filters button → bottom-sheet drawer */}
      <div className="md:hidden">
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setMobileOpen(true)}>
          <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
          {activeCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-2xs">{activeCount}</span>
          )}
        </Button>
        <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Filters</DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input type="search" placeholder="Search…" value={search} onChange={e => onSearchChange(e.target.value)} className="pl-8 pr-7 h-9 w-full text-sm" />
                {search && <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
              </div>
              <select value={statusFilter} onChange={e => onStatusChange(e.target.value)} className="w-full h-9 text-sm border border-input rounded-md px-2 bg-background">
                <option value="all">All Statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={categoryFilter} onChange={e => onCategoryChange(e.target.value)} className="w-full h-9 text-sm border border-input rounded-md px-2 bg-background">
                <option value="all">All Categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <DrawerFooter>
              <Button onClick={() => setMobileOpen(false)}>Done</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>
    </>
  )
}
