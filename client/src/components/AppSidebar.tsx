import { useLocation, Link } from 'wouter'
import { useAuth } from '@/lib/auth'
import { roleBadgeClasses } from '@/lib/role-colors'
import { useTheme } from 'next-themes'
import { useState, useEffect } from 'react'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarHeader, SidebarFooter, SidebarSeparator, useSidebar,
} from '@/components/ui/sidebar'
import {
  LayoutDashboard, Kanban, Users, FileSpreadsheet, DollarSign, Building2,
  BedDouble, Boxes, KeyRound, Wind, ListFilter, TrendingUp, LogOut, Sun, Moon, Settings,
  ClipboardCheck, Users2, Bell, Activity, AlertTriangle, CheckSquare, ChevronDown, ChevronRight, Star, PackageSearch, Scale, PackagePlus, Plug, Eye, MessageSquareText, ListChecks
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
      { title: 'Trellis Tasks', href: '/trellis-tasks', view: 'trellis-tasks', icon: ListChecks },
      { title: 'Reviews', href: '/reviews', view: 'reviews', icon: MessageSquareText },
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
    label: 'Financials',
    items: [
      { title: 'Overview', href: '/financial-dashboard', view: 'financial-dashboard', icon: DollarSign },
      // Pro Forma now hosts the Live Pro Forma (forecaster) + Per-Property tabs
      // in a single page. Either historical permission shows the entry.
      { title: 'Pro Forma', href: '/pro-forma', view: ['pro-forma', 'forecaster'], icon: TrendingUp },
      { title: 'Master List', href: '/master-list', view: ['cost-tracking', 'master-list'], icon: ListFilter },
      { title: 'North Star', href: '/north-star', view: 'north-star', icon: TrendingUp },
    ],
  },
  {
    label: 'Admin',
    items: [
      { title: 'Activity', href: '/activity', view: 'activity', icon: Activity },
      { title: 'API Sync', href: '/api-sync', view: 'trellis-sync', icon: Plug },
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
  const { user, effectiveUser, logout, canActAsOwner, setActingAsOwner } = useAuth()
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
      <SidebarHeader className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex flex-col items-center gap-1.5">
          {/* Brand lockup — black on light, white on dark (next-themes adds `.dark` to <html>) */}
          <img
            src="/brand/tendwell-logo-black.png"
            alt="Tendwell Cleaning Co."
            className="w-44 max-w-full h-auto block dark:hidden"
          />
          <img
            src="/brand/tendwell-logo-white.png"
            alt="Tendwell Cleaning Co."
            className="w-44 max-w-full h-auto hidden dark:block"
          />
          <div className="text-2xs text-muted-foreground uppercase tracking-[0.2em]">Operations</div>
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
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${roleBadgeClasses(effectiveUser.role)}`}>
                {effectiveUser.role}
              </span>
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
        {canActAsOwner && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActingAsOwner(true)}
            data-testid="button-switch-owner-view"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground h-8"
          >
            <Eye className="w-4 h-4" />
            <span className="text-sm">Owner view</span>
          </Button>
        )}
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
