import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth, type UserRole } from '@/lib/auth'
import { useAppSettings } from '@/hooks/use-app-settings'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { UserPlus, Trash2, Shield, Users, DollarSign, TrendingUp, Wind, ClipboardCheck, Plus, Pencil, Check, X } from 'lucide-react'

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
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
    : 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border capitalize ${cls}`}>
      {role}
    </span>
  )
}

function AppSettingsSection() {
  const { toast } = useToast()
  const { get, saveSetting } = useAppSettings()

  const ALL_FIELDS = [
    { key: 'cost_inspection', label: 'Inspection Cost ($)', placeholder: '15', section: 'cost' },
    { key: 'cost_trash', label: 'Trash Cost ($)', placeholder: '5', section: 'cost' },
    { key: 'cost_consumables', label: 'Consumables Base Rate ($)', placeholder: '30', section: 'cost' },
    { key: 'profit_tier_high', label: 'High Tier Threshold (%)', placeholder: '30', section: 'profit' },
    { key: 'profit_tier_mid', label: 'Mid Tier Threshold (%)', placeholder: '15', section: 'profit' },
    { key: 'ac_filter_interval', label: 'Replacement Interval (days)', placeholder: '90', section: 'ac' },
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
      {/* Cost Defaults */}
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

      {/* Profit Tiers */}
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

      {/* AC Filter Schedule */}
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

      {/* Single Save All button */}
      <div className="flex justify-end pt-1">
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSaveAll} data-testid="button-save-all-settings">
          <Check className="w-3.5 h-3.5" />
          Save All Settings
        </Button>
      </div>
    </div>
  )
}

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

function UsersSection() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('operations')

  const { data: users, isLoading } = useQuery({
    queryKey: ['/supabase/settings-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, role, label, google_email, created_at')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const { mutate: inviteUser, isPending: inviting } = useMutation({
    mutationFn: async ({ email, label, role }: { email: string; label: string; role: UserRole }) => {
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

  const { mutate: updateRole } = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserRole }) => {
      const { error } = await supabase.from('app_users').update({ role }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      setEditingRoleId(null)
      toast({ title: 'Role updated' })
    },
    onError: () => toast({ title: 'Failed to update role', variant: 'destructive' }),
  })

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
                users.map((u: any) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors" data-testid={`row-user-${u.id}`}>
                    <td className="py-2 px-3 font-medium text-xs">{u.label}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{u.google_email || <span className="italic">not set</span>}</td>
                    <td className="py-2 px-3">
                      {editingRoleId === u.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            defaultValue={u.role}
                            autoFocus
                            className="h-6 rounded border border-input bg-background px-1.5 text-xs"
                            onChange={e => updateRole({ id: u.id, role: e.target.value as UserRole })}
                            onBlur={() => setEditingRoleId(null)}
                          >
                            {ROLE_OPTIONS.map(o => (
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
                      {confirmDeleteId === u.id ? (
                        <div className="flex items-center justify-end gap-1.5">
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
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                onChange={e => setNewRole(e.target.value as UserRole)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-new-user-role"
              >
                {ROLE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                {newRole === 'admin' && 'Full access to all pages and settings.'}
                {newRole === 'operations' && 'Access to property list, linens, access codes, AC filters, inspections, and cleaners.'}
                {newRole === 'cleaning' && 'Access to linen tracker only.'}
                {newRole === 'viewer' && 'Read-only access to most pages. Cannot edit settings.'}
              </p>
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
    </>
  )
}

export default function SettingsPage() {
  usePageTitle('Settings')
  const { user } = useAuth()

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
        <p className="text-sm text-muted-foreground">Manage users and application settings</p>
      </div>

      <UsersSection />
      <AppSettingsSection />
      <OnboardingTemplateSection />
    </div>
  )
}
