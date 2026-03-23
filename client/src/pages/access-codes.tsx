import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { InlineEdit } from '@/components/InlineEdit'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { Search, Eye, EyeOff, Copy, Check } from 'lucide-react'
import { TablePagination } from '@/components/TablePagination'

const ACCESS_COLS = [
  { key: 'auto_code', label: 'Auto Code', sensitive: true },
  { key: 'door_code', label: 'Door Code', sensitive: true },
  { key: 'other_codes', label: 'Other Codes', sensitive: true },
  { key: 'wifi_info', label: 'WiFi Info', sensitive: true },
  { key: 'notes', label: 'Notes', sensitive: false },
]

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
      className="p-0.5 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      data-testid={`copy-${field}-${id}`}
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

function MaskedCell({ value, field, id, sensitive, onSave }: {
  value: string | null; field: string; id: string; sensitive: boolean
  onSave: (v: string) => void
}) {
  const [revealed, setRevealed] = useState(false)

  const handleSave = (v: string) => {
    onSave(v)
    logAccessEvent(id, field, 'update')
  }

  if (!sensitive || !value) {
    return (
      <InlineEdit
        value={value}
        type="text"
        onSave={handleSave}
        testId={`inline-${field}-${id}`}
        placeholder="—"
      />
    )
  }

  if (!revealed) {
    return (
      <button
        onClick={() => { setRevealed(true); logAccessEvent(id, field, 'reveal') }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
        data-testid={`reveal-${field}-${id}`}
      >
        <span className="tracking-widest">••••••</span>
        <Eye className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <InlineEdit
        value={value}
        type="text"
        onSave={handleSave}
        testId={`inline-${field}-${id}`}
        placeholder="—"
      />
      <CopyButton value={value} field={field} id={id} />
      <button
        onClick={() => setRevealed(false)}
        className="p-0.5 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        data-testid={`hide-${field}-${id}`}
      >
        <EyeOff className="w-3 h-3" />
      </button>
    </div>
  )
}

export default function AccessCodesPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  usePageTitle('Access Codes')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const { data: properties, isLoading } = useQuery({
    queryKey: ['/supabase/access-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_properties')
        .select('id, name, stage_name, auto_code, door_code, other_codes, wifi_info, notes')
        .neq('stage_name', 'Offboarded')
      if (error) throw error
      return data || []
    },
  })

  const { mutate: updateField } = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: string }) => {
      const { error } = await supabase.from('properties').update({ [field]: value }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/supabase/access-codes'] }),
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!properties) return []
    return properties.filter((p: any) => p.name?.toLowerCase().includes(search.toLowerCase()))
  }, [properties, search])

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  return (
    <div className="p-5 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Access Codes</h1>
          <p className="text-sm text-muted-foreground">Hover masked fields to reveal — click to edit</p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            data-testid="input-search-access"
            className="pl-8 h-8 w-56 text-sm"
          />
        </div>
      </div>

      <div className="overflow-auto flex-1 rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur border-b border-border z-10">
            <tr>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 min-w-[150px]">Property</th>
              {ACCESS_COLS.map(c => (
                <th key={c.key} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide py-2 px-3 whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {[...Array(ACCESS_COLS.length + 1)].map((_, j) => (
                    <td key={j} className="py-2 px-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={ACCESS_COLS.length + 1} className="text-center py-12 text-muted-foreground text-sm">No properties found</td>
              </tr>
            ) : (
              paged.map((p: any) => (
                <tr key={p.id} data-testid={`row-access-${p.id}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="py-2 px-3 font-medium text-xs">{p.name}</td>
                  {ACCESS_COLS.map(c => (
                    <td key={c.key} className="py-2 px-3">
                      <MaskedCell
                        value={p[c.key]}
                        field={c.key}
                        id={p.id}
                        sensitive={c.sensitive}
                        onSave={v => updateField({ id: p.id, field: c.key, value: v })}
                      />
                    </td>
                  ))}
                </tr>
              ))
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
