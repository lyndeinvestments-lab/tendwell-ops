import { Image as ImageIcon, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { IssuePhoto } from '@/lib/issues'
import { useLocale } from '@/lib/i18n/LocaleProvider'

const PHOTO_GROUPS = [
  { phase: 'initial' as const, labelKey: 'photos.initial' as const },
  { phase: 'completion' as const, labelKey: 'photos.completion' as const },
]

/**
 * Dumb presentational photo grid (initial/before + completion/after),
 * extracted from `IssueDetailSheet`. Upload flow stays in the parent — no
 * behavior change.
 */
export function IssuePhotoGrid({
  photos,
  canEdit,
  uploading,
  onUpload,
}: {
  photos: IssuePhoto[] | undefined
  canEdit: boolean
  uploading: boolean
  onUpload: (file: File, phase: 'initial' | 'completion') => void
}) {
  const { t } = useLocale()
  return (
    <div className="pt-2 border-t border-border space-y-3">
      {PHOTO_GROUPS.map(group => {
        const groupPhotos = (photos || []).filter((p) => (p.phase || 'initial') === group.phase)
        return (
          <div key={group.phase}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> {t(group.labelKey)} ({groupPhotos.length})</span>
              {canEdit && (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" disabled={uploading} onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'; input.accept = 'image/*'
                  input.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onUpload(f, group.phase) }
                  input.click()
                }}>
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} {t('photos.add')}
                </Button>
              )}
            </div>
            {groupPhotos.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {groupPhotos.map((p) => (
                  <a key={p.id} href={p.photo_url} target="_blank" rel="noreferrer" className="block aspect-square rounded-md border border-border overflow-hidden bg-muted/30 hover:opacity-80">
                    <img src={p.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">{group.phase === 'initial' ? t('photos.noInitial') : t('photos.noCompletion')}</p>}
          </div>
        )
      })}
    </div>
  )
}
