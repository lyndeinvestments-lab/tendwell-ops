import { useQuery } from '@tanstack/react-query'

export interface TrellisTask {
  id: string
  title?: string
  status?: string
  due_date?: string
  property_id?: string
  assignee_id?: string
}

interface TasksTodayResponse {
  date: string
  count: number
  tasks: TrellisTask[]
  error?: string
  hint?: string
}

export function useTrellisTasksToday() {
  return useQuery<TasksTodayResponse>({
    queryKey: ['/api/trellis/tasks-today'],
    queryFn: async () => {
      const res = await fetch('/api/trellis/tasks-today')
      const data = await res.json()
      if (!res.ok) {
        // Surface hint from the proxy so the dashboard can explain why the tile
        // is empty (missing key vs. bad filter).
        throw new Error(data.hint || data.error || `Trellis API ${res.status}`)
      }
      return data
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}
