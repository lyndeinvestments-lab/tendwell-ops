// Trellis API proxy helpers — server-side only, x-api-key never reaches the browser.
// Trellis is a short-term-rental ops platform: tasks, reservations, properties,
// contacts, messaging, workflows, workforce.
// Docs: https://docs.trellistech.com/introduction
// Interactive: https://api.trellistech.com/docs

const TRELLIS_API_BASE = 'https://api.trellistech.com/v1'

export class TrellisError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`Trellis API ${status}: ${body.slice(0, 200)}`)
    this.status = status
    this.body = body
  }
}

function getKey(): string {
  const key = process.env.TRELLIS_API_KEY
  if (!key) throw new TrellisError(500, 'TRELLIS_API_KEY not configured')
  return key
}

export async function trellisFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const key = getKey()
  const url = path.startsWith('http') ? path : `${TRELLIS_API_BASE}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new TrellisError(res.status, text)
  try {
    return text ? JSON.parse(text) as T : ({} as T)
  } catch {
    throw new TrellisError(res.status, `Non-JSON response: ${text.slice(0, 200)}`)
  }
}

// Convenience for the common GET case.
export function trellisGet<T>(path: string): Promise<T> {
  return trellisFetch<T>(path, { method: 'GET' })
}

// YYYY-MM-DD for "today" in America/Chicago (Haven's local timezone).
// Put this in the lib so every endpoint agrees on what "today" means.
export function todayInCentral(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
