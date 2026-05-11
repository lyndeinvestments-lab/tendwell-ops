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
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { useLocation } from 'wouter'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  UserPlus, Trash2, Shield, Users, DollarSign, TrendingUp, Wind, CalendarDays,
  ClipboardCheck, Plus, Pencil, Check, X, Eye, SlidersHorizontal, RotateCcw,
  Lock, Plug, MapPin, Database, Receipt, KeyRound, Bell as BellIcon,
} from 'lucide-react'
import { getGoogleMapsRuntimeStatus, type GoogleMapsRuntimeStatus } from '@/components/AddressAutocomplete'

// ─── Role Options (system roles for the invite dropdown) ─────────────────────

const SYSTEM_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'operations', label: 'Operations' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'viewer', label: 'Viewer' },
]

function RoleBadge({ role }: { role: string }) {
  const cls = role === 'admin'
    ? 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
    : role === 'operations'
    ? 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
    : role === 'viewer'
    ? 'text-gray-700 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800'
    : role === 'cleaning'
    ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    : 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border capitalize ${cls}`}>
      {role}
    </span>
  )
}

// ─── Hook: load role permissions from app_settings ───────────────────────────

function useRolePermissions() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['/supabase/role-permissions'],
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
      toast({ title: 'Permissions saved' })
    } catch (e: any) {
      toast({ title: 'Failed to save permissions', description: e?.message, variant: 'destructive' })
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
      toast({ title: `Role "${newRoleName.trim()}" created`, description: 'Configure its views in the matrix, then save.' })
    } catch (e: any) {
      toast({ title: 'Failed to create role', description: e?.message, variant: 'destructive' })
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
    toast({ title: 'Role deleted', description: 'Save to persist changes.' })
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
              Permissions
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure which views each role can access. Settings is always admin-only.
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
              New Role
            </Button>
            {localPerms && (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleSaveMatrix}
              >
                <Check className="w-3.5 h-3.5" />
                Save Changes
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/80 border-b border-border">
              <tr>
                <th rowSpan={2} className="text-left font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[160px] align-bottom">Page</th>
                {roleIds.map(roleId => (
                  <th key={roleId} colSpan={2} className="text-center font-medium text-muted-foreground uppercase tracking-wide py-1 px-1 min-w-[80px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{effectivePerms[roleId]?.label || roleId}</span>
                      <div className="flex gap-0.5">
                        {roleId !== 'admin' && (
                          <button
                            onClick={() => handleResetRole(roleId)}
                            className="text-muted-foreground/60 hover:text-foreground"
                            title="Reset to defaults"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                        {!effectivePerms[roleId]?.system && (
                          <button
                            onClick={() => handleDeleteRoleCheck(roleId)}
                            className="text-muted-foreground/60 hover:text-red-600"
                            title="Delete role"
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
                    <th className="text-center text-[10px] text-muted-foreground/70 py-0.5 px-1 w-10">View</th>
                    <th className="text-center text-[10px] text-muted-foreground/70 py-0.5 px-1 w-10">Edit</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {viewGroups.map(({ group, views }) => (
                <React.Fragment key={`group-${group}`}>
                  <tr>
                    <td colSpan={roleIds.length * 2 + 1} className="bg-muted/40 py-1.5 px-3 font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
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
            <DialogTitle>Create Custom Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Role Name</label>
              <Input
                value={newRoleName}
                onChange={e => setNewRoleName(e.target.value)}
                placeholder="e.g. Manager"
                className="mt-1"
                autoFocus
              />
            </div>
            {newRoleSlug && (
              <div className="text-xs text-muted-foreground">
                Slug: <code className="bg-muted px-1 rounded">{newRoleSlug}</code>
                {slugCollision && (
                  <span className="text-red-600 ml-2">Already exists</span>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              After creating, configure view access in the permissions matrix.
            </p>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              disabled={!newRoleName.trim() || !newRoleSlug || !!slugCollision}
              onClick={handleCreateRole}
            >
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Role Dialog */}
      <Dialog open={!!deleteRoleId} onOpenChange={() => setDeleteRoleId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Role</DialogTitle>
          </DialogHeader>
          {deleteBlockedUsers.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-red-600">
                Cannot delete — {deleteBlockedUsers.length} user{deleteBlockedUsers.length !== 1 ? 's' : ''} have this role:
              </p>
              <ul className="text-sm list-disc pl-5 space-y-0.5">
                {deleteBlockedUsers.map((u: any) => (
                  <li key={u.id}>{u.label}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Reassign these users to another role first.</p>
            </div>
          ) : (
            <p className="text-sm">
              Are you sure you want to delete the <strong>{deleteRoleId}</strong> role?
            </p>
          )}
          <DialogFooter>
            {deleteBlockedUsers.length === 0 ? (
              <Button variant="destructive" size="sm" onClick={handleDeleteRoleConfirm}>
                Delete Role
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setDeleteRoleId(null)}>
                Close
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
  const { get, saveSetting } = useAppSettings()

  const ALL_FIELDS = [
    { key: 'cost_inspection', label: 'Inspection Cost ($)', placeholder: '15', section: 'cost' },
    { key: 'cost_trash', label: 'Trash Cost ($)', placeholder: '5', section: 'cost' },
    { key: 'default_cleaner_pay', label: 'Default Cleaner Pay ($)', placeholder: '75', section: 'cost' },
    { key: 'profit_tier_high', label: 'High Tier Threshold (%)', placeholder: '30', section: 'profit' },
    { key: 'profit_tier_mid', label: 'Mid Tier Threshold (%)', placeholder: '15', section: 'profit' },
    { key: 'ac_filter_interval', label: 'Replacement Interval (days)', placeholder: '90', section: 'ac' },
    { key: 'followup_reminder_days', label: 'Follow-Up Reminder Window (days)', placeholder: '7', section: 'ops' },
    { key: 'stale_lead_days', label: 'Stale Lead Threshold (days)', placeholder: '14', section: 'ops' },
    { key: 'inspection_interval_days', label: 'Inspection Reminder Interval (days)', placeholder: '90', section: 'ops' },
    { key: 'amenity_bathroom', label: 'Bathroom Amenities ($ per bathroom)', placeholder: '1.05', section: 'amenity' },
    { key: 'amenity_toilet_paper', label: 'Toilet Paper ($ per bathroom)', placeholder: '0.78', section: 'amenity' },
    { key: 'amenity_kitchen', label: 'Kitchen Supplies ($ per kitchen)', placeholder: '2.05', section: 'amenity' },
    { key: 'amenity_trash_bag', label: 'Trash Bags ($ per bed)', placeholder: '0.06', section: 'amenity' },
    { key: 'amenity_hot_tub', label: 'Hot Tub Chemicals ($ per property)', placeholder: '0.88', section: 'amenity' },
  ]

  const [localValues, setLocalValues] = useState<Record<string, string>>(
    () => Object.fromEntries(ALL_FIELDS.map(f => [f.key, get(f.key, f.placeholder)]))
  )

  function handleBlurSave(key: string, value: string) {
    saveSetting({ key, value })
    toast({ title: 'Setting saved', description: `${ALL_FIELDS.find(f => f.key === key)?.label} updated.` })
  }

  function handleSaveAll() {
    ALL_FIELDS.forEach(f => saveSetting({ key: f.key, value: localValues[f.key] ?? f.placeholder }))
    toast({ title: 'All settings saved' })
  }

  const COST_FIELDS = ALL_FIELDS.filter(f => f.section === 'cost')
  const AMENITY_FIELDS = ALL_FIELDS.filter(f => f.section === 'amenity')
  const PROFIT_FIELDS = ALL_FIELDS.filter(f => f.section === 'profit')
  const AC_FIELDS = ALL_FIELDS.filter(f => f.section === 'ac')
  const OPS_FIELDS = ALL_FIELDS.filter(f => f.section === 'ops')

  function FieldRow({ f }: { f: typeof ALL_FIELDS[number] }) {
    return (
      <div key={f.key} className="grid grid-cols-[180px_1fr] items-center gap-2">
        <label className="text-xs text-muted-foreground">{f.label}</label>
        <Input
          type="number"
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
          Cost Defaults
        </h2>
        <p className="text-xs text-muted-foreground">Default costs used in Quote Sheet calculations</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {COST_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <DollarSign className="w-4 h-4" />
          Amenity Costs
        </h2>
        <p className="text-xs text-muted-foreground">Per-unit supply costs used to calculate Est Consumables on each property</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {AMENITY_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
        <p className="text-xs text-muted-foreground">
          Formula: (Full Baths + Half Baths) × (Bathroom + Toilet Paper) + Kitchens × Kitchen + Beds × Trash Bag + Hot Tub
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Profit Tiers
        </h2>
        <p className="text-xs text-muted-foreground">Thresholds for green/yellow/red profit % badges across Pipeline, Cost Tracking, and Dashboard</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {PROFIT_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <Wind className="w-4 h-4" />
          AC Filter Schedule
        </h2>
        <p className="text-xs text-muted-foreground">Default interval for AC filter replacement reminders</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {AC_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <CalendarDays className="w-4 h-4" />
          Operational Thresholds
        </h2>
        <p className="text-xs text-muted-foreground">Configure when follow-up reminders, stale alerts, and inspection warnings trigger</p>
        <div className="rounded-lg border border-border p-4 space-y-3">
          {OPS_FIELDS.map(f => <FieldRow key={f.key} f={f} />)}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSaveAll} data-testid="button-save-all-settings">
          <Check className="w-3.5 h-3.5" />
          Save All Settings
        </Button>
      </div>
    </div>
  )
}

// ─── Onboarding Template Section ─────────────────────────────────────────────

function OnboardingTemplateSection() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [newTask, setNewTask] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const { data: templates, isLoading } = useQuery({
    queryKey: ['/supabase/onboarding-templates'],
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
      toast({ title: 'Template task added' })
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
      toast({ title: 'Template updated' })
    },
  })

  const { mutate: deleteTemplate } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('onboarding_task_templates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/onboarding-templates'] })
      toast({ title: 'Template task removed' })
    },
  })

  return (
    <div className="space-y-3">
      <h2 className="text-base font-medium flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4" />
        Onboarding Checklist
      </h2>
      <p className="text-xs text-muted-foreground">Default tasks assigned to new onboarding properties</p>
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
                    <Check className="w-3 h-3 text-green-600" />
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
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-600" onClick={() => deleteTemplate(t.id)}>
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
            placeholder="Add template task…"
            className="h-7 text-xs flex-1"
            onKeyDown={e => e.key === 'Enter' && newTask.trim() && addTemplate(newTask.trim())}
          />
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!newTask.trim()} onClick={() => addTemplate(newTask.trim())}>
            <Plus className="w-3 h-3" /> Add
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
        .update({ custom_views: customViews, custom_permissions: customPerms })
        .eq('id', targetUser.id)
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
    toast({ title: 'Custom access saved', description: `${targetUser.label} now has custom access.` })
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
    toast({ title: 'Reset to role defaults', description: `${targetUser.label} will inherit from their role.` })
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
          <DialogTitle>Custom Access for {targetUser.label}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Override which pages this user can view and edit. Clear all checkboxes only if you intend to revoke all access.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground uppercase tracking-wider pl-1">
            <span className="flex-1">Page</span>
            <span className="w-10 text-center">View</span>
            <span className="w-10 text-center">Edit</span>
          </div>
          {viewGroups.map(({ group, views }) => (
            <div key={group}>
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{group}</div>
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
              Reset to Role Defaults
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save Custom Access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Users Section ───────────────────────────────────────────────────────────

function UsersSection() {
  const { toast } = useToast()
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

  const { data: users, isLoading } = useQuery({
    queryKey: ['/supabase/settings-users'],
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
      toast({ title: 'User invited', description: `${newEmail} can now sign in with Google.` })
      setInviteOpen(false)
      setNewEmail('')
      setNewLabel('')
      setNewRole('operations')
    },
    onError: (err: any) => {
      const msg = err?.message || ''
      if (msg.includes('unique') || msg.includes('duplicate')) {
        toast({ title: 'Email already exists', description: 'That Google account already has access.', variant: 'destructive' })
      } else {
        toast({ title: 'Failed to invite user', description: err?.message, variant: 'destructive' })
      }
    },
  })

  const [pendingRoleUpdate, setPendingRoleUpdate] = useState<string | null>(null)

  const { mutateAsync: updateRoleAsync } = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const { error } = await supabase.from('app_users').update({ role }).eq('id', id)
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
      toast({ title: 'Role updated' })
    } catch (e: any) {
      toast({ title: 'Failed to update role', description: e?.message, variant: 'destructive' })
    } finally {
      setPendingRoleUpdate(null)
      setEditingRoleId(null)
    }
  }

  const { mutate: deleteUser, isPending: deleting } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('app_users').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      toast({ title: 'User removed' })
      setConfirmDeleteId(null)
    },
    onError: (error: any) => {
      toast({ title: 'Failed to remove user', description: error?.message, variant: 'destructive' })
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
              Users
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Add a user's Google email to grant access. They sign in with Google.</p>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setInviteOpen(true)}
            data-testid="button-add-user"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add User
          </Button>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/80 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Name</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Google Email</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Role</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Actions</th>
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
                  <td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No users found</td>
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
                          {u.label}
                          {hasCustom && (
                            <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                              Custom
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{u.google_email || <span className="italic">not set</span>}</td>
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
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <button
                            className="flex items-center gap-1 group/role"
                            onClick={() => setEditingRoleId(u.id)}
                            title="Click to change role"
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
                              title="Customize view access"
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
                              title={`Preview as ${u.label}`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Delete */}
                          {confirmDeleteId === u.id ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Remove?</span>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                disabled={deleting}
                                onClick={() => deleteUser(u.id)}
                                data-testid={`button-confirm-delete-user-${u.id}`}
                              >
                                {deleting ? 'Removing…' : 'Confirm'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                disabled={deleting}
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                              onClick={() => setConfirmDeleteId(u.id)}
                              aria-label={`Remove ${u.label}`}
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
      </div>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            Enter their Google account email. They'll be able to sign in immediately.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Google Email</label>
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
              <label className="text-xs font-medium text-muted-foreground">Display Name</label>
              <Input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. Sarah (Cleaning Team)"
                className="mt-1"
                data-testid="input-new-user-label"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-new-user-role"
              >
                {allRoleOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
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
              {inviting ? 'Adding…' : 'Add User'}
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

function NotificationsSection() {
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [testing, setTesting] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)

  // All users (admins can edit any; non-admins only see their own row)
  const { data: users } = useQuery({
    queryKey: ['/supabase/notif-users'],
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
    queryFn: async () => {
      const { data: row } = await supabase.from('app_settings').select('value').eq('key', 'role_permissions').single()
      if (!row?.value) return buildDefaultRolePermissions()
      return sanitizeRolePermissions(typeof row.value === 'string' ? JSON.parse(row.value) : row.value)
    },
  })

  const { data: prefsRows } = useQuery({
    queryKey: ['/supabase/notif-prefs'],
    queryFn: async () => {
      const { data } = await supabase.from('notification_preferences').select('*')
      return data || []
    },
  })

  const prefsByUser = useMemo(() => {
    const m = new Map<string, any>()
    for (const p of (prefsRows || [])) m.set(p.user_id, p)
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
    onError: (e: any) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  async function handleTestEmail() {
    setTesting(true)
    const { sendTestEmail } = await import('@/lib/notify')
    const r = await sendTestEmail()
    setTesting(false)
    if (r.ok) toast({ title: 'Test email sent', description: `Sent to ${r.sentTo}` })
    else toast({ title: 'Test failed', description: r.error, variant: 'destructive' })
  }

  const isAdmin = user?.role === 'admin'
  const visibleUsers = isAdmin ? (users || []) : (users || []).filter((u: any) => u.id === user?.id)

  const EVENT_DEFS: Array<{ field: string; label: string; view: string }> = [
    { field: 'notify_task_assigned',        label: 'Task assigned',          view: 'tasks' },
    { field: 'notify_task_mention',         label: 'Mentioned in comment',   view: 'tasks' },
    { field: 'notify_task_overdue',         label: 'Task overdue (digest)',  view: 'tasks' },
    { field: 'notify_watcher_update',       label: 'Watcher updates',        view: 'tasks' },
    { field: 'notify_list_added',           label: 'Added to a task list',   view: 'tasks' },
    { field: 'notify_issue_logged',         label: 'New issue logged',       view: 'issues' },
    { field: 'notify_verification_due',     label: 'Verification due',       view: 'property-verifications' },
    { field: 'notify_onboarding_submitted', label: 'Onboarding submitted',   view: 'master-list' },
    { field: 'notify_follow_up_due',        label: 'Follow-up due',          view: 'contacts' },
    { field: 'notify_property_note_mention', label: 'Mentioned in a property note', view: 'property-list' },
    { field: 'notify_contact_note_mention',  label: 'Mentioned in a contact note',  view: 'contacts' },
  ]

  return (
    <div className="rounded-lg border border-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-medium flex items-center gap-2">
            <Users className="w-4 h-4" /> Email Notifications
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each user only receives notifications for events tied to views they can access.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleTestEmail} disabled={testing}>
          {testing ? 'Sending…' : 'Send test email to me'}
        </Button>
      </div>

      <div className="space-y-3">
        {visibleUsers.map((u: any) => {
          const prefs = prefsByUser.get(u.id) || { user_id: u.id, email_enabled: true, digest_frequency: 'instant' }
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
                    <span className="text-green-600 dark:text-green-400">on · {prefs.digest_frequency}</span>
                  ) : (
                    <span className="text-muted-foreground">off</span>
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
                      Email enabled
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      Frequency:
                      <select
                        value={prefs.digest_frequency || 'instant'}
                        disabled={!canEditThis}
                        onChange={(e) => savePref.mutate({ ...prefs, digest_frequency: e.target.value })}
                        className="h-7 text-xs border border-input rounded px-2 bg-background"
                      >
                        <option value="instant">Instant</option>
                        <option value="daily">Daily digest (8am ET)</option>
                        <option value="off">Off</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {EVENT_DEFS.map(ev => {
                      const hasAccess = allowedViews.includes(ev.view)
                      const checked = !!prefs[ev.field]
                      return (
                        <label
                          key={ev.field}
                          className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded border ${hasAccess ? 'border-border' : 'border-border/50 opacity-50'}`}
                          title={hasAccess ? '' : `Requires ${ev.view} access`}
                        >
                          <Checkbox
                            checked={hasAccess && checked}
                            disabled={!canEditThis || !hasAccess}
                            onCheckedChange={(v) => savePref.mutate({ ...prefs, [ev.field]: !!v })}
                          />
                          <span className="flex-1">{ev.label}</span>
                          {!hasAccess && <Lock className="w-3 h-3 text-muted-foreground" />}
                        </label>
                      )
                    })}
                  </div>
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
  const { data: logs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['/supabase/notif-log'],
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
        <h3 className="text-sm font-medium">Recent send log</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{sentCt} sent · {failedCt} failed (last {total})</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center">No notifications sent yet.</p>
      ) : (
        <div className="max-h-72 overflow-auto rounded border border-border">
          {/* Mobile: stacked cards */}
          <div className="sm:hidden divide-y divide-border">
            {(logs || []).map((l: any) => (
              <div key={l.id} className="p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate">{l.event_type}</span>
                  <span className={`text-xs flex-shrink-0 ${l.status === 'sent' ? 'text-green-600 dark:text-green-400' : l.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>{l.status}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{l.recipient_email}</p>
                <p className="text-[10px] text-muted-foreground">{new Date(l.sent_at).toLocaleString()}</p>
                {l.error && <p className="text-xs text-red-600 dark:text-red-400">{l.error}</p>}
              </div>
            ))}
          </div>
          {/* Desktop: table */}
          <table className="w-full text-xs hidden sm:table">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">When</th>
                <th className="text-left px-2 py-1.5 font-medium">Event</th>
                <th className="text-left px-2 py-1.5 font-medium">Recipient</th>
                <th className="text-left px-2 py-1.5 font-medium">Status</th>
                <th className="text-left px-2 py-1.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {(logs || []).map((l: any) => (
                <tr key={l.id} className="border-t border-border/50">
                  <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{new Date(l.sent_at).toLocaleString()}</td>
                  <td className="px-2 py-1">{l.event_type}</td>
                  <td className="px-2 py-1 truncate max-w-[180px]">{l.recipient_email}</td>
                  <td className="px-2 py-1">
                    <span className={l.status === 'sent' ? 'text-green-600 dark:text-green-400' : l.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}>
                      {l.status}
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
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ from_stage: '', to_stage: 'Onboarding', title: '', description: '', default_assignee_name: '', due_offset_days: '0', checklist_items: '' })

  const { data: templates, isLoading } = useQuery({
    queryKey: ['/supabase/workflow-templates'],
    queryFn: async () => {
      const { data } = await supabase.from('stage_workflow_templates').select('*').order('from_stage').order('to_stage').order('sort_order')
      return data || []
    },
  })

  const { data: users } = useQuery({
    queryKey: ['/supabase/workflow-users'],
    queryFn: async () => {
      const { data } = await supabase.from('app_users').select('id, label').order('label')
      return data || []
    },
  })

  // Group by transition
  const groups = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const t of (templates || [])) {
      const key = `${t.from_stage || 'Any'} → ${t.to_stage}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    return Array.from(map.entries())
  }, [templates])

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
    toast({ title: editId ? 'Template updated' : 'Template created' })
    setAddOpen(false)
    setEditId(null)
    setForm({ from_stage: '', to_stage: 'Onboarding', title: '', description: '', default_assignee_name: '', due_offset_days: '0', checklist_items: '' })
  }

  function startEdit(t: any) {
    setForm({
      from_stage: t.from_stage || '',
      to_stage: t.to_stage,
      title: t.title,
      description: t.description || '',
      default_assignee_name: t.default_assignee_name || '',
      due_offset_days: String(t.due_offset_days || 0),
      checklist_items: Array.isArray(t.checklist_items) ? t.checklist_items.join('\n') : '',
    })
    setEditId(t.id)
    setAddOpen(true)
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    await supabase.from('stage_workflow_templates').update({ enabled }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['/supabase/workflow-templates'] })
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this workflow template?')) return
    await supabase.from('stage_workflow_templates').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['/supabase/workflow-templates'] })
    toast({ title: 'Template deleted' })
  }

  return (
    <div className="rounded-lg border border-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-medium flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" /> Stage Workflows
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Auto-create tasks when properties change stage</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setEditId(null); setForm({ from_stage: '', to_stage: 'Onboarding', title: '', description: '', default_assignee_name: '', due_offset_days: '0', checklist_items: '' }); setAddOpen(true) }}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Template
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : groups.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No workflow templates configured.</p>
      ) : (
        <div className="space-y-4">
          {groups.map(([label, items]) => (
            <div key={label}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
              <div className="space-y-1">
                {items.map((t: any) => (
                  <div key={t.id} className={`flex items-center gap-3 text-xs rounded-md border px-3 py-2 ${t.enabled ? 'border-border' : 'border-border/50 opacity-50'}`}>
                    <Checkbox checked={t.enabled} onCheckedChange={(v) => toggleEnabled(t.id, !!v)} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{t.title}</p>
                      <p className="text-muted-foreground">
                        {t.default_assignee_name || 'Unassigned'} · +{t.due_offset_days}d
                        {Array.isArray(t.checklist_items) && t.checklist_items.length > 0 && ` · ${t.checklist_items.length} items`}
                      </p>
                    </div>
                    <button onClick={() => startEdit(t)} className="text-muted-foreground hover:text-foreground"><Pencil className="w-3 h-3" /></button>
                    <button onClick={() => deleteTemplate(t.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={v => { if (!v) { setAddOpen(false); setEditId(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? 'Edit Template' : 'Add Workflow Template'}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">From Stage</label>
                <select value={form.from_stage} onChange={e => setForm(f => ({ ...f, from_stage: e.target.value }))} className="w-full h-8 text-xs border border-input rounded px-2 bg-background">
                  <option value="">Any</option>
                  {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">To Stage *</label>
                <select value={form.to_stage} onChange={e => setForm(f => ({ ...f, to_stage: e.target.value }))} className="w-full h-8 text-xs border border-input rounded px-2 bg-background">
                  {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Task Title * <span className="text-muted-foreground/60">(use {'{property_name}'} placeholder)</span></label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="h-8 text-xs" placeholder="e.g. Get access codes for {'{property_name}'}" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full h-16 rounded-md border border-input px-2 py-1.5 text-xs bg-background resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Default Assignee</label>
                <select value={form.default_assignee_name} onChange={e => setForm(f => ({ ...f, default_assignee_name: e.target.value }))} className="w-full h-8 text-xs border border-input rounded px-2 bg-background">
                  <option value="">Unassigned</option>
                  {(users || []).map((u: any) => <option key={u.id} value={u.label}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Due (days from transition)</label>
                <Input type="number" value={form.due_offset_days} onChange={e => setForm(f => ({ ...f, due_offset_days: e.target.value }))} className="h-8 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Checklist Items <span className="text-muted-foreground/60">(one per line)</span></label>
              <textarea value={form.checklist_items} onChange={e => setForm(f => ({ ...f, checklist_items: e.target.value }))} className="w-full h-20 rounded-md border border-input px-2 py-1.5 text-xs bg-background resize-none" placeholder="Door code&#10;Lockbox combo&#10;Gate code" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); setEditId(null) }}>Cancel</Button>
            <Button onClick={saveTemplate} disabled={!form.title.trim() || !form.to_stage}>{editId ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function describeMapsStatus(s: GoogleMapsRuntimeStatus): string {
  switch (s) {
    case 'no_key': return 'no key on this build'
    case 'loading': return 'not loaded yet (open a form with an address field)'
    case 'ready': return 'loaded and active'
    case 'script_error': return 'script failed to load — check Maps JavaScript API enablement, HTTP referrer allowlist, billing, and CSP'
    case 'places_missing': return 'loaded without the Places library — script URL is missing libraries=places'
    case 'timeout': return 'timed out — likely network blocked or CSP rejected maps.googleapis.com'
    case 'gm_authFailure': return 'Google rejected the key at runtime — fix HTTP referrer allowlist / billing / Maps JS API enablement'
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
        toast({ title: 'Not signed in', variant: 'destructive' })
        return
      }
      const r = await fetch('/api/qbo/authorize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include', // ensure the HttpOnly cookie response is honored
      })
      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        toast({ title: `QBO authorize failed (${r.status})`, description: txt.slice(0, 200), variant: 'destructive' })
        return
      }
      const { url } = await r.json() as { url: string }
      window.location.href = url
    } catch (e) {
      toast({ title: 'QBO reconnect error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
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
    const map: Record<Status, { label: string; cls: string }> = {
      connected: { label: 'Connected', cls: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800' },
      configured: { label: 'Configured', cls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
      not_configured: { label: 'Not configured', cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' },
      unknown: { label: 'Unknown', cls: 'bg-muted text-muted-foreground border-border' },
    }
    const m = map[s]
    return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${m.cls}`}>{m.label}</span>
  }

  const integrations = [
    {
      icon: Database,
      name: 'Supabase',
      description: 'Primary database & authentication.',
      status: (supabaseUrl ? 'connected' : 'not_configured') as Status,
      detail: supabaseUrl ? `Project URL configured` : 'VITE_SUPABASE_URL is missing — sign-in will fail.',
    },
    {
      icon: MapPin,
      name: 'Google Places API',
      description: 'Address autocomplete on property forms.',
      status: (googleMapsKey ? 'configured' : 'not_configured') as Status,
      detail: googleMapsKey
        ? `Public Maps JS key is configured. Autocomplete activates on supported forms (with libraries=places); runtime load can still fail due to Maps JavaScript API enablement, HTTP referrer restrictions, billing, or CSP. Address fields fall back to plain text on any failure. Runtime status: ${describeMapsStatus(mapsStatus)}.`
        : 'Set VITE_GOOGLE_MAPS_API_KEY (Maps JS API + Places library) to enable autocomplete. Address fields fall back to plain text.',
    },
    {
      icon: Receipt,
      name: 'QuickBooks Online',
      description: 'Pulls actual P&L into the Live Pro Forma.',
      status: 'configured' as Status,
      detail: 'Connection is managed server-side. Actuals refresh nightly via a scheduled QBO import — no manual pull needed.',
      action: isAdmin ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={qboConnecting}
          onClick={startQboReconnect}
          data-testid="button-qbo-reconnect"
        >
          {qboConnecting ? 'Opening Intuit…' : 'Reconnect QuickBooks'}
        </Button>
      ) : null,
    },
    {
      icon: KeyRound,
      name: 'Anthropic (AI Assistant)',
      description: 'Powers the in-app AI chat.',
      status: (anthropicKeyPresent ? 'configured' : 'unknown') as Status,
      detail: anthropicKeyPresent
        ? 'Public client key present — usually keys are kept server-side. Verify this is intended.'
        : 'No public client key is exposed — the assistant calls the server-side handler.',
    },
  ]

  return (
    <div className="space-y-3">
      <h2 className="text-base font-medium flex items-center gap-2">
        <Plug className="w-4 h-4" />
        Integrations & API
      </h2>
      <p className="text-xs text-muted-foreground">
        Status of external services this Tendwell Ops install talks to. Keys are configured via Vercel/CI environment variables
        (read-only here — never displayed).
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
                <p className="text-[11px] text-muted-foreground/80 mt-1">{it.detail}</p>
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
  supervisor: 'Field/team supervisor — manages linen, access codes, inspections, tasks, cleaners, and operational alerts. No access to financial, admin, or QBO settings unless explicitly granted in the matrix.',
  operations: 'Day-to-day operations team — sees properties, linens, AC filters, inspections, tasks, and cleaners.',
  cleaning: 'Linen-focused role for cleaning vendors. Read-only access to linen requirements and inventory.',
  viewer: 'Read-only access to most operational pages. Cannot edit data.',
}

function RoleDescriptions() {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-medium flex items-center gap-2">
        <Shield className="w-4 h-4" />
        Role Reference
      </h2>
      <p className="text-xs text-muted-foreground">
        Quick descriptions of the built-in roles. Custom roles you create above inherit no defaults — set their views in the matrix.
      </p>
      <div className="rounded-lg border border-border divide-y divide-border">
        {Object.entries(ROLE_DESCRIPTIONS).map(([role, desc]) => (
          <div key={role} className="grid grid-cols-[110px_1fr] gap-3 p-3">
            <div className="text-sm font-medium capitalize">{role}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  usePageTitle('Settings')
  const { user } = useAuth() // Always uses real user, NOT effectiveUser

  return (
    <div className="p-5 space-y-6 h-full flex flex-col max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">Manage users, permissions, integrations, and application settings</p>
      </div>

      <UsersSection />
      <PermissionsSection />
      <RoleDescriptions />
      <IntegrationsSection />
      <NotificationsSection />
      <WorkflowTemplatesSection />
      <AppSettingsSection />
      <OnboardingTemplateSection />
    </div>
  )
}
