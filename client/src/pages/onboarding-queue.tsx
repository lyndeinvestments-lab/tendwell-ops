import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Check, X, RefreshCw, ChevronDown, ChevronRight, Building2, ExternalLink, Image as ImageIcon, Link2, Search } from 'lucide-react'

interface OnboardingSubmission {
  id: string
  source: 'token' | 'public'
  status: 'pending' | 'approved' | 'rejected' | 'converted'
  token: string | null
  client_name: string | null
  contact_email: string | null
  contact_phone: string | null
  invoice_email: string | null
  property_name: string | null
  address: string | null
  bedrooms: number | null
  number_of_beds: number | null
  full_baths: number | null
  half_baths: number | null
  square_footage: number | null
  bed_sizes: string | null
  hot_tub: boolean | null
  pool: boolean | null
  linen_program: boolean | null
  door_code: string | null
  auto_code: string | null
  other_codes: string | null
  wifi_info: string | null
  filter_size: string | null
  ical_url: string | null
  api_client_id: string | null
  api_key: string | null
  check_in_time: string | null
  check_out_time: string | null
  notes: string | null
  photos: string[]
  submitted_at: string
  approved_at: string | null
  approved_by: string | null
  property_id: number | null
}

type Tab = 'pending' | 'converted' | 'rejected' | 'all'

const ONBOARDING_STAGE_ID = 3

function fmtBool(v: boolean | null) {
  if (v === null) return '—'
  return v ? 'Yes' : 'No'
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

export default function OnboardingQueuePage() {
  usePageTitle('Onboarding Queue')
  const { effectiveUser, user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [mergeFor, setMergeFor] = useState<OnboardingSubmission | null>(null)

  const { data: rows, isLoading, isRefetching, refetch } = useQuery<OnboardingSubmission[]>({
    queryKey: ['/onboarding_submissions', tab],
    queryFn: async () => {
      let q = supabase.from('onboarding_submissions').select('*').order('submitted_at', { ascending: false }).limit(500)
      if (tab !== 'all') q = q.eq('status', tab)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as OnboardingSubmission[]
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const counts = useMemo(() => {
    const c = { pending: 0, converted: 0, rejected: 0, total: 0 }
    for (const r of rows ?? []) {
      if (r.status === 'pending') c.pending++
      else if (r.status === 'converted') c.converted++
      else if (r.status === 'rejected') c.rejected++
      c.total++
    }
    return c
  }, [rows])

  const { mutate: approve } = useMutation({
    mutationFn: async (sub: OnboardingSubmission) => {
      setWorking(sub.id)
      // properties.check_in_time / check_out_time are NOT NULL with column
      // defaults. Strip nulls so the defaults apply when the client didn't
      // fill those fields in (any other null field is fine — the column
      // simply stays null).
      const propertyPayload: Record<string, any> = {
        name: sub.property_name || sub.address || sub.client_name || 'New Property',
        address: sub.address,
        bedrooms: sub.bedrooms,
        number_of_beds: sub.number_of_beds,
        full_baths: sub.full_baths,
        half_baths: sub.half_baths,
        square_footage: sub.square_footage,
        hot_tub: sub.hot_tub ?? false,
        linen_program: sub.linen_program ?? false,
        door_code: sub.door_code,
        auto_code: sub.auto_code,
        other_codes: sub.other_codes,
        wifi_info: sub.wifi_info,
        filter_size: sub.filter_size,
        check_in_time: sub.check_in_time,
        check_out_time: sub.check_out_time,
        stage_id: ONBOARDING_STAGE_ID,
      }
      for (const k of Object.keys(propertyPayload)) {
        if (propertyPayload[k] == null) delete propertyPayload[k]
      }
      const { data: newProp, error: insErr } = await supabase
        .from('properties')
        .insert(propertyPayload as any)
        .select('id')
        .single()
      if (insErr) throw insErr

      const { error: updErr } = await supabase
        .from('onboarding_submissions')
        .update({
          status: 'converted',
          approved_at: new Date().toISOString(),
          approved_by: user?.label || (user as any)?.google_email || 'admin',
          property_id: newProp.id,
        })
        .eq('id', sub.id)
      if (updErr) throw updErr

      return newProp.id
    },
    onSuccess: (propertyId) => {
      toast({ title: 'Approved', description: `Property created (#${propertyId}) in Onboarding stage.` })
      qc.invalidateQueries({ queryKey: ['/onboarding_submissions'] })
      qc.invalidateQueries({ queryKey: ['/supabase/properties'] })
      setWorking(null)
    },
    onError: (e: any) => {
      toast({ title: 'Approval failed', description: e?.message || 'Try again.', variant: 'destructive' })
      setWorking(null)
    },
  })

  const { mutate: mergeWithExisting } = useMutation({
    mutationFn: async ({ sub, propertyId }: { sub: OnboardingSubmission; propertyId: number }) => {
      setWorking(sub.id)
      // Fetch current property values so we only fill in missing/empty fields —
      // we never overwrite data already entered by an admin.
      const { data: existing, error: fetchErr } = await supabase
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .single()
      if (fetchErr) throw fetchErr

      const candidate: Record<string, any> = {
        address: sub.address,
        bedrooms: sub.bedrooms,
        number_of_beds: sub.number_of_beds,
        full_baths: sub.full_baths,
        half_baths: sub.half_baths,
        square_footage: sub.square_footage,
        hot_tub: sub.hot_tub,
        linen_program: sub.linen_program,
        door_code: sub.door_code,
        auto_code: sub.auto_code,
        other_codes: sub.other_codes,
        wifi_info: sub.wifi_info,
        filter_size: sub.filter_size,
        check_in_time: sub.check_in_time,
        check_out_time: sub.check_out_time,
      }
      const patch: Record<string, any> = {}
      for (const [k, v] of Object.entries(candidate)) {
        if (v == null) continue
        const cur = (existing as any)?.[k]
        if (cur == null || cur === '' || cur === false) patch[k] = v
      }

      if (Object.keys(patch).length > 0) {
        const { error: upErr } = await supabase.from('properties').update(patch as any).eq('id', propertyId)
        if (upErr) throw upErr
      }

      const { error: subErr } = await supabase
        .from('onboarding_submissions')
        .update({
          status: 'converted',
          approved_at: new Date().toISOString(),
          approved_by: user?.label || (user as any)?.google_email || 'admin',
          property_id: propertyId,
        })
        .eq('id', sub.id)
      if (subErr) throw subErr

      return { propertyId, filled: Object.keys(patch).length }
    },
    onSuccess: ({ propertyId, filled }) => {
      toast({
        title: 'Merged',
        description: filled > 0
          ? `Linked to property #${propertyId} and filled ${filled} empty field${filled === 1 ? '' : 's'}.`
          : `Linked to property #${propertyId}. No fields needed updating.`,
      })
      qc.invalidateQueries({ queryKey: ['/onboarding_submissions'] })
      qc.invalidateQueries({ queryKey: ['/supabase/properties'] })
      setWorking(null)
      setMergeFor(null)
    },
    onError: (e: any) => {
      toast({ title: 'Merge failed', description: e?.message || 'Try again.', variant: 'destructive' })
      setWorking(null)
    },
  })

  const { mutate: reject } = useMutation({
    mutationFn: async (sub: OnboardingSubmission) => {
      setWorking(sub.id)
      const { error } = await supabase
        .from('onboarding_submissions')
        .update({
          status: 'rejected',
          approved_at: new Date().toISOString(),
          approved_by: user?.label || (user as any)?.google_email || 'admin',
        })
        .eq('id', sub.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Submission rejected' })
      qc.invalidateQueries({ queryKey: ['/onboarding_submissions'] })
      setWorking(null)
    },
    onError: (e: any) => {
      toast({ title: 'Reject failed', description: e?.message, variant: 'destructive' })
      setWorking(null)
    },
  })

  function photoUrl(path: string) {
    const { data } = supabase.storage.from('onboarding-uploads').getPublicUrl(path)
    return data.publicUrl
  }

  if (!effectiveUser) return null

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Building2 className="w-5 h-5" /> Onboarding Queue</h1>
          <p className="text-xs text-muted-foreground mt-1">Public submissions from <code className="px-1 py-0.5 rounded bg-muted text-[11px]">/onboarding</code>. Review and create properties.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} data-testid="button-refresh">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap text-sm">
        {([
          { key: 'pending', label: `Pending (${counts.pending})` },
          { key: 'converted', label: `Converted (${counts.converted})` },
          { key: 'rejected', label: `Rejected (${counts.rejected})` },
          { key: 'all', label: 'All' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            data-testid={`tab-${t.key}`}
            className={`px-3 h-8 rounded-md border transition-colors ${tab === t.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted/50'}`}
          >{t.label}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : (rows?.length ?? 0) === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No submissions in this view.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows!.map(r => {
            const expanded = expandedId === r.id
            const isWorking = working === r.id
            const isPublic = r.source === 'public'
            return (
              <Card key={r.id} data-testid={`row-submission-${r.id}`}>
                <CardHeader className="cursor-pointer p-3" onClick={() => setExpandedId(expanded ? null : r.id)}>
                  <div className="flex items-center gap-3 flex-wrap">
                    {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm font-medium truncate">
                        {r.property_name || r.address || '(no name)'} <span className="text-muted-foreground font-normal">— {r.client_name || 'Unknown'}</span>
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(r.submitted_at)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant={isPublic ? 'secondary' : 'outline'}>{isPublic ? 'Public' : 'Token'}</Badge>
                      <Badge variant={r.status === 'pending' ? 'default' : r.status === 'converted' ? 'secondary' : 'outline'}>{r.status}</Badge>
                      {r.photos.length > 0 && <Badge variant="outline"><ImageIcon className="w-3 h-3 mr-1" />{r.photos.length}</Badge>}
                      {r.api_key && <Badge variant="outline">API key</Badge>}
                      {r.ical_url && <Badge variant="outline">iCal</Badge>}
                    </div>
                  </div>
                </CardHeader>
                {expanded && (
                  <CardContent className="p-4 pt-0 space-y-3 text-sm border-t border-border">
                    <Section title="Contact">
                      <KV k="Name" v={r.client_name} />
                      <KV k="Email" v={r.contact_email} />
                      <KV k="Phone" v={r.contact_phone} />
                      <KV k="Invoice Email" v={r.invoice_email && r.invoice_email !== r.contact_email ? r.invoice_email : (r.invoice_email ? `${r.invoice_email} (same as primary)` : '—')} wide />
                    </Section>
                    <Section title="Property">
                      <KV k="Address" v={r.address} />
                      <KV k="Bedrooms" v={r.bedrooms} />
                      <KV k="Beds" v={r.number_of_beds} />
                      <KV k="Full / Half Baths" v={`${r.full_baths ?? '—'} / ${r.half_baths ?? '—'}`} />
                      <KV k="Sq Ft" v={r.square_footage} />
                      <KV k="Bed Sizes" v={r.bed_sizes} wide />
                      <KV k="Hot Tub" v={fmtBool(r.hot_tub)} />
                      <KV k="Pool" v={fmtBool(r.pool)} />
                      <KV k="Linen Program" v={fmtBool(r.linen_program)} />
                    </Section>
                    <Section title="Access & Wi-Fi">
                      <KV k="Door Code" v={r.door_code} />
                      <KV k="Auto Code" v={r.auto_code} />
                      <KV k="Other Codes" v={r.other_codes} wide />
                      <KV k="Wi-Fi" v={r.wifi_info} wide />
                      <KV k="A/C Filter" v={r.filter_size} />
                      <KV k="Check-in" v={r.check_in_time} />
                      <KV k="Check-out" v={r.check_out_time} />
                    </Section>
                    {(r.ical_url || r.api_key || r.api_client_id) && (
                      <Section title="Booking Integration">
                        {r.ical_url && <KV k="iCal URL" v={r.ical_url} wide />}
                        {r.api_client_id && <KV k="Client ID / public key" v={r.api_client_id} wide secret />}
                        {r.api_key && <KV k="API secret / client secret / token" v={r.api_key} wide secret />}
                      </Section>
                    )}
                    {r.notes && (
                      <Section title="Notes">
                        <div className="col-span-full whitespace-pre-wrap text-sm bg-muted/30 rounded p-2">{r.notes}</div>
                      </Section>
                    )}
                    {r.photos.length > 0 && (
                      <Section title={`Photos (${r.photos.length})`}>
                        <div className="col-span-full grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {r.photos.map(p => {
                            const url = photoUrl(p)
                            const isPdf = p.toLowerCase().endsWith('.pdf')
                            return (
                              <a key={p} href={url} target="_blank" rel="noreferrer" className="block aspect-square rounded-md border border-border overflow-hidden bg-muted/30 hover:opacity-80 transition-opacity">
                                {isPdf ? (
                                  <div className="w-full h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-1 p-2">
                                    <ExternalLink className="w-4 h-4" />
                                    <span className="truncate w-full text-center">PDF</span>
                                  </div>
                                ) : (
                                  <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                                )}
                              </a>
                            )
                          })}
                        </div>
                      </Section>
                    )}
                    {r.property_id && (
                      <p className="text-xs text-muted-foreground">Linked to property #{r.property_id} · approved {fmtDate(r.approved_at)} by {r.approved_by || '—'}</p>
                    )}

                    {r.status === 'pending' && (
                      <div className="flex gap-2 pt-2 flex-wrap">
                        <Button size="sm" onClick={() => approve(r)} disabled={isWorking} data-testid={`button-approve-${r.id}`}>
                          <Check className="w-3.5 h-3.5 mr-1.5" /> Approve & Create Property
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setMergeFor(r)} disabled={isWorking} data-testid={`button-merge-${r.id}`}>
                          <Link2 className="w-3.5 h-3.5 mr-1.5" /> Merge with Existing
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => reject(r)} disabled={isWorking} data-testid={`button-reject-${r.id}`}>
                          <X className="w-3.5 h-3.5 mr-1.5" /> Reject
                        </Button>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <MergePropertyDialog
        submission={mergeFor}
        working={!!working && mergeFor?.id === working}
        onClose={() => setMergeFor(null)}
        onPick={(propertyId) => mergeFor && mergeWithExisting({ sub: mergeFor, propertyId })}
      />
    </div>
  )
}

interface PropertyMatch {
  id: number
  name: string
  address: string | null
  stage_id: number | null
  pipeline_stages?: { name: string | null } | null
}

function MergePropertyDialog({
  submission,
  working,
  onClose,
  onPick,
}: {
  submission: OnboardingSubmission | null
  working: boolean
  onClose: () => void
  onPick: (propertyId: number) => void
}) {
  const [search, setSearch] = useState('')

  const initialQuery = useMemo(() => {
    if (!submission) return ''
    return submission.client_name || submission.address || submission.property_name || ''
  }, [submission])

  const effectiveQuery = search || initialQuery

  const { data: matches, isLoading } = useQuery<PropertyMatch[]>({
    queryKey: ['/onboarding_submissions/merge-candidates', submission?.id, effectiveQuery],
    enabled: !!submission,
    queryFn: async () => {
      const tokens = effectiveQuery
        .split(/[,\s]+/)
        .map(t => t.trim())
        .filter(t => t.length >= 2)
        .slice(0, 4)

      const ors: string[] = []
      for (const t of tokens) {
        const safe = t.replace(/[,()%]/g, ' ')
        ors.push(`name.ilike.%${safe}%`)
        ors.push(`address.ilike.%${safe}%`)
      }
      let q = supabase
        .from('properties')
        .select('id,name,address,stage_id,pipeline_stages(name)')
        .order('id', { ascending: false })
        .limit(40)
      if (ors.length > 0) q = q.or(ors.join(','))
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as PropertyMatch[]
    },
    staleTime: 10_000,
  })

  return (
    <Dialog open={!!submission} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge with existing property</DialogTitle>
          <DialogDescription>
            Find the existing listing this submission matches. We'll link the submission and fill in any blank fields on the property — without overwriting data that's already there.
          </DialogDescription>
        </DialogHeader>

        {submission && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-0.5">
            <p><span className="text-muted-foreground">Client:</span> {submission.client_name || '—'}</p>
            <p><span className="text-muted-foreground">Address:</span> {submission.address || '—'}</p>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={initialQuery ? `Searching for "${initialQuery}" — refine here` : 'Search by name or address'}
            className="pl-8 h-9 text-sm"
            data-testid="input-merge-search"
          />
        </div>

        <div className="max-h-[360px] overflow-y-auto -mx-2">
          {isLoading ? (
            <div className="space-y-2 px-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : (matches?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No matching properties.</p>
          ) : (
            <ul className="space-y-1 px-2">
              {matches!.map(m => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onPick(m.id)}
                    disabled={working}
                    className="w-full text-left px-3 py-2 rounded-md border border-border hover:bg-muted/50 transition-colors text-sm disabled:opacity-50"
                    data-testid={`button-pick-property-${m.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{m.name}</span>
                      {m.pipeline_stages?.name && <Badge variant="outline" className="shrink-0">{m.pipeline_stages.name}</Badge>}
                    </div>
                    {m.address && <p className="text-xs text-muted-foreground truncate mt-0.5">{m.address}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={working}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">{children}</div>
    </div>
  )
}

function KV({ k, v, wide, secret }: { k: string; v: any; wide?: boolean; secret?: boolean }) {
  const display = v == null || v === '' ? '—' : String(v)
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-[11px] text-muted-foreground">{k}</p>
      <p className={`text-sm break-words ${secret ? 'font-mono' : ''}`}>{display}</p>
    </div>
  )
}
