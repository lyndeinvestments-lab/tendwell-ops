import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ExternalLink, Pencil, Save, X, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import {
  STATUS_COLORS, LOST_ITEM_PIPELINE, RETURN_METHODS,
  authFetch, statusLabel, returnMethodLabel,
  type LostItemAssignment, type LostItemCase,
} from './shared'

interface Props {
  caseId: string
  detail: LostItemCase
  assignment?: LostItemAssignment
  canEdit: boolean
}

interface AppUserRow { id: number; label: string; role: string }

export function LostItemDetailPanel({ caseId, detail, assignment, canEdit }: Props) {
  const { t } = useLocale('lostItems')
  const { format } = useDateFormat()
  const qc = useQueryClient()
  const { toast } = useToast()

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['/api/lost-items/list'] })
    qc.invalidateQueries({ queryKey: ['/api/lost-items/get', caseId] })
    qc.invalidateQueries({ queryKey: ['/api/lost-items/assignments'] })
  }

  const updateField = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      return authFetch(`/api/lost-items/update?id=${encodeURIComponent(caseId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    },
    onSuccess: () => { toast({ title: t('toasts.saved') }); invalidateAll() },
    onError: (e: any) => { toast({ title: t('toasts.saveFailed'), description: e?.message ?? t('toasts.unknownError'), variant: 'destructive' }) },
  })

  const [draft, setDraft] = useState('')
  const addComment = useMutation({
    mutationFn: async (body: string) => {
      return authFetch(`/api/lost-items/comment?id=${encodeURIComponent(caseId)}`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
    },
    onSuccess: () => { setDraft(''); toast({ title: t('toasts.commentAdded') }); invalidateAll() },
    onError: (e: any) => { toast({ title: t('toasts.commentFailed'), description: e?.message ?? t('toasts.unknownError'), variant: 'destructive' }) },
  })

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

  const setAssignment = useMutation({
    mutationFn: async (userId: number | null) => {
      return authFetch('/api/lost-items/assign', {
        method: 'POST',
        body: JSON.stringify({ case_id: caseId, user_id: userId }),
      })
    },
    onSuccess: () => { toast({ title: t('toasts.assignmentUpdated') }); invalidateAll() },
    onError: (e: any) => { toast({ title: t('toasts.assignFailed'), description: e?.message ?? t('toasts.unknownError'), variant: 'destructive' }) },
  })

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge className={`text-[10px] border ${STATUS_COLORS[detail.status]}`}>
            {statusLabel(detail.status, t)}
          </Badge>
          {canEdit ? (
            <Select
              value={detail.status}
              onValueChange={v => updateField.mutate({ status: v })}
              disabled={updateField.isPending}
            >
              <SelectTrigger className="h-7 w-36 text-[11px]" data-testid="select-detail-status">
                <SelectValue placeholder={t('detail.changeStatus')} />
              </SelectTrigger>
              <SelectContent>
                {LOST_ITEM_PIPELINE.map(s => (
                  <SelectItem key={s} value={s}>{statusLabel(s, t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <InlineText
          label={t('detail.fields.description')}
          value={detail.item_description}
          canEdit={canEdit}
          required
          onSave={v => updateField.mutate({ item_description: v })}
        />
        <InlineText
          label={t('detail.fields.foundAt')}
          value={detail.found_location ?? ''}
          canEdit={canEdit}
          onSave={v => updateField.mutate({ found_location: v || null })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <InlineText label={t('common.labels.property')} value={detail.property?.name ?? detail.property_name ?? ''} canEdit={canEdit} onSave={v => updateField.mutate({ property_name: v || null })} />
        <InlineText label={t('detail.fields.guestName')} value={detail.guest_name ?? ''} canEdit={canEdit} onSave={v => updateField.mutate({ guest_name: v || null })} />
        <InlineText label={t('detail.fields.guestEmail')} value={detail.guest_email ?? ''} canEdit={canEdit} onSave={v => updateField.mutate({ guest_email: v || null })} />
        <InlineText label={t('detail.fields.guestPhone')} value={detail.guest_phone ?? ''} canEdit={canEdit} onSave={v => updateField.mutate({ guest_phone: v || null })} />
        <InlineText label={t('detail.fields.cleaningVendor')} value={detail.cleaning_vendor ?? ''} canEdit={canEdit} onSave={v => updateField.mutate({ cleaning_vendor: v || null })} />
        <InlineText label={t('detail.fields.shippingCarrier')} value={detail.shipping_carrier ?? ''} canEdit={canEdit} onSave={v => updateField.mutate({ shipping_carrier: v || null })} />
        <InlineText label={t('detail.fields.trackingNumber')} value={detail.shipping_tracking ?? ''} canEdit={canEdit} onSave={v => updateField.mutate({ shipping_tracking: v || null })} />
        <InlineDate label={t('detail.fields.followUp')} value={detail.follow_up_date ?? ''} canEdit={canEdit} onSave={v => updateField.mutate({ follow_up_date: v || null })} />
        <InlineSelect
          label={t('detail.fields.returnMethod')}
          value={detail.return_method ?? ''}
          options={[{ v: '', label: '—' }, ...RETURN_METHODS.map(r => ({ v: r, label: returnMethodLabel(r, t) }))]}
          canEdit={canEdit}
          onSave={v => updateField.mutate({ return_method: v || null })}
        />
        <AssignmentField
          assignment={assignment}
          team={team}
          canEdit={canEdit}
          onChange={(uid) => setAssignment.mutate(uid)}
          pending={setAssignment.isPending}
        />
      </div>

      {detail.photo_urls && detail.photo_urls.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{t('detail.panels.photos')}</h4>
          <div className="grid grid-cols-3 gap-2">
            {detail.photo_urls.map(url => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-20 object-cover rounded-md border border-border" />
              </a>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{t('detail.photos.uploadNote')}</p>
        </div>
      )}

      <InlineTextarea
        label={t('common.labels.notes')}
        value={detail.notes ?? ''}
        canEdit={canEdit}
        onSave={v => updateField.mutate({ notes: v || null })}
      />

      {detail.events && detail.events.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">{t('detail.panels.timeline')}</h4>
          <div className="space-y-1.5">
            {detail.events.map(e => (
              <div key={e.id} className="border-l-2 border-border pl-2 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="capitalize">{t(`detail.eventType.${e.event_type}`, undefined, e.event_type.replace(/_/g, ' '))}</span>
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

      {canEdit ? (
        <div className="space-y-2 pt-2 border-t border-border">
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={t('detail.comments.placeholderShort')}
            rows={2}
            className="text-xs"
            data-testid="input-comment"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => addComment.mutate(draft.trim())}
              disabled={!draft.trim() || addComment.isPending}
              data-testid="button-submit-comment"
            >
              {addComment.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {t('detail.comments.submit')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{t('detail.footer.source', { source: detail.source })}{detail.external_source ? ` · ${detail.external_source}` : ''}</span>
        {detail.external_url ? (
          <a href={detail.external_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
            {t('detail.links.openHaven')} <ExternalLink className="w-3 h-3" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

function InlineText({
  label, value, canEdit, required, onSave,
}: {
  label: string
  value: string
  canEdit: boolean
  required?: boolean
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  if (!editing) {
    return (
      <FieldShell label={label} canEdit={canEdit} onEditClick={() => setEditing(true)}>
        <span className="text-foreground tabular-nums break-words">{value || <span className="text-muted-foreground/60">-</span>}</span>
      </FieldShell>
    )
  }

  function save() {
    if (required && !draft.trim()) return
    onSave(draft.trim())
    setEditing(false)
  }

  return (
    <FieldShell label={label}>
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="h-7 text-xs"
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          }}
        />
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save}><Save className="w-3 h-3" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setDraft(value); setEditing(false) }}><X className="w-3 h-3" /></Button>
      </div>
    </FieldShell>
  )
}

function InlineDate({
  label, value, canEdit, onSave,
}: {
  label: string
  value: string
  canEdit: boolean
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  if (!editing) {
    return (
      <FieldShell label={label} canEdit={canEdit} onEditClick={() => setEditing(true)}>
        <span className="text-foreground tabular-nums">{value || <span className="text-muted-foreground/60">-</span>}</span>
      </FieldShell>
    )
  }

  function save() {
    onSave(draft || '')
    setEditing(false)
  }

  return (
    <FieldShell label={label}>
      <div className="flex items-center gap-1">
        <Input type="date" value={draft} onChange={e => setDraft(e.target.value)} className="h-7 text-xs" autoFocus />
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save}><Save className="w-3 h-3" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setDraft(value); setEditing(false) }}><X className="w-3 h-3" /></Button>
      </div>
    </FieldShell>
  )
}

function InlineSelect({
  label, value, options, canEdit, onSave,
}: {
  label: string
  value: string
  options: Array<{ v: string; label: string }>
  canEdit: boolean
  onSave: (v: string) => void
}) {
  if (!canEdit) {
    return (
      <FieldShell label={label}>
        <span className="text-foreground tabular-nums">{value || <span className="text-muted-foreground/60">-</span>}</span>
      </FieldShell>
    )
  }
  return (
    <FieldShell label={label}>
      <Select value={value || '__none'} onValueChange={v => onSave(v === '__none' ? '' : v)}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">-</SelectItem>
          {options.filter(o => o.v).map(o => (
            <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  )
}

function InlineTextarea({
  label, value, canEdit, onSave,
}: {
  label: string
  value: string
  canEdit: boolean
  onSave: (v: string) => void
}) {
  const { t } = useLocale('lostItems')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  if (!editing) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
          {canEdit ? (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(true)}>
              <Pencil className="w-3 h-3" />
            </Button>
          ) : null}
        </div>
        {value ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap">{value}</div>
        ) : (
          <div className="text-xs text-muted-foreground/60">{t('detail.notesEmpty')}</div>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <Textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} className="text-xs" autoFocus />
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setDraft(value); setEditing(false) }}>{t('common.actions.cancel')}</Button>
        <Button size="sm" className="h-7 text-xs" onClick={() => { onSave(draft.trim()); setEditing(false) }}>{t('common.actions.save')}</Button>
      </div>
    </div>
  )
}

function FieldShell({
  label, children, canEdit, onEditClick,
}: {
  label: string
  children: React.ReactNode
  canEdit?: boolean
  onEditClick?: () => void
}) {
  return (
    <div className="flex flex-col gap-0.5 group">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        {canEdit && onEditClick ? (
          <button
            type="button"
            onClick={onEditClick}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          >
            <Pencil className="w-3 h-3" />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function AssignmentField({
  assignment, team, canEdit, onChange, pending,
}: {
  assignment?: LostItemAssignment
  team: AppUserRow[]
  canEdit: boolean
  onChange: (userId: number | null) => void
  pending: boolean
}) {
  const { t } = useLocale('lostItems')
  const current = assignment?.assigned_user_id != null ? String(assignment.assigned_user_id) : '__unassigned'
  if (!canEdit) {
    return (
      <FieldShell label={t('detail.fields.tendwellAssignee')}>
        <span className="text-foreground">{assignment?.assignee?.label ?? <span className="text-muted-foreground/60">{t('board.unassigned')}</span>}</span>
      </FieldShell>
    )
  }
  return (
    <FieldShell label={t('detail.fields.tendwellAssignee')}>
      <Select
        value={current}
        onValueChange={v => onChange(v === '__unassigned' ? null : Number(v))}
        disabled={pending}
      >
        <SelectTrigger className="h-7 text-xs" data-testid="select-detail-assignee">
          <SelectValue placeholder={t('detail.assignment.pickSomeone')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__unassigned">{t('detail.fields.unassignedOption')}</SelectItem>
          {team.map(u => (
            <SelectItem key={u.id} value={String(u.id)}>{u.label} <span className="text-muted-foreground">· {u.role}</span></SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  )
}
