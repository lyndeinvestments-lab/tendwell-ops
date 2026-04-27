import { ReactNode } from 'react'

/**
 * Standard page header used at the top of full-page views. Provides a
 * consistent title / subtitle / actions row so headers across the app
 * (Linen Requirements, Tasks, Alerts, Settings, …) line up the same way.
 *
 * Pages that already render their own header inline don't need to migrate
 * immediately — this is purely opt-in. Existing pages that use the same
 * Tailwind class skeleton continue to look identical to a PageHeader.
 */
export interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  /** Optional row rendered under the title/subtitle (e.g. filter pills). */
  beneath?: ReactNode
  /** Make the header sticky to the top of the scroll container. */
  sticky?: boolean
  className?: string
  testId?: string
}

export function PageHeader({ title, subtitle, actions, beneath, sticky, className, testId }: PageHeaderProps) {
  return (
    <header
      data-testid={testId}
      className={[
        'flex flex-col gap-2',
        sticky ? 'sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/60 px-5 py-3 -mx-5 -mt-5 mb-2' : '',
        className || '',
      ].filter(Boolean).join(' ')}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground truncate">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {beneath}
    </header>
  )
}
