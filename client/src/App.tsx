import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppSidebar } from "@/components/AppSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PropertyModalProvider } from "@/hooks/use-property-modal";
import { PropertyDetailModal } from "@/components/PropertyDetailModal";
import { CommandPalette } from "@/components/CommandPalette";
import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import LoginPage from "@/pages/login";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Bell } from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';
import { ThemeProvider } from 'next-themes';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';

const DashboardPage = lazy(() => import("@/pages/dashboard"));
const PipelinePage = lazy(() => import("@/pages/pipeline"));
const CostTrackingPage = lazy(() => import("@/pages/cost-tracking"));
const PropertyListPage = lazy(() => import("@/pages/property-list"));
const LinenTrackerPage = lazy(() => import("@/pages/linen-tracker"));
const AccessCodesPage = lazy(() => import("@/pages/access-codes"));
const AcFiltersPage = lazy(() => import("@/pages/ac-filters"));
const QuoteSheetPage = lazy(() => import("@/pages/quote-sheet"));
const MasterListPage = lazy(() => import("@/pages/master-list"));
const ProFormaPage = lazy(() => import("@/pages/pro-forma"));
const ContactsPage = lazy(() => import("@/pages/contacts"))
const PreviousPropertiesPage = lazy(() => import("@/pages/previous-properties"))
const SettingsPage = lazy(() => import("@/pages/settings"));
const RevenueReportPage = lazy(() => import("@/pages/revenue-report"));
const InspectionsPage = lazy(() => import("@/pages/inspections"));
const CleanersPage = lazy(() => import("@/pages/cleaners"));
const AlertsPage = lazy(() => import("@/pages/alerts"));
const NotFound = lazy(() => import("@/pages/not-found"));

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
  // Lazy import alerts hook to avoid circular deps
  const { data: alertData } = useQuery({
    queryKey: ['/supabase/alerts-properties-bell'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, profit_percentage, bedrooms, address, next_filter_due, pipeline_stages!properties_stage_id_fkey(name)')
      if (error) throw error
      return data || []
    },
    staleTime: 30_000,
  });

  const critWarning = useMemo(() => {
    if (!alertData) return { count: 0, items: [] as { title: string; severity: string }[] };
    const items: { title: string; severity: string }[] = [];
    for (const p of alertData) {
      const stage = (p.pipeline_stages as any)?.name;
      if (stage === 'Offboarded' || stage === 'Lead' || stage === 'Quote') continue;
      if ((p.profit_percentage || 0) < 0) items.push({ title: `Negative Profit: ${p.name}`, severity: 'critical' });
      if (!p.address || !p.bedrooms) items.push({ title: `Missing Data: ${p.name}`, severity: 'critical' });
      const today = new Date().toISOString().split('T')[0];
      if (p.next_filter_due && p.next_filter_due < today) items.push({ title: `AC Overdue: ${p.name}`, severity: 'warning' });
      if ((p.profit_percentage || 0) >= 0 && (p.profit_percentage || 0) < 10 && stage === 'Active') items.push({ title: `Low Profit: ${p.name}`, severity: 'warning' });
    }
    return { count: items.length, items: items.slice(0, 5) };
  }, [alertData]);

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors" title="Alerts">
            <Bell className="w-3.5 h-3.5 text-muted-foreground" />
            {critWarning.count > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {critWarning.count > 99 ? '99+' : critWarning.count}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="end">
          <div className="space-y-1">
            {critWarning.items.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No active alerts</p>
            ) : (
              critWarning.items.map((item, i) => (
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

function AppRoutes() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  // Redirect non-admin to their first allowed view when landing on /
  if (user && location === "/" && user.role !== "admin") {
    setLocation("/" + (user.allowedViews[0] || "linen-tracker"));
    return null;
  }

  return (
    <Suspense fallback={<div className="p-5 space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-64" /></div>}>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/pipeline" component={PipelinePage} />
        <Route path="/contacts" component={ContactsPage} />
        <Route path="/cost-tracking" component={CostTrackingPage} />
        <Route path="/property-list" component={PropertyListPage} />
        <Route path="/linen-tracker" component={LinenTrackerPage} />
        <Route path="/access-codes" component={AccessCodesPage} />
        <Route path="/ac-filters" component={AcFiltersPage} />
        <Route path="/quote-sheet" component={QuoteSheetPage} />
        <Route path="/master-list" component={MasterListPage} />
        <Route path="/pro-forma" component={ProFormaPage} />
        <Route path="/previous-properties" component={PreviousPropertiesPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/revenue-report" component={RevenueReportPage} />
        <Route path="/inspections" component={InspectionsPage} />
        <Route path="/cleaners" component={CleanersPage} />
        <Route path="/alerts" component={AlertsPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppLayout() {
  const { user } = useAuth();
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

  if (!user) return <LoginPage />;

  return (
    <PropertyModalProvider>
      <SidebarProvider style={sidebarStyle}>
        <div className="flex h-screen w-full overflow-hidden">
          <AppSidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <header className="flex items-center h-11 px-3 border-b border-border/60 bg-background/95 flex-shrink-0 gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" className="h-8 w-8" />
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setCmdOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
                  data-testid="button-command-palette"
                  title="Search (⌘K)"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Search</span>
                  <kbd className="hidden sm:inline bg-muted border border-border rounded px-1 py-0.5 text-xs">⌘K</kbd>
                </button>
                <AlertBellButton />
              </div>
            </header>
            <main className="flex-1 overflow-auto">
              <ErrorBoundary>
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
              <AppLayout />
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
