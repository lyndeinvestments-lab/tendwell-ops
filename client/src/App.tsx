import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppSidebar } from "@/components/AppSidebar";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { useState, useEffect, lazy, Suspense } from 'react';
import LoginPage from "@/pages/login";
import { Skeleton } from "@/components/ui/skeleton";
import { Analytics } from '@vercel/analytics/react';

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
const PreviousPropertiesPage = lazy(() => import("@/pages/previous-properties"))
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
        <Route path="/pipeline" component={PipelinePage} />
        <Route path="/cost-tracking" component={CostTrackingPage} />
        <Route path="/property-list" component={PropertyListPage} />
        <Route path="/linen-tracker" component={LinenTrackerPage} />
        <Route path="/access-codes" component={AccessCodesPage} />
        <Route path="/ac-filters" component={AcFiltersPage} />
        <Route path="/quote-sheet" component={QuoteSheetPage} />
        <Route path="/master-list" component={MasterListPage} />
        <Route path="/pro-forma" component={ProFormaPage} />
        <Route path="/previous-properties" component={PreviousPropertiesPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppLayout() {
  const { user } = useAuth();

  if (!user) return <LoginPage />;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center h-11 px-3 border-b border-border/60 bg-background/95 flex-shrink-0">
            <SidebarTrigger data-testid="button-sidebar-toggle" className="h-8 w-8" />
          </header>
          <main className="flex-1 overflow-auto">
            <AppRoutes />
          </main>
          <PerplexityAttribution />
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
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
  );
}

export default App;
