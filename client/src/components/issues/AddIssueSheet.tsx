import type { Dispatch, SetStateAction } from 'react'
import { AlertTriangle, MessageSquare, Upload, X } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { Cleaner } from '@/hooks/use-cleaners'
import { CATEGORIES, STATUSES } from '@/lib/issues'

export interface NewIssueForm {
  report_date: string
  issue_type: string
  priority: string
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
 * `issues.tsx`. The urgent checkbox stays for now (priority select is PR 3).
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base flex items-center gap-2">
            {newForm.issue_type === 'guest_feedback'
              ? <><MessageSquare className="w-4 h-4 text-info" /> Log Guest Feedback</>
              : <><AlertTriangle className="w-4 h-4 text-warning" /> Log Issue</>}
          </SheetTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {newForm.issue_type === 'guest_feedback'
              ? 'Retroactive guest feedback for the record — document what was reported, found, and resolved.'
              : 'Something that needs fixing. After saving, copy the share link to send it to a cleaner.'}
          </p>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Report Date</label>
              <Input type="date" value={newForm.report_date} onChange={e => setNewForm(f => ({ ...f, report_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <select value={newForm.status} onChange={e => setNewForm(f => ({ ...f, status: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {newForm.issue_type === 'needs_attention' && (
            <label className="flex items-center gap-2 text-sm rounded-md border border-warning/25 bg-warning/5 px-3 h-10 cursor-pointer">
              <input type="checkbox" checked={newForm.priority === 'urgent'} onChange={e => setNewForm(f => ({ ...f, priority: e.target.checked ? 'urgent' : 'normal' }))} className="h-4 w-4 rounded border-input" />
              <span className="font-medium">Mark urgent</span>
              <span className="text-xs text-muted-foreground">— needs fixing right away</span>
            </label>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Property</label>
            <select value={newForm.property_id} onChange={e => {
              const id = e.target.value
              const name = (properties || []).find((p) => String(p.id) === id)?.name || ''
              setNewForm(f => ({ ...f, property_id: id, property_name: name }))
            }} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
              <option value="">Select property…</option>
              {(properties || []).map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Category</label>
            <select value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Last Touch (person responsible) — optional</label>
            <select
              value={newForm.last_touch}
              onChange={e => setNewForm(f => ({ ...f, last_touch: e.target.value }))}
              className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
            >
              <option value="">Select cleaner…</option>
              {(cleaners || []).map((c) => (
                <option key={c.id} value={c.full_name}>{c.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Details</label>
            <textarea value={newForm.details} onChange={e => setNewForm(f => ({ ...f, details: e.target.value }))} className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Describe the issue…" />
          </div>
          {newForm.issue_type === 'guest_feedback' && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Assessment</label>
                <textarea value={newForm.assessment} onChange={e => setNewForm(f => ({ ...f, assessment: e.target.value }))} className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="What was found…" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Resolution</label>
                <textarea value={newForm.resolution} onChange={e => setNewForm(f => ({ ...f, resolution: e.target.value }))} className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="How was it resolved…" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Coverage</label>
                <select value={newForm.coverage} onChange={e => setNewForm(f => ({ ...f, coverage: e.target.value }))} className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background">
                  <option value="">N/A</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            </>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Remarks</label>
            <Input value={newForm.remarks} onChange={e => setNewForm(f => ({ ...f, remarks: e.target.value }))} className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Slack Link</label>
            <Input value={newForm.slack_link} onChange={e => setNewForm(f => ({ ...f, slack_link: e.target.value }))} className="h-8 text-sm" placeholder="https://tendwell.slack.com/..." />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Initial photo (optional)</label>
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
                <Upload className="w-3.5 h-3.5" /> Add a photo (e.g. the dirty hot tub)
              </Button>
            )}
          </div>
          <Button className="w-full h-10" disabled={!newForm.property_name || !newForm.details || adding} onClick={onSubmit}>
            {adding ? 'Saving…' : (newForm.issue_type === 'guest_feedback' ? 'Save Feedback' : 'Log Issue')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
