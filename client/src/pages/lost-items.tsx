import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth, canAccessView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, ExternalLink, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'

// Mirrors Haven-OS lib/lost-items/types.ts (subset that the v1 dashboard uses).
type LostItemStatus = 'pending_pickup' | 'picked_up' | 'delivered' | 'failed' | 'completed'

interface LostItemCase {
  id: string
  case_number: string
  status: LostItemStatus
  item_description: string
  found_location: string | null
  property_id: string | null
  property_name: string | null
  guest_name: string | null
  guest_email: string | null
  guest_phone: string | null
  reservation_ref: string | null
  cleaning_vendor: string | null
  pickup_scheduled_at: string | null
  return_method: string | null
  shipping_carrier: string | null
  shipping_tracking: string | null
  notes: string | null
  source: string
  external_source: string | null
  external_url: string | null
  follow_up_date: string | null
  created_at: string
  updated_at: string
  property?: { id: string; name: string } | null
  assignee?: { id: string; full_name: string | null; email: string; avatar_url: string | null } | null
  events?: Array<{
    id: string
    case_id: string
    event_type: 'status_change' | 'comment' | 'assignment' | 'created' | 'updated'
    body: string | null
    from_value: string | null
    to_value: string | null
    actor_label: string | null
    created_at: string
    actor?: { id: string; full_name: string | null; email: string; avatar_url: string | null } | null
  }>
}

const STATUS_LABELS: Record<LostItemStatus, string> = {
  pending_pickup: 'Pending Pickup',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  failed: 'Failed',
  completed: 'Completed',
}

const STATUS_COLORS: Record<LostItemStatus, string> = {
  pending_pickup: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  picked_up: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  delivered: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-200 dark:border-green-800',
  failed: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800',
  completed: 'bg-muted text-muted-foreground border-border',
}

async function authFetch(path: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')
  const r = await fetch(path, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const text = await r.text()
  if (!r.ok) {
    let body: any = text
    try { body = JSON.parse(text) } catch {}
    throw new Error(body?.error || `Request failed (${r.status})`)
  }
  return text ? JSON.parse(text) : null
}

export default function LostItemsPage() {
  usePageTitle('Lost Items')
  const { effectiveUser } = useAuth()
  const canAccess = canAccessView('lost-items', effectiveUser)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<LostItemStatus | 'all'>('all')
  const [activeId, setActiveId] = useState<string | null>(null)

  // Polls every 30s for "near real-time" feel until Phase 2 webhook adds push.
  const { data: cases, isLoading, isError, error, refetch, isRefetching } = useQuery<LostItemCase[]>({
    queryKey: ['/api/lost-items/list', statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      return authFetch(`/api/lost-items/list${params.toString() ? `?${params}` : ''}`)
    },
    enabled: canAccess,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const { data: detail, isLoading: detailLoading } = useQuery<LostItemCase>({
    queryKey: ['/api/lost-items/get', activeId],
    queryFn: () => authFetch(`/api/lost-items/get?id=${encodeURIComponent(activeId!)}`),
    enabled: !!activeId,
  })

  const filtered = useMemo(() => cases ?? [], [cases])

  if (!canAccess) {
    return (
      <div className="p-5">
        <h1 className="text-xl font-semibold">Lost Items</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your role doesn't have access to Lost Items. Contact an admin if you need this view.
        </p>
      </div>
    )
  }

  return (
    <div className="p-5 h-full flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Lost Items</h1>
          <p className="text-sm text-muted-foreground">
            Live data from Haven-OS · auto-refreshes every 30s
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search description, guest, location…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 w-full sm:w-72 text-sm"
              data-testid="input-lost-items-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
            <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-lost-items-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(STATUS_LABELS) as LostItemStatus[]).map(k => (
                <SelectItem key={k} value={k}>{STATUS_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`w-3 h-3 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Couldn't load Lost Items: {error instanceof Error ? error.message : 'Unknown error'}</span>
        </div>
      )}

      <div className="flex-1 rounded-lg border border-border overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Case</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Item</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Property</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Guest</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Status</th>
              <th className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(6)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-3 w-full" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No lost items match your filters.</td></tr>
            ) : filtered.map(c => (
              <tr
                key={c.id}
                className="border-b border-border/50 hover:bg-muted/20 cursor-pointer"
                onClick={() => setActiveId(c.id)}
                data-testid={`row-lost-item-${c.id}`}
              >
                <td className="py-1.5 px-3 font-mono text-[11px]">{c.case_number}</td>
                <td className="py-1.5 px-3 max-w-[280px] truncate" title={c.item_description}>{c.item_description}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{c.property?.name ?? c.property_name ?? '—'}</td>
                <td className="py-1.5 px-3 text-muted-foreground">{c.guest_name ?? '—'}</td>
                <td className="py-1.5 px-3">
                  <span className={`px-1.5 py-0.5 rounded font-medium text-[10px] border ${STATUS_COLORS[c.status]}`}>
                    {STATUS_LABELS[c.status]}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-muted-foreground tabular-nums">
                  {c.updated_at ? format(new Date(c.updated_at), 'MMM d, h:mm a') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={!!activeId} onOpenChange={v => !v && setActiveId(null)}>
        <SheetContent className="w-full sm:w-[520px] overflow-y-auto">
          <SheetHeader className="pb-3">
            <SheetTitle className="text-base font-mono">{detail?.case_number ?? '…'}</SheetTitle>
          </SheetHeader>
          {detailLoading || !detail ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <Badge className={`text-[10px] border ${STATUS_COLORS[detail.status]}`}>
                  {STATUS_LABELS[detail.status]}
                </Badge>
                <p className="font-medium mt-2">{detail.item_description}</p>
                {detail.found_location && (
                  <p className="text-xs text-muted-foreground mt-1">Found at: {detail.found_location}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <Field label="Property" value={detail.property?.name ?? detail.property_name ?? '—'} />
                <Field label="Reservation" value={detail.reservation_ref ?? '—'} />
                <Field label="Guest" value={detail.guest_name ?? '—'} />
                <Field label="Email" value={detail.guest_email ?? '—'} />
                <Field label="Phone" value={detail.guest_phone ?? '—'} />
                <Field label="Vendor" value={detail.cleaning_vendor ?? '—'} />
                <Field label="Pickup" value={detail.pickup_scheduled_at ? format(new Date(detail.pickup_scheduled_at), 'MMM d, h:mm a') : '—'} />
                <Field label="Return" value={detail.return_method ?? '—'} />
                <Field label="Carrier" value={detail.shipping_carrier ?? '—'} />
                <Field label="Tracking" value={detail.shipping_tracking ?? '—'} />
                <Field label="Assignee" value={detail.assignee?.full_name ?? detail.assignee?.email ?? '—'} />
                <Field label="Follow-up" value={detail.follow_up_date ?? '—'} />
              </div>

              {detail.notes && (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                  {detail.notes}
                </div>
              )}

              {detail.events && detail.events.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Timeline</h4>
                  <div className="space-y-1.5">
                    {detail.events.map(e => (
                      <div key={e.id} className="border-l-2 border-border pl-2 text-xs">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span className="capitalize">{e.event_type.replace(/_/g, ' ')}</span>
                          <span className="text-muted-foreground/60">·</span>
                          <span>{format(new Date(e.created_at), 'MMM d, h:mm a')}</span>
                          {e.actor_label && <><span className="text-muted-foreground/60">·</span><span>{e.actor_label}</span></>}
                        </div>
                        {e.from_value && e.to_value && (
                          <div className="text-foreground/80">{e.from_value} → {e.to_value}</div>
                        )}
                        {e.body && <div className="text-foreground/80 whitespace-pre-wrap">{e.body}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Source: {detail.source}{detail.external_source ? ` · ${detail.external_source}` : ''}</span>
                {detail.external_url ? (
                  <a href={detail.external_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                    Open in Haven-OS <ExternalLink className="w-3 h-3" />
                  </a>
                ) : null}
              </div>

              <p className="text-[10px] text-muted-foreground italic pt-2">
                Read-only view. Edits go in Haven-OS for now; bidirectional sync arrives in Phase 2.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {isLoading && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading…
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-foreground tabular-nums">{value}</span>
    </div>
  )
}
