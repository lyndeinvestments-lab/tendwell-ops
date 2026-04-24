import type { VercelRequest, VercelResponse } from '@vercel/node'
import { trellisGet, todayInCentral, TrellisError } from './_lib'

// Returns today's Trellis tasks (not tendwell-ops tasks — different concept).
// Used by the dashboard "Trellis Tasks Today" tile.
//
// Trellis's exact filter param is confirmed at
// https://api.trellistech.com/docs. We pass `due_date=YYYY-MM-DD`; if Trellis
// accepts a different param name this is the one line to change.
//
// Shape returned to the browser:
//   { date: '2026-04-24', count: 12, tasks: [...] }

interface TrellisTask {
  id: string
  title?: string
  status?: string
  due_date?: string
  property_id?: string
  assignee_id?: string
}

interface TrellisTaskListResponse {
  data?: TrellisTask[]
  items?: TrellisTask[]
  results?: TrellisTask[]
  tasks?: TrellisTask[]
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  let date = ''
  try {
    date = todayInCentral()
    const raw = await trellisGet<TrellisTaskListResponse | TrellisTask[]>(
      `/operations/tasks?due_date=${date}&status=open`,
    )
    // Trellis might return a bare array or a wrapped envelope — normalize.
    const tasks: TrellisTask[] = Array.isArray(raw)
      ? raw
      : (raw.data ?? raw.items ?? raw.results ?? raw.tasks ?? [])
    res.status(200).json({ date, count: tasks.length, tasks })
  } catch (e) {
    if (e instanceof TrellisError) {
      res.status(e.status === 500 ? 503 : e.status).json({
        error: e.message,
        hint: e.status === 500
          ? 'Set TRELLIS_API_KEY in Vercel env, then redeploy.'
          : 'Verify the Trellis task filter — param name or status value may differ from the assumed due_date/status=open.',
      })
      return
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
