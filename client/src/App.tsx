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
import { useState } from 'react';
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import PipelinePage from "@/pages/pipeline";
import CostTrackingPage from "@/pages/cost-tracking";
import PropertyListPage from "@/pages/property-list";
import LinenTrackerPage from "@/pages/linen-tracker";
import AccessCodesPage from "@/pages/access-codes";
import AcFiltersPage from "@/pages/ac-filters";
import QuoteSheetPage from "@/pages/quote-sheet";
import MasterListPage from "@/pages/master-list";
import ProFormaPage from "@/pages/pro-forma";
import NotFound from "@/pages/not-found";

const sidebarStyle = {
  "--sidebar-width": "220px",
  "--sidebar-width-icon": "3rem",
} as React.CSSProperties;

// Mobile detection hook
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useState(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  });
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
      <Route component={NotFound} />
    </Switch>
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
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
