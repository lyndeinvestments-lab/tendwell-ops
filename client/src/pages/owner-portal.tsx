import { useMemo, useState } from 'react'
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
import { Loader2, LogOut, Home, CalendarClock, ClipboardList, ChevronDown, Lock, ArrowLeft, Package, Gift } from 'lucide-react'
import { normalizeOwnerPermissions, type OwnerPermissions } from '@/lib/owners'

// A property as returned by the get_owner_properties() RPC. The RPC omits any
// field the owner can't see (visibility enforced in the DB), so every value
// field is optional. `permissions` carries the resolved visible/editable matrix
// so the portal can render read-only vs editable inputs.
type OwnerProperty = {
  id: number
  name: string
  permissions: OwnerPermissions
  address?: string | null
  bed_sizes_text?: string | null
  number_of_beds?: number | null
  square_footage?: number | null
  door_code?: string | null
  auto_code?: string | null
  other_codes?: string | null
  wifi_info?: string | null
  owner_contact_name?: string | null
  owner_contact_email?: string | null
  owner_contact_phone?: string | null
  preferred_payment_method?: string | null
}

// Columns the owner may submit, grouped by permission field key. Used to build
// the update payload from only the fields the owner can edit (the DB guard
// trigger enforces this too — this just keeps the request honest).
const EDITABLE_COLUMNS: Record<keyof OwnerPermissions, (keyof OwnerProperty)[]> = {
  address: ['address'],
  bed_sizes: ['bed_sizes_text'],
  bed_count: ['number_of_beds'],
  square_footage: ['square_footage'],
  door_code: ['door_code'],
  auto_code: ['auto_code'],
  other_codes: ['other_codes'],
  wifi_info: ['wifi_info'],
  owner_contact: ['owner_contact_name', 'owner_contact_email', 'owner_contact_phone'],
  payment_method: ['preferred_payment_method'],
}

type FormState = Partial<Record<keyof OwnerProperty, string | number | null>>

function initialForm(p: OwnerProperty): FormState {
  const form: FormState = {}
  for (const cols of Object.values(EDITABLE_COLUMNS)) {
    for (const c of cols) form[c] = (p[c] ?? null) as string | number | null
  }
  return form
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
type OwnerTask = { source: string; title: string; task_date: string | null; status: string | null }

function formatDate(iso: string | null): string {
  if (!iso) return '—'
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
    return <EmptyState icon={CalendarClock} title="No scheduled tasks" description="Tasks from inspections and Trello will appear here." />
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
            {t.source === 'trellis' ? 'Trello' : t.source}
          </Badge>
        </li>
      ))}
    </ul>
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

  const set = (key: keyof OwnerProperty, value: string | number | null) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const setNum = (key: 'number_of_beds' | 'square_footage', raw: string) => {
    const trimmed = raw.trim()
    set(key, trimmed === '' ? null : Number(trimmed))
  }

  const save = useMutation({
    mutationFn: async () => {
      // Light validation
      const email = form.owner_contact_email
      if (typeof email === 'string' && email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new Error('Enter a valid owner contact email.')
      }
      for (const k of ['number_of_beds', 'square_footage'] as const) {
        const v = form[k]
        if (typeof v === 'number' && (isNaN(v) || v < 0)) {
          throw new Error('Bed count and square footage must be positive numbers.')
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
    'address', 'bed_sizes', 'bed_count', 'square_footage', 'door_code', 'auto_code', 'other_codes', 'wifi_info',
  ]
  const contactKeys: (keyof OwnerPermissions)[] = ['owner_contact', 'payment_method']
  const showDetails = detailKeys.some(k => can(k).visible)
  const showContact = contactKeys.some(k => can(k).visible)

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
              {renderField('bed_sizes', 'Bed sizes', 'bed_sizes_text', () => (
                <Input
                  value={(form.bed_sizes_text as string) ?? ''}
                  onChange={e => set('bed_sizes_text', e.target.value || null)}
                  placeholder="e.g. 1 King, 2 Queens"
                />
              ))}
              {renderField('bed_count', 'Bed count', 'number_of_beds', () => (
                <Input
                  type="number"
                  min={0}
                  value={(form.number_of_beds as number) ?? ''}
                  onChange={e => setNum('number_of_beds', e.target.value)}
                />
              ))}
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
              {renderField('auto_code', 'Auto / lock code', 'auto_code', () => (
                <Input value={(form.auto_code as string) ?? ''} onChange={e => set('auto_code', e.target.value || null)} />
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
            </div>
          </section>
          )}

          {/* Owner contact + payment */}
          {showContact && (
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Owner contact &amp; payment</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {can('owner_contact').visible && (
                can('owner_contact').editable ? (
                  <>
                    <Field label="Contact name">
                      <Input value={(form.owner_contact_name as string) ?? ''} onChange={e => set('owner_contact_name', e.target.value || null)} />
                    </Field>
                    <Field label="Contact phone">
                      <Input value={(form.owner_contact_phone as string) ?? ''} onChange={e => set('owner_contact_phone', e.target.value || null)} />
                    </Field>
                    <Field label="Contact email">
                      <Input
                        type="email"
                        value={(form.owner_contact_email as string) ?? ''}
                        onChange={e => set('owner_contact_email', e.target.value || null)}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Contact name" locked><ReadOnlyValue value={property.owner_contact_name} /></Field>
                    <Field label="Contact phone" locked><ReadOnlyValue value={property.owner_contact_phone} /></Field>
                    <Field label="Contact email" locked><ReadOnlyValue value={property.owner_contact_email} /></Field>
                  </>
                )
              )}
              {renderField('payment_method', 'Preferred payment method', 'preferred_payment_method', () => (
                <>
                  <Input
                    list="payment-methods"
                    value={(form.preferred_payment_method as string) ?? ''}
                    onChange={e => set('preferred_payment_method', e.target.value || null)}
                    placeholder="e.g. ACH, Zelle, Check"
                  />
                  <datalist id="payment-methods">
                    <option value="ACH / Bank transfer" />
                    <option value="Zelle" />
                    <option value="Venmo" />
                    <option value="Check" />
                    <option value="Credit card" />
                  </datalist>
                </>
              ))}
            </div>
          </section>
          )}

          {(showDetails || showContact) && anyEditable && (
            <div className="flex justify-end">
              <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid={`button-save-${property.id}`}>
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}
              </Button>
            </div>
          )}

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

// ─── Portal shell ───────────────────────────────────────────────────────────────
export default function OwnerPortalPage() {
  usePageTitle('Owner Portal')
  const { user, logout, canActAsOwner, setActingAsOwner } = useAuth()
  // For a pure owner, user.id is the property_owners id; for a staff user acting
  // as owner it's on ownerIdentity. Used as owner_id on owner-scoped inserts.
  const ownerId = user?.ownerIdentity?.id ?? user?.id ?? ''

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
      <header className="flex items-center justify-between h-14 px-4 sm:px-6 border-b border-border/60 bg-background/95 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Home className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">Owner Portal</p>
            <p className="text-2xs text-muted-foreground leading-tight">{user?.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {canActAsOwner && (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setActingAsOwner(false)} data-testid="button-switch-staff-view">
              <ArrowLeft className="w-4 h-4" /> Staff view
            </Button>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={logout} data-testid="button-logout">
            <LogOut className="w-4 h-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-7 space-y-5">
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
      </main>
    </div>
  )
}
