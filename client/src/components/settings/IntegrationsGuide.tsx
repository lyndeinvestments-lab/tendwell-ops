import { useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { BookOpen, ArrowRight } from 'lucide-react'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import {
  INTEGRATIONS_DOCS,
  INTEGRATIONS_DOCS_REVIEWED,
  splitInlineCode,
} from '@/lib/integrations-docs'

/** Text with `backtick` spans rendered as inline code. */
function DocText({ text }: { text: string }) {
  return (
    <>
      {splitInlineCode(text).map((p, i) =>
        p.code ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground break-words">
            {p.text}
          </code>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

/**
 * Settings → Integrations → "How the integrations work": the reference for
 * how each external system feeds Ops (content in lib/integrations-docs.ts).
 * Deep link: /settings?tab=integrations&doc=<section id> opens that section.
 */
export function IntegrationsGuide() {
  const { t } = useLocale('settingsPage')
  const [initialDoc] = useState(() => {
    const id = new URLSearchParams(window.location.search).get('doc')
    return id && INTEGRATIONS_DOCS.some(s => s.id === id) ? id : null
  })
  const [open, setOpen] = useState<string[]>(initialDoc ? [initialDoc] : [])
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!initialDoc) return
    const el = rootRef.current?.querySelector(`[data-doc-id="${initialDoc}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [initialDoc])

  const allIds = INTEGRATIONS_DOCS.map(s => s.id)
  const allOpen = open.length === allIds.length

  return (
    <div ref={rootRef} className="space-y-3" data-testid="integrations-guide">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-medium flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            {t('integrationsGuide.heading')}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">{t('integrationsGuide.description')}</p>
          <p className="text-2xs text-muted-foreground/80 mt-1">
            {t('integrationsGuide.reviewed', { date: INTEGRATIONS_DOCS_REVIEWED })}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(allOpen ? [] : allIds)}
          data-testid="button-integrations-guide-toggle-all"
        >
          {allOpen ? t('integrationsGuide.collapseAll') : t('integrationsGuide.expandAll')}
        </Button>
      </div>

      <div className="rounded-lg border border-border px-3">
        <Accordion type="multiple" value={open} onValueChange={setOpen}>
          {INTEGRATIONS_DOCS.map((s) => (
            <AccordionItem
              key={s.id}
              value={s.id}
              data-doc-id={s.id}
              className="last:border-b-0 scroll-mt-4"
              data-testid={`integrations-doc-${s.id}`}
            >
              <AccordionTrigger className="py-3 text-sm text-left hover:no-underline">
                {s.title}
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  <DocText text={s.summary} />
                </p>
                {s.blocks.map((b) => (
                  <div key={b.heading} className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <DocText text={b.heading} />
                    </h3>
                    <ul className="list-disc pl-5 space-y-1 text-sm leading-relaxed">
                      {b.items.map((item, i) => (
                        <li key={i}>
                          <DocText text={item} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {s.links && s.links.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-2xs text-muted-foreground">{t('integrationsGuide.openPage')}</span>
                    {s.links.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-muted"
                      >
                        {l.label}
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  )
}
