import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { Search, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'

function getDueStatus(nextDue: string | null): { label: string; color: string; icon: typeof CheckCircle2 } | null {
  if (!nextDue) return null
  const due = new Date(nextDue)
  const now = new Date()
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { label: 'Overdue', color: 'text-destructive', icon: AlertTriangle }
  if (diffDays <= 14) return { label: 'Due soon', color: 'text-amber-600 dark:text-amber-400', icon: Clock }
  return { label: 'OK', color: 'text-green-600 dark:text-green-400', icon: CheckCircle2 }
}

export default function AcFiltersPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/ac-filters'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, stage_name, notes, filter_size, last_filter_changed, next_filter_due')
        .neq('stage_name', 'Offboarded')
      if (error) throw error
      return data || []
    },
  })

  const { mutate: updateField } = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: string }) => {
      const { error } = await supabase.from('properties').update({ [field]: value || null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/ac-filters'] }),
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    return properties.filter((p: any) => p.name?.toLowerCase().includes(search.toLowerCase()))
  }, [properties, search])

  // Summary stats
  const overdue = filtered.filter((p: any) => {
    const status = getDueStatus(p.next_filter_due)
    return status?.label === 'Overdue'
  }).length
  const dueSoon = filtered.filter((p: any) => {
    const status = getDueStatus(p.next_filter_due)
    return status?.label === 'Due soon'
  }).length

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">AC Filters</h1>
          <p className="text-sm text-muted-foreground">
            Track filter sizes and change schedules — click cells to edit
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(overdue > 0 || dueSoon > 0) && (
            <div className="flex items-center gap-2 text-xs">
              {overdue > 0 && (
                <span className="flex items-center gap-1 text-destructive font-medium">
                  <AlertTriangle className="w-3 h-3" /> {overdue} overdue
                </span>
              )}
              {dueSoon > 0 && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                  <Clock className="w-3 h-3" /> {dueSoon} due soon
                </span>
              )}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-filters"
              className="pl-8 h-8 w-56 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[150px]">Property</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Filter Size</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Last Changed</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Next Due</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-8">Due</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(7)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">No properties found</td>
              </tr>
            ) : (
              filtered.map((p: any) => {
                const dueStatus = getDueStatus(p.next_filter_due)
                return (
                  <tr key={p.id} data-testid={`row-filter-${p.id}`} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${dueStatus?.label === 'Overdue' ? 'bg-destructive/5' : ''}`}>
                    <td className="py-2 px-3 font-medium text-xs">{p.name}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{p.stage_name || '—'}</td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.filter_size}
                        type="text"
                        onSave={v => updateField({ id: p.id, field: 'filter_size', value: v })}
                        testId={`inline-filter-size-${p.id}`}
                        placeholder="Add size…"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.last_filter_changed ? p.last_filter_changed.slice(0, 10) : ''}
                        type="text"
                        onSave={v => updateField({ id: p.id, field: 'last_filter_changed', value: v })}
                        testId={`inline-last-changed-${p.id}`}
                        placeholder="yyyy-mm-dd"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.next_filter_due ? p.next_filter_due.slice(0, 10) : ''}
                        type="text"
                        onSave={v => updateField({ id: p.id, field: 'next_filter_due', value: v })}
                        testId={`inline-next-due-${p.id}`}
                        placeholder="yyyy-mm-dd"
                      />
                    </td>
                    <td className="py-2 px-3">
                      {dueStatus && (
                        <dueStatus.icon className={`w-4 h-4 ${dueStatus.color}`} title={dueStatus.label} />
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <InlineEdit
                        value={p.notes}
                        type="text"
                        onSave={v => updateField({ id: p.id, field: 'notes', value: v })}
                        testId={`inline-notes-${p.id}`}
                        placeholder="Add notes…"
                        className="w-full min-w-[150px]"
                      />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
