import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, logPropertyEdit } from '@/lib/supabase'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { useGuardedMutation } from '@/hooks/use-guarded-mutation'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useAppSettings } from '@/hooks/use-app-settings'
import { Search, Copy, Check, Download, X, ArrowUp, ArrowDown, ArrowUpDown, Eye, EyeOff, KeyRound } from 'lucide-react'
import { TablePagination } from '@/components/TablePagination'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import type { TFunc } from '@/lib/i18n/t'

const ACCESS_COLS = [
  { key: 'door_code', sensitive: true },
  { key: 'other_codes', sensitive: true },
  { key: 'wifi_info', sensitive: true },
  { key: 'notes', sensitive: false },
]

const SENSITIVE_KEYS = ACCESS_COLS.filter(c => c.sensitive).map(c => c.key)

/** `'Active'` → `'active'`; used to look up the shared `common.stage.*` display name for `stage_name` (DB value stays canonical English). Copied from `lib/issues.ts`'s `slugify`. */
function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** Translated column label for an ACCESS_COLS key (door_code / other_codes / wifi_info / notes). */
function columnLabel(key: string, t: TFunc): string {
  switch (key) {
    case 'door_code': return t('table.doorCode')
    case 'other_codes': return t('table.otherCodes')
    case 'wifi_info': return t('table.wifiInfo')
    case 'notes': return t('common.labels.notes')
    default: return key
  }
}

async function logAccessEvent(propertyId: string, fieldName: string, action: 'reveal' | 'update') {
  try {
    await supabase.from('access_audit_log').insert({
      property_id: Number(propertyId),
      field_name: fieldName,
      action,
      timestamp: new Date().toISOString(),
    })
  } catch {
    // Silently fail - don't block UI for audit logging
  }
}

function CopyButton({ value, field, id }: { value: string; field: string; id: string }) {
  const { t } = useLocale('accessCodes')
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
      aria-label={copied ? t('aria.copied') : t('aria.copyField', { field })}
      data-testid={`copy-${field}-${id}`}
    >
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

function MaskedCell({ value, field, id, sensitive, revealed, onReveal, onSave }: {
  value: string | null; field: string; id: string; sensitive: boolean
  revealed: boolean; onReveal: () => void
  onSave: (v: string) => void
}) {
  const { t } = useLocale('accessCodes')
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
          aria-label={revealed ? t('aria.hideField', { field }) : t('aria.revealField', { field })}
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
  const { t } = useLocale('accessCodes')
  const [copied, setCopied] = useState(false)
  const { get } = useAppSettings()
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    const parts = [`${t('copyAll.propertyLabel')}: ${p.name}`]
    if (p.has_auto_code) parts.push(`${t('copyAll.autoLabel')}: ${get('auto_code', '') || t('common.actions.yes')}`)
    if (p.door_code) parts.push(`${t('copyAll.doorLabel')}: ${p.door_code}`)
    if (p.wifi_info) parts.push(`${t('copyAll.wifiLabel')}: ${p.wifi_info}`)
    if (p.other_codes) parts.push(`${t('copyAll.otherLabel')}: ${p.other_codes}`)
    navigator.clipboard.writeText(parts.join(' | ')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
      aria-label={copied ? t('aria.copied') : t('aria.copyAllCodes', { name: p.name })}
      data-testid={`copy-all-${p.id}`}
    >
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

export default function AccessCodesPage() {
  const { t, locale } = useLocale('accessCodes')
  const { toast } = useToast()
  const qc = useQueryClient()
  const { openPropertyModal } = usePropertyModal()
  // Browser tab title stays English (matches the /issues precedent).
  usePageTitle('Access Codes')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortKey, setSortKey] = useState<'name' | 'stage_name' | 'door_code' | 'other_codes' | 'wifi_info' | 'notes'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const { get: getSetting } = useAppSettings()
  const autoCodeValue = getSetting('auto_code', '')

  const { data: properties, isLoading, isError, refetch } = useQuery({
    queryKey: ['/supabase/access-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, stage_name, has_auto_code, door_code, other_codes, wifi_info, notes, updated_at')
        .in('stage_name', ['Active', 'Onboarding', 'Offboarding'])
        .not('name', 'is', null)
      if (error) throw error
      return data || []
    },
  })

  const { mutate: updateField } = useGuardedMutation('access-codes', {
    mutationFn: async ({ id, field, value, oldValue, propName }: { id: string; field: string; value: string; oldValue?: any; propName?: string }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', Number(id))
      if (error) throw error
      logPropertyEdit(id, field, oldValue, value, propName)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/supabase/access-codes'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      toast({ title: t('toasts.saved') })
    },
    onError: (error: any) => toast({ title: t('toasts.updateFailed'), description: error?.message, variant: 'destructive' }),
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

  // Summary tiles — computed only from already-loaded rows (no new query).
  // A row "has a code" if either door_code or other_codes is set (matches the
  // row-level badge logic which uses door_code + other_codes).
  const stats = useMemo(() => {
    const rows = properties ?? []
    const hasCode = (p: any) =>
      (!!p.door_code && String(p.door_code).trim() !== '') ||
      (!!p.other_codes && String(p.other_codes).trim() !== '')
    const withCode = rows.filter(hasCode).length
    return {
      total: rows.length,
      withCode,
      missing: rows.length - withCode,
      autoCode: rows.filter((p: any) => !!p.has_auto_code).length,
    }
  }, [properties])

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
      [t('common.labels.property')]: p.name || '',
      [t('table.lastUpdated')]: p.updated_at ? new Date(p.updated_at).toLocaleDateString(locale === 'es' ? 'es' : 'en-US') : '',
    }))
    const header = Object.keys(rows[0] || {}).join(',')
    const csv = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([[header, csv].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'access-codes-export.csv'; a.click()
    URL.revokeObjectURL(url)
    toast({ title: t('toasts.csvExported'), description: t('toasts.csvExportedDescription', { count: rows.length }) })
  }

  function SortIcon({ col }: { col: typeof sortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
    if (sortDir === 'asc') return <ArrowUp className="w-3 h-3" />
    return <ArrowDown className="w-3 h-3" />
  }

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="h-8 text-xs gap-1.5" data-testid="button-export-csv">
              <Download className="w-3.5 h-3.5" />
              {t('common.actions.exportCsv')}
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('page.searchPlaceholder')}
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                data-testid="input-search-access"
                className="pl-8 pr-7 h-8 w-56 text-sm"
              />
              {search && (
                <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={t('page.clearSearch')}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-12 mt-2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm p-4">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><KeyRound className="w-3.5 h-3.5" /> {t('stats.totalProperties')}</div>
            <p className="mt-1 text-3xl font-bold tabular-nums leading-none">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Check className="w-3.5 h-3.5" /> {t('stats.hasCode')}</div>
            <p className="mt-1 text-3xl font-bold tabular-nums leading-none text-success">{stats.withCode}</p>
          </div>
          <div className={`rounded-2xl border shadow-sm p-4 ${stats.missing > 0 ? 'border-warning/30 bg-warning/5' : 'border-card-border bg-card'}`}>
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><X className="w-3.5 h-3.5" /> {t('stats.missingCode')}</div>
            <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${stats.missing > 0 ? 'text-warning' : ''}`}>{stats.missing}</p>
          </div>
          <div className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Eye className="w-3.5 h-3.5" /> {t('stats.autoCode')}</div>
            <p className="mt-1 text-3xl font-bold tabular-nums leading-none text-info">{stats.autoCode}</p>
          </div>
        </div>
      )}

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
      <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[150px] cursor-pointer select-none hover:text-foreground group sticky left-0 top-0 z-30 bg-muted"
                onClick={() => handleSort('name')}
                aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <span className="flex items-center gap-1">
                  {t('common.labels.property')}
                  <SortIcon col="name" />
                </span>
              </th>
              <th
                className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap cursor-pointer select-none hover:text-foreground group"
                onClick={() => handleSort('stage_name')}
                aria-sort={sortKey === 'stage_name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <span className="flex items-center gap-1">
                  {t('table.stage')}
                  <SortIcon col="stage_name" />
                </span>
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{t('table.autoCode')}</th>
              {ACCESS_COLS.map(c => (
                <th
                  key={c.key}
                  className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap cursor-pointer select-none hover:text-foreground group"
                  onClick={() => handleSort(c.key as typeof sortKey)}
                  aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className="flex items-center gap-1">
                    {columnLabel(c.key, t)}
                    <SortIcon col={c.key as typeof sortKey} />
                  </span>
                </th>
              ))}
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{t('table.lastUpdated')}</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(ACCESS_COLS.length + 5)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={ACCESS_COLS.length + 5} className="py-12">
                  <EmptyState icon={KeyRound} title={t('page.emptyTitle')} description={t('page.emptyDescription')} />
                </td>
              </tr>
            ) : (
              paged.map((p: any) => {
                const codeKeys: Array<{ key: string; label: string }> = [
                  { key: 'door_code', label: columnLabel('door_code', t) },
                  { key: 'other_codes', label: columnLabel('other_codes', t) },
                ]
                const missingCodes = codeKeys.filter(c => !p[c.key] || !String(p[c.key]).trim())
                const filledCount = codeKeys.length - missingCodes.length
                // "Missing" = no codes at all. "Incomplete" = at least one but not all.
                const badgeState: 'missing' | 'incomplete' | 'complete' =
                  filledCount === 0 ? 'missing' :
                  missingCodes.length > 0 ? 'incomplete' :
                  'complete'
                const missingLabel = missingCodes.map(c => c.label).join(', ')
                return (
                  <tr key={p.id} data-testid={`row-access-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-3 text-xs sticky left-0 z-10 bg-background">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openPropertyModal(p.id, 'access-codes')}
                          className="font-medium text-primary hover:underline max-w-[200px] truncate"
                          title={p.name}
                          data-testid={`link-property-${p.id}`}
                        >
                          {p.name}
                        </button>
                        {badgeState === 'missing' && (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="destructive" className="text-xs py-0 px-1 h-4 cursor-help">{t('badges.missing')}</Badge>
                              </TooltipTrigger>
                              <TooltipContent>{t('badges.missingTooltip', { fields: missingLabel })}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {badgeState === 'incomplete' && (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge className="text-xs py-0 px-1 h-4 bg-warning/10 text-warning border-warning/25 hover:bg-warning/15 cursor-help">{t('badges.incomplete')}</Badge>
                              </TooltipTrigger>
                              <TooltipContent>{t('badges.incompleteTooltip', { fields: missingLabel })}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{p.stage_name ? t(`common.stage.${slugify(p.stage_name)}`, undefined, p.stage_name) : '—'}</td>
                    <td className="py-2 px-3 text-xs whitespace-nowrap">{p.has_auto_code ? <span className="font-mono">{autoCodeValue || t('common.actions.yes')}</span> : <span className="text-muted-foreground">-</span>}</td>
                    {ACCESS_COLS.map(c => {
                      const isEmpty = c.sensitive && (!p[c.key] || p[c.key].trim() === '')
                      return (
                        <td key={c.key} className={`py-2 px-3 ${c.key === 'notes' ? 'max-w-[200px]' : ''} ${isEmpty ? 'bg-destructive/5' : ''}`} title={c.key === 'notes' && p[c.key] ? p[c.key] : undefined}>
                          <div className="flex items-center gap-1">
                            <InlineEdit
                              value={p[c.key]}
                              type="text"
                              onSave={v => updateField({ id: p.id, field: c.key, value: v, oldValue: p[c.key], propName: p.name })}
                              testId={`inline-${c.key}-${p.id}`}
                              className={isEmpty ? 'text-destructive' : undefined}
                            />
                            {p[c.key] && <CopyButton value={p[c.key]} field={c.key} id={p.id} />}
                          </div>
                        </td>
                      )
                    })}
                    <td className={`py-2 px-3 text-xs whitespace-nowrap ${
                      p.updated_at && (Date.now() - new Date(p.updated_at).getTime()) > 90 * 24 * 60 * 60 * 1000
                        ? 'text-warning font-medium'
                        : 'text-muted-foreground'
                    }`} title={p.updated_at && (Date.now() - new Date(p.updated_at).getTime()) > 90 * 24 * 60 * 60 * 1000 ? t('table.staleTooltip') : undefined}>
                      {p.updated_at ? new Date(p.updated_at).toLocaleDateString(locale === 'es' ? 'es' : 'en-US') : '—'}
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
      )}
      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}
    </PageContainer>
  )
}
