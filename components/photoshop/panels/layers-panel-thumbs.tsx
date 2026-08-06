"use client"

/**
 * Leaf components for the Layers panel rows: the thumbnails, the layer-kind
 * icon, and the small toolbar button.
 *
 * The thumbnails subscribe to render changes individually so a paint on one
 * layer repaints one thumbnail rather than the whole panel.
 */

import * as React from "react"
import { useRenderSubscription } from "@/components/photoshop/editor/context"
import { FILTER_META } from "@/editor/filters-meta"
import {
  Type as TypeIcon,
  Square as SquareIcon,
  Image as ImageIcon,
  CornerDownRight,
  Folder,
  FolderOpen,
  PenTool,
  Palette,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Layer, LayerKind } from "@/editor/types"
import type { MergedRenderChange } from "@/editor/render-bus"
import { maskCoverageState } from "@/editor/document/mask-state"

export function PanelBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "w-7 h-7 rounded-sm flex items-center justify-center hover:bg-[var(--ps-tool-hover)]",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent",
      )}
    >
      {children}
    </button>
  )
}

export function KindIcon({ kind }: { kind: LayerKind }) {
  const cls = "w-2.5 h-2.5 text-[var(--ps-text-dim)] shrink-0"
  if (kind === "text") return <TypeIcon className={cls} aria-label="Text" />
  if (kind === "shape") return <SquareIcon className={cls} aria-label="Shape" />
  if (kind === "adjustment") return <Palette className={cls} aria-label="Adjustment" />
  if (kind === "frame") return <ImageIcon className={cls} aria-label="Frame" />
  if (kind === "artboard") return <SquareIcon className={cls} aria-label="Artboard" />
  if (kind === "raster") return <PenTool className={cls} aria-label="Pixel" />
  return null
}

export function AdjustmentThumb({ layer }: { layer: Layer }) {
  const label = layer.adjustment ? FILTER_META[layer.adjustment.type]?.name ?? layer.adjustment.type : "Adjustment"
  return (
    <div
      data-testid={`adjustment-thumb-${layer.name}`}
      title={`${label} adjustment`}
      aria-label={`${label} adjustment thumbnail`}
      className="flex h-6 w-8 shrink-0 items-center justify-center rounded-[2px] border border-[var(--ps-divider)] bg-[radial-gradient(circle_at_34%_34%,#f8fafc_0_18%,#9ca3af_19%_42%,#27272a_43%_100%)]"
    >
      <Palette className="h-3.5 w-3.5 text-white drop-shadow" />
    </div>
  )
}

export function AdjustmentMaskThumb({ layer, maskState }: { layer: Layer; maskState: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const dst = ref.current
    if (!dst) return
    const ctx = dst.getContext("2d")!
    ctx.clearRect(0, 0, dst.width, dst.height)
    ctx.fillStyle = "#222"
    ctx.fillRect(0, 0, dst.width, dst.height)
    if (layer.mask && typeof layer.mask.getContext === "function") {
      ctx.drawImage(layer.mask, 0, 0, dst.width, dst.height)
    } else {
      ctx.strokeStyle = "#777"
      ctx.strokeRect(3, 3, dst.width - 6, dst.height - 6)
      ctx.beginPath()
      ctx.moveTo(4, 4)
      ctx.lineTo(dst.width - 4, dst.height - 4)
      ctx.stroke()
    }
  }, [layer.mask, maskState])

  return (
    <canvas
      ref={ref}
      width={32}
      height={24}
      data-testid={`adjustment-mask-thumb-${layer.name}`}
      title={`Adjustment mask: ${maskState}`}
      aria-label={`Adjustment mask ${maskState}`}
      className="h-6 w-8 shrink-0 rounded-[2px] border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
    />
  )
}

/** The icon/thumbnail cluster at the head of a layer row, per layer kind. */
export function LayerRowThumbs({
  layer,
  isGroup,
  maskState,
  maskEditing,
  onOpenAdjustment,
  onSelectMask,
}: {
  layer: Layer
  isGroup: boolean
  maskState: string
  maskEditing: boolean
  onOpenAdjustment: () => void
  onSelectMask: () => void
}) {
  if (isGroup) {
    const Icon = layer.expanded ? FolderOpen : Folder
    return <Icon className="w-4 h-4 text-[var(--ps-accent-2)] shrink-0" />
  }
  if (layer.kind === "adjustment") {
    return (
      <>
        {layer.clipped ? (
          <CornerDownRight
            className="h-3 w-3 shrink-0 text-[var(--ps-accent-2)]"
            data-testid={`adjustment-clip-icon-${layer.name}`}
            aria-label="Adjustment clipped to layer below"
          />
        ) : (
          <span className="h-3 w-3 shrink-0" aria-hidden />
        )}
        {/* Adjustment settings still open from the thumbnail; the row itself renames. */}
        <span onDoubleClick={(e) => { e.stopPropagation(); onOpenAdjustment() }}>
          <AdjustmentThumb layer={layer} />
        </span>
        <AdjustmentMaskThumb layer={layer} maskState={maskState} />
      </>
    )
  }
  return (
    <>
      <LayerThumb layer={layer} />
      <LayerMaskThumb layer={layer} editing={maskEditing} onSelect={onSelectMask} />
    </>
  )
}

/**
 * A pixel layer's own mask, and the control that makes it the paint target.
 *
 * Like the smart-filter mask thumbnail, this redraws off the render bus: the
 * brush mutates the mask canvas in place without changing its identity.
 */
export function LayerMaskThumb({
  layer,
  editing,
  onSelect,
}: {
  layer: Layer
  editing: boolean
  onSelect: () => void
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const mask = layer.mask
  const enabled = layer.maskEnabled !== false
  const state = maskCoverageState(mask, enabled)

  const draw = React.useCallback(() => {
    const dst = ref.current
    if (!dst || !mask || typeof mask.getContext !== "function") return
    const ctx = dst.getContext("2d")!
    ctx.fillStyle = "#222"
    ctx.fillRect(0, 0, dst.width, dst.height)
    ctx.globalAlpha = enabled ? 1 : 0.35
    const ratio = Math.min(dst.width / mask.width, dst.height / mask.height)
    const w = mask.width * ratio
    const h = mask.height * ratio
    ctx.drawImage(mask, (dst.width - w) / 2, (dst.height - h) / 2, w, h)
    ctx.globalAlpha = 1
  }, [mask, enabled])

  React.useEffect(() => { draw() }, [draw])
  useRenderSubscription(
    React.useCallback(
      (change: MergedRenderChange) => {
        if (change.layerIds === "all" || change.layerIds.includes(layer.id)) draw()
      },
      [draw, layer.id],
    ),
  )

  if (!mask) return null
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      data-testid={`layer-mask-thumb-${layer.name}`}
      data-layer-mask-editing={editing ? "true" : "false"}
      title={editing ? `Layer mask (${state}) — painting here` : `Layer mask (${state}) — click to paint it`}
      aria-label={editing ? `Editing layer mask of ${layer.name}` : `Select layer mask of ${layer.name}`}
      aria-pressed={editing}
      className={cn(
        "shrink-0 rounded-[2px] border",
        editing ? "border-[var(--ps-accent)] ring-1 ring-[var(--ps-accent)]" : "border-[var(--ps-divider)]",
      )}
    >
      <canvas ref={ref} width={32} height={24} className="block h-6 w-8" />
    </button>
  )
}

export function SmartFilterMaskThumb({
  layerId,
  layerName,
  filterName,
  mask,
  enabled,
  editing,
  linked,
  density,
  feather,
}: {
  layerId: string
  layerName: string
  filterName: string
  mask?: HTMLCanvasElement | null
  enabled: boolean
  editing: boolean
  linked: boolean
  density: number
  feather: number
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const state = maskCoverageState(mask, enabled)
  const draw = React.useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#202020"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const sq = 4
    ctx.fillStyle = "#2f2f2f"
    for (let y = 0; y < canvas.height; y += sq) {
      for (let x = 0; x < canvas.width; x += sq) {
        if (((x / sq) + (y / sq)) % 2 === 0) ctx.fillRect(x, y, sq, sq)
      }
    }
    if (mask) {
      ctx.globalAlpha = enabled ? 1 : 0.35
      // Preserve aspect ratio so painted strokes are visible in the higher-res thumb.
      const ratio = Math.min(canvas.width / mask.width, canvas.height / mask.height)
      const dw = mask.width * ratio
      const dh = mask.height * ratio
      const dx = (canvas.width - dw) / 2
      const dy = (canvas.height - dh) / 2
      ctx.drawImage(mask, dx, dy, dw, dh)
      ctx.globalAlpha = 1
      const densityWidth = Math.round(canvas.width * Math.max(0, Math.min(1, density)))
      ctx.fillStyle = enabled ? "#5aa7ff" : "#777"
      ctx.fillRect(0, canvas.height - 3, densityWidth, 3)
      if (feather > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.55)"
        ctx.fillRect(Math.max(0, canvas.width - 5), 1, 2, canvas.height - 5)
      }
    } else {
      ctx.strokeStyle = "#777"
      ctx.setLineDash([2, 2])
      ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
      ctx.setLineDash([])
    }
    ctx.fillStyle = linked ? "#9ad27b" : "#777"
    ctx.beginPath()
    ctx.arc(canvas.width - 5, 5, 2.5, 0, Math.PI * 2)
    ctx.fill()
    if (editing) {
      ctx.strokeStyle = "#5aa7ff"
      ctx.lineWidth = 2
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2)
    }
  }, [mask, enabled, editing, linked, density, feather])
  React.useEffect(() => {
    draw()
  }, [draw])
  // Smart filter masks are painted by the canvas without changing their
  // identity, so subscribe to the render bus to redraw the thumbnail whenever
  // the underlying mask canvas is mutated (paint strokes, fills, inverts).
  useRenderSubscription(
    React.useCallback(
      (change: MergedRenderChange) => {
        if (!mask) return
        if (change.layerIds === "all" || change.layerIds.includes(layerId)) draw()
      },
      [draw, layerId, mask],
    ),
  )

  return (
    <canvas
      ref={ref}
      width={28}
      height={28}
      data-testid={`layer-smart-filter-mask-thumb-${layerName}-${filterName}`}
      data-smart-filter-mask-state={state}
      data-smart-filter-mask-linked={linked ? "true" : "false"}
      data-smart-filter-mask-density={String(Math.round(Math.max(0, Math.min(1, density)) * 100))}
      data-smart-filter-mask-feather={String(Math.round(Math.max(0, feather)))}
      className={cn("shrink-0 rounded-sm border", editing ? "border-[var(--ps-accent)]" : "border-[var(--ps-divider)]")}
      title={`Smart filter mask: ${state}, ${linked ? "linked" : "unlinked"}, density ${Math.round(Math.max(0, Math.min(1, density)) * 100)}%, feather ${Math.round(Math.max(0, feather))} px`}
      aria-label={editing ? `Editing ${filterName} smart filter mask` : `${filterName} smart filter mask`}
    />
  )
}

export function LayerThumb({ layer }: { layer: Layer }) {
  const ref = React.useRef<HTMLCanvasElement>(null)

  const draw = React.useCallback((change?: MergedRenderChange) => {
    if (change?.layerIds !== "all" && change?.layerIds && !change.layerIds.includes(layer.id)) return
    const dst = ref.current
    if (!dst) return
    if (typeof layer.canvas.getContext !== "function") return
    const ctx = dst.getContext("2d")!
    ctx.clearRect(0, 0, dst.width, dst.height)
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, dst.width, dst.height)
    ctx.fillStyle = "#c8c8c8"
    const sq = 4
    for (let y = 0; y < dst.height; y += sq) {
      for (let x = 0; x < dst.width; x += sq) {
        if (((x / sq) + (y / sq)) % 2 === 0) ctx.fillRect(x, y, sq, sq)
      }
    }
    const ratio = Math.min(dst.width / layer.canvas.width, dst.height / layer.canvas.height)
    const w = layer.canvas.width * ratio
    const h = layer.canvas.height * ratio
    ctx.drawImage(layer.canvas, (dst.width - w) / 2, (dst.height - h) / 2, w, h)
  }, [layer])

  React.useEffect(() => {
    draw()
  }, [draw])

  // Subscribe to render bus so thumb updates while drawing without React state
  useRenderSubscription(draw)

  return (
    <canvas
      ref={ref}
      width={32}
      height={24}
      className="border border-[var(--ps-divider)] bg-white shrink-0"
    />
  )
}
