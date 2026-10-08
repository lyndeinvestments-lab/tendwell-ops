// Shared "Delete permanently" dialog for properties/quotes and clients.
//
// Opens on a target, asks the server what would be erased or unlinked
// (admin_*_delete_impact), and only enables Delete once the admin has typed the
// record's name. The delete itself is one server transaction that re-checks the
// admin role, the typed name and the invoice block, and writes a full snapshot of
// the row to activity_log (migration 20261008c).
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  confirmMatches, summarizeImpact, type DeleteImpact, type DeleteTarget,
} from '@/lib/permanent-delete'

/** Admins only, and never while previewing as another user. The server re-checks. */
export function useCanPermanentlyDelete(): boolean {
  const { effectiveUser, isEmulating } = useAuth()
  return !isEmulating && effectiveUser?.role === 'admin'
}

const IMPACT_RPC = {
  property: 'admin_property_delete_impact',
  contact: 'admin_contact_delete_impact',
} as const

const DELETE_RPC = {
  property: 'admin_delete_property_permanently',
  contact: 'admin_delete_contact_permanently',
} as const

interface Props {
  target: DeleteTarget | null
  onOpenChange: (open: boolean) => void
  /** Called after a successful delete, e.g. to close the parent modal. */
  onDeleted?: (target: DeleteTarget) => void
}

export function PermanentDeleteDialog({ target, onOpenChange, onDeleted }: Props) {
  const { t } = useLocale('common')
  const { toast } = useToast()
  const qc = useQueryClient()
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => { setTyped('') }, [target?.kind, target?.id])

  const impactQuery = useQuery({
    queryKey: ['/supabase/permanent-delete-impact', target?.kind, target?.id],
    enabled: !!target,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(IMPACT_RPC[target!.kind], { p_id: target!.id })
      if (error) throw error
      return data as DeleteImpact | null
    },
  })

  const impact = impactQuery.data ?? null
  const summary = impact ? summarizeImpact(impact) : null
  const name = impact?.name ?? target?.name ?? ''
  const canDelete = !!summary && !summary.blocked && confirmMatches(typed, name) && !pending

  const handleDelete = async () => {
    if (!target || !canDelete) return
    setPending(true)
    try {
      const { error } = await (supabase as any).rpc(DELETE_RPC[target.kind], {
        p_id: target.id,
        p_confirm_name: typed,
      })
      if (error) throw error
      toast({ title: t('permanentDelete.deleted', { name }) })
      // Rare, destructive, and it touches properties, clients and the CRM views at
      // once: refresh everything rather than guess which caches held the row.
      await qc.invalidateQueries()
      onDeleted?.(target)
      onOpenChange(false)
    } catch (e: any) {
      toast({ title: t('permanentDelete.failed'), description: e?.message ?? String(e), variant: 'destructive' })
    } finally {
      setPending(false)
    }
  }

  const tableLabel = (table: string) => t(`permanentDelete.tables.${table}`, undefined, table)

  return (
    <Dialog open={!!target} onOpenChange={v => !pending && onOpenChange(v)}>
      <DialogContent className="max-w-md" data-testid="dialog-permanent-delete">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-destructive" />
            {t('permanentDelete.title', { name })}
          </DialogTitle>
          <DialogDescription>{t('permanentDelete.cannotUndo')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {impactQuery.isLoading && (
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> {t('permanentDelete.loading')}
            </p>
          )}
          {impactQuery.isError && (
            <p className="text-destructive">{t('permanentDelete.loadFailed')}</p>
          )}

          {summary?.blocked && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p className="font-medium text-destructive flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> {t('permanentDelete.blockedTitle')}
              </p>
              <p className="mt-1 text-xs">{t('permanentDelete.blockedBody', { count: summary.invoiceLines })}</p>
            </div>
          )}

          {summary && !summary.blocked && (
            <>
              {summary.isClean && (
                <p className="text-muted-foreground">{t('permanentDelete.clean')}</p>
              )}
              {summary.erased.length > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                  <p className="font-medium text-xs mb-1">{t('permanentDelete.erasedHeading')}</p>
                  <ul className="text-xs space-y-0.5">
                    {summary.erased.map(l => (
                      <li key={l.table}><span className="font-semibold tabular-nums">{l.count}</span> · {tableLabel(l.table)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.unlinked.length > 0 && (
                <div>
                  <p className="font-medium text-xs mb-1">{t('permanentDelete.unlinkedHeading')}</p>
                  <ul className="text-xs space-y-0.5 text-muted-foreground">
                    {summary.unlinked.map(l => (
                      <li key={l.table}><span className="font-semibold tabular-nums">{l.count}</span> · {tableLabel(l.table)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.linkedProperties.length > 0 && (
                <div>
                  <p className="font-medium text-xs mb-1">{t('permanentDelete.linkedPropsHeading')}</p>
                  <ul className="text-xs space-y-0.5 text-muted-foreground max-h-32 overflow-y-auto">
                    {summary.linkedProperties.map(p => (
                      <li key={p.id}>{p.name}{p.stage ? ` (${p.stage})` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
              {impact?.name_shared_with_other_property && (
                <p className="text-2xs text-muted-foreground">{t('permanentDelete.sharedName')}</p>
              )}
              <div>
                <label htmlFor="permanent-delete-confirm" className="text-xs">
                  {t('permanentDelete.typeToConfirm', { name })}
                </label>
                <Input
                  id="permanent-delete-confirm"
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleDelete() }}
                  placeholder={name}
                  autoComplete="off"
                  className="mt-1"
                  data-testid="input-permanent-delete-confirm"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={!canDelete}
            data-testid="button-confirm-permanent-delete"
          >
            {pending
              ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> {t('permanentDelete.deleting')}</>
              : t('permanentDelete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
