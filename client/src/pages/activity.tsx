import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { invalidateAllPropertyQueries } from '@/lib/query-invalidations'
import { useAuth, canAccessView } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { usePropertyModal } from '@/hooks/use-property-modal'
import { useToast } from '@/hooks/use-toast'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useDateFormat } from '@/lib/i18n/date'
import type { TFunc } from '@/lib/i18n/t'
import {
  Pencil, Search, X, RotateCcw, Activity,
  Building2, GitBranch, ClipboardCheck, UserCheck, Users,
  Plus, Trash2, ArrowRight,
} from 'lucide-react'
import { isToday, isYesterday, parseISO } from 'date-fns'

type FilterType = 'all' | 'properties' | 'pipeline' | 'inspections' | 'cleaners' | 'contacts' | 'owners'

// `key` stays canonical (drives filter-state comparisons); `labelKey` is a
// display-only lookup into `activity.filters.*`.
const FILTER_OPTIONS: { key: FilterType; labelKey: string }[] = [
  { key: 'all', labelKey: 'all' },
  { key: 'owners', labelKey: 'owners' },
  { key: 'properties', labelKey: 'properties' },
  { key: 'pipeline', labelKey: 'pipeline' },
  { key: 'inspections', labelKey: 'inspections' },
  { key: 'cleaners', labelKey: 'cleaners' },
  { key: 'contacts', labelKey: 'contacts' },
]

// Owner-portal edits are attributed as "<name> (owner)" by the DB triggers
// that log them (properties_owner_update_guard, owner_update_self_contact)
// — this cuts across entity types (property fields AND contact info), so it
// needs its own predicate rather than an entity_type category match.
function isOwnerChange(entry: { changed_by?: string | null }): boolean {
  return !!entry.changed_by && / \(owner\)$/.test(entry.changed_by)
}

const SYSTEM_ENTITY_TYPES = new Set(['setting', 'role_permissions', 'user_role', 'view_as', 'app_settings'])

// Map activity_log entity_type → filter category
function entityTypeToFilter(entityType: string): FilterType {
  if (SYSTEM_ENTITY_TYPES.has(entityType)) return 'admin' as FilterType
  switch (entityType) {
    case 'property': return 'properties'
    case 'pipeline': return 'pipeline'
    case 'inspection': return 'inspections'
    case 'cleaner': return 'cleaners'
    case 'contact': return 'contacts'
    default: return 'properties'
  }
}

// Legacy: map property_edit_log field names → filter category
function fieldToFilter(fieldName: string): FilterType {
  if (['stage_id', 'stage_change'].includes(fieldName)) return 'pipeline'
  return 'properties'
}

function getActionIcon(action: string, entityType: string) {
  if (action === 'create') return Plus
  if (action === 'delete') return Trash2
  if (action === 'stage_change') return ArrowRight
  if (entityType === 'inspection') return ClipboardCheck
  if (entityType === 'cleaner') return UserCheck
  if (entityType === 'contact') return Users
  if (entityType === 'pipeline') return GitBranch
  if (entityType === 'property') return Building2
  return Pencil
}

function getActionColor(action: string): string {
  if (action === 'create') return 'bg-success/10 text-success'
  if (action === 'delete') return 'bg-destructive/10 text-destructive'
  if (action === 'stage_change') return 'bg-info/10 text-info'
  return 'bg-primary/10 text-primary'
}

// `formatDate` is the locale-aware wrapper from `useDateFormat()` — needed
// here (not plain date-fns `format`) because `'MMMM d, yyyy'` renders a
// month NAME, which must follow the app locale.
function dateGroupLabel(dateStr: string, t: TFunc, formatDate: (date: Date | number, pattern: string) => string): string {
  try {
    const d = parseISO(dateStr)
    if (isToday(d)) return t('page.today', undefined, 'Today')
    if (isYesterday(d)) return t('page.yesterday', undefined, 'Yesterday')
    return formatDate(d, 'MMMM d, yyyy')
  } catch {
    return dateStr
  }
}

// Returns YYYY-MM-DD for an ISO timestamp in the browser's local timezone.
// Prevents the +1 day offset that happens when slicing the raw UTC string —
// e.g. an 8pm Central edit has a UTC prefix of the next day.
function toLocalDateKey(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

const FIELD_LABELS: Record<string, string> = {
  ce_charged: 'Client Charged',
  cleaner_pay: 'Cleaner Pay',
  sq_ft: 'Square Footage',
  square_footage: 'Square Footage',
  stage_id: 'Stage',
  stage: 'Stage',
  follow_up_date: 'Follow-up Date',
  contact_id: 'Client',
  bedrooms: 'Bedrooms',
  full_baths: 'Full Baths',
  half_baths: 'Half Baths',
  address: 'Address',
  notes: 'Notes',
  custom_cleans_per_month: 'Cleans/Month',
  total_estimated_cost: 'Total Estimated Cost',
  estimated_profit: 'Estimated Profit',
  profit_percentage: 'Profit %',
  exclude_from_financials: 'Exclude from Financials',
  offboarded_at: 'Offboarded Date',
  name: 'Property Name',
  auto_code: 'Auto Code',
  door_code: 'Door Code',
  wifi_info: 'WiFi Info',
}

// English fallback for a field with no `FIELD_LABELS`/dictionary entry — new
// columns don't need a translation PR to show up legibly.
function humanizeFieldName(field: string) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field]
  return field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Display-only translation of `activity_log`/`property_edit_log` field
// names — DB column names stay canonical; this only affects what's shown.
function fieldLabel(field: string, t: TFunc): string {
  return t(`field.${field}`, undefined, humanizeFieldName(field))
}

// Display-only translation of the `action` verb (`create`/`update`/`delete`/
// `stage_change`) — canonical value still drives `getActionIcon`/`getActionColor`.
function actionLabel(action: string, t: TFunc): string {
  return t(`action.${action}`, undefined, action.replace('_', ' '))
}

// entity_name/property name are DB data and stay as-is; only the "no name
// at all" fallback is translated page chrome.
function formatEntityLabel(entry: any, t: TFunc): string {
  // New activity_log format
  if (entry.entity_name) return entry.entity_name
  // Legacy property_edit_log format
  const propName = entry.properties?.name
  if (propName) return propName
  return t('page.unknownEntity', undefined, 'Unknown')
}

// Normalise a row from either table into a unified shape
function normaliseRow(row: any, source: 'activity_log' | 'property_edit_log'): any {
  if (source === 'activity_log') return row
  // property_edit_log → activity_log shape. property_edit_log uses
  // `changed_at`, not `created_at`; map it so downstream sort/render still
  // works on `entry.created_at`.
  return {
    id: 'pel_' + row.id,
    entity_type: 'property',
    entity_id: String(row.property_id),
    entity_name: row.properties?.name ?? null,
    action: 'update',
    field_name: row.field_name,
    old_value: row.old_value,
    new_value: row.new_value,
    changed_by: row.changed_by ?? null,
    created_at: row.changed_at,
    // Carry forward so revert still works
    _property_id: row.property_id,
    _properties: row.properties,
    metadata: null,
  }
}

const FINANCIAL_FIELDS = new Set(['ce_charged', 'cleaner_pay', 'estimated_profit', 'profit_percentage', 'total_estimated_cost', 'est_laundry', 'est_consumables', 'monthly_revenue_estimate', 'monthly_cost_estimate', 'monthly_profit_estimate'])

export default function ActivityFeedPage() {
  usePageTitle('Activity')
  const { t } = useLocale('activity')
  const { format: formatDate } = useDateFormat()
  const { openPropertyModal } = usePropertyModal()
  const { toast } = useToast()
  const qc = useQueryClient()
  const { effectiveUser } = useAuth()
  const canViewFinancials = canAccessView('cost-tracking', effectiveUser) || canAccessView('financial-dashboard', effectiveUser)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState('')
  const [reverting, setReverting] = useState<string | null>(null)

  // Primary source: activity_log (all entity types)
  const { data: activityLog, isLoading: loadingActivity } = useQuery({
    queryKey: ['/supabase/activity-log'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) {
        console.warn('activity_log query error:', error.message)
        return []
      }
      return (data || []).map((r: any) => normaliseRow(r, 'activity_log'))
    },
    staleTime: 30_000,
  })

  // Fallback / supplement: legacy property_edit_log
  const { data: editLog, isLoading: loadingEdit } = useQuery({
    queryKey: ['/supabase/activity-edit-log'],
    queryFn: async () => {
      // Try with FK join first, fall back to plain query if FK name doesn't match
      // Column is `changed_at` on property_edit_log (NOT created_at) — the
      // old name was returning 400s and silently emptying the Activity feed
      // of all property edits.
      let result = await supabase
        .from('property_edit_log')
        .select('*, properties!property_edit_log_property_id_fkey(id, name)')
        .order('changed_at', { ascending: false })
        .limit(500)
      if (result.error) {
        console.warn('property_edit_log FK join failed, trying without join:', result.error.message)
        // Fallback shape doesn't include the joined `properties` field, but
        // normaliseRow tolerates that. Cast so the two branches share a type.
        result = (await supabase
          .from('property_edit_log')
          .select('*')
          .order('changed_at', { ascending: false })
          .limit(500)) as typeof result
      }
      if (result.error) {
        console.warn('property_edit_log query error:', result.error.message)
        return []
      }
      return (result.data || []).map((r: any) => normaliseRow(r, 'property_edit_log'))
    },
    staleTime: 30_000,
  })

  const isLoading = loadingActivity || loadingEdit

  // Merge both sources, deduplicate by id, sort newest first
  const allEntries = useMemo(() => {
    const seen = new Set<string>()
    const combined = [...(activityLog || []), ...(editLog || [])]
    return combined
      .filter(e => {
        if (seen.has(e.id)) return false
        seen.add(e.id)
        return true
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [activityLog, editLog])

  const filtered = useMemo(() => {
    return allEntries.filter(entry => {
      // Hide system/admin events unless explicitly filtering for them
      const isSystem = (entry.entity_type && SYSTEM_ENTITY_TYPES.has(entry.entity_type)) ||
        (entry.field_name && ['role_permissions', 'user_role', 'view_as'].includes(entry.field_name))
      if (isSystem && filter !== 'all') return false
      // Financial field gate
      if (!canViewFinancials && entry.field_name && FINANCIAL_FIELDS.has(entry.field_name)) return false
      // Category filter
      if (filter === 'owners') {
        if (!isOwnerChange(entry)) return false
      } else if (filter !== 'all') {
        const cat = entry.entity_type
          ? entityTypeToFilter(entry.entity_type)
          : fieldToFilter(entry.field_name ?? '')
        if (cat !== filter) return false
      }
      // Date range (compare on local-TZ calendar day, not UTC)
      const localDay = toLocalDateKey(entry.created_at)
      if (dateFrom && localDay < dateFrom) return false
      if (dateTo && localDay > dateTo) return false
      // Text search
      if (search.trim()) {
        const q = search.toLowerCase()
        const name = formatEntityLabel(entry, t).toLowerCase()
        const field = (entry.field_name ?? '').toLowerCase()
        const oldVal = String(entry.old_value ?? '').toLowerCase()
        const newVal = String(entry.new_value ?? '').toLowerCase()
        const action = (entry.action ?? '').toLowerCase()
        const changedBy = (entry.changed_by ?? '').toLowerCase()
        if (!name.includes(q) && !field.includes(q) && !oldVal.includes(q) && !newVal.includes(q) && !action.includes(q) && !changedBy.includes(q)) return false
      }
      return true
    })
  }, [allEntries, filter, search, dateFrom, dateTo, canViewFinancials, t])

  // Group by date
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const entry of filtered) {
      const dateKey = entry.created_at ? toLocalDateKey(entry.created_at) : 'unknown'
      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(entry)
    }
    return Object.keys(map)
      .sort((a, b) => b.localeCompare(a))
      .map(key => ({
        label: dateGroupLabel(key + 'T12:00:00', t, formatDate),
        dateKey: key,
        entries: map[key],
      }))
  }, [filtered, t, formatDate])

  async function handleRevert(entry: any) {
    // Only revert property field updates
    const propertyId = entry._property_id ?? entry.entity_id
    const fieldName = entry.field_name
    const oldValue = entry.old_value
    if (!propertyId || !fieldName || oldValue == null) return

    setReverting(entry.id)
    try {
      // Coerce the stored text old_value back to its real type: '' → null,
      // 'true'/'false' → boolean, numeric → number, otherwise leave as string.
      // The old `isNaN(Number)` check wrote booleans as the strings "true"/
      // "false" and cleared fields as 0 instead of null.
      let revertValue: any = oldValue
      if (oldValue === '') revertValue = null
      else if (oldValue === 'true') revertValue = true
      else if (oldValue === 'false') revertValue = false
      else if (!isNaN(Number(oldValue))) revertValue = Number(oldValue)
      const { error } = await supabase
        .from('properties')
        .update({ [fieldName]: revertValue })
        .eq('id', propertyId)
      if (error) throw error
      // Reverting writes an arbitrary properties.<field> column back to
      // its previous value — could be a financial, a stage, an address.
      // Same blast radius as any other property edit; registry walk
      // covers every derived cache (dashboards, master-list, pro-forma,
      // revenue, previous-properties, linen-tracker, etc.).
      invalidateAllPropertyQueries(qc)
      qc.invalidateQueries({ queryKey: ['/supabase/activity-log'] })
      qc.invalidateQueries({ queryKey: ['/supabase/activity-edit-log'] })
      toast({ title: t('toasts.reverted', { field: fieldLabel(fieldName, t), value: oldValue }) })
    } catch (e: any) {
      toast({ title: t('toasts.revertFailed'), description: e?.message, variant: 'destructive' })
    } finally {
      setReverting(null)
    }
  }

  return (
    <PageContainer width="full" className="md:h-full md:flex md:flex-col">
      <PageHeader
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('filters.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-8 h-8 w-full sm:w-56 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
              <label>{t('filters.from')}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-8 text-xs border border-input rounded px-2 bg-background"
              />
              <label>{t('filters.to')}</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-8 text-xs border border-input rounded px-2 bg-background"
              />
            </div>
          </>
        }
      />

      {/* Filter chips — `opt.key` stays canonical (drives `filter` state
          equality below); only the rendered label is translated. */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filter === opt.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            }`}
          >
            {t(`filters.${opt.labelKey}`)}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">{t('page.entriesCount', { count: filtered.length })}</span>
      </div>

      {/* Feed */}
      <div className="overflow-auto flex-1">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={Activity}
            title={t('page.emptyTitle')}
            description={t('page.emptyDescription')}
          />
        ) : (
          <div className="space-y-6">
            {grouped.map(group => (
              <div key={group.dateKey}>
                <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-1 mb-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {group.label}
                  </h3>
                </div>
                <div className="space-y-0 border border-border rounded-2xl shadow-sm overflow-hidden">
                  {group.entries.map((entry: any, idx: number) => {
                    const entityLabel = formatEntityLabel(entry, t)
                    const entityType = entry.entity_type ?? 'property'
                    const action = entry.action ?? 'update'
                    const propertyId = entry._property_id ?? (entityType === 'property' ? entry.entity_id : null)
                    const canRevert = action === 'update' && entry.old_value != null && entry.field_name && propertyId
                    const Icon = getActionIcon(action, entityType)
                    const iconColor = getActionColor(action)

                    return (
                      <div
                        key={entry.id}
                        className={`flex items-start gap-3 px-4 py-3 text-xs transition-colors hover:bg-muted/30 ${
                          idx > 0 ? 'border-t border-border/60' : ''
                        }`}
                      >
                        {/* Icon */}
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${iconColor}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>

                        {/* Body */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {propertyId ? (
                              <button
                                onClick={() => openPropertyModal(propertyId)}
                                className="font-medium hover:underline text-foreground"
                              >
                                {entityLabel}
                              </button>
                            ) : (
                              <span className="font-medium text-foreground">{entityLabel}</span>
                            )}
                            {entry.field_name && (
                              <>
                                <span className="text-muted-foreground">·</span>
                                <span className="text-muted-foreground">{fieldLabel(entry.field_name, t)}</span>
                              </>
                            )}
                            {!entry.field_name && action !== 'update' && (
                              <>
                                <span className="text-muted-foreground">·</span>
                                <span className="text-muted-foreground capitalize">{actionLabel(action, t)}</span>
                              </>
                            )}
                          </div>

                          {/* Value change — entry.old_value/new_value are the
                              literal stored DB values, never translated. */}
                          {(entry.old_value != null || entry.new_value != null) && (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {entry.old_value != null && (
                                <>
                                  <span className="line-through text-muted-foreground/70">{String(entry.old_value)}</span>
                                  <span className="text-muted-foreground">→</span>
                                </>
                              )}
                              {entry.new_value != null && (
                                <span className="font-medium text-foreground">{String(entry.new_value)}</span>
                              )}
                            </div>
                          )}

                          {/* Timestamp + user */}
                          <p className="text-muted-foreground mt-0.5">
                            {formatDate(parseISO(entry.created_at), 'h:mm a')}
                            {entry.changed_by ? ` · ${entry.changed_by}` : ''}
                          </p>
                        </div>

                        {/* Revert button — only for property field updates */}
                        {canRevert && (
                          <button
                            onClick={() => handleRevert(entry)}
                            disabled={reverting === entry.id}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors flex-shrink-0 mt-0.5 disabled:opacity-50"
                            title={t('table.revertTooltip', { value: entry.old_value })}
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${reverting === entry.id ? 'animate-spin' : ''}`} />
                            <span>{t('table.revert')}</span>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
