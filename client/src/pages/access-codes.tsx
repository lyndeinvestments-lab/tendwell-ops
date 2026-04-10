import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { Search, Copy, Check, Download, X, ArrowUp, ArrowDown, ArrowUpDown, Eye, EyeOff, KeyRound } from 'lucide-react'
import { TablePagination } from '@/components/TablePagination'
import { EmptyState } from '@/components/EmptyState'

const ACCESS_COLS = [
  { key: 'auto_code', label: 'Auto Code', sensitive: true },
  { key: 'door_code', label: 'Door Code', sensitive: true },
  { key: 'other_codes', label: 'Other Codes', sensitive: true },
  { key: 'wifi_info', label: 'WiFi Info', sensitive: true },
  { key: 'notes', label: 'Notes', sensitive: false },
]

const SENSITIVE_KEYS = ACCESS_COLS.filter(c => c.sensitive).map(c => c.key)

async function logAccessEvent(propertyId: string, fieldName: string, action: 'reveal' | 'update') {
  try {
    await supabase.from('access_audit_log').insert({
      property_id: propertyId,
      field_name: fieldName,
      action,
      timestamp: new Date().toISOString(),
    })
  } catch {
    // Silently fail - don't block UI for audit logging
  }
}

function CopyButton({ value, field, id }: { value: string; field: string; id: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="p-1 min-w-[28px] min-h-[28px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
      aria-label={copied ? 'Copied!' : `Copy ${field} to clipboard`}
      data-testid={`copy-${field}-${id}`}
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

function MaskedCell({ value, field, id, sensitive, revealed, onReveal, onSave }: {
  value: string | null; field: string; id: string; sensitive: boolean
  revealed: boolean; onReveal: () => void
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)

  const handleSave = (v: string) => {
    onSave(v)
    logAccessEvent(id, field, 'update')
    setEditing(false)
  }

  const showMasked = sensitive && !!value && !revealed && !editing

  return (
    <div className="flex items-center gap-1.5">
      <div onClick={() => setEditing(true)} onBlur={() => setEditing(false)}>
        <InlineEdit
          value={showMasked ? '••••••••' : value}
          type="text"
          onSave={handleSave}
          testId={`inline-${field}-${id}`}
          placeholder="—"
        />
      </div>
      {sensitive && value && !editing && (
        <button
          onClick={() => onReveal()}
          className="p-1 min-w-[28px] min-h-[28px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label={revealed ? `Hide ${field}` : `Reveal ${field}`}
          data-testid={`reveal-${field}-${id}`}
        >
          {revealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
      )}
      {value && (revealed || !sensitive) && <CopyButton value={value} field={field} id={id} />}
    </div>
  )
}

function CopyAllButton({ p }: { p: any }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    const parts = [`Property: ${p.name}`]
    if (p.auto_code) parts.push(`Auto: ${p.auto_code}`)
    if (p.door_code) parts.push(`Door: ${p.door_code}`)
    if (p.wifi_info) parts.push(`WiFi: ${p.wifi_info}`)
    if (p.other_codes) parts.push(`Other: ${p.other_codes}`)
    navigator.clipboard.writeText(parts.join(' | ')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
      aria-label={copied ? 'Copied!' : `Copy all codes for ${p.name}`}
      data-testid={`copy-all-${p.id}`}
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

export default function AccessCodesPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  usePageTitle('Access Codes')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortKey, setSortKey] = useState<'name' | 'stage_name' | 'auto_code' | 'door_code' | 'other_codes' | 'wifi_info' | 'notes'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/access-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, stage_name, auto_code, door_code, other_codes, wifi_info, notes, updated_at')
        .neq('stage_name', 'Offboarded')
      if (error) throw error
      return data || []
    },
  })

  const { mutate: updateField } = useGuardedMutation('access-codes', {
    mutationFn: async ({ id, field, value, oldValue, propName }: { id: string; field: string; value: string; oldValue?: any; propName?: string }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', id)
      if (error) throw error
      logPropertyEdit(id, field, oldValue, value, propName)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/access-codes'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      toast({ title: 'Saved' })
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    let result = properties.filter((p: any) => p.name?.toLowerCase().includes(search.toLowerCase()))
    result = [...result].sort((a: any, b: any) => {
      const aVal = (a[sortKey] ?? '')
      const bVal = (b[sortKey] ?? '')
      const cmp = String(aVal).localeCompare(String(bVal))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [properties, search, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // CSV export: only property name + last updated (security requirement — no credentials)
  function exportCsv() {
    const rows = filtered.map((p: any) => ({
      'Property': p.name || '',
      'Last Updated': p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '',
    }))
    const header = Object.keys(rows[0] || {}).join(',')
    const csv = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([[header, csv].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'access-codes-export.csv'; a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'CSV exported', description: `${rows.length} rows exported` })
  }

  function SortIcon({ col }: { col: typeof sortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
    if (sortDir === 'asc') return <ArrowUp className="w-3 h-3" />
    return <ArrowDown className="w-3 h-3" />
  }

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Access Codes</h1>
          <p className="text-sm text-muted-foreground">Click any field to edit — use copy icon for clipboard</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="h-8 text-xs gap-1.5" data-testid="button-export-csv">
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-access"
              className="pl-8 pr-7 h-8 w-56 text-sm"
            />
            {search && (
              <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[150px] cursor-pointer select-none hover:text-foreground group sticky left-0 z-20 bg-muted/80 backdrop-blur"
                onClick={() => handleSort('name')}
                aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <span className="flex items-center gap-1">
                  Property
                  <SortIcon col="name" />
                </span>
              </th>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap cursor-pointer select-none hover:text-foreground group"
                onClick={() => handleSort('stage_name')}
                aria-sort={sortKey === 'stage_name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <span className="flex items-center gap-1">
                  Stage
                  <SortIcon col="stage_name" />
                </span>
              </th>
              {ACCESS_COLS.map(c => (
                <th
                  key={c.key}
                  className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap cursor-pointer select-none hover:text-foreground group"
                  onClick={() => handleSort(c.key as typeof sortKey)}
                  aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className="flex items-center gap-1">
                    {c.label}
                    <SortIcon col={c.key as typeof sortKey} />
                  </span>
                </th>
              ))}
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">Last Updated</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(ACCESS_COLS.length + 4)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={ACCESS_COLS.length + 4} className="py-12">
                  <EmptyState icon={KeyRound} title="No properties found" description="No properties match your current filters." />
                </td>
              </tr>
            ) : (
              paged.map((p: any) => {
                const codeKeys = ['auto_code', 'door_code', 'other_codes']
                const missingCodes = codeKeys.filter(k => !p[k] || !p[k].trim())
                const isMissing = missingCodes.length > 0
                return (
                  <tr key={p.id} data-testid={`row-access-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-3 text-xs sticky left-0 z-10 bg-card">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openPropertyModal(p.id, 'access-codes')}
                          className="font-medium text-primary hover:underline max-w-[200px] truncate"
                          title={p.name}
                          data-testid={`link-property-${p.id}`}
                        >
                          {p.name}
                        </button>
                        {isMissing && (
                          <Badge variant="destructive" className="text-xs py-0 px-1 h-4">Missing</Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{p.stage_name || '—'}</td>
                    {ACCESS_COLS.map(c => {
                      const isEmpty = c.sensitive && (!p[c.key] || p[c.key].trim() === '')
                      return (
                        <td key={c.key} className={`py-2 px-3 ${c.key === 'notes' ? 'max-w-[200px]' : ''} ${isEmpty ? 'bg-red-100/60 dark:bg-red-900/20' : ''}`} title={c.key === 'notes' && p[c.key] ? p[c.key] : undefined}>
                          <div className="flex items-center gap-1">
                            <InlineEdit
                              value={p[c.key]}
                              type="text"
                              onSave={v => updateField({ id: p.id, field: c.key, value: v, oldValue: p[c.key], propName: p.name })}
                              testId={`inline-${c.key}-${p.id}`}
                              className={isEmpty ? 'text-red-600 dark:text-red-400' : undefined}
                            />
                            {p[c.key] && <CopyButton value={p[c.key]} field={c.key} id={p.id} />}
                          </div>
                        </td>
                      )
                    })}
                    <td className={`py-2 px-3 text-xs whitespace-nowrap ${
                      p.updated_at && (Date.now() - new Date(p.updated_at).getTime()) > 90 * 24 * 60 * 60 * 1000
                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                        : 'text-muted-foreground'
                    }`} title={p.updated_at && (Date.now() - new Date(p.updated_at).getTime()) > 90 * 24 * 60 * 60 * 1000 ? 'Last updated over 90 days ago — codes may have changed' : undefined}>
                      {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2 px-3">
                      <CopyAllButton p={p} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}
    </div>
  )
}
