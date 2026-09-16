import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { ORGANIZATIONS_QUERY_KEY, type Organization } from '@/hooks/use-organizations'
import { CONTACTS_QUERY_KEY } from '@/hooks/use-contacts'
import { useLocale } from '@/lib/i18n/LocaleProvider'

type Props = {
  open: boolean
  onClose: () => void
  organization?: Organization | null
  /** Called with the new/updated org id after a successful save. */
  onSaved?: (id: string) => void
}

export function OrganizationModal({ open, onClose, organization, onSaved }: Props) {
  const { t } = useLocale('contacts')
  const { toast } = useToast()
  const qc = useQueryClient()
  const isEdit = !!organization?.id
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setName(organization?.name ?? '')
    setNotes(organization?.notes ?? '')
  }, [open, organization?.id, organization?.name, organization?.notes])

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error(t('org.toastNameRequired'))
      if (isEdit && organization) {
        const { data, error } = await supabase
          .from('organizations')
          .update({ name: trimmed, notes: notes.trim() || null, updated_at: new Date().toISOString() })
          .eq('id', organization.id)
          .select('id')
          .single()
        if (error) throw error
        return data.id as string
      }
      const { data, error } = await supabase
        .from('organizations')
        .insert({ name: trimmed, notes: notes.trim() || null })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ORGANIZATIONS_QUERY_KEY })
      qc.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY })
      toast({ title: isEdit ? t('org.toastUpdated') : t('org.toastCreated') })
      onSaved?.(id)
      onClose()
    },
    onError: (e: any) => toast({
      title: t('org.toastSaveFailed'),
      description: e?.message,
      variant: 'destructive',
    }),
  })

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('org.editTitle') : t('org.createTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs text-muted-foreground">{t('org.fieldName')}</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-8 text-sm mt-0.5"
              placeholder={t('org.placeholderName')}
              autoFocus
              data-testid="org-input-name"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t('org.fieldNotes')}</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="text-sm mt-0.5 min-h-[72px]"
              placeholder={t('org.placeholderNotes')}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('org.helpText')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button size="sm" onClick={() => save()} disabled={isPending || !name.trim()} data-testid="org-save">
            {isPending ? t('common.actions.saving') : t('common.actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
