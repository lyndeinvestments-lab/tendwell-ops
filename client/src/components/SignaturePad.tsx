import { useRef, useEffect, useCallback, useState } from 'react'
import { Eraser } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void
  className?: string
  height?: number
}

export function SignaturePad({ onChange, className, height = 180 }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Offscreen ink-only canvas: strokes are mirrored here so the exported PNG
  // never contains the visible canvas's "Sign here" hint line/text, and so we
  // can crop the export to the ink's bounding box (deterministic placement on
  // the PDF regardless of where in the box the user drew).
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDrawing = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)

  function drawHint(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const baseline = Math.round(h * 0.72)
    ctx.save()
    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 6])
    ctx.beginPath()
    ctx.moveTo(16, baseline)
    ctx.lineTo(w - 16, baseline)
    ctx.stroke()
    ctx.restore()
    ctx.save()
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText('Sign here', 16, baseline - 6)
    ctx.restore()
  }

  // Scale both canvases for the device pixel ratio and draw the baseline hint
  // on the visible one. Clears both as a side effect — callers must call
  // onChange(null) to keep parent state in sync.
  const scaleCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const dpr = window.devicePixelRatio || 1
    const cssWidth = container.clientWidth
    canvas.width = cssWidth * dpr
    canvas.height = height * dpr
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    drawHint(ctx, cssWidth, height)

    let ink = inkCanvasRef.current
    if (!ink) {
      ink = document.createElement('canvas')
      inkCanvasRef.current = ink
    }
    ink.width = cssWidth * dpr
    ink.height = height * dpr
    ink.getContext('2d')?.scale(dpr, dpr)
  }, [height])

  useEffect(() => {
    scaleCanvas()
    setHasInk(false)
    // ResizeObserver: rescale when the container width changes (orientation
    // change, window resize). Clearing canvas is unavoidable here, so we notify
    // the parent that the signature is gone via onChange(null).
    const ro = new ResizeObserver(() => {
      scaleCanvas()
      setHasInk(false)
      onChange(null)
    })
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [scaleCanvas, onChange])

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function setupCtx(ctx: CanvasRenderingContext2D) {
    // Navy ink stays visible on white PDF background regardless of app dark/light
    // mode. Do NOT use a theme foreground color: white ink in dark mode would be
    // invisible in the exported PNG, which gets embedded in a white PDF.
    ctx.strokeStyle = '#1e2a4a'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  // Both drawing contexts: the visible canvas and the ink-only export canvas.
  function eachCtx(fn: (ctx: CanvasRenderingContext2D) => void) {
    const visible = canvasRef.current?.getContext('2d')
    const ink = inkCanvasRef.current?.getContext('2d')
    if (visible) fn(visible)
    if (ink) fn(ink)
  }

  // Export the ink-only canvas cropped to the drawn signature's bounding box
  // (plus padding), so the PDF stamping code positions predictable, tight ink.
  function exportInk(): string | null {
    const ink = inkCanvasRef.current
    const ctx = ink?.getContext('2d')
    if (!ink || !ctx) return null
    const { width, height: h } = ink
    if (width === 0 || h === 0) return null
    const data = ctx.getImageData(0, 0, width, h).data
    let minX = width
    let minY = h
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < h; y++) {
      const rowStart = y * width
      for (let x = 0; x < width; x++) {
        if (data[(rowStart + x) * 4 + 3] > 0) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null // no ink
    const pad = 12 // device px of breathing room around the ink
    minX = Math.max(0, minX - pad)
    minY = Math.max(0, minY - pad)
    maxX = Math.min(width - 1, maxX + pad)
    maxY = Math.min(h - 1, maxY + pad)
    const w = maxX - minX + 1
    const cropH = maxY - minY + 1
    const out = document.createElement('canvas')
    out.width = w
    out.height = cropH
    const outCtx = out.getContext('2d')
    if (!outCtx) return null
    outCtx.drawImage(ink, minX, minY, w, cropH, 0, 0, w, cropH)
    return out.toDataURL('image/png')
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
    isDrawing.current = true
    const pt = getPoint(e)
    lastPoint.current = pt
    eachCtx(ctx => {
      setupCtx(ctx)
      // Draw a dot for tap/click with no movement.
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 1, 0, Math.PI * 2)
      ctx.fillStyle = '#1e2a4a'
      ctx.fill()
    })
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current || !lastPoint.current) return
    e.preventDefault()
    const from = lastPoint.current
    const pt = getPoint(e)
    eachCtx(ctx => {
      setupCtx(ctx)
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(pt.x, pt.y)
      ctx.stroke()
    })
    lastPoint.current = pt
    if (!hasInk) setHasInk(true)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current) return
    e.preventDefault()
    isDrawing.current = false
    lastPoint.current = null
    // Export after every stroke end so the parent always has the latest PNG.
    const exported = exportInk()
    setHasInk(exported !== null)
    onChange(exported)
  }

  function handleClear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    drawHint(ctx, canvas.clientWidth, canvas.clientHeight)
    const ink = inkCanvasRef.current
    const inkCtx = ink?.getContext('2d')
    if (ink && inkCtx) {
      // The ink canvas has the same DPR scale transform, so CSS-pixel bounds
      // (clientWidth of the visible canvas) clear its full drawn area.
      inkCtx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    }
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div ref={containerRef} className="relative w-full">
        <canvas
          ref={canvasRef}
          // touch-action: none prevents the page from scrolling while drawing —
          // mobile-critical: without it, a downward stroke scrolls the page.
          style={{ touchAction: 'none', display: 'block' }}
          className="w-full rounded-lg border border-border bg-white"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-muted-foreground">Draw your signature above</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 min-h-[44px] px-3"
          onClick={handleClear}
          disabled={!hasInk}
          aria-label="Clear signature"
          data-testid="button-clear-signature"
        >
          <Eraser className="w-4 h-4" />
          Clear
        </Button>
      </div>
    </div>
  )
}
