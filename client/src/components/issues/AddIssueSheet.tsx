import type { Dispatch, SetStateAction } from 'react'
import { AlertTriangle, MessageSquare, Upload, X } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { Cleaner } from '@/hooks/use-cleaners'
import { CATEGORIES, PRIORITIES, STATUSES, categoryLabel, priorityLabel, statusLabel } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { SearchSelect } from './SearchSelect'

export interface NewIssueForm {
  report_date: string
  issue_type: string
  priority: string
  due_date: string
  property_id: string
  property_name: string
  category: string
  last_touch: string
  details: string
  assessment: string
  resolution: string
  coverage: string
  status: string
  remarks: string
  slack_link: string
}

interface PropertyOption {
  id: number | string
  name: string
}

/**
 * The "Log Issue" / "Log Guest Feedback" sheet — extracted verbatim from
 * `issues.tsx`. PR 3 swapped the urgent checkbox for a full Priority select
 * and added an optional Due Date input (needs_attention only).
 */
export function AddIssueSheet({
  open,
  onOpenChange,
  newForm,
  setNewForm,
  properties,
  cleaners,
  newPhoto,
  setNewPhoto,
  adding,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  newForm: NewIssueForm
  setNewForm: Dispatch<SetStateAction<NewIssueForm>>
  properties: PropertyOption[] | undefined
  cleaners: Cleaner[] | undefined
  newPhoto: File | null
  setNewPhoto: Dispatch<SetStateAction<File | null>>
  adding: boolean
  onSubmit: () => void
}) {
  const { t } = useLocale()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base flex items-center gap-2">
            {newForm.issue_type === 'guest_feedback'
              ? <><MessageSquare className="w-4 h-4 text-info" /> {t('addSheet.titleGuestFeedback')}</>
              : <><AlertTriangle className="w-4 h-4 text-warning" /> {t('addSheet.titleIssue')}</>}
          </SheetTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {newForm.issue_type === 'guest_feedback' ? t('addSheet.descriptionGuestFeedback') : t('addSheet.descriptionIssue')}
          </p>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.reportDate')}</label>
              <Input type="date" value={newForm.report_date} onChange={e => setNewForm(f => ({ ...f, report_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.status')}</label>
              <select value={newForm.status} onChange={e => setNewForm(f => ({ ...f, status: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
              </select>
            </div>
          </div>
          {newForm.issue_type === 'needs_attention' && (
            <div className="rounded-md border border-warning/25 bg-warning/5 px-3 py-2 space-y-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.priority')}</label>
                <select
                  value={newForm.priority}
                  onChange={e => setNewForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
                >
                  {PRIORITIES.map(p => <option key={p} value={p}>{priorityLabel(p, t)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.dueDateOptional')}</label>
                <Input
                  type="date"
                  value={newForm.due_date}
                  onChange={e => setNewForm(f => ({ ...f, due_date: e.target.value }))}
                  className="h-8 text-sm"
                />
                <p className="text-2xs text-muted-foreground mt-1">{t('addSheet.dueDateHint')}</p>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.property')}</label>
            <SearchSelect
              value={newForm.property_id}
              onSelect={(id, name) => setNewForm(f => ({ ...f, property_id: id, property_name: name }))}
              options={(properties || []).map((p) => ({ value: String(p.id), label: p.name }))}
              placeholder={t('addSheet.selectProperty')}
              searchPlaceholder={t('addSheet.searchProperties')}
              emptyText={t('addSheet.noMatches')}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.category')}</label>
            <select value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
              {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c, t)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.lastTouchOptional')}</label>
            <SearchSelect
              value={newForm.last_touch}
              onSelect={(name) => setNewForm(f => ({ ...f, last_touch: name }))}
              options={(cleaners || []).filter(c => c.full_name).map((c) => ({ value: c.full_name as string, label: c.full_name as string }))}
              placeholder={t('addSheet.selectCleaner')}
              searchPlaceholder={t('addSheet.searchCleaners')}
              emptyText={t('addSheet.noMatches')}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.details')}</label>
            <textarea value={newForm.details} onChange={e => setNewForm(f => ({ ...f, details: e.target.value }))} className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder={t('addSheet.detailsPlaceholder')} />
          </div>
          {newForm.issue_type === 'guest_feedback' && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.assessment')}</label>
                <textarea value={newForm.assessment} onChange={e => setNewForm(f => ({ ...f, assessment: e.target.value }))} className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder={t('addSheet.assessmentPlaceholder')} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.resolution')}</label>
                <textarea value={newForm.resolution} onChange={e => setNewForm(f => ({ ...f, resolution: e.target.value }))} className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder={t('addSheet.resolutionPlaceholder')} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.coverage')}</label>
                <select value={newForm.coverage} onChange={e => setNewForm(f => ({ ...f, coverage: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                  <option value="">{t('addSheet.coverageNA')}</option>
                  <option value="Yes">{t('addSheet.coverageYes')}</option>
                  <option value="No">{t('addSheet.coverageNo')}</option>
                </select>
              </div>
            </>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.remarks')}</label>
            <Input value={newForm.remarks} onChange={e => setNewForm(f => ({ ...f, remarks: e.target.value }))} className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.slackLink')}</label>
            <Input value={newForm.slack_link} onChange={e => setNewForm(f => ({ ...f, slack_link: e.target.value }))} className="h-8 text-sm" placeholder={t('addSheet.slackLinkPlaceholder')} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{t('addSheet.photoOptional')}</label>
            {newPhoto ? (
              <div className="flex items-center gap-2 text-sm rounded-md border border-border px-3 h-9">
                <span className="truncate flex-1">{newPhoto.name}</span>
                <button type="button" onClick={() => setNewPhoto(null)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" className="h-9 text-xs gap-1.5 w-full" onClick={() => {
                const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'
                input.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) setNewPhoto(f) }
                input.click()
              }}>
                <Upload className="w-3.5 h-3.5" /> {t('addSheet.addPhoto')}
              </Button>
            )}
          </div>
          <Button className="w-full h-10" disabled={!newForm.property_name || !newForm.details || adding} onClick={onSubmit}>
            {adding ? t('addSheet.saving') : (newForm.issue_type === 'guest_feedback' ? t('addSheet.saveFeedback') : t('addSheet.saveIssue'))}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
