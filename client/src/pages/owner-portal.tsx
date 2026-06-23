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
import { Loader2, LogOut, Home, CalendarClock, ClipboardList, ChevronDown } from 'lucide-react'

// Owner-editable property fields. The DB guard trigger enforces that only these
// columns can ever change on an owner UPDATE, so this list is the single source
// of truth for the portal's edit form.
type EditableProperty = {
  id: number
  name: string
  address: string | null
  bed_sizes_text: string | null
  number_of_beds: number | null
  square_footage: number | null
  door_code: string | null
  auto_code: string | null
  other_codes: string | null
  wifi_info: string | null
  owner_contact_name: string | null
  owner_contact_email: string | null
  owner_contact_phone: string | null
  preferred_payment_method: string | null
}

const SELECT_COLS =
  'id, name, address, bed_sizes_text, number_of_beds, square_footage, door_code, auto_code, other_codes, wifi_info, owner_contact_name, owner_contact_email, owner_contact_phone, preferred_payment_method'

type FormState = Omit<EditableProperty, 'id' | 'name'>

function toForm(p: EditableProperty): FormState {
  const { id, name, ...rest } = p
  return rest
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

// ─── Per-property editable card ────────────────────────────────────────────────
function PropertyCard({ property }: { property: EditableProperty }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => toForm(property))
  const [open, setOpen] = useState(false)

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(toForm(property)), [form, property])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const setNum = (key: 'number_of_beds' | 'square_footage', raw: string) => {
    const trimmed = raw.trim()
    set(key, trimmed === '' ? null : Number(trimmed))
  }

  const save = useMutation({
    mutationFn: async () => {
      // Light validation
      if (form.owner_contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.owner_contact_email)) {
        throw new Error('Enter a valid owner contact email.')
      }
      for (const k of ['number_of_beds', 'square_footage'] as const) {
        const v = form[k]
        if (v != null && (isNaN(v) || v < 0)) throw new Error('Bed count and square footage must be positive numbers.')
      }
      const { error } = await supabase.from('properties').update(form).eq('id', property.id)
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

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <div className="flex items-center gap-2 min-w-0">
          <Home className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate">{property.name}</h2>
            {property.address && <p className="text-xs text-muted-foreground truncate">{property.address}</p>}
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
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" /> Property details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Address" className="sm:col-span-2">
                <Input value={form.address ?? ''} onChange={e => set('address', e.target.value || null)} />
              </Field>
              <Field label="Bed sizes">
                <Input
                  value={form.bed_sizes_text ?? ''}
                  onChange={e => set('bed_sizes_text', e.target.value || null)}
                  placeholder="e.g. 1 King, 2 Queens"
                />
              </Field>
              <Field label="Bed count">
                <Input
                  type="number"
                  min={0}
                  value={form.number_of_beds ?? ''}
                  onChange={e => setNum('number_of_beds', e.target.value)}
                />
              </Field>
              <Field label="Square footage">
                <Input
                  type="number"
                  min={0}
                  value={form.square_footage ?? ''}
                  onChange={e => setNum('square_footage', e.target.value)}
                />
              </Field>
              <Field label="Door / access code">
                <Input value={form.door_code ?? ''} onChange={e => set('door_code', e.target.value || null)} />
              </Field>
              <Field label="Auto / lock code">
                <Input value={form.auto_code ?? ''} onChange={e => set('auto_code', e.target.value || null)} />
              </Field>
              <Field label="Other codes" className="sm:col-span-2">
                <Textarea
                  rows={2}
                  value={form.other_codes ?? ''}
                  onChange={e => set('other_codes', e.target.value || null)}
                  placeholder="Gate codes, alarm codes, etc."
                />
              </Field>
              <Field label="Wi-Fi information" className="sm:col-span-2">
                <Textarea
                  rows={2}
                  value={form.wifi_info ?? ''}
                  onChange={e => set('wifi_info', e.target.value || null)}
                  placeholder="Network name and password"
                />
              </Field>
            </div>
          </section>

          {/* Owner contact + payment */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Owner contact &amp; payment</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact name">
                <Input value={form.owner_contact_name ?? ''} onChange={e => set('owner_contact_name', e.target.value || null)} />
              </Field>
              <Field label="Contact phone">
                <Input value={form.owner_contact_phone ?? ''} onChange={e => set('owner_contact_phone', e.target.value || null)} />
              </Field>
              <Field label="Contact email">
                <Input
                  type="email"
                  value={form.owner_contact_email ?? ''}
                  onChange={e => set('owner_contact_email', e.target.value || null)}
                />
              </Field>
              <Field label="Preferred payment method">
                <Input
                  list="payment-methods"
                  value={form.preferred_payment_method ?? ''}
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
              </Field>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid={`button-save-${property.id}`}>
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}
              </Button>
            </div>
          </section>

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

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

// ─── Portal shell ───────────────────────────────────────────────────────────────
export default function OwnerPortalPage() {
  usePageTitle('Owner Portal')
  const { user, logout } = useAuth()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['owner-properties'],
    queryFn: async (): Promise<EditableProperty[]> => {
      // RLS scopes this to only the signed-in owner's assigned properties.
      const { data, error } = await supabase
        .from('properties')
        .select(SELECT_COLS)
        .order('name')
      if (error) throw error
      return (data ?? []) as EditableProperty[]
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
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={logout} data-testid="button-logout">
          <LogOut className="w-4 h-4" /> Sign out
        </Button>
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
      </main>
    </div>
  )
}
