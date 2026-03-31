import { Eye, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { logActivity } from '@/lib/supabase'

export function EmulationBanner() {
  const { user, viewAs, setViewAs } = useAuth()

  if (!viewAs) return null

  function exit() {
    logActivity({
      entity_type: 'other',
      action: 'note',
      entity_name: 'view_as',
      field_name: viewAs!.label,
      new_value: 'stop',
      changed_by: user?.label ?? null,
    })
    setViewAs(null)
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-1.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex-shrink-0">
      <div className="flex items-center gap-2">
        <Eye className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          Previewing as <strong>{viewAs.label}</strong>
          <span className="text-amber-600 dark:text-amber-400 ml-1">({viewAs.role})</span>
          <span className="hidden sm:inline text-amber-600 dark:text-amber-400"> · Changes are disabled in preview mode</span>
        </span>
      </div>
      <button
        onClick={exit}
        className="flex items-center gap-1 font-medium hover:text-amber-950 dark:hover:text-amber-100 transition-colors"
        aria-label="Exit preview mode"
      >
        <X className="w-3 h-3" />
        Exit Preview
      </button>
    </div>
  )
}
