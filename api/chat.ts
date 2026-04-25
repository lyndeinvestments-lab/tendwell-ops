import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleChat } from '../server/chat'

// Vercel serverless wrapper for the chatbot.
//
// The handler lives in server/chat.ts so it can also be mounted by the local
// Express dev server (server/routes.ts). Vercel doesn't run Express in
// production — only api/*.ts files get deployed as serverless functions —
// which is why /api/chat 404'd before this file existed.
//
// Express's Request/Response and Vercel's VercelRequest/VercelResponse are
// duck-type compatible for the surface handleChat uses (body, status, json,
// headersSent), so the cast is safe.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handleChat(req as any, res as any)
}
