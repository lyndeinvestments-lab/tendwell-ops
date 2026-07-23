import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logActivity } from '@/lib/supabase'
import {
  useAuth, type UserRole, type AuthUser, type RolePermissionsStore, type ViewId,
  type PagePermission,
  VIEW_DEFINITIONS, ROLE_VIEWS, buildDefaultRolePermissions, sanitizeRolePermissions, sanitizeViews,
  derivePermissionsFromViews, sanitizePagePermissions,
} from '@/lib/auth'
import { useAppSettings } from '@/hooks/use-app-settings'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { StatusTone, TONE_SOFT } from '@/lib/status-colors'
import { roleBadgeClasses } from '@/lib/role-colors'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { notifyOwner } from '@/lib/notify'
import { DEFAULT_NOTIF_PREFS, NOTIF_EVENT_DEFS } from '@/lib/notif-prefs'
import { usePageTitle } from '@/hooks/use-page-title'
import { useLocation, Link } from 'wouter'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  UserPlus, Trash2, Shield, Users, DollarSign, TrendingUp, Wind, CalendarDays,
  ClipboardCheck, Plus, Pencil, Check, X, Eye, SlidersHorizontal, RotateCcw,
  Lock, Plug, MapPin, Database, Receipt, KeyRound, Bell as BellIcon,
  Home, Search, Mail, Loader2, ExternalLink, FileText, Download, Send, XCircle,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  provisionOwnerLogin, deleteOwnerLogin, adminChangeOwnerEmail,
  OWNER_FIELD_DEFS, defaultOwnerPermissions, normalizeOwnerPermissions,
  type OwnerFieldKey, type OwnerPermissions,
} from '@/lib/owners'
import { getGoogleMapsRuntimeStatus, type GoogleMapsRuntimeStatus } from '@/components/AddressAutocomplete'
import { SignaturePad } from '@/components/SignaturePad'
import { downloadAgreementPdf } from '@/lib/agreements'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { slugify } from '@/lib/issues'

// ─── Role Options (system roles for the invite dropdown) ─────────────────────

const SYSTEM_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'operations', label: 'Operations' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'viewer', label: 'Viewer' },
]

// Display-only lookup for `app_users.role` (+ custom role slugs) — the DB
// value stays canonical English; unknown/custom roles fall back to the
// label passed in (system default or an admin-entered custom role name).
function roleDisplayLabel(t: (key: string, vars?: Record<string, string | number>, fallback?: string) => string, role: string, fallback?: string): string {
  return t(`roleLabel.${slugify(role)}`, undefined, fallback ?? role)
}

function RoleBadge({ role }: { role: string }) {
  const { t } = useLocale('settingsPage')
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium capitalize whitespace-nowrap ${roleBadgeClasses(role)}`}>
      {roleDisplayLabel(t, role)}
    </span>
  )
}

// ─── Hook: load role permissions from app_settings ───────────────────────────

function useRolePermissions() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['/supabase/role-permissions'],
    // Role permissions only change when an admin edits this very page —
    // skip redundant fetches for 10 min. Mutations call invalidateQueries.
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: row } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'role_permissions')
        .single()
      if (!row?.value) return buildDefaultRolePermissions()
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
      return sanitizeRolePermissions(parsed)
    },
  })

  const { mutateAsync: savePermissions } = useMutation({
    mutationFn: async (perms: RolePermissionsStore) => {
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key: 'role_permissions', value: JSON.stringify(perms) })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/role-permissions'] })
    },
  })

  return { rolePermissions: data ?? buildDefaultRolePermissions(), isLoading, savePermissions }
}

// ─── Permissions Section (Role Matrix) ───────────────────────────────────────

function PermissionsSection() {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const { user } = useAuth()
  const { rolePermissions, isLoading, savePermissions } = useRolePermissions()
  const [localPerms, setLocalPerms] = useState<RolePermissionsStore | null>(null)
  const [newRoleOpen, setNewRoleOpen] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null)

  // Use local state if editing, otherwise DB state
  const perms = localPerms ?? rolePermissions

  // Keep local in sync when DB loads
  const effectivePerms = useMemo(() => localPerms ?? rolePermissions, [localPerms, rolePermissions])

  const roleIds = useMemo(() => Object.keys(effectivePerms), [effectivePerms])

  // Group views by group
  const viewGroups = useMemo(() => {
    const groups: { group: string; views: typeof VIEW_DEFINITIONS[number][] }[] = []
    const seen = new Set<string>()
    for (const v of VIEW_DEFINITIONS) {
      if (v.id === 'settings') continue // settings is always admin-only
      if (!seen.has(v.group)) {
        seen.add(v.group)
        groups.push({ group: v.group, views: [] })
      }
      groups.find(g => g.group === v.group)!.views.push(v)
    }
    return groups
  }, [])

  function togglePermission(roleId: string, viewId: ViewId, field: 'view' | 'edit', checked: boolean) {
    const current = { ...effectivePerms }
    const role = { ...current[roleId] }
    const perms = { ...(role.permissions ?? {}) }
    const existing = perms[viewId] ?? { view: false, edit: false }
    const next = { ...existing, [field]: checked }
    // Enforce: no edit without view
    if (field === 'view' && !checked) next.edit = false
    // Enforce: edit implies view
    if (field === 'edit' && checked) next.view = true
    perms[viewId] = next
    role.permissions = perms
    const validIds = new Set<string>(VIEW_DEFINITIONS.map(v => v.id))
    role.views = Object.entries(perms)
      .filter(([id, p]) => p.view && validIds.has(id))
      .map(([id]) => id) as ViewId[]
    current[roleId] = role
    setLocalPerms(current)
  }

  async function handleSaveMatrix() {
    if (!localPerms) return
    try {
      await savePermissions(localPerms)
      logActivity({
        entity_type: 'other',
        action: 'update',
        entity_name: 'role_permissions',
        changed_by: user?.label ?? null,
      })
      setLocalPerms(null)
      toast({ title: t('toasts.permissionsSaved') })
    } catch (e: any) {
      toast({ title: t('toasts.permissionsSaveFailed'), description: e?.message, variant: 'destructive' })
    }
  }

  function handleResetRole(roleId: string) {
    const current = { ...effectivePerms }
    const defaults = ROLE_VIEWS[roleId]
    if (defaults) {
      const views = sanitizeViews(defaults)
      current[roleId] = { ...current[roleId], views, permissions: derivePermissionsFromViews(views, roleId === 'admin') }
    } else {
      // Custom role: reset views to empty, keep the role entry
      current[roleId] = { ...current[roleId], views: [], permissions: derivePermissionsFromViews([], false) }
    }
    setLocalPerms(current)
  }

  // ── New custom role ──
  const newRoleSlug = useMemo(
    () => newRoleName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    [newRoleName]
  )
  const slugCollision = newRoleSlug && effectivePerms[newRoleSlug]

  async function handleCreateRole() {
    if (!newRoleSlug || slugCollision) return
    const next = { ...effectivePerms }
    next[newRoleSlug] = { label: newRoleName.trim(), views: [], permissions: derivePermissionsFromViews([], false) }
    try {
      await savePermissions(next)
      logActivity({
        entity_type: 'other',
        action: 'create',
        entity_name: 'custom_role',
        field_name: newRoleSlug,
        changed_by: user?.label ?? null,
      })
      setLocalPerms(null) // DB is now source of truth
      setNewRoleName('')
      setNewRoleOpen(false)
      toast({ title: t('toasts.roleCreated', { name: newRoleName.trim() }), description: t('toasts.roleCreatedDesc') })
    } catch (e: any) {
      toast({ title: t('toasts.roleCreateFailed'), description: e?.message, variant: 'destructive' })
    }
  }

  // ── Delete custom role ──
  const [deleteBlockedUsers, setDeleteBlockedUsers] = useState<any[]>([])

  async function handleDeleteRoleCheck(roleId: string) {
    const { data } = await supabase
      .from('app_users')
      .select('id, label')
      .eq('role', roleId)
    if (data && data.length > 0) {
      setDeleteBlockedUsers(data)
      setDeleteRoleId(roleId)
    } else {
      setDeleteBlockedUsers([])
      setDeleteRoleId(roleId)
    }
  }

  function handleDeleteRoleConfirm() {
    if (!deleteRoleId) return
    const current = { ...effectivePerms }
    delete current[deleteRoleId]
    setLocalPerms(current)
    logActivity({
      entity_type: 'other',
      action: 'delete',
      entity_name: 'custom_role',
      field_name: deleteRoleId,
      changed_by: user?.label ?? null,
    })
    setDeleteRoleId(null)
    toast({ title: t('toasts.roleDeleted'), description: t('toasts.roleDeletedDesc') })
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-medium flex items-center gap-2">
              <Lock className="w-4 h-4" />
              {t('permissions.heading')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('permissions.description')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setNewRoleOpen(true)}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('permissions.newRole')}
            </Button>
            {localPerms && (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleSaveMatrix}
              >
                <Check className="w-3.5 h-3.5" />
                {t('permissions.saveChanges')}
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/80 border-b border-border">
              <tr>
                <th rowSpan={2} className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[160px] align-bottom">{t('permissions.colPage')}</th>
                {roleIds.map(roleId => (
                  <th key={roleId} colSpan={2} className="text-center font-medium text-muted-foreground uppercase tracking-wide py-1 px-1 min-w-[80px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{effectivePerms[roleId]?.label || roleDisplayLabel(t, roleId)}</span>
                      <div className="flex gap-0.5">
                        {roleId !== 'admin' && (
                          <button
                            onClick={() => handleResetRole(roleId)}
                            className="text-muted-foreground/60 hover:text-foreground"
                            title={t('permissions.resetTitle')}
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                        {!effectivePerms[roleId]?.system && (
                          <button
                            onClick={() => handleDeleteRoleCheck(roleId)}
                            className="text-muted-foreground/60 hover:text-destructive"
                            title={t('permissions.deleteTitle')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border/50">
                {roleIds.map(roleId => (
                  <React.Fragment key={`sub-${roleId}`}>
                    <th className="text-center text-2xs text-muted-foreground/70 py-0.5 px-1 w-10">{t('permissions.colView')}</th>
                    <th className="text-center text-2xs text-muted-foreground/70 py-0.5 px-1 w-10">{t('permissions.colEdit')}</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {viewGroups.map(({ group, views }) => (
                <React.Fragment key={`group-${group}`}>
                  <tr>
                    <td colSpan={roleIds.length * 2 + 1} className="bg-muted/40 py-1.5 px-3 font-medium text-muted-foreground uppercase tracking-wider text-2xs">
                      {group}
                    </td>
                  </tr>
                  {views.map(view => (
                    <tr key={view.id} className="border-b border-border/30 hover:bg-muted/10">
                      <td className="py-1.5 px-3 text-sm">{view.label}</td>
                      {roleIds.map(roleId => {
                        const isAdmin = roleId === 'admin'
                        const perm = effectivePerms[roleId]?.permissions?.[view.id] ?? { view: false, edit: false }
                        const viewChecked = isAdmin || perm.view
                        const editChecked = isAdmin || perm.edit
                        return (
                          <React.Fragment key={`${roleId}-${view.id}`}>
                            <td className="py-1.5 px-1 text-center">
                              <Checkbox
                                checked={viewChecked}
                                disabled={isAdmin}
                                onCheckedChange={(v) => togglePermission(roleId, view.id as ViewId, 'view', !!v)}
                                className={isAdmin ? 'opacity-50' : ''}
                              />
                            </td>
                            <td className="py-1.5 px-1 text-center">
                              <Checkbox
                                checked={editChecked}
                                disabled={isAdmin || !viewChecked}
                                onCheckedChange={(v) => togglePermission(roleId, view.id as ViewId, 'edit', !!v)}
                                className={isAdmin ? 'opacity-50' : !viewChecked ? 'opacity-30' : ''}
                              />
                            </td>
                          </React.Fragment>
                        )
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Role Dialog */}
      <Dialog open={newRoleOpen} onOpenChange={setNewRoleOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('permissions.createRoleTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('permissions.roleNameLabel')}</label>
              <Input
                value={newRoleName}
                onChange={e => setNewRoleName(e.target.value)}
                placeholder={t('permissions.roleNamePlaceholder')}
                className="mt-1"
                autoFocus
              />
            </div>
            {newRoleSlug && (
              <div className="text-xs text-muted-foreground">
                {t('permissions.slugLabel')} <code className="bg-muted px-1 rounded">{newRoleSlug}</code>
                {slugCollision && (
                  <span className="text-destructive ml-2">{t('permissions.slugCollision')}</span>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t('permissions.createRoleHint')}
            </p>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              disabled={!newRoleName.trim() || !newRoleSlug || !!slugCollision}
              onClick={handleCreateRole}
            >
              {t('permissions.createRoleButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Role Dialog */}
      <Dialog open={!!deleteRoleId} onOpenChange={() => setDeleteRoleId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('permissions.deleteRoleTitle')}</DialogTitle>
          </DialogHeader>
          {deleteBlockedUsers.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                {t('permissions.cannotDelete', { count: deleteBlockedUsers.length, plural: deleteBlockedUsers.length !== 1 ? 's' : '' })}
              </p>
              <ul className="text-sm list-disc pl-5 space-y-0.5">
                {deleteBlockedUsers.map((u: any) => (
                  <li key={u.id}>{u.label}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('permissions.reassignHint')}</p>
            </div>
          ) : (
            <p className="text-sm">
              {t('permissions.confirmDelete', { role: deleteRoleId ?? '' })}
            </p>
          )}
          <DialogFooter>
            {deleteBlockedUsers.length === 0 ? (
              <Button variant="destructive" size="sm" onClick={handleDeleteRoleConfirm}>
                {t('permissions.deleteRoleButton')}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setDeleteRoleId(null)}>
                {t('permissions.close')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── App Settings Section ────────────────────────────────────────────────────

function AppSettingsSection() {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const { get, saveSetting } = useAppSettings()

  // Field labels are looked up from `config.fields.<key>` (falling back to
  // the English default here) — the `key` itself is the `app_settings.key`
  // and stays canonical English.
  const fieldLabel = (key: string, fallback: string) => t(`config.fields.${key}`, undefined, fallback)

  // NOTE: only settings that are actually read by the app are surfaced here.
  // (default_cleaner_pay, followup_reminder_days, stale_lead_days,
  // inspection_interval_days were editable but nothing read them — removed to
  // avoid implying they do something.)
  const ALL_FIELDS = [
    { key: 'cost_inspection', label: 'Inspection Cost ($)', placeholder: '15', section: 'cost' },
    { key: 'cost_trash', label: 'Trash Cost ($)', placeholder: '5', section: 'cost' },
    { key: 'profit_tier_high', label: 'High Tier Threshold (%)', placeholder: '18', section: 'profit' },
    { key: 'profit_tier_mid', label: 'Mid Tier Threshold (%)', placeholder: '14', section: 'profit' },
    { key: 'break_even_target_margin', label: 'Break-Even Target Margin (decimal, e.g. 0.20 = 20%)', placeholder: '0.20', section: 'profit' },
    { key: 'ac_filter_interval', label: 'Replacement Interval (days)', placeholder: '90', section: 'ac' },
    { key: 'amenity_bathroom', label: 'Bathroom Amenities ($ per bathroom)', placeholder: '1.05', section: 'amenity' },
    { key: 'amenity_toilet_paper', label: 'Toilet Paper ($ per bathroom)', placeholder: '0.78', section: 'amenity' },
    { key: 'amenity_kitchen', label: 'Kitchen Supplies ($ per kitchen)', placeholder: '2.05', section: 'amenity' },
    { key: 'amenity_trash_bag', label: 'Trash Bags ($ per bed)', placeholder: '0.06', section: 'amenity' },
    { key: 'amenity_hot_tub', label: 'Hot Tub Chemicals ($ per property)', placeholder: '0.88', section: 'amenity' },
    { key: 'auto_code', label: 'Smart-Lock Auto Code (shared)', placeholder: 'e.g. 1656', section: 'access', type: 'text' },
  ]

  const [localValues, setLocalValues] = useState<Record<string, string>>(
    () => Object.fromEntries(ALL_FIELDS.map(f => [f.key, get(f.key, f.placeholder)]))
  )

  function handleBlurSave(key: string, value: string) {
    saveSetting({ key, value })
    const f = ALL_FIELDS.find(f => f.key === key)
    toast({ title: t('toasts.settingSaved'), description: t('toasts.settingSavedDesc', { label: f ? fieldLabel(f.key, f.label) : key }) })
  }

  function handleSaveAll() {
    ALL_FIELDS.forEach(f => saveSetting({ key: f.key, value: localValues[f.key] ?? f.placeholder }))
    toast({ title: t('toasts.allSettingsSaved') })
  }

  const COST_FIELDS = ALL_FIELDS.filter(f => f.section === 'cost')
  const AMENITY_FIELDS = ALL_FIELDS.filter(f => f.section === 'amenity')
  const PROFIT_FIELDS = ALL_FIELDS.filter(f => f.section === 'profit')
  const AC_FIELDS = ALL_FIELDS.filter(f => f.section === 'ac')
  const ACCESS_FIELDS = ALL_FIELDS.filter(f => f.section === 'access')

  function FieldRow({ f }: { f: typeof ALL_FIELDS[number] }) {
    return (
      <div key={f.key} className="grid grid-cols-[180px_1fr] items-center gap-2">
        <label className="text-xs text-muted-foreground">{fieldLabel(f.key, f.label)}</label>
        <Input
          type={(f as any).type === 'text' ? 'text' : 'number'}
          value={localValues[f.key] ?? f.placeholder}
          placeholder={f.placeholder}
          className="h-7 text-xs"
          data-testid={`input-setting-${f.key}`}
          onChange={e => setLocalValues(prev => ({ ...prev, [f.key]: e.target.value }))}
          onBlur={e => handleBlurSave(f.key, e.target.value)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <DollarSign className="w-4 h-4" />
          {t('config.costHeading')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('config.costDesc')}</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {COST_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <DollarSign className="w-4 h-4" />
          {t('config.amenityHeading')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('config.amenityDesc')}</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {AMENITY_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('config.amenityFormula')}
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          {t('config.profitHeading')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('config.profitDesc')}</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {PROFIT_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <Wind className="w-4 h-4" />
          {t('config.acHeading')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('config.acDesc')}</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {AC_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <KeyRound className="w-4 h-4" />
          {t('config.accessHeading')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('config.accessDesc')}</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {ACCESS_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSaveAll} data-testid="button-save-all-settings">
          <Check className="w-3.5 h-3.5" />
          {t('config.saveAll')}
        </Button>
      </div>
    </div>
  )
}

// ─── Onboarding Template Section ─────────────────────────────────────────────

function OnboardingTemplateSection() {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const qc = useQueryClient()
  const [newTask, setNewTask] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const { data: templates, isLoading } = useQuery({
    queryKey: ['/supabase/onboarding-templates'],
    // Templates change only via this same admin UI; 10 min keeps it fresh
    // without re-fetching on every settings tab switch. Mutations invalidate.
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding_task_templates')
        .select('*')
        .order('sort_order')
      if (error) throw error
      return data || []
    },
  })

  const { mutate: addTemplate } = useMutation({
    mutationFn: async (taskName: string) => {
      const maxOrder = (templates || []).reduce((m: number, t: any) => Math.max(m, t.sort_order || 0), 0)
      const { error } = await supabase.from('onboarding_task_templates').insert({ task_name: taskName, sort_order: maxOrder + 1 })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/onboarding-templates'] })
      setNewTask('')
      toast({ title: t('toasts.templateTaskAdded') })
    },
  })

  const { mutate: updateTemplate } = useMutation({
    mutationFn: async ({ id, task_name }: { id: string; task_name: string }) => {
      const { error } = await supabase.from('onboarding_task_templates').update({ task_name }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/onboarding-templates'] })
      setEditingId(null)
      toast({ title: t('toasts.templateUpdated') })
    },
  })

  const { mutate: deleteTemplate } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('onboarding_task_templates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/onboarding-templates'] })
      toast({ title: t('toasts.templateTaskRemoved') })
    },
  })

  return (
    <div className="space-y-3">
      <h2 className="text-base font-medium flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4" />
        {t('templates.onboardingHeading')}
      </h2>
      <p className="text-xs text-muted-foreground">{t('templates.onboardingDesc')}</p>
      <div className="rounded-lg border border-border p-4 space-y-2">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
        ) : (
          (templates || []).map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 group">
              {editingId === t.id ? (
                <>
                  <Input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="h-7 text-xs flex-1"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && updateTemplate({ id: t.id, task_name: editValue })}
                  />
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => updateTemplate({ id: t.id, task_name: editValue })}>
                    <Check className="w-3 h-3 text-success" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingId(null)}>
                    <X className="w-3 h-3" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1">{t.task_name}</span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100" onClick={() => { setEditingId(t.id); setEditValue(t.task_name) }}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={() => deleteTemplate(t.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </>
              )}
            </div>
          ))
        )}
        <div className="flex items-center gap-2 pt-2 border-t border-border/50">
          <Input
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            placeholder={t('templates.addTaskPlaceholder')}
            className="h-7 text-xs flex-1"
            onKeyDown={e => e.key === 'Enter' && newTask.trim() && addTemplate(newTask.trim())}
          />
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!newTask.trim()} onClick={() => addTemplate(newTask.trim())}>
            <Plus className="w-3 h-3" /> {t('common.actions.add')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Per-User Custom Views Dialog ────────────────────────────────────────────

function CustomViewsDialog({
  targetUser,
  open,
  onOpenChange,
  rolePermissions,
}: {
  targetUser: any
  open: boolean
  onOpenChange: (open: boolean) => void
  rolePermissions: RolePermissionsStore
}) {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const { user } = useAuth()
  const qc = useQueryClient()

  // Build initial permissions from user's current state
  const initialPerms = useMemo((): Record<string, PagePermission> => {
    if (targetUser?.custom_permissions && typeof targetUser.custom_permissions === 'object') {
      const views = sanitizeViews(targetUser.custom_views)
      return sanitizePagePermissions(targetUser.custom_permissions, views)
    }
    if (targetUser?.custom_views !== null && targetUser?.custom_views !== undefined) {
      const views = sanitizeViews(targetUser.custom_views)
      return derivePermissionsFromViews(views, targetUser?.role === 'admin')
    }
    const rp = rolePermissions[targetUser?.role]
    if (rp) return rp.permissions
    const views = sanitizeViews(ROLE_VIEWS[targetUser?.role] || [])
    return derivePermissionsFromViews(views, targetUser?.role === 'admin')
  }, [targetUser, rolePermissions])

  const [selectedPerms, setSelectedPerms] = useState<Record<string, PagePermission>>(initialPerms)
  const hasCustom = targetUser?.custom_views !== null && targetUser?.custom_views !== undefined

  useEffect(() => {
    setSelectedPerms(initialPerms)
  }, [targetUser?.id])

  const viewGroups = useMemo(() => {
    const groups: { group: string; views: typeof VIEW_DEFINITIONS[number][] }[] = []
    const seen = new Set<string>()
    for (const v of VIEW_DEFINITIONS) {
      if (v.id === 'settings') continue
      if (!seen.has(v.group)) {
        seen.add(v.group)
        groups.push({ group: v.group, views: [] })
      }
      groups.find(g => g.group === v.group)!.views.push(v)
    }
    return groups
  }, [])

  const { mutate: saveCustomAccess, isPending } = useMutation({
    mutationFn: async ({ customViews, customPerms }: { customViews: string[] | null; customPerms: Record<string, PagePermission> | null }) => {
      const { error } = await supabase
        .from('app_users')
        // custom_views & custom_permissions are jsonb; codegen-derived Json
        // type doesn't accept the structured shapes directly.
        .update({ custom_views: customViews as any, custom_permissions: customPerms as any })
        .eq('id', Number(targetUser.id))
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      onOpenChange(false)
    },
  })

  function handleSave() {
    const customViews = Object.entries(selectedPerms)
      .filter(([, p]) => p.view)
      .map(([id]) => id)
    saveCustomAccess({ customViews, customPerms: selectedPerms })
    logActivity({
      entity_type: 'other',
      action: 'update',
      entity_name: 'user_access_override',
      field_name: targetUser.label,
      new_value: customViews.join(','),
      changed_by: user?.label ?? null,
    })
    toast({ title: t('toasts.customAccessSaved'), description: t('toasts.customAccessSavedDesc', { name: targetUser.label }) })
  }

  function handleReset() {
    saveCustomAccess({ customViews: null, customPerms: null })
    logActivity({
      entity_type: 'other',
      action: 'update',
      entity_name: 'user_access_override',
      field_name: targetUser.label,
      new_value: 'reset_to_role',
      changed_by: user?.label ?? null,
    })
    toast({ title: t('toasts.customAccessReset'), description: t('toasts.customAccessResetDesc', { name: targetUser.label }) })
  }

  function togglePerm(viewId: string, field: 'view' | 'edit', checked: boolean) {
    setSelectedPerms(prev => {
      const existing = prev[viewId] ?? { view: false, edit: false }
      const next = { ...existing, [field]: checked }
      if (field === 'view' && !checked) next.edit = false
      if (field === 'edit' && checked) next.view = true
      return { ...prev, [viewId]: next }
    })
  }

  if (!targetUser) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('users.customViews.title', { name: targetUser.label })}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          {t('users.customViews.description')}
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-4 text-2xs text-muted-foreground uppercase tracking-wider pl-1">
            <span className="flex-1">{t('users.customViews.colPage')}</span>
            <span className="w-10 text-center">{t('users.customViews.colView')}</span>
            <span className="w-10 text-center">{t('users.customViews.colEdit')}</span>
          </div>
          {viewGroups.map(({ group, views }) => (
            <div key={group}>
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{group}</div>
              <div className="space-y-0.5">
                {views.map(v => {
                  const perm = selectedPerms[v.id] ?? { view: false, edit: false }
                  return (
                    <div key={v.id} className="flex items-center gap-4 py-0.5 hover:bg-muted/30 rounded px-1">
                      <span className="text-sm flex-1">{v.label}</span>
                      <div className="w-10 flex justify-center">
                        <Checkbox
                          checked={perm.view}
                          onCheckedChange={(c) => togglePerm(v.id, 'view', !!c)}
                        />
                      </div>
                      <div className="w-10 flex justify-center">
                        <Checkbox
                          checked={perm.edit}
                          disabled={!perm.view}
                          onCheckedChange={(c) => togglePerm(v.id, 'edit', !!c)}
                          className={!perm.view ? 'opacity-30' : ''}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {hasCustom && (
            <Button variant="outline" size="sm" onClick={handleReset} disabled={isPending} className="gap-1">
              <RotateCcw className="w-3 h-3" />
              {t('users.customViews.resetButton')}
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? t('users.customViews.saving') : t('users.customViews.saveButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Users Section ───────────────────────────────────────────────────────────

function UsersSection() {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const qc = useQueryClient()
  const { user, setViewAs } = useAuth()
  const [, navigate] = useLocation()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [customizeUser, setCustomizeUser] = useState<any>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newRole, setNewRole] = useState<string>('operations')

  const { rolePermissions } = useRolePermissions()

  // Build role options: system + custom
  const allRoleOptions = useMemo((): { value: string; label: string }[] => {
    const options: { value: string; label: string }[] = [...SYSTEM_ROLE_OPTIONS]
    for (const [key, val] of Object.entries(rolePermissions)) {
      if (!val.system && !options.find(o => o.value === key)) {
        options.push({ value: key, label: val.label })
      }
    }
    return options
  }, [rolePermissions])

  const { data: users, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/settings-users'],
    // app_users full row changes only via the admin invite/edit flows on
    // this page; 5 min is well inside an admin session and mutations
    // (invite/remove/role-change) all invalidate this key.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, role, label, google_email, created_at, custom_views, custom_permissions')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const { mutate: inviteUser, isPending: inviting } = useMutation({
    mutationFn: async ({ email, label, role }: { email: string; label: string; role: string }) => {
      const { error } = await supabase.from('app_users').insert({
        google_email: email.toLowerCase().trim(),
        label,
        role,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      toast({ title: t('toasts.userInvited'), description: t('toasts.userInvitedDesc', { email: newEmail }) })
      setInviteOpen(false)
      setNewEmail('')
      setNewLabel('')
      setNewRole('operations')
    },
    onError: (err: any) => {
      const msg = err?.message || ''
      if (msg.includes('unique') || msg.includes('duplicate')) {
        toast({ title: t('toasts.emailExists'), description: t('toasts.emailExistsDesc'), variant: 'destructive' })
      } else {
        toast({ title: t('toasts.inviteFailed'), description: err?.message, variant: 'destructive' })
      }
    },
  })

  const [pendingRoleUpdate, setPendingRoleUpdate] = useState<string | null>(null)

  // Inline rename on the Name cell
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  const [labelDraft, setLabelDraft] = useState('')

  const { mutate: renameUser } = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      const { error } = await supabase.from('app_users').update({ label }).eq('id', Number(id))
      if (error) throw error
      return { id, label }
    },
    onSuccess: ({ id, label }) => {
      const oldLabel = users?.find((u: any) => u.id === id)?.label ?? null
      qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      logActivity({
        entity_type: 'other',
        action: 'update',
        entity_name: 'user_label',
        field_name: oldLabel ?? String(id),
        old_value: oldLabel,
        new_value: label,
        changed_by: user?.label ?? null,
      })
      toast({ title: t('toasts.nameUpdated') })
      setEditingLabelId(null)
    },
    onError: (e: any) => toast({ title: t('toasts.renameFailed'), description: e?.message, variant: 'destructive' }),
  })

  const commitUserRename = (id: string, currentLabel: string) => {
    const next = labelDraft.trim()
    if (!next || next === currentLabel) { setEditingLabelId(null); return }
    renameUser({ id, label: next })
  }

  const { mutateAsync: updateRoleAsync } = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const { error } = await supabase.from('app_users').update({ role }).eq('id', Number(id))
      if (error) throw error
    },
  })

  async function handleRoleChange(userId: string, newRole: string) {
    setPendingRoleUpdate(userId)
    try {
      await updateRoleAsync({ id: userId, role: newRole })
      await qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      const targetLabel = users?.find((u: any) => u.id === userId)?.label ?? userId
      logActivity({
        entity_type: 'other',
        action: 'update',
        entity_name: 'user_role',
        field_name: targetLabel,
        new_value: newRole,
        changed_by: user?.label ?? null,
      })
      toast({ title: t('toasts.roleUpdated') })
    } catch (e: any) {
      toast({ title: t('toasts.roleUpdateFailed'), description: e?.message, variant: 'destructive' })
    } finally {
      setPendingRoleUpdate(null)
      setEditingRoleId(null)
    }
  }

  const { mutate: deleteUser, isPending: deleting } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('app_users').delete().eq('id', Number(id))
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      toast({ title: t('toasts.userRemoved') })
      setConfirmDeleteId(null)
    },
    onError: (error: any) => {
      toast({ title: t('toasts.userRemoveFailed'), description: error?.message, variant: 'destructive' })
      setConfirmDeleteId(null)
    },
  })

  function handleViewAs(u: any) {
    const rp = rolePermissions[u.role]
    let resolvedViews: ViewId[]
    let resolvedPermissions: Record<string, PagePermission>
    let hasCustomViews = false

    if (u.custom_views !== null && u.custom_views !== undefined) {
      resolvedViews = sanitizeViews(u.custom_views)
      hasCustomViews = true
      resolvedPermissions = (u.custom_permissions && typeof u.custom_permissions === 'object')
        ? sanitizePagePermissions(u.custom_permissions, resolvedViews)
        : derivePermissionsFromViews(resolvedViews, u.role === 'admin')
    } else if (rp) {
      resolvedViews = rp.views
      resolvedPermissions = rp.permissions
    } else {
      resolvedViews = sanitizeViews(ROLE_VIEWS[u.role] || [])
      resolvedPermissions = derivePermissionsFromViews(resolvedViews, u.role === 'admin')
    }

    const target: AuthUser = {
      id: u.id,
      role: u.role,
      label: u.label,
      resolvedViews,
      resolvedPermissions,
      hasCustomViews,
    }

    setViewAs(target)
    logActivity({
      entity_type: 'other',
      action: 'note',
      entity_name: 'view_as',
      field_name: u.label,
      new_value: 'start',
      changed_by: user?.label ?? null,
    })

    // Navigate to first view the emulated user can see
    if (resolvedViews.length > 0) {
      const firstView = resolvedViews[0]
      navigate(firstView === 'dashboard' ? '/' : `/${firstView}`)
    } else {
      navigate('/no-access')
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium flex items-center gap-2">
              <Users className="w-4 h-4" />
              {t('users.heading')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t('users.description')}</p>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setInviteOpen(true)}
            data-testid="button-add-user"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {t('users.addUser')}
          </Button>
        </div>

        {isError ? (
          <ErrorState title={t('users.errorTitle')} onRetry={() => refetch()} />
        ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/80 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('users.colName')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('users.colEmail')}</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('users.colRole')}</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('users.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {[...Array(4)].map((_, j) => (
                      <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : !users?.length ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">{t('users.noUsersFound')}</td>
                </tr>
              ) : (
                users.map((u: any) => {
                  const hasCustom = u.custom_views !== null && u.custom_views !== undefined
                  const isCurrentUser = user && u.id === user.id
                  const isAdmin = u.role === 'admin'
                  return (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors" data-testid={`row-user-${u.id}`}>
                      <td className="py-2 px-3 font-medium text-xs">
                        <span className="flex items-center gap-1.5">
                          {editingLabelId === u.id ? (
                            <Input
                              value={labelDraft}
                              autoFocus
                              onChange={e => setLabelDraft(e.target.value)}
                              onBlur={() => commitUserRename(u.id, u.label)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitUserRename(u.id, u.label)
                                if (e.key === 'Escape') setEditingLabelId(null)
                              }}
                              className="h-6 text-xs w-40"
                              data-testid={`input-rename-user-${u.id}`}
                            />
                          ) : (
                            <button
                              type="button"
                              className="flex items-center gap-1 group/name text-left"
                              onClick={() => { setEditingLabelId(u.id); setLabelDraft(u.label ?? '') }}
                              title={t('users.renameTitle')}
                              data-testid={`button-rename-user-${u.id}`}
                            >
                              {u.label}
                              <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover/name:opacity-100 transition-opacity" />
                            </button>
                          )}
                          {hasCustom && (
                            <span className={`text-2xs font-medium px-1 py-0.5 rounded border ${TONE_SOFT.warning}`}>
                              {t('users.customBadge')}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{u.google_email || <span className="italic">{t('users.notSet')}</span>}</td>
                      <td className="py-2 px-3">
                        {editingRoleId === u.id ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={u.role}
                              autoFocus
                              disabled={pendingRoleUpdate === u.id}
                              className="h-6 rounded border border-input bg-background px-1.5 text-xs disabled:opacity-50"
                              onChange={e => handleRoleChange(u.id, e.target.value)}
                            >
                              {allRoleOptions.map(o => (
                                <option key={o.value} value={o.value}>{roleDisplayLabel(t, o.value, o.label)}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <button
                            className="flex items-center gap-1 group/role"
                            onClick={() => setEditingRoleId(u.id)}
                            title={t('users.changeRoleTitle')}
                          >
                            <RoleBadge role={u.role} />
                            <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover/role:opacity-100 transition-opacity" />
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Customize views */}
                          {!isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => setCustomizeUser(u)}
                              title={t('users.customizeTitle')}
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* View As */}
                          {!isAdmin && !isCurrentUser && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => handleViewAs(u)}
                              title={t('users.previewAsTitle', { name: u.label })}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Delete */}
                          {confirmDeleteId === u.id ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">{t('users.removeConfirm')}</span>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                disabled={deleting}
                                onClick={() => deleteUser(u.id)}
                                data-testid={`button-confirm-delete-user-${u.id}`}
                              >
                                {deleting ? t('users.removing') : t('common.actions.confirm')}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                disabled={deleting}
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                {t('common.actions.cancel')}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => setConfirmDeleteId(u.id)}
                              aria-label={t('users.removeAria', { name: u.label })}
                              data-testid={`button-delete-user-${u.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('users.addDialogTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            {t('users.addDialogDesc')}
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('users.accountEmailLabel')}</label>
              <Input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="name@gmail.com"
                className="mt-1"
                data-testid="input-new-user-email"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('users.displayNameLabel')}</label>
              <Input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. Sarah (Cleaning Team)"
                className="mt-1"
                data-testid="input-new-user-label"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('users.roleLabel')}</label>
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-new-user-role"
              >
                {allRoleOptions.map(o => (
                  <option key={o.value} value={o.value}>{roleDisplayLabel(t, o.value, o.label)}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              disabled={!newEmail.trim() || !newLabel.trim() || inviting}
              onClick={() => inviteUser({ email: newEmail, label: newLabel.trim(), role: newRole })}
              data-testid="button-confirm-add-user"
            >
              {inviting ? t('users.addingButton') : t('users.addUser')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-user custom views */}
      <CustomViewsDialog
        targetUser={customizeUser}
        open={!!customizeUser}
        onOpenChange={open => { if (!open) setCustomizeUser(null) }}
        rolePermissions={rolePermissions}
      />
    </>
  )
}

// ─── Settings Page ───────────────────────────────────────────────────────────

// ─── Notifications Section ───────────────────────────────────────────────────
// DEFAULT_NOTIF_PREFS and NOTIF_EVENT_DEFS are shared with the self-service
// /notifications page — see @/lib/notif-prefs.

function NotificationsSection() {
  const { user } = useAuth()
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const qc = useQueryClient()
  const [testing, setTesting] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)

  // All users (admins can edit any; non-admins only see their own row)
  const { data: users } = useQuery({
    queryKey: ['/supabase/notif-users'],
    // app_users list — admin-only churn; 5 min is safe and matches
    // settings-users cadence above.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('app_users')
        .select('id, label, google_email, role, custom_views')
        .order('label')
      return data || []
    },
  })

  // role permissions to compute allowed views per user
  const { data: rolePerms } = useQuery({
    queryKey: ['/supabase/role-permissions'],
    // Same key as the role-perms query at line 56 — React Query will
    // dedupe; staleTime must match so they share the same freshness
    // window (10 min).
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: row } = await supabase.from('app_settings').select('value').eq('key', 'role_permissions').single()
      if (!row?.value) return buildDefaultRolePermissions()
      return sanitizeRolePermissions(typeof row.value === 'string' ? JSON.parse(row.value) : row.value)
    },
  })

  const { data: prefsRows } = useQuery({
    queryKey: ['/supabase/notif-prefs'],
    // Notification preferences are edited row-at-a-time via the same UI;
    // 2 min is short enough to feel live in the admin matrix and skips
    // refetch on tab switches. Mutations invalidate this key.
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('notification_preferences').select('*')
      return data || []
    },
  })

  const prefsByUser = useMemo(() => {
    const m = new Map<string, any>()
    // notification_preferences.user_id is integer; coerce for stable string keys.
    for (const p of (prefsRows || [])) m.set(String(p.user_id), p)
    return m
  }, [prefsRows])

  function allowedViewsFor(u: any): string[] {
    if (Array.isArray(u.custom_views)) return u.custom_views
    if (rolePerms?.[u.role]?.views) return rolePerms[u.role].views
    return ROLE_VIEWS[u.role] || []
  }

  const savePref = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from('notification_preferences').upsert({
        ...payload,
        updated_at: new Date().toISOString(),
        updated_by: user?.label || null,
      }, { onConflict: 'user_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/notif-prefs'] }),
    onError: (e: any) => toast({ title: t('toasts.saveFailed'), description: e.message, variant: 'destructive' }),
  })

  async function handleTestEmail() {
    setTesting(true)
    const { sendTestEmail } = await import('@/lib/notify')
    const r = await sendTestEmail()
    setTesting(false)
    if (r.ok) toast({ title: t('toasts.testEmailSent'), description: t('toasts.testEmailSentDesc', { email: r.sentTo ?? '' }) })
    else toast({ title: t('toasts.testEmailFailed'), description: r.error, variant: 'destructive' })
  }

  const isAdmin = user?.role === 'admin'
  const visibleUsers = isAdmin ? (users || []) : (users || []).filter((u: any) => u.id === user?.id)

  const EVENT_DEFS = NOTIF_EVENT_DEFS

  return (
    <div className="rounded-lg border border-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-medium flex items-center gap-2">
            <Users className="w-4 h-4" /> {t('notifMatrix.heading')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('notifMatrix.description')}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleTestEmail} disabled={testing}>
          {testing ? t('notifMatrix.sending') : t('notifMatrix.sendTest')}
        </Button>
      </div>

      <div className="space-y-3">
        {visibleUsers.map((u: any) => {
          // prefsByUser is keyed by String(user_id); u.id is numeric — coerce
          // so the lookup hits. Without this the row always fell back to
          // defaults, so toggles never reflected or persisted ("won't turn off").
          // Cleaning/cleaner roles default to email OFF (must opt in explicitly).
          const isCleaningRole = u.role === 'cleaning' || u.role === 'cleaner'
          const prefs = prefsByUser.get(String(u.id)) || { user_id: u.id, ...DEFAULT_NOTIF_PREFS, email_enabled: !isCleaningRole }
          const allowedViews = allowedViewsFor(u)
          const isExpanded = editingUserId === u.id || visibleUsers.length === 1
          const canEditThis = isAdmin || u.id === user?.id

          return (
            <div key={u.id} className="border border-border rounded-md">
              <button
                type="button"
                onClick={() => setEditingUserId(isExpanded && editingUserId === u.id ? null : u.id)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/30"
                disabled={visibleUsers.length === 1}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{u.label}</span>
                  <RoleBadge role={u.role} />
                  <span className="text-xs text-muted-foreground truncate">{u.google_email}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {prefs.email_enabled ? (
                    <span className="text-success">{t('notifMatrix.statusOnPrefix')}{t(`notifMatrix.freqShort.${prefs.digest_frequency || 'instant'}`, undefined, prefs.digest_frequency)}</span>
                  ) : (
                    <span className="text-muted-foreground">{t('notifMatrix.statusOff')}</span>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 py-3 border-t border-border space-y-3">
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={prefs.email_enabled}
                        disabled={!canEditThis}
                        onCheckedChange={(v) => savePref.mutate({ ...prefs, email_enabled: !!v })}
                      />
                      {t('notifMatrix.emailEnabled')}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      {t('notifMatrix.frequencyLabel')}
                      <select
                        value={prefs.digest_frequency || 'instant'}
                        disabled={!canEditThis}
                        onChange={(e) => savePref.mutate({ ...prefs, digest_frequency: e.target.value })}
                        className="h-7 text-xs border border-input rounded px-2 bg-background"
                      >
                        <option value="instant">{t('notifMatrix.freqInstant')}</option>
                        <option value="daily">{t('notifMatrix.freqDaily')}</option>
                        <option value="off">{t('notifMatrix.freqOff')}</option>
                      </select>
                    </label>
                  </div>

                  {(() => {
                    // When the master switch is off (email disabled or Frequency=Off)
                    // nothing sends, so the per-event toggles render inactive
                    // (unchecked + disabled + dimmed) — but their saved values are
                    // preserved and reappear when email is re-enabled.
                    const emailActive = !!prefs.email_enabled && prefs.digest_frequency !== 'off'
                    return (
                      <div className="space-y-2">
                        {!emailActive && (
                          <p className="text-2xs text-muted-foreground">
                            {prefs.email_enabled ? t('notifMatrix.frequencyOffNote') : t('notifMatrix.emailDisabledNote')}{t('notifMatrix.noteSuffix')}
                          </p>
                        )}
                        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${emailActive ? '' : 'opacity-50'}`}>
                          {EVENT_DEFS.map(ev => {
                            const hasAccess = allowedViews.includes(ev.view)
                            const checked = !!prefs[ev.field]
                            const active = emailActive && hasAccess
                            return (
                              <label
                                key={ev.field}
                                className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded border ${active ? 'border-border' : 'border-border/50 opacity-60'}`}
                                title={!hasAccess ? t('notifMatrix.requiresAccess', { view: ev.view }) : (!emailActive ? t('notifMatrix.enableEmailToUse') : '')}
                              >
                                <Checkbox
                                  checked={active && checked}
                                  disabled={!canEditThis || !active}
                                  onCheckedChange={(v) => savePref.mutate({ ...prefs, [ev.field]: !!v })}
                                />
                                <span className="flex-1">{t(`notifMatrix.notifEvents.${ev.field}`, undefined, ev.label)}</span>
                                {!hasAccess && <Lock className="w-3 h-3 text-muted-foreground" />}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {isAdmin && <NotificationLogViewer />}
    </div>
  )
}

function NotificationLogViewer() {
  const { t } = useLocale('settingsPage')
  const { data: logs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['/supabase/notif-log'],
    // High-churn log; viewer has an explicit Refresh button (refetch). Keep
    // staleTime small (30s) so opening the tab a moment later doesn't
    // re-fetch unnecessarily, but anything older auto-refreshes.
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('notification_log')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(50)
      return data || []
    },
  })

  const total = logs?.length || 0
  const sentCt = logs?.filter((l: any) => l.status === 'sent').length || 0
  const failedCt = logs?.filter((l: any) => l.status === 'failed').length || 0

  return (
    <div className="border-t border-border pt-4 mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t('notifMatrix.log.heading')}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('notifMatrix.log.summary', { sent: sentCt, failed: failedCt, total })}</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? t('notifMatrix.log.refreshing') : t('notifMatrix.log.refresh')}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center">{t('notifMatrix.log.empty')}</p>
      ) : (
        <div className="max-h-72 overflow-auto rounded border border-border">
          {/* Mobile: stacked cards */}
          <div className="sm:hidden divide-y divide-border">
            {(logs || []).map((l: any) => (
              <div key={l.id} className="p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate">{l.event_type}</span>
                  <span className={`text-xs flex-shrink-0 ${l.status === 'sent' ? 'text-success' : l.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{t(`notifMatrix.log.status.${l.status}`, undefined, l.status)}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{l.recipient_email}</p>
                <p className="text-2xs text-muted-foreground">{new Date(l.sent_at).toLocaleString()}</p>
                {l.error && <p className="text-xs text-destructive">{l.error}</p>}
              </div>
            ))}
          </div>
          {/* Desktop: table */}
          <table className="w-full text-xs hidden sm:table">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">{t('notifMatrix.log.colWhen')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('notifMatrix.log.colEvent')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('notifMatrix.log.colRecipient')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('notifMatrix.log.colStatus')}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t('notifMatrix.log.colNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {(logs || []).map((l: any) => (
                <tr key={l.id} className="border-t border-border/50">
                  <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{new Date(l.sent_at).toLocaleString()}</td>
                  <td className="px-2 py-1">{l.event_type}</td>
                  <td className="px-2 py-1 truncate max-w-[180px]">{l.recipient_email}</td>
                  <td className="px-2 py-1">
                    <span className={l.status === 'sent' ? 'text-success' : l.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                      {t(`notifMatrix.log.status.${l.status}`, undefined, l.status)}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-muted-foreground truncate max-w-[280px]" title={l.error || l.subject || ''}>
                    {l.error ? l.error : (l.subject || '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Workflow Templates Section ──────────────────────────────────────────────

const STAGES = ['Lead', 'Quote', 'Onboarding', 'Active', 'Offboarding', 'Offboarded']

function WorkflowTemplatesSection() {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ from_stage: '', to_stage: 'Onboarding', title: '', description: '', default_assignee_name: '', due_offset_days: '0', checklist_items: '' })

  const { data: templates, isLoading } = useQuery({
    queryKey: ['/supabase/workflow-templates'],
    // Workflow templates are edited only via this section; 10 min skips
    // refetch on tab toggles within an admin session. Mutations invalidate.
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('stage_workflow_templates').select('*').order('from_stage').order('to_stage').order('sort_order')
      return data || []
    },
  })

  const { data: users } = useQuery({
    queryKey: ['/supabase/workflow-users'],
    // app_users (id, label) — admin-only churn; 5 min matches notif-users
    // and settings-users above.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('app_users').select('id, label').order('label')
      return data || []
    },
  })

  // Group by transition. Stage names are looked up via common.stage.* (slug),
  // falling back to the raw canonical-English stage value.
  const stageLabel = (stage: string) => t(`common.stage.${slugify(stage)}`, undefined, stage)
  const groups = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const tpl of (templates || [])) {
      const key = `${tpl.from_stage ? stageLabel(tpl.from_stage) : t('templates.any')} → ${stageLabel(tpl.to_stage)}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(tpl)
    }
    return Array.from(map.entries())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, t])

  async function saveTemplate() {
    const checklist = form.checklist_items.split('\n').map(s => s.trim()).filter(Boolean)
    const payload = {
      from_stage: form.from_stage || null,
      to_stage: form.to_stage,
      title: form.title,
      description: form.description || null,
      default_assignee_name: form.default_assignee_name || null,
      due_offset_days: parseInt(form.due_offset_days) || 0,
      checklist_items: checklist,
      updated_at: new Date().toISOString(),
    }
    if (editId) {
      await supabase.from('stage_workflow_templates').update(payload).eq('id', editId)
    } else {
      await supabase.from('stage_workflow_templates').insert({ ...payload, sort_order: (templates?.length || 0) + 1 })
    }
    qc.invalidateQueries({ queryKey: ['/supabase/workflow-templates'] })
    toast({ title: editId ? t('toasts.templateUpdated') : t('toasts.templateCreated') })
    setAddOpen(false)
    setEditId(null)
    setForm({ from_stage: '', to_stage: 'Onboarding', title: '', description: '', default_assignee_name: '', due_offset_days: '0', checklist_items: '' })
  }

  function startEdit(tpl: any) {
    setForm({
      from_stage: tpl.from_stage || '',
      to_stage: tpl.to_stage,
      title: tpl.title,
      description: tpl.description || '',
      default_assignee_name: tpl.default_assignee_name || '',
      due_offset_days: String(tpl.due_offset_days || 0),
      checklist_items: Array.isArray(tpl.checklist_items) ? tpl.checklist_items.join('\n') : '',
    })
    setEditId(tpl.id)
    setAddOpen(true)
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    await supabase.from('stage_workflow_templates').update({ enabled }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['/supabase/workflow-templates'] })
  }

  async function deleteTemplate(id: string) {
    if (!confirm(t('templates.confirmDelete'))) return
    await supabase.from('stage_workflow_templates').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['/supabase/workflow-templates'] })
    toast({ title: t('toasts.templateDeleted') })
  }

  return (
    <div className="rounded-lg border border-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-medium flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" /> {t('templates.workflowHeading')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('templates.workflowDesc')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setEditId(null); setForm({ from_stage: '', to_stage: 'Onboarding', title: '', description: '', default_assignee_name: '', due_offset_days: '0', checklist_items: '' }); setAddOpen(true) }}>
          <Plus className="w-3.5 h-3.5 mr-1" /> {t('templates.addTemplateButton')}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : groups.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">{t('templates.noTemplates')}</p>
      ) : (
        <div className="space-y-4">
          {groups.map(([label, items]) => (
            <div key={label}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
              <div className="space-y-1">
                {items.map((tpl: any) => (
                  <div key={tpl.id} className={`flex items-center gap-3 text-xs rounded-md border px-3 py-2 ${tpl.enabled ? 'border-border' : 'border-border/50 opacity-50'}`}>
                    <Checkbox checked={tpl.enabled} onCheckedChange={(v) => toggleEnabled(tpl.id, !!v)} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{tpl.title}</p>
                      <p className="text-muted-foreground">
                        {tpl.default_assignee_name || t('templates.unassigned')} · +{tpl.due_offset_days}d
                        {Array.isArray(tpl.checklist_items) && tpl.checklist_items.length > 0 && t('templates.itemsSuffix', { count: tpl.checklist_items.length })}
                      </p>
                    </div>
                    <button onClick={() => startEdit(tpl)} className="text-muted-foreground hover:text-foreground"><Pencil className="w-3 h-3" /></button>
                    <button onClick={() => deleteTemplate(tpl.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={v => { if (!v) { setAddOpen(false); setEditId(null) } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? t('templates.editDialogTitle') : t('templates.addDialogTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{t('templates.fromStageLabel')}</label>
                <select value={form.from_stage} onChange={e => setForm(f => ({ ...f, from_stage: e.target.value }))} className="w-full h-8 text-xs border border-input rounded px-2 bg-background">
                  <option value="">{t('templates.any')}</option>
                  {STAGES.map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{t('templates.toStageLabel')}</label>
                <select value={form.to_stage} onChange={e => setForm(f => ({ ...f, to_stage: e.target.value }))} className="w-full h-8 text-xs border border-input rounded px-2 bg-background">
                  {STAGES.map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{t('templates.taskTitleLabel')} <span className="text-muted-foreground/60">{t('templates.taskTitleHint')}</span></label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="h-8 text-xs" placeholder={t('templates.taskTitlePlaceholder')} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{t('templates.descriptionLabel')}</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full h-16 rounded-md border border-input px-2 py-1.5 text-xs bg-background resize-none" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{t('templates.defaultAssigneeLabel')}</label>
                <select value={form.default_assignee_name} onChange={e => setForm(f => ({ ...f, default_assignee_name: e.target.value }))} className="w-full h-8 text-xs border border-input rounded px-2 bg-background">
                  <option value="">{t('templates.unassigned')}</option>
                  {(users || []).map((u: any) => <option key={u.id} value={u.label}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{t('templates.dueLabel')}</label>
                <Input type="number" value={form.due_offset_days} onChange={e => setForm(f => ({ ...f, due_offset_days: e.target.value }))} className="h-8 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{t('templates.checklistLabel')} <span className="text-muted-foreground/60">{t('templates.checklistHint')}</span></label>
              <textarea value={form.checklist_items} onChange={e => setForm(f => ({ ...f, checklist_items: e.target.value }))} className="w-full h-20 rounded-md border border-input px-2 py-1.5 text-xs bg-background resize-none" placeholder={t('templates.checklistPlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); setEditId(null) }}>{t('common.actions.cancel')}</Button>
            <Button onClick={saveTemplate} disabled={!form.title.trim() || !form.to_stage}>{editId ? t('templates.update') : t('templates.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function describeMapsStatus(s: GoogleMapsRuntimeStatus, t: (key: string, vars?: Record<string, string | number>, fallback?: string) => string): string {
  switch (s) {
    case 'no_key': return t('integrations.mapsStatus.no_key')
    case 'loading': return t('integrations.mapsStatus.loading')
    case 'ready': return t('integrations.mapsStatus.ready')
    case 'script_error': return t('integrations.mapsStatus.script_error')
    case 'places_missing': return t('integrations.mapsStatus.places_missing')
    case 'timeout': return t('integrations.mapsStatus.timeout')
    case 'gm_authFailure': return t('integrations.mapsStatus.gm_authFailure', { origin: window.location.origin })
  }
}

function IntegrationsSection() {
  // Integrations are read from import.meta.env at build time. We never read or
  // display the actual key value — only whether a public env var is configured.
  const env = import.meta.env as Record<string, string | undefined>
  const googleMapsKey = env.VITE_GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_PLACES_API_KEY
  const supabaseUrl = env.VITE_SUPABASE_URL
  const anthropicKeyPresent = !!env.VITE_ANTHROPIC_API_KEY // optional client SDK key, normally server-side only
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const [qboConnecting, setQboConnecting] = useState(false)

  // Click handler for the admin "Reconnect QuickBooks" button. The /api/qbo/
  // authorize endpoint is admin-gated (Bearer header) and sets a one-shot
  // HttpOnly state cookie before returning the Intuit URL. This XHR-then-
  // navigate pattern is required because top-level browser navigation can't
  // carry the Supabase session header.
  async function startQboReconnect() {
    setQboConnecting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        toast({ title: t('toasts.qboNotSignedIn'), variant: 'destructive' })
        return
      }
      const r = await fetch('/api/qbo/authorize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include', // ensure the HttpOnly cookie response is honored
      })
      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        toast({ title: t('toasts.qboAuthorizeFailed', { status: r.status }), description: txt.slice(0, 200), variant: 'destructive' })
        return
      }
      const { url } = await r.json() as { url: string }
      window.location.href = url
    } catch (e) {
      toast({ title: t('toasts.qboReconnectError'), description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setQboConnecting(false)
    }
  }

  // Runtime status from AddressAutocomplete — only meaningful after the user
  // visits a page that mounts the component, but useful when troubleshooting.
  const [mapsStatus, setMapsStatus] = useState<GoogleMapsRuntimeStatus>(getGoogleMapsRuntimeStatus())
  useEffect(() => {
    const id = window.setInterval(() => setMapsStatus(getGoogleMapsRuntimeStatus()), 1500)
    return () => window.clearInterval(id)
  }, [])

  type Status = 'connected' | 'configured' | 'not_configured' | 'unknown'
  function statusBadge(s: Status) {
    const map: Record<Status, { label: string; tone: StatusTone }> = {
      connected: { label: t('integrations.statusConnected'), tone: 'success' },
      configured: { label: t('integrations.statusConfigured'), tone: 'info' },
      not_configured: { label: t('integrations.statusNotConfigured'), tone: 'warning' },
      unknown: { label: t('integrations.statusUnknown'), tone: 'neutral' },
    }
    const m = map[s]
    return <span className={`text-2xs px-1.5 py-0.5 rounded border ${TONE_SOFT[m.tone]}`}>{m.label}</span>
  }

  const integrations = [
    {
      icon: Database,
      name: t('integrations.supabaseName'),
      description: t('integrations.supabaseDesc'),
      status: (supabaseUrl ? 'connected' : 'not_configured') as Status,
      detail: supabaseUrl ? t('integrations.supabaseDetailConnected') : t('integrations.supabaseDetailMissing'),
    },
    {
      icon: MapPin,
      name: t('integrations.mapsName'),
      description: t('integrations.mapsDesc'),
      status: (googleMapsKey ? 'configured' : 'not_configured') as Status,
      detail: googleMapsKey
        ? t('integrations.mapsDetailConfigured', { status: describeMapsStatus(mapsStatus, t) })
        : t('integrations.mapsDetailMissing'),
    },
    {
      icon: Receipt,
      name: t('integrations.qboName'),
      description: t('integrations.qboDesc'),
      status: 'configured' as Status,
      detail: t('integrations.qboDetail'),
      action: isAdmin ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={qboConnecting}
          onClick={startQboReconnect}
          data-testid="button-qbo-reconnect"
        >
          {qboConnecting ? t('integrations.qboOpening') : t('integrations.qboReconnect')}
        </Button>
      ) : null,
    },
    {
      icon: KeyRound,
      name: t('integrations.anthropicName'),
      description: t('integrations.anthropicDesc'),
      status: (anthropicKeyPresent ? 'configured' : 'unknown') as Status,
      detail: anthropicKeyPresent
        ? t('integrations.anthropicDetailPresent')
        : t('integrations.anthropicDetailAbsent'),
    },
  ]

  return (
    <div className="space-y-3">
      <h2 className="text-base font-medium flex items-center gap-2">
        <Plug className="w-4 h-4" />
        {t('integrations.heading')}
      </h2>
      <p className="text-xs text-muted-foreground">
        {t('integrations.description')}
      </p>
      <div className="rounded-lg border border-border divide-y divide-border">
        {integrations.map((it) => {
          const Icon = it.icon
          const action = (it as { action?: React.ReactNode }).action
          return (
            <div key={it.name} className="flex items-start gap-3 p-3">
              <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{it.name}</span>
                  {statusBadge(it.status)}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{it.description}</p>
                <p className="text-2xs text-muted-foreground/80 mt-1">{it.detail}</p>
              </div>
              {action ? <div className="flex-shrink-0">{action}</div> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Full access to every page, can edit users, roles, and global app settings. Use sparingly.',
  supervisor: 'Field/team supervisor - manages linen, access codes, inspections, tasks, cleaners, and operational alerts. No access to financial, admin, or QBO settings unless explicitly granted in the matrix.',
  operations: 'Day-to-day operations team - sees properties, linens, AC filters, inspections, tasks, and cleaners.',
  cleaning: 'Linen-focused role for cleaning vendors. Read-only access to linen requirements and inventory.',
  viewer: 'Read-only access to most operational pages. Cannot edit data.',
}

function RoleDescriptions() {
  const { t } = useLocale('settingsPage')
  return (
    <div className="space-y-3">
      <h2 className="text-base font-medium flex items-center gap-2">
        <Shield className="w-4 h-4" />
        {t('roleReference.heading')}
      </h2>
      <p className="text-xs text-muted-foreground">
        {t('roleReference.description')}
      </p>
      <div className="rounded-lg border border-border divide-y divide-border">
        {Object.entries(ROLE_DESCRIPTIONS).map(([role, desc]) => (
          <div key={role} className="grid grid-cols-[110px_1fr] gap-3 p-3">
            <div className="text-sm font-medium capitalize">{roleDisplayLabel(t, role)}</div>
            <div className="text-xs text-muted-foreground">{t(`roleReference.${role}`, undefined, desc)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Owners Section (owner portal access management) ──────────────────────────

type OwnerRow = {
  id: string
  email: string
  name: string | null
  phone: string | null
  active: boolean
  created_at: string
  trellis_portal_url: string | null
  preferred_payment_method: string | null
  contact_id: string | null
}

function AssignPropertiesDialog({
  owner,
  open,
  onOpenChange,
}: {
  owner: OwnerRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // All properties to choose from.
  const { data: properties, isLoading: loadingProps } = useQuery({
    queryKey: ['/supabase/owner-assignable-properties'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, address')
        .order('name')
      if (error) throw error
      return data || []
    },
  })

  // This owner's current assignments.
  const { data: assigned, isLoading: loadingAssigned } = useQuery({
    queryKey: ['/supabase/owner-assignments', owner?.id],
    enabled: !!owner?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('owner_properties')
        .select('property_id')
        .eq('owner_id', owner!.id)
      if (error) throw error
      return (data || []).map((r: any) => r.property_id as number)
    },
  })

  useEffect(() => {
    if (assigned) setSelected(new Set(assigned))
  }, [assigned, owner?.id])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return properties || []
    return (properties || []).filter((p: any) =>
      (p.name || '').toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q)
    )
  }, [properties, search])

  const { mutate: saveAssignments, isPending } = useMutation({
    mutationFn: async () => {
      if (!owner) return
      const current = new Set(assigned || [])
      const toAdd = Array.from(selected).filter(id => !current.has(id))
      const toRemove = Array.from(current).filter(id => !selected.has(id))
      if (toAdd.length) {
        const { error } = await supabase
          .from('owner_properties')
          .insert(toAdd.map(property_id => ({ owner_id: owner.id, property_id })))
        if (error) throw error
      }
      if (toRemove.length) {
        const { error } = await supabase
          .from('owner_properties')
          .delete()
          .eq('owner_id', owner.id)
          .in('property_id', toRemove)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/owner-assignments'] })
      qc.invalidateQueries({ queryKey: ['/supabase/owner-assignment-counts'] })
      toast({ title: t('toasts.ownerPropertyAccessUpdated') })
      onOpenChange(false)
    },
    onError: (e: any) => toast({ title: t('toasts.ownerPropertyAccessFailed'), description: e?.message, variant: 'destructive' }),
  })

  function toggle(id: number, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  if (!owner) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('owners.assign.title', { name: owner.name || owner.email })}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          {t('owners.assign.description')}
        </p>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('owners.assign.searchPlaceholder')}
            className="h-8 text-xs pl-8"
          />
        </div>
        <div className="flex-1 overflow-y-auto rounded-lg border border-border divide-y divide-border/50">
          {loadingProps || loadingAssigned ? (
            [...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">{t('owners.assign.noProperties')}</p>
          ) : (
            filtered.map((p: any) => (
              <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/20 cursor-pointer">
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={(c) => toggle(p.id, !!c)}
                />
                <div className="min-w-0">
                  <p className="text-sm truncate">{p.name}</p>
                  {p.address && <p className="text-2xs text-muted-foreground truncate">{p.address}</p>}
                </div>
              </label>
            ))
          )}
        </div>
        <DialogFooter className="items-center">
          <span className="text-xs text-muted-foreground mr-auto">{t('owners.assign.selectedCount', { count: selected.size })}</span>
          <Button size="sm" onClick={() => saveAssignments()} disabled={isPending}>
            {isPending ? t('owners.assign.saving') : t('owners.assign.saveButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Owner field permission matrix (per owner / per property) ────────────────
function OwnerPermissionsDialog({
  owner,
  open,
  onOpenChange,
}: {
  owner: OwnerRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const qc = useQueryClient()
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null)
  // Working copy: property_id → permission map. Edited in place, saved on demand.
  const [draft, setDraft] = useState<Record<number, OwnerPermissions>>({})

  // The owner's assigned properties (the matrix is scoped to these).
  const { data: assigned, isLoading: loadingAssigned } = useQuery({
    queryKey: ['/supabase/owner-assigned-props', owner?.id],
    enabled: !!owner?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('owner_properties')
        .select('property_id, properties(id, name, address)')
        .eq('owner_id', owner!.id)
      if (error) throw error
      return (data || [])
        .map((r: any) => r.properties)
        .filter(Boolean)
        .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')) as { id: number; name: string; address: string | null }[]
    },
  })

  // Existing permission rows for this owner.
  const { data: existing, isLoading: loadingPerms } = useQuery({
    queryKey: ['/supabase/owner-permissions', owner?.id],
    enabled: !!owner?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('owner_property_permissions')
        .select('property_id, permissions')
        .eq('owner_id', owner!.id)
      if (error) throw error
      const m = new Map<number, OwnerPermissions>()
      for (const r of (data || [])) m.set(r.property_id as number, normalizeOwnerPermissions(r.permissions))
      return m
    },
  })

  // Build the working draft once both queries land.
  useEffect(() => {
    if (!assigned || !existing) return
    const next: Record<number, OwnerPermissions> = {}
    for (const p of assigned) next[p.id] = existing.get(p.id) ?? defaultOwnerPermissions()
    setDraft(next)
    setSelectedPropId(prev => (prev && next[prev] ? prev : assigned[0]?.id ?? null))
  }, [assigned, existing])

  const current = selectedPropId != null ? draft[selectedPropId] : undefined

  function setPerm(field: OwnerFieldKey, change: Partial<{ visible: boolean; editable: boolean }>) {
    if (selectedPropId == null) return
    setDraft(prev => {
      const map = prev[selectedPropId] ?? defaultOwnerPermissions()
      const cur = map[field]
      let next = { ...cur, ...change }
      // Editing implies visibility; hiding implies not editable.
      if (change.editable) next.visible = true
      if (change.visible === false) next.editable = false
      return { ...prev, [selectedPropId]: { ...map, [field]: next } }
    })
  }

  function copyToAll() {
    if (selectedPropId == null || !current || !assigned) return
    setDraft(prev => {
      const next = { ...prev }
      for (const p of assigned) next[p.id] = { ...current }
      return next
    })
    toast({ title: t('toasts.ownerPermissionsCopied'), description: t('toasts.ownerPermissionsCopiedDesc') })
  }

  const { mutate: savePerms, isPending } = useMutation({
    mutationFn: async () => {
      if (!owner || !assigned) return
      const rows = assigned.map(p => ({
        owner_id: owner.id,
        property_id: p.id,
        permissions: draft[p.id] ?? defaultOwnerPermissions(),
      }))
      if (rows.length === 0) return
      const { error } = await supabase
        .from('owner_property_permissions')
        .upsert(rows, { onConflict: 'owner_id,property_id' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/owner-permissions', owner?.id] })
      toast({ title: t('toasts.ownerPermissionsSaved') })
      onOpenChange(false)
    },
    onError: (e: any) => toast({ title: t('toasts.permissionsSaveFailed'), description: e?.message, variant: 'destructive' }),
  })

  if (!owner) return null
  const loading = loadingAssigned || loadingPerms

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('ownerPermissions.title', { name: owner.name || owner.email })}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          {t('ownerPermissions.description')}
        </p>

        {loading ? (
          <div className="space-y-2 py-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : !assigned?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t('ownerPermissions.noneAssigned')}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs font-medium text-muted-foreground">{t('ownerPermissions.propertyLabel')}</label>
              <select
                value={selectedPropId ?? ''}
                onChange={e => setSelectedPropId(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs flex-1 min-w-0"
                data-testid="select-perm-property"
              >
                {assigned.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={copyToAll} disabled={assigned.length < 2}>
                {t('ownerPermissions.copyToAll')}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto rounded-lg border border-border mt-1">
              <table className="w-full text-sm">
                <thead className="bg-muted/80 border-b border-border sticky top-0">
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('ownerPermissions.colField')}</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-20">{t('ownerPermissions.colVisible')}</th>
                    <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-20">{t('ownerPermissions.colEditable')}</th>
                  </tr>
                </thead>
                <tbody>
                  {OWNER_FIELD_DEFS.map(f => {
                    const p = current?.[f.key] ?? { visible: true, editable: true }
                    const fieldLabel = t(`ownerPermissions.fieldLabel.${f.key}`, undefined, f.label)
                    return (
                      <tr key={f.key} className="border-b border-border/50">
                        <td className="py-2 px-3 text-xs">{fieldLabel}</td>
                        <td className="py-2 px-3 text-center">
                          <Checkbox
                            checked={p.visible}
                            onCheckedChange={c => setPerm(f.key, { visible: !!c })}
                            aria-label={t('ownerPermissions.visibleAria', { field: fieldLabel })}
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <Checkbox
                            checked={p.editable}
                            disabled={!p.visible}
                            onCheckedChange={c => setPerm(f.key, { editable: !!c })}
                            aria-label={t('ownerPermissions.editableAria', { field: fieldLabel })}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button size="sm" onClick={() => savePerms()} disabled={isPending || loading || !assigned?.length} data-testid="button-save-owner-permissions">
            {isPending ? t('ownerPermissions.saving') : t('ownerPermissions.saveButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Minimal Clients row used by the owner-portal linking UI. */
interface ClientRow {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
}

/** Shared query for the Clients list used by the Add Owner + Link Client dialogs. */
function useClientRows() {
  return useQuery({
    queryKey: ['/supabase/owner-clients'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ClientRow[]> => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, email, phone')
        .order('full_name', { ascending: true })
      if (error) throw error
      return (data || []) as ClientRow[]
    },
  })
}

/**
 * Assigns every property belonging to `contactId` (properties.contact_id) to
 * the owner's portal (owner_properties), skipping ones already assigned.
 * Returns the number of newly assigned properties.
 */
async function autoAssignClientProperties(ownerId: string, contactId: string): Promise<number> {
  const [{ data: props, error: propsErr }, { data: existing, error: existingErr }] = await Promise.all([
    supabase.from('properties').select('id').eq('contact_id', contactId),
    supabase.from('owner_properties').select('property_id').eq('owner_id', ownerId),
  ])
  if (propsErr) throw propsErr
  if (existingErr) throw existingErr
  const have = new Set((existing || []).map(r => r.property_id))
  const missing = (props || []).filter(p => !have.has(p.id))
  if (missing.length === 0) return 0
  const { error } = await supabase
    .from('owner_properties')
    .insert(missing.map(p => ({ owner_id: ownerId, property_id: p.id })))
  if (error) throw error
  return missing.length
}

// Every new portal starts with the standard owner password; the owner can
// change it in their portal's Account Security card (or via Forgot password).
const DEFAULT_OWNER_PASSWORD = 'Tendwellowner1'

function AddOwnerDialog({ open, onOpenChange, owners, prefillContactId }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  owners: OwnerRow[]
  prefillContactId?: string | null
}) {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const { user } = useAuth()
  const qc = useQueryClient()
  const [contactId, setContactId] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState(DEFAULT_OWNER_PASSWORD)
  const [submitting, setSubmitting] = useState(false)

  const { data: clients } = useClientRows()
  const linkedContactIds = useMemo(() => new Set(owners.map(o => o.contact_id).filter(Boolean)), [owners])

  const applyClient = useCallback((id: string) => {
    const c = (clients || []).find(x => x.id === id)
    setContactId(id)
    if (!c) return
    // Prefill from the Clients record; everything stays editable.
    if (c.full_name) setName(c.full_name)
    if (c.email) setEmail(c.email)
    if (c.phone) setPhone(c.phone)
  }, [clients])

  // Deep link from the Clients page: preselect the client once the list loads.
  useEffect(() => {
    if (open && prefillContactId && clients?.length && !contactId) applyClient(prefillContactId)
  }, [open, prefillContactId, clients, contactId, applyClient])

  function reset() {
    setContactId(''); setEmail(''); setName(''); setPhone(''); setPassword(DEFAULT_OWNER_PASSWORD)
  }

  async function handleCreate() {
    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      toast({ title: t('toasts.ownerInvalidEmail'), variant: 'destructive' }); return
    }
    if (password.length < 8) {
      toast({ title: t('toasts.ownerPasswordTooShort'), variant: 'destructive' }); return
    }
    setSubmitting(true)
    try {
      // 1. Mint the Supabase Auth login (service-role, server-side).
      const prov = await provisionOwnerLogin(cleanEmail, password)
      if (!prov.ok) {
        toast({ title: t('toasts.ownerCreateLoginFailed'), description: prov.error, variant: 'destructive' })
        return
      }
      // 2. Create the property_owners record (admin RLS), linked to the
      //    Clients record when one was picked.
      const { data: created, error } = await supabase.from('property_owners').insert({
        email: cleanEmail,
        name: name.trim() || null,
        phone: phone.trim() || null,
        active: true,
        contact_id: contactId || null,
      }).select('id').single()
      if (error) {
        // Unique email → owner already exists.
        if (/unique|duplicate/i.test(error.message)) {
          toast({ title: t('toasts.ownerAlreadyExists'), description: t('toasts.ownerAlreadyExistsDesc'), variant: 'destructive' })
        } else {
          toast({ title: t('toasts.ownerRecordFailed'), description: error.message, variant: 'destructive' })
        }
        return
      }
      // 3. Linked client → assign their properties to the portal automatically.
      let assignedCount = 0
      if (contactId && created?.id) {
        try {
          assignedCount = await autoAssignClientProperties(created.id, contactId)
        } catch (e: any) {
          toast({ title: t('toasts.autoAssignFailed'), description: e?.message, variant: 'destructive' })
        }
      }
      logActivity({
        entity_type: 'other', action: 'create', entity_name: 'property_owner',
        field_name: cleanEmail, changed_by: user?.label ?? null,
      })
      qc.invalidateQueries({ queryKey: ['/supabase/owners'] })
      qc.invalidateQueries({ queryKey: ['/supabase/owner-assignment-counts'] })
      qc.invalidateQueries({ queryKey: ['/supabase/contact-portals'] })
      toast({
        title: t('toasts.ownerCreated'),
        description: [
          prov.created
            ? t('toasts.ownerCreatedDescNew', { email: cleanEmail })
            : t('toasts.ownerCreatedDescExisting'),
          assignedCount > 0 ? t('toasts.propertiesAssigned', { count: assignedCount }) : null,
        ].filter(Boolean).join(' '),
      })
      reset()
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('owners.add.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          {t('owners.add.description')}
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('owners.add.clientLabel')}</label>
            <div className="mt-1">
              <SearchSelect
                value={contactId}
                onSelect={(v) => { if (v) applyClient(v); else setContactId('') }}
                options={(clients || []).map(c => ({
                  value: c.id,
                  label: `${c.full_name || c.email || c.id}${linkedContactIds.has(c.id) ? ` · ${t('owners.add.clientHasPortal')}` : ''}`,
                }))}
                placeholder={t('owners.add.clientPlaceholder')}
                searchPlaceholder={t('owners.add.clientSearchPlaceholder')}
                emptyText={t('owners.add.clientEmpty')}
              />
            </div>
            <p className="text-2xs text-muted-foreground mt-1">
              {contactId ? t('owners.add.autoAssignHint') : t('owners.add.clientNoneHint')}
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('owners.add.emailLabel')}</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="owner@example.com" className="mt-1" data-testid="input-new-owner-email" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('owners.add.nameLabel')}</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Owner" className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('owners.add.phoneLabel')}</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t('owners.add.passwordLabel')}</label>
            <Input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('owners.add.passwordPlaceholder')} className="mt-1" data-testid="input-new-owner-password" />
            <p className="text-2xs text-muted-foreground mt-1">
              {t('owners.add.passwordHint')}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" disabled={submitting} onClick={handleCreate} data-testid="button-confirm-add-owner">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('owners.add.createButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Links an existing portal login to a Clients record: sets
 * property_owners.contact_id (the DB triggers from 20260709_owner_contact_sync
 * then keep phone/payment in sync) and auto-assigns the client's properties.
 * Suggests a match by exact email, falling back to exact name.
 */
function LinkClientDialog({ owner, onOpenChange }: {
  owner: OwnerRow | null
  onOpenChange: (o: boolean) => void
}) {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: clients } = useClientRows()
  const [contactId, setContactId] = useState('')
  const [linking, setLinking] = useState(false)

  const suggestion = useMemo(() => {
    if (!owner || !clients) return null
    const byEmail = clients.find(c => c.email && c.email.toLowerCase() === owner.email.toLowerCase())
    if (byEmail) return byEmail
    if (owner.name) {
      const byName = clients.find(c => c.full_name && c.full_name.trim().toLowerCase() === owner.name!.trim().toLowerCase())
      if (byName) return byName
    }
    return null
  }, [owner, clients])

  // Preselect the suggested match each time the dialog opens for an owner.
  useEffect(() => {
    setContactId(suggestion?.id ?? '')
  }, [owner?.id, suggestion?.id])

  async function handleLink() {
    if (!owner || !contactId) return
    setLinking(true)
    try {
      const { error } = await supabase.from('property_owners').update({ contact_id: contactId }).eq('id', owner.id)
      if (error) {
        toast({ title: t('toasts.ownerLinkFailed'), description: error.message, variant: 'destructive' })
        return
      }
      let assignedCount = 0
      try {
        assignedCount = await autoAssignClientProperties(owner.id, contactId)
      } catch (e: any) {
        toast({ title: t('toasts.autoAssignFailed'), description: e?.message, variant: 'destructive' })
      }
      logActivity({
        entity_type: 'other', action: 'update', entity_name: 'property_owner',
        field_name: 'contact_id', new_value: contactId, changed_by: user?.label ?? null,
      })
      qc.invalidateQueries({ queryKey: ['/supabase/owners'] })
      qc.invalidateQueries({ queryKey: ['/supabase/owner-assignment-counts'] })
      qc.invalidateQueries({ queryKey: ['/supabase/contact-portals'] })
      const clientName = clients?.find(c => c.id === contactId)?.full_name || ''
      toast({
        title: t('toasts.ownerLinked', { name: clientName }),
        description: assignedCount > 0 ? t('toasts.propertiesAssigned', { count: assignedCount }) : t('toasts.noNewProperties'),
      })
      onOpenChange(false)
    } finally {
      setLinking(false)
    }
  }

  return (
    <Dialog open={!!owner} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('owners.link.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">{t('owners.link.description')}</p>
        <div className="space-y-2">
          <SearchSelect
            value={contactId}
            onSelect={(v) => setContactId(v)}
            options={(clients || []).map(c => ({ value: c.id, label: c.full_name || c.email || c.id }))}
            placeholder={t('owners.add.clientPlaceholder')}
            searchPlaceholder={t('owners.add.clientSearchPlaceholder')}
            emptyText={t('owners.add.clientEmpty')}
          />
          {suggestion && contactId === suggestion.id && (
            <p className="text-2xs text-muted-foreground">
              {t('owners.link.suggested', { name: suggestion.full_name || suggestion.email || '' })}
            </p>
          )}
          <p className="text-2xs text-muted-foreground">{t('owners.add.autoAssignHint')}</p>
        </div>
        <DialogFooter>
          <Button size="sm" disabled={linking || !contactId} onClick={handleLink} data-testid="button-confirm-link-client">
            {linking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('owners.link.saveButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Admin change of an owner's portal login email. Server-side at
 * /api/owners/admin-change-email: updates the Supabase Auth email (when a
 * login exists) and property_owners.email in place; the contact-sync trigger
 * mirrors it to the linked Clients record.
 */
function ChangeOwnerEmailDialog({ owner, onOpenChange }: {
  owner: OwnerRow | null
  onOpenChange: (o: boolean) => void
}) {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const { user } = useAuth()
  const qc = useQueryClient()
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setNewEmail('') }, [owner?.id])

  async function handleSave() {
    if (!owner) return
    setSaving(true)
    try {
      const result = await adminChangeOwnerEmail(owner.id, newEmail.trim().toLowerCase())
      if (!result.ok) {
        toast({ title: t('toasts.ownerEmailChangeFailed'), description: result.error, variant: 'destructive' })
        return
      }
      logActivity({
        entity_type: 'other', action: 'update', entity_name: 'property_owner',
        field_name: 'email', old_value: owner.email, new_value: newEmail.trim().toLowerCase(),
        changed_by: user?.label ?? null,
      })
      qc.invalidateQueries({ queryKey: ['/supabase/owners'] })
      qc.invalidateQueries({ queryKey: ['/supabase/owner-clients'] })
      toast({ title: t('toasts.ownerEmailChanged') })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!owner} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('owners.changeEmail.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">{t('owners.changeEmail.description')}</p>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('owners.changeEmail.currentLabel')}: <span className="font-medium text-foreground">{owner?.email}</span></p>
          <Input
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder={t('owners.changeEmail.newEmailPlaceholder')}
            data-testid="input-admin-change-owner-email"
          />
        </div>
        <DialogFooter>
          <Button size="sm" disabled={saving || !newEmail.trim()} onClick={handleSave} data-testid="button-confirm-change-owner-email">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('owners.changeEmail.saveButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OwnersSection() {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const qc = useQueryClient()
  const { user, requestPasswordReset } = useAuth()
  const [search, setSearch] = useState('')
  const [emailOwner, setEmailOwner] = useState<OwnerRow | null>(null)
  // Deep link from the Clients page: /settings?tab=owners&portalFor=<contactId>
  // opens the Add Owner dialog with that client preselected.
  const [portalForContact] = useState<string | null>(() => new URLSearchParams(window.location.search).get('portalFor'))
  const [addOpen, setAddOpen] = useState(() => !!portalForContact)
  const [linkOwner, setLinkOwner] = useState<OwnerRow | null>(null)
  const [assignOwner, setAssignOwner] = useState<OwnerRow | null>(null)
  const [permsOwner, setPermsOwner] = useState<OwnerRow | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editTrellisUrl, setEditTrellisUrl] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const { data: owners, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/owners'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<OwnerRow[]> => {
      const { data, error } = await supabase
        .from('property_owners')
        .select('id, email, name, phone, active, created_at, trellis_portal_url, preferred_payment_method, contact_id')
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data || []) as OwnerRow[]
    },
  })

  // Clients lookup for the sync column (contact_id → client name).
  const { data: clientRows } = useClientRows()
  const clientsById = useMemo(() => new Map((clientRows || []).map(c => [c.id, c])), [clientRows])

  // Per-owner property counts (one query, grouped client-side).
  const { data: counts } = useQuery({
    queryKey: ['/supabase/owner-assignment-counts'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('owner_properties').select('owner_id')
      if (error) throw error
      const m = new Map<string, number>()
      for (const r of (data || [])) m.set(r.owner_id, (m.get(r.owner_id) || 0) + 1)
      return m
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return owners || []
    return (owners || []).filter(o =>
      (o.name || '').toLowerCase().includes(q) || o.email.toLowerCase().includes(q)
    )
  }, [owners, search])

  const { mutate: toggleActive } = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('property_owners').update({ active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['/supabase/owners'] })
      toast({ title: v.active ? t('toasts.ownerAccessEnabled') : t('toasts.ownerAccessDisabled') })
    },
    onError: (e: any) => toast({ title: t('toasts.ownerUpdateFailed'), description: e?.message, variant: 'destructive' }),
  })

  const { mutate: saveProfile } = useMutation({
    mutationFn: async ({ id, name, phone, trellis_portal_url }: { id: string; name: string; phone: string; trellis_portal_url: string }) => {
      const { error } = await supabase
        .from('property_owners')
        .update({ name: name.trim() || null, phone: phone.trim() || null, trellis_portal_url: trellis_portal_url.trim() || null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/owners'] })
      setEditingId(null)
      toast({ title: t('toasts.ownerUpdated') })
    },
    onError: (e: any) => toast({ title: t('toasts.ownerUpdateFailed'), description: e?.message, variant: 'destructive' }),
  })

  const { mutate: deleteOwner, isPending: deleting } = useMutation({
    mutationFn: async (owner: OwnerRow) => {
      // Remove the record first (cascades owner_properties), then the auth login.
      const { error } = await supabase.from('property_owners').delete().eq('id', owner.id)
      if (error) throw error
      await deleteOwnerLogin(owner.email) // best-effort cleanup
    },
    onSuccess: (_d, owner) => {
      qc.invalidateQueries({ queryKey: ['/supabase/owners'] })
      qc.invalidateQueries({ queryKey: ['/supabase/owner-assignment-counts'] })
      logActivity({
        entity_type: 'other', action: 'delete', entity_name: 'property_owner',
        field_name: owner.email, changed_by: user?.label ?? null,
      })
      toast({ title: t('toasts.ownerRemoved') })
      setConfirmDeleteId(null)
    },
    onError: (e: any) => {
      toast({ title: t('toasts.ownerRemoveFailed'), description: e?.message, variant: 'destructive' })
      setConfirmDeleteId(null)
    },
  })

  async function handleSendReset(email: string) {
    const { error } = await requestPasswordReset(email)
    if (error) toast({ title: t('toasts.resetEmailFailed'), description: error, variant: 'destructive' })
    else toast({ title: t('toasts.resetEmailSent'), description: t('toasts.resetEmailSentDesc', { email }) })
  }

  function startEdit(o: OwnerRow) {
    setEditingId(o.id)
    setEditName(o.name || '')
    setEditPhone(o.phone || '')
    setEditTrellisUrl(o.trellis_portal_url || '')
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-medium flex items-center gap-2">
              <Home className="w-4 h-4" />
              {t('owners.heading')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('owners.description')}
            </p>
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)} data-testid="button-add-owner">
            <UserPlus className="w-3.5 h-3.5" />
            {t('owners.addOwner')}
          </Button>
        </div>

        <div className="relative max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('owners.searchPlaceholder')} className="h-8 text-xs pl-8" />
        </div>

        {isError ? (
          <ErrorState title={t('owners.errorTitle')} onRetry={() => refetch()} />
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/80 border-b border-border">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('owners.colOwner')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('owners.colEmail')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('owners.colPhone')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('owners.colPayment')}</th>
                  <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('owners.colProperties')}</th>
                  <th className="text-center text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('owners.colActive')}</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('owners.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(3)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {[...Array(7)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}
                    </tr>
                  ))
                ) : !filtered.length ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">{t('owners.noOwners')}</td></tr>
                ) : (
                  filtered.map(o => (
                    <React.Fragment key={o.id}>
                      <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors" data-testid={`row-owner-${o.id}`}>
                        <td className="py-2 px-3 font-medium text-xs">
                          {editingId === o.id ? (
                            <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-7 text-xs" placeholder={t('owners.add.nameLabel')} autoFocus />
                          ) : (
                            o.name || <span className="italic text-muted-foreground">{t('owners.noName')}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          <button
                            className="hover:underline underline-offset-2 hover:text-foreground text-left"
                            onClick={() => setEmailOwner(o)}
                            title={t('owners.changeEmail.cellTitle')}
                            data-testid={`button-change-owner-email-${o.id}`}
                          >
                            {o.email}
                          </button>
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          {editingId === o.id ? (
                            <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} className="h-7 text-xs" placeholder={t('owners.add.phoneLabel')} />
                          ) : (
                            <div className="space-y-0.5">
                              <div>{o.phone || <span className="italic">-</span>}</div>
                              {o.trellis_portal_url ? (
                                <a
                                  href={o.trellis_portal_url.startsWith('http') ? o.trellis_portal_url : undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-2xs text-primary hover:underline"
                                  title={o.trellis_portal_url}
                                >
                                  <ExternalLink className="w-3 h-3" /> {t('owners.trellisLinked')}
                                </a>
                              ) : (
                                <span className="text-2xs text-muted-foreground/60 italic">{t('owners.noTrellisLink')}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-xs">
                          <div className="space-y-0.5">
                            <div className="text-muted-foreground">{o.preferred_payment_method || <span className="italic">-</span>}</div>
                            {o.contact_id ? (
                              <Link href="/contacts" className="inline-flex items-center gap-1 text-2xs text-primary hover:underline" title={t('owners.syncedToClientsTitle')}>
                                <ExternalLink className="w-3 h-3" /> {clientsById?.get(o.contact_id)?.full_name || t('owners.syncedToClients')}
                              </Link>
                            ) : (
                              <button
                                className="text-2xs text-warning hover:underline underline-offset-2"
                                onClick={() => setLinkOwner(o)}
                                title={t('owners.link.title')}
                                data-testid={`button-link-client-${o.id}`}
                              >
                                {t('owners.linkClient')}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            className="text-xs underline-offset-2 hover:underline text-muted-foreground hover:text-foreground"
                            onClick={() => setAssignOwner(o)}
                            title={t('owners.manageAccessTitle')}
                          >
                            {counts?.get(o.id) ?? 0}
                          </button>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <Switch
                            checked={o.active}
                            onCheckedChange={(v) => toggleActive({ id: o.id, active: !!v })}
                            aria-label={t('owners.toggleAccessAria')}
                          />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {editingId === o.id ? (
                              <>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => saveProfile({ id: o.id, name: editName, phone: editPhone, trellis_portal_url: editTrellisUrl })} title={t('owners.saveTitle')}>
                                  <Check className="w-3.5 h-3.5 text-success" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingId(null)} title={t('owners.cancelTitle')}>
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={() => setAssignOwner(o)} title={t('owners.manageAccessTitle')}>
                                  <Home className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={() => setPermsOwner(o)} title={t('owners.fieldPermissionsTitle')} data-testid={`button-owner-permissions-${o.id}`}>
                                  <SlidersHorizontal className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={() => startEdit(o)} title={t('owners.editTitle')}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={() => handleSendReset(o.email)} title={t('owners.sendResetTitle')}>
                                  <Mail className="w-3.5 h-3.5" />
                                </Button>
                                {confirmDeleteId === o.id ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs text-muted-foreground">{t('owners.removeConfirm')}</span>
                                    <Button variant="destructive" size="sm" className="h-6 px-2 text-xs" disabled={deleting} onClick={() => deleteOwner(o)} data-testid={`button-confirm-delete-owner-${o.id}`}>
                                      {deleting ? t('owners.removing') : t('common.actions.confirm')}
                                    </Button>
                                    <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={deleting} onClick={() => setConfirmDeleteId(null)}>{t('common.actions.cancel')}</Button>
                                  </div>
                                ) : (
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDeleteId(o.id)} aria-label={t('owners.removeAria', { email: o.email })} data-testid={`button-delete-owner-${o.id}`}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {editingId === o.id && (
                        <tr className="border-b border-border/50 bg-muted/10">
                          <td colSpan={7} className="px-3 pb-3 pt-1">
                            <label className="block text-2xs text-muted-foreground mb-1">{t('owners.trellisUrlLabel')}</label>
                            <Input
                              value={editTrellisUrl}
                              onChange={e => setEditTrellisUrl(e.target.value)}
                              className="h-7 text-xs font-mono"
                              placeholder={t('owners.trellisUrlPlaceholder')}
                              data-testid={`input-trellis-url-${o.id}`}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-2xs text-muted-foreground">
          {t('owners.footerNote')}
        </p>
      </div>

      <AddOwnerDialog open={addOpen} onOpenChange={setAddOpen} owners={owners || []} prefillContactId={portalForContact} />
      <LinkClientDialog owner={linkOwner} onOpenChange={(o) => { if (!o) setLinkOwner(null) }} />
      <ChangeOwnerEmailDialog owner={emailOwner} onOpenChange={(o) => { if (!o) setEmailOwner(null) }} />
      <AssignPropertiesDialog owner={assignOwner} open={!!assignOwner} onOpenChange={(o) => { if (!o) setAssignOwner(null) }} />
      <OwnerPermissionsDialog owner={permsOwner} open={!!permsOwner} onOpenChange={(o) => { if (!o) setPermsOwner(null) }} />
    </>
  )
}

// ─── Agreements Section (admin: signer config + send/list agreements) ────────

type AgreementConfig = {
  id: number
  tendwell_signer_name: string | null
  tendwell_signer_title: string | null
  tendwell_signature_png: string | null
  updated_at: string | null
}

type OwnerAgreementRow = {
  id: string
  owner_id: string
  status: 'sent' | 'signed' | 'void'
  effective_date: string | null
  owner_name: string | null
  email: string | null
  created_at: string
  property_owners: { name: string | null; email: string | null } | null
}

type OwnerForSend = {
  id: string
  name: string | null
  email: string
  phone: string | null
  active: boolean
}

type PropertyForSend = {
  owner_id: string
  property_id: string
  address: string | null
  name: string | null
}

const AGREEMENT_STATUS_TONE: Record<string, StatusTone> = {
  sent: 'info',
  signed: 'success',
  void: 'neutral',
}

function AgreementsSection() {
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')
  const qc = useQueryClient()
  const { user } = useAuth()

  // ── Signer config ──
  const [signerName, setSignerName] = useState('')
  const [signerTitle, setSignerTitle] = useState('')
  const [newSigPng, setNewSigPng] = useState<string | null>(null)
  const [showPad, setShowPad] = useState(false)

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['agreement-config'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AgreementConfig | null> => {
      const { data, error } = await supabase
        .from('agreement_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle()
      if (error) throw error
      return data as AgreementConfig | null
    },
  })

  // Sync form when config loads
  useEffect(() => {
    if (config) {
      setSignerName(config.tendwell_signer_name || '')
      setSignerTitle(config.tendwell_signer_title || '')
    }
  }, [config])

  const { mutate: saveConfig, isPending: savingConfig } = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {
        tendwell_signer_name: signerName.trim() || null,
        tendwell_signer_title: signerTitle.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (newSigPng) patch.tendwell_signature_png = newSigPng
      const { error } = await supabase
        .from('agreement_config')
        .update(patch)
        .eq('id', 1)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agreement-config'] })
      setNewSigPng(null)
      setShowPad(false)
      toast({ title: t('toasts.signerConfigSaved') })
    },
    onError: (e: any) => toast({ title: t('toasts.signerConfigSaveFailed'), description: e?.message, variant: 'destructive' }),
  })

  // ── Send agreement dialog ──
  const [sendOpen, setSendOpen] = useState(false)
  const [ownerSearch, setOwnerSearch] = useState('')
  const [selectedOwner, setSelectedOwner] = useState<OwnerForSend | null>(null)
  const [sendForm, setSendForm] = useState({
    owner_name: '',
    email: '',
    phone: '',
    entity: '',
    mailing_address: '',
    property_addresses: '',
    effective_date: new Date().toISOString().slice(0, 10),
  })

  const { data: owners } = useQuery({
    queryKey: ['/supabase/owners-for-agreements'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<OwnerForSend[]> => {
      const { data, error } = await supabase
        .from('property_owners')
        .select('id, name, email, phone, active')
        .eq('active', true)
        .order('name', { ascending: true })
      if (error) throw error
      return (data || []) as OwnerForSend[]
    },
    enabled: sendOpen,
  })

  const { data: ownerProps } = useQuery({
    queryKey: ['/supabase/owner-props-for-agreements', selectedOwner?.id],
    enabled: !!selectedOwner,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<PropertyForSend[]> => {
      if (!selectedOwner) return []
      const { data, error } = await supabase
        .from('owner_properties')
        .select('owner_id, property_id, properties(address, name)')
        .eq('owner_id', selectedOwner.id)
      if (error) throw error
      return ((data || []) as any[]).map((r: any) => ({
        owner_id: r.owner_id,
        property_id: r.property_id,
        address: r.properties?.address ?? null,
        name: r.properties?.name ?? null,
      }))
    },
  })

  // Check if selected owner already has a non-void agreement
  const { data: existingAgreements } = useQuery({
    queryKey: ['owner-agreements-admin'],
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<OwnerAgreementRow[]> => {
      const { data, error } = await supabase
        .from('owner_agreements')
        .select('id, owner_id, status, effective_date, owner_name, email, created_at, property_owners(name, email)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as unknown as OwnerAgreementRow[]
    },
  })

  const ownerHasActiveAgreement = useMemo(() => {
    if (!selectedOwner || !existingAgreements) return false
    return existingAgreements.some(
      a => a.owner_id === selectedOwner.id && (a.status === 'sent' || a.status === 'signed')
    )
  }, [selectedOwner, existingAgreements])

  // Prefill form when owner selected
  useEffect(() => {
    if (!selectedOwner) return
    setSendForm(f => ({
      ...f,
      owner_name: selectedOwner.name || '',
      email: selectedOwner.email || '',
      phone: selectedOwner.phone || '',
    }))
  }, [selectedOwner])

  // Prefill property_addresses when properties load
  useEffect(() => {
    if (!ownerProps) return
    const addrs = ownerProps
      .map(p => p.address ?? p.name ?? '')
      .filter(Boolean)
      .join('; ')
    setSendForm(f => ({ ...f, property_addresses: addrs }))
  }, [ownerProps])

  const filteredOwners = useMemo(() => {
    const q = ownerSearch.trim().toLowerCase()
    if (!q) return owners || []
    return (owners || []).filter(o =>
      (o.name || '').toLowerCase().includes(q) || o.email.toLowerCase().includes(q)
    )
  }, [owners, ownerSearch])

  const canSend = !!(
    config?.tendwell_signature_png &&
    config?.tendwell_signer_name &&
    selectedOwner &&
    !ownerHasActiveAgreement
  )

  const { mutate: sendAgreement, isPending: sending } = useMutation({
    mutationFn: async () => {
      if (!selectedOwner || !config) throw new Error(t('agreements.missingDataError'))
      if (!config?.tendwell_signature_png || !config?.tendwell_signer_name) throw new Error(t('agreements.needSignatureError'))
      if (ownerHasActiveAgreement) throw new Error(t('agreements.activeAgreementError'))
      const { error } = await supabase.from('owner_agreements').insert({
        owner_id: selectedOwner.id,
        status: 'sent',
        effective_date: sendForm.effective_date || null,
        owner_name: sendForm.owner_name.trim() || null,
        entity: sendForm.entity.trim() || null,
        mailing_address: sendForm.mailing_address.trim() || null,
        property_addresses: sendForm.property_addresses.trim() || null,
        email: sendForm.email.trim() || null,
        phone: sendForm.phone.trim() || null,
        tendwell_signer_name: config.tendwell_signer_name,
        tendwell_signer_title: config.tendwell_signer_title,
        tendwell_signed_at: new Date().toISOString(),
        created_by: user?.label?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-agreements-admin'] })
      setSendOpen(false)
      setSelectedOwner(null)
      setOwnerSearch('')
      setSendForm({
        owner_name: '', email: '', phone: '', entity: '',
        mailing_address: '', property_addresses: '',
        effective_date: new Date().toISOString().slice(0, 10),
      })
      toast({ title: t('toasts.agreementSent'), description: t('toasts.agreementSentDesc') })
    },
    onError: (e: any) => toast({ title: t('toasts.agreementSendFailed'), description: e?.message, variant: 'destructive' }),
  })

  // ── Void agreement ──
  const { mutate: voidAgreement } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('owner_agreements')
        .update({ status: 'void' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-agreements-admin'] })
      toast({ title: t('toasts.agreementVoided') })
    },
    onError: (e: any) => toast({ title: t('toasts.agreementVoidFailed'), description: e?.message, variant: 'destructive' }),
  })

  async function handleDownload(id: string) {
    const result = await downloadAgreementPdf(id)
    if (!result.ok) {
      toast({ title: t('toasts.agreementDownloadFailed'), description: result.error, variant: 'destructive' })
    }
  }

  const currentSig = newSigPng || config?.tendwell_signature_png || null

  return (
    <div className="space-y-6">
      {/* ── Signer setup card ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-medium flex items-center gap-2">
              <FileText className="w-4 h-4" />
              {t('agreements.heading')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('agreements.description')}
            </p>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setSendOpen(true)}
            data-testid="button-send-agreement"
          >
            <Send className="w-3.5 h-3.5" />
            {t('agreements.sendButton')}
          </Button>
        </div>

        <div className="rounded-xl border border-border p-4 space-y-4">
          <h3 className="text-sm font-medium">{t('agreements.signerSetupTitle')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-2xs text-muted-foreground uppercase tracking-wide">{t('agreements.signerNameLabel')}</label>
              <Input
                value={signerName}
                onChange={e => setSignerName(e.target.value)}
                placeholder={t('agreements.signerNamePlaceholder')}
                className="h-8 text-sm"
                data-testid="input-signer-name"
                disabled={configLoading}
              />
            </div>
            <div className="space-y-1">
              <label className="text-2xs text-muted-foreground uppercase tracking-wide">{t('agreements.signerTitleLabel')}</label>
              <Input
                value={signerTitle}
                onChange={e => setSignerTitle(e.target.value)}
                placeholder={t('agreements.signerTitlePlaceholder')}
                className="h-8 text-sm"
                data-testid="input-signer-title"
                disabled={configLoading}
              />
            </div>
          </div>

          {/* Signature preview or pad */}
          <div className="space-y-2">
            <label className="text-2xs text-muted-foreground uppercase tracking-wide">{t('agreements.signatureLabel')}</label>
            {currentSig && !showPad ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-border bg-white p-3 inline-block">
                  <img
                    src={currentSig}
                    alt={t('agreements.currentSignatureAlt')}
                    className="h-20 object-contain"
                    data-testid="img-current-signature"
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setShowPad(true); setNewSigPng(null) }}
                    data-testid="button-draw-new-signature"
                  >
                    {t('agreements.drawNewSignature')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <SignaturePad
                  onChange={setNewSigPng}
                  height={140}
                  data-testid="signature-pad"
                />
                {currentSig && showPad && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setShowPad(false); setNewSigPng(null) }}
                  >
                    {t('common.actions.cancel')}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => saveConfig()}
              disabled={savingConfig || configLoading}
              data-testid="button-save-signer-config"
            >
              {savingConfig ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{t('agreements.saving')}</> : t('agreements.save')}
            </Button>
            {!config?.tendwell_signature_png && !newSigPng && (
              <p className="text-2xs text-warning">{t('agreements.needSignatureWarning')}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Agreements list ── */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t('agreements.listHeading')}</h3>
        {!existingAgreements ? (
          <p className="text-sm text-muted-foreground">{t('agreements.loading')}</p>
        ) : existingAgreements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('agreements.noAgreements')}</p>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/80 border-b border-border">
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('agreements.colOwner')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('agreements.colStatus')}</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('agreements.colSent')}</th>
                  <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">{t('agreements.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {existingAgreements.map(row => (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-3 text-xs">
                      <div className="font-medium">{row.property_owners?.name || row.owner_name || '—'}</div>
                      <div className="text-muted-foreground">{row.property_owners?.email || row.email || ''}</div>
                    </td>
                    <td className="py-2 px-3">
                      <StatusBadge tone={AGREEMENT_STATUS_TONE[row.status] ?? 'neutral'}>
                        {t(`agreements.status.${row.status}`, undefined, row.status)}
                      </StatusBadge>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {row.status === 'signed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs gap-1"
                            onClick={() => handleDownload(row.id)}
                            data-testid={`button-download-agreement-${row.id}`}
                          >
                            <Download className="w-3 h-3" />
                            {t('agreements.download')}
                          </Button>
                        )}
                        {row.status === 'sent' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (confirm(t('agreements.confirmVoid'))) {
                                voidAgreement(row.id)
                              }
                            }}
                            data-testid={`button-void-agreement-${row.id}`}
                          >
                            <XCircle className="w-3 h-3" />
                            {t('agreements.void')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Send Agreement Dialog ── */}
      <Dialog open={sendOpen} onOpenChange={(o) => { if (!o) { setSendOpen(false); setSelectedOwner(null); setOwnerSearch('') } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('agreements.send.dialogTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Owner picker */}
            {!selectedOwner ? (
              <div className="space-y-2">
                <label className="text-2xs text-muted-foreground uppercase tracking-wide">{t('agreements.send.selectOwnerLabel')}</label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={ownerSearch}
                    onChange={e => setOwnerSearch(e.target.value)}
                    placeholder={t('agreements.send.searchPlaceholder')}
                    className="h-8 text-xs pl-8"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border/50">
                  {!owners ? (
                    <p className="text-xs text-muted-foreground p-3">{t('agreements.send.loading')}</p>
                  ) : filteredOwners.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3">{t('agreements.send.noActiveOwners')}</p>
                  ) : (
                    filteredOwners.map(o => (
                      <button
                        key={o.id}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted/30 transition-colors"
                        onClick={() => setSelectedOwner(o)}
                        data-testid={`button-select-owner-${o.id}`}
                      >
                        <div className="font-medium">{o.name || <span className="italic text-muted-foreground">{t('agreements.send.noName')}</span>}</div>
                        <div className="text-muted-foreground">{o.email}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">{selectedOwner.name || selectedOwner.email}</p>
                    <p className="text-2xs text-muted-foreground">{selectedOwner.email}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => { setSelectedOwner(null); setOwnerSearch('') }}
                  >
                    {t('agreements.send.change')}
                  </Button>
                </div>

                {ownerHasActiveAgreement && (
                  <div className="rounded-lg bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning">
                    {t('agreements.send.activeAgreementWarning')}
                  </div>
                )}

                {!config?.tendwell_signature_png && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                    {t('agreements.send.needSignatureWarning')}
                  </div>
                )}

                {/* Party fields */}
                <div className="space-y-3">
                  <p className="text-2xs text-muted-foreground uppercase tracking-wide">{t('agreements.send.partyFieldsLabel')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1 col-span-2 sm:col-span-1">
                      <label className="text-2xs text-muted-foreground">{t('agreements.send.ownerNameLabel')}</label>
                      <Input value={sendForm.owner_name} onChange={e => setSendForm(f => ({ ...f, owner_name: e.target.value }))} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1 col-span-2 sm:col-span-1">
                      <label className="text-2xs text-muted-foreground">{t('agreements.send.entityLabel')}</label>
                      <Input value={sendForm.entity} onChange={e => setSendForm(f => ({ ...f, entity: e.target.value }))} className="h-8 text-xs" placeholder={t('agreements.send.entityPlaceholder')} />
                    </div>
                    <div className="space-y-1 col-span-2 sm:col-span-1">
                      <label className="text-2xs text-muted-foreground">{t('agreements.send.emailLabel')}</label>
                      <Input value={sendForm.email} onChange={e => setSendForm(f => ({ ...f, email: e.target.value }))} className="h-8 text-xs" type="email" />
                    </div>
                    <div className="space-y-1 col-span-2 sm:col-span-1">
                      <label className="text-2xs text-muted-foreground">{t('agreements.send.phoneLabel')}</label>
                      <Input value={sendForm.phone} onChange={e => setSendForm(f => ({ ...f, phone: e.target.value }))} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-2xs text-muted-foreground">{t('agreements.send.mailingAddressLabel')}</label>
                      <Input value={sendForm.mailing_address} onChange={e => setSendForm(f => ({ ...f, mailing_address: e.target.value }))} className="h-8 text-xs" placeholder={t('agreements.send.mailingAddressPlaceholder')} />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-2xs text-muted-foreground">{t('agreements.send.propertyAddressesLabel')}</label>
                      <Input value={sendForm.property_addresses} onChange={e => setSendForm(f => ({ ...f, property_addresses: e.target.value }))} className="h-8 text-xs" placeholder={t('agreements.send.propertyAddressesPlaceholder')} />
                    </div>
                    <div className="space-y-1 col-span-2 sm:col-span-1">
                      <label className="text-2xs text-muted-foreground">{t('agreements.send.effectiveDateLabel')}</label>
                      <input
                        type="date"
                        value={sendForm.effective_date}
                        onChange={e => setSendForm(f => ({ ...f, effective_date: e.target.value }))}
                        className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setSendOpen(false); setSelectedOwner(null); setOwnerSearch('') }}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={!canSend || sending}
              onClick={() => sendAgreement()}
              data-testid="button-confirm-send-agreement"
              title={!config?.tendwell_signature_png ? t('agreements.send.needSignatureWarning') : ownerHasActiveAgreement ? t('agreements.send.activeAgreementTitle') : undefined}
            >
              {sending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{t('agreements.send.sending')}</> : t('agreements.send.sendButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Referrals Section (owner-submitted referrals management) ─────────────────
type AdminReferral = {
  id: string
  owner_id: string
  referred_name: string
  referred_email: string | null
  referred_phone: string | null
  note: string | null
  status: string
  reward_status: string
  reward_note: string | null
  created_at: string
  property_owners: { name: string | null; email: string | null } | null
}

const REFERRAL_STATUSES = ['submitted', 'contacted', 'converted', 'declined']
const REFERRAL_REWARDS = ['pending', 'earned', 'paid']

function ReferralsSection() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-referrals'],
    queryFn: async (): Promise<AdminReferral[]> => {
      const { data, error } = await supabase
        .from('owner_referrals')
        .select('id, owner_id, referred_name, referred_email, referred_phone, note, status, reward_status, reward_note, created_at, property_owners(name, email)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as any as AdminReferral[]
    },
  })

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, any>; ownerId?: string; referredName?: string }) => {
      const { error } = await supabase.from('owner_referrals').update(patch as any).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-referrals'] })
      if (vars.patch.status && vars.ownerId) notifyOwner(vars.ownerId, 'referral_update', { status: vars.patch.status, referredName: vars.referredName })
    },
    onError: (e: any) => toast({ title: t('toasts.updateFailed'), description: e?.message ?? t('toasts.updateFailedDesc'), variant: 'destructive' }),
  })

  const rows = data ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('referrals.heading')}</h2>
        <p className="text-sm text-muted-foreground">{t('referrals.description')}</p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">{t('referrals.loading')}</p>}
      {isError && <Button variant="outline" size="sm" onClick={() => refetch()}>{t('referrals.retry')}</Button>}
      {!isLoading && !isError && rows.length === 0 && <p className="text-sm text-muted-foreground">{t('referrals.empty')}</p>}
      <div className="space-y-3">
        {rows.map(r => (
          <div key={r.id} className="rounded-xl border border-border p-4 space-y-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{r.referred_name}</p>
              <p className="text-xs text-muted-foreground">{[r.referred_email, r.referred_phone].filter(Boolean).join(' · ') || '—'}</p>
              <p className="text-xs text-muted-foreground">
                {t('referrals.referredBy', { name: r.property_owners?.name || r.property_owners?.email || t('referrals.ownerFallback'), date: new Date(r.created_at).toLocaleDateString() })}
              </p>
              {r.note && <p className="text-xs text-foreground/80 mt-1">&ldquo;{r.note}&rdquo;</p>}
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                {t('referrals.statusLabel')}
                <select
                  className="border border-border rounded-md px-2 py-1 text-sm bg-background"
                  value={r.status}
                  onChange={e => update.mutate({ id: r.id, ownerId: r.owner_id, referredName: r.referred_name, patch: { status: e.target.value } })}
                  data-testid={`select-referral-status-${r.id}`}
                >
                  {REFERRAL_STATUSES.map(s => <option key={s} value={s}>{t(`referrals.status.${s}`, undefined, s)}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                {t('referrals.rewardLabel')}
                <select
                  className="border border-border rounded-md px-2 py-1 text-sm bg-background"
                  value={r.reward_status}
                  onChange={e => update.mutate({ id: r.id, patch: { reward_status: e.target.value } })}
                  data-testid={`select-referral-reward-${r.id}`}
                >
                  {REFERRAL_REWARDS.map(s => <option key={s} value={s}>{t(`referrals.reward.${s}`, undefined, s)}</option>)}
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Testimonials Section (owner-submitted testimonials review) ────────────────
type AdminTestimonial = {
  id: string
  owner_id: string
  rating: number | null
  body: string
  display_preference: string
  allow_photo: boolean
  status: string
  admin_note: string | null
  created_at: string
  property_owners: { name: string | null; email: string | null } | null
}

const TESTIMONIAL_STATUSES = ['submitted', 'approved', 'published', 'declined']

function TestimonialsSection() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-testimonials'],
    queryFn: async (): Promise<AdminTestimonial[]> => {
      const { data, error } = await supabase
        .from('owner_testimonials')
        .select('id, owner_id, rating, body, display_preference, allow_photo, status, admin_note, created_at, property_owners(name, email)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as any as AdminTestimonial[]
    },
  })

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, any>; ownerId?: string }) => {
      const { error } = await supabase.from('owner_testimonials').update(patch as any).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-testimonials'] })
      if (vars.patch.status && vars.ownerId) notifyOwner(vars.ownerId, 'testimonial_update', { status: vars.patch.status })
    },
    onError: (e: any) => toast({ title: t('toasts.updateFailed'), description: e?.message ?? t('toasts.updateFailedDesc'), variant: 'destructive' }),
  })

  const rows = data ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('testimonials.heading')}</h2>
        <p className="text-sm text-muted-foreground">{t('testimonials.description')}</p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">{t('testimonials.loading')}</p>}
      {isError && <Button variant="outline" size="sm" onClick={() => refetch()}>{t('testimonials.retry')}</Button>}
      {!isLoading && !isError && rows.length === 0 && <p className="text-sm text-muted-foreground">{t('testimonials.empty')}</p>}
      <div className="space-y-3">
        {rows.map(item => (
          <div key={item.id} className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-amber-500">{item.rating ? '★'.repeat(item.rating) : t('testimonials.noRating')}</p>
                <p className="text-sm text-foreground/90 mt-0.5">&ldquo;{item.body}&rdquo;</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {item.property_owners?.name || item.property_owners?.email || t('testimonials.ownerFallback')} · {t('testimonials.showAsPrefix')}{t(`testimonials.displayPreference.${item.display_preference}`, undefined, item.display_preference.replace('_', ' '))}
                  {item.allow_photo ? t('testimonials.photoOk') : ''} · {new Date(item.created_at).toLocaleDateString()}
                </p>
              </div>
              <select
                className="border border-border rounded-md px-2 py-1 text-sm bg-background shrink-0"
                value={item.status}
                onChange={e => update.mutate({ id: item.id, ownerId: item.owner_id, patch: { status: e.target.value } })}
                data-testid={`select-testimonial-status-${item.id}`}
              >
                {TESTIMONIAL_STATUSES.map(s => <option key={s} value={s}>{t(`testimonials.status.${s}`, undefined, s)}</option>)}
              </select>
            </div>
            <Input
              defaultValue={item.admin_note ?? ''}
              placeholder={t('testimonials.notePlaceholder')}
              className="text-sm"
              onBlur={e => { if (e.target.value !== (item.admin_note ?? '')) update.mutate({ id: item.id, patch: { admin_note: e.target.value || null } }) }}
              data-testid={`input-testimonial-note-${item.id}`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Feedback Section (owner feedback / suggestions) ───────────────────────────
type AdminFeedback = {
  id: string
  owner_id: string
  category: string
  body: string
  status: string
  admin_note: string | null
  created_at: string
  property_owners: { name: string | null; email: string | null } | null
}

const FEEDBACK_STATUSES = ['open', 'reviewing', 'planned', 'done', 'declined']

function FeedbackSection() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useLocale('settingsPage')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-feedback'],
    queryFn: async (): Promise<AdminFeedback[]> => {
      const { data, error } = await supabase
        .from('owner_feedback')
        .select('id, owner_id, category, body, status, admin_note, created_at, property_owners(name, email)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as any as AdminFeedback[]
    },
  })

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, any>; ownerId?: string }) => {
      const { error } = await supabase.from('owner_feedback').update(patch as any).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-feedback'] })
      if (vars.patch.status && vars.ownerId) notifyOwner(vars.ownerId, 'feedback_update', { status: vars.patch.status })
    },
    onError: (e: any) => toast({ title: t('toasts.updateFailed'), description: e?.message ?? t('toasts.updateFailedDesc'), variant: 'destructive' }),
  })

  const rows = data ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('feedback.heading')}</h2>
        <p className="text-sm text-muted-foreground">{t('feedback.description')}</p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">{t('feedback.loading')}</p>}
      {isError && <Button variant="outline" size="sm" onClick={() => refetch()}>{t('feedback.retry')}</Button>}
      {!isLoading && !isError && rows.length === 0 && <p className="text-sm text-muted-foreground">{t('feedback.empty')}</p>}
      <div className="space-y-3">
        {rows.map(item => (
          <div key={item.id} className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wide text-muted-foreground">{t(`feedback.category.${item.category}`, undefined, item.category)}</p>
                <p className="text-sm text-foreground/90 mt-0.5">{item.body}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {item.property_owners?.name || item.property_owners?.email || t('feedback.ownerFallback')} · {new Date(item.created_at).toLocaleDateString()}
                </p>
              </div>
              <select
                className="border border-border rounded-md px-2 py-1 text-sm bg-background shrink-0"
                value={item.status}
                onChange={e => update.mutate({ id: item.id, ownerId: item.owner_id, patch: { status: e.target.value } })}
                data-testid={`select-feedback-status-${item.id}`}
              >
                {FEEDBACK_STATUSES.map(s => <option key={s} value={s}>{t(`feedback.status.${s}`, undefined, s)}</option>)}
              </select>
            </div>
            <Input
              defaultValue={item.admin_note ?? ''}
              placeholder={t('feedback.notePlaceholder')}
              className="text-sm"
              onBlur={e => { if (e.target.value !== (item.admin_note ?? '')) update.mutate({ id: item.id, patch: { admin_note: e.target.value || null } }) }}
              data-testid={`input-feedback-note-${item.id}`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  usePageTitle('Settings')
  const { user } = useAuth() // Always uses real user, NOT effectiveUser
  const { t } = useLocale('settingsPage')
  // Deep-link support: /settings?tab=owners lands on a specific tab (used by
  // the Clients page's "Create portal" shortcut).
  const [initialTab] = useState(() => new URLSearchParams(window.location.search).get('tab') ?? 'users')

  return (
    <PageContainer width="lg" className="space-y-6 md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
      />

      <Tabs defaultValue={initialTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="self-start flex-wrap h-auto">
          <TabsTrigger value="users" data-testid="tab-users">{t('tabs.users')}</TabsTrigger>
          <TabsTrigger value="owners" data-testid="tab-owners">{t('tabs.owners')}</TabsTrigger>
          <TabsTrigger value="agreements" data-testid="tab-agreements">{t('tabs.agreements')}</TabsTrigger>
          <TabsTrigger value="referrals" data-testid="tab-referrals">{t('tabs.referrals')}</TabsTrigger>
          <TabsTrigger value="testimonials" data-testid="tab-testimonials">{t('tabs.testimonials')}</TabsTrigger>
          <TabsTrigger value="feedback" data-testid="tab-feedback">{t('tabs.feedback')}</TabsTrigger>
          <TabsTrigger value="roles" data-testid="tab-roles">{t('tabs.roles')}</TabsTrigger>
          <TabsTrigger value="notifications" data-testid="tab-notifications">{t('tabs.notifications')}</TabsTrigger>
          <TabsTrigger value="app" data-testid="tab-app">{t('tabs.app')}</TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">{t('tabs.templates')}</TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">{t('tabs.integrations')}</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto mt-4">
          <TabsContent value="users" className="mt-0">
            <UsersSection />
          </TabsContent>
          <TabsContent value="owners" className="mt-0">
            <OwnersSection />
          </TabsContent>
          <TabsContent value="agreements" className="mt-0">
            <AgreementsSection />
          </TabsContent>
          <TabsContent value="referrals" className="mt-0">
            <ReferralsSection />
          </TabsContent>
          <TabsContent value="testimonials" className="mt-0">
            <TestimonialsSection />
          </TabsContent>
          <TabsContent value="feedback" className="mt-0">
            <FeedbackSection />
          </TabsContent>
          <TabsContent value="roles" className="mt-0 space-y-6">
            <PermissionsSection />
            <RoleDescriptions />
          </TabsContent>
          <TabsContent value="notifications" className="mt-0">
            <NotificationsSection />
          </TabsContent>
          <TabsContent value="app" className="mt-0">
            <AppSettingsSection />
          </TabsContent>
          <TabsContent value="templates" className="mt-0 space-y-6">
            <WorkflowTemplatesSection />
            <OnboardingTemplateSection />
          </TabsContent>
          <TabsContent value="integrations" className="mt-0">
            <IntegrationsSection />
          </TabsContent>
        </div>
      </Tabs>
    </PageContainer>
  )
}
