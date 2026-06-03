import { useLocation, Link } from 'wouter'
import { useAuth } from '@/lib/auth'
import { useTheme } from 'next-themes'
import { useState, useEffect } from 'react'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarHeader, SidebarFooter, SidebarSeparator, useSidebar,
} from '@/components/ui/sidebar'
import {
  LayoutDashboard, Kanban, Users, FileSpreadsheet, DollarSign, Building2,
  BedDouble, Boxes, KeyRound, Wind, ListFilter, TrendingUp, LogOut, Archive, Sun, Moon, Settings,
  BarChart3, ClipboardCheck, Users2, Bell, Activity, AlertTriangle, CheckSquare, ChevronDown, ChevronRight, Star, PackageSearch, Scale, PackagePlus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { canAccessView } from '@/lib/auth'

interface NavItem {
  title: string
  href: string
  // string OR array of view ids — when an array is given the user needs access
  // to at least one of them. Lets the merged Master List entry show up for
  // legacy custom-role users that only have `master-list` permission.
  view: string | string[]
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
      { title: 'Property List', href: '/property-list', view: 'property-list', icon: Building2 },
      { title: 'Linen Requirements', href: '/linen-tracker', view: 'linen-tracker', icon: BedDouble },
      { title: 'Linen Inventory', href: '/linen-inventory', view: 'linen-inventory', icon: Boxes },
      { title: 'Access Codes', href: '/access-codes', view: 'access-codes', icon: KeyRound },
      { title: 'AC Filters', href: '/ac-filters', view: 'ac-filters', icon: Wind },
      { title: 'Property Verifications', href: '/property-verifications', view: 'property-verifications', icon: ClipboardCheck },
      { title: 'Inspections', href: '/inspections', view: 'inspections', icon: Star },
      { title: 'Lost Items', href: '/lost-items', view: 'lost-items', icon: PackageSearch },
      { title: 'Incoming Shipments', href: '/incoming-shipments', view: 'incoming-shipments', icon: PackagePlus },
      { title: 'Laundry Weigh-Ins', href: '/laundry-weigh-ins', view: 'laundry-weigh-ins', icon: Scale },
      { title: 'Onboarding Queue', href: '/onboarding-queue', view: 'onboarding-queue', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Management',
    items: [
      { title: 'Tasks', href: '/tasks', view: 'tasks', icon: CheckSquare },
      { title: 'Issues', href: '/issues', view: 'issues', icon: AlertTriangle },
      { title: 'Cleaners', href: '/cleaners', view: 'cleaners', icon: Users2 },
      { title: 'Cleaner Metrics', href: '/cleaner-metrics', view: 'cleaner-metrics', icon: Users2 },
      { title: 'Alerts', href: '/alerts', view: 'alerts', icon: Bell },
    ],
  },
  {
    label: 'Admin',
    items: [
      { title: 'Master List', href: '/master-list', view: ['cost-tracking', 'master-list'], icon: ListFilter },
      { title: 'Revenue Report', href: '/revenue-report', view: 'revenue-report', icon: BarChart3 },
      { title: 'Activity', href: '/activity', view: 'activity', icon: Activity },
      // Pro Forma now hosts the Live Pro Forma (forecaster) + Per-Property tabs
      // in a single page. Either historical permission shows the entry.
      { title: 'Pro Forma', href: '/pro-forma', view: ['pro-forma', 'forecaster'], icon: TrendingUp },
      { title: 'Financial Dashboard', href: '/financial-dashboard', view: 'financial-dashboard', icon: DollarSign },
      { title: 'Previous Properties', href: '/previous-properties', view: 'previous-properties', icon: Archive },
      { title: 'North Star', href: '/north-star', view: 'north-star', icon: TrendingUp },
      { title: 'Executive Summary', href: '/report', view: 'report', icon: TrendingUp },
      { title: 'Settings', href: '/settings', view: 'settings', icon: Settings },
    ],
  },
]

const COLLAPSED_STORAGE_KEY = 'tendwell-sidebar-collapsed'

function getInitials(text: string): string {
  const cleaned = text.split('@')[0].replace(/[._-]+/g, ' ').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function loadCollapsedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

export function AppSidebar() {
  const { user, effectiveUser, logout } = useAuth()
  const [location] = useLocation()
  const { theme, setTheme } = useTheme()
  const { isMobile, setOpenMobile } = useSidebar()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => loadCollapsedState())

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed))
    } catch {}
  }, [collapsed])

  function toggleSection(label: string) {
    setCollapsed(prev => ({ ...prev, [label]: !prev[label] }))
  }

  if (!user) return null

  return (
    <Sidebar role="navigation" aria-label="Main navigation">
      {/* Brand header — single brand mark + product name. The user identity
          lives in the footer (avoids the user-label appearing alongside the
          identical footer block which previously read as a duplicated tile). */}
      <SidebarHeader className="px-4 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
            <svg aria-label="Tendwell logo" viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-primary-foreground" strokeWidth="2.2">
              <path d="M3 9l9-6 9 6v11a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" stroke="currentColor" strokeLinejoin="round"/>
              <path d="M9 22V12h6v10" stroke="currentColor" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-sidebar-foreground leading-none">Tendwell Ops</div>
            <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">Property operations</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2 relative">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter(item => {
            const ids = Array.isArray(item.view) ? item.view : [item.view]
            return ids.some(v => canAccessView(v, effectiveUser))
          })
          if (visibleItems.length === 0) return null
          const isCollapsed = !!collapsed[section.label]
          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-1 flex items-center justify-between cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => toggleSection(section.label)}
              >
                <span>{section.label}</span>
                {isCollapsed
                  ? <ChevronRight className="w-3 h-3 flex-shrink-0" />
                  : <ChevronDown className="w-3 h-3 flex-shrink-0" />
                }
              </SidebarGroupLabel>
              {!isCollapsed && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleItems.map((item) => {
                      const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href))
                      const viewKey = Array.isArray(item.view) ? item.view[0] : item.view
                      return (
                        <SidebarMenuItem key={viewKey}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            tooltip={item.title}
                            data-testid={`nav-${viewKey}`}
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
              )}
            </SidebarGroup>
          )
        })}
        <div className="sticky bottom-0 h-6 bg-gradient-to-t from-sidebar to-transparent pointer-events-none" />
      </SidebarContent>

      <SidebarFooter className="px-3 py-3 border-t border-sidebar-border space-y-1">
        {/* User identity row — distinct from the Tendwell brand mark in the
            header (avoids the "two of the same image" look the previous
            footer had when both sections rendered the same SVG). */}
        <div className="flex items-center gap-2 px-1 pb-1">
          <div
            aria-hidden="true"
            className="w-7 h-7 rounded-full bg-muted text-foreground/80 text-[11px] font-semibold flex items-center justify-center flex-shrink-0 border border-border"
          >
            {getInitials(user.label || 'U')}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-sidebar-foreground truncate" title={user.label}>
              {user.label || 'Signed in'}
            </div>
            {effectiveUser?.role && (
              <div className="text-[10px] text-muted-foreground capitalize truncate">{effectiveUser.role}</div>
            )}
          </div>
        </div>
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
