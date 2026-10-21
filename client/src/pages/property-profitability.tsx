import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import type { TFunc } from '@/lib/i18n/t'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useInvoiceCoverage, usePropertyEconomics, todayEt, type InvoiceCoverage } from '@/hooks/use-property-economics'
import { addDays, addMonths, monthEnd, monthOf, type CompanyEconomics, type PoolSource, type PropertyEconomics } from '@/lib/financials/property-economics'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmtCurrency, fmtPct } from '@/lib/financials/format'
import { profitColorClass } from '@/lib/profit-colors'
import { Search, X, Building2, Download, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ChevronDown, Info, AlertTriangle, TrendingDown } from 'lucide-react'

// Per-Property economics for a period: what each property should earn at its
// rates, what Busy Bee billed and paid, and its share of real inspection,
// laundry, consumables and overhead spend. Logic lives in
// lib/financials/property-economics.ts; this page only fetches and renders.

type SortKey = 'name' | 'cleans' | 'notOnInvoice' | 'expectedRevenue' | 'revenue' | 'billingGap' | 'labor' | 'inspections'
  | 'laundry' | 'consumables' | 'overhead' | 'profit' | 'margin'

interface Period {
  key: string
  start: string
  end: string
  label: string
}

function buildPeriods(coverage: InvoiceCoverage | undefined, today: string, locale: string, t: TFunc): Period[] {
  const lang = locale === 'es' ? 'es' : 'en-US'
  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang, { month: 'short', day: 'numeric' })
  const month = (m: string) => new Date(`${m}T12:00:00`).toLocaleDateString(lang, { month: 'long', year: 'numeric' })
  const out: Period[] = []
  if (coverage?.through) {
    const end = coverage.through
    out.push({ key: 'week', start: addDays(end, -6), end, label: t('profit.period.lastWeek', { range: `${day(addDays(end, -6))} – ${day(end)}` }) })
    const prevEnd = addDays(end, -7)
    out.push({ key: 'prevWeek', start: addDays(prevEnd, -6), end: prevEnd, label: t('profit.period.prevWeek', { range: `${day(addDays(prevEnd, -6))} – ${day(prevEnd)}` }) })
  }
  const current = monthOf(today)
  out.push({ key: 'mtd', start: current, end: today, label: t('profit.period.mtd', { month: month(current) }) })
  for (let k = 1; k <= 6; k++) {
    const m = addMonths(current, -k)
    out.push({ key: `m:${m}`, start: m, end: monthEnd(m), label: month(m) })
  }
  out.push({ key: 'last3', start: addMonths(current, -3), end: monthEnd(addMonths(current, -1)), label: t('profit.period.last3') })
  return out
}

function Row({ label, value, tone, bold, sub }: { label: ReactNode; value: ReactNode; tone?: 'good' | 'bad' | 'muted'; bold?: boolean; sub?: boolean }) {
  const toneCls = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : tone === 'muted' ? 'text-muted-foreground' : ''
  return (
    <div className={`flex items-baseline justify-between gap-3 ${sub ? 'pl-3 text-muted-foreground' : ''} ${bold ? 'font-semibold border-t border-border/60 pt-1 mt-1' : ''}`}>
      <span className="text-xs">{label}</span>
      <span className={`text-sm tabular-nums whitespace-nowrap ${toneCls}`}>{value}</span>
    </div>
  )
}

function LedgerCard({ title, children, footer, loading }: { title: string; children: ReactNode; footer?: ReactNode; loading?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</h3>
      {loading ? <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-4 w-full" />)}</div> : children}
      {!loading && footer && <div className="pt-2 text-2xs text-muted-foreground space-y-0.5">{footer}</div>}
    </div>
  )
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmtCurrency(n)}`

export default function PropertyProfitabilityPage() {
  const { t, locale } = useLocale('financials')
  const { openPropertyModal } = usePropertyModal()
  const today = todayEt()
  const coverageQ = useInvoiceCoverage()
  const periods = useMemo(() => buildPeriods(coverageQ.data, today, locale, t), [coverageQ.data, today, locale, t])
  const [periodKey, setPeriodKey] = useState<string | null>(null)
  const period = periods.find(p => p.key === periodKey) ?? periods.find(p => p.key === `m:${addMonths(monthOf(today), -1)}`) ?? periods[0]
  const q = usePropertyEconomics(period?.start ?? null, period?.end ?? null, coverageQ.data)

  const [search, setSearch] = useState('')
  const [losingOnly, setLosingOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('profit')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [open, setOpen] = useState<number | null>(null)

  const rows = q.data?.properties ?? []
  const company = q.data?.company
  const loading = coverageQ.isLoading || q.isLoading

  const filtered = useMemo(() => {
    const needle = search.toLowerCase()
    const base = rows.filter(r => (!needle || r.name.toLowerCase().includes(needle)) && (!losingOnly || r.profit < 0))
    return [...base].sort((a, b) => {
      const av = a[sortKey] ?? (sortKey === 'name' ? '' : -Infinity)
      const bv = b[sortKey] ?? (sortKey === 'name' ? '' : -Infinity)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, search, losingOnly, sortKey, sortDir])

  const totals = useMemo(() => {
    const s = (f: (r: PropertyEconomics) => number) => filtered.reduce((acc, r) => acc + f(r), 0)
    const revenue = s(r => r.revenue)
    const profit = s(r => r.profit)
    return {
      cleans: s(r => r.cleans), notOnInvoice: s(r => r.notOnInvoice), expected: s(r => r.expectedRevenue), revenue,
      gap: s(r => r.billingGap), labor: s(r => r.labor), inspections: s(r => r.inspections), laundry: s(r => r.laundry),
      consumables: s(r => r.consumables), overhead: s(r => r.overhead), profit, margin: revenue > 0 ? (profit / revenue) * 100 : null,
    }
  }, [filtered])

  const losing = useMemo(() => rows.filter(r => r.profit < 0).sort((a, b) => a.profit - b.profit), [rows])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  function exportCsv() {
    const header = ['Property', 'Stage', 'Rate', 'Pay rate', 'Cleans', 'Deep cleans', 'Cleans not invoiced yet', 'Logged cleans not on invoice',
      'Expected revenue', 'Billed cleans', 'Billed extras', 'Estimated revenue', 'Revenue', 'Billed vs expected',
      'Busy Bee pay cleans', 'Busy Bee pay extras', 'Estimated pay', 'Cleaner pay', 'Inspections', 'Laundry', 'Laundry expected',
      'Consumables', 'Consumables expected', 'Overhead', 'Total cost', 'Profit', 'Margin %', 'Reasons']
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = filtered.map(r => [
      esc(r.name), esc(r.stage ?? ''), r.rate ?? '', r.payRate ?? '', r.cleans, r.deepCleans, r.cleansNotInvoiced, r.notOnInvoice,
      r.expectedRevenue.toFixed(2), r.billedCleaning.toFixed(2), r.billedExtras.toFixed(2), r.estimatedRevenue.toFixed(2), r.revenue.toFixed(2), r.billingGap.toFixed(2),
      r.cleaningPay.toFixed(2), r.extraPay.toFixed(2), r.estimatedPay.toFixed(2), r.labor.toFixed(2), r.inspections.toFixed(2), r.laundry.toFixed(2), r.laundryExpected.toFixed(2),
      r.consumables.toFixed(2), r.consumablesExpected.toFixed(2), r.overhead.toFixed(2), r.totalCost.toFixed(2), r.profit.toFixed(2), r.margin?.toFixed(1) ?? '',
      esc(r.reasons.map(x => x.code).join(' ')),
    ].join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `property-economics-${period?.start}-${period?.end}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const lang = locale === 'es' ? 'es' : 'en-US'
  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang, { month: 'short', day: 'numeric' })
  const monthName = (m: string) => new Date(`${m}T12:00:00`).toLocaleDateString(lang, { month: 'long' })
  const reasonText = (code: string, amount: number, count?: number) => t(`profit.reasons.${code}`, { amount: fmtCurrency(amount), count: count ?? 0 })
  const srcTag = (s: PoolSource) => <span className="ml-1 text-2xs rounded bg-muted px-1 py-px text-muted-foreground">{t(`profit.sourceTag.${s}`)}</span>

  const SortIcon = ({ column }: { column: SortKey }) =>
    sortKey !== column ? <ArrowUpDown className="w-3 h-3 ml-1 opacity-40 inline shrink-0" />
      : sortDir === 'asc' ? <ArrowUp className="w-3 h-3 ml-1 inline shrink-0" /> : <ArrowDown className="w-3 h-3 ml-1 inline shrink-0" />

  const HeaderCell = ({ column, label, title }: { column: SortKey; label: string; title?: string }) => (
    <th
      title={title}
      className="text-right first:text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-2.5 cursor-pointer select-none hover:text-foreground whitespace-nowrap"
      onClick={() => toggleSort(column)}
    >
      {label}<SortIcon column={column} />
    </th>
  )

  if (coverageQ.isError || q.isError) {
    return <div className="p-5"><ErrorState onRetry={() => { coverageQ.refetch(); q.refetch() }} /></div>
  }

  const partialMonth = company?.months.find(m => m.partial)
  const COLS = 15

  return (
    <div className="p-5 space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={period?.key ?? ''} onValueChange={v => { setPeriodKey(v); setOpen(null) }}>
          <SelectTrigger className="h-8 w-64 text-xs" data-testid="select-profit-period"><SelectValue /></SelectTrigger>
          <SelectContent>
            {periods.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input type="search" placeholder={t('profit.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-8 pr-7 h-8 w-52 text-sm" data-testid="input-profit-search" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
        </div>
        <Button variant={losingOnly ? 'default' : 'outline'} size="sm" className="h-8 text-xs gap-1.5" onClick={() => setLosingOnly(v => !v)} data-testid="button-losing-only">
          <TrendingDown className="w-3.5 h-3.5" /> {t('profit.losingOnly')}
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 ml-auto" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="w-3.5 h-3.5" /> CSV
        </Button>
      </div>

      {/* Data notes */}
      {company && q.data && (
        <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p className="flex gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {q.data.coverage.from && q.data.coverage.through
                ? t('profit.coverage', { from: day(q.data.coverage.from), through: day(q.data.coverage.through) })
                : t('profit.noCoverage')}
              {company.cleansNotInvoiced > 0 && q.data.coverage.through && <> {t('profit.coverageEstimated', { count: company.cleansNotInvoiced, through: day(q.data.coverage.through) })}</>}
            </span>
          </p>
          {partialMonth && <p className="pl-5">{t('profit.partialMonth', { month: monthName(partialMonth.month) })}</p>}
          {company.notOnInvoice > 0 && <p className="pl-5">{t('profit.notOnInvoice', { count: company.notOnInvoice })}</p>}
        </div>
      )}

      {/* Company reconciliation */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <RevenueCard c={company} t={t} loading={loading} />
        <LedgerCard title={t('profit.cards.labor.title')} loading={loading}>
          {company && <>
            <Row label={t('profit.cards.labor.cleaning')} value={fmtCurrency(company.labor.cleaning)} />
            <Row label={t('profit.cards.labor.extras')} value={fmtCurrency(company.labor.extras)} />
            {company.labor.estimated > 0 && <Row label={t('profit.cards.labor.estimated')} value={fmtCurrency(company.labor.estimated)} tone="muted" />}
            <Row label={t('profit.cards.labor.total')} value={fmtCurrency(company.labor.total)} bold />
            {company.labor.qboContractorPay != null && <Row label={t('profit.cards.labor.qbo')} value={fmtCurrency(company.labor.qboContractorPay)} tone="muted" />}
          </>}
        </LedgerCard>
        <LedgerCard
          title={t('profit.cards.inspections.title')}
          loading={loading}
          footer={company?.inspections.weeks.map(w => (
            <div key={w.weekEnd}>{t('profit.cards.inspections.weekRow', {
              date: day(w.weekEnd), amount: fmtCurrency(w.amount), count: w.properties, each: fmtCurrency(w.properties ? w.amount / w.properties : 0),
            })}</div>
          ))}
        >
          {company && <>
            <Row label={t('profit.cards.inspections.busyBee')} value={fmtCurrency(company.inspections.busyBee)} />
            <Row label={t('profit.cards.inspections.qbo')} value={fmtCurrency(company.inspections.qbo)} />
            {company.inspections.direct > 0 && <Row label={t('profit.cards.inspections.direct')} value={fmtCurrency(company.inspections.direct)} />}
            <Row label={t('profit.cards.inspections.total')} value={fmtCurrency(company.inspections.total)} bold />
            <Row label={t('profit.cards.inspections.perProperty', {
              amount: fmtCurrency(company.inspections.propertiesCleaned ? company.inspections.total / company.inspections.propertiesCleaned : 0),
              count: company.inspections.propertiesCleaned,
            })} value="" tone="muted" />
          </>}
        </LedgerCard>
        <LedgerCard title={t('profit.cards.laundry.title')} loading={loading}>
          {company && <>
            <Row label={<>{t('profit.cards.laundry.qbo')}{company.months.some(m => m.laundrySource !== 'qbo') && srcTag('weighins')}</>} value={fmtCurrency(company.laundry.actual - company.laundry.linenLabor)} />
            <Row label={t('profit.cards.laundry.linenLabor')} value={fmtCurrency(company.laundry.linenLabor)} />
            <Row label={t('profit.cards.laundry.actual')} value={fmtCurrency(company.laundry.actual)} bold />
            <Row label={t('profit.cards.laundry.expected')} value={fmtCurrency(company.laundry.expected)} />
            <Row label={t('profit.cards.laundry.diff')} value={signed(company.laundry.diff)} tone={company.laundry.diff > 0 ? 'bad' : 'good'} />
            {company.laundry.weighIns != null && <Row label={t('profit.cards.laundry.weighIns')} value={fmtCurrency(company.laundry.weighIns)} tone="muted" />}
            {company.months.some(m => m.laundrySource !== 'qbo') && <Row label={t('profit.cards.laundry.qbo')} value={fmtCurrency(company.laundry.qbo)} tone="muted" />}
          </>}
        </LedgerCard>
        <LedgerCard title={t('profit.cards.consumables.title')} loading={loading}>
          {company && <>
            <Row label={t('profit.cards.consumables.qbo')} value={fmtCurrency(company.consumables.qbo)} tone="muted" />
            <Row label={<>{t('profit.cards.consumables.actual')}{company.months.some(m => m.consumablesSource === 'expected') && srcTag('expected')}</>} value={fmtCurrency(company.consumables.actual)} bold />
            <Row label={t('profit.cards.consumables.expected')} value={fmtCurrency(company.consumables.expected)} />
            <Row label={t('profit.cards.consumables.diff')} value={signed(company.consumables.diff)} tone={company.consumables.diff > 0 ? 'bad' : 'good'} />
          </>}
        </LedgerCard>
        <OverheadCard c={company} t={t} loading={loading} />
      </div>

      {/* Bottom line + losing money */}
      <div className="grid gap-3 lg:grid-cols-3">
        <LedgerCard title={t('profit.cards.bottom.title')} loading={loading}>
          {company && <>
            <Row label={t('profit.cards.bottom.revenue')} value={fmtCurrency(company.revenue.total)} />
            <Row label={t('profit.cards.bottom.cost')} value={fmtCurrency(company.totalCost)} />
            <Row label={t('profit.cards.bottom.profit')} value={fmtCurrency(company.profit)} bold tone={company.profit < 0 ? 'bad' : 'good'} />
            <Row label={t('profit.cards.bottom.margin')} value={company.margin != null ? fmtPct(company.margin) : '—'} />
            <Row label={t('profit.cards.bottom.cleans', { count: company.cleans, properties: company.properties })} value="" tone="muted" />
          </>}
        </LedgerCard>
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card shadow-sm p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive" /> {t('profit.losing.title', { count: losing.length })}
          </h3>
          {loading ? <Skeleton className="h-16 w-full" /> : losing.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('profit.losing.none')}</p>
          ) : (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {losing.slice(0, 25).map(r => (
                <li key={r.property_id} className="text-xs">
                  <button className="font-medium hover:underline" onClick={() => { setOpen(r.property_id); setLosingOnly(true) }}>{r.name}</button>
                  <span className="text-destructive tabular-nums ml-2">{fmtCurrency(r.profit)}</span>
                  <span className="text-muted-foreground"> · {r.reasons.length ? r.reasons.slice(0, 2).map(x => reasonText(x.code, x.amount, x.count)).join('; ') : '—'}</span>
                </li>
              ))}
              {losing.length > 25 && <li className="text-2xs text-muted-foreground">{t('profit.losing.more', { count: losing.length - 25 })}</li>}
            </ul>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[1350px]">
          <thead className="bg-muted/60 border-b border-border sticky top-0 z-10">
            <tr>
              <HeaderCell column="name" label={t('profit.table.property')} />
              <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-2.5 whitespace-nowrap">{t('profit.table.rate')}</th>
              <HeaderCell column="cleans" label={t('profit.table.cleans')} />
              <HeaderCell column="notOnInvoice" label={t('profit.table.notInvoiced')} title={t('profit.table.notInvoicedTip')} />
              <HeaderCell column="expectedRevenue" label={t('profit.table.expected')} />
              <HeaderCell column="revenue" label={t('profit.table.billed')} />
              <HeaderCell column="billingGap" label={t('profit.table.gap')} />
              <HeaderCell column="labor" label={t('profit.table.cleanerPay')} />
              <HeaderCell column="inspections" label={t('profit.table.inspections')} />
              <HeaderCell column="laundry" label={t('profit.table.laundry')} />
              <HeaderCell column="consumables" label={t('profit.table.consumables')} />
              <HeaderCell column="overhead" label={t('profit.table.overhead')} />
              <HeaderCell column="profit" label={t('profit.table.profit')} />
              <HeaderCell column="margin" label={t('profit.table.margin')} />
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">{[...Array(COLS)].map((_, j) => <td key={j} className="py-2 px-2.5"><Skeleton className="h-4 w-full" /></td>)}</tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={COLS} className="py-12"><EmptyState icon={Building2} title={t('profit.emptyTitle')} description={t('profit.emptyDescription')} /></td></tr>
            ) : (
              <>
                {filtered.map(r => (
                  <Fragment key={r.property_id}>
                    <tr
                      className={`border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer ${r.profit < 0 ? 'bg-destructive/5' : ''}`}
                      onClick={() => setOpen(o => (o === r.property_id ? null : r.property_id))}
                      data-testid={`row-profit-${r.property_id}`}
                    >
                      <td className="py-2 px-2.5">
                        <span className="font-medium truncate max-w-[220px] block" title={r.name}>{r.name}</span>
                        <span className="text-2xs text-muted-foreground">{r.stage ?? ''}</span>
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                        {r.rate != null ? fmtCurrency(r.rate) : '—'} / {r.payRate != null ? fmtCurrency(r.payRate) : '—'}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums" title={r.deepCleans ? t('profit.table.deepTip', { count: r.deepCleans }) : undefined}>
                        {r.cleans}{r.deepCleans > 0 && <span className="text-2xs text-muted-foreground"> ({r.deepCleans}D)</span>}
                      </td>
                      <td className={`py-2 px-2.5 text-right tabular-nums ${r.notOnInvoice ? 'text-warning' : 'text-muted-foreground'}`}>{r.notOnInvoice || '—'}</td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-muted-foreground">{fmtCurrency(r.expectedRevenue)}</td>
                      <td className="py-2 px-2.5 text-right tabular-nums" title={r.cleansNotInvoiced ? t('profit.table.estimatedTip', { count: r.cleansNotInvoiced }) : undefined}>
                        {fmtCurrency(r.revenue)}{r.cleansNotInvoiced > 0 && <span className="text-muted-foreground">*</span>}
                      </td>
                      <td className={`py-2 px-2.5 text-right tabular-nums ${r.reasons.some(x => x.code === 'billed_below_expected') ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
                        {r.expectedInvoiced > 0 ? signed(r.billingGap) : '—'}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums">{fmtCurrency(r.labor)}</td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-muted-foreground">{fmtCurrency(r.inspections)}</td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-muted-foreground">{fmtCurrency(r.laundry)}</td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-muted-foreground">{fmtCurrency(r.consumables)}</td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-muted-foreground">{fmtCurrency(r.overhead)}</td>
                      <td className={`py-2 px-2.5 text-right tabular-nums font-semibold ${r.profit < 0 ? 'text-destructive' : ''}`}>{fmtCurrency(r.profit)}</td>
                      <td className={`py-2 px-2.5 text-right tabular-nums ${profitColorClass(r.margin)}`}>{r.margin != null ? fmtPct(r.margin) : '—'}</td>
                      <td className="py-2 pr-2 text-muted-foreground">{open === r.property_id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                    </tr>
                    {open === r.property_id && (
                      <tr className="border-b border-border/50 bg-muted/20">
                        <td colSpan={COLS} className="px-4 py-3">
                          <Drill r={r} t={t} reasonText={reasonText} onOpen={() => openPropertyModal(String(r.property_id), 'profitability')} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className="bg-muted/40 font-semibold border-t-2 border-border">
                  <td className="py-2 px-2.5">{t('profit.table.totals')}</td>
                  <td />
                  <td className="py-2 px-2.5 text-right tabular-nums">{totals.cleans}</td>
                  <td className="py-2 px-2.5 text-right tabular-nums">{totals.notOnInvoice || '—'}</td>
                  <td className="py-2 px-2.5 text-right tabular-nums">{fmtCurrency(totals.expected)}</td>
                  <td className="py-2 px-2.5 text-right tabular-nums">{fmtCurrency(totals.revenue)}</td>
                  <td className={`py-2 px-2.5 text-right tabular-nums ${totals.gap < 0 ? 'text-warning' : ''}`}>{signed(totals.gap)}</td>
                  <td className="py-2 px-2.5 text-right tabular-nums">{fmtCurrency(totals.labor)}</td>
                  <td className="py-2 px-2.5 text-right tabular-nums">{fmtCurrency(totals.inspections)}</td>
                  <td className="py-2 px-2.5 text-right tabular-nums">{fmtCurrency(totals.laundry)}</td>
                  <td className="py-2 px-2.5 text-right tabular-nums">{fmtCurrency(totals.consumables)}</td>
                  <td className="py-2 px-2.5 text-right tabular-nums">{fmtCurrency(totals.overhead)}</td>
                  <td className={`py-2 px-2.5 text-right tabular-nums ${totals.profit < 0 ? 'text-destructive' : ''}`}>{fmtCurrency(totals.profit)}</td>
                  <td className={`py-2 px-2.5 text-right tabular-nums ${profitColorClass(totals.margin)}`}>{totals.margin != null ? fmtPct(totals.margin) : '—'}</td>
                  <td />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-2xs text-muted-foreground max-w-4xl">{t('profit.methodology')}</p>
    </div>
  )
}

type T = TFunc

function RevenueCard({ c, t, loading }: { c: CompanyEconomics | undefined; t: T; loading: boolean }) {
  return (
    <LedgerCard title={t('profit.cards.revenue.title')} loading={loading}>
      {c && <>
        <Row label={t('profit.cards.revenue.billedCleans')} value={fmtCurrency(c.revenue.billedCleaning)} />
        <Row label={t('profit.cards.revenue.billedExtras')} value={fmtCurrency(c.revenue.billedExtras)} />
        {c.revenue.estimated > 0 && <Row label={t('profit.cards.revenue.estimated')} value={fmtCurrency(c.revenue.estimated)} tone="muted" />}
        <Row label={t('profit.cards.revenue.total')} value={fmtCurrency(c.revenue.total)} bold />
        <Row label={t('profit.cards.revenue.expected')} value={fmtCurrency(c.revenue.expectedInvoiced)} />
        <Row
          label={t('profit.cards.revenue.gap')}
          value={signed(c.revenue.billedCleaning - c.revenue.expectedInvoiced)}
          tone={c.revenue.billedCleaning - c.revenue.expectedInvoiced < 0 ? 'bad' : 'good'}
        />
        {c.revenue.qboIncome != null && <Row label={t('profit.cards.revenue.qbo')} value={fmtCurrency(c.revenue.qboIncome)} tone="muted" />}
      </>}
    </LedgerCard>
  )
}

function OverheadCard({ c, t, loading }: { c: CompanyEconomics | undefined; t: T; loading: boolean }) {
  const accounts = Object.entries(c?.overhead.opexAccounts ?? {}).filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => b[1] - a[1])
  return (
    <LedgerCard title={t('profit.cards.overhead.title')} loading={loading}>
      {c && <>
        <Row label={t('profit.cards.overhead.leadership')} value={fmtCurrency(c.overhead.leadership)} />
        <Row label={t('profit.cards.overhead.opex')} value={fmtCurrency(c.overhead.opex)} />
        {accounts.slice(0, 5).map(([k, v]) => <Row key={k} label={k} value={fmtCurrency(v)} sub />)}
        {c.overhead.otherCogs > 0 && <Row label={t('profit.cards.overhead.otherCogs')} value={fmtCurrency(c.overhead.otherCogs)} />}
        {c.overhead.busyBeeOther > 0 && <Row label={t('profit.cards.overhead.busyBeeOther')} value={fmtCurrency(c.overhead.busyBeeOther)} />}
        <Row label={t('profit.cards.overhead.total')} value={fmtCurrency(c.overhead.total)} bold />
        <Row label={t('profit.cards.overhead.perClean', { amount: fmtCurrency(c.cleans ? c.overhead.total / c.cleans : 0) })} value="" tone="muted" />
      </>}
    </LedgerCard>
  )
}

function Drill({ r, t, reasonText, onOpen }: { r: PropertyEconomics; t: T; reasonText: (code: string, amount: number, count?: number) => string; onOpen: () => void }) {
  const per = (n: number) => fmtCurrency(r.cleans ? n / r.cleans : 0)
  return (
    <div className="grid gap-4 md:grid-cols-3 text-xs">
      <div className="space-y-1">
        <h4 className="font-semibold text-muted-foreground uppercase tracking-wide text-2xs">{t('profit.drill.revenue')}</h4>
        <Row label={t('profit.drill.billedCleans')} value={fmtCurrency(r.billedCleaning)} />
        <Row label={t('profit.drill.billedExtras')} value={fmtCurrency(r.billedExtras)} />
        {r.estimatedRevenue > 0 && <Row label={t('profit.drill.estimated')} value={fmtCurrency(r.estimatedRevenue)} tone="muted" />}
        <Row label={t('profit.drill.expected')} value={fmtCurrency(r.expectedInvoiced)} tone="muted" />
      </div>
      <div className="space-y-1">
        <h4 className="font-semibold text-muted-foreground uppercase tracking-wide text-2xs">{t('profit.drill.cost')}</h4>
        <Row label={t('profit.drill.cleaningPay')} value={fmtCurrency(r.cleaningPay)} />
        {r.extraPay > 0 && <Row label={t('profit.drill.extraPay')} value={fmtCurrency(r.extraPay)} />}
        {r.estimatedPay > 0 && <Row label={t('profit.drill.estimatedPay')} value={fmtCurrency(r.estimatedPay)} tone="muted" />}
        <Row label={t('profit.table.inspections')} value={fmtCurrency(r.inspections)} />
        <Row label={t('profit.drill.laundryVs', { expected: fmtCurrency(r.laundryExpected) })} value={fmtCurrency(r.laundry)} />
        <Row label={t('profit.drill.consumablesVs', { expected: fmtCurrency(r.consumablesExpected) })} value={fmtCurrency(r.consumables)} />
        <Row label={t('profit.table.overhead')} value={fmtCurrency(r.overhead)} />
        <Row label={t('profit.table.profit')} value={fmtCurrency(r.profit)} bold tone={r.profit < 0 ? 'bad' : 'good'} />
      </div>
      <div className="space-y-2">
        <h4 className="font-semibold text-muted-foreground uppercase tracking-wide text-2xs">{t('profit.drill.why')}</h4>
        <p className="text-muted-foreground">{t('profit.drill.perClean', { rev: per(r.revenue), cost: per(r.totalCost), profit: per(r.profit) })}</p>
        {r.reasons.length > 0 && (
          <ul className="list-disc pl-4 space-y-1">
            {r.reasons.map(x => <li key={x.code}>{reasonText(x.code, x.amount, x.count)}</li>)}
          </ul>
        )}
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onOpen}>{t('profit.drill.openProperty')}</Button>
      </div>
    </div>
  )
}
