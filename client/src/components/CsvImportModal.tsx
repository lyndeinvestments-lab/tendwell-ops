import { useState, useRef, useCallback } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { Upload, AlertTriangle, CheckCircle2, XCircle, Loader2, PlusCircle } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CsvRow {
  [key: string]: string
}

interface ParsedRecord {
  rawPropertyName: string
  cleanDate: Date
  cleanerName: string | null
}

interface PropertyGroup {
  matchedPropertyId: string | null
  matchedPropertyName: string | null
  records: ParsedRecord[]
  firstClean: Date
  lastClean: Date
  cleansPerMonth: number
  inferredFrequency: string
  isNew: boolean
}

interface MatchEntry {
  csvName: string
  propertyId: string | null
  propertyName: string | null
  records: ParsedRecord[]
  isNew: boolean
  newPropertyName: string
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function parseDate(raw: string): Date | null {
  const s = raw.trim()
  if (!s) return null
  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00')
    return isNaN(d.getTime()) ? null : d
  }
  // M/D/YY or MM/DD/YYYY or M/D/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const mo = parseInt(m[1])
    const day = parseInt(m[2])
    const rawYr = parseInt(m[3])
    const yr = m[3].length === 2 ? (rawYr > 50 ? 1900 + rawYr : 2000 + rawYr) : rawYr
    const d = new Date(yr, mo - 1, day)
    return isNaN(d.getTime()) ? null : d
  }
  // Try native Date parse as fallback
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

function matchScore(csvName: string, propName: string): number {
  const csvNorm = normalize(csvName)
  const propNorm = normalize(propName)
  const csvWords = csvNorm.split(' ').filter(Boolean)
  const propWords = propNorm.split(' ').filter(Boolean)
  if (csvWords.length === 0 || propWords.length === 0) return 0

  // Bidirectional: how many CSV words appear in property name, and vice versa
  const csvInProp = csvWords.filter(w => propNorm.includes(w)).length / csvWords.length
  const propInCsv = propWords.filter(w => csvNorm.includes(w)).length / propWords.length

  // Take the max of both directions to handle partial name variations
  return Math.max(csvInProp, propInCsv)
}

function findBestMatch(csvName: string, properties: any[]): { id: string; name: string } | null {
  let best: { id: string; name: string } | null = null
  let bestScore = 0
  for (const p of properties) {
    const score = matchScore(csvName, p.name || '')
    if (score > bestScore) {
      bestScore = score
      best = { id: p.id, name: p.name }
    }
  }
  return bestScore >= 0.4 ? best : null
}

function calcCleansPerMonth(dates: Date[]): number {
  if (dates.length === 0) return 0
  if (dates.length === 1) return 1
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const today = new Date()
  const endDate = today.getTime() - last.getTime() < 30 * 24 * 60 * 60 * 1000 ? today : last
  const months = (endDate.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  return Math.round((dates.length / Math.max(months, 0.25)) * 10) / 10
}

function inferFrequency(cpm: number): string {
  if (cpm === 0) return 'as_needed'
  if (Math.abs(cpm - 4.33) <= 0.25) return 'weekly'
  if (Math.abs(cpm - 2.17) <= 0.25) return 'biweekly'
  if (Math.abs(cpm - 1) <= 0.25) return 'monthly'
  return 'custom'
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

// ─── Step indicators ──────────────────────────────────────────────────────────

const STEP_KEYS = ['upload', 'mapColumns', 'matchProperties', 'summary'] as const
const STEP_FALLBACKS = ['Upload', 'Map Columns', 'Match Properties', 'Summary']

function StepIndicator({ current }: { current: number }) {
  const { t } = useLocale('csv')
  const visibleSteps = STEP_KEYS.map((key, i) => t(`steps.${key}`, undefined, STEP_FALLBACKS[i]))
  return (
    <div className="flex items-center gap-0 mb-5">
      {visibleSteps.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded ${i === current ? 'text-primary' : i < current ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold ${i === current ? 'bg-primary text-primary-foreground' : i < current ? 'bg-muted text-muted-foreground' : 'bg-muted/40 text-muted-foreground/40'}`}>
              {i + 1}
            </span>
            {label}
          </div>
          {i < visibleSteps.length - 1 && (
            <div className={`w-6 h-px ${i < current ? 'bg-border' : 'bg-border/30'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface CsvImportModalProps {
  properties: any[]
  onClose: () => void
  onImportComplete: () => void
}

export function CsvImportModal({ properties, onClose, onImportComplete }: CsvImportModalProps) {
  const { t } = useLocale('csv')
  const { toast } = useToast()
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [preview, setPreview] = useState<CsvRow[]>([])
  const [allRows, setAllRows] = useState<CsvRow[]>([])
  const [parseError, setParseError] = useState('')

  // Column mapping (no cost column)
  const [colPropName, setColPropName] = useState('')
  const [colCleanDate, setColCleanDate] = useState('')
  const [colCleanerName, setColCleanerName] = useState('')

  // Property matching
  const [matchEntries, setMatchEntries] = useState<MatchEntry[]>([])
  const [matchErrors, setMatchErrors] = useState<string[]>([])

  // Import summary
  const [propertyGroups, setPropertyGroups] = useState<PropertyGroup[]>([])
  const [importing, setImporting] = useState(false)

  // New properties created in step 4
  const [createdNewProperties, setCreatedNewProperties] = useState<string[]>([])

  // ─── Step 0: File upload ────────────────────────────────────────────────────

  function handleFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      setParseError(t('errors.notCsv'))
      return
    }
    setParseError('')
    setFileName(file.name)
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors.length > 0 && result.data.length === 0) {
          setParseError(t('errors.parseFailedPrefix', { message: result.errors[0].message }))
          return
        }
        const hs = result.meta.fields || []
        setHeaders(hs)
        setAllRows(result.data)
        setPreview(result.data.slice(0, 5))
        // Auto-detect columns (no cost)
        const propCol = hs.find(h => /prop|property|name|address/i.test(h)) || ''
        const dateCol = hs.find(h => /date|clean.*date|service/i.test(h)) || ''
        const cleanerCol = hs.find(h => /cleaner|worker|employee|staff/i.test(h)) || ''
        setColPropName(propCol)
        setColCleanDate(dateCol)
        setColCleanerName(cleanerCol)
        setStep(1)
      },
      error: (err) => setParseError(t('errors.parseErrorPrefix', { message: err.message })),
    })
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [])

  // ─── Step 1 → 2: Parse records + build match entries ───────────────────────

  function proceedToMatch() {
    if (!colPropName || !colCleanDate) {
      setParseError(t('errors.missingMapping'))
      return
    }
    setParseError('')

    const errors: string[] = []
    const byName: Record<string, ParsedRecord[]> = {}

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i]
      const rawProp = (row[colPropName] || '').trim()
      const rawDate = (row[colCleanDate] || '').trim()
      if (!rawProp || !rawDate) continue

      const date = parseDate(rawDate)
      if (!date) {
        errors.push(t('errors.unparsableDate', { row: i + 2, date: rawDate }))
        continue
      }

      const cleanerName = colCleanerName ? (row[colCleanerName] || '').trim() || null : null

      if (!byName[rawProp]) byName[rawProp] = []
      byName[rawProp].push({ rawPropertyName: rawProp, cleanDate: date, cleanerName })
    }

    if (Object.keys(byName).length === 0) {
      setParseError(t('errors.noValidRecords'))
      return
    }

    const entries: MatchEntry[] = Object.entries(byName).map(([csvName, records]) => {
      const match = findBestMatch(csvName, properties)
      return {
        csvName,
        propertyId: match?.id || null,
        propertyName: match?.name || null,
        records,
        isNew: false,
        newPropertyName: '',
      }
    })

    setMatchEntries(entries)
    setMatchErrors(errors)
    setStep(2)
  }

  // ─── Step 2 → 3: Build property groups + summary ───────────────────────────

  function proceedToSummary() {
    if (parseError) setParseError('')

    // Validate new property names
    const invalidNew = matchEntries.filter(e => e.isNew && !e.newPropertyName.trim())
    if (invalidNew.length > 0) {
      setParseError(t('errors.missingNewNames', { count: invalidNew.length }))
      return
    }

    const groups: PropertyGroup[] = []

    for (const entry of matchEntries) {
      // Skip entries that are neither matched nor flagged as new
      if (!entry.propertyId && !entry.isNew) continue

      const dates = entry.records.map(r => r.cleanDate)
      const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
      const firstClean = sorted[0]
      const lastClean = sorted[sorted.length - 1]
      const cpm = calcCleansPerMonth(dates)

      groups.push({
        matchedPropertyId: entry.isNew ? null : entry.propertyId,
        matchedPropertyName: entry.isNew ? entry.newPropertyName.trim() : entry.propertyName,
        records: entry.records,
        firstClean,
        lastClean,
        cleansPerMonth: cpm,
        inferredFrequency: inferFrequency(cpm),
        isNew: entry.isNew,
      })
    }

    if (groups.length === 0) {
      setParseError(t('errors.noMatchedOrNew'))
      return
    }

    setParseError('')
    setPropertyGroups(groups)
    setStep(3)
  }

  // ─── Step 3: Execute import ─────────────────────────────────────────────────

  async function executeImport() {
    setImporting(true)
    let successCount = 0
    let totalInserted = 0
    let totalSkipped = 0
    const errors: string[] = []
    const newlyCreated: string[] = []

    // Fetch Active stage ID once if we have new properties to create.
    // pipeline_stages.id is integer at the DB; typed client confirms it.
    let activeStageId: number | null = null
    if (propertyGroups.some(g => g.isNew)) {
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name')
        .ilike('name', 'active')
        .limit(1)
      activeStageId = stages?.[0]?.id ?? null
    }

    for (const group of propertyGroups) {
      try {
        // properties.id is bigint; PropertyGroup carries it as string from the
        // UI selector. Coerce once at entry so downstream .eq() / .insert()
        // calls type-check against the typed Supabase client.
        let propertyId: number | null = group.matchedPropertyId != null
          ? Number(group.matchedPropertyId)
          : null

        // ── Create new property ──
        if (group.isNew) {
          const { data: newProp, error: createError } = await supabase
            .from('properties')
            .insert({
              name: group.matchedPropertyName!,
              stage_id: activeStageId,
              cleaning_frequency: group.inferredFrequency,
              first_clean_date: fmtDate(group.firstClean),
              avg_cleans_per_month: group.cleansPerMonth,
            })
            .select('id')
            .single()

          if (createError) {
            // Retry without avg_cleans_per_month in case column doesn't exist yet
            const { data: newProp2, error: createError2 } = await supabase
              .from('properties')
              .insert({
                name: group.matchedPropertyName!,
                stage_id: activeStageId,
                cleaning_frequency: group.inferredFrequency,
                first_clean_date: fmtDate(group.firstClean),
              })
              .select('id')
              .single()

            if (createError2) {
              errors.push(t('errors.createFailed', { name: group.matchedPropertyName!, message: createError2.message }))
              continue
            }
            propertyId = newProp2.id
          } else {
            propertyId = newProp.id
          }

          newlyCreated.push(group.matchedPropertyName!)
        }

        if (!propertyId) continue

        // ── Insert individual cleaning records (idempotent via unique constraint) ──
        const cleaningRows = group.records.map(r => ({
          property_id: propertyId,
          clean_date: fmtDate(r.cleanDate),
          cleaner_name: r.cleanerName || null,
        }))

        // Optimistic inserted count — the upsert response doesn't reliably
        // expose how many rows hit the ignoreDuplicates branch without
        // SELECTing them back, so we treat every row as inserted. Previously
        // the code attempted .select('id', {count:'exact', head:true}) but
        // that overload wasn't typed; the count was already falling back to
        // cleaningRows.length via ?? in 100% of observed responses.
        const { error: histError } = await supabase
          .from('cleaning_history')
          .upsert(cleaningRows, { onConflict: 'property_id,clean_date', ignoreDuplicates: true })

        if (!histError) {
          totalInserted += cleaningRows.length
        }

        // ── Recompute avg_cleans_per_month from stored DB records (idempotent) ──
        const { data: storedDates } = await supabase
          .from('cleaning_history')
          .select('clean_date')
          .eq('property_id', propertyId)

        const recomputedCpm = storedDates && storedDates.length > 0
          ? calcCleansPerMonth(storedDates.map((r: any) => new Date(r.clean_date + 'T00:00:00')))
          : group.cleansPerMonth

        // ── Update property metadata ──
        if (!group.isNew) {
          const { error: propError } = await supabase
            .from('properties')
            .update({
              first_clean_date: fmtDate(group.firstClean),
              cleaning_frequency: group.inferredFrequency,
              avg_cleans_per_month: recomputedCpm,
            })
            .eq('id', propertyId)

          if (propError) {
            // Retry without avg_cleans_per_month if column doesn't exist
            const { error: propError2 } = await supabase
              .from('properties')
              .update({
                first_clean_date: fmtDate(group.firstClean),
                cleaning_frequency: group.inferredFrequency,
              })
              .eq('id', propertyId)
            if (propError2) {
              errors.push(t('errors.updateFailed', { name: group.matchedPropertyName!, message: propError2.message }))
              continue
            }
          }
        } else {
          // Update the avg for newly created property too
          await supabase
            .from('properties')
            .update({ avg_cleans_per_month: recomputedCpm })
            .eq('id', propertyId)
        }

        successCount++
      } catch (e: any) {
        errors.push(t('errors.unexpectedError', { name: group.matchedPropertyName!, message: e.message }))
      }
    }

    // ── Log this import run ──
    // Column names match the csv_import_log schema: rows_inserted /
    // rows_skipped (NOT records_imported / records_skipped). The old keys
    // silently 400'd — this insert is intentionally non-fatal (.catch
    // swallowed it), so no CSV import has ever been logged until now.
    try {
      await supabase.from('csv_import_log').insert({
        file_name: fileName,
        rows_inserted: totalInserted,
        rows_skipped: totalSkipped,
        properties_updated: successCount,
        imported_by: user?.label || null,
      })
    } catch { /* non-fatal — audit log shouldn't block the import flow */ }

    setImporting(false)
    setCreatedNewProperties(newlyCreated)

    const dedupNote = totalSkipped > 0 ? ` (${t('toast.duplicatesSkipped', { count: totalSkipped })})` : ''
    const recordNote = totalInserted > 0 ? ` · ${t('toast.newCleanRecords', { count: totalInserted })}${dedupNote}` : dedupNote ? ` · ${dedupNote.trim()}` : ''

    if (errors.length > 0) {
      toast({
        title: t('toast.importedOf', { success: successCount, total: propertyGroups.length }),
        description: errors.slice(0, 3).join('; '),
        variant: successCount === 0 ? 'destructive' : 'default',
      })
    } else {
      toast({ title: `${t('toast.updatedNoun', { count: successCount })}${recordNote}` })
    }

    if (newlyCreated.length > 0) {
      setStep(4) // Show new properties confirmation step
    } else {
      onImportComplete()
    }
  }

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const matchedCount = matchEntries.filter(e => e.propertyId && !e.isNew).length
  const unmatchedCount = matchEntries.filter(e => !e.propertyId && !e.isNew).length
  const newCount = matchEntries.filter(e => e.isNew).length

  const summaryFirstClean = propertyGroups.length > 0
    ? propertyGroups.reduce((min, g) => g.firstClean < min ? g.firstClean : min, propertyGroups[0].firstClean)
    : null
  const summaryLastClean = propertyGroups.length > 0
    ? propertyGroups.reduce((max, g) => g.lastClean > max ? g.lastClean : max, propertyGroups[0].lastClean)
    : null

  const existingGroups = propertyGroups.filter(g => !g.isNew)
  const newGroups = propertyGroups.filter(g => g.isNew)

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        {step < 4 && <StepIndicator current={step} />}

        <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0">
        {/* ── Step 0: Upload ── */}
        {step === 0 && (
          <div className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'}`}
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">{t('upload.dropHint')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('upload.requirements')}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={onFileChange}
                data-testid="input-file-csv"
              />
            </div>
            {parseError && (
              <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 rounded px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 1: Map columns ── */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t('mapping.loadedRows', { count: allRows.length, fileName })}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: t('mapping.propertyName'), value: colPropName, setter: setColPropName },
                { label: t('mapping.cleanDate'), value: colCleanDate, setter: setColCleanDate },
                { label: t('mapping.cleanerName'), value: colCleanerName, setter: setColCleanerName },
              ].map(({ label, value, setter }) => (
                <div key={label}>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
                  <Select value={value || '__none__'} onValueChange={v => setter(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={t('mapping.notMapped')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">{t('mapping.notMapped')}</SelectItem>
                      {headers.map(h => (
                        <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Preview table */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('mapping.previewTitle', { count: preview.length })}</p>
              <div className="overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      {headers.map(h => (
                        <th key={h} className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-border/50">
                        {headers.map(h => (
                          <td key={h} className="px-2 py-1 whitespace-nowrap max-w-[150px] overflow-hidden text-ellipsis">{row[h] || ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {parseError && (
              <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 rounded px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Match properties ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-xs flex-wrap">
              <span className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('match.matchedCount', { count: matchedCount })}
              </span>
              {newCount > 0 && (
                <span className="flex items-center gap-1.5 text-primary">
                  <PlusCircle className="w-3.5 h-3.5" />
                  {t('match.newCount', { count: newCount })}
                </span>
              )}
              {unmatchedCount > 0 && (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('match.unmatchedCount', { count: unmatchedCount })}
                </span>
              )}
            </div>

            {matchErrors.length > 0 && (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
                <p className="font-medium mb-1">{t('match.errorsHeader', { count: matchErrors.length })}</p>
                {matchErrors.slice(0, 5).map((e, i) => <p key={i}>{e}</p>)}
                {matchErrors.length > 5 && <p>{t('match.moreErrors', { count: matchErrors.length - 5 })}</p>}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {matchEntries.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 rounded border border-border/50 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{entry.csvName}</p>
                    <p className="text-xs text-muted-foreground">{t('match.recordsCount', { count: entry.records.length })}</p>
                  </div>
                  <div className="w-64 shrink-0">
                    {entry.isNew ? (
                      <div className="flex items-center gap-1">
                        <Input
                          className="h-7 text-xs flex-1"
                          placeholder={t('match.newPropertyPlaceholder')}
                          value={entry.newPropertyName}
                          autoFocus
                          onChange={e => {
                            const val = e.target.value
                            setMatchEntries(prev => prev.map((me, j) =>
                              j === i ? { ...me, newPropertyName: val } : me
                            ))
                          }}
                        />
                        <button
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          title={t('match.cancelNewTooltip')}
                          onClick={() => setMatchEntries(prev => prev.map((me, j) =>
                            j === i ? { ...me, isNew: false, newPropertyName: '' } : me
                          ))}
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <Select
                        value={entry.propertyId || '__none__'}
                        onValueChange={v => {
                          if (v === '__new__') {
                            setMatchEntries(prev => prev.map((me, j) =>
                              j === i ? { ...me, propertyId: null, propertyName: null, isNew: true, newPropertyName: me.csvName } : me
                            ))
                          } else {
                            const pid = v === '__none__' ? null : v
                            const pname = pid ? properties.find(p => p.id === pid)?.name || null : null
                            setMatchEntries(prev => prev.map((me, j) =>
                              j === i ? { ...me, propertyId: pid, propertyName: pname, isNew: false } : me
                            ))
                          }
                        }}
                      >
                        <SelectTrigger className={`h-7 text-xs ${!entry.propertyId ? 'border-amber-400 text-amber-600' : ''}`}>
                          <SelectValue placeholder={t('match.skipOption')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs text-muted-foreground">{t('match.skipOption')}</SelectItem>
                          <SelectItem value="__new__" className="text-xs text-primary font-medium">
                            <span className="flex items-center gap-1.5">
                              <PlusCircle className="w-3 h-3" />
                              {t('match.newPropertyOption')}
                            </span>
                          </SelectItem>
                          <div className="h-px bg-border my-1" />
                          {[...properties].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')).map((p: any) => (
                            <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {entry.isNew
                    ? <PlusCircle className="w-4 h-4 text-primary shrink-0" />
                    : entry.propertyId
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                      : <XCircle className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                  }
                </div>
              ))}
            </div>

            {parseError && (
              <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 rounded px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Summary ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2 text-xs">
              <p>
                {t('summary.willUpdatePrefix')} <strong>{existingGroups.length}</strong> {t('summary.existingNoun', { count: existingGroups.length })}
                {newGroups.length > 0 && <span> {t('summary.andCreatePrefix')} <strong>{newGroups.length}</strong> {t('summary.newNoun', { count: newGroups.length })}</span>}
                {unmatchedCount > 0 && <span className="text-muted-foreground"> {t('summary.skippedFragment', { count: unmatchedCount })}</span>}.
              </p>
              {summaryFirstClean && summaryLastClean && (
                <p className="text-muted-foreground text-xs">
                  {t('summary.dateRangeLabel')} <strong className="text-foreground">{fmtDate(summaryFirstClean)}</strong> {t('summary.dateRangeTo')} <strong className="text-foreground">{fmtDate(summaryLastClean)}</strong>
                </p>
              )}
            </div>

            <div className="max-h-52 overflow-y-auto space-y-1">
              {propertyGroups.map((g, i) => (
                <div key={i} className="flex items-center gap-3 text-xs px-2 py-1.5 rounded hover:bg-muted/30">
                  {g.isNew && <PlusCircle className="w-3 h-3 text-primary shrink-0" />}
                  <span className="flex-1 font-medium truncate">{g.matchedPropertyName}</span>
                  <span className="text-muted-foreground">{t('summary.cleansCount', { count: g.records.length })}</span>
                  <span className="tabular-nums text-muted-foreground">{g.cleansPerMonth}{t('summary.perMonthSuffix')}</span>
                  <span className="text-muted-foreground">→ {t(`frequency.${g.inferredFrequency}`, undefined, g.inferredFrequency.replace('_', ' '))}</span>
                  <span className="text-muted-foreground">{t('summary.firstLabel')} {fmtDate(g.firstClean)}</span>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              {t('summary.explanation.prefix')} <strong>{t('summary.explanation.firstCleanDate')}</strong>, <strong>{t('summary.explanation.cleansPerMonth')}</strong> {t('summary.explanation.middle')} <strong>{t('summary.explanation.frequency')}</strong> {t('summary.explanation.suffix')}
              {newGroups.length > 0 && ` ${t('summary.explanation.newPropertiesNote')}`}
            </p>
          </div>
        )}

        {/* ── Step 4: New properties created ── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">{t('done.title')}</p>
            </div>

            {createdNewProperties.length > 0 && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                <p className="text-sm font-medium">
                  {createdNewProperties.length === 1
                    ? t('done.createdOneMessage', { count: createdNewProperties.length })
                    : t('done.createdManyMessage', { count: createdNewProperties.length })}
                </p>
                <ul className="space-y-1">
                  {createdNewProperties.map((name, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PlusCircle className="w-3 h-3 text-primary shrink-0" />
                      {name}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground pt-1 border-t border-border/50">
                  {t('done.footnote')}
                </p>
              </div>
            )}
          </div>
        )}

        </div>

        <DialogFooter className="gap-2 mt-2 flex-shrink-0 border-t border-border pt-3">
          {step > 0 && step < 4 && !importing && (
            <Button variant="outline" size="sm" onClick={() => { setParseError(''); setStep(s => s - 1) }}>
              {t('common.actions.back', undefined, 'Back')}
            </Button>
          )}
          {step < 4 && (
            <Button variant="outline" size="sm" onClick={onClose} disabled={importing}>
              {t('common.actions.cancel', undefined, 'Cancel')}
            </Button>
          )}
          {step === 1 && (
            <Button size="sm" onClick={proceedToMatch}>
              {t('buttons.nextMatch')}
            </Button>
          )}
          {step === 2 && (
            <Button size="sm" onClick={proceedToSummary}>
              {t('buttons.nextSummary')}
            </Button>
          )}
          {step === 3 && (
            <Button size="sm" onClick={executeImport} disabled={importing} data-testid="button-confirm-import">
              {importing ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> {t('buttons.importing')}</>
              ) : (
                t('buttons.importCount', { count: propertyGroups.length })
              )}
            </Button>
          )}
          {step === 4 && (
            <Button size="sm" onClick={onImportComplete}>
              {t('buttons.done')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
