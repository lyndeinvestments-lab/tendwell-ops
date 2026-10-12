import { AlertTriangle } from 'lucide-react'
import { dayRelationLabel, type ServiceDetail, type StayInput } from '@shared/service-detail'
import { cn } from '@/lib/utils'

// What the task behind an invoice line actually was. Data comes from
// /api/invoices/line-details (codes already masked). The endpoint strips
// null fields, so every field here may be missing, not just null.

const TZ = 'America/New_York' // every Tendwell property is in Eastern time

function fmtWhen(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { timeZone: TZ, month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmtDay(ymd: string | null | undefined): string | null {
  if (!ymd) return null
  const [, m, d] = ymd.split('-')
  return m && d ? `${Number(m)}/${Number(d)}` : null
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s_])\w/g, c => c.toUpperCase()).replace(/_/g, ' ')

function stayText(s: StayInput | null | undefined): string | null {
  if (!s) return null
  const who = s.ownerBlock ? 'Owner stay' : s.guestName ?? 'Guest'
  const dates = [fmtDay(s.checkin), fmtDay(s.checkout)].filter(Boolean).join('–')
  return [who, dates, s.channel ? titleCase(s.channel) : null].filter(Boolean).join(' · ')
}

/** Requested → done, one line. */
function timeline(d: ServiceDetail): string | null {
  const t = d.task
  if (!t) return null
  const requested = fmtWhen(t.requestedAt) ?? (t.requestedDate ? fmtDay(t.requestedDate) : null)
  const done = fmtWhen(t.completedAt) ?? (t.completedDate ? fmtDay(t.completedDate) : null)
  const by = t.doneBy?.length ? t.doneBy.join(', ') : null
  return [
    requested ? `Requested ${requested}` : null,
    t.priority && !/^(normal|medium|low|none)$/i.test(t.priority) ? titleCase(t.priority) : null,
    done ? `Done ${done}${by ? ` by ${by}` : ''}` : by ? `By ${by}` : null,
  ].filter(Boolean).join(' · ') || null
}

export function ServiceDetailWarnings({ detail, className }: { detail: ServiceDetail | undefined; className?: string }) {
  if (!detail?.warnings?.length) return null
  return (
    <div className={cn('space-y-0.5', className)}>
      {detail.warnings.map(w => (
        <p key={w} className="flex items-start gap-1 text-2xs text-warning whitespace-normal">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />{w}
        </p>
      ))}
    </div>
  )
}

/** Two short lines under the property: what was done, and when / by whom /
 *  who was there. Add-ons get the full summary; a regular clean shows only
 *  its warnings so a 500-line run stays readable. */
export function ServiceDetailSummary({ detail, isExtra, serviceType, lineId }: {
  detail: ServiceDetail | undefined
  isExtra: boolean
  serviceType: string | null
  lineId: string
}) {
  if (!detail) return null
  if (!isExtra) return <ServiceDetailWarnings detail={detail} className="mt-1" />
  const headline = detail.headline && detail.headline.toLowerCase() !== (serviceType ?? '').toLowerCase() ? detail.headline : null
  const when = timeline(detail)
  const day = dayRelationLabel({ dayRelation: detail.dayRelation ?? 'unknown', onSite: detail.onSite ?? null })
  if (!headline && !when && !day && !detail.warnings?.length) return null
  return (
    <div className="mt-1 space-y-0.5 text-2xs text-muted-foreground" data-testid={`service-detail-${lineId}`}>
      {headline && <p className="text-foreground/85 whitespace-normal">{headline}</p>}
      {(when || day) && <p className="whitespace-normal">{[when, day].filter(Boolean).join(' · ')}</p>}
      <ServiceDetailWarnings detail={detail} />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === '' || children === false) return null
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-normal break-words">{children}</dd>
    </div>
  )
}

/** Everything known about the service, for the Review dialog. */
export function ServiceDetailPanel({ detail, loading }: { detail: ServiceDetail | undefined; loading?: boolean }) {
  if (loading) return <p className="text-xs text-muted-foreground">Loading service detail…</p>
  if (!detail) return null
  const t = detail.task
  const day = dayRelationLabel({ dayRelation: detail.dayRelation ?? 'unknown', onSite: detail.onSite ?? null })
  const linkedDiffers = detail.linkedStay && detail.linkedStay.reservationId !== detail.onSite?.reservationId
  const checklist = t?.checklistTotal ? `${t.checklistCompleted ?? 0} of ${t.checklistTotal} items ticked` : null
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5 text-xs space-y-2" data-testid="service-detail-panel">
      <p className="font-medium">What this service was</p>
      {!t && !detail.warnings?.length && <p className="text-muted-foreground">No task is linked to this line.</p>}
      <dl className="space-y-1">
        <Row label="Task">{t ? [t.title, t.department].filter(Boolean).join(' · ') : null}</Row>
        <Row label="Request">{t?.description ? `“${t.description}”` : null}</Row>
        <Row label="Requested">{fmtWhen(t?.requestedAt) ?? fmtDay(t?.requestedDate)}</Row>
        <Row label="Priority">{t?.priority ? titleCase(t.priority) : null}</Row>
        <Row label="Scheduled">{[fmtDay(t?.scheduledDate), t?.scheduledTime].filter(Boolean).join(' ') || null}</Row>
        <Row label="Completed">{fmtWhen(t?.completedAt) ?? fmtDay(t?.completedDate) ?? (t?.status ? titleCase(t.status) : null)}</Row>
        <Row label="Done by">{t?.doneBy?.length ? t.doneBy.join(', ') : null}</Row>
        <Row label="Checklist">{checklist}</Row>
        <Row label="Guest issues">{t?.linkedIssueCount ? `${t.linkedIssueCount} linked` : null}</Row>
        <Row label="That day">{day}</Row>
        <Row label="On site">{stayText(detail.onSite)}</Row>
        <Row label="Last checkout">{detail.dayRelation === 'vacant' ? stayText(detail.lastOut) : null}</Row>
        <Row label="Next check-in">{detail.dayRelation === 'vacant' ? stayText(detail.nextIn) : null}</Row>
        <Row label="Task linked to">{linkedDiffers ? stayText(detail.linkedStay) : null}</Row>
        <Row label="Source">
          {t ? `${t.source === 'trellis' ? 'Trellis' : 'Breezeway'}${detail.fromTrellisTwin ? ' (detail from the Trellis copy)' : ''}` : null}
        </Row>
      </dl>
      {detail.dayRelation === 'unknown' && t && (
        <p className="text-2xs text-muted-foreground">No reservation data for this property, so who was staying is unknown.</p>
      )}
      <ServiceDetailWarnings detail={detail} />
    </div>
  )
}
