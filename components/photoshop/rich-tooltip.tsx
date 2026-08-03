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
import { dispatchPhotoshopEvent } from "@/editor/events"
import type { ToolPreviewKind } from "@/editor/tool/tooltip-content"

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
      return drawEyedropper(ctx, elapsed)
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
      return drawHistory(ctx, elapsed, kind)
    case "eraser":
    case "background-eraser":
    case "magic-eraser":
      return drawEraser(ctx, elapsed)
    case "gradient":
      return drawGradient(ctx, elapsed)
    case "blur":
    case "sharpen":
    case "smudge":
      return drawBlur(ctx, elapsed, kind)
    case "dodge":
    case "burn":
    case "sponge":
      return drawTonal(ctx, elapsed, kind)
    case "pen":
    case "freeform-pen":
    case "curvature-pen":
      return drawPen(ctx, elapsed, kind)
    case "anchor-add":
    case "anchor-delete":
    case "anchor-convert":
      return drawAnchorEdit(ctx, elapsed, kind)
    case "path-select":
    case "direct-select":
      return drawPathSelect(ctx, elapsed, kind)
    case "type":
    case "type-vertical":
    case "type-mask":
      return drawType(ctx, elapsed, kind)
    case "shape-rect":
    case "shape-rounded-rect":
    case "shape-ellipse":
    case "shape-polygon":
    case "shape-star":
    case "shape-triangle":
    case "shape-line":
    case "custom-shape":
      return drawShape(ctx, elapsed, kind)
    case "hand":
      return drawHand(ctx, elapsed)
    case "rotate-view":
      return drawRotateView(ctx, elapsed)
    case "zoom":
      return drawZoom(ctx, elapsed)
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

const TAU = Math.PI * 2

function ease(u: number) {
  const c = clamp(u, 0, 1)
  return c < 0.5 ? 2 * c * c : 1 - ((-2 * c + 2) ** 2) / 2
}

/** Progress 0..1 through the `[start, end]` beat of a looping timeline. */
function beat(t: number, start: number, end: number) {
  return clamp((t - start) / (end - start), 0, 1)
}

/**
 * Stand-in artwork the pixel-editing demos operate on, so a preview can show a
 * real before/after instead of an abstract shape. `mono` paints the same scene
 * desaturated — used as the "current state" in the history brush demo.
 */
function paintPhoto(ctx: CanvasRenderingContext2D, mono = false) {
  const c = mono
    ? { skyTop: "#3d3d3d", skyBottom: "#9d9d9d", sun: "#d8d8d8", far: "#767676", near: "#4f4f4f", roof: "#8f8f8f", wall: "#c8c8c8" }
    : { skyTop: "#24548f", skyBottom: "#8fc4e8", sun: "#f5d97a", far: "#57996a", near: "#2f6b47", roof: "#e07b5a", wall: "#e8dcc8" }
  ctx.save()
  const sky = ctx.createLinearGradient(0, 0, 0, PREVIEW_HEIGHT)
  sky.addColorStop(0, c.skyTop)
  sky.addColorStop(1, c.skyBottom)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  ctx.fillStyle = c.sun
  ctx.beginPath()
  ctx.arc(58, 15, 7, 0, TAU)
  ctx.fill()
  ctx.fillStyle = c.far
  ctx.beginPath()
  ctx.moveTo(0, PREVIEW_HEIGHT)
  ctx.lineTo(0, 38)
  ctx.quadraticCurveTo(24, 22, 46, 36)
  ctx.quadraticCurveTo(64, 46, PREVIEW_WIDTH, 34)
  ctx.lineTo(PREVIEW_WIDTH, PREVIEW_HEIGHT)
  ctx.closePath()
  ctx.fill()
  // A hard-edged, saturated detail to sample, erase, blur, and dodge.
  ctx.fillStyle = c.wall
  ctx.fillRect(14, 40, 15, 12)
  ctx.fillStyle = c.roof
  ctx.beginPath()
  ctx.moveTo(10, 40)
  ctx.lineTo(21.5, 31)
  ctx.lineTo(33, 40)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = c.near
  ctx.beginPath()
  ctx.moveTo(0, PREVIEW_HEIGHT)
  ctx.lineTo(0, 50)
  ctx.quadraticCurveTo(30, 45, 52, 52)
  ctx.quadraticCurveTo(68, 56, PREVIEW_WIDTH, 50)
  ctx.lineTo(PREVIEW_WIDTH, PREVIEW_HEIGHT)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** High-frequency artwork so softening/sharpening is actually visible. */
function paintDetail(ctx: CanvasRenderingContext2D) {
  ctx.save()
  // Overdraw the bounds so a blurred copy never fades out at the canvas edge.
  ctx.fillStyle = "#cfd6e0"
  ctx.fillRect(-10, -10, PREVIEW_WIDTH + 20, PREVIEW_HEIGHT + 20)
  ctx.strokeStyle = "#39404d"
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let x = -PREVIEW_HEIGHT - 10; x < PREVIEW_WIDTH + 10; x += 9) {
    ctx.moveTo(x, -10)
    ctx.lineTo(x + PREVIEW_HEIGHT + 20, PREVIEW_HEIGHT + 10)
  }
  ctx.stroke()
  ctx.fillStyle = "#e07b5a"
  ctx.beginPath()
  ctx.arc(40, 30, 13, 0, TAU)
  ctx.fill()
  ctx.fillStyle = "#2b3140"
  ctx.beginPath()
  ctx.arc(40, 30, 5, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** The single demo stroke shared by every brush-driven preview. */
function strokePointAt(u: number, curl = 0) {
  return {
    x: 10 + u * 60,
    y: 30 + Math.sin(u * Math.PI * 1.7) * 13 + Math.sin(u * Math.PI * 9) * curl,
  }
}

/** Dab centers along the demo stroke, up to `progress` (0..1). */
function strokeTrail(progress: number, curl = 0) {
  const p = clamp(progress, 0, 1)
  const count = Math.max(1, Math.ceil(44 * p))
  const points: Array<{ x: number; y: number }> = []
  for (let i = 0; i <= count; i++) points.push(strokePointAt((i / count) * p, curl))
  return points
}

/** Union of round dabs along a trail — clip to it to confine an effect. */
function trailRegion(points: Array<{ x: number; y: number }>, radius: number) {
  const region = new Path2D()
  for (const p of points) {
    region.moveTo(p.x + radius, p.y)
    region.arc(p.x, p.y, radius, 0, TAU)
  }
  return region
}

/** Read the pixel actually on the canvas, so sampling demos show real colors. */
function samplePixel(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const m = ctx.getTransform()
  const px = clamp(Math.round(x * m.a), 0, PREVIEW_WIDTH * m.a - 1)
  const py = clamp(Math.round(y * m.d), 0, PREVIEW_HEIGHT * m.d - 1)
  try {
    const [r, g, b] = ctx.getImageData(px, py, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  } catch {
    return "#ffffff"
  }
}

function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - 7, y)
  ctx.lineTo(x - 2, y)
  ctx.moveTo(x + 2, y)
  ctx.lineTo(x + 7, y)
  ctx.moveTo(x, y - 7)
  ctx.lineTo(x, y - 2)
  ctx.moveTo(x, y + 2)
  ctx.lineTo(x, y + 7)
  ctx.stroke()
  ctx.restore()
}

/** Photoshop's black (whole path) and white (single anchor) arrow cursors. */
function drawArrowCursor(ctx: CanvasRenderingContext2D, x: number, y: number, solid: boolean) {
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x, y + 11)
  ctx.lineTo(x + 3, y + 8.4)
  ctx.lineTo(x + 5, y + 12.6)
  ctx.lineTo(x + 7.2, y + 11.6)
  ctx.lineTo(x + 5.2, y + 7.5)
  ctx.lineTo(x + 8.4, y + 7.2)
  ctx.closePath()
  ctx.fillStyle = solid ? "#111111" : "#ffffff"
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = solid ? "#ffffff" : "#111111"
  ctx.stroke()
  ctx.restore()
}

/** Expanding ring marking the instant of a click. */
function drawRipple(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number) {
  if (progress <= 0 || progress >= 1) return
  ctx.save()
  ctx.globalAlpha = 1 - progress
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, 4 + progress * 12, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

/** Small dark chip with a readout (zoom level, view angle, …). */
function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.save()
  ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif"
  ctx.textBaseline = "middle"
  ctx.textAlign = "left"
  const width = ctx.measureText(label).width + 7
  ctx.fillStyle = "rgba(0,0,0,0.62)"
  ctx.beginPath()
  ctx.roundRect(x, y, width, 11, 2)
  ctx.fill()
  ctx.fillStyle = "#ffffff"
  ctx.fillText(label, x + 3.5, y + 6)
  ctx.restore()
}

/** `light` paints Photoshop's high-contrast transparency checker. */
function paintBackdrop(ctx: CanvasRenderingContext2D, light = false) {
  ctx.fillStyle = light ? "#ffffff" : "#2a2a2a"
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  paintCheckerTiles(ctx, light)
}

/**
 * The dark squares only. Split out so `destination-over` fills can lay the
 * tiles down first and let the base color land in the gaps behind them.
 */
function paintCheckerTiles(ctx: CanvasRenderingContext2D, light: boolean) {
  ctx.fillStyle = light ? "#a6a6a6" : "#333333"
  const tile = light ? 6 : 8
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

const EYEDROPPER_STOPS: Array<[number, number]> = [
  [16, 12], // sky
  [58, 15], // sun
  [21, 36], // roof
]

/**
 * Move over the artwork, click, and the foreground swatch takes the pixel
 * underneath. The ring shows the live pixel on top and the current foreground
 * on the bottom — the same split ring Photoshop draws while sampling.
 */
function drawEyedropper(ctx: CanvasRenderingContext2D, elapsed: number) {
  const dwell = 1.7
  const t = elapsed % (dwell * EYEDROPPER_STOPS.length)
  const index = Math.floor(t / dwell)
  const local = t - index * dwell
  const from = EYEDROPPER_STOPS[(index + EYEDROPPER_STOPS.length - 1) % EYEDROPPER_STOPS.length]
  const to = EYEDROPPER_STOPS[index]
  const travel = ease(beat(local, 0, 0.6))
  const x = from[0] + (to[0] - from[0]) * travel
  const y = from[1] + (to[1] - from[1]) * travel
  const picked = local >= 0.72

  paintPhoto(ctx)
  const live = samplePixel(ctx, x, y)
  const foreground = samplePixel(ctx, ...(picked ? to : from))

  // Split sampling ring: live pixel above, current foreground below.
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, 10, Math.PI, 0)
  ctx.arc(x, y, 6, 0, Math.PI, true)
  ctx.closePath()
  ctx.fillStyle = live
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, 10, 0, Math.PI)
  ctx.arc(x, y, 6, Math.PI, 0, true)
  ctx.closePath()
  ctx.fillStyle = foreground
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = "rgba(0,0,0,0.55)"
  ctx.beginPath()
  ctx.arc(x, y, 10.5, 0, TAU)
  ctx.stroke()
  ctx.strokeStyle = "#ffffff"
  ctx.beginPath()
  ctx.arc(x, y, 6, 0, TAU)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - 2.5, y)
  ctx.lineTo(x + 2.5, y)
  ctx.moveTo(x, y - 2.5)
  ctx.lineTo(x, y + 2.5)
  ctx.stroke()
  ctx.restore()

  drawRipple(ctx, to[0], to[1], beat(local, 0.66, 1.06))

  // Foreground / background swatches — the foreground flips on the click.
  ctx.save()
  ctx.fillStyle = "#e8e8e8"
  ctx.fillRect(58, 45, 13, 13)
  ctx.fillStyle = foreground
  ctx.fillRect(52, 39, 13, 13)
  ctx.strokeStyle = "rgba(255,255,255,0.85)"
  ctx.lineWidth = 1
  ctx.strokeRect(58.5, 45.5, 12, 12)
  ctx.strokeRect(52.5, 39.5, 12, 12)
  ctx.restore()
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

/**
 * The document is sitting in a desaturated state; brushing paints the earlier
 * (color) history state back in, only where the stroke lands.
 */
function drawHistory(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.8
  const progress = beat(t, 0.55, 2.4)
  const fade = 1 - beat(t, 3.4, 3.8)
  paintPhoto(ctx, true)
  if (progress > 0) {
    const points = strokeTrail(progress, kind === "art-history" ? 3 : 0)
    ctx.save()
    ctx.globalAlpha = fade
    ctx.clip(trailRegion(points, 9))
    paintPhoto(ctx)
    ctx.restore()
    if (t < 2.5) {
      const head = points[points.length - 1]
      drawCursor(ctx, head.x, head.y, 9)
    }
  }
  drawHistorySourceBadge(ctx)
}

/** "Painting from this saved state" chip shown by the history brush demo. */
function drawHistorySourceBadge(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.fillStyle = "rgba(0,0,0,0.58)"
  ctx.beginPath()
  ctx.roundRect(3, 3, 28, 14, 3)
  ctx.fill()
  ctx.strokeStyle = "#7bd1ff"
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(11, 10, 4.2, Math.PI * 0.42, Math.PI * 1.85)
  ctx.stroke()
  ctx.fillStyle = "#7bd1ff"
  ctx.beginPath()
  ctx.moveTo(13.6, 13.8)
  ctx.lineTo(14.4, 9.6)
  ctx.lineTo(10.3, 11)
  ctx.closePath()
  ctx.fill()
  // Thumbnail of the state being restored.
  ctx.fillStyle = "#2f6b47"
  ctx.fillRect(19, 6, 9, 8)
  ctx.fillStyle = "#e07b5a"
  ctx.fillRect(19, 6, 9, 3)
  ctx.strokeStyle = "rgba(255,255,255,0.7)"
  ctx.lineWidth = 1
  ctx.strokeRect(19.5, 6.5, 8, 7)
  ctx.restore()
}

/** Pixels are removed along the stroke, exposing transparency underneath. */
function drawEraser(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 3.4
  const progress = beat(t, 0.35, 2.1)
  paintPhoto(ctx)
  if (progress > 0) {
    const points = strokeTrail(progress)
    ctx.save()
    ctx.globalCompositeOperation = "destination-out"
    for (const p of points) {
      const dab = ctx.createRadialGradient(p.x, p.y, 6.5, p.x, p.y, 9)
      dab.addColorStop(0, "rgba(0,0,0,1)")
      dab.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = dab
      ctx.fillRect(p.x - 9, p.y - 9, 18, 18)
    }
    ctx.restore()
  }
  // Refill what was erased with the transparency checker.
  ctx.save()
  ctx.globalCompositeOperation = "destination-over"
  paintCheckerTiles(ctx, true)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  ctx.restore()
  if (progress > 0 && t < 2.2) {
    const head = strokePointAt(progress)
    drawCursor(ctx, head.x, head.y, 9)
  }
}

/** Drag sets the ramp axis; the whole layer fills along it, live. */
function drawGradient(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 3.6
  const p = ease(beat(t, 0.4, 1.9))
  const guide = 1 - beat(t, 2.1, 2.5)
  const x0 = 14
  const y0 = 46
  const hx = x0 + (66 - x0) * p
  const hy = y0 + (16 - y0) * p

  ctx.save()
  ctx.beginPath()
  ctx.rect(6, 8, 68, 44)
  ctx.clip()
  ctx.fillStyle = "#3b4048"
  ctx.fillRect(6, 8, 68, 44)
  if (p > 0.02) {
    const ramp = ctx.createLinearGradient(x0, y0, hx, hy)
    ramp.addColorStop(0, "#3a6df0")
    ramp.addColorStop(1, "#f5d97a")
    ctx.fillStyle = ramp
    ctx.fillRect(6, 8, 68, 44)
  }
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = "rgba(255,255,255,0.55)"
  ctx.lineWidth = 1
  ctx.strokeRect(6.5, 8.5, 67, 43)
  ctx.restore()

  if (guide > 0) {
    ctx.save()
    ctx.globalAlpha = guide
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(hx, hy)
    ctx.stroke()
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(x0 - 2, y0 - 2, 4, 4)
    drawCrosshair(ctx, hx, hy)
    ctx.restore()
  }
}

/** Only the brushed band is softened, sharpened, or pushed along the stroke. */
function drawBlur(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.4
  const progress = beat(t, 0.35, 2.1)
  const startsSoft = kind === "sharpen"

  ctx.save()
  if (startsSoft) ctx.filter = "blur(1.8px)"
  paintDetail(ctx)
  ctx.restore()

  if (progress > 0) {
    const points = strokeTrail(progress)
    ctx.save()
    ctx.clip(trailRegion(points, 10))
    if (kind === "smudge") {
      // Smear: stamp the artwork repeatedly along the stroke direction.
      for (let i = 0; i < 6; i++) {
        ctx.save()
        ctx.globalAlpha = i === 0 ? 1 : 0.32
        ctx.translate(i * 2.6, 0)
        paintDetail(ctx)
        ctx.restore()
      }
    } else {
      if (!startsSoft) ctx.filter = "blur(2.4px)"
      paintDetail(ctx)
    }
    ctx.restore()
    if (t < 2.2) {
      const head = strokePointAt(progress)
      drawCursor(ctx, head.x, head.y, 10)
    }
  }
}

/** Brushing lightens (dodge), darkens (burn), or drains color (sponge). */
function drawTonal(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.4
  const progress = beat(t, 0.35, 2.1)
  paintPhoto(ctx)
  if (progress > 0) {
    const points = strokeTrail(progress)
    ctx.save()
    ctx.clip(trailRegion(points, 10))
    if (kind === "dodge") {
      // color-dodge / color-burn shift tone while keeping the hue, like the tools do.
      ctx.globalCompositeOperation = "color-dodge"
      ctx.fillStyle = "rgb(64,64,64)"
    } else if (kind === "burn") {
      ctx.globalCompositeOperation = "color-burn"
      ctx.fillStyle = "rgb(205,205,205)"
    } else {
      ctx.globalCompositeOperation = "saturation"
      ctx.fillStyle = "rgb(128,128,128)"
    }
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    ctx.restore()
    if (t < 2.2) {
      const head = strokePointAt(progress)
      drawCursor(ctx, head.x, head.y, 10)
    }
  }
}

const PEN_A = { x: 11, y: 46 }
const PEN_B = { x: 40, y: 19 }
const PEN_C = { x: 69, y: 44 }
const PEN_HB = { x: 18, y: 0 }
const PEN_HC = { x: 14, y: 12 }

function lerpPoint(a: { x: number; y: number }, b: { x: number; y: number }, u: number) {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
}

function drawAnchor(ctx: CanvasRenderingContext2D, x: number, y: number, selected = true) {
  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = "#111111"
  ctx.fillStyle = selected ? "#ffffff" : "rgba(255,255,255,0.25)"
  ctx.fillRect(x - 2.5, y - 2.5, 5, 5)
  ctx.strokeRect(x - 2.5, y - 2.5, 5, 5)
  ctx.restore()
}

/** Direction handle: bar through the anchor with a round knob at each live end. */
function drawHandles(
  ctx: CanvasRenderingContext2D,
  anchor: { x: number; y: number },
  vector: { x: number; y: number },
  grow: number,
  mirrored: boolean,
) {
  if (grow <= 0.01) return
  const out = { x: anchor.x + vector.x * grow, y: anchor.y + vector.y * grow }
  const back = { x: anchor.x - vector.x * grow, y: anchor.y - vector.y * grow }
  ctx.save()
  ctx.strokeStyle = "rgba(123,209,255,0.9)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(mirrored ? back.x : anchor.x, mirrored ? back.y : anchor.y)
  ctx.lineTo(out.x, out.y)
  ctx.stroke()
  ctx.fillStyle = "#7bd1ff"
  for (const knob of mirrored ? [out, back] : [out]) {
    ctx.beginPath()
    ctx.arc(knob.x, knob.y, 2.2, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

function drawPenCursor(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(4.5, 7)
  ctx.lineTo(8, 3.5)
  ctx.closePath()
  ctx.fillStyle = "#ffffff"
  ctx.fill()
  ctx.strokeStyle = "#111111"
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(5.5, 5)
  ctx.lineTo(11, 10.5)
  ctx.stroke()
  ctx.restore()
}

/**
 * Click to drop an anchor, drag to pull out direction handles and bend the
 * segment — the actual construction loop of the pen tool.
 */
function drawPen(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 4.8
  const freeform = kind === "freeform-pen"
  const curvature = kind === "curvature-pen"

  // Beat table per variant: when each anchor lands and how far its handle pulls.
  const hasB = freeform ? beat(t, 0.5, 2.1) >= 1 : t > 1.15
  const hasC = freeform ? beat(t, 0.5, 2.1) >= 1 : t > 2.55
  const growB = curvature ? ease(beat(t, 2.55, 3.2)) : freeform ? 1 : ease(beat(t, 1.2, 1.85))
  const growC = curvature ? ease(beat(t, 2.55, 3.2)) : freeform ? 1 : ease(beat(t, 2.6, 3.2))
  const trace = freeform ? beat(t, 0.5, 2.1) : 1

  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(PEN_A.x, PEN_A.y)
  if (freeform) {
    // Freehand: the path is dragged out in one continuous motion.
    const steps = Math.max(1, Math.round(48 * trace))
    for (let i = 1; i <= steps; i++) {
      const p = penPointAt((i / steps) * trace, growB, growC)
      ctx.lineTo(p.x, p.y)
    }
  } else {
    if (hasB) ctx.bezierCurveTo(PEN_A.x, PEN_A.y, PEN_B.x - PEN_HB.x * growB, PEN_B.y - PEN_HB.y * growB, PEN_B.x, PEN_B.y)
    if (hasC) {
      ctx.bezierCurveTo(
        PEN_B.x + PEN_HB.x * growB,
        PEN_B.y + PEN_HB.y * growB,
        PEN_C.x - PEN_HC.x * growC,
        PEN_C.y - PEN_HC.y * growC,
        PEN_C.x,
        PEN_C.y,
      )
    }
  }
  ctx.stroke()
  ctx.restore()

  if (!freeform) {
    drawHandles(ctx, PEN_B, PEN_HB, growB, true)
    // Only the incoming handle at the final anchor — the outgoing one is off-canvas.
    drawHandles(ctx, PEN_C, { x: -PEN_HC.x, y: -PEN_HC.y }, growC, false)
  }

  if (freeform ? trace > 0 : t > 0.55) drawAnchor(ctx, PEN_A.x, PEN_A.y)
  if (hasB) drawAnchor(ctx, PEN_B.x, PEN_B.y)
  if (hasC) drawAnchor(ctx, PEN_C.x, PEN_C.y)

  // Cursor: travels between clicks, then rides the handle while dragging.
  let cursor = PEN_A
  if (freeform) {
    cursor = penPointAt(trace, 1, 1)
  } else if (t < 0.55) {
    cursor = lerpPoint({ x: 4, y: 30 }, PEN_A, ease(beat(t, 0, 0.5)))
  } else if (t < 1.15) {
    cursor = lerpPoint(PEN_A, PEN_B, ease(beat(t, 0.7, 1.15)))
  } else if (t < 2.0) {
    cursor = { x: PEN_B.x + PEN_HB.x * growB, y: PEN_B.y + PEN_HB.y * growB }
  } else if (t < 2.55) {
    cursor = lerpPoint({ x: PEN_B.x + PEN_HB.x, y: PEN_B.y + PEN_HB.y }, PEN_C, ease(beat(t, 2.05, 2.55)))
  } else if (t < 3.4) {
    cursor = { x: PEN_C.x - PEN_HC.x * growC, y: PEN_C.y - PEN_HC.y * growC }
  } else {
    cursor = PEN_C
  }
  drawPenCursor(ctx, cursor.x, cursor.y)
}

/** Point at parameter `u` (0..1) along the two-segment demo path. */
function penPointAt(u: number, growB: number, growC: number) {
  const p = clamp(u, 0, 1)
  if (p <= 0.5) {
    return cubicAt(
      PEN_A,
      PEN_A,
      { x: PEN_B.x - PEN_HB.x * growB, y: PEN_B.y - PEN_HB.y * growB },
      PEN_B,
      p / 0.5,
    )
  }
  return cubicAt(
    PEN_B,
    { x: PEN_B.x + PEN_HB.x * growB, y: PEN_B.y + PEN_HB.y * growB },
    { x: PEN_C.x - PEN_HC.x * growC, y: PEN_C.y - PEN_HC.y * growC },
    PEN_C,
    (p - 0.5) / 0.5,
  )
}

function cubicAt(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  u: number,
) {
  const v = 1 - u
  const a = v * v * v
  const b = 3 * v * v * u
  const c = 3 * v * u * u
  const d = u * u * u
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/** Add, delete, or convert a single anchor on a finished path. */
function drawAnchorEdit(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.6
  const acted = t > 1.5
  const settle = ease(beat(t, 1.5, 2.1))
  // convert: the middle anchor's handles retract, turning a smooth point into a corner.
  const growB = kind === "anchor-convert" ? 1 - settle : 1
  const keepB = kind === "anchor-delete" ? !acted : true
  const midpoint = cubicAt(
    PEN_B,
    { x: PEN_B.x + PEN_HB.x, y: PEN_B.y + PEN_HB.y },
    { x: PEN_C.x - PEN_HC.x, y: PEN_C.y - PEN_HC.y },
    PEN_C,
    0.5,
  )

  ctx.save()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(PEN_A.x, PEN_A.y)
  if (keepB) {
    ctx.bezierCurveTo(PEN_A.x, PEN_A.y, PEN_B.x - PEN_HB.x * growB, PEN_B.y - PEN_HB.y * growB, PEN_B.x, PEN_B.y)
    ctx.bezierCurveTo(
      PEN_B.x + PEN_HB.x * growB,
      PEN_B.y + PEN_HB.y * growB,
      PEN_C.x - PEN_HC.x,
      PEN_C.y - PEN_HC.y,
      PEN_C.x,
      PEN_C.y,
    )
  } else {
    // With the middle anchor gone the two segments collapse into one.
    ctx.bezierCurveTo(PEN_A.x + 6, PEN_A.y - 10, PEN_C.x - PEN_HC.x, PEN_C.y - PEN_HC.y, PEN_C.x, PEN_C.y)
  }
  ctx.stroke()
  ctx.restore()

  if (keepB) drawHandles(ctx, PEN_B, PEN_HB, growB, true)
  drawHandles(ctx, PEN_C, { x: -PEN_HC.x, y: -PEN_HC.y }, 1, false)
  drawAnchor(ctx, PEN_A.x, PEN_A.y, false)
  drawAnchor(ctx, PEN_C.x, PEN_C.y, false)
  if (keepB) drawAnchor(ctx, PEN_B.x, PEN_B.y, kind !== "anchor-add")
  if (kind === "anchor-add" && acted) drawAnchor(ctx, midpoint.x, midpoint.y)

  const target = kind === "anchor-add" ? midpoint : PEN_B
  const cursor = lerpPoint({ x: 6, y: 14 }, target, ease(beat(t, 0.2, 1.3)))
  drawRipple(ctx, target.x, target.y, beat(t, 1.45, 1.9))
  drawPenCursor(ctx, cursor.x, cursor.y)

  // Badge the mode so add / delete / convert stay distinguishable.
  const glyph = kind === "anchor-add" ? "+" : kind === "anchor-delete" ? "−" : "⌃"
  ctx.save()
  ctx.fillStyle = kind === "anchor-delete" ? "#ff7b7b" : "#7bd1ff"
  ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(glyph, cursor.x + 12, cursor.y + 3)
  ctx.restore()
}

const PATH_NODES = [
  { x: 40, y: 17 },
  { x: 64, y: 33 },
  { x: 40, y: 50 },
  { x: 16, y: 33 },
]

/** Closed Catmull-Rom curve through `points`, as a reusable Path2D. */
function smoothClosedPath(points: Array<{ x: number; y: number }>) {
  const path = new Path2D()
  const n = points.length
  path.moveTo(points[0].x, points[0].y)
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    path.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    )
  }
  path.closePath()
  return path
}

/**
 * Black arrow moves the whole path; white arrow drags one anchor and reshapes
 * the curve around it.
 */
function drawPathSelect(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.8
  const shift = ease(beat(t, 0.55, 1.6)) - ease(beat(t, 2.7, 3.7))
  const whole = kind === "path-select"
  const dx = shift * (whole ? 13 : 5)
  const dy = shift * (whole ? -8 : -9)
  const nodes = PATH_NODES.map((p, i) => (whole || i === 0 ? { x: p.x + dx, y: p.y + dy } : { ...p }))
  const path = smoothClosedPath(nodes)

  if (Math.abs(shift) > 0.03) {
    ctx.save()
    ctx.setLineDash([2, 2])
    ctx.strokeStyle = "rgba(255,255,255,0.3)"
    ctx.lineWidth = 1
    ctx.stroke(smoothClosedPath(PATH_NODES))
    ctx.restore()
  }

  ctx.save()
  ctx.fillStyle = "rgba(58,109,240,0.3)"
  ctx.fill(path)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1.5
  ctx.stroke(path)
  ctx.restore()

  if (!whole) {
    const anchor = nodes[0]
    drawHandles(
      ctx,
      anchor,
      { x: (nodes[1].x - nodes[3].x) / 3, y: (nodes[1].y - nodes[3].y) / 3 },
      1,
      true,
    )
  }
  nodes.forEach((p, i) => drawAnchor(ctx, p.x, p.y, whole || i === 0))

  const grip = whole ? { x: nodes[1].x - 2, y: nodes[1].y - 2 } : nodes[0]
  drawArrowCursor(ctx, grip.x, grip.y, whole)
}

/** Click to set an insertion point, type, then double-click to select a word. */
function drawType(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 5.2
  const word = "Type"
  const vertical = kind === "type-vertical"
  const mask = kind === "type-mask"
  const typed = word.slice(0, Math.floor(beat(t, 0.8, 2.5) * word.length))
  const selecting = t > 3.5 && t < 4.7
  const caretOn = t > 0.7 && t < 3.5 && Math.floor(t * 2.4) % 2 === 0
  const boxAlpha = beat(t, 0.55, 0.8)
  const font = vertical ? 'bold 13px Georgia, "Times New Roman", serif' : 'bold 20px Georgia, "Times New Roman", serif'
  const originX = vertical ? PREVIEW_WIDTH / 2 : 15
  const baseline = 36

  if (mask) paintPhoto(ctx)

  if (boxAlpha > 0) {
    ctx.save()
    ctx.globalAlpha = boxAlpha * 0.75
    ctx.setLineDash([3, 2])
    ctx.strokeStyle = "rgba(255,255,255,0.65)"
    ctx.lineWidth = 1
    ctx.strokeRect(8.5, vertical ? 6.5 : 14.5, 63, vertical ? 47 : 30)
    ctx.restore()
  }

  ctx.save()
  ctx.font = font
  ctx.textBaseline = vertical ? "middle" : "alphabetic"
  ctx.textAlign = vertical ? "center" : "left"
  const width = vertical ? 0 : ctx.measureText(typed).width

  if (selecting && typed) {
    ctx.fillStyle = "#2f6fd0"
    if (vertical) ctx.fillRect(originX - 9, 10, 18, typed.length * 13)
    else ctx.fillRect(originX - 1, baseline - 16, width + 2, 21)
  }

  if (mask) {
    // Type mask cuts the letters out of a rubylith overlay — the text is a selection.
    ctx.fillStyle = "rgba(220,40,40,0.5)"
    ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
    ctx.globalCompositeOperation = "destination-out"
  }
  ctx.fillStyle = "#ffffff"
  if (vertical) {
    for (let i = 0; i < typed.length; i++) ctx.fillText(typed[i], originX, 17 + i * 13)
  } else {
    ctx.fillText(typed, originX, baseline)
  }
  if (mask) {
    // Put the artwork back inside the letters — they are a window, not a hole.
    ctx.globalCompositeOperation = "destination-over"
    paintPhoto(ctx)
  }
  ctx.restore()

  if (mask && typed) {
    ctx.save()
    ctx.font = font
    ctx.textBaseline = vertical ? "middle" : "alphabetic"
    ctx.textAlign = vertical ? "center" : "left"
    ctx.strokeStyle = "rgba(255,255,255,0.9)"
    ctx.lineWidth = 0.7
    ctx.setLineDash([2, 2])
    if (vertical) {
      for (let i = 0; i < typed.length; i++) ctx.strokeText(typed[i], originX, 17 + i * 13)
    } else {
      ctx.strokeText(typed, originX, baseline)
    }
    ctx.restore()
  }

  if (caretOn) {
    ctx.fillStyle = "#ffffff"
    if (vertical) ctx.fillRect(originX - 7, 11 + typed.length * 13, 14, 2)
    else ctx.fillRect(originX + width + 1, baseline - 16, 1.5, 20)
  }

  // I-beam travels in and clicks to place the insertion point.
  if (t < 0.9) {
    const p = ease(beat(t, 0, 0.55))
    const ix = 4 + (originX - 4) * p
    const iy = 46 - 16 * p
    ctx.save()
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(ix, iy - 6)
    ctx.lineTo(ix, iy + 6)
    ctx.moveTo(ix - 3, iy - 6)
    ctx.lineTo(ix + 3, iy - 6)
    ctx.moveTo(ix - 3, iy + 6)
    ctx.lineTo(ix + 3, iy + 6)
    ctx.stroke()
    ctx.restore()
    drawRipple(ctx, originX, baseline - 6, beat(t, 0.55, 0.95))
  }
}

/** Shape geometry fitted to the box the pointer has dragged out. */
function shapePath(kind: ToolPreviewKind, x: number, y: number, w: number, h: number) {
  const path = new Path2D()
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = w / 2
  const ry = h / 2
  switch (kind) {
    case "shape-rounded-rect":
      path.roundRect(x, y, w, h, Math.max(0, Math.min(8, w / 3, h / 3)))
      break
    case "shape-ellipse":
      path.ellipse(cx, cy, rx, ry, 0, 0, TAU)
      break
    case "shape-polygon":
    case "shape-star": {
      const corners = kind === "shape-star" ? 10 : 6
      for (let i = 0; i < corners; i++) {
        const a = (i / corners) * TAU - Math.PI / 2
        const k = kind === "shape-star" && i % 2 ? 0.45 : 1
        const px = cx + Math.cos(a) * rx * k
        const py = cy + Math.sin(a) * ry * k
        if (i === 0) path.moveTo(px, py)
        else path.lineTo(px, py)
      }
      path.closePath()
      break
    }
    case "shape-triangle":
      path.moveTo(cx, y)
      path.lineTo(x + w, y + h)
      path.lineTo(x, y + h)
      path.closePath()
      break
    case "shape-line":
      path.moveTo(x, y + h)
      path.lineTo(x + w, y)
      break
    case "custom-shape": {
      const mx = (u: number) => x + u * w
      const my = (v: number) => y + v * h
      path.moveTo(mx(0.5), my(0.96))
      path.bezierCurveTo(mx(0.02), my(0.46), mx(0.14), my(0.02), mx(0.5), my(0.28))
      path.bezierCurveTo(mx(0.86), my(0.02), mx(0.98), my(0.46), mx(0.5), my(0.96))
      path.closePath()
      break
    }
    default:
      path.rect(x, y, w, h)
      break
  }
  return path
}

/** Drag from one corner to the other; the shape is previewed live, then set. */
function drawShape(ctx: CanvasRenderingContext2D, elapsed: number, kind: ToolPreviewKind) {
  const t = elapsed % 3.6
  const p = ease(beat(t, 0.35, 1.6))
  const dragging = t < 1.75
  const x = 11
  const y = 10
  const w = 58 * p
  const h = 40 * p
  if (p <= 0.01) {
    drawCrosshair(ctx, x, y)
    return
  }

  const path = shapePath(kind, x, y, w, h)
  ctx.save()
  if (kind === "shape-line") {
    ctx.strokeStyle = "#3a6df0"
    ctx.lineWidth = 3
    ctx.lineCap = "round"
    ctx.stroke(path)
  } else {
    ctx.fillStyle = "#3a6df0"
    ctx.fill(path)
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 1
    ctx.stroke(path)
  }
  ctx.restore()

  if (dragging) {
    ctx.save()
    ctx.setLineDash([3, 2])
    ctx.strokeStyle = "rgba(255,255,255,0.55)"
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w, h)
    ctx.restore()
    drawCrosshair(ctx, x + w, y + h)
    drawBadge(ctx, 4, PREVIEW_HEIGHT - 14, `${Math.round(w)}×${Math.round(h)}`)
  } else {
    ctx.save()
    ctx.fillStyle = "#ffffff"
    ctx.strokeStyle = "#111111"
    ctx.lineWidth = 1
    for (const [hx, hy] of [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ]) {
      ctx.fillRect(hx - 2.5, hy - 2.5, 5, 5)
      ctx.strokeRect(hx - 2.5, hy - 2.5, 5, 5)
    }
    ctx.restore()
  }
}

const VIEWPORT = { x: 7, y: 7, w: 66, h: 46 }

/** Run `paint` clipped to the document window, over a dark app background. */
function withViewport(ctx: CanvasRenderingContext2D, paint: () => void) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(VIEWPORT.x, VIEWPORT.y, VIEWPORT.w, VIEWPORT.h)
  ctx.clip()
  ctx.fillStyle = "#1d1f22"
  ctx.fillRect(VIEWPORT.x, VIEWPORT.y, VIEWPORT.w, VIEWPORT.h)
  paint()
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = "rgba(255,255,255,0.75)"
  ctx.lineWidth = 1
  ctx.strokeRect(VIEWPORT.x + 0.5, VIEWPORT.y + 0.5, VIEWPORT.w - 1, VIEWPORT.h - 1)
  ctx.restore()
}

function drawHandCursor(ctx: CanvasRenderingContext2D, x: number, y: number, grabbing: boolean) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = "#ffffff"
  ctx.strokeStyle = "#111111"
  ctx.lineWidth = 1
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.roundRect(-4 + i * 3.4, grabbing ? -5 : -9, 3, grabbing ? 6 : 10, 1.5)
    ctx.fill()
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.roundRect(-8, -1, 4.5, 6, 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.roundRect(-5, -2, 11, 10, 3)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** Grab the image and push it around inside a window that stays put. */
function drawHand(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 3.8
  const pan = ease(beat(t, 0.5, 1.7)) - ease(beat(t, 2.6, 3.7))
  const dx = pan * 17
  const dy = pan * -10
  withViewport(ctx, () => {
    ctx.translate(dx, dy)
    ctx.translate(40, 30)
    ctx.scale(1.5, 1.5)
    ctx.translate(-40, -30)
    paintPhoto(ctx)
  })
  drawHandCursor(ctx, 36 + dx, 32 + dy, t > 0.4 && t < 3.7)
}

/** The window stays square while the document itself is spun under it. */
function drawRotateView(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 4.4
  const angle = (ease(beat(t, 0.4, 1.9)) - ease(beat(t, 3.0, 4.3))) * -0.52
  withViewport(ctx, () => {
    ctx.translate(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2)
    ctx.rotate(angle)
    ctx.scale(0.74, 0.74)
    ctx.translate(-PREVIEW_WIDTH / 2, -PREVIEW_HEIGHT / 2)
    paintPhoto(ctx)
    ctx.strokeStyle = "rgba(255,255,255,0.9)"
    ctx.lineWidth = 1.6
    ctx.strokeRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  })

  // Compass: north tips with the view, so the rotation reads as a view change.
  ctx.save()
  ctx.translate(62, 42)
  ctx.fillStyle = "rgba(0,0,0,0.55)"
  ctx.beginPath()
  ctx.arc(0, 0, 8.5, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = "rgba(255,255,255,0.5)"
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, -6.5)
  ctx.lineTo(3, 1)
  ctx.lineTo(-3, 1)
  ctx.closePath()
  ctx.fillStyle = "#ff6b5b"
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(0, 6.5)
  ctx.lineTo(3, 1)
  ctx.lineTo(-3, 1)
  ctx.closePath()
  ctx.fillStyle = "#e8e8e8"
  ctx.fill()
  ctx.restore()

  drawBadge(ctx, 4, PREVIEW_HEIGHT - 14, `${Math.round((angle * 180) / Math.PI)}°`)
}

/** Click to magnify around the pointer; pixels grow, the window does not. */
function drawZoom(ctx: CanvasRenderingContext2D, elapsed: number) {
  const t = elapsed % 4.4
  const scale = 1 + (ease(beat(t, 0.6, 2.0)) - ease(beat(t, 3.1, 4.3))) * 1.5
  const focus = { x: 22, y: 38 }
  withViewport(ctx, () => {
    ctx.translate(focus.x, focus.y)
    ctx.scale(scale, scale)
    ctx.translate(-focus.x, -focus.y)
    paintPhoto(ctx)
  })
  drawRipple(ctx, focus.x, focus.y, beat(t, 0.5, 1.0))

  // Magnifier cursor with the zoom-in plus.
  ctx.save()
  ctx.translate(focus.x, focus.y)
  ctx.lineWidth = 2.5
  ctx.strokeStyle = "#111111"
  ctx.beginPath()
  ctx.arc(0, 0, 7, 0, TAU)
  ctx.moveTo(5, 5)
  ctx.lineTo(11, 11)
  ctx.stroke()
  ctx.lineWidth = 1.4
  ctx.strokeStyle = "#ffffff"
  ctx.beginPath()
  ctx.arc(0, 0, 7, 0, TAU)
  ctx.moveTo(5, 5)
  ctx.lineTo(11, 11)
  ctx.moveTo(-3.2, 0)
  ctx.lineTo(3.2, 0)
  ctx.moveTo(0, -3.2)
  ctx.lineTo(0, 3.2)
  ctx.stroke()
  ctx.restore()

  drawBadge(ctx, 4, PREVIEW_HEIGHT - 14, `${Math.round(scale * 100)}%`)
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
