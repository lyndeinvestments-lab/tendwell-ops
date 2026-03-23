import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { format, parseISO } from 'date-fns'

interface InlineEditProps {
  value: string | number | null | undefined
  onSave: (val: string) => void
  type?: 'text' | 'number' | 'date'
  placeholder?: string
  className?: string
  testId?: string
}

export function InlineEdit({ value, onSave, type = 'text', placeholder = '—', className = '', testId }: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select()
    }
  }, [editing])

  function startEdit() {
    setDraft(value != null ? String(value) : '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    if (draft !== String(value ?? '')) {
      onSave(draft)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        data-testid={testId}
        className={`h-7 text-xs px-1.5 w-full ${className}`}
        autoFocus
      />
    )
  }

  let display: string
  if (value != null && value !== '') {
    if (type === 'date') {
      try {
        display = format(parseISO(String(value)), 'MMM d, yyyy')
      } catch {
        display = String(value)
      }
    } else {
      display = String(value)
    }
  } else {
    display = placeholder
  }

  return (
    <span
      onClick={startEdit}
      data-testid={testId}
      title="Click to edit"
      className={`cursor-text rounded px-1 py-0.5 hover:bg-muted transition-colors text-xs ${value == null || value === '' ? 'text-muted-foreground' : ''} ${className}`}
    >
      {display}
    </span>
  )
}
