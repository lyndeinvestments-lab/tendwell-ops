import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'

// Live Pro Forma (formerly /forecaster) — variance + historical + forecast.
// Per-Property Pro Forma — the legacy table showing per-property economics.
const ForecasterPage = lazy(() => import('@/pages/forecaster'))
const ProFormaTablePage = lazy(() => import('@/pages/pro-forma'))

type TabValue = 'live' | 'per-property'

function defaultTabFromLocation(loc: string): TabValue {
  // /forecaster lands on Live; /pro-forma lands on Per-Property by default.
  if (loc.startsWith('/forecaster')) return 'live'
  return 'per-property'
}

export default function ProFormaWrapperPage() {
  const [location] = useLocation()
  const [tab, setTab] = useState<TabValue>(() => defaultTabFromLocation(location))

  // Keep the active tab in sync if the user navigates between the two routes
  // (e.g. via the sidebar or a deep link) without remounting this component.
  useEffect(() => {
    setTab(defaultTabFromLocation(location))
  }, [location])

  return (
    <div className="h-full flex flex-col">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="h-full flex flex-col">
        <div className="px-5 pt-4">
          <TabsList>
            <TabsTrigger value="live" data-testid="tab-pro-forma-live">Live Pro Forma</TabsTrigger>
            <TabsTrigger value="per-property" data-testid="tab-pro-forma-per-property">Per-Property</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="live" className="flex-1 mt-0 data-[state=inactive]:hidden">
          <Suspense fallback={<TabFallback />}>
            <ForecasterPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="per-property" className="flex-1 mt-0 data-[state=inactive]:hidden">
          <Suspense fallback={<TabFallback />}>
            <ProFormaTablePage />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
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
