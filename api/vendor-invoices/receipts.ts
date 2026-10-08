import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'node:crypto'
import { getServiceClient } from '../invoices/_lib.js'
import { requirePermissionBearer } from '../qbo/_lib.js'
import { loadVendorRun, receiptPrefix, RECEIPT_BUCKET, requireVendorActor, sendError } from './_lib.js'

// /api/vendor-invoices/receipts — receipts and evidence photos in the private
// `vendor-invoices` bucket. Files never get a public URL.
//
//   POST { action: 'upload_url', run_id, content_type, size }
//        → { path, token } for supabase.storage.uploadToSignedUrl (vendor, draft only)
//   GET  ?line_id=<id>            → { url } short-lived link (vendor: own lines)
//   GET  ?line_id=<id>&admin=1    → { url } (Tendwell: `invoicing` view grant)

const MAX_BYTES = 10 * 1024 * 1024
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}
const LINK_SECONDS = 120

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET' && req.query.admin) {
      const staff = await requirePermissionBearer(req, res, 'invoicing', 'view')
      if (!staff) return
      const supabase = getServiceClient()
      if (!supabase) { res.status(503).json({ error: 'Supabase service role not configured' }); return }
      const { data: line } = await supabase.from('invoice_lines').select('receipt_path').eq('id', String(req.query.line_id ?? '')).maybeSingle()
      if (!line?.receipt_path) { res.status(404).json({ error: 'No receipt' }); return }
      const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(line.receipt_path, LINK_SECONDS)
      if (error || !data) throw new Error(error?.message ?? 'Could not sign link')
      res.status(200).json({ url: data.signedUrl })
      return
    }

    if (req.method === 'GET') {
      const auth = await requireVendorActor(req, res, 'view')
      if (!auth) return
      const { actor, supabase } = auth
      const { data: line } = await supabase
        .from('invoice_lines')
        .select('receipt_path, run_id')
        .eq('id', String(req.query.line_id ?? ''))
        .maybeSingle()
      const run = line ? await loadVendorRun(supabase, line.run_id, actor.vendorId) : null
      if (!line?.receipt_path || !run) { res.status(404).json({ error: 'No receipt' }); return }
      const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(line.receipt_path, LINK_SECONDS)
      if (error || !data) throw new Error(error?.message ?? 'Could not sign link')
      res.status(200).json({ url: data.signedUrl })
      return
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }
    const auth = await requireVendorActor(req, res, 'edit')
    if (!auth) return
    const { actor, supabase } = auth
    const body = (req.body ?? {}) as Record<string, unknown>
    if (body.action !== 'upload_url') { res.status(400).json({ error: 'Unknown action' }); return }
    const run = await loadVendorRun(supabase, body.run_id, actor.vendorId)
    if (!run) { res.status(404).json({ error: 'Invoice not found' }); return }
    if (run.status !== 'draft') { res.status(409).json({ error: 'not_draft' }); return }
    const type = typeof body.content_type === 'string' ? body.content_type.toLowerCase() : ''
    const ext = EXT_BY_TYPE[type]
    if (!ext) { res.status(400).json({ error: 'file_type' }); return }
    const size = Number(body.size)
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) { res.status(400).json({ error: 'file_size' }); return }

    const path = `${receiptPrefix(actor.vendorId, run.id)}${randomUUID()}.${ext}`
    const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUploadUrl(path)
    if (error || !data) throw new Error(error?.message ?? 'Could not create upload link')
    res.status(200).json({ path, token: data.token })
  } catch (e) {
    sendError(res, e, 'Receipt request failed')
  }
}
