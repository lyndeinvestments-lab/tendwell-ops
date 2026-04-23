import React, { useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'

// Shared @-mention UI. Mirrors the inline implementation in pages/tasks.tsx so
// every notes area (property, contact, etc.) gets the same UX. The candidate
// `users` list is the caller's responsibility — hand in only people with access
// to the underlying record.

export interface MentionUser {
  id: number
  label: string
}

interface BaseProps {
  value: string
  onChange: (v: string) => void
  users: MentionUser[]
  onSubmit?: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
  autoFocus?: boolean
  dataTestId?: string
}

export function MentionInput(props: BaseProps) {
  return <MentionField as="input" {...props} />
}

export function MentionTextarea(props: BaseProps & { rows?: number }) {
  return <MentionField as="textarea" {...props} />
}

function MentionField({
  as, value, onChange, users, onSubmit, placeholder, disabled, className, autoFocus, dataTestId, rows,
}: BaseProps & { as: 'input' | 'textarea'; rows?: number }) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [tokenStart, setTokenStart] = useState(-1)
  const [activeIdx, setActiveIdx] = useState(0)

  const matches = useMemo(() => {
    const q = query.toLowerCase()
    return users
      .filter(u => u.label && (q === '' || u.label.toLowerCase().includes(q)))
      .slice(0, 6)
  }, [users, query])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const v = e.target.value
    onChange(v)
    const cursor = e.target.selectionStart ?? v.length
    const before = v.slice(0, cursor)
    const m = before.match(/(?:^|\s)@([\w' -]*)$/)
    if (m) {
      setOpen(true)
      setQuery(m[1])
      setTokenStart(cursor - m[1].length - 1)
      setActiveIdx(0)
    } else {
      setOpen(false)
    }
  }

  function pick(label: string) {
    if (tokenStart < 0) return
    const cursor = ref.current?.selectionStart ?? value.length
    const before = value.slice(0, tokenStart)
    const after = value.slice(cursor)
    const next = `${before}@${label} ${after}`
    onChange(next)
    setOpen(false)
    requestAnimationFrame(() => {
      const pos = (before + '@' + label + ' ').length
      ref.current?.setSelectionRange(pos, pos)
      ref.current?.focus()
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (open && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % matches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i - 1 + matches.length) % matches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[activeIdx].label); return }
      if (e.key === 'Escape') { setOpen(false); return }
    }
    if (as === 'input' && e.key === 'Enter' && !open && onSubmit) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="relative">
      {as === 'input' ? (
        <Input
          ref={ref as React.Ref<HTMLInputElement>}
          autoFocus={autoFocus}
          className={className ?? 'h-10 sm:h-8 text-sm sm:text-xs'}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          data-testid={dataTestId}
        />
      ) : (
        <textarea
          ref={ref as React.Ref<HTMLTextAreaElement>}
          autoFocus={autoFocus}
          rows={rows ?? 3}
          className={className ?? 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring'}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          data-testid={dataTestId}
        />
      )}
      {open && matches.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 sm:right-auto mb-1 z-50 bg-popover border border-border rounded-md shadow-md sm:min-w-[200px] max-h-56 overflow-y-auto py-1">
          {matches.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(u.label) }}
              onTouchStart={(e) => { e.preventDefault(); pick(u.label) }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs ${i === activeIdx ? 'bg-accent text-accent-foreground' : ''}`}
            >
              {u.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Render stored text with @mentions highlighted. Only highlights labels passed in,
// so you can scope highlighting to the taggable-user pool.
export function MentionBody({ text, userLabels }: { text: string; userLabels: string[] }) {
  if (!text) return null
  if (userLabels.length === 0) return <>{text}</>
  const sorted = [...userLabels].sort((a, b) => b.length - a.length)
  const escaped = sorted.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`@(${escaped.join('|')})(?![a-zA-Z0-9])`, 'gi')
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    parts.push(<span key={key++} className="text-blue-600 dark:text-blue-400 font-medium">{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>)
  return <>{parts}</>
}
