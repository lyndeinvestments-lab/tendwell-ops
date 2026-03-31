import { useMutation, type UseMutationOptions } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/hooks/use-toast'

/**
 * Drop-in replacement for useMutation that blocks mutations when:
 * 1. Admin is emulating another user (preview mode)
 * 2. User lacks edit permission for the given view
 */
export function useGuardedMutation<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
  viewId: string,
  options: UseMutationOptions<TData, TError, TVariables, TContext>
) {
  const { isEmulating, effectiveUser } = useAuth()
  const { toast } = useToast()

  const canEdit = !isEmulating && (effectiveUser?.resolvedPermissions[viewId]?.edit ?? false)

  return useMutation<TData, TError, TVariables, TContext>({
    ...options,
    mutationFn: async (variables: TVariables, context: any) => {
      if (!canEdit) {
        toast({
          title: isEmulating ? 'Read-only preview' : 'Edit access required',
          description: isEmulating
            ? 'Exit preview mode to make changes.'
            : "You don't have edit access to this page.",
          variant: 'destructive',
        })
        throw new Error('edit_blocked')
      }
      return options.mutationFn!(variables, context)
    },
  })
}
