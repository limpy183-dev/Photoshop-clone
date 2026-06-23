"use client"

/**
 * RichTooltip — a generic, reusable tooltip primitive.
 *
 * Renders an animated canvas preview (~80x60 px) using `requestAnimationFrame`
 * alongside a title, multi-line description, and an optional "Learn more" link
 * that fires the `ps-open-learn` window event. Built on top of Radix Tooltip
 * primitives so positioning, portalling, and focus behavior come for free.
 *
 * The preview animator is a pure function of time (no DOM, no React state),
 * runs only while the tooltip is visible, and is cancelled on unmount or
 * tab visibility changes to avoid wasted work.
 */

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { dispatchPhotoshopEvent } from "./events"
import type { ToolPreviewKind } from "./tool-tooltip-content"

export const DEFAULT_RICH_TOOLTIP_DELAY_MS = 600

const PREVIEW_WIDTH = 80
const PREVIEW_HEIGHT = 60

export interface RichTooltipProps {
  /** Element that triggers the tooltip (the consumer wraps the trigger). */
  children: React.ReactNode
  /** Title shown at the top of the tooltip body. */
  title: string
  /** Description body. Newlines are preserved. */
  description: string
  /** Optional secondary subtitle/eyebrow (e.g. category). */
  subtitle?: string
  /** Animated preview kind. Omit to skip the preview. */
  previewKind?: ToolPreviewKind
  /** Keyboard shortcut chip rendered in the header (e.g. "B"). */
  shortcut?: string
  /** Optional list of usage steps shown beneath the header. */
  steps?: string[]
  /**
   * Topic id to send with `ps-open-learn`. When set, a "Learn more" button
   * dispatches the typed event helper with `{ topic }`. Omit to hide the button.
   */
  learnTopic?: string
  /** Override the "Learn more" label. Defaults to "Learn more". */
  learnLabel?: string
  /**
   * Optional explicit string shown in the Learn button alongside the icon.
   * Useful for showing the resolved search query (e.g. "brush dynamics").
   */
  learnHint?: string
  /** Optional callback fired before the default Discover learn event. */
  onLearnClick?: () => void
  /** Hover delay before the tooltip appears, in ms. Defaults to ~600ms. */
  delayMs?: number
  /** Whether the tooltip is enabled. Set to false to disable for the trigger. */
  enabled?: boolean
  /** Tooltip side. */
  side?: TooltipPrimitive.TooltipContentProps["side"]
  /** Tooltip alignment. */
  align?: TooltipPrimitive.TooltipContentProps["align"]
  /** Offset from the trigger. */
  sideOffset?: number
  /** Additional class names for the content surface. */
  contentClassName?: string
}

interface PreviewCanvasProps {
  kind: ToolPreviewKind
}

/**
 * Animated preview canvas. Plays a deterministic looping demo for the given
 * preview kind. Animation pauses while the document is hidden.
 */
export function RichTooltipPreview({ kind }: PreviewCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const startRef = React.useRef<number>(0)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Match canvas backing-store DPI for crisp lines on hi-dpi displays.
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1
    canvas.width = PREVIEW_WIDTH * dpr
    canvas.height = PREVIEW_HEIGHT * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    startRef.current = 0

    const tick = (timestamp: number) => {
      if (!startRef.current) startRef.current = timestamp
      const elapsed = (timestamp - startRef.current) / 1000
      drawToolPreviewFrame(ctx, kind, elapsed)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    const handleVisibility = () => {
      if (document.hidden) {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
      } else if (rafRef.current === null) {
        startRef.current = 0
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [kind])

  return (
    <canvas
      ref={canvasRef}
      data-testid={`tool-preview-${kind}`}
      data-preview={kind}
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      role="img"
      aria-hidden="true"
      className="block h-[60px] w-[80px] rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
    />
  )
}

/**
 * Fire `ps-open-learn` for a given topic. Exported so other UIs (menu help
 * items, command palette results, etc.) can reuse the same convention.
 */
export function dispatchOpenLearn(topic: string) {
  dispatchPhotoshopEvent("ps-open-learn", { topic })
}

export function RichTooltip({
  children,
  title,
  description,
  subtitle,
  previewKind,
  shortcut,
  steps,
  learnTopic,
  learnLabel = "Learn more",
  learnHint,
  onLearnClick,
  delayMs = DEFAULT_RICH_TOOLTIP_DELAY_MS,
  enabled = true,
  side = "right",
  align = "start",
  sideOffset = 8,
  contentClassName,
}: RichTooltipProps) {
  if (!enabled) {
    return <>{children}</>
  }

  return (
    <TooltipPrimitive.Provider delayDuration={delayMs} skipDelayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            data-slot="tooltip-content"
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={cn(
              "z-50 w-[308px] max-w-[calc(100vw-76px)] rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[11px] text-[var(--ps-text)] shadow-2xl",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              contentClassName,
            )}
          >
            <RichTooltipBody
              title={title}
              description={description}
              subtitle={subtitle}
              previewKind={previewKind}
              shortcut={shortcut}
              steps={steps}
              learnTopic={learnTopic}
              learnLabel={learnLabel}
              learnHint={learnHint}
              onLearnClick={onLearnClick}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

/**
 * The inner body. Exported separately so callers can embed the tooltip-style
 * UI inside non-Radix surfaces (popovers, side panels, etc.).
 */
export function RichTooltipBody({
  title,
  description,
  subtitle,
  previewKind,
  shortcut,
  steps,
  learnTopic,
  learnLabel = "Learn more",
  learnHint,
  onLearnClick,
}: Omit<RichTooltipProps, "children" | "delayMs" | "enabled" | "side" | "align" | "sideOffset" | "contentClassName">) {
  return (
    <div className="overflow-hidden rounded-sm">
      <div className="grid grid-cols-[80px_1fr] gap-3 border-b border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-3">
        {previewKind ? (
          <RichTooltipPreview kind={previewKind} />
        ) : (
          <div className="h-[60px] w-[80px] rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]" aria-hidden />
        )}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-[var(--ps-text)]">{title}</div>
              {subtitle ? (
                <div className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--ps-text-dim)]">{subtitle}</div>
              ) : null}
            </div>
            {shortcut ? (
              <kbd className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text)]">
                {shortcut}
              </kbd>
            ) : null}
          </div>
          {description ? (
            <p className="mt-2 whitespace-pre-line leading-4 text-[var(--ps-text-dim)]">{description}</p>
          ) : null}
        </div>
      </div>
      {steps?.length ? (
        <div className="space-y-1.5 p-3">
          {steps.map((step, index) => (
            <div key={step} className="grid grid-cols-[18px_1fr] gap-2 text-[10.5px] leading-4">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-[var(--ps-panel-2)] text-[9px] text-[var(--ps-accent-2)]">
                {index + 1}
              </span>
              <span className="text-[var(--ps-text)]">{step}</span>
            </div>
          ))}
        </div>
      ) : null}
      {learnTopic ? (
        <div className="border-t border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-2">
          <button
            type="button"
            aria-label={`Learn ${title} in Discover`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onLearnClick?.()
              dispatchOpenLearn(learnTopic)
            }}
            className="flex h-7 w-full items-center justify-between gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-left text-[10px] text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-tool-hover)]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent-2)]" />
              <span className="truncate">{learnLabel}</span>
            </span>
            {learnHint ? <span className="truncate text-[var(--ps-text-dim)]">{learnHint}</span> : null}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Preview renderers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Draw one frame of the looping demo for the given preview kind into the
 * supplied 2D context. The context is already DPR-scaled by the caller, so
 * renderers operate in CSS pixel coordinates (80x60).
 *
 * Each renderer is deterministic — the only input is the elapsed time in
 * seconds — so adding new kinds is just "compute geometry as a function of t".
 */
export function drawToolPreviewFrame(
  ctx: CanvasRenderingContext2D,
  kind: ToolPreviewKind,
  elapsed: number,
) {
  // Clear + paint the checker-like backdrop that every preview shares.
  ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  paintBackdrop(ctx)

  const t = elapsed % 2 // most loops fit into 2 seconds
  switch (kind) {
    case "brush":
    case "pencil":
    case "mixer-brush":
    case "color-replace":
      return drawBrushStroke(ctx, t, kind)
    case "selection-rect":
      return drawMarquee(ctx, t, "rect")
    case "selection-ellipse":
      return drawMarquee(ctx, t, "ellipse")
    case "selection-row":
      return drawSingleAxisMarquee(ctx, t, "row")
    case "selection-col":
      return drawSingleAxisMarquee(ctx, t, "col")
    case "lasso":
    case "lasso-magnetic":
    case "quick-selection":
    case "object-select":
    case "refine-edge":
    case "subject":
    case "sky":
    case "background":
      return drawLasso(ctx, t, kind)
    case "lasso-polygon":
      return drawPolygonLasso(ctx, t)
    case "magic-wand":
      return drawMagicWand(ctx, t)
    case "crop":
      return drawCrop(ctx, t)
    case "perspective-crop":
      return drawPerspectiveCrop(ctx, t)
    case "slice":
    case "frame":
      return drawSlice(ctx, t)
    case "eyedropper":
    case "color-sampler":
    case "material-eyedropper":
      return drawEyedropper(ctx, t)
    case "ruler":
      return drawRuler(ctx, t)
    case "note":
      return drawNote(ctx, t)
    case "count":
      return drawCount(ctx, t)
    case "material-drop":
    case "paint-bucket":
      return drawBucket(ctx, t)
    case "spot-heal":
    case "heal":
    case "patch":
    case "remove":
    case "content-aware-move":
      return drawHeal(ctx, t)
    case "red-eye":
      return drawRedEye(ctx, t)
    case "clone":
    case "pattern-stamp":
      return drawClone(ctx, t)
    case "history":
    case "art-history":
      return drawHistory(ctx, t)
    case "eraser":
    case "background-eraser":
    case "magic-eraser":
      return drawEraser(ctx, t)
    case "gradient":
      return drawGradient(ctx, t)
    case "blur":
    case "sharpen":
    case "smudge":
      return drawBlur(ctx, t, kind)
    case "dodge":
    case "burn":
    case "sponge":
      return drawTonal(ctx, t, kind)
    case "pen":
    case "freeform-pen":
    case "curvature-pen":
    case "anchor-add":
    case "anchor-delete":
    case "anchor-convert":
    case "path-select":
    case "direct-select":
      return drawPath(ctx, t, kind)
    case "type":
    case "type-vertical":
    case "type-mask":
      return drawType(ctx, t, kind)
    case "shape-rect":
    case "shape-rounded-rect":
    case "shape-ellipse":
    case "shape-polygon":
    case "shape-star":
    case "shape-triangle":
    case "shape-line":
    case "custom-shape":
      return drawShape(ctx, t, kind)
    case "hand":
      return drawHand(ctx, t)
    case "rotate-view":
      return drawRotateView(ctx, t)
    case "zoom":
      return drawZoom(ctx, t)
    case "transform":
      return drawTransform(ctx, t)
    case "quick-mask":
      return drawQuickMask(ctx, t)
    case "move":
    case "artboard":
    default:
      return drawMove(ctx, t)
  }
}

function paintBackdrop(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#2a2a2a"
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  ctx.fillStyle = "#333333"
  const tile = 8
  for (let y = 0; y < PREVIEW_HEIGHT; y += tile) {
    for (let x = 0; x < PREVIEW_WIDTH; x += tile) {
      if (((x / tile) + (y / tile)) % 2 === 0) ctx.fillRect(x, y, tile, tile)
    }
  }
}

function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number, size = 6) {
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.fillStyle = "rgba(255,255,255,0.15)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x, y, size, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawBrushStroke(ctx: CanvasRenderingContext2D, t: number, kind: ToolPreviewKind) {
  const progress = clamp(t / 1.5, 0, 1)
  // Sample points along a sinusoidal stroke.
  const steps = 60
  ctx.save()
  if (kind === "pencil") {
    ctx.lineCap = "square"
    ctx.lineJoin = "miter"
    ctx.lineWidth = 2
  } else {
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 4
  }
  ctx.strokeStyle = kind === "color-replace" ? "#7bd1ff" : "#f5f5f5"
  ctx.beginPath()
  for (let i = 0; i <= steps * progress; i++) {
    const u = i / steps
    const x = 8 + u * (PREVIEW_WIDTH - 16)
    const y = PREVIEW_HEIGHT / 2 + Math.sin(u * Math.PI * 1.6) * 14
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
  const head = strokeHead(progress)
  drawCursor(ctx, head.x, head.y, kind === "pencil" ? 3 : 5)
}

function strokeHead(progress: number) {
  const u = progress
  const x = 8 + u * (PREVIEW_WIDTH - 16)
  const y = PREVIEW_HEIGHT / 2 + Math.sin(u * Math.PI * 1.6) * 14
  return { x, y }
}

function drawMarquee(ctx: CanvasRenderingContext2D, t: number, shape: "rect" | "ellipse") {
  const w = 8 + (PREVIEW_WIDTH - 24) * clamp(t / 1.2, 0, 1)
  const h = 8 + (PREVIEW_HEIGHT - 20) * clamp(t / 1.2, 0, 1)
  const x = (PREVIEW_WIDTH - w) / 2
  const y = (PREVIEW_HEIGHT - h) / 2
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  const dashPhase = (t * 20) % 6
  ctx.setLineDash([3, 3])
  ctx.lineDashOffset = -dashPhase
  ctx.beginPath()
  if (shape === "rect") ctx.rect(x, y, w, h)
  else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  drawCursor(ctx, x + w, y + h, 3)
}

function drawSingleAxisMarquee(ctx: CanvasRenderingContext2D, t: number, axis: "row" | "col") {
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.setLineDash([3, 3])
  ctx.lineDashOffset = -(t * 20) % 6
  ctx.lineWidth = 1
  const sweep = (Math.sin(t * Math.PI) + 1) / 2 // 0..1..0
  if (axis === "row") {
    const y = 10 + sweep * (PREVIEW_HEIGHT - 20)
    ctx.beginPath()
    ctx.moveTo(2, y)
    ctx.lineTo(PREVIEW_WIDTH - 2, y)
    ctx.stroke()
  } else {
    const x = 10 + sweep * (PREVIEW_WIDTH - 20)
    ctx.beginPath()
    ctx.moveTo(x, 2)
    ctx.lineTo(x, PREVIEW_HEIGHT - 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawLasso(ctx: CanvasRenderingContext2D, t: number, kind: ToolPreviewKind) {
  const progress = clamp(t / 1.5, 0, 1)
  const steps = 80
  const cx = PREVIEW_WIDTH / 2
  const cy = PREVIEW_HEIGHT / 2
  ctx.save()
  ctx.strokeStyle = kind === "refine-edge" || kind === "subject" || kind === "sky" || kind === "background" ? "#7bd1ff" : "#ffffff"
  ctx.lineWidth = 1
  ctx.setLineDash([3, 2])
  ctx.lineDashOffset = -(t * 20) % 5
  ctx.beginPath()
  for (let i = 0; i <= steps * progress; i++) {
    const u = i / steps
    const a = u * Math.PI * 2
    const r = 22 + Math.sin(a * 3) * 4
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * (r - 4)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
}

function drawPolygonLasso(ctx: CanvasRenderingContext2D, t: number) {
  const progress = clamp(t / 1.5, 0, 1)
  const points: Array<[number, number]> = [
    [12, 48],
    [30, 14],
    [56, 18],
    [70, 42],
    [50, 52],
  ]
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.setLineDash([3, 2])
  ctx.lineDashOffset = -(t * 20) % 5
  const visible = Math.floor(progress * points.length)
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i <= visible; i++) {
    ctx.lineTo(points[i][0], points[i][1])
  }
  ctx.stroke()
  ctx.restore()
  for (let i = 0; i <= visible; i++) {
    const [x, y] = points[i]
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
  }
}

function drawMagicWand(ctx: CanvasRenderingContext2D, t: number) {
  // Pulse a star-shaped selection.
  const pulse = 0.6 + Math.sin(t * Math.PI * 2) * 0.2
  ctx.save()
  ctx.translate(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.lineDashOffset = -(t * 20) % 6
  ctx.beginPath()
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const r = (i % 2 === 0 ? 18 : 22) * pulse
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

function drawCrop(ctx: CanvasRenderingContext2D, t: number) {
  const inset = 6 + Math.sin(t * Math.PI) * 4
  const x = inset
  const y = inset
  const w = PREVIEW_WIDTH - inset * 2
  const h = PREVIEW_HEIGHT - inset * 2
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, w, h)
  ctx.strokeStyle = "rgba(255,255,255,0.4)"
  ctx.beginPath()
  ctx.moveTo(x + w / 3, y)
  ctx.lineTo(x + w / 3, y + h)
  ctx.moveTo(x + (2 * w) / 3, y)
  ctx.lineTo(x + (2 * w) / 3, y + h)
  ctx.moveTo(x, y + h / 3)
  ctx.lineTo(x + w, y + h / 3)
  ctx.moveTo(x, y + (2 * h) / 3)
  ctx.lineTo(x + w, y + (2 * h) / 3)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = "#ffffff"
  ;[
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ].forEach(([cx, cy]) => ctx.fillRect(cx - 2, cy - 2, 4, 4))
}

function drawPerspectiveCrop(ctx: CanvasRenderingContext2D, t: number) {
  const skew = Math.sin(t * Math.PI) * 6
  const pts: Array<[number, number]> = [
    [10 + skew, 12],
    [PREVIEW_WIDTH - 10, 8],
    [PREVIEW_WIDTH - 14, PREVIEW_HEIGHT - 10],
    [14, PREVIEW_HEIGHT - 6 + skew],
  ]
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.stroke()
  ctx.fillStyle = "#ffffff"
  for (const [x, y] of pts) ctx.fillRect(x - 2, y - 2, 4, 4)
  ctx.restore()
}

function drawSlice(ctx: CanvasRenderingContext2D, _t: number) {
  ctx.save()
  ctx.strokeStyle = "#9ad2ff"
  ctx.lineWidth = 1
  ctx.strokeRect(6, 6, PREVIEW_WIDTH - 12, PREVIEW_HEIGHT - 12)
  ctx.beginPath()
  ctx.moveTo(PREVIEW_WIDTH / 2, 6)
  ctx.lineTo(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT - 6)
  ctx.moveTo(6, PREVIEW_HEIGHT / 2)
  ctx.lineTo(PREVIEW_WIDTH - 6, PREVIEW_HEIGHT / 2)
  ctx.stroke()
  ctx.fillStyle = "#9ad2ff"
  ctx.fillRect(8, 8, 9, 7)
  ctx.fillStyle = "rgba(154,210,255,0.7)"
  ctx.fillRect(PREVIEW_WIDTH / 2 + 2, 8, 9, 7)
  ctx.restore()
}

function drawEyedropper(ctx: CanvasRenderingContext2D, t: number) {
  // Gradient sample bar with a moving sampler.
  const grad = ctx.createLinearGradient(8, 0, PREVIEW_WIDTH - 8, 0)
  grad.addColorStop(0, "#3a6df0")
  grad.addColorStop(0.5, "#e07b5a")
  grad.addColorStop(1, "#f5d97a")
  ctx.fillStyle = grad
  ctx.fillRect(8, 20, PREVIEW_WIDTH - 16, 20)
  const x = 10 + ((t / 2) * (PREVIEW_WIDTH - 20))
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(x, 16, 2, 28)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x + 1, 30, 5, 0, Math.PI * 2)
  ctx.stroke()
}

function drawRuler(ctx: CanvasRenderingContext2D, _t: number) {
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(8, PREVIEW_HEIGHT - 10)
  ctx.lineTo(PREVIEW_WIDTH - 8, 14)
  ctx.stroke()
  for (let i = 0; i < 9; i++) {
    const u = i / 8
    const x = 8 + u * (PREVIEW_WIDTH - 16)
    const y = PREVIEW_HEIGHT - 10 - u * (PREVIEW_HEIGHT - 24)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 4, y - 4)
    ctx.stroke()
  }
  ctx.restore()
}

function drawNote(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save()
  ctx.fillStyle = "#f1d35a"
  ctx.fillRect(18, 14, 44, 34)
  ctx.fillStyle = "#e0bc3c"
  ctx.beginPath()
  ctx.moveTo(54, 48)
  ctx.lineTo(62, 48)
  ctx.lineTo(62, 40)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = "rgba(0,0,0,0.4)"
  for (let i = 0; i < 3; i++) ctx.fillRect(24, 22 + i * 6, 30 - i * 2, 2)
  ctx.restore()
  const pulse = 0.6 + Math.sin(t * Math.PI * 2) * 0.3
  ctx.fillStyle = `rgba(255,255,255,${pulse})`
  ctx.beginPath()
  ctx.arc(62, 12, 3, 0, Math.PI * 2)
  ctx.fill()
}

function drawCount(ctx: CanvasRenderingContext2D, t: number) {
  const dots = [
    [16, 18],
    [38, 14],
    [60, 22],
    [22, 36],
    [50, 44],
  ]
  const visible = Math.max(1, Math.floor(clamp(t / 1.5, 0, 1) * dots.length))
  ctx.save()
  ctx.fillStyle = "#ff5b5b"
  ctx.font = "bold 9px sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  for (let i = 0; i < visible; i++) {
    const [x, y] = dots[i]
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(255,91,91,0.85)"
    ctx.fill()
    ctx.fillStyle = "#ffffff"
    ctx.fillText(String(i + 1), x, y + 1)
  }
  ctx.restore()
}

function drawBucket(ctx: CanvasRenderingContext2D, t: number) {
  const fillProgress = clamp(t / 1.4, 0, 1)
  ctx.fillStyle = "#3a6df0"
  ctx.fillRect(8, 24, (PREVIEW_WIDTH - 16) * fillProgress, PREVIEW_HEIGHT - 32)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.strokeRect(8, 24, PREVIEW_WIDTH - 16, PREVIEW_HEIGHT - 32)
  // Drip
  const dropY = 8 + (t / 2) * 14
  ctx.beginPath()
  ctx.fillStyle = "#3a6df0"
  ctx.arc(40, dropY, 3, 0, Math.PI * 2)
  ctx.fill()
}

function drawHeal(ctx: CanvasRenderingContext2D, t: number) {
  // Show a blemish that fades out as the brush passes.
  const blemishAlpha = 1 - clamp(t / 1.4, 0, 1)
  ctx.fillStyle = `rgba(180,80,60,${blemishAlpha})`
  ctx.beginPath()
  ctx.arc(40, 32, 8, 0, Math.PI * 2)
  ctx.fill()
  const x = 12 + (t / 2) * (PREVIEW_WIDTH - 24)
  drawCursor(ctx, x, 32, 8)
}

function drawRedEye(ctx: CanvasRenderingContext2D, t: number) {
  const t2 = clamp(t / 1.2, 0, 1)
  ctx.fillStyle = "#ffffff"
  ctx.beginPath()
  ctx.ellipse(40, 30, 22, 12, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `rgba(${Math.round(220 - t2 * 200)}, ${Math.round(40 + t2 * 20)}, ${Math.round(40 + t2 * 20)},1)`
  ctx.beginPath()
  ctx.arc(40, 30, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#111111"
  ctx.beginPath()
  ctx.arc(40, 30, 3, 0, Math.PI * 2)
  ctx.fill()
}

function drawClone(ctx: CanvasRenderingContext2D, t: number) {
  const t2 = clamp(t / 1.5, 0, 1)
  ctx.fillStyle = "#7bd1ff"
  ctx.beginPath()
  ctx.arc(20, 20, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `rgba(123,209,255,${t2})`
  ctx.beginPath()
  ctx.arc(20 + t2 * 36, 20 + t2 * 18, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = "rgba(255,255,255,0.5)"
  ctx.setLineDash([2, 2])
  ctx.beginPath()
  ctx.moveTo(20, 20)
  ctx.lineTo(20 + t2 * 36, 20 + t2 * 18)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawHistory(ctx: CanvasRenderingContext2D, t: number) {
  const split = clamp(t / 2, 0, 1) * PREVIEW_WIDTH
  ctx.fillStyle = "#6f7882"
  ctx.fillRect(0, 0, split, PREVIEW_HEIGHT)
  ctx.fillStyle = "#e0bc3c"
  ctx.fillRect(split, 0, PREVIEW_WIDTH - split, PREVIEW_HEIGHT)
  ctx.fillStyle = "rgba(0,0,0,0.6)"
  ctx.fillRect(split - 1, 0, 2, PREVIEW_HEIGHT)
}

function drawEraser(ctx: CanvasRenderingContext2D, t: number) {
  const t2 = clamp(t / 1.5, 0, 1)
  ctx.fillStyle = "#3a6df0"
  ctx.fillRect(8, 16, PREVIEW_WIDTH - 16, PREVIEW_HEIGHT - 28)
  ctx.save()
  ctx.beginPath()
  const x = 12 + t2 * (PREVIEW_WIDTH - 24)
  ctx.arc(x, 32, 8, 0, Math.PI * 2)
  ctx.clip()
  paintBackdrop(ctx)
  ctx.restore()
  drawCursor(ctx, x, 32, 8)
}

function drawGradient(ctx: CanvasRenderingContext2D, t: number) {
  const sweep = clamp(t / 1.4, 0, 1)
  const grad = ctx.createLinearGradient(8, 0, 8 + sweep * (PREVIEW_WIDTH - 16), 0)
  grad.addColorStop(0, "#3a6df0")
  grad.addColorStop(1, "#e07b5a")
  ctx.fillStyle = grad
  ctx.fillRect(8, 18, sweep * (PREVIEW_WIDTH - 16), PREVIEW_HEIGHT - 32)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(8, PREVIEW_HEIGHT - 14)
  ctx.lineTo(8 + sweep * (PREVIEW_WIDTH - 16), PREVIEW_HEIGHT - 14)
  ctx.stroke()
}

function drawBlur(ctx: CanvasRenderingContext2D, t: number, kind: ToolPreviewKind) {
  // Detail dots that get softened (blur), sharpened, or smeared.
  const t2 = clamp(t / 1.5, 0, 1)
  const cx = 24 + t2 * 32
  for (const [x, y] of [[20, 20] as const, [40, 36] as const, [56, 24] as const]) {
    ctx.fillStyle = "#f5f5f5"
    const dist = Math.hypot(x - cx, y - 30)
    const fade = kind === "sharpen" ? clamp(1 - dist / 30, 0.4, 1) : clamp(dist / 30, 0.3, 1)
    ctx.globalAlpha = fade
    ctx.beginPath()
    ctx.arc(x, y, kind === "smudge" ? 4 : 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  drawCursor(ctx, cx, 30, 8)
}

function drawTonal(ctx: CanvasRenderingContext2D, t: number, kind: ToolPreviewKind) {
  const t2 = clamp(t / 1.5, 0, 1)
  const grad = ctx.createLinearGradient(0, 0, PREVIEW_WIDTH, 0)
  if (kind === "dodge") {
    grad.addColorStop(0, "#444")
    grad.addColorStop(1, "#eee")
  } else if (kind === "burn") {
    grad.addColorStop(0, "#888")
    grad.addColorStop(1, "#1a1a1a")
  } else {
    grad.addColorStop(0, "#6f6f6f")
    grad.addColorStop(1, "#7fc1ff")
  }
  ctx.fillStyle = grad
  ctx.fillRect(8, 18, PREVIEW_WIDTH - 16, PREVIEW_HEIGHT - 32)
  const cx = 12 + t2 * (PREVIEW_WIDTH - 24)
  drawCursor(ctx, cx, 30, 7)
}

function drawPath(ctx: CanvasRenderingContext2D, t: number, kind: ToolPreviewKind) {
  const progress = clamp(t / 1.5, 0, 1)
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.beginPath()
  const steps = 60
  for (let i = 0; i <= steps * progress; i++) {
    const u = i / steps
    const x = 8 + u * (PREVIEW_WIDTH - 16)
    const y = 30 + Math.sin(u * Math.PI * 1.4) * 14
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()
  const anchors: Array<[number, number]> = [
    [8, 44],
    [PREVIEW_WIDTH / 2, 16],
    [PREVIEW_WIDTH - 8, 44],
  ]
  for (const [x, y] of anchors) {
    ctx.fillStyle = kind === "anchor-delete" ? "#ff7b7b" : kind === "anchor-add" ? "#7bd1ff" : "#ffffff"
    ctx.fillRect(x - 2, y - 2, 4, 4)
    if (kind === "anchor-convert" || kind === "direct-select") {
      ctx.strokeStyle = "rgba(255,255,255,0.5)"
      ctx.beginPath()
      ctx.moveTo(x - 8, y - 4)
      ctx.lineTo(x + 8, y + 4)
      ctx.stroke()
    }
  }
}

function drawType(ctx: CanvasRenderingContext2D, t: number, kind: ToolPreviewKind) {
  ctx.save()
  ctx.fillStyle = kind === "type-mask" ? "rgba(255,255,255,0.85)" : "#ffffff"
  ctx.font = "bold 24px serif"
  ctx.textBaseline = "middle"
  if (kind === "type-vertical") {
    ctx.textAlign = "center"
    ctx.fillText("T", PREVIEW_WIDTH / 2, 18)
    ctx.fillText("t", PREVIEW_WIDTH / 2, 38)
  } else {
    ctx.textAlign = "left"
    ctx.fillText("Tt", 18, PREVIEW_HEIGHT / 2)
  }
  // Blinking caret.
  if (Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(kind === "type-vertical" ? PREVIEW_WIDTH / 2 + 8 : 50, PREVIEW_HEIGHT / 2 - 10, 2, 20)
  }
  if (kind === "type-mask") {
    ctx.globalCompositeOperation = "destination-over"
    ctx.fillStyle = "rgba(123,209,255,0.4)"
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  }
  ctx.restore()
}

function drawShape(ctx: CanvasRenderingContext2D, t: number, kind: ToolPreviewKind) {
  const cx = PREVIEW_WIDTH / 2
  const cy = PREVIEW_HEIGHT / 2
  const pulse = 0.85 + Math.sin(t * Math.PI * 2) * 0.1
  ctx.save()
  ctx.fillStyle = "#3a6df0"
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.translate(cx, cy)
  ctx.scale(pulse, pulse)
  ctx.beginPath()
  switch (kind) {
    case "shape-rect":
      ctx.rect(-20, -14, 40, 28)
      break
    case "shape-rounded-rect": {
      const r = 6
      ctx.moveTo(-20 + r, -14)
      ctx.arcTo(20, -14, 20, 14, r)
      ctx.arcTo(20, 14, -20, 14, r)
      ctx.arcTo(-20, 14, -20, -14, r)
      ctx.arcTo(-20, -14, 20, -14, r)
      ctx.closePath()
      break
    }
    case "shape-ellipse":
      ctx.ellipse(0, 0, 24, 14, 0, 0, Math.PI * 2)
      break
    case "shape-polygon":
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2
        const x = Math.cos(a) * 18
        const y = Math.sin(a) * 18
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      break
    case "shape-star":
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2
        const r = i % 2 === 0 ? 22 : 10
        const x = Math.cos(a) * r
        const y = Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      break
    case "shape-triangle":
      ctx.moveTo(0, -18)
      ctx.lineTo(20, 16)
      ctx.lineTo(-20, 16)
      ctx.closePath()
      break
    case "shape-line":
      ctx.moveTo(-26, 8)
      ctx.lineTo(26, -8)
      break
    case "custom-shape":
    default:
      ctx.moveTo(-18, -6)
      ctx.bezierCurveTo(-18, -22, 18, -22, 18, -6)
      ctx.bezierCurveTo(18, 12, 0, 18, 0, 22)
      ctx.bezierCurveTo(0, 18, -18, 12, -18, -6)
      ctx.closePath()
      break
  }
  if (kind === "shape-line") {
    ctx.lineWidth = 3
    ctx.strokeStyle = "#3a6df0"
    ctx.stroke()
  } else {
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

function drawHand(ctx: CanvasRenderingContext2D, t: number) {
  const dx = Math.sin(t * Math.PI) * 14
  ctx.save()
  ctx.fillStyle = "#3a6df0"
  ctx.fillRect(14 + dx, 18, 50, 26)
  ctx.strokeStyle = "#ffffff"
  ctx.strokeRect(14 + dx, 18, 50, 26)
  ctx.restore()
}

function drawRotateView(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save()
  ctx.translate(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2)
  ctx.rotate(Math.sin(t * Math.PI) * 0.4)
  ctx.fillStyle = "#3a6df0"
  ctx.fillRect(-22, -14, 44, 28)
  ctx.strokeStyle = "#ffffff"
  ctx.strokeRect(-22, -14, 44, 28)
  ctx.restore()
}

function drawZoom(ctx: CanvasRenderingContext2D, t: number) {
  const scale = 1 + Math.sin(t * Math.PI * 2) * 0.2
  ctx.save()
  ctx.translate(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(-6, -6, 12 * scale, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(2, 2)
  ctx.lineTo(14, 14)
  ctx.stroke()
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(-12, -7, 12, 2)
  ctx.fillRect(-7, -12, 2, 12)
  ctx.restore()
}

function drawTransform(ctx: CanvasRenderingContext2D, t: number) {
  const skew = Math.sin(t * Math.PI) * 0.15
  ctx.save()
  ctx.translate(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2)
  ctx.transform(1, skew, skew, 1, 0, 0)
  ctx.fillStyle = "#3a6df0"
  ctx.fillRect(-20, -14, 40, 28)
  ctx.strokeStyle = "#ffffff"
  ctx.strokeRect(-20, -14, 40, 28)
  ctx.fillStyle = "#ffffff"
  for (const [x, y] of [[-20, -14], [20, -14], [-20, 14], [20, 14]] as Array<[number, number]>) {
    ctx.fillRect(x - 2, y - 2, 4, 4)
  }
  ctx.restore()
}

function drawQuickMask(ctx: CanvasRenderingContext2D, t: number) {
  // Subject silhouette behind a translucent red mask sweep.
  ctx.save()
  ctx.fillStyle = "#888888"
  ctx.beginPath()
  ctx.ellipse(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2 + 4, 22, 18, 0, 0, Math.PI * 2)
  ctx.fill()
  const sweep = clamp(t / 1.6, 0, 1)
  ctx.fillStyle = "rgba(255,0,0,0.4)"
  ctx.fillRect(0, 0, PREVIEW_WIDTH * sweep, PREVIEW_HEIGHT)
  ctx.restore()
}

function drawMove(ctx: CanvasRenderingContext2D, t: number) {
  const dx = Math.sin(t * Math.PI) * 12
  ctx.save()
  ctx.fillStyle = "rgba(123,209,255,0.6)"
  ctx.fillRect(14, 22, 36, 22)
  ctx.fillStyle = "#7bd1ff"
  ctx.fillRect(14 + dx, 18, 36, 22)
  ctx.strokeStyle = "#ffffff"
  ctx.strokeRect(14 + dx, 18, 36, 22)
  ctx.restore()
  // Direction arrow
  ctx.strokeStyle = "#ffffff"
  ctx.beginPath()
  ctx.moveTo(14 + dx, 50)
  ctx.lineTo(14 + dx + 18, 50)
  ctx.lineTo(14 + dx + 14, 46)
  ctx.moveTo(14 + dx + 18, 50)
  ctx.lineTo(14 + dx + 14, 54)
  ctx.stroke()
}

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value
}
