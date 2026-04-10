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
  Lock,
} from 'lucide-react'

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
    } catch {
      toast({ title: 'Failed to save permissions', variant: 'destructive' })
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
    } catch {
      toast({ title: 'Failed to create role', variant: 'destructive' })
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
        toast({ title: 'Failed to invite user', variant: 'destructive' })
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
    } catch {
      toast({ title: 'Failed to update role', variant: 'destructive' })
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
    onError: () => {
      toast({ title: 'Failed to remove user', variant: 'destructive' })
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

export default function SettingsPage() {
  usePageTitle('Settings')
  const { user } = useAuth() // Always uses real user, NOT effectiveUser

  if (user?.role !== 'admin') {
    return (
      <div className="p-5 flex items-center justify-center h-full">
        <p className="text-muted-foreground">You don't have access to this page.</p>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-6 h-full flex flex-col max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">Manage users, permissions, and application settings</p>
      </div>

      <UsersSection />
      <PermissionsSection />
      <AppSettingsSection />
      <OnboardingTemplateSection />
    </div>
  )
}
