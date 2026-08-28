import { lazy, Suspense, useEffect, useState, createContext, useContext } from 'react'
import { useLocation } from 'wouter'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp, Building2, Users, Landmark, Tags } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'

// P&L — the QuickBooks Profit & Loss mirrored monthly (qbo_pl_months).
// Per-Property — real monthly profitability from property_month_financials.
// Pricing — the legacy per-property rate/estimate table (break-even, what-if).
// By Client — client rollup view ported from the retired Revenue Report.
// Forecast (formerly Live Pro Forma) — variance + historical + forecast.
const PlStatementPage = lazy(() => import('@/pages/pl-statement'))
const PropertyProfitabilityPage = lazy(() => import('@/pages/property-profitability'))
const ForecasterPage = lazy(() => import('@/pages/forecaster'))
const ProFormaTablePage = lazy(() => import('@/pages/pro-forma'))
const ProFormaByClientPage = lazy(() => import('@/pages/pro-forma-by-client'))

type TabValue = 'pl' | 'per-property' | 'pricing' | 'by-client' | 'live'

// Children inspect this context and hide their own page h1 / sub-title so the
// unified wrapper renders the single page chrome. Default false → child pages
// still render their own header when rendered standalone (e.g. tests).
export const ProFormaWrapperContext = createContext<{ inWrapper: boolean }>({ inWrapper: false })
export function useInProFormaWrapper() {
  return useContext(ProFormaWrapperContext).inWrapper
}

function defaultTabFromLocation(loc: string): TabValue {
  // /pro-forma lands on the P&L (the QuickBooks mirror is now the primary
  // view); /forecaster deep-links keep landing on the Forecast tab.
  if (loc.startsWith('/forecaster')) return 'live'
  if (loc.startsWith('/pro-forma')) return 'pl'
  return 'per-property'
}

export default function ProFormaWrapperPage() {
  const { t } = useLocale('financials')
  const [location] = useLocation()
  const [tab, setTab] = useState<TabValue>(() => defaultTabFromLocation(location))

  // Keep the active tab in sync if the user navigates between the two routes
  // (e.g. via the sidebar or a deep link) without remounting this component.
  useEffect(() => {
    setTab(defaultTabFromLocation(location))
  }, [location])

  const TAB_META: Record<TabValue, { title: string; subtitle: string }> = {
    'pl': {
      title: t('wrapper.meta.pl.title'),
      subtitle: t('wrapper.meta.pl.subtitle'),
    },
    'per-property': {
      title: t('wrapper.meta.perProperty.title'),
      subtitle: t('wrapper.meta.perProperty.subtitle'),
    },
    'pricing': {
      title: t('wrapper.meta.pricing.title'),
      subtitle: t('wrapper.meta.pricing.subtitle'),
    },
    'by-client': {
      title: t('wrapper.meta.byClient.title'),
      subtitle: t('wrapper.meta.byClient.subtitle'),
    },
    'live': {
      title: t('wrapper.meta.live.title'),
      subtitle: t('wrapper.meta.live.subtitle'),
    },
  }

  const meta = TAB_META[tab]

  return (
    <ProFormaWrapperContext.Provider value={{ inWrapper: true }}>
      <div className="md:h-full md:flex md:flex-col">
        <div className="px-5 pt-4 pb-2 border-b border-border/40 bg-background sticky top-0 z-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold text-foreground" data-testid="page-title-pro-forma">{t('wrapper.pageTitle')}</h1>
              <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
            </div>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="mt-3">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="pl" data-testid="tab-pro-forma-pl" className="gap-1.5">
                <Landmark className="w-3.5 h-3.5" /> {t('wrapper.tabs.pl')}
              </TabsTrigger>
              <TabsTrigger value="per-property" data-testid="tab-pro-forma-per-property" className="gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> {t('wrapper.tabs.perProperty')}
              </TabsTrigger>
              <TabsTrigger value="pricing" data-testid="tab-pro-forma-pricing" className="gap-1.5">
                <Tags className="w-3.5 h-3.5" /> {t('wrapper.tabs.pricing')}
              </TabsTrigger>
              <TabsTrigger value="by-client" data-testid="tab-pro-forma-by-client" className="gap-1.5">
                <Users className="w-3.5 h-3.5" /> {t('wrapper.tabs.byClient')}
              </TabsTrigger>
              <TabsTrigger value="live" data-testid="tab-pro-forma-live" className="gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> {t('wrapper.tabs.live')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <Tabs value={tab} className="flex-1 flex flex-col min-h-0">
          <TabsContent value="pl" className="flex-1 mt-0 data-[state=inactive]:hidden overflow-auto">
            <Suspense fallback={<TabFallback />}>
              <PlStatementPage />
            </Suspense>
          </TabsContent>

          <TabsContent value="per-property" className="flex-1 mt-0 data-[state=inactive]:hidden overflow-auto">
            <Suspense fallback={<TabFallback />}>
              <PropertyProfitabilityPage />
            </Suspense>
          </TabsContent>

          <TabsContent value="pricing" className="flex-1 mt-0 data-[state=inactive]:hidden overflow-auto">
            <Suspense fallback={<TabFallback />}>
              <ProFormaTablePage />
            </Suspense>
          </TabsContent>

          <TabsContent value="by-client" className="flex-1 mt-0 data-[state=inactive]:hidden overflow-auto">
            <Suspense fallback={<TabFallback />}>
              <ProFormaByClientPage />
            </Suspense>
          </TabsContent>

          <TabsContent value="live" className="flex-1 mt-0 data-[state=inactive]:hidden overflow-auto">
            <Suspense fallback={<TabFallback />}>
              <ForecasterPage />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </ProFormaWrapperContext.Provider>
  )
}

function TabFallback() {
  return (
    <div className="p-5 space-y-4">
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
