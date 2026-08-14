// Settings → API Keys (admin only).
//
// Mint named, scoped API keys for external integrations (e.g. a Slack → Issues
// workflow), copy the value once, and revoke it later. The plaintext key is
// generated in the browser; only its SHA-256 hash + a short prefix are stored,
// so the server can verify a presented key without the value ever being
// retrievable again.
//
// Intentionally English (admin/integration tooling), matching the API Sync
// admin surface rather than the localized end-user pages.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logActivity } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { KeyRound, Plus, Copy, Check, Trash2, ShieldAlert } from 'lucide-react'

// ─── Scope catalogue ─────────────────────────────────────────────────────────
// A scope is `<area>:<operation>`. Keep the values in sync with API_SCOPES in
// api/issues/_lib.ts (the server rejects any request whose required scope is
// absent). New areas plug in here as their API endpoints are built.
interface ScopeDef {
  value: string
  label: string
  hint: string
}
interface ScopeGroup {
  area: string
  description: string
  scopes: ScopeDef[]
}

const SCOPE_GROUPS: ScopeGroup[] = [
  {
    area: 'Issues Tracker',
    description: 'The /api/issues endpoints (the cleaning_issues tracker).',
    scopes: [
      { value: 'issues:create', label: 'Create issues', hint: 'POST /api/issues — log new tracker records' },
      { value: 'issues:read', label: 'Read issues', hint: 'GET /api/issues and /api/issues/:id' },
      { value: 'issues:update', label: 'Update issues', hint: 'PATCH /api/issues/:id' },
    ],
  },
]

const ALL_SCOPES = SCOPE_GROUPS.flatMap(g => g.scopes)
const SCOPE_LABEL = new Map(ALL_SCOPES.map(s => [s.value, s.label]))

interface ApiKeyRow {
  id: string
  name: string
  key_prefix: string
  scopes: string[] | null
  created_by: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  expires_at: string | null
}

// Generate a random key + its SHA-256 hash + a display prefix, all client-side.
async function generateKey(): Promise<{ key: string; hash: string; prefix: string }> {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const rand = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  const key = `twk_${rand}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  const prefix = key.slice(0, 12) // "twk_" + 8 hex chars
  return { key, hash, prefix }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function ApiKeysSection() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { toast } = useToast()

  const { data: keys, isLoading, isError, refetch } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id,name,key_prefix,scopes,created_by,created_at,last_used_at,revoked_at,expires_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ApiKeyRow[]
    },
  })

  // Create dialog state
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null) // plaintext, shown once
  const [copied, setCopied] = useState(false)

  const canCreate = name.trim().length > 0 && selected.size > 0 && !creating

  function resetDialog() {
    setName('')
    setSelected(new Set())
    setRevealed(null)
    setCopied(false)
    setCreating(false)
  }

  function toggleScope(value: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  async function handleCreate() {
    if (!canCreate) return
    setCreating(true)
    try {
      const scopes = ALL_SCOPES.map(s => s.value).filter(v => selected.has(v)) // canonical order
      const { key, hash, prefix } = await generateKey()
      const { error } = await supabase.from('api_keys').insert({
        name: name.trim(),
        key_prefix: prefix,
        key_hash: hash,
        scopes,
        created_by: user?.label ?? null,
      })
      if (error) throw error
      await logActivity({
        entity_type: 'other',
        action: 'create',
        entity_name: 'api_key_created',
        field_name: name.trim(),
        new_value: scopes.join(', '),
        changed_by: user?.label ?? null,
        metadata: { prefix, scopes },
      })
      setRevealed(key)
      qc.invalidateQueries({ queryKey: ['api-keys'] })
    } catch (e: any) {
      toast({ title: 'Could not create key', description: e?.message, variant: 'destructive' })
      setCreating(false)
    }
  }

  async function handleCopy() {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Copy failed', description: 'Select and copy the key manually.', variant: 'destructive' })
    }
  }

  const revoke = useMutation({
    mutationFn: async (row: ApiKeyRow) => {
      const { error } = await supabase
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw error
      await logActivity({
        entity_type: 'other',
        action: 'update',
        entity_name: 'api_key_revoked',
        field_name: row.name,
        old_value: (row.scopes ?? []).join(', '),
        changed_by: user?.label ?? null,
        metadata: { prefix: row.key_prefix },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-keys'] })
      toast({ title: 'Key revoked' })
    },
    onError: (e: any) => toast({ title: 'Revoke failed', description: e?.message, variant: 'destructive' }),
  })

  const remove = useMutation({
    mutationFn: async (row: ApiKeyRow) => {
      const { error } = await supabase.from('api_keys').delete().eq('id', row.id)
      if (error) throw error
      await logActivity({
        entity_type: 'other',
        action: 'delete',
        entity_name: 'api_key_deleted',
        field_name: row.name,
        changed_by: user?.label ?? null,
        metadata: { prefix: row.key_prefix },
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-keys'] })
      toast({ title: 'Key deleted' })
    },
    onError: (e: any) => toast({ title: 'Delete failed', description: e?.message, variant: 'destructive' }),
  })

  const activeCount = useMemo(() => (keys ?? []).filter(k => !k.revoked_at).length, [keys])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <KeyRound className="w-5 h-5" /> API Keys
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Mint scoped keys for external tools (e.g. a Slack workflow that logs issues). Each key can do
            only what its scopes allow — the server rejects anything outside them. Send the key as the{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">x-api-key</code> header.
            {activeCount > 0 && <> {activeCount} active.</>}
          </p>
        </div>
        <Button onClick={() => { resetDialog(); setOpen(true) }} data-testid="button-create-api-key">
          <Plus className="w-4 h-4 mr-1" /> Create API key
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (keys ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No API keys yet. Create one to connect an external integration.
        </div>
      ) : (
        <div className="rounded-2xl border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Scopes</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(keys ?? []).map(k => (
                <tr key={k.id} className="border-b last:border-0" data-testid={`row-api-key-${k.id}`}>
                  <td className="px-4 py-2 font-medium">{k.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{k.key_prefix}…</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(k.scopes ?? []).map(s => (
                        <span key={s} className="text-2xs bg-muted px-1.5 py-0.5 rounded font-mono">
                          {SCOPE_LABEL.get(s) ?? s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(k.last_used_at)}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {fmtDate(k.created_at)}
                    {k.created_by && <span className="block text-2xs">by {k.created_by}</span>}
                  </td>
                  <td className="px-4 py-2">
                    {k.revoked_at ? (
                      <StatusBadge tone="neutral">Revoked</StatusBadge>
                    ) : k.expires_at && new Date(k.expires_at).getTime() < Date.now() ? (
                      <StatusBadge tone="warning">Expired</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">Active</StatusBadge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {k.revoked_at ? (
                      <button
                        className="text-muted-foreground hover:text-destructive p-1"
                        title="Delete permanently"
                        onClick={() => {
                          if (window.confirm(`Permanently delete "${k.name}"? This cannot be undone.`)) remove.mutate(k)
                        }}
                        data-testid={`button-delete-api-key-${k.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (window.confirm(`Revoke "${k.name}"? Any integration using it will stop working immediately.`)) revoke.mutate(k)
                        }}
                        data-testid={`button-revoke-api-key-${k.id}`}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / reveal dialog */}
      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) resetDialog() }}>
        <DialogContent className="max-w-lg">
          {revealed ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your API key</DialogTitle>
                <DialogDescription>
                  This is the only time the full key is shown. Copy it now and store it in your integration's
                  secrets. If you lose it, revoke this key and create a new one.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border bg-muted/40 p-3 flex items-center gap-2">
                <code className="flex-1 font-mono text-xs break-all" data-testid="text-revealed-key">{revealed}</code>
                <Button size="sm" variant="outline" onClick={handleCopy} data-testid="button-copy-api-key">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
                </Button>
              </div>
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Send it as the <code className="bg-muted px-1 rounded">x-api-key</code> header. It grants only the scopes you selected.</span>
              </div>
              <DialogFooter>
                <Button onClick={() => { setOpen(false); resetDialog() }} data-testid="button-done-api-key">Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>
                  Name the key after where you'll use it, then choose exactly what it can do.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Slack issues workflow"
                    data-testid="input-api-key-name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Scopes</label>
                  {SCOPE_GROUPS.map(group => (
                    <div key={group.area} className="rounded-lg border p-3 space-y-2">
                      <div>
                        <p className="text-sm font-medium">{group.area}</p>
                        <p className="text-xs text-muted-foreground">{group.description}</p>
                      </div>
                      <div className="space-y-2">
                        {group.scopes.map(s => (
                          <label key={s.value} className="flex items-start gap-2 cursor-pointer">
                            <Checkbox
                              checked={selected.has(s.value)}
                              onCheckedChange={() => toggleScope(s.value)}
                              data-testid={`checkbox-scope-${s.value}`}
                            />
                            <span className="text-sm leading-tight">
                              {s.label}
                              <span className="block text-2xs text-muted-foreground font-mono">{s.value} · {s.hint}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(false); resetDialog() }} data-testid="button-cancel-api-key">Cancel</Button>
                <Button onClick={handleCreate} disabled={!canCreate} data-testid="button-submit-api-key">
                  {creating ? 'Creating…' : 'Create key'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
