import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { format, parseISO } from 'date-fns'
import { CalendarClock, ClipboardCheck, ImageOff, MapPin, User, Camera } from 'lucide-react'
import { scoreColorClass } from '@/lib/inspections'

// Public, no-login page reached via the shareable inspection link
// (/inspection/:token). The unguessable token in the URL is the only
// credential; the report is fetched from the token-validated, service-role
// /api/inspections/share/[token] endpoint. Renders the scheduled state before
// completion and the full report after — same link either way.

interface ShareReport {
  id: string
  status: 'scheduled' | 'completed' | 'skipped'
  scheduled_for: string | null
  inspected_at: string | null
  last_cleaned_on: string | null
  reinspect_urgency: 'none' | 'low' | 'medium' | 'high' | 'critical'
  reinspect_by: string | null
  overall_score: number | null
  cleanliness_score: number | null
  linens_score: number | null
  supplies_score: number | null
  exterior_score: number | null
  notes: string | null
  photos_url: string[]
  property_name: string | null
  property_address: string | null
  cleaner_name: string | null
  inspector_name: string | null
}

function getToken() {
  const m = window.location.pathname.match(/\/inspection\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

function fmt(d: string | null): string {
  if (!d) return '—'
  try { return format(parseISO(d), 'PPP') } catch { return d }
}

export default function InspectionSharePage() {
  const token = getToken()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['/inspection-share', token],
    enabled: !!token,
    queryFn: async (): Promise<{ report: ShareReport }> => {
      const r = await fetch(`/api/inspections/share/${encodeURIComponent(token)}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Not found')
      return r.json()
    },
  })

  if (!token) return <Centered><p className="text-sm text-muted-foreground">Invalid link.</p></Centered>
  if (isLoading) {
    return (
      <Centered>
        <div className="w-full max-w-lg space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Centered>
    )
  }
  if (isError || !data?.report) {
    return (
      <Centered>
        <div className="text-center">
          <ImageOff className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">This inspection link is invalid or has been removed.</p>
        </div>
      </Centered>
    )
  }

  const r = data.report
  const isScheduled = r.status === 'scheduled'
  const scores: [string, number | null][] = [
    ['Overall', r.overall_score],
    ['Cleanliness', r.cleanliness_score],
    ['Linens', r.linens_score],
    ['Supplies', r.supplies_score],
    ['Exterior', r.exterior_score],
  ]
  const mapHref = r.property_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.property_address)}`
    : null

  return (
    <div className="min-h-dvh bg-muted/30 py-6 px-4">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center">
          <h1 className="text-sm font-semibold text-muted-foreground">Tendwell Cleaning — Inspection</h1>
        </div>

        {/* Header card */}
        <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={`inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded border ${isScheduled ? 'text-info bg-info/10 border-info/25' : 'text-success bg-success/10 border-success/25'}`}>
              {isScheduled ? <CalendarClock className="w-3 h-3" /> : <ClipboardCheck className="w-3 h-3" />}
              {isScheduled ? 'Scheduled' : 'Completed'}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              {isScheduled ? (r.scheduled_for ? fmt(r.scheduled_for) : '') : fmt(r.inspected_at)}
            </span>
          </div>
          <h2 className="text-lg font-semibold">{r.property_name || 'Property'}</h2>
          {r.property_address && (
            mapHref ? (
              <a href={mapHref} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1 w-fit">
                <MapPin className="w-3 h-3 shrink-0" />{r.property_address}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">{r.property_address}</p>
            )
          )}
        </div>

        {/* Who / when */}
        <div className="rounded-lg border border-border bg-background p-4 text-xs text-muted-foreground space-y-1.5">
          <div className="flex items-center gap-1.5"><User className="w-3 h-3 shrink-0" /> Cleaner: <span className="text-foreground">{r.cleaner_name || '—'}</span></div>
          <div className="flex items-center gap-1.5"><User className="w-3 h-3 shrink-0" /> Inspector: <span className="text-foreground">{r.inspector_name || '—'}</span></div>
          {r.reinspect_urgency !== 'none' && (
            <div>Re-inspect: <span className="text-foreground capitalize">{r.reinspect_urgency}</span>{r.reinspect_by ? ` by ${fmt(r.reinspect_by)}` : ''}</div>
          )}
        </div>

        {isScheduled ? (
          <div className="rounded-lg border border-info/25 bg-info/5 p-4 text-center">
            <CalendarClock className="w-6 h-6 text-info mx-auto mb-1" />
            <p className="text-sm font-medium">Inspection scheduled{r.scheduled_for ? ` for ${fmt(r.scheduled_for)}` : ''}.</p>
            <p className="text-xs text-muted-foreground mt-0.5">The full report will appear here once the inspection is complete.</p>
          </div>
        ) : (
          <>
            {/* Scores */}
            <div className="rounded-lg border border-border bg-background p-4">
              <span className="text-sm font-medium block mb-2">Scores</span>
              <div className="grid grid-cols-2 gap-2">
                {scores.map(([label, score]) => (
                  <div key={label} className="rounded border border-border px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className={`text-sm font-semibold px-2 py-0.5 rounded tabular-nums ${scoreColorClass(score)}`}>{score ?? '—'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            {r.notes && (
              <div className="rounded-lg border border-border bg-background p-4">
                <span className="text-sm font-medium block mb-1">Notes</span>
                <p className="text-sm whitespace-pre-wrap">{r.notes}</p>
              </div>
            )}

            {/* Photos */}
            <div className="rounded-lg border border-border bg-background p-4">
              <span className="text-sm font-medium mb-2 flex items-center gap-1.5"><Camera className="w-3.5 h-3.5" /> Photos ({r.photos_url.length})</span>
              {r.photos_url.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {r.photos_url.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" className="block aspect-square rounded-md border border-border overflow-hidden bg-muted/30">
                      <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">No photos on this inspection.</p>}
            </div>
          </>
        )}

        <p className="text-center text-2xs text-muted-foreground pt-2">Powered by Tendwell Cleaning</p>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh flex items-center justify-center bg-muted/30 px-4">{children}</div>
}
