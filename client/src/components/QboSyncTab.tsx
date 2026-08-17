import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Loader2, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/StatCard'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Landmark } from 'lucide-react'

// QuickBooks tab on the API Sync page: shows the nightly qbo_classes snapshot
// (api/cron/qbo-classes-sync.ts) reconciled against Haven-billed properties.
// The invoicing QBO/Ramp exporters only write a Class that exists in QBO —
// a property listed under "No QBO class" exports a BLANK Class cell until a
// matching Class is created in QuickBooks (or the property is renamed).

interface QboClassRow {
  qbo_id: string
  name: string
  fully_qualified_name: string
  active: boolean
  synced_at: string | null
}

interface HavenProperty {
  id: number
  name: string | null
  pipeline_stages: { name: string } | { name: string }[] | null
}

const OPERATIONAL_STAGES = new Set(['Onboarding', 'Active', 'Offboarding'])

function stageOf(p: HavenProperty): string {
  const s = p.pipeline_stages
  if (!s) return ''
  return Array.isArray(s) ? s[0]?.name ?? '' : s.name ?? ''
}

// Mirror of the server-side resolution in api/invoices/_exporters.ts
// (qboClassFor): exact case-insensitive match → unique word-boundary prefix
// match → none. Display-only here (the export uses the server copy) — keep
// the two in sync.
function norm(v: string): string {
  return v.toLowerCase().replace(/\s+/g, ' ').trim()
}

function matchClass(propertyName: string, classes: QboClassRow[]): { kind: 'exact' | 'prefix' | 'none'; className: string | null } {
  const p = norm(propertyName)
  if (!p) return { kind: 'none', className: null }
  const exact = classes.find(c => norm(c.name) === p)
  if (exact) return { kind: 'exact', className: exact.name }
  const prefixes = classes.filter(c => {
    const n = norm(c.name)
    return n.length > 0 && p.startsWith(`${n} `)
  })
  if (prefixes.length === 1) return { kind: 'prefix', className: prefixes[0].name }
  return { kind: 'none', className: null }
}

export function QboSyncTab() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')

  const classesQuery = useQuery({
    queryKey: ['/supabase/qbo-classes'],
    queryFn: async () => {
      // qbo_classes isn't in the generated Database types yet (repo convention
      // for new tables — see issue_comments call sites).
      const { data, error } = await (supabase as any)
        .from('qbo_classes')
        .select('qbo_id, name, fully_qualified_name, active, synced_at')
        .order('name')
      if (error) throw error
      return (data ?? []) as QboClassRow[]
    },
  })

  // Haven-billed properties are the only ones that hit the QBO invoice export.
  const propertiesQuery = useQuery({
    queryKey: ['/supabase/qbo-haven-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, contacts!inner(billing_channel), pipeline_stages!properties_stage_id_fkey(name)')
        .eq('contacts.billing_channel', 'qbo_haven')
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as HavenProperty[]
    },
  })

  const activeClasses = useMemo(
    () => (classesQuery.data ?? []).filter(c => c.active),
    [classesQuery.data],
  )

  const lastSynced = useMemo(() => {
    const stamps = (classesQuery.data ?? []).map(c => c.synced_at).filter(Boolean) as string[]
    return stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null
  }, [classesQuery.data])

  // Match every operational Haven property against the class list.
  const matches = useMemo(() => {
    const props = (propertiesQuery.data ?? []).filter(p => OPERATIONAL_STAGES.has(stageOf(p)))
    return props.map(p => ({ property: p, ...matchClass(p.name ?? '', activeClasses) }))
  }, [propertiesQuery.data, activeClasses])

  const exactCount = matches.filter(m => m.kind === 'exact').length
  const prefixMatches = matches.filter(m => m.kind === 'prefix')
  const unmatched = matches.filter(m => m.kind === 'none')

  const usedClassNames = useMemo(
    () => new Set(matches.filter(m => m.className).map(m => norm(m.className!))),
    [matches],
  )

  const filteredClasses = useMemo(() => {
    const q = norm(search)
    const rows = classesQuery.data ?? []
    return q ? rows.filter(c => norm(c.name).includes(q) || norm(c.fully_qualified_name).includes(q)) : rows
  }, [classesQuery.data, search])

  async function syncNow() {
    setSyncing(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Not signed in')
      const res = await fetch('/api/cron/qbo-classes-sync', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Sync failed (${res.status})`)
      toast({
        title: 'QuickBooks classes synced',
        description: `${json.classes} classes (${json.active} active) · ${json.environment}`,
      })
      qc.invalidateQueries({ queryKey: ['/supabase/qbo-classes'] })
    } catch (e: any) {
      toast({ title: 'QuickBooks class sync failed', description: e?.message, variant: 'destructive' })
    } finally {
      setSyncing(false)
    }
  }

  if (classesQuery.isError) {
    return <ErrorState onRetry={() => classesQuery.refetch()} title="Couldn't load QuickBooks classes" description="The qbo_classes table failed to load. Has the migration been applied?" />
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          {lastSynced
            ? `Class list as of ${new Date(lastSynced).toLocaleString()} — refreshed nightly.`
            : 'No class snapshot yet — run a sync (or wait for the nightly cron). Until then, invoice exports write the property name as the Class.'}
        </p>
        <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing} data-testid="qbo-classes-sync-now">
          {syncing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
          Refresh from QuickBooks
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Active QBO classes" value={String(activeClasses.length)} icon={Landmark} loading={classesQuery.isLoading} />
        <StatCard title="Haven properties" value={String(matches.length)} icon={Landmark} tone="info" loading={propertiesQuery.isLoading} />
        <StatCard title="Matched" value={String(exactCount + prefixMatches.length)} icon={Landmark} tone="success" loading={classesQuery.isLoading || propertiesQuery.isLoading} />
        <StatCard title="No QBO class" value={String(unmatched.length)} icon={Landmark} tone={unmatched.length ? 'destructive' : 'success'} loading={classesQuery.isLoading || propertiesQuery.isLoading} />
      </div>

      {unmatched.length > 0 && (
        <Card className="rounded-2xl border-card-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Haven properties with no QBO class ({unmatched.length})
            </CardTitle>
            <p className="text-2xs text-muted-foreground">
              Invoice exports leave the Class cell blank for these until a matching Class is created in QuickBooks.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1.5">
              {unmatched.map(m => (
                <StatusBadge key={m.property.id} tone="destructive">{m.property.name}</StatusBadge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {prefixMatches.length > 0 && (
        <Card className="rounded-2xl border-card-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Prefix matches ({prefixMatches.length})</CardTitle>
            <p className="text-2xs text-muted-foreground">
              Property name and class differ, but the class is an unambiguous prefix — exports use the class name shown.
            </p>
          </CardHeader>
          <CardContent className="pt-0 space-y-1">
            {prefixMatches.map(m => (
              <p key={m.property.id} className="text-sm">
                <span className="font-medium">{m.property.name}</span>
                <span className="text-muted-foreground"> → {m.className}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-card-border shadow-sm">
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">All QBO classes ({(classesQuery.data ?? []).length})</CardTitle>
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8 h-8" placeholder="Search classes…" value={search} onChange={e => setSearch(e.target.value)} data-testid="qbo-classes-search" />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {filteredClasses.length === 0 ? (
            <EmptyState icon={Landmark} title="No classes" description={search ? 'No classes match your search.' : 'Run a sync to pull the class list from QuickBooks.'} />
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Class</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 font-medium">Used by a property</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClasses.map(c => (
                    <tr key={c.qbo_id} className="border-t border-border/60">
                      <td className="py-1.5 pr-3">{c.fully_qualified_name || c.name}</td>
                      <td className="py-1.5 pr-3">
                        <StatusBadge tone={c.active ? 'success' : 'warning'}>{c.active ? 'Active' : 'Inactive'}</StatusBadge>
                      </td>
                      <td className="py-1.5 text-muted-foreground">{usedClassNames.has(norm(c.name)) ? 'Yes' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
