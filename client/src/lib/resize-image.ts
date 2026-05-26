// Client-side image resize used before uploading photos to Supabase Storage.
// Phone-camera photos arrive at 4-12 MB; downscaling to <=1280 px on the long
// edge and re-encoding as JPEG q=0.8 typically yields 150-300 KB while
// keeping enough detail for a human to read scale labels / linen contents.
// Falls back to the original file on any error so submissions never block
// because of resize trouble.

export interface ResizeOptions {
  maxDimension?: number
  quality?: number
  mimeType?: string
}

export async function resizeImageFile(
  file: File,
  opts: ResizeOptions = {},
): Promise<File> {
  const maxDim = opts.maxDimension ?? 1280
  const quality = opts.quality ?? 0.8
  const mime = opts.mimeType ?? 'image/jpeg'

  if (!file.type.startsWith('image/')) return file
  if (typeof document === 'undefined') return file

  try {
    const bitmap = await loadBitmap(file)
    const { width, height } = scaleToFit(bitmap.width, bitmap.height, maxDim)
    if (width === bitmap.width && height === bitmap.height && file.size < 600_000) {
      (bitmap as ImageBitmap).close?.()
      return file
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      (bitmap as ImageBitmap).close?.()
      return file
    }
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height)
    ;(bitmap as ImageBitmap).close?.()

    const blob = await canvasToBlob(canvas, mime, quality)
    if (!blob || blob.size >= file.size) return file

    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, { type: mime, lastModified: Date.now() })
  } catch {
    return file
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // fall through to HTMLImageElement path (Safari edge cases)
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Image decode failed'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function scaleToFit(w: number, h: number, maxDim: number): { width: number; height: number } {
  const longest = Math.max(w, h)
  if (longest <= maxDim) return { width: w, height: h }
  const scale = maxDim / longest
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), mime, quality))
}
