/**
 * Supabase Storage image-serving helpers.
 *
 * Distinct from `resize-image.ts`, which shrinks a File *before upload*.
 * This shrinks what the CDN *serves on display*: gallery thumbnails were
 * rendering full-resolution originals (a ~400 KB phone photo CSS-scaled into a
 * 48px box), which burned through the project's cached-egress quota. `thumbUrl`
 * rewrites a public object URL to Supabase's image-transform endpoint so the
 * CDN serves (and caches) a small resized variant instead — roughly an 8x
 * egress reduction per thumbnail.
 *
 * Use full-resolution URLs only where the user actually views the photo
 * (lightboxes, "open in new tab"). Use thumbUrl for grids/lists.
 */

const PUBLIC_MARKER = '/storage/v1/object/public/'
const RENDER_MARKER = '/storage/v1/render/image/public/'

type ThumbOptions = {
  /** Target width in px. Pass ~2x the rendered box size for retina sharpness. */
  width: number
  /** Optional target height in px. Omit to preserve aspect ratio. */
  height?: number
  /** JPEG/WebP quality 20-100. Defaults to 60 — fine for thumbnails. */
  quality?: number
  /** How the image fits the target box. Defaults to 'cover'. */
  resize?: 'cover' | 'contain' | 'fill'
}

/**
 * Convert a Supabase public object URL into a resized, CDN-cached thumbnail URL.
 * Returns the input unchanged if it is empty or not a Supabase public URL.
 */
export function thumbUrl(url: string | null | undefined, opts: ThumbOptions): string {
  if (!url) return ''
  if (!url.includes(PUBLIC_MARKER)) return url

  const rendered = url.replace(PUBLIC_MARKER, RENDER_MARKER)
  const params = new URLSearchParams()
  params.set('width', String(opts.width))
  if (opts.height != null) params.set('height', String(opts.height))
  params.set('quality', String(opts.quality ?? 60))
  params.set('resize', opts.resize ?? 'cover')
  return `${rendered}?${params.toString()}`
}
