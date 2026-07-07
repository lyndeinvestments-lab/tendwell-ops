import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, LogOut, Home, CalendarClock, ClipboardList, ChevronDown, Lock, ArrowLeft, Package, Gift, Quote, MessageSquare, FileText, ExternalLink, Copy, Check, Download, PenLine } from 'lucide-react'
import { normalizeOwnerPermissions, changeOwnerEmail, type OwnerPermissions } from '@/lib/owners'
import { signAgreement, downloadAgreementPdf } from '@/lib/agreements'
import { SignaturePad } from '@/components/SignaturePad'

// A property as returned by the get_owner_properties() RPC. The RPC omits any
// field the owner can't see (visibility enforced in the DB), so every value
// field is optional. `permissions` carries the resolved visible/editable matrix
// so the portal can render read-only vs editable inputs.
type OwnerProperty = {
  id: number
  name: string
  stage?: string | null
  permissions: OwnerPermissions
  address?: string | null
  king_beds?: number | null
  queen_beds?: number | null
  full_beds?: number | null
  twin_beds?: number | null
  square_footage?: number | null
  door_code?: string | null
  other_codes?: string | null
  wifi_info?: string | null
  bedrooms?: number | null
  full_baths?: number | null
  half_baths?: number | null
  hot_tub?: boolean | null
  pool?: boolean | null
  check_in_time?: string | null
  check_out_time?: string | null
  filter_size?: string | null
  ical_url?: string | null
}

// Columns the owner may submit, grouped by permission field key. Used to build
// the update payload from only the fields the owner can edit (the DB guard
// trigger enforces this too — this just keeps the request honest).
const EDITABLE_COLUMNS: Record<keyof OwnerPermissions, (keyof OwnerProperty)[]> = {
  address: ['address'],
  bed_sizes: ['king_beds', 'queen_beds', 'full_beds', 'twin_beds'],
  square_footage: ['square_footage'],
  door_code: ['door_code'],
  other_codes: ['other_codes'],
  wifi_info: ['wifi_info'],
  bedrooms: ['bedrooms'],
  baths: ['full_baths', 'half_baths'],
  amenities: ['hot_tub', 'pool'],
  check_times: ['check_in_time', 'check_out_time'],
  filter_size: ['filter_size'],
  ical_url: ['ical_url'],
}

type FormState = Partial<Record<keyof OwnerProperty, string | number | boolean | null>>

function initialForm(p: OwnerProperty): FormState {
  const form: FormState = {}
  for (const cols of Object.values(EDITABLE_COLUMNS)) {
    for (const c of cols) form[c] = (p[c] ?? null) as string | number | boolean | null
  }
  return form
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
type OwnerTask = { source: string; title: string; task_date: string | null; status: string | null }

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  // Date-only strings (YYYY-MM-DD) must be constructed in local time to avoid
  // UTC-midnight anchoring rolling them back a day in Eastern/other western TZs.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    if (isNaN(dt.getTime())) return '—'
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function TasksSection({ propertyId }: { propertyId: number }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-tasks', propertyId],
    queryFn: async (): Promise<OwnerTask[]> => {
      const { data, error } = await supabase.rpc('get_owner_property_tasks', { p_property_id: propertyId })
      if (error) throw error
      return (data ?? []) as OwnerTask[]
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-9 rounded-md" />)}
      </div>
    )
  }
  if (isError) return <ErrorState onRetry={() => refetch()} title="Couldn't load tasks" description="Something went wrong loading scheduled tasks." />
  if (!data || data.length === 0) {
    return <EmptyState icon={CalendarClock} title="No scheduled tasks" description="Tasks from inspections and Trellis will appear here." />
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {data.map((t, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm text-foreground truncate">{t.title}</p>
            <p className="text-2xs text-muted-foreground">{formatDate(t.task_date)}</p>
          </div>
          <Badge variant="outline" className="shrink-0 capitalize">
            {t.source === 'trellis' ? 'Trellis' : t.source}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

// ─── Owner notes section ──────────────────────────────────────────────────────
type OwnerNote = { id: string; content: string; created_at: string }

function OwnerNotesSection({ propertyId }: { propertyId: number }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [text, setText] = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-property-notes', propertyId],
    queryFn: async (): Promise<OwnerNote[]> => {
      const { data, error } = await supabase.rpc('get_owner_property_notes', { p_property_id: propertyId })
      if (error) throw error
      return (data ?? []) as OwnerNote[]
    },
  })

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('owner_add_property_note', {
        p_property_id: propertyId,
        p_content: text.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Note added' })
      setText('')
      queryClient.invalidateQueries({ queryKey: ['owner-property-notes', propertyId] })
    },
    onError: (e: unknown) =>
      toast({ title: 'Could not add note', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' }),
  })

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Notes</h3>
      <div className="space-y-2">
        <Textarea
          rows={2}
          placeholder="Add a note..."
          value={text}
          onChange={e => setText(e.target.value)}
          data-testid={`textarea-owner-note-${propertyId}`}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => add.mutate()}
            disabled={!text.trim() || add.isPending}
            data-testid={`button-add-note-${propertyId}`}
          >
            {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add note'}
          </Button>
        </div>
      </div>
      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-9 rounded-md" />)}
        </div>
      )}
      {isError && <ErrorState onRetry={() => refetch()} title="Couldn't load notes" description="Something went wrong loading notes." />}
      {!isLoading && !isError && (data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      )}
      {!isLoading && !isError && (data ?? []).length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {(data ?? []).map(n => (
            <li key={n.id} className="px-3 py-2 space-y-0.5">
              <p className="text-sm text-foreground whitespace-pre-wrap">{n.content}</p>
              <p className="text-2xs text-muted-foreground">{formatDate(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── Read-only field display ───────────────────────────────────────────────────
function ReadOnlyValue({ value }: { value: string | number | null | undefined }) {
  const text = value == null || value === '' ? '—' : String(value)
  return (
    <div className="flex items-center gap-1.5 min-h-9 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      <Lock className="w-3 h-3 shrink-0 opacity-60" />
      <span className="truncate whitespace-pre-wrap">{text}</span>
    </div>
  )
}

// ─── Per-property editable card ────────────────────────────────────────────────
function PropertyCard({ property }: { property: OwnerProperty }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => initialForm(property))
  const [open, setOpen] = useState(false)

  const perms = property.permissions
  const can = (key: keyof OwnerPermissions) => perms[key] ?? { visible: true, editable: true }

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialForm(property)),
    [form, property],
  )
  // True when the owner can edit at least one field on this property.
  const anyEditable = useMemo(
    () => Object.keys(EDITABLE_COLUMNS).some(k => can(k as keyof OwnerPermissions).editable),
    [perms],
  )

  const set = (key: keyof OwnerProperty, value: string | number | boolean | null) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const setNum = (key: 'king_beds' | 'queen_beds' | 'full_beds' | 'twin_beds' | 'square_footage' | 'bedrooms' | 'full_baths' | 'half_baths', raw: string) => {
    const trimmed = raw.trim()
    set(key, trimmed === '' ? null : Number(trimmed))
  }

  const save = useMutation({
    mutationFn: async () => {
      // Light validation
      for (const k of ['king_beds', 'queen_beds', 'full_beds', 'twin_beds', 'square_footage', 'bedrooms', 'full_baths', 'half_baths'] as const) {
        const v = form[k]
        if (typeof v === 'number' && (isNaN(v) || v < 0)) {
          throw new Error('Counts and square footage must be positive numbers.')
        }
      }
      // Build a payload of only the columns this owner may edit. The DB guard
      // trigger enforces the same restriction server-side regardless.
      const payload: FormState = {}
      for (const [key, cols] of Object.entries(EDITABLE_COLUMNS)) {
        if (!can(key as keyof OwnerPermissions).editable) continue
        for (const c of cols) payload[c] = form[c] ?? null
      }
      if (Object.keys(payload).length === 0) return
      const { error } = await supabase.from('properties').update(payload as any).eq('id', property.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Saved', description: `${property.name} updated.` })
      queryClient.invalidateQueries({ queryKey: ['owner-properties'] })
    },
    onError: (e: unknown) => {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    },
  })

  // Renders an editable input, a read-only value, or nothing, per permission.
  const renderField = (
    key: keyof OwnerPermissions,
    label: string,
    column: keyof OwnerProperty,
    input: (editable: boolean) => React.ReactNode,
    className?: string,
  ) => {
    const p = can(key)
    if (!p.visible) return null
    return (
      <Field label={label} locked={!p.editable} className={className}>
        {p.editable ? input(true) : <ReadOnlyValue value={property[column] as any} />}
      </Field>
    )
  }

  const detailKeys: (keyof OwnerPermissions)[] = [
    'address', 'bed_sizes', 'square_footage', 'door_code', 'other_codes', 'wifi_info',
    'bedrooms', 'baths', 'amenities', 'check_times', 'filter_size', 'ical_url',
  ]
  const showDetails = detailKeys.some(k => can(k).visible)

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <div className="flex items-center gap-2 min-w-0">
          <Home className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate">{property.name}</h2>
            {can('address').visible && property.address && (
              <p className="text-xs text-muted-foreground truncate">{property.address}</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Manage'}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-6 pb-6">
          {/* Property details */}
          {showDetails && (
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" /> Property details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {renderField('address', 'Address', 'address', () => (
                <Input value={(form.address as string) ?? ''} onChange={e => set('address', e.target.value || null)} />
              ), 'sm:col-span-2')}
              {(() => {
                const p = can('bed_sizes')
                if (!p.visible) return null
                return (
                  <>
                    <Field label="King beds" locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.king_beds as number) ?? ''} onChange={e => setNum('king_beds', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.king_beds} />
                      )}
                    </Field>
                    <Field label="Queen beds" locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.queen_beds as number) ?? ''} onChange={e => setNum('queen_beds', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.queen_beds} />
                      )}
                    </Field>
                    <Field label="Full beds" locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.full_beds as number) ?? ''} onChange={e => setNum('full_beds', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.full_beds} />
                      )}
                    </Field>
                    <Field label="Twin beds" locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.twin_beds as number) ?? ''} onChange={e => setNum('twin_beds', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.twin_beds} />
                      )}
                    </Field>
                  </>
                )
              })()}
              {renderField('bedrooms', 'Bedrooms', 'bedrooms', () => (
                <Input type="number" min={0} value={(form.bedrooms as number) ?? ''} onChange={e => setNum('bedrooms', e.target.value)} />
              ))}
              {(() => {
                const p = can('baths')
                if (!p.visible) return null
                return (
                  <>
                    <Field label="Full baths" locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.full_baths as number) ?? ''} onChange={e => setNum('full_baths', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.full_baths} />
                      )}
                    </Field>
                    <Field label="Half baths" locked={!p.editable}>
                      {p.editable ? (
                        <Input type="number" min={0} value={(form.half_baths as number) ?? ''} onChange={e => setNum('half_baths', e.target.value)} />
                      ) : (
                        <ReadOnlyValue value={property.half_baths} />
                      )}
                    </Field>
                  </>
                )
              })()}
              {renderField('square_footage', 'Square footage', 'square_footage', () => (
                <Input
                  type="number"
                  min={0}
                  value={(form.square_footage as number) ?? ''}
                  onChange={e => setNum('square_footage', e.target.value)}
                />
              ))}
              {renderField('door_code', 'Door / access code', 'door_code', () => (
                <Input value={(form.door_code as string) ?? ''} onChange={e => set('door_code', e.target.value || null)} />
              ))}
              {renderField('other_codes', 'Other codes', 'other_codes', () => (
                <Textarea
                  rows={2}
                  value={(form.other_codes as string) ?? ''}
                  onChange={e => set('other_codes', e.target.value || null)}
                  placeholder="Gate codes, alarm codes, etc."
                />
              ), 'sm:col-span-2')}
              {renderField('wifi_info', 'Wi-Fi information', 'wifi_info', () => (
                <Textarea
                  rows={2}
                  value={(form.wifi_info as string) ?? ''}
                  onChange={e => set('wifi_info', e.target.value || null)}
                  placeholder="Network name and password"
                />
              ), 'sm:col-span-2')}
              {(() => {
                const p = can('amenities')
                if (!p.visible) return null
                const boolSelect = (key: 'hot_tub' | 'pool') => (
                  <select
                    className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background"
                    value={form[key] == null ? '' : String(form[key])}
                    onChange={e => set(key, e.target.value === '' ? null : e.target.value === 'true')}
                    data-testid={`select-${key.replace('_', '-')}-${property.id}`}
                  >
                    <option value="">Not set</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                )
                const boolLabel = (v: boolean | null | undefined) => (v == null ? null : v ? 'Yes' : 'No')
                return (
                  <>
                    <Field label="Hot tub" locked={!p.editable}>
                      {p.editable ? boolSelect('hot_tub') : <ReadOnlyValue value={boolLabel(property.hot_tub)} />}
                    </Field>
                    <Field label="Pool" locked={!p.editable}>
                      {p.editable ? boolSelect('pool') : <ReadOnlyValue value={boolLabel(property.pool)} />}
                    </Field>
                  </>
                )
              })()}
              {(() => {
                const p = can('check_times')
                if (!p.visible) return null
                return (
                  <>
                    <Field label="Check-in time" locked={!p.editable}>
                      {p.editable ? (
                        <Input value={(form.check_in_time as string) ?? ''} onChange={e => set('check_in_time', e.target.value || null)} placeholder="4:00 PM" />
                      ) : (
                        <ReadOnlyValue value={property.check_in_time} />
                      )}
                    </Field>
                    <Field label="Check-out time" locked={!p.editable}>
                      {p.editable ? (
                        <Input value={(form.check_out_time as string) ?? ''} onChange={e => set('check_out_time', e.target.value || null)} placeholder="10:00 AM" />
                      ) : (
                        <ReadOnlyValue value={property.check_out_time} />
                      )}
                    </Field>
                  </>
                )
              })()}
              {renderField('filter_size', 'A/C filter size', 'filter_size', () => (
                <Input value={(form.filter_size as string) ?? ''} onChange={e => set('filter_size', e.target.value || null)} placeholder="20x25x1" />
              ))}
              {renderField('ical_url', 'Booking calendar (iCal URL)', 'ical_url', () => (
                <Input
                  type="url"
                  value={(form.ical_url as string) ?? ''}
                  onChange={e => set('ical_url', e.target.value || null)}
                  placeholder="https://..."
                />
              ), 'sm:col-span-2')}
            </div>
          </section>
          )}

          {showDetails && anyEditable && (
            <div className="flex justify-end">
              <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid={`button-save-${property.id}`}>
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}
              </Button>
            </div>
          )}

          {/* Owner notes */}
          <OwnerNotesSection propertyId={property.id} />

          {/* Scheduled tasks */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5 text-muted-foreground" /> Scheduled tasks
            </h3>
            <TasksSection propertyId={property.id} />
          </section>
        </CardContent>
      )}
    </Card>
  )
}

function Field({ label, children, className, locked }: { label: string; children: React.ReactNode; className?: string; locked?: boolean }) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        {label}
        {locked && <span className="text-2xs text-muted-foreground/70">(view only)</span>}
      </Label>
      {children}
    </div>
  )
}

// ─── Shipments ──────────────────────────────────────────────────────────────────
type OwnerShipment = {
  id: string
  property_name: string | null
  sender_name: string | null
  tracking_number: string | null
  estimated_delivery: string | null
  description: string | null
  delivery_responsible: string | null
  received_at: string | null
  submitted_at: string | null
}

function ShipmentsSection() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-shipments'],
    queryFn: async (): Promise<OwnerShipment[]> => {
      // Owner-scoped RPC: returns shipments only for the signed-in owner's properties.
      const { data, error } = await supabase.rpc('get_owner_shipments')
      if (error) throw error
      return (data ?? []) as OwnerShipment[]
    },
  })

  if (isLoading) return <Skeleton className="h-24 rounded-2xl" />
  if (isError) {
    return <ErrorState onRetry={() => refetch()} title="Couldn't load shipments" description="Something went wrong loading your shipments. Please try again." />
  }
  const shipments = data ?? []
  // Hide the section entirely when there's nothing to show (keeps the portal tidy).
  if (shipments.length === 0) return null

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Package className="w-4 h-4 text-muted-foreground" /> Incoming shipments
        </h2>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        {shipments.map(s => {
          const received = !!s.received_at
          return (
            <div key={s.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{s.description || s.sender_name || 'Shipment'}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[s.property_name, s.sender_name ? `from ${s.sender_name}` : null, s.tracking_number].filter(Boolean).join(' · ')}
                </p>
                <p className="text-2xs text-muted-foreground">
                  {received
                    ? `Received ${formatDate(s.received_at)}`
                    : s.estimated_delivery
                      ? `Est. delivery ${formatDate(s.estimated_delivery)}`
                      : 'In transit'}
                </p>
              </div>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${received ? 'bg-success/10 text-success' : 'bg-info/10 text-info'}`}>
                {received ? 'Received' : 'In transit'}
              </span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ─── Referrals ──────────────────────────────────────────────────────────────────
type OwnerReferral = {
  id: string
  referred_name: string
  referred_email: string | null
  referred_phone: string | null
  note: string | null
  status: string
  reward_status: string
  reward_note: string | null
  created_at: string
}

const REFERRAL_STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted', contacted: 'Contacted', converted: 'Converted', declined: 'Declined',
}
const REFERRAL_STATUS_TONE: Record<string, string> = {
  submitted: 'bg-info/10 text-info',
  contacted: 'bg-warning/10 text-warning',
  converted: 'bg-success/10 text-success',
  declined: 'bg-muted text-muted-foreground',
}

function ReferralsSection({ ownerId }: { ownerId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ referred_name: '', referred_email: '', referred_phone: '', note: '' })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-referrals'],
    queryFn: async (): Promise<OwnerReferral[]> => {
      // RLS scopes rows to the signed-in owner.
      const { data, error } = await supabase
        .from('owner_referrals')
        .select('id, referred_name, referred_email, referred_phone, note, status, reward_status, reward_note, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OwnerReferral[]
    },
  })

  const submit = useMutation({
    mutationFn: async () => {
      // owner_id must equal current_owner_id() per RLS; we send the owner's id
      // and the policy enforces it (a wrong id is rejected, not trusted).
      const { error } = await supabase.from('owner_referrals').insert({
        owner_id: ownerId,
        referred_name: form.referred_name.trim(),
        referred_email: form.referred_email.trim() || null,
        referred_phone: form.referred_phone.trim() || null,
        note: form.note.trim() || null,
      } as any)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Referral submitted', description: 'Thanks! Our team will follow up.' })
      setForm({ referred_name: '', referred_email: '', referred_phone: '', note: '' })
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['owner-referrals'] })
    },
    onError: (e: any) => toast({ title: 'Could not submit referral', description: e?.message ?? 'Please try again.', variant: 'destructive' }),
  })

  const referrals = data ?? []

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Gift className="w-4 h-4 text-muted-foreground" /> Refer a friend
        </h2>
        <Button size="sm" variant={open ? 'ghost' : 'default'} onClick={() => setOpen(o => !o)} data-testid="button-toggle-referral-form">
          {open ? 'Cancel' : 'Refer someone'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pb-5">
        <p className="text-sm text-muted-foreground">Know someone who could use Tendwell? Send them our way and our team takes it from there.</p>

        {open && (
          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <Field label="Their name">
              <Input value={form.referred_name} onChange={e => setForm(f => ({ ...f, referred_name: e.target.value }))} data-testid="input-referral-name" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email">
                <Input type="email" value={form.referred_email} onChange={e => setForm(f => ({ ...f, referred_email: e.target.value }))} data-testid="input-referral-email" />
              </Field>
              <Field label="Phone">
                <Input value={form.referred_phone} onChange={e => setForm(f => ({ ...f, referred_phone: e.target.value }))} data-testid="input-referral-phone" />
              </Field>
            </div>
            <Field label="Anything we should know?">
              <Textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2} data-testid="input-referral-note" />
            </Field>
            <div className="flex justify-end">
              <Button size="sm" disabled={!form.referred_name.trim() || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-referral">
                {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit referral'}
              </Button>
            </div>
          </div>
        )}

        {isLoading && <Skeleton className="h-16 rounded-lg" />}
        {isError && <ErrorState onRetry={() => refetch()} title="Couldn't load referrals" description="Please try again." />}
        {!isLoading && !isError && referrals.length === 0 && !open && (
          <p className="text-sm text-muted-foreground">You haven't referred anyone yet.</p>
        )}
        {referrals.map(r => (
          <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{r.referred_name}</p>
              <p className="text-xs text-muted-foreground truncate">{[r.referred_email, r.referred_phone].filter(Boolean).join(' · ') || '—'}</p>
              <p className="text-2xs text-muted-foreground">
                Referred {formatDate(r.created_at)}{r.reward_status !== 'pending' ? ` · Reward: ${r.reward_status}` : ''}
              </p>
            </div>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${REFERRAL_STATUS_TONE[r.status] ?? 'bg-muted text-muted-foreground'}`}>
              {REFERRAL_STATUS_LABEL[r.status] ?? r.status}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Testimonials ─────────────────────────────────────────────────────────────
type OwnerTestimonial = {
  id: string
  rating: number | null
  body: string
  display_preference: string
  allow_photo: boolean
  status: string
  created_at: string
}

const TESTIMONIAL_STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted', approved: 'Approved', published: 'Published', declined: 'Declined',
}
const TESTIMONIAL_STATUS_TONE: Record<string, string> = {
  submitted: 'bg-info/10 text-info',
  approved: 'bg-warning/10 text-warning',
  published: 'bg-success/10 text-success',
  declined: 'bg-muted text-muted-foreground',
}

function TestimonialsSection({ ownerId }: { ownerId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ rating: '5', body: '', display_preference: 'full_name', allow_photo: false })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-testimonials'],
    queryFn: async (): Promise<OwnerTestimonial[]> => {
      const { data, error } = await supabase
        .from('owner_testimonials')
        .select('id, rating, body, display_preference, allow_photo, status, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OwnerTestimonial[]
    },
  })

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('owner_testimonials').insert({
        owner_id: ownerId,
        rating: form.rating ? Number(form.rating) : null,
        body: form.body.trim(),
        display_preference: form.display_preference,
        allow_photo: form.allow_photo,
      } as any)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Thank you!', description: 'Your testimonial was submitted for review.' })
      setForm({ rating: '5', body: '', display_preference: 'full_name', allow_photo: false })
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['owner-testimonials'] })
    },
    onError: (e: any) => toast({ title: 'Could not submit', description: e?.message ?? 'Please try again.', variant: 'destructive' }),
  })

  const items = data ?? []

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Quote className="w-4 h-4 text-muted-foreground" /> Share your experience
        </h2>
        <Button size="sm" variant={open ? 'ghost' : 'default'} onClick={() => setOpen(o => !o)} data-testid="button-toggle-testimonial-form">
          {open ? 'Cancel' : 'Write a testimonial'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pb-5">
        <p className="text-sm text-muted-foreground">Loved working with Tendwell? Share a few words. You control how your name is shown, and we review before anything is published.</p>

        {open && (
          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Rating">
                <select
                  className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background"
                  value={form.rating}
                  onChange={e => setForm(f => ({ ...f, rating: e.target.value }))}
                  data-testid="select-testimonial-rating"
                >
                  {[5, 4, 3, 2, 1].map(n => <option key={n} value={String(n)}>{'★'.repeat(n)} ({n})</option>)}
                </select>
              </Field>
              <Field label="Show my name as">
                <select
                  className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background"
                  value={form.display_preference}
                  onChange={e => setForm(f => ({ ...f, display_preference: e.target.value }))}
                  data-testid="select-testimonial-display"
                >
                  <option value="full_name">Full name</option>
                  <option value="first_name">First name only</option>
                  <option value="anonymous">Anonymous</option>
                </select>
              </Field>
            </div>
            <Field label="Your testimonial">
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={4} data-testid="input-testimonial-body" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={form.allow_photo} onChange={e => setForm(f => ({ ...f, allow_photo: e.target.checked }))} data-testid="checkbox-testimonial-photo" />
              You may use a property photo alongside my testimonial
            </label>
            <div className="flex justify-end">
              <Button size="sm" disabled={!form.body.trim() || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-testimonial">
                {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit testimonial'}
              </Button>
            </div>
          </div>
        )}

        {isLoading && <Skeleton className="h-16 rounded-lg" />}
        {isError && <ErrorState onRetry={() => refetch()} title="Couldn't load testimonials" description="Please try again." />}
        {!isLoading && !isError && items.length === 0 && !open && (
          <p className="text-sm text-muted-foreground">You haven't submitted a testimonial yet.</p>
        )}
        {items.map(t => (
          <div key={t.id} className="rounded-lg border border-border/60 p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-amber-500">{t.rating ? '★'.repeat(t.rating) : ''}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${TESTIMONIAL_STATUS_TONE[t.status] ?? 'bg-muted text-muted-foreground'}`}>
                {TESTIMONIAL_STATUS_LABEL[t.status] ?? t.status}
              </span>
            </div>
            <p className="text-sm text-foreground/90">{t.body}</p>
            <p className="text-2xs text-muted-foreground">Submitted {formatDate(t.created_at)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
type OwnerFeedback = {
  id: string
  category: string
  body: string
  status: string
  created_at: string
}

const FEEDBACK_STATUS_LABEL: Record<string, string> = {
  open: 'Open', reviewing: 'Reviewing', planned: 'Planned', done: 'Done', declined: 'Declined',
}
const FEEDBACK_STATUS_TONE: Record<string, string> = {
  open: 'bg-info/10 text-info',
  reviewing: 'bg-warning/10 text-warning',
  planned: 'bg-info/10 text-info',
  done: 'bg-success/10 text-success',
  declined: 'bg-muted text-muted-foreground',
}

function FeedbackSection({ ownerId }: { ownerId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ category: 'suggestion', body: '' })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-feedback'],
    queryFn: async (): Promise<OwnerFeedback[]> => {
      const { data, error } = await supabase
        .from('owner_feedback')
        .select('id, category, body, status, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OwnerFeedback[]
    },
  })

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('owner_feedback').insert({
        owner_id: ownerId,
        category: form.category,
        body: form.body.trim(),
      } as any)
      if (error) throw error
    },
    onSuccess: () => {
      toast({ title: 'Feedback sent', description: 'Thanks! We read every note.' })
      setForm({ category: 'suggestion', body: '' })
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['owner-feedback'] })
    },
    onError: (e: any) => toast({ title: 'Could not send', description: e?.message ?? 'Please try again.', variant: 'destructive' }),
  })

  const items = data ?? []

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" /> Feedback &amp; suggestions
        </h2>
        <Button size="sm" variant={open ? 'ghost' : 'default'} onClick={() => setOpen(o => !o)} data-testid="button-toggle-feedback-form">
          {open ? 'Cancel' : 'Send feedback'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pb-5">
        <p className="text-sm text-muted-foreground">Have an idea, a request, or something that could be better? Tell us.</p>

        {open && (
          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <Field label="Type">
              <select
                className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                data-testid="select-feedback-category"
              >
                <option value="suggestion">Suggestion</option>
                <option value="issue">Issue</option>
                <option value="praise">Praise</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Your message">
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={3} data-testid="input-feedback-body" />
            </Field>
            <div className="flex justify-end">
              <Button size="sm" disabled={!form.body.trim() || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-feedback">
                {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send'}
              </Button>
            </div>
          </div>
        )}

        {isLoading && <Skeleton className="h-16 rounded-lg" />}
        {isError && <ErrorState onRetry={() => refetch()} title="Couldn't load feedback" description="Please try again." />}
        {!isLoading && !isError && items.length === 0 && !open && (
          <p className="text-sm text-muted-foreground">No feedback submitted yet.</p>
        )}
        {items.map(f => (
          <div key={f.id} className="rounded-lg border border-border/60 p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs uppercase tracking-wide text-muted-foreground">{f.category}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${FEEDBACK_STATUS_TONE[f.status] ?? 'bg-muted text-muted-foreground'}`}>
                {FEEDBACK_STATUS_LABEL[f.status] ?? f.status}
              </span>
            </div>
            <p className="text-sm text-foreground/90">{f.body}</p>
            <p className="text-2xs text-muted-foreground">Sent {formatDate(f.created_at)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
function OnboardingSection({ properties }: { properties: OwnerProperty[] }) {
  const onboarding = properties.filter(p => p.stage === 'Onboarding')
  if (onboarding.length === 0) return null
  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-muted-foreground" /> Onboarding in progress
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 pb-5">
        <p className="text-sm text-muted-foreground">
          We're getting {onboarding.length === 1 ? 'your property' : 'your properties'} ready. Please make sure the details below (access codes, Wi-Fi, bed sizes) are complete — it helps us start clean.
        </p>
        <ul className="space-y-1">
          {onboarding.map(p => (
            <li key={p.id} className="text-sm font-medium text-foreground flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" /> {p.name}
            </li>
          ))}
        </ul>
        <a href="/#/onboarding" className="inline-block text-sm font-medium text-primary hover:underline">
          Onboarding a new property? Start here →
        </a>
      </CardContent>
    </Card>
  )
}

// ─── Quotes ───────────────────────────────────────────────────────────────────
type OwnerQuote = {
  id: number
  name: string
  ce_charged: number | null
  deep_clean_3x_ce: number | null
  estimated_deep_clean_cost: number | null
  linen_program: boolean | null
  linen_program_cost: number | null
  bedrooms: number | null
  number_of_beds: number | null
  full_baths: number | null
  half_baths: number | null
  quote_sent_at: string | null
  quote_owner_response: string | null
  quote_responded_at: string | null
}

function formatMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function QuotesSection() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-quotes'],
    queryFn: async (): Promise<OwnerQuote[]> => {
      const { data, error } = await supabase.rpc('get_owner_quotes')
      if (error) throw error
      return (data ?? []) as OwnerQuote[]
    },
  })

  const respond = useMutation({
    mutationFn: async ({ id, response }: { id: number; response: 'approved' | 'declined' }) => {
      const { error } = await supabase.rpc('owner_respond_to_quote', { p_property_id: id, p_response: response })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      toast({
        title: v.response === 'approved' ? 'Quote approved' : 'Quote declined',
        description: v.response === 'approved' ? 'Thanks! Our team will begin onboarding.' : 'Thanks for letting us know.',
      })
      queryClient.invalidateQueries({ queryKey: ['owner-quotes'] })
    },
    onError: (e: any) => toast({ title: 'Could not submit', description: e?.message ?? 'Please try again.', variant: 'destructive' }),
  })

  if (isLoading) return <Skeleton className="h-28 rounded-2xl" />
  if (isError) return <ErrorState onRetry={() => refetch()} title="Couldn't load your quote" description="Please try again." />
  const quotes = data ?? []
  if (quotes.length === 0) return null

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden border-primary/30">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" /> Your quote{quotes.length > 1 ? 's' : ''}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 pb-5">
        {quotes.map(q => {
          const pending = !q.quote_owner_response || q.quote_owner_response === 'pending'
          const approved = q.quote_owner_response === 'approved'
          return (
            <div key={q.id} className="rounded-lg border border-border/60 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{q.name}</p>
                {!pending && (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium shrink-0 ${approved ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                    {approved ? 'Approved' : 'Declined'}
                  </span>
                )}
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Cleaning fee (per turn)</span>
                  <span className="font-medium text-foreground">{formatMoney(q.ce_charged)}</span>
                </div>
                {q.deep_clean_3x_ce ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Onboarding deep clean</span>
                    <span className="font-medium text-foreground">{formatMoney(q.deep_clean_3x_ce)}</span>
                  </div>
                ) : null}
                {q.linen_program && q.linen_program_cost ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Linen program (monthly)</span>
                    <span className="font-medium text-foreground">{formatMoney(q.linen_program_cost)}</span>
                  </div>
                ) : null}
              </div>
              {pending ? (
                <div className="flex gap-2 justify-end pt-1">
                  <Button size="sm" variant="outline" disabled={respond.isPending} onClick={() => respond.mutate({ id: q.id, response: 'declined' })} data-testid={`button-decline-quote-${q.id}`}>
                    Decline
                  </Button>
                  <Button size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ id: q.id, response: 'approved' })} data-testid={`button-approve-quote-${q.id}`}>
                    {respond.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve'}
                  </Button>
                </div>
              ) : (
                <p className="text-2xs text-muted-foreground">Responded {formatDate(q.quote_responded_at)}</p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ─── Agreement section ─────────────────────────────────────────────────────────
type OwnerAgreement = {
  id: string
  status: 'sent' | 'signed' | 'void'
  owner_name: string | null
  entity: string | null
  mailing_address: string | null
  property_addresses: string | null
  email: string | null
  phone: string | null
  owner_signed_at: string | null
}

function AgreementSection() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: rpcData, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-agreement'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_owner_agreement')
      if (error) throw error
      return data as OwnerAgreement[] | null
    },
  })

  // get_owner_agreement returns a SETOF (jsonb array); at most 1 element.
  // An empty array means the owner has no agreement assigned.
  const a = (rpcData as any)?.[0] as OwnerAgreement | undefined

  // Form state for party fields + signing fields
  const [ownerName, setOwnerName] = useState('')
  const [entity, setEntity] = useState('')
  const [mailingAddress, setMailingAddress] = useState('')
  const [propertyAddresses, setPropertyAddresses] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [ownerPrintedName, setOwnerPrintedName] = useState('')
  const [ownerTitle, setOwnerTitle] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [isPending, setIsPending] = useState(false)

  // Pre-fill form when agreement data arrives
  useEffect(() => {
    if (a) {
      setOwnerName(a.owner_name ?? '')
      setEntity(a.entity ?? '')
      setMailingAddress(a.mailing_address ?? '')
      setPropertyAddresses(a.property_addresses ?? '')
      setEmail(a.email ?? '')
      setPhone(a.phone ?? '')
    }
  }, [a?.id])

  if (isLoading) return <Skeleton className="h-28 rounded-2xl" />
  if (isError) return <ErrorState onRetry={() => refetch()} title="Couldn't load agreement" description="Please try again." />

  // No agreement assigned for this owner.
  if (!a) return null
  // void agreements are hidden.
  if (a.status === 'void') return null

  if (a.status === 'signed') {
    return (
      <Card className="rounded-2xl shadow-sm overflow-hidden">
        <CardHeader className="py-4">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" /> Service Agreement
          </h2>
        </CardHeader>
        <CardContent className="space-y-4 pb-5">
          <p className="text-sm text-muted-foreground">
            Signed on {formatDate(a.owner_signed_at)}. You can download a copy of the fully signed agreement below.
          </p>
          <Button
            variant="outline"
            className="gap-2"
            onClick={async () => {
              const result = await downloadAgreementPdf(a.id)
              if (!result.ok) {
                toast({ title: 'Could not download', description: result.error ?? 'Please try again.', variant: 'destructive' })
              }
            }}
            data-testid="button-download-agreement"
          >
            <Download className="w-4 h-4" />
            Download signed PDF
          </Button>
        </CardContent>
      </Card>
    )
  }

  // status === 'sent'
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

  async function handleSign() {
    if (!sig || !consent || !ownerPrintedName.trim() || isPending) return
    setIsPending(true)
    const result = await signAgreement({
      agreementId: a!.id,
      signatureDataUrl: sig,
      ownerName: ownerName.trim(),
      entity: entity.trim(),
      mailingAddress: mailingAddress.trim(),
      propertyAddresses: propertyAddresses.trim(),
      email: email.trim(),
      phone: phone.trim(),
      ownerPrintedName: ownerPrintedName.trim(),
      ownerTitle: ownerTitle.trim(),
      consent: true,
    })
    setIsPending(false)
    if (result.ok) {
      toast({ title: 'Agreement signed. Thank you!' })
      queryClient.invalidateQueries({ queryKey: ['owner-agreement'] })
    } else {
      toast({ title: 'Could not sign agreement', description: result.error ?? 'Please try again.', variant: 'destructive' })
    }
  }

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden border-primary/40">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <PenLine className="w-4 h-4 text-primary" />
          Action needed: review and sign your Service Agreement
        </h2>
      </CardHeader>
      <CardContent className="space-y-6 pb-6">
        {/* Open agreement */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Please review the Cleaning Services Agreement, then complete and sign below. Your signature is legally binding.
          </p>
          <a
            href="/agreements/service-agreement-v1.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            data-testid="link-open-agreement"
          >
            <ExternalLink className="w-4 h-4" />
            Open agreement
          </a>
        </div>

        {/* Party fields */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Your information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Owner name">
              <Input
                className="text-base sm:text-sm"
                value={ownerName}
                onChange={e => setOwnerName(e.target.value)}
                data-testid="input-agreement-owner-name"
              />
            </Field>
            <Field label="Entity (optional)">
              <Input
                className="text-base sm:text-sm"
                value={entity}
                onChange={e => setEntity(e.target.value)}
                placeholder="LLC, Trust, etc."
                data-testid="input-agreement-entity"
              />
            </Field>
            <Field label="Mailing address" className="sm:col-span-2">
              <Input
                className="text-base sm:text-sm"
                value={mailingAddress}
                onChange={e => setMailingAddress(e.target.value)}
                data-testid="input-agreement-mailing-address"
              />
            </Field>
            <Field label="Property address(es)" className="sm:col-span-2">
              <Textarea
                className="text-base sm:text-sm"
                rows={2}
                value={propertyAddresses}
                onChange={e => setPropertyAddresses(e.target.value)}
                placeholder="One address per line"
                data-testid="textarea-agreement-property-addresses"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                className="text-base sm:text-sm"
                value={email}
                onChange={e => setEmail(e.target.value)}
                data-testid="input-agreement-email"
              />
            </Field>
            <Field label="Phone">
              <Input
                className="text-base sm:text-sm"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                data-testid="input-agreement-phone"
              />
            </Field>
          </div>
        </section>

        {/* Signature block */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Your signature</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Printed name">
              <Input
                className="text-base sm:text-sm"
                value={ownerPrintedName}
                onChange={e => setOwnerPrintedName(e.target.value)}
                placeholder="Your full legal name"
                data-testid="input-agreement-printed-name"
              />
            </Field>
            <Field label="Title or capacity">
              <Input
                className="text-base sm:text-sm"
                value={ownerTitle}
                onChange={e => setOwnerTitle(e.target.value)}
                placeholder="Owner, Manager, Trustee, etc."
                data-testid="input-agreement-title"
              />
            </Field>
          </div>
          <div className="text-sm text-muted-foreground">
            Date: <span className="font-medium text-foreground">{today}</span>
          </div>
          <Field label="Signature">
            <SignaturePad onChange={setSig} data-testid="signature-pad" />
          </Field>
        </section>

        {/* Consent */}
        <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border accent-primary"
            checked={consent}
            onChange={e => setConsent(e.target.checked)}
            data-testid="checkbox-agreement-consent"
          />
          <span className="text-sm text-foreground leading-snug">
            I agree to sign electronically and I have read and agree to the Cleaning Services Agreement.
          </span>
        </label>

        {/* Sign button */}
        <Button
          className="w-full"
          size="lg"
          disabled={!sig || !consent || !ownerPrintedName.trim() || isPending}
          onClick={handleSign}
          data-testid="button-sign-agreement"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Sign agreement
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Trellis portal card ───────────────────────────────────────────────────────
function TrellisPortalCard() {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['owner-trellis-url'],
    queryFn: async () => {
      const { data: oid } = await supabase.rpc('current_owner_id')
      const { data, error } = await supabase
        .from('property_owners')
        .select('trellis_portal_url')
        .eq('id', (oid as any) ?? '')
        .maybeSingle()
      if (error) throw error
      return data?.trellis_portal_url ?? null
    },
  })

  const url = typeof data === 'string' ? data.trim() : null

  if (isLoading || !url) return null

  const isOpenable = url.startsWith('http')

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url!)
      setCopied(true)
      toast({ title: 'Link copied' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Could not copy link', description: 'Please copy it manually.', variant: 'destructive' })
    }
  }

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground">Your Trellis portal</h2>
      </CardHeader>
      <CardContent className="space-y-4 pb-5">
        <p className="text-sm text-muted-foreground">
          Access your Trellis owner portal to view reservations, work orders, and more.
        </p>
        <div className="flex flex-wrap gap-2">
          {isOpenable && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              data-testid="link-open-trellis"
            >
              <ExternalLink className="w-4 h-4" />
              Open Trellis portal
            </a>
          )}
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            data-testid="button-copy-trellis-link"
          >
            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Owner-wide contact & payment card ────────────────────────────────────────
function ContactPaymentCard() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-self'],
    queryFn: async () => {
      // current_owner_id() resolves the signed-in owner in the DB; RLS also
      // restricts property_owners rows to the owner themselves.
      const { data: oid } = await supabase.rpc('current_owner_id')
      const { data, error } = await supabase
        .from('property_owners')
        .select('name, phone, email, preferred_payment_method')
        .eq('id', (oid as any) ?? '')
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const [form, setForm] = useState({ name: '', phone: '', email: '', preferred_payment_method: '' })
  const [initialForm, setInitialForm] = useState({ name: '', phone: '', email: '', preferred_payment_method: '' })
  useEffect(() => {
    if (data) {
      const loaded = {
        name: data.name ?? '', phone: data.phone ?? '',
        email: data.email ?? '', preferred_payment_method: data.preferred_payment_method ?? '',
      }
      setForm(loaded)
      setInitialForm(loaded)
    }
  }, [data])

  const initialEmail = initialForm.email
  const dirty =
    form.name !== initialForm.name ||
    form.phone !== initialForm.phone ||
    form.email !== initialForm.email ||
    form.preferred_payment_method !== initialForm.preferred_payment_method

  const save = useMutation({
    mutationFn: async () => {
      const email = form.email.trim().toLowerCase()
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.')
      const emailChanged = email !== initialEmail.toLowerCase()
      if (emailChanged) {
        const r = await changeOwnerEmail(email)
        if (!r.ok) throw new Error(r.error || 'Could not change email.')
      }
      const { error } = await supabase.rpc('owner_update_self_contact', {
        p_name: form.name.trim() || null,
        p_phone: form.phone.trim() || null,
        p_payment_method: form.preferred_payment_method.trim() || null,
      } as any)
      if (error) throw error
      if (emailChanged) await supabase.auth.refreshSession()
    },
    onSuccess: () => {
      toast({ title: 'Saved', description: 'Your contact information was updated.' })
      queryClient.invalidateQueries({ queryKey: ['owner-self'] })
    },
    onError: (e: unknown) =>
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' }),
  })

  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />
  if (isError) return <ErrorState onRetry={() => refetch()} title="Couldn't load your info" description="Please try again." />

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground">Your contact &amp; payment</h2>
      </CardHeader>
      <CardContent className="space-y-4 pb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Contact name">
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-owner-name" />
          </Field>
          <Field label="Contact phone">
            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-owner-phone" />
          </Field>
          <Field label="Login email">
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-owner-email" />
          </Field>
          <Field label="Preferred payment method">
            <select
              className="w-full border border-border rounded-md px-2 py-2 text-sm bg-background"
              value={form.preferred_payment_method}
              onChange={e => setForm(f => ({ ...f, preferred_payment_method: e.target.value }))}
              data-testid="select-owner-payment"
            >
              <option value="">Select a method</option>
              <option value="QuickBooks">QuickBooks</option>
              <option value="Bill.com">Bill.com</option>
            </select>
          </Field>
        </div>
        <p className="text-2xs text-muted-foreground">
          Changing your login email updates the address you sign in with. It does not change your properties or access.
        </p>
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="button-save-owner-contact">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Account security ─────────────────────────────────────────────────────────
function AccountSecurityCard() {
  const { toast } = useToast()
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' })
      return
    }
    if (password !== confirm) {
      toast({ title: 'Passwords do not match', description: 'Please re-enter them.', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    const { error } = await updatePassword(password)
    setSubmitting(false)
    if (error) {
      toast({ title: 'Could not update password', description: error, variant: 'destructive' })
      return
    }
    setPassword(''); setConfirm('')
    toast({ title: 'Password updated', description: 'Your new password is now active.' })
  }

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground">Account security</h2>
      </CardHeader>
      <CardContent className="pb-6">
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="New password">
              <Input type="password" autoComplete="new-password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters"
                data-testid="input-owner-new-password" />
            </Field>
            <Field label="Confirm password">
              <Input type="password" autoComplete="new-password" value={confirm}
                onChange={e => setConfirm(e.target.value)} placeholder="Re-enter password"
                data-testid="input-owner-confirm-password" />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting} data-testid="button-owner-update-password">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ─── Portal shell ───────────────────────────────────────────────────────────────
export default function OwnerPortalPage() {
  usePageTitle('Owner Portal')
  const { user, logout, canActAsOwner, setActingAsOwner } = useAuth()
  // For a pure owner, user.id is the property_owners id; for a staff user acting
  // as owner it's on ownerIdentity. Used as owner_id on owner-scoped inserts.
  const ownerId = user?.ownerIdentity?.id ?? user?.id ?? ''
  const firstName = user?.label?.trim().split(/\s+/)[0] ?? ''

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-properties'],
    queryFn: async (): Promise<OwnerProperty[]> => {
      // The RPC scopes to the signed-in owner's assigned properties and omits
      // any field they don't have visibility permission for.
      const { data, error } = await supabase.rpc('get_owner_properties')
      if (error) throw error
      return ((data ?? []) as any[]).map(row => ({
        ...row,
        permissions: normalizeOwnerPermissions(row?.permissions),
      })) as OwnerProperty[]
    },
  })

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-background to-background sticky top-0 z-10 backdrop-blur">
        <div className="w-full max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-7 py-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <img
              src="/brand/tendwell-logo-black.png"
              alt="Tendwell"
              className="h-7 sm:h-8 w-auto max-w-[180px] object-contain object-left block dark:hidden"
            />
            <img
              src="/brand/tendwell-logo-white.png"
              alt="Tendwell"
              className="h-7 sm:h-8 w-auto max-w-[180px] object-contain object-left hidden dark:block"
            />
            <span className="text-2xs text-muted-foreground uppercase tracking-[0.2em]">Owner portal</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {firstName && (
              <span className="hidden sm:inline text-sm text-muted-foreground mr-1 truncate max-w-[160px]">
                Welcome back, {firstName}
              </span>
            )}
            {canActAsOwner && (
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setActingAsOwner(false)} data-testid="button-switch-staff-view">
                <ArrowLeft className="w-4 h-4" /> Staff view
              </Button>
            )}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={logout} data-testid="button-logout">
              <LogOut className="w-4 h-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-7 space-y-5">
        {ownerId && <QuotesSection />}
        {!isLoading && !isError && data && <OnboardingSection properties={data} />}
        {ownerId && <ContactPaymentCard />}
        {ownerId && <TrellisPortalCard />}
        {ownerId && <AgreementSection />}
        <div>
          <h1 className="text-lg font-semibold text-foreground">Your properties</h1>
          <p className="text-sm text-muted-foreground">
            Review and update your property information and view upcoming scheduled tasks.
          </p>
        </div>

        {isLoading && (
          <div className="space-y-4">
            {[1, 2].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        )}

        {isError && <ErrorState onRetry={() => refetch()} title="Couldn't load your properties" description="Something went wrong loading your properties. Please try again." />}

        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <EmptyState
            icon={Home}
            title="No properties assigned"
            description="No properties are linked to your account yet. Please contact Tendwell."
          />
        )}

        {!isLoading && !isError && (data?.length ?? 0) > 0 && (
          <div className="space-y-4">
            {data!.map(p => <PropertyCard key={p.id} property={p} />)}
          </div>
        )}

        <ShipmentsSection />
        {ownerId && <ReferralsSection ownerId={ownerId} />}
        {ownerId && <TestimonialsSection ownerId={ownerId} />}
        {ownerId && <FeedbackSection ownerId={ownerId} />}
        <AccountSecurityCard />
      </main>
    </div>
  )
}
