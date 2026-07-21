import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SHORTCUT_SECTIONS } from '@/hooks/useKeyboardShortcuts'
import { useLocale } from '@/lib/i18n/LocaleProvider'

interface KeyboardShortcutsProps {
  open: boolean
  onClose: () => void
}

// `SHORTCUT_SECTIONS` (hooks/useKeyboardShortcuts.ts) is plain English data
// outside this translation PR's file set. Its 3 sections and their shortcuts
// are in a fixed, stable order, so each is looked up here by position rather
// than by editing the hook — mirrors the DB-enum "slug lookup with raw-value
// fallback" pattern used elsewhere, just keyed by array index instead of a
// slug. If a section/shortcut is ever added to the hook without a matching
// key added here, the English text is used as the fallback (never blank).
const SECTION_KEYS = ['navigation', 'actions', 'global'] as const
const SHORTCUT_KEYS: string[][] = [
  ['dashboard', 'pipeline', 'clients', 'quoteSheet', 'costTracking', 'propertyList', 'linenRequirements', 'acFilters', 'masterList', 'revenueReport', 'inspections', 'settings'],
  ['newItem', 'openShortcuts', 'closeModal'],
  ['searchPalette'],
]

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  const { t } = useLocale('shortcuts')
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {SHORTCUT_SECTIONS.map((section, sectionIdx) => {
            const sectionKey = SECTION_KEYS[sectionIdx]
            const shortcutKeys = SHORTCUT_KEYS[sectionIdx] || []
            return (
              <div key={section.title}>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  {sectionKey ? t(`sections.${sectionKey}.title`, undefined, section.title) : section.title}
                </h3>
                <div className="grid grid-cols-1 gap-1">
                  {section.shortcuts.map((shortcut, shortcutIdx) => {
                    const shortcutKey = shortcutKeys[shortcutIdx]
                    const description = sectionKey && shortcutKey
                      ? t(`sections.${sectionKey}.items.${shortcutKey}`, undefined, shortcut.description)
                      : shortcut.description
                    return (
                      <div key={shortcut.description} className="flex items-center justify-between py-1">
                        <span className="text-sm">{description}</span>
                        <div className="flex items-center gap-1">
                          {shortcut.keys.map((key, i) => (
                            <span key={i}>
                              {i > 0 && <span className="text-muted-foreground text-xs mx-0.5">{t('then')}</span>}
                              <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-medium bg-muted border border-border rounded shadow-sm">
                                {key}
                              </kbd>
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
