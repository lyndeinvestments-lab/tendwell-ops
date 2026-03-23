import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, STAGE_COLORS } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { useLocation } from 'wouter'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Eye, EyeOff, Pencil, X, Loader2, Copy, Check, Users, ExternalLink } from 'lucide-react'

// ── Access code reveal cell ──────────────────────────────────────────────────
function RevealCell({ value, field, id }: { value: string | null; field: string; id: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (!value) return
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleReveal() {
    setRevealed(true)
    try {
      await supabase.from('access_audit_log').insert({
        property_id: id,
        field_name: field,
        action: 'reveal',
        timestamp: new Date().toISOString(),
      })
    } catch { /* silent */ }
  }

  if (!value) return <span className="text-muted-foreground text-xs">—</span>

  if (!revealed) {
    return (
      <button
        onClick={handleReveal}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors group"
        data-testid={`modal-reveal-${field}`}
      >
        <span className="tracking-widest">••••••</span>
        <Eye className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-mono">{value}</span>
      <button onClick={() => setRevealed(false)} className="text-muted-foreground hover:text-foreground">
        <EyeOff className="w-3 h-3" />
      </button>
      <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground" title={copied ? 'Copied!' : 'Copy'}>
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function PropertyDetailModal() {
  const { modalState, closePropertyModal } = usePropertyModal()
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [inlineField, setInlineField] = useState<string | null>(null)
  const [inlineValue, setInlineValue] = useState('')

  const propertyId = modalState?.propertyId
  const highlightFields = modalState?.highlightFields ?? []
  const sourceContext = modalState?.sourceContext

  const { data: property, isLoading } = useQuery({
    queryKey: ['/supabase/property-detail', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('*, pipeline_stages!properties_stage_id_fkey(id, name, color)')
        .eq('id', propertyId!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!propertyId,
  })

  // Contacts for linking
  const [contactSearch, setContactSearch] = useState('')
  const [contactPopoverOpen, setContactPopoverOpen] = useState(false)
  const { data: allContacts } = useQuery({
    queryKey: ['/supabase/contacts-lite'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contacts').select('id, full_name, company, payment_method')
      if (error) throw error
      return data || []
    },
    enabled: !!propertyId,
    staleTime: 30_000,
  })

  const linkedContact = useMemo(() => {
    if (!property?.contact_id || !allContacts) return null
    return allContacts.find((c: any) => c.id === property.contact_id) || null
  }, [property?.contact_id, allContacts])

  const filteredContacts = useMemo(() => {
    if (!allContacts) return []
    const q = contactSearch.toLowerCase()
    if (!q) return allContacts.slice(0, 20)
    return allContacts.filter((c: any) => c.full_name?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q)).slice(0, 20)
  }, [allContacts, contactSearch])

  const { mutate: linkContact } = useMutation({
    mutationFn: async (contactId: string | null) => {
      const { error } = await supabase.from('properties').update({ contact_id: contactId }).eq('id', propertyId!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', propertyId] })
      qc.invalidateQueries({ queryKey: ['/supabase/contacts'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      toast({ title: 'Contact updated' })
      setContactPopoverOpen(false)
    },
    onError: () => toast({ title: 'Failed to update contact', variant: 'destructive' }),
  })

  // Reset form when property changes
  useEffect(() => {
    if (property) {
      setForm({
        address: property.address || '',
        bedrooms: property.bedrooms ?? '',
        full_baths: property.full_baths ?? '',
        square_footage: property.square_footage ?? '',
        guest_count: property.guest_count ?? '',
        ce_charged: property.ce_charged ?? '',
        cleaner_pay: property.cleaner_pay ?? '',
        notes: property.notes || '',
      })
      setIsEditing(false)
    }
  }, [property?.id])

  const { mutate: saveEdits, isPending: saving } = useMutation({
    mutationFn: async () => {
      const updates: Record<string, any> = {
        address: form.address || null,
        bedrooms: form.bedrooms !== '' ? parseFloat(String(form.bedrooms)) : null,
        full_baths: form.full_baths !== '' ? parseFloat(String(form.full_baths)) : null,
        square_footage: form.square_footage !== '' ? parseFloat(String(form.square_footage)) : null,
        guest_count: form.guest_count !== '' ? parseFloat(String(form.guest_count)) : null,
        ce_charged: form.ce_charged !== '' ? parseFloat(String(form.ce_charged)) : null,
        cleaner_pay: form.cleaner_pay !== '' ? parseFloat(String(form.cleaner_pay)) : null,
        notes: form.notes || null,
      }
      const { error } = await supabase.from('properties').update(updates).eq('id', propertyId!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', propertyId] })
      qc.invalidateQueries({ queryKey: ['/supabase/properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      toast({ title: 'Saved' })
      setIsEditing(false)
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  // Per-field inline save (click a field to edit it without pencil icon)
  const { mutate: saveInlineField } = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: any }) => {
      const numFields = ['bedrooms', 'full_baths', 'square_footage', 'ce_charged', 'cleaner_pay']
      const dbValue = numFields.includes(field) ? (value !== '' ? parseFloat(String(value)) : null) : (value || null)
      const { error } = await supabase.from('properties').update({ [field]: dbValue }).eq('id', propertyId!)
      if (error) throw error
      // Write to property_edit_log
      try {
        await supabase.from('property_edit_log').insert({
          property_id: propertyId,
          field_name: field,
          old_value: String(property?.[field] ?? ''),
          new_value: String(dbValue ?? ''),
        })
      } catch { /* silent */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/property-detail', propertyId] })
      qc.invalidateQueries({ queryKey: ['/supabase/properties'] })
      qc.invalidateQueries({ queryKey: ['/supabase/pipeline'] })
      qc.invalidateQueries({ queryKey: ['/supabase/master-list'] })
      toast({ title: 'Saved' })
      setInlineField(null)
    },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  })

  function startInlineEdit(field: string, currentValue: any) {
    if (!canEdit || isEditing) return
    setInlineField(field)
    setInlineValue(String(currentValue ?? ''))
  }

  function commitInlineEdit(field: string) {
    saveInlineField({ field, value: inlineValue })
  }

  const isAdmin = user?.role === 'admin'
  const isOperations = user?.role === 'operations'
  const canEdit = isAdmin || isOperations
  const canViewFinancials = user?.role !== 'cleaning'
  const canViewAccess = user?.role !== 'cleaning'

  const stageColor = property?.pipeline_stages?.color || '#6b7280'
  const stageName = property?.pipeline_stages?.name || '—'

  // Highlight field ring class
  function fieldCls(field: string) {
    const base = 'h-7 text-xs'
    if (highlightFields.includes(field) && isEditing) return `${base} ring-2 ring-destructive`
    return base
  }

  // Navigate to source context (e.g. pipeline column scroll)
  function handleViewInContext() {
    if (sourceContext === 'pipeline') {
      closePropertyModal()
      navigate('/pipeline')
      // Scroll to column after navigation
      setTimeout(() => {
        const col = document.querySelector(`[data-testid="column-${stageName}"]`)
        col?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }, 300)
    }
  }

  const LINEN_COLS = [
    { key: 'king_beds', label: 'King Beds' },
    { key: 'queen_beds', label: 'Queen Beds' },
    { key: 'full_beds', label: 'Full Beds' },
    { key: 'twin_beds', label: 'Twin Beds' },
    { key: 'bath_towels', label: 'Bath Towels' },
    { key: 'washcloths', label: 'Washcloths' },
    { key: 'hand_towels', label: 'Hand Towels' },
    { key: 'bathmats', label: 'Bathmats' },
    { key: 'pool_towels', label: 'Pool Towels' },
  ]

  return (
    <Dialog open={!!propertyId} onOpenChange={v => !v && closePropertyModal()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="property-detail-modal">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {isLoading ? (
                <Skeleton className="h-5 w-48" />
              ) : (
                <DialogTitle className="text-base truncate">{property?.name ?? '—'}</DialogTitle>
              )}
              {!isLoading && property && (
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{
                    backgroundColor: stageColor + '20',
                    color: stageColor,
                    border: `1px solid ${stageColor}40`,
                  }}
                >
                  {stageName}
                </span>
              )}
            </div>
            {canEdit && !isLoading && (
              isEditing ? (
                <button
                  onClick={() => { setIsEditing(false); setForm({ address: property?.address || '', bedrooms: property?.bedrooms ?? '', full_baths: property?.full_baths ?? '', square_footage: property?.square_footage ?? '', guest_count: property?.guest_count ?? '', ce_charged: property?.ce_charged ?? '', cleaner_pay: property?.cleaner_pay ?? '', notes: property?.notes || '' }) }}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  title="Cancel editing"
                  data-testid="modal-cancel-edit"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  title="Edit property"
                  data-testid="modal-edit-btn"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )
            )}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : !property ? (
          <p className="text-sm text-muted-foreground py-4">Property not found.</p>
        ) : (
          <Tabs defaultValue="overview" className="mt-2">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              {canViewFinancials && <TabsTrigger value="financials" className="text-xs">Financials</TabsTrigger>}
              <TabsTrigger value="linens" className="text-xs">Linens</TabsTrigger>
              {canViewAccess && <TabsTrigger value="access" className="text-xs">Access</TabsTrigger>}
              {canViewAccess && <TabsTrigger value="ac-filter" className="text-xs">AC Filter</TabsTrigger>}
              <TabsTrigger value="notes" className="text-xs">Notes</TabsTrigger>
            </TabsList>

            {/* ── Overview Tab ── */}
            <TabsContent value="overview" className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Client', field: 'client', value: property.client || '—', editable: false },
                  { label: 'Stage', field: '_stage', value: stageName, editable: false },
                ].map(row => (
                  <div key={row.field}>
                    <span className="text-xs text-muted-foreground block mb-0.5">{row.label}</span>
                    <span className="text-sm">{row.value}</span>
                  </div>
                ))}
              </div>
              {/* Point of Contact */}
              <div>
                <Label className="text-xs text-muted-foreground">Point of Contact</Label>
                <div className="mt-0.5 flex items-center gap-2">
                  {linkedContact ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium">{linkedContact.full_name}</span>
                      {linkedContact.company && <span className="text-xs text-muted-foreground">({linkedContact.company})</span>}
                      {linkedContact.payment_method && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">{linkedContact.payment_method}</span>
                      )}
                      {canEdit && (
                        <button onClick={() => linkContact(null)} className="text-muted-foreground hover:text-destructive ml-1" title="Unlink contact">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ) : canEdit ? (
                    <Popover open={contactPopoverOpen} onOpenChange={setContactPopoverOpen}>
                      <PopoverTrigger asChild>
                        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-dashed border-border hover:border-primary/40">
                          Assign contact…
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2" align="start">
                        <Input
                          value={contactSearch}
                          onChange={e => setContactSearch(e.target.value)}
                          placeholder="Search contacts…"
                          className="h-7 text-xs mb-2"
                          autoFocus
                        />
                        <div className="max-h-40 overflow-y-auto space-y-0.5">
                          {filteredContacts.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2">No contacts found</p>
                          ) : (
                            filteredContacts.map((c: any) => (
                              <button
                                key={c.id}
                                onClick={() => { linkContact(c.id); setContactSearch('') }}
                                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors"
                              >
                                <span className="font-medium">{c.full_name}</span>
                                {c.company && <span className="text-muted-foreground ml-1">({c.company})</span>}
                              </button>
                            ))
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Address</Label>
                  {isEditing ? (
                    <Input
                      value={form.address}
                      onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                      className={`mt-0.5 ${fieldCls('address')}`}
                      data-testid="modal-input-address"
                      autoFocus={highlightFields[0] === 'address'}
                    />
                  ) : inlineField === 'address' ? (
                    <Input
                      autoFocus
                      value={inlineValue}
                      onChange={e => setInlineValue(e.target.value)}
                      onBlur={() => commitInlineEdit('address')}
                      onKeyDown={e => e.key === 'Enter' && commitInlineEdit('address')}
                      className="mt-0.5 h-7 text-xs"
                    />
                  ) : (
                    <p className={`text-sm mt-0.5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors' : ''}`}
                       onClick={() => startInlineEdit('address', property.address)}>
                      {property.address || '—'}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Bedrooms', field: 'bedrooms', value: property.bedrooms },
                  { label: 'Baths', field: 'full_baths', value: property.full_baths != null ? `${property.full_baths}${property.half_baths ? `/${property.half_baths}h` : ''}` : null },
                  { label: 'Sq Ft', field: 'square_footage', value: property.square_footage?.toLocaleString() },
                  { label: 'Guests', field: 'guest_count', value: property.guest_count },
                ].map(row => (
                  <div key={row.field}>
                    <Label className="text-xs text-muted-foreground">{row.label}</Label>
                    {isEditing && row.editable !== false && row.field !== 'full_baths' ? (
                      <Input
                        type="number"
                        value={form[row.field] ?? ''}
                        onChange={e => setForm(f => ({ ...f, [row.field]: e.target.value }))}
                        className={`mt-0.5 ${fieldCls(row.field)}`}
                        data-testid={`modal-input-${row.field}`}
                        autoFocus={highlightFields[0] === row.field}
                      />
                    ) : inlineField === row.field ? (
                      <Input
                        autoFocus
                        type="number"
                        value={inlineValue}
                        onChange={e => setInlineValue(e.target.value)}
                        onBlur={() => commitInlineEdit(row.field)}
                        onKeyDown={e => e.key === 'Enter' && commitInlineEdit(row.field)}
                        className="mt-0.5 h-7 text-xs"
                      />
                    ) : (
                      <p className={`text-sm mt-0.5 ${highlightFields.includes(row.field) && isEditing ? 'text-destructive' : ''} ${canEdit && row.editable !== false ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors' : ''}`}
                         onClick={() => row.editable !== false && startInlineEdit(row.field, property[row.field])}>
                        {row.value ?? '—'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* ── Financials Tab ── */}
            {canViewFinancials && (
              <TabsContent value="financials" className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'CE Charged', field: 'ce_charged', value: property.ce_charged },
                    { label: 'Cleaner Pay', field: 'cleaner_pay', value: property.cleaner_pay },
                  ].map(row => (
                    <div key={row.field}>
                      <Label className="text-xs text-muted-foreground">{row.label}</Label>
                      {isEditing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={form[row.field] ?? ''}
                          onChange={e => setForm(f => ({ ...f, [row.field]: e.target.value }))}
                          className={`mt-0.5 ${fieldCls(row.field)}`}
                          data-testid={`modal-input-${row.field}`}
                          autoFocus={highlightFields[0] === row.field}
                        />
                      ) : inlineField === row.field ? (
                        <Input
                          autoFocus
                          type="number"
                          step="0.01"
                          value={inlineValue}
                          onChange={e => setInlineValue(e.target.value)}
                          onBlur={() => commitInlineEdit(row.field)}
                          onKeyDown={e => e.key === 'Enter' && commitInlineEdit(row.field)}
                          className="mt-0.5 h-7 text-xs"
                        />
                      ) : (
                        <p className={`text-sm mt-0.5 ${canEdit ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors' : ''}`}
                           onClick={() => startInlineEdit(row.field, row.value)}>
                          {row.value != null ? `$${Number(row.value).toFixed(2)}` : '—'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 bg-muted/40 rounded-md p-3">
                  <div>
                    <span className="text-xs text-muted-foreground block">Total Cost</span>
                    <span className="text-sm font-medium">{property.total_estimated_cost != null ? `$${Number(property.total_estimated_cost).toFixed(2)}` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Profit $</span>
                    <span className={`text-sm font-medium ${(property.estimated_profit || 0) < 0 ? 'text-destructive' : ''}`}>
                      {property.estimated_profit != null ? `$${Number(property.estimated_profit).toFixed(2)}` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Profit %</span>
                    <span className={`text-sm font-medium ${
                      property.profit_percentage == null ? '' :
                      property.profit_percentage >= 30 ? 'text-green-600 dark:text-green-400' :
                      property.profit_percentage >= 15 ? 'text-amber-600' :
                      'text-destructive'
                    }`}>
                      {property.profit_percentage != null ? `${Number(property.profit_percentage).toFixed(1)}%` : '—'}
                    </span>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ── Linens Tab ── */}
            <TabsContent value="linens" className="mt-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {LINEN_COLS.map(col => (
                  <div key={col.key} className="bg-muted/40 rounded p-2">
                    <span className="text-xs text-muted-foreground block">{col.label}</span>
                    <span className="text-sm font-medium">{property[col.key] ?? '—'}</span>
                  </div>
                ))}
              </div>
              {property.linen_notes && (
                <div className="mt-3">
                  <span className="text-xs text-muted-foreground block">Notes</span>
                  <p className="text-sm mt-0.5">{property.linen_notes}</p>
                </div>
              )}
            </TabsContent>

            {/* ── Access Tab ── */}
            {canViewAccess && (
              <TabsContent value="access" className="mt-3 space-y-3">
                {[
                  { key: 'auto_code', label: 'Auto Code' },
                  { key: 'door_code', label: 'Door Code' },
                  { key: 'other_codes', label: 'Other Codes' },
                  { key: 'wifi_info', label: 'WiFi Info' },
                ].map(col => (
                  <div key={col.key}>
                    <span className="text-xs text-muted-foreground block mb-0.5">{col.label}</span>
                    <RevealCell value={property[col.key]} field={col.key} id={property.id} />
                  </div>
                ))}
              </TabsContent>
            )}

            {/* ── AC Filter Tab ── */}
            {canViewAccess && (
              <TabsContent value="ac-filter" className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-xs text-muted-foreground block">Filter Size</span>
                    <span className="text-sm">{property.filter_size || '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Last Changed</span>
                    <span className="text-sm">{property.last_filter_changed ? property.last_filter_changed.slice(0, 10) : '—'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Next Due</span>
                    <span className="text-sm">{property.next_filter_due ? property.next_filter_due.slice(0, 10) : '—'}</span>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ── Notes Tab ── */}
            <TabsContent value="notes" className="mt-3">
              {isEditing ? (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="mt-1 w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid="modal-input-notes"
                  />
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{property.notes || <span className="text-muted-foreground italic">No notes</span>}</p>
              )}
            </TabsContent>
          </Tabs>
        )}

        {/* Footer */}
        <DialogFooter className="flex items-center gap-2 pt-2">
          {sourceContext === 'pipeline' && (
            <Button variant="outline" size="sm" onClick={handleViewInContext} className="mr-auto">
              View in Pipeline
            </Button>
          )}
          {isEditing && canEdit ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => saveEdits()} disabled={saving} data-testid="modal-save-btn">
                {saving ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Saving…</> : 'Save Changes'}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={closePropertyModal}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
