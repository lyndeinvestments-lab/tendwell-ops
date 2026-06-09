import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { useCleaners } from '@/hooks/use-cleaners'
import { useAuth, canEditView } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { Users, AlertTriangle, TrendingUp, CheckSquare, Flag } from 'lucide-react'

// Advisory pay / coaching recommendation derived from issue-rate thresholds.
// Display only — this never changes cleaner.pay_rate.
function payRecommendation(m: { totalCleans: number; issueRate: number; resolutionRate: number }):
  { label: string; tone: 'good' | 'bad'; title: string } | null {
  if (m.totalCleans >= 5 && m.issueRate >= 20) {
    return { label: 'Review pay / coach', tone: 'bad', title: `High issue rate (${m.issueRate.toFixed(1)}%) over ${m.totalCleans} cleans — recommend a coaching + pay review.` }
  }
  if (m.totalCleans >= 10 && m.issueRate <= 3 && m.resolutionRate >= 90) {
    return { label: 'Raise candidate', tone: 'good', title: `Low issue rate (${m.issueRate.toFixed(1)}%) over ${m.totalCleans} cleans with strong resolution — consider for a raise.` }
  }
  return null
}

export default function CleanerMetricsPage() {
  usePageTitle('Cleaner Metrics')

  const { data: cleaners, isLoading: cleanersLoading } = useCleaners({ activeOnly: true })

  const { data: completedInspections, isLoading: inspectionsLoading } = useQuery({
    queryKey: ['/supabase/cleaner-metrics-inspections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('id, cleaner_id, status')
        .eq('status', 'completed')
      if (error) throw error
      return data || []
    },
  })

  const { data: issues, isLoading: issuesLoading } = useQuery({
    queryKey: ['/supabase/cleaner-metrics-issues'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cleaning_issues').select('id, last_touch, category, status')
      if (error) throw error
      return data || []
    },
  })

  const { effectiveUser } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const canEdit = canEditView('cleaner-metrics', effectiveUser)

  const { data: coachingFlags } = useQuery({
    queryKey: ['/supabase/cleaner-coaching-flags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaner_coaching_flags')
        .select('id, cleaner_id, status')
        .eq('status', 'open')
      if (error) throw error
      return data || []
    },
  })

  const openFlagByCleaner = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of (coachingFlags || [])) map.set(String(f.cleaner_id), f.id)
    return map
  }, [coachingFlags])

  const flagMut = useMutation({
    mutationFn: async (m: any) => {
      const { error } = await supabase.from('cleaner_coaching_flags').insert({
        cleaner_id: m.id,
        reason: `Issue rate ${m.issueRate.toFixed(1)}% (${m.issueCount}/${m.totalCleans})`,
        issue_rate: Number(m.issueRate.toFixed(2)),
        total_cleans: m.totalCleans,
        issue_count: m.issueCount,
        flagged_by: effectiveUser?.label ?? null,
      } as any)
      if (error) throw error
    },
    onSuccess: () => { toast({ title: 'Flagged for coaching' }); qc.invalidateQueries({ queryKey: ['/supabase/cleaner-coaching-flags'] }) },
    onError: (e: any) => toast({ title: 'Flag failed', description: e?.message, variant: 'destructive' }),
  })

  const resolveMut = useMutation({
    mutationFn: async (flagId: string) => {
      const { error } = await supabase.from('cleaner_coaching_flags')
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: effectiveUser?.label ?? null })
        .eq('id', flagId)
      if (error) throw error
    },
    onSuccess: () => { toast({ title: 'Coaching flag resolved' }); qc.invalidateQueries({ queryKey: ['/supabase/cleaner-coaching-flags'] }) },
    onError: (e: any) => toast({ title: 'Resolve failed', description: e?.message, variant: 'destructive' }),
  })

  const anyLoading = cleanersLoading || inspectionsLoading || issuesLoading

  // ─── Metrics per cleaner ──────────────────────────────────────────────────
  // Cleans come from completed inspections (each inspection has a cleaner_id).
  // Pay derives from cleaners.pay_rate × clean count since inspections don't
  // record per-clean pay. Issue rate and category counts come from
  // cleaning_issues matched by last_touch name.
  const metrics = useMemo(() => {
    if (!cleaners || !completedInspections || !issues) return []

    return cleaners.map((cleaner: any) => {
      const myInspections = completedInspections.filter((a: any) => String(a.cleaner_id) === String(cleaner.id))
      const totalCleans = myInspections.length
      const payRate = Number(cleaner.pay_rate) || 0
      const totalPay = totalCleans * payRate

      // Issues attributed to this cleaner (by last_touch name match)
      const myIssues = issues.filter((i: any) =>
        i.last_touch && cleaner.full_name &&
        i.last_touch.toLowerCase().includes(cleaner.full_name.toLowerCase())
      )
      const issueCount = myIssues.length
      const issueRate = totalCleans > 0 ? ((issueCount / totalCleans) * 100) : 0
      const completedIssues = myIssues.filter((i: any) => i.status === 'Completed').length
      const resolutionRate = issueCount > 0 ? ((completedIssues / issueCount) * 100) : 100

      // Issue categories
      const issueCategories: Record<string, number> = {}
      for (const i of myIssues) {
        issueCategories[i.category] = (issueCategories[i.category] || 0) + 1
      }
      const topIssueCategory = Object.entries(issueCategories).sort((a, b) => b[1] - a[1])[0]

      return {
        ...cleaner,
        totalCleans,
        totalPay,
        avgPay: payRate,
        issueCount,
        issueRate,
        resolutionRate,
        topIssueCategory: topIssueCategory ? topIssueCategory[0] : null,
      }
    }).sort((a: any, b: any) => (b.totalCleans - a.totalCleans) || (b.issueCount - a.issueCount))
  }, [cleaners, completedInspections, issues])

  // ─── Summary stats ────────────────────────────────────────────────────────
  const totalCleans = metrics.reduce((s, m) => s + m.totalCleans, 0)
  const totalIssues = metrics.reduce((s, m) => s + m.issueCount, 0)
  const avgIssueRate = totalCleans > 0 ? ((totalIssues / totalCleans) * 100) : 0
  const cleanerWithMostIssues = [...metrics].sort((a, b) => b.issueRate - a.issueRate).find(m => m.totalCleans >= 5)

  return (
    <div className="p-5 space-y-6 h-full overflow-auto">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cleaner Performance</h1>
        <p className="text-sm text-muted-foreground">Issue rates, clean counts, and performance by cleaner</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Active Cleaners</p><p className="text-lg font-semibold">{cleaners?.length || 0}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Total Cleans</p><p className="text-lg font-semibold">{totalCleans}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Total Issues</p><p className={`text-lg font-semibold ${totalIssues > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{totalIssues}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Avg Issue Rate</p><p className="text-lg font-semibold">{avgIssueRate.toFixed(1)}%</p></CardContent></Card>
      </div>

      {cleanerWithMostIssues && cleanerWithMostIssues.issueRate > 5 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            <strong>{cleanerWithMostIssues.full_name}</strong> has the highest issue rate at {cleanerWithMostIssues.issueRate.toFixed(1)}% ({cleanerWithMostIssues.issueCount} issues / {cleanerWithMostIssues.totalCleans} cleans)
            {cleanerWithMostIssues.topIssueCategory && <span> — most common: {cleanerWithMostIssues.topIssueCategory}</span>}
          </p>
        </div>
      )}

      {/* Per-cleaner table */}
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted border-b border-border z-20">
            <tr>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cleaner</th>
              <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Cleans</th>
              <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Issues</th>
              <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Issue Rate</th>
              <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Resolution</th>
              <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Total Pay</th>
              <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Avg/Clean</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Top Issue</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Recommendation</th>
              <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3">Coaching</th>
            </tr>
          </thead>
          <tbody>
            {anyLoading ? (
              [...Array(5)].map((_, i) => <tr key={i} className="border-b border-border/50">{[...Array(10)].map((_, j) => <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>)}</tr>)
            ) : metrics.length === 0 ? (
              <tr><td colSpan={10}><EmptyState icon={Users} title="No cleaners" description="Add cleaners and assignments to see performance metrics." /></td></tr>
            ) : metrics.map((m: any) => (
              <tr key={m.id} className={`border-b border-border/50 hover:bg-muted/20 ${m.issueRate > 10 ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''}`}>
                <td className="py-2 px-3 text-xs font-medium">{m.full_name}</td>
                <td className="py-2 px-3 text-xs tabular-nums text-right">{m.totalCleans}</td>
                <td className="py-2 px-3 text-xs tabular-nums text-right">{m.issueCount}</td>
                <td className={`py-2 px-3 text-xs tabular-nums text-right font-medium ${m.issueRate > 10 ? 'text-red-600 dark:text-red-400' : m.issueRate > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>{m.issueRate.toFixed(1)}%</td>
                <td className="py-2 px-3 text-xs tabular-nums text-right">{m.resolutionRate.toFixed(0)}%</td>
                <td className="py-2 px-3 text-xs tabular-nums text-right">${m.totalPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="py-2 px-3 text-xs tabular-nums text-right">${m.avgPay.toFixed(2)}</td>
                <td className="py-2 px-3 text-xs text-muted-foreground">{m.topIssueCategory || '—'}</td>
                <td className="py-2 px-3 text-xs">
                  {(() => {
                    const rec = payRecommendation(m)
                    if (!rec) return <span className="text-muted-foreground">—</span>
                    return (
                      <span
                        title={rec.title}
                        className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${rec.tone === 'bad' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}
                      >
                        {rec.label}
                      </span>
                    )
                  })()}
                </td>
                <td className="py-2 px-3 text-xs text-right">
                  {(() => {
                    const flagId = openFlagByCleaner.get(String(m.id))
                    if (flagId) {
                      return (
                        <span className="inline-flex items-center gap-1.5 justify-end">
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><Flag className="w-3 h-3" /> Flagged</span>
                          {canEdit && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => resolveMut.mutate(flagId)} disabled={resolveMut.isPending} data-testid={`button-resolve-flag-${m.id}`}>
                              Resolve
                            </Button>
                          )}
                        </span>
                      )
                    }
                    return canEdit ? (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1 hover:text-amber-600" onClick={() => flagMut.mutate(m)} disabled={flagMut.isPending} data-testid={`button-flag-${m.id}`}>
                        <Flag className="w-3 h-3" /> Flag
                      </Button>
                    ) : <span className="text-muted-foreground">—</span>
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
