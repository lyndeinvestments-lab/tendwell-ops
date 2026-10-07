import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'

/** The owner's Trellis portal link (set by staff), or null until it exists. */
export function useOwnerTrellisUrl() {
  const query = useQuery({
    queryKey: ['owner-trellis-url'],
    queryFn: async () => {
      const { data: oid } = await supabase.rpc('current_owner_id')
      const { data, error } = await supabase
        .from('property_owners')
        .select('trellis_portal_url')
        .eq('id', (oid as any) ?? '')
        .maybeSingle()
      if (error) throw error
      return data?.trellis_portal_url ?? null
    },
  })
  const trimmed = typeof query.data === 'string' ? query.data.trim() : ''
  return { url: trimmed === '' ? null : trimmed, isLoading: query.isLoading }
}

/**
 * Open / Copy actions for the Trellis link.
 * `variant="embedded"` drops the card, for the onboarding guide's third step.
 * `showPlaceholder` renders "your link will appear here" instead of nothing while
 * staff have not set the link yet (used for owners who are mid-onboarding).
 */
export function TrellisPortalCard({
  variant = 'card',
  showPlaceholder = false,
}: {
  variant?: 'card' | 'embedded'
  showPlaceholder?: boolean
}) {
  const { t } = useLocale('ownerPortal')
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const { url, isLoading } = useOwnerTrellisUrl()

  if (isLoading) return null

  if (!url) {
    if (!showPlaceholder) return null
    const placeholder = (
      <p className="text-sm text-muted-foreground" data-testid="text-trellis-placeholder">
        {t('trellis.placeholder')}
      </p>
    )
    if (variant === 'embedded') return placeholder
    return (
      <Card className="rounded-2xl shadow-sm overflow-hidden">
        <CardHeader className="py-4">
          <h2 className="text-base font-semibold text-foreground">{t('trellis.title')}</h2>
        </CardHeader>
        <CardContent className="pb-5">{placeholder}</CardContent>
      </Card>
    )
  }

  const isOpenable = url.startsWith('http')

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url!)
      setCopied(true)
      toast({ title: t('trellis.linkCopied') })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: t('trellis.copyFailedTitle'), description: t('trellis.copyFailedDescription'), variant: 'destructive' })
    }
  }

  const body = (
    <>
      <p className="text-sm text-muted-foreground">
        {t('trellis.description')}
      </p>
      <div className="flex flex-wrap gap-2">
        {isOpenable && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            data-testid="link-open-trellis"
          >
            <ExternalLink className="w-4 h-4" />
            {t('trellis.open')}
          </a>
        )}
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
          data-testid="button-copy-trellis-link"
        >
          {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
          {copied ? t('trellis.copied') : t('trellis.copyLink')}
        </button>
      </div>
    </>
  )

  if (variant === 'embedded') return <div className="space-y-4">{body}</div>

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="py-4">
        <h2 className="text-base font-semibold text-foreground">{t('trellis.title')}</h2>
      </CardHeader>
      <CardContent className="space-y-4 pb-5">{body}</CardContent>
    </Card>
  )
}
