import { useState, useRef, useCallback } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
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

const STEPS = ['Upload', 'Map Columns', 'Match Properties', 'Summary']

function StepIndicator({ current }: { current: number }) {
  const visibleSteps = STEPS
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
      setParseError('Please upload a .csv file.')
      return
    }
    setParseError('')
    setFileName(file.name)
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors.length > 0 && result.data.length === 0) {
          setParseError('Could not parse CSV: ' + result.errors[0].message)
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
      error: (err) => setParseError('Parse error: ' + err.message),
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
      setParseError('Please map both Property Name and Clean Date columns.')
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
        errors.push(`Row ${i + 2}: could not parse date "${rawDate}"`)
        continue
      }

      const cleanerName = colCleanerName ? (row[colCleanerName] || '').trim() || null : null

      if (!byName[rawProp]) byName[rawProp] = []
      byName[rawProp].push({ rawPropertyName: rawProp, cleanDate: date, cleanerName })
    }

    if (Object.keys(byName).length === 0) {
      setParseError('No valid records found. Check your column mapping.')
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
      setParseError(`Please enter a name for ${invalidNew.length} new ${invalidNew.length === 1 ? 'property' : 'properties'}.`)
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
      setParseError('No matched or new properties to import. Please match at least one property.')
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

    // Fetch Active stage ID once if we have new properties to create
    let activeStageId: string | null = null
    if (propertyGroups.some(g => g.isNew)) {
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name')
        .ilike('name', 'active')
        .limit(1)
      activeStageId = stages?.[0]?.id || null
    }

    for (const group of propertyGroups) {
      try {
        let propertyId = group.matchedPropertyId

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
              errors.push(`Failed to create "${group.matchedPropertyName}": ${createError2.message}`)
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

        const { count, error: histError } = await supabase
          .from('cleaning_history')
          .upsert(cleaningRows, { onConflict: 'property_id,clean_date', ignoreDuplicates: true })
          .select('id', { count: 'exact', head: true })

        if (!histError) {
          // count may be null on older Supabase client versions — fallback to total
          const inserted = count ?? cleaningRows.length
          const skipped = cleaningRows.length - inserted
          totalInserted += inserted
          totalSkipped += skipped
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
              errors.push(`Update failed for ${group.matchedPropertyName}: ${propError2.message}`)
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
        errors.push(`Unexpected error for ${group.matchedPropertyName}: ${e.message}`)
      }
    }

    // ── Log this import run ──
    await supabase.from('csv_import_log').insert({
      file_name: fileName,
      records_imported: totalInserted,
      records_skipped: totalSkipped,
      properties_updated: successCount,
      imported_by: user?.label || null,
    }).throwOnError().then(() => {}).catch(() => {}) // non-fatal

    setImporting(false)
    setCreatedNewProperties(newlyCreated)

    const dedupNote = totalSkipped > 0 ? ` (${totalSkipped} duplicate${totalSkipped > 1 ? 's' : ''} skipped)` : ''
    const recordNote = totalInserted > 0 ? ` · ${totalInserted} new clean records${dedupNote}` : dedupNote ? ` · ${dedupNote.trim()}` : ''

    if (errors.length > 0) {
      toast({
        title: `Imported ${successCount} of ${propertyGroups.length} properties`,
        description: errors.slice(0, 3).join('; '),
        variant: successCount === 0 ? 'destructive' : 'default',
      })
    } else {
      toast({ title: `${successCount} ${successCount === 1 ? 'property' : 'properties'} updated${recordNote}` })
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
          <DialogTitle>Import Cleaning History</DialogTitle>
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
              <p className="text-sm font-medium">Drop a CSV file here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">Must include at least: property name, clean date</p>
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
              Loaded <strong>{allRows.length}</strong> rows from <strong>{fileName}</strong>. Map the columns below.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Property Name *', value: colPropName, setter: setColPropName },
                { label: 'Clean Date *', value: colCleanDate, setter: setColCleanDate },
                { label: 'Cleaner Name', value: colCleanerName, setter: setColCleanerName },
              ].map(({ label, value, setter }) => (
                <div key={label}>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
                  <Select value={value || '__none__'} onValueChange={v => setter(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="— not mapped —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">— not mapped —</SelectItem>
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
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Preview (first {preview.length} rows)</p>
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
                {matchedCount} matched
              </span>
              {newCount > 0 && (
                <span className="flex items-center gap-1.5 text-primary">
                  <PlusCircle className="w-3.5 h-3.5" />
                  {newCount} new {newCount === 1 ? 'property' : 'properties'}
                </span>
              )}
              {unmatchedCount > 0 && (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {unmatchedCount} unmatched — assign, create new, or skip
                </span>
              )}
            </div>

            {matchErrors.length > 0 && (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
                <p className="font-medium mb-1">{matchErrors.length} rows skipped due to unparseable dates:</p>
                {matchErrors.slice(0, 5).map((e, i) => <p key={i}>{e}</p>)}
                {matchErrors.length > 5 && <p>…and {matchErrors.length - 5} more</p>}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {matchEntries.map((entry, i) => (
                <div key={i} className="flex items-center gap-3 rounded border border-border/50 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{entry.csvName}</p>
                    <p className="text-xs text-muted-foreground">{entry.records.length} records</p>
                  </div>
                  <div className="w-64 shrink-0">
                    {entry.isNew ? (
                      <div className="flex items-center gap-1">
                        <Input
                          className="h-7 text-xs flex-1"
                          placeholder="Enter property name…"
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
                          title="Cancel new property"
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
                          <SelectValue placeholder="— skip —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="text-xs text-muted-foreground">— skip —</SelectItem>
                          <SelectItem value="__new__" className="text-xs text-primary font-medium">
                            <span className="flex items-center gap-1.5">
                              <PlusCircle className="w-3 h-3" />
                              New Property
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
                This will update <strong>{existingGroups.length}</strong> existing {existingGroups.length === 1 ? 'property' : 'properties'}
                {newGroups.length > 0 && <span> and create <strong>{newGroups.length}</strong> new {newGroups.length === 1 ? 'property' : 'properties'}</span>}
                {unmatchedCount > 0 && <span className="text-muted-foreground"> ({unmatchedCount} skipped)</span>}.
              </p>
              {summaryFirstClean && summaryLastClean && (
                <p className="text-muted-foreground text-xs">
                  Clean date range: <strong className="text-foreground">{fmtDate(summaryFirstClean)}</strong> to <strong className="text-foreground">{fmtDate(summaryLastClean)}</strong>
                </p>
              )}
            </div>

            <div className="max-h-52 overflow-y-auto space-y-1">
              {propertyGroups.map((g, i) => (
                <div key={i} className="flex items-center gap-3 text-xs px-2 py-1.5 rounded hover:bg-muted/30">
                  {g.isNew && <PlusCircle className="w-3 h-3 text-primary shrink-0" />}
                  <span className="flex-1 font-medium truncate">{g.matchedPropertyName}</span>
                  <span className="text-muted-foreground">{g.records.length} cleans</span>
                  <span className="tabular-nums text-muted-foreground">{g.cleansPerMonth}/mo</span>
                  <span className="text-muted-foreground">→ {g.inferredFrequency.replace('_', ' ')}</span>
                  <span className="text-muted-foreground">first: {fmtDate(g.firstClean)}</span>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              For each property: <strong>first clean date</strong>, <strong>cleans/month</strong> (exact from CSV), and <strong>frequency</strong> will be updated.
              {newGroups.length > 0 && ' New properties will be added as Active.'}
            </p>
          </div>
        )}

        {/* ── Step 4: New properties created ── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">Import complete</p>
            </div>

            {createdNewProperties.length > 0 && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                <p className="text-sm font-medium">
                  {createdNewProperties.length} new {createdNewProperties.length === 1 ? 'property was' : 'properties were'} created:
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
                  These properties have been added with the cleaning frequency inferred from your CSV. Open them from the Pipeline or Property List to fill in Client Charged, costs, contact info, and other details.
                </p>
              </div>
            )}
          </div>
        )}

        </div>

        <DialogFooter className="gap-2 mt-2 flex-shrink-0 border-t border-border pt-3">
          {step > 0 && step < 4 && !importing && (
            <Button variant="outline" size="sm" onClick={() => { setParseError(''); setStep(s => s - 1) }}>
              Back
            </Button>
          )}
          {step < 4 && (
            <Button variant="outline" size="sm" onClick={onClose} disabled={importing}>
              Cancel
            </Button>
          )}
          {step === 1 && (
            <Button size="sm" onClick={proceedToMatch}>
              Next: Match Properties
            </Button>
          )}
          {step === 2 && (
            <Button size="sm" onClick={proceedToSummary}>
              Next: Review Summary
            </Button>
          )}
          {step === 3 && (
            <Button size="sm" onClick={executeImport} disabled={importing} data-testid="button-confirm-import">
              {importing ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Importing…</>
              ) : (
                `Import ${propertyGroups.length} ${propertyGroups.length === 1 ? 'Property' : 'Properties'}`
              )}
            </Button>
          )}
          {step === 4 && (
            <Button size="sm" onClick={onImportComplete}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
