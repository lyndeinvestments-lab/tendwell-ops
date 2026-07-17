import { useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'

export interface SearchSelectOption {
  value: string
  label: string
}

/**
 * Searchable single-select (Popover + cmdk Command), replacing long native
 * <select> lists on the issues forms. Same pattern as HostawaySyncTab's
 * link-property picker. Type-to-filter; optional clear affordance.
 */
export function SearchSelect({
  value,
  onSelect,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  allowClear = true,
}: {
  value: string
  onSelect: (value: string, label: string) => void
  options: SearchSelectOption[]
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  allowClear?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(o => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full h-8 px-2 text-sm font-normal justify-between"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label || placeholder}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {allowClear && selected && (
              <X
                className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive"
                onClick={e => { e.stopPropagation(); onSelect('', '') }}
              />
            )}
            <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(o => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => { onSelect(o.value, o.label); setOpen(false) }}
                >
                  <Check className={cn('w-3.5 h-3.5 mr-2', o.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
