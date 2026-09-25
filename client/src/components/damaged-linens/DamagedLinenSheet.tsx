import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, Upload, X } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { supabase, logActivity } from '@/lib/supabase'
import { resizeImageFile } from '@/lib/resize-image'
import { useToast } from '@/hooks/use-toast'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import type { Cleaner } from '@/hooks/use-cleaners'
import {
  DAMAGED_ITEM_GROUPS, DAMAGE_TYPES, DAMAGE_TYPE_LABELS, DAMAGED_STATUSES, DAMAGED_STATUS_LABELS,
  itemFallbackLabel, type DamagedLinen,
} from '@/lib/damaged-linens'

export const DAMAGED_LINENS_QUERY_KEY = ['/supabase/damaged-linens'] as const

interface FormState {
  property_id: string
  item_type: string
  quantity: string
  damage_type: string
  status: string
  found_date: string
  found_by: string
  cleaner_id: string
  estimated_cost: string
  charge_back: boolean
  notes: string
  photo_urls: string[]
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toForm(row: DamagedLinen | null): FormState {
  return {
    property_id: row?.property_id != null ? String(row.property_id) : '',
    item_type: row?.item_type ?? 'bath_towel',
    quantity: String(row?.quantity ?? 1),
    damage_type: row?.damage_type ?? 'stain',
    status: row?.status ?? 'reported',
    found_date: row?.found_date ?? todayIso(),
    found_by: row?.found_by ?? '',
    cleaner_id: row?.cleaner_id ?? '',
    estimated_cost: row?.estimated_cost != null ? String(row.estimated_cost) : '',
    charge_back: row?.charge_back ?? false,
    notes: row?.notes ?? '',
    photo_urls: row?.photo_urls ?? [],
  }
}

const selectClass = 'w-full h-9 text-sm border border-input rounded-md px-2 bg-background'
const labelClass = 'text-xs font-medium text-muted-foreground block mb-1'

/** Add / edit sheet for one damaged-linen report. `row = null` → new report. */
export function DamagedLinenSheet({
  open,
  onOpenChange,
  row,
  properties,
  cleaners,
  canEdit,
  userLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: DamagedLinen | null
  properties: Array<{ id: number; name: string }>
  cleaners: Cleaner[]
  canEdit: boolean
  userLabel: string
}) {
  const { t } = useLocale('linens')
  const { format } = useDateFormat()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(() => toForm(row))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Reset whenever the sheet opens on a (possibly different) row.
  useEffect(() => {
    if (open) setForm(toForm(row))
  }, [open, row])

  const isNew = !row
  const readOnly = !canEdit
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const propertyName = (id: string) =>
    properties.find(p => String(p.id) === id)?.name ?? row?.property?.name ?? null

  async function addPhoto(file: File) {
    setUploading(true)
    try {
      const resized = await resizeImageFile(file)
      const path = `${row?.id ?? 'new'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      const { error } = await supabase.storage.from('damaged-linens').upload(path, resized, { contentType: resized.type || 'image/jpeg' })
      if (error) throw error
      const { data } = supabase.storage.from('damaged-linens').getPublicUrl(path)
      setForm(f => ({ ...f, photo_urls: [...f.photo_urls, data.publicUrl] }))
    } catch (e: any) {
      toast({ title: t('damaged.toasts.photoFailed'), description: e?.message, variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    setSaving(true)
    const qty = Math.max(1, parseInt(form.quantity, 10) || 1)
    const cost = form.estimated_cost.trim() === '' ? null : Math.max(0, Number(form.estimated_cost) || 0)
    const payload = {
      property_id: form.property_id ? Number(form.property_id) : null,
      item_type: form.item_type,
      quantity: qty,
      damage_type: form.damage_type,
      status: form.status,
      found_date: form.found_date || todayIso(),
      found_by: form.found_by || null,
      cleaner_id: form.cleaner_id || null,
      estimated_cost: cost,
      charge_back: form.charge_back,
      notes: form.notes.trim() || null,
      photo_urls: form.photo_urls,
      ...(row && row.status !== form.status && (form.status === 'restored' || form.status === 'discarded')
        ? { resolved_by: userLabel || null }
        : {}),
    }
    const entityName = `${propertyName(form.property_id) ?? t('damaged.page.noProperty')} · ${itemFallbackLabel(form.item_type)}`
    try {
      if (isNew) {
        const { data, error } = await (supabase as any)
          .from('damaged_linens')
          .insert({
            ...payload,
            created_by: userLabel || null,
            ...(form.status === 'restored' || form.status === 'discarded' ? { resolved_by: userLabel || null } : {}),
          })
          .select('id')
          .single()
        if (error) throw error
        void logActivity({
          entity_type: 'linen', entity_id: data?.id, entity_name: entityName, action: 'create',
          field_name: 'damaged_linen', new_value: `${qty} × ${form.damage_type} (${form.status})`,
          changed_by: userLabel || null, metadata: { property_id: payload.property_id, item_type: form.item_type },
        })
        toast({ title: t('damaged.toasts.saved') })
      } else {
        const { error } = await (supabase as any).from('damaged_linens').update(payload).eq('id', row.id)
        if (error) throw error
        if (row.status !== form.status) {
          void logActivity({
            entity_type: 'linen', entity_id: row.id, entity_name: entityName, action: 'update',
            field_name: 'damaged_linen_status', old_value: row.status, new_value: form.status,
            changed_by: userLabel || null,
          })
        }
        toast({ title: t('damaged.toasts.updated') })
      }
      await qc.invalidateQueries({ queryKey: DAMAGED_LINENS_QUERY_KEY })
      onOpenChange(false)
    } catch (e: any) {
      toast({ title: t('damaged.toasts.saveFailed'), description: e?.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!row || !window.confirm(t('damaged.form.confirmDelete'))) return
    setSaving(true)
    try {
      const { error } = await (supabase as any).from('damaged_linens').delete().eq('id', row.id)
      if (error) throw error
      void logActivity({
        entity_type: 'linen', entity_id: row.id,
        entity_name: `${row.property?.name ?? t('damaged.page.noProperty')} · ${itemFallbackLabel(row.item_type)}`,
        action: 'delete', field_name: 'damaged_linen', old_value: `${row.quantity} × ${row.damage_type} (${row.status})`,
        changed_by: userLabel || null,
      })
      toast({ title: t('damaged.toasts.deleted') })
      await qc.invalidateQueries({ queryKey: DAMAGED_LINENS_QUERY_KEY })
      onOpenChange(false)
    } catch (e: any) {
      toast({ title: t('damaged.toasts.saveFailed'), description: e?.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">{isNew ? t('damaged.form.titleNew') : t('damaged.form.titleEdit')}</SheetTitle>
          <p className="text-xs text-muted-foreground mt-1">{t('damaged.form.description')}</p>
        </SheetHeader>

        <fieldset disabled={readOnly || saving} className="mt-4 space-y-3">
          <div>
            <label className={labelClass}>{t('damaged.form.property')}</label>
            <SearchSelect
              value={form.property_id}
              onSelect={(id) => set('property_id', id)}
              options={properties.map(p => ({ value: String(p.id), label: p.name }))}
              placeholder={row?.property?.name ?? t('damaged.form.selectProperty')}
              searchPlaceholder={t('damaged.form.searchProperties')}
              emptyText={t('damaged.form.noMatches')}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={labelClass}>{t('damaged.form.item')}</label>
              <select value={form.item_type} onChange={e => set('item_type', e.target.value)} className={selectClass}>
                {DAMAGED_ITEM_GROUPS.map(g => (
                  <optgroup key={g.key} label={t(`damaged.itemGroups.${g.key}`, undefined, g.label)}>
                    {g.items.map(i => (
                      <option key={i.key} value={i.key}>{t(`damaged.items.${i.key}`, undefined, i.label)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('damaged.form.quantity')}</label>
              <Input type="number" min={1} inputMode="numeric" value={form.quantity} onChange={e => set('quantity', e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t('damaged.form.damageType')}</label>
              <select value={form.damage_type} onChange={e => set('damage_type', e.target.value)} className={selectClass}>
                {DAMAGE_TYPES.map(d => (
                  <option key={d} value={d}>{t(`damaged.damageTypes.${d}`, undefined, DAMAGE_TYPE_LABELS[d])}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('damaged.form.status')}</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={selectClass}>
                {DAMAGED_STATUSES.map(s => (
                  <option key={s} value={s}>{t(`damaged.statuses.${s}`, undefined, DAMAGED_STATUS_LABELS[s])}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t('damaged.form.foundDate')}</label>
              <Input type="date" value={form.found_date} onChange={e => set('found_date', e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <label className={labelClass}>{t('damaged.form.estimatedCost')}</label>
              <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.estimated_cost} onChange={e => set('estimated_cost', e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <p className="text-2xs text-muted-foreground -mt-1">{t('damaged.form.estimatedCostHint')}</p>

          <div>
            <label className={labelClass}>{t('damaged.form.foundBy')}</label>
            <SearchSelect
              value={form.cleaner_id}
              onSelect={(id, name) => setForm(f => ({ ...f, cleaner_id: id, found_by: id ? name : '' }))}
              options={cleaners.filter(c => c.full_name).map(c => ({ value: c.id, label: c.full_name }))}
              placeholder={form.found_by || t('damaged.form.selectCleaner')}
              searchPlaceholder={t('damaged.form.searchCleaners')}
              emptyText={t('damaged.form.noMatches')}
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={form.charge_back} onCheckedChange={v => set('charge_back', v === true)} />
            {t('damaged.form.chargeBack')}
          </label>

          <div>
            <label className={labelClass}>{t('damaged.form.notes')}</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder={t('damaged.form.notesPlaceholder')}
              className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className={labelClass}>{t('damaged.form.photos')}</label>
            {form.photo_urls.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-2">
                {form.photo_urls.map(url => (
                  <div key={url} className="relative group">
                    <a href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt="" className="h-24 w-full object-cover rounded-md border border-border" />
                    </a>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => set('photo_urls', form.photo_urls.filter(u => u !== url))}
                        className="absolute top-1 right-1 rounded-full bg-background/90 p-0.5 text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 text-xs gap-1.5 w-full"
                disabled={uploading}
                onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.accept = 'image/*'
                  input.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void addPhoto(f) }
                  input.click()
                }}
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {t('damaged.form.addPhoto')}
              </Button>
            )}
          </div>

          {row?.resolved_at && (
            <p className="text-xs text-muted-foreground">
              {row.resolved_by
                ? t('damaged.form.resolvedOn', { date: format(new Date(row.resolved_at), 'MMM d, yyyy'), name: row.resolved_by })
                : t('damaged.form.resolvedOnNoName', { date: format(new Date(row.resolved_at), 'MMM d, yyyy') })}
            </p>
          )}
        </fieldset>

        {!readOnly && (
          <div className="mt-5 flex items-center gap-2">
            {!isNew && (
              <Button type="button" variant="outline" className="h-10 gap-1.5 text-destructive" onClick={remove} disabled={saving}>
                <Trash2 className="w-4 h-4" /> {t('damaged.form.delete')}
              </Button>
            )}
            <Button className="flex-1 h-10" onClick={save} disabled={saving || uploading || !form.item_type}>
              {saving ? t('damaged.form.saving') : t('damaged.form.save')}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
