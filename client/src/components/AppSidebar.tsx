import { useLocation, Link } from 'wouter'
import { useAuth } from '@/lib/auth'
import { useTheme } from 'next-themes'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarHeader, SidebarFooter, SidebarSeparator, useSidebar,
} from '@/components/ui/sidebar'
import {
  LayoutDashboard, Kanban, Users, FileSpreadsheet, DollarSign, Building2,
  BedDouble, Boxes, KeyRound, Wind, ListFilter, TrendingUp, LogOut, Archive, Sun, Moon, Settings,
  BarChart3, ClipboardCheck, Users2, Bell, Activity, AlertTriangle, CheckSquare
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { canAccessView } from '@/lib/auth'

interface NavItem {
  title: string
  href: string
  view: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Overview',
    items: [
      { title: 'Dashboard', href: '/', view: 'dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Sales',
    items: [
      { title: 'Pipeline', href: '/pipeline', view: 'pipeline', icon: Kanban },
      { title: 'Clients', href: '/contacts', view: 'contacts', icon: Users },
      { title: 'Quote Sheet', href: '/quote-sheet', view: 'quote-sheet', icon: FileSpreadsheet },
    ],
  },
  {
    label: 'Operations',
    items: [
      { title: 'Cost Tracking', href: '/cost-tracking', view: 'cost-tracking', icon: DollarSign },
      { title: 'Property List', href: '/property-list', view: 'property-list', icon: Building2 },
      { title: 'Linen Requirements', href: '/linen-tracker', view: 'linen-tracker', icon: BedDouble },
      { title: 'Linen Inventory', href: '/linen-inventory', view: 'linen-inventory', icon: Boxes },
      { title: 'Access Codes', href: '/access-codes', view: 'access-codes', icon: KeyRound },
      { title: 'AC Filters', href: '/ac-filters', view: 'ac-filters', icon: Wind },
      { title: 'Verification', href: '/inspections', view: 'inspections', icon: ClipboardCheck },
      { title: 'Cleaners', href: '/cleaners', view: 'cleaners', icon: Users2 },
      { title: 'Issues', href: '/issues', view: 'issues', icon: AlertTriangle },
      { title: 'Cleaner Metrics', href: '/cleaner-metrics', view: 'cleaner-metrics', icon: Users2 },
    ],
  },
  {
    label: 'Management',
    items: [
      { title: 'Tasks', href: '/tasks', view: 'tasks', icon: CheckSquare },
    ],
  },
  {
    label: 'Admin',
    items: [
      { title: 'Master List', href: '/master-list', view: 'master-list', icon: ListFilter },
      { title: 'Revenue Report', href: '/revenue-report', view: 'revenue-report', icon: BarChart3 },
      { title: 'Alerts', href: '/alerts', view: 'alerts', icon: Bell },
      { title: 'Activity', href: '/activity', view: 'activity', icon: Activity },
      { title: 'Pro Forma', href: '/pro-forma', view: 'pro-forma', icon: TrendingUp },
      { title: 'Financial Dashboard', href: '/financial-dashboard', view: 'financial-dashboard', icon: DollarSign },
      { title: 'Previous Properties', href: '/previous-properties', view: 'previous-properties', icon: Archive },
      { title: 'Executive Summary', href: '/report', view: 'report', icon: TrendingUp },
      { title: 'Settings', href: '/settings', view: 'settings', icon: Settings },
    ],
  },
]

export function AppSidebar() {
  const { user, effectiveUser, logout } = useAuth()
  const [location] = useLocation()
  const { theme, setTheme } = useTheme()
  const { isMobile, setOpenMobile } = useSidebar()

  if (!user) return null

  return (
    <Sidebar role="navigation" aria-label="Main navigation">
      {/* Brand header */}
      <SidebarHeader className="px-4 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
            <svg aria-label="Tendwell logo" viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-primary-foreground" strokeWidth="2.2">
              <path d="M3 9l9-6 9 6v11a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" stroke="currentColor" strokeLinejoin="round"/>
              <path d="M9 22V12h6v10" stroke="currentColor" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-sidebar-foreground leading-none">Tendwell Ops</div>
            <div className="text-xs text-muted-foreground mt-0.5">{user.label}</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2 relative">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter(item => canAccessView(item.view, effectiveUser))
          if (visibleItems.length === 0) return null
          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-1">
                {section.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => {
                    const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href))
                    return (
                      <SidebarMenuItem key={item.view}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.title}
                          data-testid={`nav-${item.view}`}
                        >
                          <Link
                            href={item.href}
                            className="flex items-center gap-2.5 px-3 py-2"
                            onClick={() => isMobile && setOpenMobile(false)}
                          >
                            <item.icon className="w-4 h-4 flex-shrink-0" />
                            <span className="text-sm">{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
        <div className="sticky bottom-0 h-6 bg-gradient-to-t from-sidebar to-transparent pointer-events-none" />
      </SidebarContent>

      <SidebarFooter className="px-3 py-3 border-t border-sidebar-border space-y-1">
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground/60 mb-1">
          <kbd className="bg-muted border border-border rounded px-1.5 py-0.5">⌘K</kbd>
          <span>Search</span>
          <kbd className="bg-muted border border-border rounded px-1.5 py-0.5">?</kbd>
          <span>Shortcuts</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          data-testid="button-theme-toggle"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground h-8"
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span className="text-sm">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          data-testid="button-logout"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground h-8"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm">Sign out</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
