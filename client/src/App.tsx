import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AuthProvider, useAuth, canAccessView } from "@/lib/auth";
import { AppSidebar } from "@/components/AppSidebar";
import { EmulationBanner } from "@/components/EmulationBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PropertyModalProvider } from "@/hooks/use-property-modal";
import { PropertyDetailModal } from "@/components/PropertyDetailModal";
import { CommandPalette } from "@/components/CommandPalette";
import { useAlerts } from "@/pages/alerts";
import { useState, useEffect, useMemo, lazy, Suspense, ComponentType } from 'react';
import LoginPage from "@/pages/login";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Bell, HelpCircle } from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';
import { ThemeProvider } from 'next-themes';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';

// Lazy load with automatic retry on chunk fetch failure (stale deployments)
function lazyRetry(factory: () => Promise<{ default: React.ComponentType<any> }>) {
  return lazy(() =>
    factory().catch(() =>
      new Promise<{ default: React.ComponentType<any> }>(resolve =>
        setTimeout(() => resolve(factory()), 1500)
      )
    )
  )
}

const DashboardPage = lazyRetry(() => import("@/pages/dashboard"));
const PipelinePage = lazyRetry(() => import("@/pages/pipeline"));
const CostTrackingPage = lazyRetry(() => import("@/pages/cost-tracking"));
const PropertyListPage = lazyRetry(() => import("@/pages/property-list"));
const LinenTrackerPage = lazyRetry(() => import("@/pages/linen-tracker"));
const LinenInventoryPage = lazyRetry(() => import("@/pages/linen-inventory"));
const AccessCodesPage = lazyRetry(() => import("@/pages/access-codes"));
const AcFiltersPage = lazyRetry(() => import("@/pages/ac-filters"));
const QuoteSheetPage = lazyRetry(() => import("@/pages/quote-sheet"));
const MasterListPage = lazyRetry(() => import("@/pages/master-list"));
const ProFormaPage = lazyRetry(() => import("@/pages/pro-forma"));
const FinancialDashboardPage = lazyRetry(() => import("@/pages/financial-dashboard"));
const ContactsPage = lazyRetry(() => import("@/pages/contacts"))
const PreviousPropertiesPage = lazyRetry(() => import("@/pages/previous-properties"))
const SettingsPage = lazyRetry(() => import("@/pages/settings"));
const RevenueReportPage = lazyRetry(() => import("@/pages/revenue-report"));
const InspectionsPage = lazyRetry(() => import("@/pages/inspections"));
const CleanersPage = lazyRetry(() => import("@/pages/cleaners"));
const AlertsPage = lazyRetry(() => import("@/pages/alerts"));
const ActivityFeedPage = lazyRetry(() => import("@/pages/activity"));
const NotFound = lazyRetry(() => import("@/pages/not-found"));

const sidebarStyle = {
  "--sidebar-width": "220px",
  "--sidebar-width-icon": "3rem",
} as React.CSSProperties;

// Mobile detection hook
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

function AlertBellButton() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const { alerts } = useAlerts();

  const activeAlerts = useMemo(() => {
    return alerts.filter(a => a.severity === 'critical' || a.severity === 'warning');
  }, [alerts]);

  const badgeCount = activeAlerts.length;
  const previewItems = activeAlerts.slice(0, 5);

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors" title="Alerts">
            <Bell className="w-3.5 h-3.5 text-muted-foreground" />
            {badgeCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="end">
          <div className="space-y-1">
            {previewItems.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No active alerts</p>
            ) : (
              previewItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                  <span className="truncate">{item.title}</span>
                </div>
              ))
            )}
          </div>
          <button
            onClick={() => { setOpen(false); navigate('/alerts') }}
            className="w-full text-xs text-primary hover:underline text-center pt-2 border-t border-border mt-1"
          >
            View All Alerts →
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function NoAccess() {
  return (
    <div className="p-5 flex items-center justify-center h-full">
      <p className="text-muted-foreground">You don't have access to this page.</p>
    </div>
  );
}

// Route guard: checks canAccessView before rendering the page component
function GuardedRoute({ viewId, component: Component }: { viewId: string; component: ComponentType }) {
  const { effectiveUser } = useAuth();
  if (!effectiveUser || !canAccessView(viewId, effectiveUser)) {
    return <NoAccess />;
  }
  return <Component />;
}

function AppRoutes() {
  const { user, effectiveUser, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  // Redirect non-admin to their first allowed view when landing on /
  // Use effectiveUser for role check but user for settings access
  if (effectiveUser && location === "/" && effectiveUser.role !== "admin") {
    setLocation("/" + (effectiveUser.resolvedViews[0] || "linen-tracker"));
    return null;
  }

  return (
    <Suspense fallback={
      <div className="p-5 space-y-4 animate-in fade-in duration-300">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-32 rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    }>
      <Switch>
        <Route path="/">{() => <GuardedRoute viewId="dashboard" component={DashboardPage} />}</Route>
        <Route path="/dashboard">{() => <GuardedRoute viewId="dashboard" component={DashboardPage} />}</Route>
        <Route path="/pipeline">{() => <GuardedRoute viewId="pipeline" component={PipelinePage} />}</Route>
        <Route path="/contacts">{() => <GuardedRoute viewId="contacts" component={ContactsPage} />}</Route>
        <Route path="/cost-tracking">{() => <GuardedRoute viewId="cost-tracking" component={CostTrackingPage} />}</Route>
        <Route path="/property-list">{() => <GuardedRoute viewId="property-list" component={PropertyListPage} />}</Route>
        <Route path="/linen-tracker">{() => <GuardedRoute viewId="linen-tracker" component={LinenTrackerPage} />}</Route>
        <Route path="/linen-inventory">{() => <GuardedRoute viewId="linen-inventory" component={LinenInventoryPage} />}</Route>
        <Route path="/access-codes">{() => <GuardedRoute viewId="access-codes" component={AccessCodesPage} />}</Route>
        <Route path="/ac-filters">{() => <GuardedRoute viewId="ac-filters" component={AcFiltersPage} />}</Route>
        <Route path="/quote-sheet">{() => <GuardedRoute viewId="quote-sheet" component={QuoteSheetPage} />}</Route>
        <Route path="/master-list">{() => <GuardedRoute viewId="master-list" component={MasterListPage} />}</Route>
        <Route path="/pro-forma">{() => <GuardedRoute viewId="pro-forma" component={ProFormaPage} />}</Route>
        <Route path="/financial-dashboard">{() => <GuardedRoute viewId="financial-dashboard" component={FinancialDashboardPage} />}</Route>
        <Route path="/previous-properties">{() => <GuardedRoute viewId="previous-properties" component={PreviousPropertiesPage} />}</Route>
        <Route path="/settings">{() => <GuardedRoute viewId="settings" component={SettingsPage} />}</Route>
        <Route path="/revenue-report">{() => <GuardedRoute viewId="revenue-report" component={RevenueReportPage} />}</Route>
        <Route path="/inspections">{() => <GuardedRoute viewId="inspections" component={InspectionsPage} />}</Route>
        <Route path="/cleaners">{() => <GuardedRoute viewId="cleaners" component={CleanersPage} />}</Route>
        <Route path="/alerts">{() => <GuardedRoute viewId="alerts" component={AlertsPage} />}</Route>
        <Route path="/activity">{() => <GuardedRoute viewId="activity" component={ActivityFeedPage} />}</Route>
        <Route path="/no-access" component={NoAccess} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppLayout() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useKeyboardShortcuts({
    onOpenCheatSheet: () => setShortcutsOpen(true),
  });

  // Global Cmd+K / Ctrl+K handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(prev => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // While Supabase checks for an existing session, show a minimal spinner
  // rather than flashing the login page.
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user) return <LoginPage />;

  return (
    <PropertyModalProvider>
      <SidebarProvider style={sidebarStyle}>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium">
          Skip to main content
        </a>
        <div className="flex h-screen w-full overflow-hidden">
          <AppSidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <header className="flex items-center h-11 px-3 border-b border-border/60 bg-background/95 flex-shrink-0 gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" className="h-8 w-8" />
              <div className="ml-auto flex items-center gap-1">
                <div role="search">
                  <button
                    onClick={() => setCmdOpen(true)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
                    data-testid="button-command-palette"
                    aria-label="Search (⌘K)"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Search</span>
                    <kbd className="hidden sm:inline bg-muted border border-border rounded px-1 py-0.5 text-xs">⌘K</kbd>
                  </button>
                </div>
                <button
                  onClick={() => setShortcutsOpen(true)}
                  className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
                  aria-label="Keyboard shortcuts (?)"
                  title="Keyboard shortcuts"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
                <AlertBellButton />
              </div>
            </header>
            <EmulationBanner />
            <main id="main-content" className="flex-1 overflow-auto">
              <ErrorBoundary resetKey={location}>
                <AppRoutes />
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </SidebarProvider>
      <PropertyDetailModal />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </PropertyModalProvider>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <Router hook={useHashLocation}>
              <ErrorBoundary>
                <AppLayout />
              </ErrorBoundary>
            </Router>
            <Toaster />
            <Analytics />
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
