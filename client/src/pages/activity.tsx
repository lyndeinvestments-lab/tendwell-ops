import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { Pencil, Search, X, RotateCcw, Activity } from 'lucide-react'
import { format, isToday, isYesterday, parseISO } from 'date-fns'

type FilterType = 'all' | 'properties' | 'pipeline' | 'inspections' | 'cleaners' | 'contacts'

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'properties', label: 'Properties' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'inspections', label: 'Inspections' },
  { key: 'cleaners', label: 'Cleaners' },
  { key: 'contacts', label: 'Contacts' },
]

// Map field names to filter categories
function getCategory(fieldName: string): FilterType {
  if (['stage_id'].includes(fieldName)) return 'pipeline'
  if (['cleaner_pay', 'ce_charged', 'est_laundry', 'est_consumables'].includes(fieldName)) return 'properties'
  if (['name', 'address', 'bedrooms', 'bathrooms', 'notes', 'client'].includes(fieldName)) return 'properties'
  return 'properties'
}

function dateGroupLabel(dateStr: string): string {
  try {
    const d = parseISO(dateStr)
    if (isToday(d)) return 'Today'
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'MMMM d, yyyy')
  } catch {
    return dateStr
  }
}

function formatFieldName(field: string) {
  return field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function ActivityFeedPage() {
  usePageTitle('Activity')
  const { openPropertyModal } = usePropertyModal()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [reverting, setReverting] = useState<string | null>(null)

  const { data: editLog, isLoading } = useQuery({
    queryKey: ['/supabase/activity-edit-log'],
    queryFn: async () => {
      let q = supabase
        .from('property_edit_log')
        .select('*, properties!property_edit_log_property_id_fkey(id, name)')
        .order('created_at', { ascending: false })
        .limit(500)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  const filtered = useMemo(() => {
    if (!editLog) return []
    return editLog.filter((entry: any) => {
      if (filter !== 'all' && getCategory(entry.field_name) !== filter) return false
      if (dateFrom && entry.created_at < dateFrom) return false
      if (dateTo && entry.created_at > dateTo + 'T23:59:59') return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const propName = (entry.properties as any)?.name?.toLowerCase() || ''
        const field = entry.field_name?.toLowerCase() || ''
        const oldVal = String(entry.old_value || '').toLowerCase()
        const newVal = String(entry.new_value || '').toLowerCase()
        if (!propName.includes(q) && !field.includes(q) && !oldVal.includes(q) && !newVal.includes(q)) return false
      }
      return true
    })
  }, [editLog, filter, search, dateFrom, dateTo])

  // Group by date
  const grouped = useMemo(() => {
    const groups: { label: string; dateKey: string; entries: any[] }[] = []
    const map: Record<string, any[]> = {}
    for (const entry of filtered) {
      const dateKey = entry.created_at?.slice(0, 10) || 'unknown'
      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(entry)
    }
    const sortedKeys = Object.keys(map).sort((a, b) => b.localeCompare(a))
    for (const key of sortedKeys) {
      groups.push({ label: dateGroupLabel(key + 'T12:00:00'), dateKey: key, entries: map[key] })
    }
    return groups
  }, [filtered])

  async function handleRevert(entry: any) {
    if (!entry.property_id || !entry.field_name || entry.old_value == null) return
    setReverting(entry.id)
    try {
      const revertValue = isNaN(Number(entry.old_value)) ? entry.old_value : Number(entry.old_value)
      const { error } = await supabase
        .from('properties')
        .update({ [entry.field_name]: revertValue })
        .eq('id', entry.property_id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/operational_properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      toast({ title: `Reverted ${formatFieldName(entry.field_name)} to "${entry.old_value}"` })
    } catch {
      toast({ title: 'Revert failed', variant: 'destructive' })
    } finally {
      setReverting(null)
    }
  }

  return (
    <div className="p-5 h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Activity Feed</h1>
          <p className="text-sm text-muted-foreground">Audit log of all changes across the app</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-8 h-8 w-56 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <label>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="h-8 text-xs border border-input rounded px-2 bg-background"
            />
            <label>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="h-8 text-xs border border-input rounded px-2 bg-background"
            />
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filter === opt.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} entries</span>
      </div>

      {/* Feed */}
      <div className="overflow-auto flex-1">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <EmptyState icon={Activity} title="No activity" description="No changes match your current filters." />
        ) : (
          <div className="space-y-6">
            {grouped.map(group => (
              <div key={group.dateKey}>
                <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-1 mb-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</h3>
                </div>
                <div className="space-y-0 border border-border rounded-lg overflow-hidden">
                  {group.entries.map((entry: any, idx: number) => {
                    const propName = (entry.properties as any)?.name
                    const propId = entry.property_id || (entry.properties as any)?.id
                    const canRevert = entry.old_value != null && entry.field_name && propId
                    return (
                      <div
                        key={entry.id}
                        className={`flex items-start gap-3 px-4 py-3 text-xs transition-colors hover:bg-muted/30 ${idx > 0 ? 'border-t border-border/60' : ''}`}
                      >
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Pencil className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {propName ? (
                              <button
                                onClick={() => openPropertyModal(propId)}
                                className="font-medium hover:underline text-foreground"
                              >
                                {propName}
                              </button>
                            ) : (
                              <span className="font-medium text-muted-foreground">Unknown property</span>
                            )}
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">{formatFieldName(entry.field_name || '')}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {entry.old_value != null && (
                              <>
                                <span className="line-through text-muted-foreground/70">{String(entry.old_value)}</span>
                                <span className="text-muted-foreground">→</span>
                              </>
                            )}
                            {entry.new_value != null && (
                              <span className="font-medium text-foreground">{String(entry.new_value)}</span>
                            )}
                          </div>
                          <p className="text-muted-foreground mt-0.5">
                            {format(parseISO(entry.created_at), 'h:mm a')}
                            {entry.changed_by && ` · ${entry.changed_by}`}
                          </p>
                        </div>
                        {canRevert && (
                          <button
                            onClick={() => handleRevert(entry)}
                            disabled={reverting === entry.id}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors flex-shrink-0 mt-0.5 disabled:opacity-50"
                            title={`Revert to "${entry.old_value}"`}
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${reverting === entry.id ? 'animate-spin' : ''}`} />
                            <span>Revert</span>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
