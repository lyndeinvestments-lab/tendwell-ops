import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { LOST_ITEM_PIPELINE, authFetch, statusLabel, type LostItemStatus } from './shared'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (caseId: string) => void
}

interface FormState {
  item_description: string
  found_location: string
  property_name: string
  guest_name: string
  guest_email: string
  guest_phone: string
  cleaning_vendor: string
  notes: string
  follow_up_date: string
  status: LostItemStatus
}

const EMPTY: FormState = {
  item_description: '',
  found_location: '',
  property_name: '',
  guest_name: '',
  guest_email: '',
  guest_phone: '',
  cleaning_vendor: '',
  notes: '',
  follow_up_date: '',
  status: 'pending_pickup',
}

// Lightweight new-case dialog. Mirrors the core fields of Haven's
// lost-item-new-form.tsx but skips fields that don't make sense from
// Tendwell (photo upload, slack thread, conversation_url) — those land
// only via the Haven UI.
export function NewLostItemCaseDialog({ open, onOpenChange, onCreated }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const { t } = useLocale('lostItems')
  const { toast } = useToast()
  const qc = useQueryClient()

  const create = useMutation({
    mutationFn: async (input: FormState) => {
      const payload: Record<string, unknown> = {
        item_description: input.item_description.trim(),
        status: input.status,
      }
      if (input.found_location.trim()) payload.found_location = input.found_location.trim()
      if (input.property_name.trim()) payload.property_name = input.property_name.trim()
      if (input.guest_name.trim()) payload.guest_name = input.guest_name.trim()
      if (input.guest_email.trim()) payload.guest_email = input.guest_email.trim()
      if (input.guest_phone.trim()) payload.guest_phone = input.guest_phone.trim()
      if (input.cleaning_vendor.trim()) payload.cleaning_vendor = input.cleaning_vendor.trim()
      if (input.notes.trim()) payload.notes = input.notes.trim()
      if (input.follow_up_date) payload.follow_up_date = input.follow_up_date
      return authFetch('/api/lost-items/create', {
        method: 'POST',
        body: JSON.stringify(payload),
      }) as Promise<{ ok: boolean; case: { id: string; case_number: string } }>
    },
    onSuccess: (r) => {
      toast({ title: t('toasts.caseCreated'), description: r.case.case_number })
      qc.invalidateQueries({ queryKey: ['/api/lost-items/list'] })
      qc.invalidateQueries({ queryKey: ['/api/lost-items/assignments'] })
      onCreated?.(r.case.id)
      setForm(EMPTY)
      onOpenChange(false)
    },
    onError: (e: any) => {
      toast({ title: t('toasts.createFailed'), description: e?.message ?? t('toasts.unknownError'), variant: 'destructive' })
    },
  })

  const canSubmit = form.item_description.trim().length > 0 && !create.isPending

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  return (
    <Dialog open={open} onOpenChange={v => !create.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('newCase.title')}</DialogTitle>
          <DialogDescription className="text-xs">
            {t('newCase.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('newCase.whatWasFound')}</Label>
            <Textarea
              value={form.item_description}
              onChange={e => patch('item_description', e.target.value)}
              placeholder={t('newCase.whatWasFoundPlaceholder')}
              rows={2}
              className="text-sm"
              data-testid="input-new-case-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t('detail.fields.foundAt')}</Label>
              <Input
                value={form.found_location}
                onChange={e => patch('found_location', e.target.value)}
                placeholder={t('newCase.foundAtPlaceholder')}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">{t('common.labels.property')}</Label>
              <Input
                value={form.property_name}
                onChange={e => patch('property_name', e.target.value)}
                placeholder={t('newCase.propertyPlaceholder')}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t('detail.fields.guestName')}</Label>
              <Input
                value={form.guest_name}
                onChange={e => patch('guest_name', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">{t('detail.fields.guestEmail')}</Label>
              <Input
                type="email"
                value={form.guest_email}
                onChange={e => patch('guest_email', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t('detail.fields.guestPhone')}</Label>
              <Input
                value={form.guest_phone}
                onChange={e => patch('guest_phone', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">{t('detail.fields.cleaningVendor')}</Label>
              <Input
                value={form.cleaning_vendor}
                onChange={e => patch('cleaning_vendor', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t('newCase.initialStatus')}</Label>
              <Select value={form.status} onValueChange={v => patch('status', v as LostItemStatus)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOST_ITEM_PIPELINE.map(s => (
                    <SelectItem key={s} value={s}>{statusLabel(s, t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('detail.fields.followUp')}</Label>
              <Input
                type="date"
                value={form.follow_up_date}
                onChange={e => patch('follow_up_date', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">{t('common.labels.notes')}</Label>
            <Textarea
              value={form.notes}
              onChange={e => patch('notes', e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => create.mutate(form)}
              disabled={!canSubmit}
              data-testid="button-submit-new-case"
            >
              {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              {t('newCase.create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
