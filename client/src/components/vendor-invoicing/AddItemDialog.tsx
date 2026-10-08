import { useMemo, useRef, useState } from 'react'
import { Paperclip, Loader2, CheckCircle2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import {
  EVIDENCE_REQUIRED_EXTRAS,
  VENDOR_CLEAN_TYPES,
  VENDOR_EXTRA_TYPES,
  VENDOR_ITEM_CATEGORIES,
  round2,
  validateVendorItem,
  type ItemErrors,
  type VendorItemCategory,
  type VendorItemInput,
} from '@shared/vendor-invoice'
import { money, uploadReceipt, vendorApi, VendorApiError, type VendorLine, type VendorProperty } from '@/lib/vendor-invoices'

interface Props {
  runId: string
  periodStart: string
  periodEnd: string
  today: string
  properties: VendorProperty[]
  /** Present when editing one of the vendor's own items. */
  editing?: VendorLine | null
  onClose: () => void
  onSaved: () => void
}

type Form = {
  category: VendorItemCategory
  property_id: string
  date: string
  service_type: string
  amount: string
  hours: string
  rate: string
  worker: string
  description: string
  requested_by: string
  evidence_url: string
  receipt_path: string
}

const EMPTY: Form = { category: 'extra', property_id: '', date: '', service_type: '', amount: '', hours: '', rate: '', worker: '', description: '', requested_by: '', evidence_url: '', receipt_path: '' }

function initialForm(editing: VendorLine | null | undefined): Form {
  if (!editing || editing.category === 'clean') return EMPTY
  const d = editing.detail
  return {
    category: editing.category,
    property_id: editing.property_id != null ? String(editing.property_id) : '',
    date: editing.date ?? '',
    service_type: editing.service_type ?? '',
    amount: editing.amount != null ? String(editing.amount) : '',
    hours: d.hours != null ? String(d.hours) : '',
    rate: d.rate != null ? String(d.rate) : '',
    worker: d.worker ?? '',
    description: d.description ?? '',
    requested_by: d.requested_by ?? '',
    evidence_url: d.evidence_url ?? '',
    // The stored receipt path never reaches the vendor's browser; an edit
    // without a new upload keeps it (the API fills it back in).
    receipt_path: '',
  }
}

function toInput(f: Form): VendorItemInput {
  const n = (s: string) => (s.trim() === '' ? null : Number(s))
  return {
    category: f.category,
    property_id: f.property_id ? Number(f.property_id) : null,
    date: f.date || null,
    service_type: f.service_type || null,
    amount: n(f.amount),
    hours: n(f.hours),
    rate: n(f.rate),
    worker: f.worker,
    description: f.description,
    requested_by: f.requested_by,
    evidence_url: f.evidence_url,
    receipt_path: f.receipt_path || null,
  }
}

export function AddItemDialog({ runId, periodStart, periodEnd, today, properties, editing, onClose, onSaved }: Props) {
  const { t } = useLocale('vendorInvoicing')
  const [form, setForm] = useState<Form>(() => initialForm(editing))
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<ItemErrors>({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const isEdit = !!editing
  const keepsReceipt = isEdit && !!editing?.detail.has_receipt && !form.receipt_path

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm(prev => ({ ...prev, [k]: v }))
    setServerErrors(prev => ({ ...prev, [k]: undefined }))
  }

  const property = properties.find(p => String(p.id) === form.property_id) ?? null
  const validation = useMemo(
    () => validateVendorItem(
      // An existing receipt counts as attached for the form's own check.
      { ...toInput(form), receipt_path: form.receipt_path || (keepsReceipt ? 'existing' : null) },
      { periodStart, periodEnd, today, propertyCleanerPay: property?.cleaner_pay ?? null },
    ),
    [form, periodStart, periodEnd, today, property, keepsReceipt],
  )
  const errors: ItemErrors = { ...(submitted ? validation.errors : {}), ...serverErrors }
  const err = (k: keyof VendorItemInput) => (errors[k] ? <p className="text-2xs text-destructive mt-1" role="alert">{t(`errors.${errors[k]}`)}</p> : null)

  const c = form.category
  const needsProperty = c === 'missing_clean' || c === 'extra' || c === 'reimbursement'
  const hourly = c === 'inspection' || c === 'labor'
  const evidenceRequired = c === 'extra' && EVIDENCE_REQUIRED_EXTRAS.has(form.service_type)
  const showUpload = c === 'reimbursement' || c === 'extra'
  const hourlyTotal = hourly && form.hours && form.rate ? round2(Number(form.hours) * Number(form.rate)) : null

  const propertyOptions = useMemo(
    () => properties.map(p => ({ value: String(p.id), label: p.address ? `${p.name} — ${p.address}` : p.name })),
    [properties],
  )

  async function onFile(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setFatal(null)
    setServerErrors(prev => ({ ...prev, receipt_path: undefined, evidence_url: undefined }))
    try {
      const path = await uploadReceipt(runId, file)
      set('receipt_path', path)
    } catch (e) {
      const code = e instanceof VendorApiError ? e.code : 'upload_failed'
      setFatal(t(`errors.${code}`, undefined, t('errors.upload_failed')))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    setSubmitted(true)
    setFatal(null)
    if (!validation.ok) return
    setSaving(true)
    try {
      await vendorApi('items', {
        method: 'POST',
        body: isEdit
          ? { action: 'update', run_id: runId, line_id: editing!.id, item: toInput(form) }
          : { action: 'add', run_id: runId, item: toInput(form) },
      })
      onSaved()
    } catch (e) {
      if (e instanceof VendorApiError && e.body?.errors) setServerErrors(e.body.errors)
      else if (e instanceof VendorApiError && e.status === 409 && e.code !== 'not_draft') setFatal(t('errors.duplicate'))
      else setFatal(t(e instanceof VendorApiError ? `errors.${e.code}` : 'errors.generic', undefined, t('errors.generic')))
    } finally {
      setSaving(false)
    }
  }

  const descLabel =
    c === 'reimbursement' ? t('item.descReimbursement')
    : c === 'missing_clean' ? t('item.reasonMissing')
    : c === 'labor' ? t('item.descLabor')
    : c === 'inspection' ? t('item.descInspection')
    : t('item.reason')

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" data-testid="dialog-vendor-item">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('item.titleEdit') : t('item.titleAdd')}</DialogTitle>
          <DialogDescription>{t(`categoryHelp.${c}`)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{t('item.category')}</Label>
            <Select
              value={c}
              onValueChange={v => {
                setForm(prev => ({ ...EMPTY, category: v as VendorItemCategory, property_id: prev.property_id, date: prev.date }))
                setSubmitted(false)
                setServerErrors({})
              }}
              disabled={isEdit}
            >
              <SelectTrigger data-testid="select-item-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VENDOR_ITEM_CATEGORIES.map(cat => (
                  <SelectItem key={cat} value={cat}>{t(`category.${cat}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(needsProperty || hourly) && (
            <div>
              <Label>{needsProperty ? t('item.property') : t('item.propertyOptional')}</Label>
              <SearchSelect
                value={form.property_id}
                onSelect={v => set('property_id', v)}
                options={propertyOptions}
                placeholder={t('item.propertyPlaceholder')}
                searchPlaceholder={t('item.searchProperty')}
                emptyText={t('item.noProperty')}
              />
              {property && (
                <p className="text-2xs text-muted-foreground mt-1">
                  {[
                    property.address,
                    property.bedrooms != null ? `${property.bedrooms} ${t('property.beds')}` : null,
                    property.full_baths != null ? `${property.full_baths} ${t('property.baths')}` : null,
                    property.cleaner_pay != null ? `${t('property.cleanerPay')} ${money(property.cleaner_pay)}` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              {err('property_id')}
            </div>
          )}

          {(c === 'missing_clean' || c === 'extra') && (
            <div>
              <Label>{t('item.serviceType')}</Label>
              <Select value={form.service_type} onValueChange={v => set('service_type', v)}>
                <SelectTrigger data-testid="select-item-service"><SelectValue placeholder={t('item.chooseService')} /></SelectTrigger>
                <SelectContent>
                  {(c === 'missing_clean' ? VENDOR_CLEAN_TYPES : VENDOR_EXTRA_TYPES).map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err('service_type')}
            </div>
          )}

          <div>
            <Label>{t('item.date')}</Label>
            <Input
              type="date"
              value={form.date}
              min={c === 'missing_clean' ? periodStart : undefined}
              max={periodEnd < today ? periodEnd : today}
              onChange={e => set('date', e.target.value)}
              data-testid="input-item-date"
            />
            {c === 'inspection' && <p className="text-2xs text-muted-foreground mt-1">{t('item.dateOptional')}</p>}
            {err('date')}
          </div>

          {hourly && (
            <>
              <div>
                <Label>{t('item.worker')}</Label>
                <Input value={form.worker} onChange={e => set('worker', e.target.value)} maxLength={120} data-testid="input-item-worker" />
                {err('worker')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('item.hours')}</Label>
                  <Input type="number" inputMode="decimal" step="0.25" min="0" value={form.hours} onChange={e => set('hours', e.target.value)} data-testid="input-item-hours" />
                  {err('hours')}
                </div>
                <div>
                  <Label>{t('item.rate')}</Label>
                  <Input type="number" inputMode="decimal" step="0.01" min="0" value={form.rate} onChange={e => set('rate', e.target.value)} data-testid="input-item-rate" />
                  {err('rate')}
                </div>
              </div>
              {hourlyTotal != null && <p className="text-sm font-medium tabular-nums">{t('item.total', { amount: money(hourlyTotal) })}</p>}
            </>
          )}

          {(c === 'extra' || c === 'reimbursement') && (
            <div>
              <Label>{t('item.amount')}</Label>
              <Input type="number" inputMode="decimal" step="0.01" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} data-testid="input-item-amount" />
              {err('amount')}
            </div>
          )}

          {c === 'missing_clean' && (
            <div className="rounded-lg border border-card-border bg-muted/40 px-3 py-2 text-sm">
              {!property
                ? t('item.chooseFirst')
                : form.service_type === 'Deep Clean'
                  ? t('item.missingAmountDeep', { amount: money(property.cleaner_pay != null ? round2(property.cleaner_pay * 3) : null) })
                  : t('item.missingAmount', { amount: money(property.cleaner_pay) })}
              {err('amount')}
            </div>
          )}

          <div>
            <Label>{descLabel}</Label>
            <Textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} maxLength={500} data-testid="input-item-description" />
            {err('description')}
          </div>

          {c === 'reimbursement' && (
            <div>
              <Label>{t('item.requestedBy')}</Label>
              <Input value={form.requested_by} onChange={e => set('requested_by', e.target.value)} maxLength={200} data-testid="input-item-requested-by" />
              <p className="text-2xs text-muted-foreground mt-1">{t('item.requestedByHint')}</p>
              {err('requested_by')}
            </div>
          )}

          {(c === 'extra' || c === 'reimbursement' || c === 'missing_clean') && (
            <div>
              <Label>{t('item.evidenceUrl')}</Label>
              <Input type="url" inputMode="url" placeholder="https://" value={form.evidence_url} onChange={e => set('evidence_url', e.target.value)} data-testid="input-item-evidence" />
              <p className="text-2xs text-muted-foreground mt-1">{evidenceRequired ? t('item.evidenceRequiredHint') : t('item.evidenceHint')}</p>
              {err('evidence_url')}
            </div>
          )}

          {showUpload && (
            <div>
              <Label>{c === 'reimbursement' ? t('item.receipt') : t('item.photo')}</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={e => onFile(e.target.files?.[0])}
                  data-testid="input-item-file"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Paperclip className="w-4 h-4 mr-1.5" />}
                  {uploading ? t('item.uploading') : form.receipt_path || keepsReceipt ? t('item.replace') : t('item.upload')}
                </Button>
                {(form.receipt_path || keepsReceipt) && (
                  <span className="text-xs text-success inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{t('item.attached')}</span>
                )}
              </div>
              {err('receipt_path')}
            </div>
          )}

          {fatal && <p className="text-sm text-destructive" role="alert">{fatal}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('item.cancel')}</Button>
          <Button onClick={save} disabled={saving || uploading} data-testid="button-save-item">
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {saving ? t('item.saving') : t('item.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
