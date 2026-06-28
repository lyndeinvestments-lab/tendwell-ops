import { lazy, Suspense, useEffect, useState, createContext, useContext } from 'react'
import { useLocation } from 'wouter'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp, Building2, Users } from 'lucide-react'

// Live Pro Forma (formerly /forecaster) — variance + historical + forecast.
// Per-Property Pro Forma — the legacy table showing per-property economics.
// By Client — client rollup view ported from the retired Revenue Report.
const ForecasterPage = lazy(() => import('@/pages/forecaster'))
const ProFormaTablePage = lazy(() => import('@/pages/pro-forma'))
const ProFormaByClientPage = lazy(() => import('@/pages/pro-forma-by-client'))

type TabValue = 'live' | 'per-property' | 'by-client'

// Children inspect this context and hide their own page h1 / sub-title so the
// unified wrapper renders the single page chrome. Default false → child pages
// still render their own header when rendered standalone (e.g. tests).
export const ProFormaWrapperContext = createContext<{ inWrapper: boolean }>({ inWrapper: false })
export function useInProFormaWrapper() {
  return useContext(ProFormaWrapperContext).inWrapper
}

function defaultTabFromLocation(loc: string): TabValue {
  // /pro-forma and /forecaster land on Live (current-period actuals +
  // variance is the primary use case). /master-list keeps its Per-Property
  // landing because the consolidated Master List view lives on that tab.
  if (loc.startsWith('/pro-forma') || loc.startsWith('/forecaster')) return 'live'
  return 'per-property'
}

const TAB_META: Record<TabValue, { title: string; subtitle: string }> = {
  'live': {
    title: 'Live Pro Forma',
    subtitle: 'Actuals from completed tasks & QBO compared to estimated cost formulas — month-by-month variance and 12-month forecast.',
  },
  'per-property': {
    title: 'Per-Property Pro Forma',
    subtitle: 'Estimated monthly revenue, cost, and profit per property — with CSV import.',
  },
  'by-client': {
    title: 'Pro Forma by Client',
    subtitle: 'Client rollup: total revenue, cleaner pay, and gross margin grouped by owner, with expandable property rows.',
  },
}

export default function ProFormaWrapperPage() {
  const [location] = useLocation()
  const [tab, setTab] = useState<TabValue>(() => defaultTabFromLocation(location))

  // Keep the active tab in sync if the user navigates between the two routes
  // (e.g. via the sidebar or a deep link) without remounting this component.
  useEffect(() => {
    setTab(defaultTabFromLocation(location))
  }, [location])

  const meta = TAB_META[tab]

  return (
    <ProFormaWrapperContext.Provider value={{ inWrapper: true }}>
      <div className="md:h-full md:flex md:flex-col">
        <div className="px-5 pt-4 pb-2 border-b border-border/40 bg-background sticky top-0 z-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold text-foreground" data-testid="page-title-pro-forma">Pro Forma</h1>
              <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
            </div>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="mt-3">
            <TabsList>
              <TabsTrigger value="live" data-testid="tab-pro-forma-live" className="gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> Live Pro Forma
              </TabsTrigger>
              <TabsTrigger value="per-property" data-testid="tab-pro-forma-per-property" className="gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Per-Property
              </TabsTrigger>
              <TabsTrigger value="by-client" data-testid="tab-pro-forma-by-client" className="gap-1.5">
                <Users className="w-3.5 h-3.5" /> By Client
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <Tabs value={tab} className="flex-1 flex flex-col min-h-0">
          <TabsContent value="live" className="flex-1 mt-0 data-[state=inactive]:hidden overflow-auto">
            <Suspense fallback={<TabFallback />}>
              <ForecasterPage />
            </Suspense>
          </TabsContent>

          <TabsContent value="per-property" className="flex-1 mt-0 data-[state=inactive]:hidden overflow-auto">
            <Suspense fallback={<TabFallback />}>
              <ProFormaTablePage />
            </Suspense>
          </TabsContent>

          <TabsContent value="by-client" className="flex-1 mt-0 data-[state=inactive]:hidden overflow-auto">
            <Suspense fallback={<TabFallback />}>
              <ProFormaByClientPage />
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
