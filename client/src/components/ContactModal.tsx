import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Phone, Mail, Calendar, StickyNote, MessageSquare, ExternalLink, Loader2, X } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'

const SOURCE_OPTIONS = ['Referral', 'Google', 'Cold Outreach', 'Trade Show', 'Social Media', 'Word of Mouth', 'Other']
const PAYMENT_OPTIONS = ['Ramp', 'BuildComm', 'QuickBooks', 'Check', 'ACH', 'Other']
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

export function ContactModal({ contactId, open, onClose, mode }: ContactModalProps) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  const [form, setForm] = useState<Record<string, any>>({})
  const [tagInput, setTagInput] = useState('')
  const [interactionType, setInteractionType] = useState('Note')
  const [interactionSummary, setInteractionSummary] = useState('')

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/contact-detail', contactId] })
      qc.invalidateQueries({ queryKey: ['/supabase/contacts'] })
      toast({ title: 'Saved' })
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
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
      qc.invalidateQueries({ queryKey: ['/supabase/contacts'] })
      toast({ title: 'Contact created' })
      onClose()
    },
    onError: (e: any) => toast({ title: 'Error: ' + (e.message || 'Failed to create contact'), variant: 'destructive' }),
  })

  // Log interaction
  const { mutate: logInteraction, isPending: logging } = useMutation({
    mutationFn: async () => {
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
    onError: () => toast({ title: 'Failed to log interaction', variant: 'destructive' }),
  })

  function handleFieldBlur(field: string) {
    if (isCreate || !contactId) return
    const newValue = field === 'tags' ? form.tags : (form[field]?.trim() || null)
    if (contact && newValue !== (contact[field] || null)) {
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

  function Field({ label, field, type = 'text', placeholder }: { label: string; field: string; type?: string; placeholder?: string }) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input
          type={type}
          value={form[field] ?? ''}
          onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
          onBlur={() => handleFieldBlur(field)}
          className="mt-0.5 h-7 text-xs"
          placeholder={placeholder}
        />
      </div>
    )
  }

  function SelectField({ label, field, options }: { label: string; field: string; options: string[] }) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Select value={form[field] || '_none'} onValueChange={v => handleSelectField(field, v)}>
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

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="contact-modal">
        <DialogHeader>
          <DialogTitle className="text-base">
            {isCreate ? 'New Contact' : isLoading ? <Skeleton className="h-5 w-48" /> : (contact?.full_name || 'Contact')}
          </DialogTitle>
          {!isCreate && contact?.updated_at && (
            <p className="text-xs text-muted-foreground">Updated {formatDistanceToNow(new Date(contact.updated_at), { addSuffix: true })}</p>
          )}
        </DialogHeader>

        {!isCreate && isLoading ? (
          <div className="space-y-3 py-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : (
          <Tabs defaultValue="details" className="mt-2">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
              <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
              {!isCreate && <TabsTrigger value="properties" className="text-xs">Properties</TabsTrigger>}
              {!isCreate && <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>}
            </TabsList>

            {/* Details Tab */}
            <TabsContent value="details" className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Full Name *" field="full_name" placeholder="Contact name" />
                <Field label="Company" field="company" placeholder="Company name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email" field="email" type="email" placeholder="email@example.com" />
                <Field label="Phone" field="phone" type="tel" placeholder="(555) 123-4567" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Secondary Phone" field="secondary_phone" type="tel" />
                <Field label="Mailing Address" field="mailing_address" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Source" field="source" options={SOURCE_OPTIONS} />
                <Field label="Source Notes" field="source_notes" placeholder="How they found us..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Payment Method" field="payment_method" options={PAYMENT_OPTIONS} />
                <Field label="Payment Notes" field="payment_notes" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Client Since" field="client_since" type="date" />
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
              <div>
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <textarea
                  value={form.notes ?? ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  onBlur={() => handleFieldBlur('notes')}
                  className="mt-0.5 w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Additional notes..."
                />
              </div>
            </TabsContent>

            {/* Properties Tab */}
            {!isCreate && (
              <TabsContent value="properties" className="mt-3">
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
                              <span className={p.profit_percentage >= 30 ? 'text-green-600' : p.profit_percentage >= 15 ? 'text-amber-600' : 'text-destructive'}>
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

        <DialogFooter className="flex items-center gap-2 pt-2">
          {isCreate ? (
            <>
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={() => createContact()} disabled={!form.full_name?.trim() || creating} data-testid="button-save-contact">
                {creating ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Saving…</> : 'Save Contact'}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
