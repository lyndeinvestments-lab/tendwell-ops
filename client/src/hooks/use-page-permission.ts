import { useAuth } from '@/lib/auth'

export function usePagePermission(viewId: string) {
  const { effectiveUser, isEmulating } = useAuth()
  const perm = effectiveUser?.resolvedPermissions[viewId]
  return {
    canView: perm?.view ?? false,
    canEdit: !isEmulating && (perm?.edit ?? false),
    isReadOnly: isEmulating || !(perm?.edit ?? false),
  }
}
