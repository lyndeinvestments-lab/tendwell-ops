import { useEffect, useMemo, useState } from 'react'
import { Link, useRoute } from 'wouter'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft, ExternalLink, Loader2, MessageSquare, Send, Slack,
  AlertTriangle, MessageCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth, canAccessView } from '@/lib/auth'
import { PageContainer } from '@/components/PageContainer'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  STATUS_COLORS, STATUS_LABELS, LOST_ITEM_PIPELINE, RETURN_METHODS,
  authFetch,
  type LostItemAssignment, type LostItemCase,
} from '@/components/lost-items/shared'

interface AppUserRow { id: number; label: string; role: string }

export default function LostItemDetailPage() {
  const [, params] = useRoute<{ id: string }>('/lost-items/:id')
  const caseId = params?.id ?? ''

  const { effectiveUser } = useAuth()
  const canAccess = canAccessView('lost-items', effectiveUser)
  const canEdit = !!effectiveUser && (effectiveUser.role === 'admin' || effectiveUser.role === 'operations')

  usePageTitle('Lost Item · Tendwell')
  const qc = useQueryClient()
  const { toast } = useToast()

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['/api/lost-items/list'] })
    qc.invalidateQueries({ queryKey: ['/api/lost-items/get', caseId] })
    qc.invalidateQueries({ queryKey: ['/api/lost-items/assignments'] })
  }

  const { data: item, isLoading, isError, error } = useQuery<LostItemCase>({
    queryKey: ['/api/lost-items/get', caseId],
    queryFn: () => authFetch(`/api/lost-items/get?id=${encodeURIComponent(caseId)}`),
    enabled: canAccess && !!caseId,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  })

  const { data: assignmentsData } = useQuery<{ assignments: LostItemAssignment[] }>({
    queryKey: ['/api/lost-items/assignments', caseId],
    queryFn: () => authFetch(`/api/lost-items/assignments?case_ids=${encodeURIComponent(caseId)}`),
    enabled: canAccess && !!caseId,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  })
  const assignment = assignmentsData?.assignments?.[0]

  const { data: teamRaw } = useQuery<AppUserRow[]>({
    queryKey: ['lost-items-team-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, label, role')
        .order('label', { ascending: true })
      if (error) throw error
      return (data ?? []) as AppUserRow[]
    },
    staleTime: 5 * 60_000,
  })
  const team = useMemo(() => (teamRaw ?? []).filter(u => u.role !== 'viewer'), [teamRaw])

  const updateField = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      return authFetch(`/api/lost-items/update?id=${encodeURIComponent(caseId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    },
    onSuccess: () => { toast({ title: 'Saved' }); invalidateAll() },
    onError: (e: any) => { toast({ title: 'Save failed', description: e?.message ?? 'Unknown error', variant: 'destructive' }) },
  })

  const setAssignment = useMutation({
    mutationFn: async (userId: number | null) => {
      return authFetch('/api/lost-items/assign', {
        method: 'POST',
        body: JSON.stringify({ case_id: caseId, user_id: userId }),
      })
    },
    onSuccess: () => { toast({ title: 'Assignment updated' }); invalidateAll() },
    onError: (e: any) => { toast({ title: 'Failed to assign', description: e?.message ?? 'Unknown error', variant: 'destructive' }) },
  })

  if (!canAccess) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Lost Items</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your role doesn't have access to Lost Items.
        </p>
      </div>
    )
  }

  if (isLoading || !item) {
    return (
      <PageContainer width="xl" className="space-y-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-96" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    )
  }

  if (isError) {
    return (
      <PageContainer width="lg">
        <Link href="/lost-items" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to all cases
        </Link>
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span>Couldn't load case: {error instanceof Error ? error.message : 'Unknown error'}</span>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="xl">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="flex flex-col gap-5 min-w-0">
          <Link href="/lost-items" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-fit">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to all cases
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs text-muted-foreground">{item.case_number}</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium text-2xs border ${STATUS_COLORS[item.status]}`}>
              {STATUS_LABELS[item.status]}
            </span>
            <span className="text-xs text-muted-foreground">
              opened {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
            </span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight">{item.item_description}</h2>

          <div className="flex flex-wrap gap-1.5">
            {LOST_ITEM_PIPELINE.map(s => {
              const active = item.status === s
              const isFailed = s === 'failed'
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!canEdit || updateField.isPending || active}
                  onClick={() => updateField.mutate({ status: s })}
                  className={
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                    (active
                      ? (isFailed
                        ? 'border-rose-500 bg-rose-500 text-destructive-foreground cursor-default'
                        : 'border-foreground bg-foreground text-background cursor-default')
                      : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50 disabled:cursor-not-allowed')
                  }
                  data-testid={`pill-status-${s}`}
                >
                  {STATUS_LABELS[s]}
                </button>
              )
            })}
          </div>

          <ActivityFeed
            caseId={caseId}
            events={item.events ?? []}
            canEdit={canEdit}
            onAfterChange={invalidateAll}
          />

          <DetailsCard
            item={item}
            canEdit={canEdit}
            onSave={(patch) => updateField.mutateAsync(patch)}
          />
        </div>

        <div className="flex flex-col gap-3">
          <SidePanel title="Assignment">
            <div className="flex flex-col gap-1">
              <Label>Owner (Tendwell)</Label>
              <select
                value={assignment?.assigned_user_id != null ? String(assignment.assigned_user_id) : ''}
                onChange={e => setAssignment.mutate(e.target.value === '' ? null : Number(e.target.value))}
                disabled={!canEdit || setAssignment.isPending}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                data-testid="select-detail-assignee"
              >
                <option value="">- Unassigned</option>
                {team.map(u => (
                  <option key={u.id} value={u.id}>{u.label} · {u.role}</option>
                ))}
              </select>
              {assignment?.assignee?.label ? (
                <span className="text-2xs text-muted-foreground">
                  Assigned {formatDistanceToNow(new Date(assignment.updated_at), { addSuffix: true })}
                </span>
              ) : null}
            </div>
            <InlineDateRow
              label="Follow-up date"
              value={item.follow_up_date ?? ''}
              canEdit={canEdit}
              onChange={(v) => updateField.mutate({ follow_up_date: v || null })}
            />
          </SidePanel>

          <SidePanel title="Links">
            <LinkRow icon={<Slack className="h-3.5 w-3.5" />} label="Slack thread" url={(item as any).slack_thread_url ?? null} />
            <LinkRow icon={<MessageCircle className="h-3.5 w-3.5" />} label="Conversation" url={(item as any).conversation_url ?? null} />
            {item.external_url ? (
              <LinkRow
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                label={item.external_source ?? 'Source system'}
                url={item.external_url}
              />
            ) : null}
            <LinkRow
              icon={<ExternalLink className="h-3.5 w-3.5" />}
              label="Open in Haven-OS"
              url={`https://www.havenvros.com/operations/lost-items/${item.id}`}
            />
          </SidePanel>

          <SidePanel title="Source">
            <KV label="Origin" value={item.source} />
            {item.external_source ? <KV label="External system" value={item.external_source} /> : null}
            {(item as any).external_id ? <KV label="External ID" value={(item as any).external_id} mono /> : null}
          </SidePanel>

          <SidePanel title="Timeline">
            <KV label="Opened" value={fmt(item.created_at)} />
            <KV label="Pickup scheduled" value={fmt(item.pickup_scheduled_at)} />
            <KV label="Last update" value={fmt(item.updated_at)} />
          </SidePanel>

          {item.photo_urls && item.photo_urls.length > 0 ? (
            <SidePanel title="Photos">
              <div className="grid grid-cols-3 gap-2">
                {item.photo_urls.map(url => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-16 object-cover rounded-md border border-border" />
                  </a>
                ))}
              </div>
              <p className="text-2xs text-muted-foreground">Upload happens in Haven-OS.</p>
            </SidePanel>
          ) : null}
        </div>
      </div>
    </PageContainer>
  )
}

function ActivityFeed({
  caseId, events, canEdit, onAfterChange,
}: {
  caseId: string
  events: NonNullable<LostItemCase['events']>
  canEdit: boolean
  onAfterChange: () => void
}) {
  const { toast } = useToast()
  const [comment, setComment] = useState('')

  const post = useMutation({
    mutationFn: async (body: string) => {
      return authFetch(`/api/lost-items/comment?id=${encodeURIComponent(caseId)}`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
    },
    onSuccess: () => { setComment(''); onAfterChange() },
    onError: (e: any) => { toast({ title: 'Failed to post comment', description: e?.message ?? 'Unknown error', variant: 'destructive' }) },
  })

  const comments = useMemo(() => events.filter(e => e.event_type === 'comment'), [events])
  const others = useMemo(() => events.filter(e => e.event_type !== 'comment'), [events])

  function submit() {
    if (!comment.trim() || post.isPending) return
    post.mutate(comment.trim())
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <MessageSquare className="h-4 w-4" />
        Comments &amp; activity
      </h3>

      {canEdit ? (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
            }}
            rows={2}
            placeholder="Add a comment for the team - context, next steps, what the guest said…"
            className="text-sm"
            data-testid="input-comment"
          />
          <div className="flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">
              {comments.length} comment{comments.length === 1 ? '' : 's'}
            </span>
            <Button
              size="sm"
              onClick={submit}
              disabled={post.isPending || !comment.trim()}
              className="h-7 gap-1.5 text-xs"
              data-testid="button-submit-comment"
            >
              {post.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Post comment
            </Button>
          </div>
        </div>
      ) : null}

      {comments.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3">
          {comments.map(e => (
            <li key={e.id} className="flex flex-col gap-1 rounded-md border border-border bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {e.actor?.full_name ?? e.actor?.email ?? e.actor_label ?? 'system'}
                </span>
                <span>·</span>
                <span>{fmt(e.created_at)}</span>
                <span>·</span>
                <span>{formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm">{e.body}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          No comments yet. {canEdit ? 'Be the first to add context for the team.' : null}
        </p>
      )}

      {others.length > 0 ? (
        <details className="mt-5 group">
          <summary className="cursor-pointer text-2xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground select-none">
            Activity log ({others.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {others.map(e => (
              <li key={e.id} className="flex flex-col gap-0.5 rounded-md border border-border bg-muted/30 p-2.5">
                <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {e.actor?.full_name ?? e.actor?.email ?? e.actor_label ?? 'system'}
                  </span>
                  <span>·</span>
                  <span>{fmt(e.created_at)}</span>
                  <span>·</span>
                  <span className="uppercase tracking-wider">{e.event_type.replace(/_/g, ' ')}</span>
                </div>
                {e.event_type === 'status_change' ? (
                  <div className="text-sm">Status: <strong>{e.from_value ?? '—'}</strong> → <strong>{e.to_value ?? '—'}</strong></div>
                ) : e.event_type === 'assignment' ? (
                  <div className="text-sm">Assigned: <strong>{e.from_value ?? '—'}</strong> → <strong>{e.to_value ?? '—'}</strong></div>
                ) : e.body ? (
                  <div className="text-sm whitespace-pre-wrap">{e.body}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function DetailsCard({
  item, canEdit, onSave,
}: {
  item: LostItemCase
  canEdit: boolean
  onSave: (patch: Record<string, unknown>) => Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    item_description: item.item_description,
    found_location: item.found_location ?? '',
    property_name: item.property?.name ?? item.property_name ?? '',
    guest_name: item.guest_name ?? '',
    guest_email: item.guest_email ?? '',
    guest_phone: item.guest_phone ?? '',
    cleaning_vendor: item.cleaning_vendor ?? '',
    return_method: item.return_method ?? '',
    shipping_carrier: item.shipping_carrier ?? '',
    shipping_tracking: item.shipping_tracking ?? '',
    notes: item.notes ?? '',
  })
  useEffect(() => {
    setDraft({
      item_description: item.item_description,
      found_location: item.found_location ?? '',
      property_name: item.property?.name ?? item.property_name ?? '',
      guest_name: item.guest_name ?? '',
      guest_email: item.guest_email ?? '',
      guest_phone: item.guest_phone ?? '',
      cleaning_vendor: item.cleaning_vendor ?? '',
      return_method: item.return_method ?? '',
      shipping_carrier: item.shipping_carrier ?? '',
      shipping_tracking: item.shipping_tracking ?? '',
      notes: item.notes ?? '',
    })
  }, [item])

  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      await onSave({
        item_description: draft.item_description.trim(),
        found_location: draft.found_location.trim() || null,
        property_name: draft.property_name.trim() || null,
        guest_name: draft.guest_name.trim() || null,
        guest_email: draft.guest_email.trim() || null,
        guest_phone: draft.guest_phone.trim() || null,
        cleaning_vendor: draft.cleaning_vendor.trim() || null,
        return_method: draft.return_method || null,
        shipping_carrier: draft.shipping_carrier.trim() || null,
        shipping_tracking: draft.shipping_tracking.trim() || null,
        notes: draft.notes.trim() || null,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Case details</h3>
          {canEdit ? (
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-primary hover:underline" data-testid="button-edit-details">
              Edit
            </button>
          ) : null}
        </div>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <KV label="Item" value={item.item_description} />
          <KV label="Found at" value={item.found_location ?? '—'} />
          <KV label="Property" value={item.property?.name ?? item.property_name ?? '—'} />
          <KV label="Guest" value={item.guest_name ?? '—'} />
          <KV label="Guest email" value={item.guest_email ?? '—'} />
          <KV label="Guest phone" value={item.guest_phone ?? '—'} />
          <KV label="Cleaning vendor" value={item.cleaning_vendor ?? '—'} />
          <KV label="Return method" value={item.return_method ?? '—'} />
          <KV label="Carrier" value={item.shipping_carrier ?? '—'} />
          <KV label="Tracking #" value={item.shipping_tracking ?? '—'} mono />
        </dl>
        {item.notes ? (
          <div className="mt-4">
            <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</p>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
      <h3 className="text-base font-semibold">Edit case</h3>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <FieldRow label="Item description"><Input value={draft.item_description} onChange={e => setDraft({ ...draft, item_description: e.target.value })} /></FieldRow>
        <FieldRow label="Found at"><Input value={draft.found_location} onChange={e => setDraft({ ...draft, found_location: e.target.value })} /></FieldRow>
        <FieldRow label="Property"><Input value={draft.property_name} onChange={e => setDraft({ ...draft, property_name: e.target.value })} /></FieldRow>
        <FieldRow label="Guest name"><Input value={draft.guest_name} onChange={e => setDraft({ ...draft, guest_name: e.target.value })} /></FieldRow>
        <FieldRow label="Guest email"><Input type="email" value={draft.guest_email} onChange={e => setDraft({ ...draft, guest_email: e.target.value })} /></FieldRow>
        <FieldRow label="Guest phone"><Input value={draft.guest_phone} onChange={e => setDraft({ ...draft, guest_phone: e.target.value })} /></FieldRow>
        <FieldRow label="Cleaning vendor"><Input value={draft.cleaning_vendor} onChange={e => setDraft({ ...draft, cleaning_vendor: e.target.value })} /></FieldRow>
        <FieldRow label="Return method">
          <select
            value={draft.return_method}
            onChange={e => setDraft({ ...draft, return_method: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">- unset -</option>
            {RETURN_METHODS.map(r => (
              <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Carrier"><Input value={draft.shipping_carrier} onChange={e => setDraft({ ...draft, shipping_carrier: e.target.value })} /></FieldRow>
        <FieldRow label="Tracking #"><Input value={draft.shipping_tracking} onChange={e => setDraft({ ...draft, shipping_tracking: e.target.value })} /></FieldRow>
        <div className="sm:col-span-2">
          <FieldRow label="Notes">
            <Textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} rows={3} />
          </FieldRow>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving || !draft.item_description.trim()} data-testid="button-save-details">
          {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Save changes
        </Button>
      </div>
    </div>
  )
}

function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
      <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </div>
  )
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={'text-sm break-all text-right ' + (mono ? 'font-mono text-xs' : '')}>{value}</dd>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </label>
  )
}

function LinkRow({ icon, label, url }: { icon: React.ReactNode; label: string; url: string | null | undefined }) {
  if (!url) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">{icon}{label}</span>
        <span className="text-muted-foreground/60">-</span>
      </div>
    )
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 text-xs hover:text-primary">
      <span className="inline-flex items-center gap-1.5">{icon}{label}</span>
      <ExternalLink className="h-3 w-3 flex-shrink-0" />
    </a>
  )
}

function InlineDateRow({
  label, value, canEdit, onChange,
}: {
  label: string
  value: string
  canEdit: boolean
  onChange: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input
        type="date"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onChange(draft) }}
        disabled={!canEdit}
        className="h-8 text-xs"
      />
    </div>
  )
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return format(new Date(iso), 'MMM d, yyyy h:mm a') } catch { return '—' }
}
