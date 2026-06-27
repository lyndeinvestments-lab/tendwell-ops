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
import { Loader2, LogOut, Home, CalendarClock, ClipboardList, ChevronDown, Lock, ArrowLeft, Package, Gift, Quote, MessageSquare, FileText } from 'lucide-react'
import { normalizeOwnerPermissions, type OwnerPermissions } from '@/lib/owners'

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
        {ownerId && <QuotesSection />}
        {!isLoading && !isError && data && <OnboardingSection properties={data} />}
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
      </main>
    </div>
  )
}
