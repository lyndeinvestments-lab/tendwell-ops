import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logActivity } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Phone, Mail, Calendar, StickyNote, MessageSquare, ExternalLink, Loader2, X, Send, Plus } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { ContactNotesFeed } from '@/components/ContactNotesFeed'
import { CONTACTS_QUERY_KEY } from '@/hooks/use-contacts'
import { profitColorClass } from '@/lib/profit-colors'

const SOURCE_OPTIONS = ['Referral', 'Google', 'Cold Outreach', 'Trade Show', 'Social Media', 'Word of Mouth', 'Other']
const PAYMENT_OPTIONS = ['Ramp', 'Bill.com', 'QuickBooks', 'Check', 'ACH', 'Other']
const INTERACTION_TYPES = ['Call', 'Email', 'Meeting', 'Note', 'Text']

const TYPE_ICONS: Record<string, typeof Phone> = {
  Call: Phone,
  Email: Mail,
  Meeting: Calendar,
  Note: StickyNote,
  Text: MessageSquare,
}

interface ContactModalProps {
  contactId: string | null
  open: boolean
  onClose: () => void
  mode: 'view' | 'create'
}

// Hoisted to file scope so React keeps the same component identity across
// renders. When these lived inside ContactModal each keystroke re-created a
// new function reference, React saw a different element type and remounted
// the input — the user's reported bug: focus dropped on every character on
// the Clients tab's Add Client form.
function Field({
  label, field, type = 'text', placeholder, form, setForm, onBlurField,
}: {
  label: string
  field: string
  type?: string
  placeholder?: string
  form: any
  setForm: React.Dispatch<React.SetStateAction<any>>
  onBlurField: (field: string) => void
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={form[field] ?? ''}
        onChange={e => setForm((f: any) => ({ ...f, [field]: e.target.value }))}
        onBlur={() => onBlurField(field)}
        className="mt-0.5 h-7 text-xs"
        placeholder={placeholder}
      />
    </div>
  )
}

function SelectField({
  label, field, options, form, onSelectField,
}: {
  label: string
  field: string
  options: string[]
  form: any
  onSelectField: (field: string, value: string) => void
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={form[field] || '_none'} onValueChange={v => onSelectField(field, v)}>
        <SelectTrigger className="mt-0.5 h-7 text-xs">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_none">—</SelectItem>
          {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

export function ContactModal({ contactId, open, onClose, mode }: ContactModalProps) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  const { user } = useAuth()
  const [form, setForm] = useState<Record<string, any>>({})
  const [tagInput, setTagInput] = useState('')
  const [interactionType, setInteractionType] = useState('Note')
  const [interactionSummary, setInteractionSummary] = useState('')
  const [assignPropId, setAssignPropId] = useState('')

  const isCreate = mode === 'create'

  const { data: contact, isLoading } = useQuery({
    queryKey: ['/supabase/contact-detail', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!contactId && !isCreate,
  })

  const { data: linkedProperties } = useQuery({
    queryKey: ['/supabase/contact-properties', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, ce_charged, profit_percentage, pipeline_stages!properties_stage_id_fkey(name, color)')
        .eq('contact_id', contactId!)
      if (error) throw error
      return data || []
    },
    enabled: !!contactId && !isCreate,
  })

  // Unassigned properties (no client yet) — the assignable pool for the
  // "assign a property to this client" picker on the Properties tab.
  const { data: assignableProps } = useQuery({
    queryKey: ['/supabase/assignable-properties'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, pipeline_stages!properties_stage_id_fkey(name)')
        .is('contact_id', null)
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!contactId && !isCreate && open,
  })

  const { mutate: assignProperty, isPending: assigning } = useMutation({
    mutationFn: async (propertyId: string) => {
      const { error } = await supabase.from('properties').update({ contact_id: contactId }).eq('id', Number(propertyId))
      if (error) throw error
      return propertyId
    },
    onSuccess: (propertyId) => {
      const prop = (assignableProps || []).find((p: any) => String(p.id) === String(propertyId))
      logActivity({
        entity_type: 'property',
        entity_id: propertyId,
        entity_name: prop?.name ?? null,
        action: 'update',
        field_name: 'contact_id',
        old_value: null,
        new_value: contact?.full_name ?? String(contactId),
        changed_by: user?.label ?? null,
      })
      qc.invalidateQueries({ queryKey: ['/supabase/contact-properties', contactId] })
      qc.invalidateQueries({ queryKey: ['/supabase/assignable-properties'] })
      qc.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-unassigned'] })
      setAssignPropId('')
      toast({ title: 'Property assigned' })
    },
    onError: (error: any) => toast({ title: 'Assign failed', description: error?.message, variant: 'destructive' }),
  })

  const { data: interactions } = useQuery({
    queryKey: ['/supabase/contact-interactions', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contact_interactions')
        .select('*')
        .eq('contact_id', contactId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!contactId && !isCreate,
  })

  // Initialize form when contact loads or create mode
  useEffect(() => {
    if (isCreate) {
      setForm({ full_name: '', company: '', email: '', phone: '', secondary_phone: '', mailing_address: '', source: '', source_notes: '', payment_method: '', payment_notes: '', client_since: '', tags: [], notes: '' })
    } else if (contact) {
      setForm({
        full_name: contact.full_name || '',
        company: contact.company || '',
        email: contact.email || '',
        phone: contact.phone || '',
        secondary_phone: contact.secondary_phone || '',
        mailing_address: contact.mailing_address || '',
        source: contact.source || '',
        source_notes: contact.source_notes || '',
        payment_method: contact.payment_method || '',
        payment_notes: contact.payment_notes || '',
        client_since: contact.client_since || '',
        tags: contact.tags || [],
        notes: contact.notes || '',
      })
    }
  }, [contact?.id, isCreate, open])

  // Per-field inline save (view mode)
  const { mutate: saveField } = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: any }) => {
      const { error } = await supabase.from('contacts').update({ [field]: value }).eq('id', contactId!)
      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      logActivity({
        entity_type: 'contact',
        entity_id: contactId ?? undefined,
        entity_name: contact?.full_name ?? null,
        action: 'update',
        field_name: variables.field,
        old_value: (contact as any)?.[variables.field] ?? null,
        new_value: variables.value != null ? String(variables.value) : null,
        changed_by: user?.label ?? null,
      })
      qc.invalidateQueries({ queryKey: ['/supabase/contact-detail', contactId] })
      qc.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY })
      toast({ title: 'Saved' })
    },
    onError: (error: any) => toast({ title: 'Save failed', description: error?.message, variant: 'destructive' }),
  })

  // Create contact
  const { mutate: createContact, isPending: creating } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('contacts').insert({
        full_name: form.full_name?.trim(),
        company: form.company?.trim() || null,
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        secondary_phone: form.secondary_phone?.trim() || null,
        mailing_address: form.mailing_address?.trim() || null,
        source: form.source || null,
        source_notes: form.source_notes?.trim() || null,
        payment_method: form.payment_method || null,
        payment_notes: form.payment_notes?.trim() || null,
        client_since: form.client_since || null,
        tags: form.tags?.length > 0 ? form.tags : null,
        notes: form.notes?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      logActivity({
        entity_type: 'contact',
        entity_name: form.full_name?.trim() ?? null,
        action: 'create',
        new_value: form.full_name?.trim() ?? null,
        changed_by: user?.label ?? null,
        metadata: { company: form.company?.trim() || null, source: form.source || null },
      })
      qc.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY })
      toast({ title: 'Client created' })
      onClose()
    },
    onError: (e: any) => toast({ title: 'Error: ' + (e.message || 'Failed to create client'), variant: 'destructive' }),
  })

  // Log interaction
  const { mutate: logInteraction, isPending: logging } = useMutation({
    mutationFn: async () => {
      if (!contactId) throw new Error('Cannot log interaction without a contact id')
      const { error } = await supabase.from('contact_interactions').insert({
        contact_id: contactId,
        interaction_type: interactionType,
        summary: interactionSummary.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/contact-interactions', contactId] })
      toast({ title: 'Interaction logged' })
      setInteractionSummary('')
    },
    onError: (error: any) => toast({ title: 'Failed to log interaction', description: error?.message, variant: 'destructive' }),
  })

  function handleFieldBlur(field: string) {
    if (isCreate || !contactId) return
    const newValue = field === 'tags' ? form.tags : ((form as any)[field]?.trim() || null)
    if (contact && newValue !== ((contact as any)[field] || null)) {
      saveField({ field, value: newValue })
    }
  }

  function handleSelectField(field: string, value: string) {
    const dbValue = value === '_none' ? null : value
    setForm(f => ({ ...f, [field]: dbValue || '' }))
    if (!isCreate && contactId) {
      saveField({ field, value: dbValue })
    }
  }

  function addTag() {
    const tag = tagInput.trim()
    if (!tag || form.tags?.includes(tag)) return
    const newTags = [...(form.tags || []), tag]
    setForm(f => ({ ...f, tags: newTags }))
    setTagInput('')
    if (!isCreate && contactId) {
      saveField({ field: 'tags', value: newTags })
    }
  }

  function removeTag(tag: string) {
    const newTags = (form.tags || []).filter((t: string) => t !== tag)
    setForm(f => ({ ...f, tags: newTags }))
    if (!isCreate && contactId) {
      saveField({ field: 'tags', value: newTags.length > 0 ? newTags : null })
    }
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-[480px] overflow-y-auto" data-testid="contact-modal">
        <SheetHeader>
          <SheetTitle className="text-base">
            {isCreate ? 'New Client' : isLoading ? <Skeleton className="h-5 w-48" /> : (contact?.full_name || 'Client')}
          </SheetTitle>
          {!isCreate && contact?.updated_at && (
            <p className="text-xs text-muted-foreground">Updated {formatDistanceToNow(new Date(contact.updated_at), { addSuffix: true })}</p>
          )}
        </SheetHeader>

        {!isCreate && isLoading ? (
          <div className="space-y-3 py-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : (
          <Tabs defaultValue="details" className="mt-4">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
              <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
              {!isCreate && <TabsTrigger value="properties" className="text-xs">Properties</TabsTrigger>}
              {!isCreate && <TabsTrigger value="notes" className="text-xs">Notes</TabsTrigger>}
              {!isCreate && <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>}
            </TabsList>

            {/* Details Tab */}
            <TabsContent value="details" className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Full Name *" field="full_name" placeholder="Client name" form={form} setForm={setForm} onBlurField={handleFieldBlur} />
                <Field label="Company" field="company" placeholder="Company name" form={form} setForm={setForm} onBlurField={handleFieldBlur} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Input
                      type="email"
                      value={form.email ?? ''}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      onBlur={() => handleFieldBlur('email')}
                      className="h-7 text-xs flex-1"
                      placeholder="email@example.com"
                    />
                    {form.email && (
                      <button
                        onClick={() => window.open(`mailto:${form.email}`, '_blank')}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Send email"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <Field label="Phone" field="phone" type="tel" placeholder="(555) 123-4567" form={form} setForm={setForm} onBlurField={handleFieldBlur} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Secondary Phone" field="secondary_phone" type="tel" form={form} setForm={setForm} onBlurField={handleFieldBlur} />
                <Field label="Mailing Address" field="mailing_address" form={form} setForm={setForm} onBlurField={handleFieldBlur} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Source" field="source" options={SOURCE_OPTIONS} form={form} onSelectField={handleSelectField} />
                <Field label="Source Notes" field="source_notes" placeholder="How they found us..." form={form} setForm={setForm} onBlurField={handleFieldBlur} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Payment Method" field="payment_method" options={PAYMENT_OPTIONS} form={form} onSelectField={handleSelectField} />
                <Field label="Payment Notes" field="payment_notes" form={form} setForm={setForm} onBlurField={handleFieldBlur} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Client Since" field="client_since" type="date" form={form} setForm={setForm} onBlurField={handleFieldBlur} />
                <div>
                  <Label className="text-xs text-muted-foreground">Tags</Label>
                  <div className="flex flex-wrap gap-1 mt-0.5 min-h-[28px] items-center">
                    {(form.tags || []).map((tag: string) => (
                      <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs">
                        {tag}
                        <button onClick={() => removeTag(tag)} className="hover:text-destructive"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                    <Input
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                      placeholder="Add tag..."
                      className="h-6 text-xs border-0 shadow-none focus-visible:ring-0 w-24 p-0"
                    />
                  </div>
                </div>
              </div>
              {!isCreate && contactId ? (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Notes</Label>
                  <ContactNotesFeed contactId={contactId} compact />
                </div>
              ) : isCreate ? (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <textarea
                    value={form.notes ?? ''}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="mt-0.5 w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Initial notes (taggable once saved)..."
                  />
                </div>
              ) : null}
              {isCreate ? (
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                  <Button size="sm" onClick={() => createContact()} disabled={!form.full_name?.trim() || creating} data-testid="button-save-contact">
                    {creating ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Saving…</> : 'Save Client'}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                    onClick={() => {
                      if (confirm('Deactivate this client? They will be hidden from the active list.')) {
                        saveField({ field: 'is_active', value: false })
                        onClose()
                      }
                    }}
                  >
                    Deactivate
                  </Button>
                  <Button variant="outline" size="sm" onClick={onClose} className="ml-auto">Close</Button>
                </div>
              )}
            </TabsContent>

            {/* Properties Tab */}
            {!isCreate && (
              <TabsContent value="properties" className="mt-3 space-y-3">
                {/* Assign an unassigned property to this client */}
                <div className="flex items-center gap-2">
                  <Select value={assignPropId} onValueChange={setAssignPropId}>
                    <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-assign-property">
                      <SelectValue placeholder="Assign an unassigned property…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(assignableProps || []).length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">No unassigned properties</div>
                      ) : (assignableProps || []).map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}{p.pipeline_stages?.name ? ` · ${p.pipeline_stages.name}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1"
                    disabled={!assignPropId || assigning}
                    onClick={() => assignProperty(assignPropId)}
                    data-testid="button-assign-property"
                  >
                    {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Assign
                  </Button>
                </div>

                {!linkedProperties || linkedProperties.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No properties linked to this contact</p>
                ) : (
                  <div className="space-y-1.5">
                    {linkedProperties.map((p: any) => {
                      const stageColor = p.pipeline_stages?.color || '#6b7280'
                      const stageName = p.pipeline_stages?.name || '—'
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-2 rounded-md border border-border hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => { onClose(); openPropertyModal(p.id) }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{p.name}</span>
                            <span
                              className="text-xs px-1.5 py-0.5 rounded font-medium"
                              style={{ backgroundColor: stageColor + '20', color: stageColor, border: `1px solid ${stageColor}40` }}
                            >
                              {stageName}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {p.ce_charged != null && <span>${Number(p.ce_charged).toFixed(2)}</span>}
                            {p.profit_percentage != null && (
                              <span className={profitColorClass(p.profit_percentage)}>
                                {p.profit_percentage.toFixed(1)}%
                              </span>
                            )}
                            <ExternalLink className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>
            )}

            {/* Notes Tab */}
            {!isCreate && contactId && (
              <TabsContent value="notes" className="mt-3">
                <ContactNotesFeed contactId={contactId} />
              </TabsContent>
            )}

            {/* Activity Tab */}
            {!isCreate && (
              <TabsContent value="activity" className="mt-3 space-y-3">
                {/* Log new interaction */}
                <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/20">
                  <Select value={interactionType} onValueChange={setInteractionType}>
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERACTION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    value={interactionSummary}
                    onChange={e => setInteractionSummary(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && interactionSummary.trim()) logInteraction() }}
                    placeholder="What happened?"
                    className="h-7 text-xs flex-1"
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!interactionSummary.trim() || logging}
                    onClick={() => logInteraction()}
                  >
                    {logging ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Log'}
                  </Button>
                </div>

                {/* Activity feed */}
                {!interactions || interactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No activity logged yet</p>
                ) : (
                  <div className="space-y-2">
                    {interactions.map((i: any) => {
                      const Icon = TYPE_ICONS[i.interaction_type] || StickyNote
                      return (
                        <div key={i.id} className="flex items-start gap-2.5 py-1.5">
                          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Icon className="w-3 h-3 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs">{i.summary}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {i.interaction_type} · {formatDistanceToNow(new Date(i.created_at), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  )
}
