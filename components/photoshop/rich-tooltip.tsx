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
import { drawToolPreviewFrame } from "@/editor/tool/preview-painters"
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "@/editor/tool/preview-primitives"

export const DEFAULT_RICH_TOOLTIP_DELAY_MS = 600

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
