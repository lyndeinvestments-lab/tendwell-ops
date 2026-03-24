import { useState, useMemo } from 'react'
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { UserPlus, Trash2, Shield, Users, DollarSign, TrendingUp, Wind, ClipboardCheck, GripVertical, Plus, Pencil, Check, X } from 'lucide-react'

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

  const COST_FIELDS = [
    { key: 'cost_inspection', label: 'Inspection Cost ($)', placeholder: '15' },
    { key: 'cost_trash', label: 'Trash Cost ($)', placeholder: '5' },
    { key: 'cost_consumables', label: 'Consumables Base Rate ($)', placeholder: '30' },
  ]

  const PROFIT_FIELDS = [
    { key: 'profit_tier_high', label: 'High Tier Threshold (%)', placeholder: '30' },
    { key: 'profit_tier_mid', label: 'Mid Tier Threshold (%)', placeholder: '15' },
  ]

  function handleSave(key: string, value: string) {
    saveSetting({ key, value })
    toast({ title: 'Setting saved' })
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
          {COST_FIELDS.map(f => (
            <div key={f.key} className="grid grid-cols-[180px_1fr_80px] items-center gap-2">
              <label className="text-xs text-muted-foreground">{f.label}</label>
              <Input
                type="number"
                defaultValue={get(f.key, f.placeholder)}
                placeholder={f.placeholder}
                className="h-7 text-xs"
                data-testid={`input-setting-${f.key}`}
                onBlur={e => handleSave(f.key, e.target.value)}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={e => {
                  const input = (e.currentTarget.previousElementSibling as HTMLInputElement)
                  handleSave(f.key, input.value)
                }}>
                Save
              </Button>
            </div>
          ))}
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
          {PROFIT_FIELDS.map(f => (
            <div key={f.key} className="grid grid-cols-[180px_1fr_80px] items-center gap-2">
              <label className="text-xs text-muted-foreground">{f.label}</label>
              <Input
                type="number"
                defaultValue={get(f.key, f.placeholder)}
                placeholder={f.placeholder}
                className="h-7 text-xs"
                data-testid={`input-setting-${f.key}`}
                onBlur={e => handleSave(f.key, e.target.value)}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={e => {
                  const input = (e.currentTarget.previousElementSibling as HTMLInputElement)
                  handleSave(f.key, input.value)
                }}>
                Save
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* AC Filter Schedule */}
      <div className="space-y-3">
        <h2 className="text-base font-medium flex items-center gap-2">
          <Wind className="w-4 h-4" />
          AC Filter Schedule
        </h2>
        <p className="text-xs text-muted-foreground">Default interval for AC filter replacement reminders</p>
        <div className="rounded-lg border border-border p-4">
          <div className="grid grid-cols-[180px_1fr_80px] items-center gap-2">
            <label className="text-xs text-muted-foreground">Replacement Interval (days)</label>
            <Input
              type="number"
              defaultValue={get('ac_filter_interval', '90')}
              placeholder="90"
              className="h-7 text-xs"
              data-testid="input-setting-ac_filter_interval"
              onBlur={e => handleSave('ac_filter_interval', e.target.value)}
            />
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={e => {
                const input = (e.currentTarget.previousElementSibling as HTMLInputElement)
                handleSave('ac_filter_interval', input.value)
              }}>
              Save
            </Button>
          </div>
        </div>
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
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40" />
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

export default function SettingsPage() {
  usePageTitle('Settings')
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('operations')
  const [newPassword, setNewPassword] = useState('')

  const { data: users, isLoading } = useQuery({
    queryKey: ['/supabase/settings-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, role, label, created_at')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const { mutate: addUser, isPending: adding } = useMutation({
    mutationFn: async ({ label, role, password }: { label: string; role: UserRole; password: string }) => {
      const { error } = await supabase.from('app_users').insert({
        label,
        role,
        password_hash: password,
        allowed_views: [],
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      toast({ title: 'User added' })
      setAddOpen(false)
      setNewLabel('')
      setNewRole('operations')
      setNewPassword('')
    },
    onError: () => toast({ title: 'Failed to add user', variant: 'destructive' }),
  })

  const { mutate: deleteUser, isPending: deleting } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('app_users').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/settings-users'] })
      toast({ title: 'User removed' })
      setDeleteTarget(null)
    },
    onError: () => {
      toast({ title: 'Failed to remove user', variant: 'destructive' })
      setDeleteTarget(null)
    },
  })

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

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium flex items-center gap-2">
            <Users className="w-4 h-4" />
            Users
          </h2>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setAddOpen(true)}
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
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Label</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Role</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {[...Array(3)].map((_, j) => (
                      <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : !users?.length ? (
                <tr>
                  <td colSpan={3} className="text-center py-8 text-muted-foreground text-sm">No users found</td>
                </tr>
              ) : (
                users.map((u: any) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors" data-testid={`row-user-${u.id}`}>
                    <td className="py-2 px-3 font-medium text-xs">{u.label}</td>
                    <td className="py-2 px-3"><RoleBadge role={u.role} /></td>
                    <td className="py-2 px-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                        onClick={() => setDeleteTarget(u)}
                        aria-label={`Remove ${u.label}`}
                        data-testid={`button-delete-user-${u.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AppSettingsSection />
      <OnboardingTemplateSection />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Label</label>
              <Input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. Cleaning Team"
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
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Set a password"
                className="mt-1"
                data-testid="input-new-user-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              disabled={!newLabel.trim() || !newPassword.trim() || adding}
              onClick={() => addUser({ label: newLabel.trim(), role: newRole, password: newPassword })}
              data-testid="button-confirm-add-user"
            >
              {adding ? 'Adding…' : 'Add User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{deleteTarget?.label}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => deleteTarget && deleteUser(deleteTarget.id)}
              data-testid="button-confirm-delete-user"
            >
              {deleting ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
