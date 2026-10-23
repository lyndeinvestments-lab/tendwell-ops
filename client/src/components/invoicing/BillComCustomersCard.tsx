// Link each client that bills through bill.com to its bill.com customer, so
// Ops can create that client's invoices in bill.com. Loads on demand (every
// load signs in to bill.com), suggests exact email / name matches, and never
// links anything until someone clicks.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Link2, Loader2, Unlink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorState } from '@/components/ErrorState'
import { SearchSelect } from '@/components/issues/SearchSelect'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/components/lost-items/shared'

interface BillComCustomerOption { id: string; name: string; companyName: string | null; email: string | null }
interface LinkRow {
  id: string
  name: string
  company: string | null
  email: string | null
  billcom_customer_id: string | null
  linked_customer_name: string | null
  suggestion: { customer_id: string; by: 'email' | 'name' } | null
  ambiguous: string[]
}
interface LinksResponse { customers: BillComCustomerOption[]; clients: LinkRow[]; linked?: number; failed?: string[] }

const QUERY_KEY = ['billcom-customer-links']

export function BillComCustomersCard() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const { toast } = useToast()

  const links = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => authFetch('/api/billcom/customers') as Promise<LinksResponse>,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      authFetch('/api/billcom/customers', { method: 'POST', body: JSON.stringify(body) }) as Promise<LinksResponse>,
    onSuccess: (data, body) => {
      qc.setQueryData(QUERY_KEY, data)
      if (body.action === 'link_suggested') {
        toast({
          title: `Linked ${data.linked ?? 0} client${data.linked === 1 ? '' : 's'}`,
          description: data.failed?.length ? data.failed.join('; ') : undefined,
          variant: data.failed?.length ? 'destructive' : undefined,
        })
      }
    },
    onError: (e) => toast({ title: 'Could not save the link', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  })

  const customerById = useMemo(() => new Map((links.data?.customers ?? []).map((c) => [c.id, c])), [links.data])
  const options = useMemo(
    () => (links.data?.customers ?? []).map((c) => ({ value: c.id, label: c.email ? `${c.name} (${c.email})` : c.name })),
    [links.data],
  )
  const clients = links.data?.clients ?? []
  const linkedCount = clients.filter((c) => c.billcom_customer_id).length
  const suggestedCount = clients.filter((c) => !c.billcom_customer_id && c.suggestion).length

  return (
    <Card className="rounded-2xl shadow-sm" data-testid="billcom-customers-card">
      <CardContent className="p-3 space-y-3">
        <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="text-sm font-semibold">bill.com customers</span>
          <span className="text-xs text-muted-foreground">
            {links.data
              ? `${linkedCount} of ${clients.length} clients linked${suggestedCount ? ` · ${suggestedCount} suggested` : ''}`
              : 'Link each client to its bill.com customer so Ops can create their invoices there.'}
          </span>
        </button>

        {open && (
          links.isError ? (
            <ErrorState title="Couldn't load bill.com customers" description={(links.error as Error)?.message} onRetry={() => links.refetch()} />
          ) : links.isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : (
            <div className="space-y-2">
              {suggestedCount > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" className="h-8 text-xs" disabled={save.isPending} onClick={() => save.mutate({ action: 'link_suggested' })}>
                    {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Link2 className="w-3.5 h-3.5 mr-1" />}
                    Link all {suggestedCount} suggested
                  </Button>
                  <span className="text-xs text-muted-foreground">Suggestions are exact email or name matches only.</span>
                </div>
              )}
              <div className="rounded-lg border border-border divide-y divide-border">
                {clients.map((c) => (
                  <div key={c.id} className="flex flex-col gap-2 p-2 md:flex-row md:items-center" data-testid={`billcom-link-${c.id}`}>
                    <div className="min-w-0 md:w-1/3">
                      <div className="text-sm font-medium truncate">{c.name}{c.company ? ` (${c.company})` : ''}</div>
                      <div className="text-2xs text-muted-foreground truncate">{c.email ?? 'No email in Ops'}</div>
                    </div>
                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                      {c.billcom_customer_id ? (
                        <>
                          <StatusBadge tone="success">Linked</StatusBadge>
                          <span className="text-sm truncate">{c.linked_customer_name ?? c.billcom_customer_id}</span>
                          <Button
                            size="sm" variant="ghost" className="h-7 text-xs ml-auto" disabled={save.isPending}
                            onClick={() => save.mutate({ action: 'link', contact_id: c.id, customer_id: null })}
                          >
                            <Unlink className="w-3.5 h-3.5 mr-1" />Unlink
                          </Button>
                        </>
                      ) : c.suggestion ? (
                        <>
                          <StatusBadge tone="info">Suggested ({c.suggestion.by})</StatusBadge>
                          <span className="text-sm truncate">{customerById.get(c.suggestion.customer_id)?.name}</span>
                          <Button
                            size="sm" variant="outline" className="h-7 text-xs ml-auto" disabled={save.isPending}
                            onClick={() => save.mutate({ action: 'link', contact_id: c.id, customer_id: c.suggestion!.customer_id })}
                          >
                            Link
                          </Button>
                        </>
                      ) : (
                        <>
                          <StatusBadge tone="warning">{c.ambiguous.length ? 'Several matches' : 'Not linked'}</StatusBadge>
                          <div className="flex-1 min-w-[12rem]">
                            <SearchSelect
                              value=""
                              options={c.ambiguous.length ? options.filter((o) => c.ambiguous.includes(o.value)) : options}
                              placeholder="Pick the bill.com customer"
                              searchPlaceholder="Search bill.com customers"
                              emptyText="No customer found"
                              onSelect={(value) => save.mutate({ action: 'link', contact_id: c.id, customer_id: value })}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-2xs text-muted-foreground">
                A client with no bill.com customer yet gets one created the first time Ops creates their invoice (you confirm it then).
              </p>
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}
