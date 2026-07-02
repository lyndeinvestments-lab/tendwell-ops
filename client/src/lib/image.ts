/**
 * Supabase Storage image-serving helpers.
 *
 * Distinct from `resize-image.ts`, which shrinks a File *before upload*.
 *
 * History: `thumbUrl` used to rewrite public object URLs to Supabase's
 * image-transform endpoint (`/storage/v1/render/image/...`) so the CDN served
 * a small resized variant, cutting thumbnail egress. But that endpoint is
 * metered by Supabase's **Image Transformations** quota (100 origin images per
 * month on Pro), and it went over (210/100), which bills as overage. Since
 * every upload is already downscaled client-side to <=1280 px / ~150-300 KB by
 * `resize-image.ts`, the transform endpoint added little on top of an
 * already-small origin, so it is not worth blowing a hard quota.
 *
 * `thumbUrl` now returns the plain public object URL and consumes zero
 * transformations. The `opts` (width/height/quality/resize) are kept for
 * call-site compatibility and as a hint of the rendered box size; actual
 * display sizing is handled by CSS on the `<img>`.
 *
 * If thumbnail egress later becomes a concern, the right fix is to generate and
 * store a dedicated thumbnail object at upload time (a second, tiny file) rather
 * than re-enabling the metered transform endpoint.
 */

const PUBLIC_MARKER = '/storage/v1/object/public/'

type ThumbOptions = {
  /** Target width in px. Retained as a rendered-box-size hint; not sent to any transform. */
  width: number
  /** Optional target height in px. Retained for call-site compatibility. */
  height?: number
  /** JPEG/WebP quality 20-100. Retained for call-site compatibility. */
  quality?: number
  /** How the image fits the target box. Retained for call-site compatibility. */
  resize?: 'cover' | 'contain' | 'fill'
}

/**
 * Return a display URL for a Supabase public object. Serves the (already
 * client-resized) original directly — no image-transform endpoint, so it does
 * not consume the Image Transformations quota. Returns '' for empty input and
 * the input unchanged if it is not a Supabase public URL.
 */
export function thumbUrl(url: string | null | undefined, _opts: ThumbOptions): string {
  if (!url) return ''
  if (!url.includes(PUBLIC_MARKER)) return url
  return url
}
