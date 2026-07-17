import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { format, formatDistanceToNow } from 'date-fns'
import { es as dateFnsEs } from 'date-fns/locale'
import { AlertTriangle, Check, Languages, Upload, Loader2, ImageOff } from 'lucide-react'
import { resizeImageFile } from '@/lib/resize-image'
import { categoryLabel, dueLabel, isOverdue, statusLabel } from '@/lib/issues'
import { LocaleProvider, useLocale } from '@/lib/i18n/LocaleProvider'
import { LanguageToggle } from '@/components/LanguageToggle'
import { IssueBadges } from '@/components/issues/IssueBadges'
import { useIssueTranslation, type TranslateFetcher } from '@/hooks/use-issue-translation'

// Public, no-login page reached via the shareable issue link. The unguessable
// token in the URL is the credential; all reads/writes go through the
// token-validated /api/issues/share/[token] serverless endpoint.
function getToken() {
  const m = window.location.pathname.match(/\/issue\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

/** Mounts the locale context locally, auto-detecting from the browser's language since a cleaner opening this link for the first time has no stored preference. */
export default function IssueSharePage() {
  return (
    <LocaleProvider autoDetect>
      <IssueSharePageContent />
    </LocaleProvider>
  )
}

// Unauthenticated — calls the token endpoint's `translate` action (no
// session; the token itself is the credential).
function makeShareTranslateFetcher(token: string): TranslateFetcher {
  return async (targetLang, items) => {
    const res = await fetch(`/api/issues/share/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'translate', targetLang, items }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Translation failed')
    return res.json()
  }
}

function IssueSharePageContent() {
  const token = getToken()
  const { t, locale } = useLocale()
  const qc = useQueryClient()
  const queryKey = ['/issue-share', token]
  const [name, setName] = useState(() => localStorage.getItem('issueShareName') || '')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey,
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(`/api/issues/share/${encodeURIComponent(token)}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Not found')
      return r.json()
    },
  })

  function rememberName(v: string) {
    setName(v)
    localStorage.setItem('issueShareName', v)
  }

  async function post(action: string, extra: Record<string, any> = {}) {
    const r = await fetch(`/api/issues/share/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, author_name: name, ...extra }),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed')
    await qc.invalidateQueries({ queryKey })
  }

  async function submitComment() {
    if (!comment.trim()) return
    setBusy('comment')
    try { await post('comment', { content: comment }); setComment('') }
    catch (e: any) { alert(e?.message || t('share.alertPostFailed')) }
    finally { setBusy(null) }
  }

  async function uploadPhoto(raw: File, phase: 'initial' | 'completion') {
    if (!data?.issue?.id) return
    setBusy('photo')
    try {
      const file = await resizeImageFile(raw)
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${data.issue.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('issue-photos').upload(path, file, { contentType: file.type || 'image/jpeg' })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('issue-photos').getPublicUrl(path)
      await post('photo', { photo_url: urlData.publicUrl, photo_path: path, phase })
    } catch (e: any) { alert(e?.message || t('share.alertPhotoFailed')) }
    finally { setBusy(null) }
  }

  async function markComplete() {
    setBusy('complete')
    try { await post('complete') }
    catch (e: any) { alert(e?.message || t('share.alertFailed')) }
    finally { setBusy(null) }
  }

  // Translate affordance — batches `details` + all comments (the only
  // translatable content this public endpoint exposes; assessment/
  // resolution/remarks are staff-internal and not part of the share GET
  // whitelist). Hooks run unconditionally, above the loading/error guards.
  const translateItems = useMemo(() => {
    if (!data?.issue) return []
    const items: Array<{ id: string; text: string }> = []
    if (data.issue.details) items.push({ id: 'details', text: data.issue.details })
    for (const c of data.comments || []) items.push({ id: `comment:${c.id}`, text: c.content })
    return items
  }, [data])

  const shareTranslateFetcher = useMemo(() => token ? makeShareTranslateFetcher(token) : null, [token])

  const { showTranslated, toggle: toggleTranslate, text: translated, isTranslating, hasContent: canTranslate } = useIssueTranslation({
    issueId: data?.issue?.id,
    targetLang: locale,
    items: translateItems,
    fetcher: shareTranslateFetcher || (async () => ({ translations: {} })),
  })

  async function handleToggleTranslate() {
    try { await toggleTranslate() }
    catch (e: any) { alert(e?.message || t('translate.failed')) }
  }

  if (!token) return <Centered><p className="text-sm text-muted-foreground">{t('share.invalidLink')}</p></Centered>
  if (isLoading) return <Centered><div className="w-full max-w-lg space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div></Centered>
  if (isError || !data?.issue) return <Centered><div className="text-center"><ImageOff className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" /><p className="text-sm text-muted-foreground">{t('share.notFound')}</p></div></Centered>

  const issue = data.issue
  const rawComments = data.comments || []
  const displayComments = showTranslated
    ? rawComments.map((c: any) => ({ ...c, content: translated(`comment:${c.id}`, c.content) || c.content }))
    : rawComments
  const photos = data.photos || []
  const completed = issue.status === 'Completed'
  const overdue = isOverdue(issue)
  const showBanner = (issue.priority === 'urgent' || overdue) && !completed

  return (
    <div className="min-h-dvh bg-muted/30 py-6 px-4">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center space-y-2">
          <h1 className="text-sm font-semibold text-muted-foreground">{t('share.header')}</h1>
          <LanguageToggle size="lg" className="mx-auto" />
        </div>

        {/* Loud banner — urgent or overdue, never shown once completed */}
        {showBanner && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm font-medium">{issue.priority === 'urgent' ? t('share.urgentBanner') : t('share.overdueBanner')}</p>
          </div>
        )}

        {/* Issue card */}
        <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <IssueBadges issue={issue} variant="compact" />
            <span className={`text-2xs font-medium px-2 py-0.5 rounded border ${completed ? 'text-success bg-success/10 border-success/25' : 'text-warning bg-warning/10 border-warning/25'}`}>
              {statusLabel(issue.status, t)}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">{format(new Date(issue.report_date), 'MMM d, yyyy', { locale: locale === 'es' ? dateFnsEs : undefined })}</span>
          </div>
          <h2 className="text-lg font-semibold">{issue.property_name || 'Property'}</h2>
          {issue.category && <p className="text-xs text-muted-foreground mt-0.5">{categoryLabel(issue.category, t)}</p>}
          {issue.due_date && !completed && <p className="text-xs text-muted-foreground mt-0.5">{dueLabel(issue.due_date, t, locale)}</p>}
          {issue.details && <p className="text-sm whitespace-pre-wrap mt-3">{translated('details', issue.details)}</p>}
          {canTranslate && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={handleToggleTranslate}
                disabled={isTranslating}
              >
                <Languages className="w-3.5 h-3.5" />
                {isTranslating
                  ? t('translate.translating')
                  : showTranslated
                    ? t('translate.showOriginal')
                    : (locale === 'es' ? t('translate.toSpanish') : t('translate.toEnglish'))}
              </Button>
              {showTranslated && <span className="text-2xs text-muted-foreground italic">{t('translate.machineTranslated')}</span>}
            </div>
          )}
        </div>

        {/* Your name */}
        <div className="rounded-lg border border-border bg-background p-3">
          <label className="text-xs font-medium text-muted-foreground block mb-1">{t('share.yourName')}</label>
          <Input value={name} onChange={e => rememberName(e.target.value)} placeholder={t('share.yourNamePlaceholder')} className="h-9 text-sm" />
        </div>

        {/* Photos — before / after */}
        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          {([
            { phase: 'initial' as const, label: t('share.before') },
            { phase: 'completion' as const, label: t('share.after') },
          ]).map(group => {
            const gp = photos.filter((p: any) => (p.phase || 'initial') === group.phase)
            return (
              <div key={group.phase}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{group.label} ({gp.length})</span>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={busy === 'photo'} onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'; input.accept = 'image/*'; (input as any).capture = 'environment'
                    input.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) uploadPhoto(f, group.phase) }
                    input.click()
                  }}>
                    {busy === 'photo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} {t('photos.add')}
                  </Button>
                </div>
                {gp.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {gp.map((p: any) => (
                      <a key={p.id} href={p.photo_url} target="_blank" rel="noreferrer" className="block aspect-square rounded-md border border-border overflow-hidden bg-muted/30">
                        <img src={p.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground">{group.phase === 'initial' ? t('share.noBeforePhotos') : t('share.addAfterPhotoHint')}</p>}
              </div>
            )
          })}
        </div>

        {/* Comments */}
        <div className="rounded-lg border border-border bg-background p-4">
          <span className="text-sm font-medium block mb-2">{t('comments.title')}</span>
          {displayComments.length > 0 ? (
            <ul className="space-y-2 mb-3">
              {displayComments.map((c: any) => (
                <li key={c.id} className={`rounded-md border p-2 ${c.author_type === 'cleaner' ? 'border-border bg-muted/20' : 'border-info/25 bg-info/5'}`}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-xs font-medium">{c.author_name || (c.author_type === 'cleaner' ? t('comments.cleaner') : 'Tendwell')}</span>
                    <span className="text-2xs text-muted-foreground">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: locale === 'es' ? dateFnsEs : undefined })}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{c.content}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground mb-3">{t('comments.empty')}</p>}
          {!completed && (
            <div className="space-y-2">
              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={t('share.commentPlaceholder')} className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
              <Button className="w-full h-9" disabled={!comment.trim() || busy === 'comment'} onClick={submitComment}>
                {busy === 'comment' ? t('share.posting') : t('share.postComment')}
              </Button>
            </div>
          )}
        </div>

        {/* Mark complete */}
        {!completed ? (
          <Button className="w-full h-11 gap-2" disabled={busy === 'complete'} onClick={markComplete}>
            <Check className="w-4 h-4" /> {busy === 'complete' ? t('share.saving') : t('share.markComplete')}
          </Button>
        ) : (
          <div className="rounded-lg border border-success/25 bg-success/5 p-4 text-center">
            <Check className="w-6 h-6 text-success mx-auto mb-1" />
            <p className="text-sm font-medium text-success">{t('share.completedNote')}</p>
            {issue.completed_at && <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(issue.completed_at), 'MMM d, yyyy h:mm a', { locale: locale === 'es' ? dateFnsEs : undefined })}</p>}
          </div>
        )}

        <p className="text-center text-2xs text-muted-foreground pt-2">{t('share.poweredBy')}</p>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh flex items-center justify-center bg-muted/30 px-4">{children}</div>
}
