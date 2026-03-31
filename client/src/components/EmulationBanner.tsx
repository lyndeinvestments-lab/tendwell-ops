import { useAuth } from '@/lib/auth'
import { logActivity } from '@/lib/supabase'
import { Eye, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmulationBanner() {
  const { viewAs, setViewAs, user } = useAuth()

  if (!viewAs) return null

  function handleExit() {
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
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs">
      <Eye className="w-3.5 h-3.5 flex-shrink-0" />
      <span>
        Previewing as <strong>{viewAs.label}</strong> · {viewAs.role} · Changes are disabled in preview mode
      </span>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto h-6 px-2 text-xs border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
        onClick={handleExit}
      >
        <X className="w-3 h-3 mr-1" />
        Exit Preview
      </Button>
    </div>
  )
}
