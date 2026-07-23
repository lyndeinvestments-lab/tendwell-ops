import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { supabase, logActivity } from '@/lib/supabase'
import { useAuth, canEditView } from '@/lib/auth'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { EmptyState } from '@/components/EmptyState'
import { ContactModal } from '@/components/ContactModal'
import { CONTACTS_QUERY_KEY } from '@/hooks/use-contacts'
import { TablePagination } from '@/components/TablePagination'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { Search, Plus, X, Download, BarChart3, Users, ArrowUpDown, ArrowUp, ArrowDown, Import, GitMerge, UserPlus, Building2, AlertCircle } from 'lucide-react'
import Papa from 'papaparse'
import { format } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import { slugify } from '@/lib/issues'

const SOURCE_OPTIONS = ['Referral', 'Google', 'Cold Outreach', 'Trade Show', 'Social Media', 'Word of Mouth', 'Other']
const PAYMENT_OPTIONS = ['Ramp', 'Bill.com', 'QuickBooks', 'Check', 'ACH', 'Other']
const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280', '#14b8a6']

type SortKey = 'full_name' | 'company' | 'email' | 'phone' | 'source' | 'payment_method' | 'client_since' | 'properties' | 'tags'
type SortDir = 'asc' | 'desc'

function SortHeader({ label, sortKey, currentSort, currentDir, onSort }: {
  label: string; sortKey: SortKey; currentSort: SortKey; currentDir: SortDir; onSort: (k: SortKey) => void
}) {
  const active = currentSort === sortKey
  return (
    <th
      className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 cursor-pointer select-none hover:text-foreground transition-colors group"
      onClick={() => onSort(sortKey)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(sortKey) } }}
      tabIndex={0}
      role="columnheader"
      aria-sort={active ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          currentDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
        )}
      </span>
    </th>
  )
}

export default function ContactsPage() {
  const { t } = useLocale('contacts')
  const { format: formatDate } = useDateFormat()
  const { toast } = useToast()
  const { effectiveUser } = useAuth()
  const [, navigate] = useLocation()
  usePageTitle('Clients')
  // Owner-portal logins linked to each client (property_owners.contact_id).
  // Drives the Portal column: synced badge vs. an admin "Create portal"
  // shortcut that deep-links into Settings → Owners with the client picked.
  const isAdmin = effectiveUser?.role === 'admin'
  const { data: portalsByContact } = useQuery({
    queryKey: ['/supabase/contact-portals'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('property_owners').select('id, contact_id, active')
      if (error) throw error
      const m = new Map<string, { anyActive: boolean }>()
      for (const o of (data || [])) {
        if (!o.contact_id) continue
        const prev = m.get(o.contact_id)
        m.set(o.contact_id, { anyActive: (prev?.anyActive ?? false) || !!o.active })
      }
      return m
    },
  })
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState(() => {
    try { return localStorage.getItem('contacts_source_filter') || 'all' } catch { return 'all' }
  })
  const [paymentFilter, setPaymentFilter] = useState(() => {
    try { return localStorage.getItem('contacts_payment_filter') || 'all' } catch { return 'all' }
  })
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try { return (localStorage.getItem('contacts_sort_key') as SortKey) || 'full_name' } catch { return 'full_name' }
  })
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    try { return (localStorage.getItem('contacts_sort_dir') as SortDir) || 'asc' } catch { return 'asc' }
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [modalContactId, setModalContactId] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'view' | 'create'>('view')
  const [modalOpen, setModalOpen] = useState(false)
  const [sourceReportOpen, setSourceReportOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)

  // Nested under the shared CONTACTS_QUERY_KEY prefix so any mutation that
  // invalidates ['contacts'] (ContactModal create/update, merges, etc.) also
  // refreshes this page's join query via TanStack's fuzzy key matching.
  const { data: contacts, isLoading } = useQuery({
    queryKey: [...CONTACTS_QUERY_KEY, 'with-property-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*, properties(id)')
      if (error) throw error
      return data || []
    },
  })

  function handleSort(key: SortKey) {
    const newDir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc'
    setSortKey(key)
    setSortDir(newDir)
    try {
      localStorage.setItem('contacts_sort_key', key)
      localStorage.setItem('contacts_sort_dir', newDir)
    } catch {}
  }

  const filtered = useMemo(() => {
    if (!contacts) return []
    let result = contacts.filter((c: any) => {
      const q = search.toLowerCase()
      const matchSearch = !q || (c.full_name?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
      const matchSource = sourceFilter === 'all' || c.source === sourceFilter
      const matchPayment = paymentFilter === 'all' || c.payment_method === paymentFilter
      return matchSearch && matchSource && matchPayment
    })

    result.sort((a: any, b: any) => {
      let cmp = 0
      if (sortKey === 'full_name') {
        cmp = (a.full_name || '').localeCompare(b.full_name || '')
      } else if (sortKey === 'company') {
        cmp = (a.company || '').localeCompare(b.company || '')
      } else if (sortKey === 'email') {
        cmp = (a.email || '').localeCompare(b.email || '')
      } else if (sortKey === 'phone') {
        cmp = (a.phone || '').localeCompare(b.phone || '')
      } else if (sortKey === 'source') {
        cmp = (a.source || '').localeCompare(b.source || '')
      } else if (sortKey === 'payment_method') {
        cmp = (a.payment_method || '').localeCompare(b.payment_method || '')
      } else if (sortKey === 'client_since') {
        cmp = (a.client_since || '').localeCompare(b.client_since || '')
      } else if (sortKey === 'properties') {
        cmp = (a.properties?.length || 0) - (b.properties?.length || 0)
      } else if (sortKey === 'tags') {
        const aLen = (a.tags || []).length
        const bLen = (b.tags || []).length
        if (aLen !== bLen) cmp = aLen - bLen
        else cmp = (a.tags?.[0] || '').localeCompare(b.tags?.[0] || '')
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return result
  }, [contacts, search, sourceFilter, paymentFilter, sortKey, sortDir])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  function openContact(id: string) {
    setModalContactId(id)
    setModalMode('view')
    setModalOpen(true)
  }

  function openCreateContact() {
    setModalContactId(null)
    setModalMode('create')
    setModalOpen(true)
  }

  function exportCsv() {
    const rows = filtered.map((c: any) => ({
      [t('table.csv.name')]: c.full_name || '',
      [t('table.csv.company')]: c.company || '',
      [t('table.csv.email')]: c.email || '',
      [t('table.csv.phone')]: c.phone || '',
      [t('table.csv.source')]: c.source || '',
      [t('table.csv.paymentMethod')]: c.payment_method || '',
      [t('table.csv.clientSince')]: c.client_since || '',
      [t('table.csv.properties')]: c.properties?.length || 0,
      [t('table.csv.tags')]: (c.tags || []).join(', '),
    }))
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contacts-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: t('page.toastExported', { count: rows.length }) })
  }

  // Source report data
  const sourceReportData = useMemo(() => {
    if (!contacts) return []
    const map: Record<string, { total: number; withProperties: number }> = {}
    for (const c of contacts) {
      const src = c.source || 'Unknown'
      if (!map[src]) map[src] = { total: 0, withProperties: 0 }
      map[src].total++
      if (c.properties && c.properties.length > 0) map[src].withProperties++
    }
    return Object.entries(map)
      .map(([source, data]) => ({ source, ...data, conversion: data.total > 0 ? Math.round((data.withProperties / data.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
  }, [contacts])

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={<div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t('page.searchPlaceholder')}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              data-testid="input-search-contacts"
              className="pl-8 pr-7 h-8 w-full sm:w-56 text-sm"
            />
            {search && (
              <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v); setPage(1); try { localStorage.setItem('contacts_source_filter', v) } catch {} }}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder={t('page.allSources')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('page.allSources')}</SelectItem>
              {SOURCE_OPTIONS.map(s => <SelectItem key={s} value={s}>{t('source.' + slugify(s), undefined, s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={paymentFilter} onValueChange={v => { setPaymentFilter(v); setPage(1); try { localStorage.setItem('contacts_payment_filter', v) } catch {} }}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder={t('page.allPayments')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('page.allPayments')}</SelectItem>
              {PAYMENT_OPTIONS.map(p => <SelectItem key={p} value={p}>{t('paymentMethod.' + slugify(p), undefined, p)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setSourceReportOpen(true)}>
                <BarChart3 className="w-3.5 h-3.5" /> {t('page.sourceReportButton')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('page.sourceReportTooltip')}</TooltipContent>
          </Tooltip>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="w-3.5 h-3.5" /> {t('common.actions.exportCsv')}
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setDuplicateOpen(true)} disabled={filtered.length === 0}>
            <GitMerge className="w-3.5 h-3.5" /> {t('page.findDuplicatesButton')}
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={openCreateContact} data-testid="button-add-contact">
            <Plus className="w-3.5 h-3.5" /> {t('page.addClientButton')}
          </Button>
        </div>}
      />

      {/* Redesign: summary strip — at-a-glance client stats */}
      {!isLoading && (contacts?.length ?? 0) > 0 && (() => {
        const list = contacts || []
        const total = list.length
        const since = Date.now() - 30 * 24 * 60 * 60 * 1000
        const new30 = list.filter((c: any) => c.created_at && new Date(c.created_at).getTime() >= since).length
        const unassigned = list.filter((c: any) => !(c.properties && c.properties.length > 0)).length
        const totalProps = list.reduce((s: number, c: any) => s + (c.properties?.length || 0), 0)
        const avgProps = total ? (totalProps / total) : 0
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm p-4">
              <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Users className="w-3.5 h-3.5" /> {t('page.summaryTotalClients')}</div>
              <p className="mt-1 text-3xl font-bold tabular-nums leading-none">{total}</p>
            </div>
            <div className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
              <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><UserPlus className="w-3.5 h-3.5" /> {t('page.summaryNew30')}</div>
              <p className="mt-1 text-3xl font-bold tabular-nums leading-none text-success">{new30}</p>
            </div>
            <div className={`rounded-2xl border shadow-sm p-4 ${unassigned > 0 ? 'border-warning/30 bg-warning/5' : 'border-card-border bg-card'}`}>
              <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><AlertCircle className="w-3.5 h-3.5" /> {t('page.summaryUnassigned')}</div>
              <p className={`mt-1 text-3xl font-bold tabular-nums leading-none ${unassigned > 0 ? 'text-warning' : ''}`}>{unassigned}</p>
            </div>
            <div className="rounded-2xl border border-card-border bg-card shadow-sm p-4">
              <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground"><Building2 className="w-3.5 h-3.5" /> {t('page.summaryAvgProperties')}</div>
              <p className="mt-1 text-3xl font-bold tabular-nums leading-none">{avgProps.toFixed(1)}</p>
            </div>
          </div>
        )
      })()}

      <div className="overflow-auto flex-1 rounded-2xl border border-border shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-20">
            <tr>
              <SortHeader label={t('common.labels.name')} sortKey="full_name" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label={t('table.company')} sortKey="company" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label={t('common.labels.email')} sortKey="email" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label={t('common.labels.phone')} sortKey="phone" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label={t('table.source')} sortKey="source" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label={t('table.payment')} sortKey="payment_method" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label={t('table.clientSince')} sortKey="client_since" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortHeader label={t('common.labels.properties')} sortKey="properties" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3" role="columnheader">{t('table.portal')}</th>
              <SortHeader label={t('table.tags')} sortKey="tags" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(10)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  {contacts && contacts.length === 0 ? (
                    <EmptyState
                      icon={Users}
                      title={t('page.emptyTitle')}
                      description={t('page.emptyDescription')}
                    />
                  ) : (
                    <div className="text-center py-12 text-muted-foreground text-sm">{t('page.emptyFiltered')}</div>
                  )}
                </td>
              </tr>
            ) : (
              paged.map((c: any) => (
                <tr
                  key={c.id}
                  onClick={() => openContact(c.id)}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                  data-testid={`row-contact-${c.id}`}
                >
                  <td className="py-2 px-3 font-medium text-xs">{c.full_name}</td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{c.company || '—'}</td>
                  <td className="py-2 px-3 text-xs">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} className="text-primary hover:underline">{c.email}</a>
                    ) : '—'}
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">{c.phone || '—'}</td>
                  <td className="py-2 px-3 text-xs">
                    {c.source ? <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-foreground/80 ring-1 ring-border">{t('source.' + slugify(c.source), undefined, c.source)}</span> : <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="py-2 px-3 text-xs">
                    {c.payment_method ? <span className="inline-flex items-center rounded-full bg-info/10 px-2 py-0.5 text-2xs font-medium text-info ring-1 ring-info/20">{t('paymentMethod.' + slugify(c.payment_method), undefined, c.payment_method)}</span> : <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{c.client_since ? formatDate(new Date(c.client_since + 'T00:00:00'), 'MMM d, yyyy') : '—'}</td>
                  <td className="py-2 px-3 text-xs">
                    {(c.properties?.length || 0) > 0
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-2xs font-semibold tabular-nums ring-1 ring-primary/20"><Building2 className="w-3 h-3" />{c.properties.length}</span>
                      : <span className="inline-flex items-center rounded-full bg-warning/10 text-warning px-2 py-0.5 text-2xs font-medium ring-1 ring-warning/20">{t('table.noneBadge')}</span>}
                  </td>
                  <td className="py-2 px-3 text-xs">
                    {portalsByContact?.get(c.id) ? (
                      portalsByContact.get(c.id)!.anyActive ? (
                        <span className="inline-flex items-center rounded-full bg-success/10 text-success px-2 py-0.5 text-2xs font-medium ring-1 ring-success/20">{t('portal.active')}</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground ring-1 ring-border">{t('portal.inactive')}</span>
                      )
                    ) : isAdmin ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/settings?tab=owners&portalFor=${c.id}`) }}
                        className="text-2xs text-primary hover:underline underline-offset-2"
                        data-testid={`button-create-portal-${c.id}`}
                      >
                        {t('portal.create')}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs">
                    {(c.tags || []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((tag: string) => (
                          <span key={tag} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs">{tag}</span>
                        ))}
                        {c.tags.length > 3 && <span className="text-xs text-muted-foreground">+{c.tags.length - 3}</span>}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && filtered.length > 0 && (
        <TablePagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      <ContactModal
        contactId={modalContactId}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={modalMode}
      />

      {/* Source Report Modal */}
      <Dialog open={sourceReportOpen} onOpenChange={setSourceReportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('sourceReport.dialogTitle')}</DialogTitle>
          </DialogHeader>
          {sourceReportData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{t('sourceReport.empty')}</p>
          ) : (
            <div className="space-y-4">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceReportData} layout="vertical" margin={{ left: 80 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="source" tick={{ fontSize: 11 }} width={75} tickFormatter={(v: string) => t('source.' + slugify(v), undefined, v)} />
                    <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="total" name={t('sourceReport.chartLabel')} radius={[0, 4, 4, 0]}>
                      {sourceReportData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">{t('sourceReport.colSource')}</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">{t('sourceReport.colTotal')}</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">{t('sourceReport.colWithProperties')}</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">{t('sourceReport.colConversion')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceReportData.map(row => (
                      <tr key={row.source} className="border-t border-border/50">
                        <td className="py-1.5 px-2">{t('source.' + slugify(row.source), undefined, row.source)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{row.total}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{row.withProperties}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{row.conversion}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Duplicate Detection Modal */}
      <DuplicateDetectionModal open={duplicateOpen} onClose={() => setDuplicateOpen(false)} contacts={contacts || []} />
    </PageContainer>
  )
}

// ── Duplicate Detection ──────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const an = a.length, bn = b.length
  if (an === 0) return bn
  if (bn === 0) return an
  const matrix = Array.from({ length: bn + 1 }, (_, i) => [i])
  for (let j = 0; j <= an; j++) matrix[0][j] = j
  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
    }
  }
  return matrix[bn][an]
}

function DuplicateDetectionModal({ open, onClose, contacts }: { open: boolean; onClose: () => void; contacts: any[] }) {
  const { t } = useLocale('contacts')
  const { toast } = useToast()
  const qc = useQueryClient()
  const { effectiveUser } = useAuth()
  const [merging, setMerging] = useState(false)

  const duplicates = useMemo(() => {
    if (!contacts || contacts.length < 2) return []
    // `reason` stores a stable code (not the display string) — translated at
    // render time via `duplicates.reasonSimilarName`/`reasonSameEmail`.
    const pairs: { primary: any; secondary: any; reason: 'similar_name' | 'same_email' }[] = []
    const seen = new Set<string>()
    for (let i = 0; i < contacts.length; i++) {
      for (let j = i + 1; j < contacts.length; j++) {
        const a = contacts[i], b = contacts[j]
        const key = [a.id, b.id].sort().join('_')
        if (seen.has(key)) continue
        // Check name similarity
        const nameA = (a.full_name || '').toLowerCase()
        const nameB = (b.full_name || '').toLowerCase()
        if (nameA && nameB && levenshtein(nameA, nameB) <= 2) {
          seen.add(key)
          pairs.push({ primary: a, secondary: b, reason: 'similar_name' })
          continue
        }
        // Check email match
        if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
          seen.add(key)
          pairs.push({ primary: a, secondary: b, reason: 'same_email' })
        }
      }
    }
    return pairs
  }, [contacts])

  async function handleMerge(primary: any, secondary: any) {
    if (!canEditView('contacts', effectiveUser)) {
      toast({ title: t('duplicates.toastEditAccessRequired'), description: t('duplicates.toastEditAccessDescription'), variant: 'destructive' })
      return
    }
    setMerging(true)
    try {
      // Copy non-null fields from secondary to primary
      const updates: Record<string, any> = {}
      const fields = ['company', 'email', 'phone', 'secondary_phone', 'mailing_address', 'source', 'payment_method', 'client_since', 'notes']
      for (const f of fields) {
        if (!primary[f] && secondary[f]) updates[f] = secondary[f]
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('contacts').update(updates).eq('id', primary.id)
      }
      // Reassign properties
      await supabase.from('properties').update({ contact_id: primary.id }).eq('contact_id', secondary.id)
      // Reassign interactions
      await supabase.from('contact_interactions').update({ contact_id: primary.id }).eq('contact_id', secondary.id)
      // Reassign notes — without this the secondary's contact_notes are lost
      // (or block the merge) when the secondary contact is deleted below.
      await supabase.from('contact_notes').update({ contact_id: primary.id }).eq('contact_id', secondary.id)
      // Delete secondary
      await supabase.from('contacts').delete().eq('id', secondary.id)
      logActivity({
        entity_type: 'contact',
        entity_id: primary.id,
        entity_name: primary.full_name,
        action: 'delete',
        field_name: 'merge',
        old_value: secondary.full_name,
        new_value: primary.full_name,
        metadata: { merged_from_id: secondary.id },
      })
      // Refresh the shared useContacts cache app-wide; fuzzy matching also
      // covers this page's ['contacts', 'with-property-counts'] join query.
      qc.invalidateQueries({ queryKey: CONTACTS_QUERY_KEY })
      toast({ title: t('duplicates.toastMerged') })
    } catch (e: any) {
      toast({ title: t('duplicates.toastMergeFailed'), description: e?.message, variant: 'destructive' })
    } finally {
      setMerging(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('duplicates.dialogTitle')}</DialogTitle></DialogHeader>
        {duplicates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t('duplicates.empty')}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('duplicates.pairsFound', { count: duplicates.length })}</p>
            {duplicates.map(({ primary, secondary, reason }, i) => (
              <div key={i} className="border border-border rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-2">{reason === 'similar_name' ? t('duplicates.reasonSimilarName') : t('duplicates.reasonSameEmail')}</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="font-medium">{primary.full_name}</p>
                    <p className="text-muted-foreground">{primary.email || '—'}</p>
                    <p className="text-muted-foreground">{t('duplicates.propertiesCount', { count: primary.properties?.length || 0 })}</p>
                  </div>
                  <div>
                    <p className="font-medium">{secondary.full_name}</p>
                    <p className="text-muted-foreground">{secondary.email || '—'}</p>
                    <p className="text-muted-foreground">{t('duplicates.propertiesCount', { count: secondary.properties?.length || 0 })}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="mt-2 text-xs w-full" disabled={merging} onClick={() => handleMerge(primary, secondary)}>
                  {t('duplicates.mergeButton', { name: primary.full_name })}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
