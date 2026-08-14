// Settings → API Keys (admin only).
//
// Mint named API keys for external integrations, choosing per app area whether
// the key can View or Create/Edit, copy the value once, and revoke it later.
// The plaintext key is generated in the browser; only its SHA-256 hash + a
// short prefix are stored, so the value is never retrievable again.
//
// Areas + scopes come from the shared catalogue (shared/api-areas.ts), which
// the server-side gateway (api/data/[resource].ts) enforces. Sensitive areas
// (users, API keys, owners, agreements, settings) are absent from that
// catalogue and can never be granted here.
//
// Intentionally English (admin/integration tooling), matching the API Sync
// admin surface rather than the localized end-user pages.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logActivity } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { API_AREAS, scopeEdit, scopeView, type ApiArea } from '@shared/api-areas'

type AccessLevel = 'none' | 'view' | 'edit'

const AREA_LABEL = new Map(API_AREAS.map(a => [a.key, a.label]))

// Preserve catalogue order but bucket by group for the picker.
const GROUPS: { group: string; areas: ApiArea[] }[] = (() => {
  const order: string[] = []
  const byGroup = new Map<string, ApiArea[]>()
  for (const a of API_AREAS) {
    if (!byGroup.has(a.group)) { byGroup.set(a.group, []); order.push(a.group) }
    byGroup.get(a.group)!.push(a)
  }
  return order.map(group => ({ group, areas: byGroup.get(group)! }))
})()

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
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Turn a scopes[] into compact { label, level } chips for the list view.
function scopeChips(scopes: string[]): { label: string; level: AccessLevel }[] {
  const byArea = new Map<string, AccessLevel>()
  for (const s of scopes) {
    const idx = s.lastIndexOf(':')
    if (idx < 0) continue
    const key = s.slice(0, idx)
    const op = s.slice(idx + 1)
    if (op === 'edit') byArea.set(key, 'edit')
    else if (op === 'view' && byArea.get(key) !== 'edit') byArea.set(key, 'view')
  }
  return Array.from(byArea.entries()).map(([key, level]) => ({ label: AREA_LABEL.get(key) ?? key, level }))
}

// A compact 2- or 3-option segmented control for one area.
function AccessToggle({ area, value, onChange }: { area: ApiArea; value: AccessLevel; onChange: (v: AccessLevel) => void }) {
  const options: { v: AccessLevel; label: string }[] =
    area.access === 'rw'
      ? [{ v: 'none', label: 'None' }, { v: 'view', label: 'View' }, { v: 'edit', label: 'Create & Edit' }]
      : [{ v: 'none', label: 'None' }, { v: 'view', label: 'View' }]
  return (
    <div className="inline-flex rounded-md border overflow-hidden shrink-0">
      {options.map(o => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'px-2.5 py-1 text-xs transition-colors',
            value === o.v
              ? o.v === 'edit'
                ? 'bg-warning/15 text-warning font-medium'
                : o.v === 'view'
                  ? 'bg-info/15 text-info font-medium'
                  : 'bg-muted text-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted/60',
          )}
          data-testid={`access-${area.key}-${o.v}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
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

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [access, setAccess] = useState<Record<string, AccessLevel>>({})
  const [creating, setCreating] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const grantedCount = useMemo(() => Object.values(access).filter(v => v !== 'none').length, [access])
  const canCreate = name.trim().length > 0 && grantedCount > 0 && !creating

  function resetDialog() {
    setName('')
    setAccess({})
    setRevealed(null)
    setCopied(false)
    setCreating(false)
  }

  function setAll(level: AccessLevel) {
    const next: Record<string, AccessLevel> = {}
    for (const a of API_AREAS) {
      next[a.key] = level === 'edit' && a.access !== 'rw' ? 'view' : level
    }
    setAccess(next)
  }

  function buildScopes(): string[] {
    const out: string[] = []
    for (const a of API_AREAS) {
      const lvl = access[a.key] ?? 'none'
      if (lvl === 'view') out.push(scopeView(a.key))
      else if (lvl === 'edit') { out.push(scopeView(a.key)); out.push(scopeEdit(a.key)) }
    }
    return out
  }

  async function handleCreate() {
    if (!canCreate) return
    setCreating(true)
    try {
      const scopes = buildScopes()
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
        new_value: `${scopes.length} scopes`,
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
      const { error } = await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', row.id)
      if (error) throw error
      await logActivity({
        entity_type: 'other', action: 'update', entity_name: 'api_key_revoked',
        field_name: row.name, changed_by: user?.label ?? null, metadata: { prefix: row.key_prefix },
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast({ title: 'Key revoked' }) },
    onError: (e: any) => toast({ title: 'Revoke failed', description: e?.message, variant: 'destructive' }),
  })

  const remove = useMutation({
    mutationFn: async (row: ApiKeyRow) => {
      const { error } = await supabase.from('api_keys').delete().eq('id', row.id)
      if (error) throw error
      await logActivity({
        entity_type: 'other', action: 'delete', entity_name: 'api_key_deleted',
        field_name: row.name, changed_by: user?.label ?? null, metadata: { prefix: row.key_prefix },
      })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast({ title: 'Key deleted' }) },
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
            Mint scoped keys for external tools. Pick, per area, whether a key can <span className="text-info font-medium">View</span> or{' '}
            <span className="text-warning font-medium">Create &amp; Edit</span>. Keys call{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/data/&lt;area&gt;</code> with the{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">x-api-key</code> header. The server rejects anything outside a key's scopes.
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
                <th className="px-4 py-2 font-medium">Access</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(keys ?? []).map(k => {
                const chips = scopeChips(k.scopes ?? [])
                const shown = chips.slice(0, 8)
                const extra = chips.length - shown.length
                return (
                  <tr key={k.id} className="border-b last:border-0 align-top" data-testid={`row-api-key-${k.id}`}>
                    <td className="px-4 py-2 font-medium">{k.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">{k.key_prefix}…</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {chips.length === 0 ? (
                          <span className="text-2xs text-muted-foreground">—</span>
                        ) : (
                          <>
                            {shown.map(c => (
                              <span
                                key={c.label}
                                className={cn(
                                  'text-2xs px-1.5 py-0.5 rounded',
                                  c.level === 'edit' ? 'bg-warning/15 text-warning' : 'bg-info/15 text-info',
                                )}
                              >
                                {c.label}{c.level === 'edit' ? ' ✎' : ''}
                              </span>
                            ))}
                            {extra > 0 && <span className="text-2xs text-muted-foreground px-1">+{extra}</span>}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(k.last_used_at)}</td>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
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
                          onClick={() => { if (window.confirm(`Permanently delete "${k.name}"? This cannot be undone.`)) remove.mutate(k) }}
                          data-testid={`button-delete-api-key-${k.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <Button
                          variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                          onClick={() => { if (window.confirm(`Revoke "${k.name}"? Any integration using it will stop working immediately.`)) revoke.mutate(k) }}
                          data-testid={`button-revoke-api-key-${k.id}`}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / reveal dialog */}
      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) resetDialog() }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {revealed ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your API key</DialogTitle>
                <DialogDescription>
                  This is the only time the full key is shown. Copy it now and store it in your integration's secrets.
                  If you lose it, revoke this key and create a new one.
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
                <span>Send it as the <code className="bg-muted px-1 rounded">x-api-key</code> header. It grants only the areas and levels you selected.</span>
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
                  Name the key after where you'll use it, then choose what it can reach. View = read only; Create &amp; Edit = read + write.
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
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Access by area</label>
                    <div className="flex items-center gap-2 text-xs">
                      <button type="button" className="text-info hover:underline" onClick={() => setAll('view')} data-testid="button-grant-all-view">Grant View to all</button>
                      <span className="text-muted-foreground">·</span>
                      <button type="button" className="text-muted-foreground hover:underline" onClick={() => setAll('none')} data-testid="button-clear-all">Clear</button>
                    </div>
                  </div>
                  <div className="rounded-lg border divide-y">
                    {GROUPS.map(({ group, areas }) => (
                      <div key={group} className="p-3 space-y-2">
                        <p className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">{group}</p>
                        {areas.map(a => (
                          <div key={a.key} className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm truncate">{a.label}{a.access !== 'rw' && <span className="text-2xs text-muted-foreground"> · read-only</span>}</p>
                              {a.note && <p className="text-2xs text-muted-foreground truncate">{a.note}</p>}
                            </div>
                            <AccessToggle
                              area={a}
                              value={access[a.key] ?? 'none'}
                              onChange={v => setAccess(prev => ({ ...prev, [a.key]: v }))}
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    {grantedCount} area{grantedCount === 1 ? '' : 's'} selected. Sensitive areas (users, API keys, owners, agreements, settings) can never be granted to a key.
                  </p>
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
