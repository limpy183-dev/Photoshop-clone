"use client"

import * as React from "react"
import { useEditor, makeCanvas } from "../editor-context"
import { FILTERS, type FilterDef, type FilterParam } from "../filters"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import {
  CircleDot,
  Eye,
  EyeOff,
  Link,
  PaintBucket,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react"
import type { AdjustmentProps, AdjustmentType, Layer } from "../types"
import {
  adjustmentParamsWithDefaults,
  createAdjustmentLayer as createAdjustmentLayerModel,
  defaultAdjustmentParams,
  invertAdjustmentMask,
  isAdjustmentNoop,
} from "../adjustment-layers"

const ADJUSTMENTS: AdjustmentType[] = [
  "brightness-contrast",
  "levels",
  "curves",
  "exposure",
  "vibrance",
  "hue-saturation",
  "color-balance",
  "black-white",
  "photo-filter",
  "channel-mixer",
  "color-lookup",
  "invert",
  "posterize",
  "threshold",
  "gradient-map",
  "selective-color",
  "shadows-highlights",
  "hdr-toning",
  "desaturate",
  "match-color",
  "replace-color",
  "equalize",
]

const ADJUSTMENT_EDIT_DEBOUNCE_MS = 60
const ADJUSTMENT_COMMIT_DEBOUNCE_MS = 350

export function AdjustmentsPanel() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [clipToBelow, setClipToBelow] = React.useState(false)
  const [withMask, setWithMask] = React.useState(true)
  const [showAddSection, setShowAddSection] = React.useState(false)
  const [draftAdjustments, setDraftAdjustments] = React.useState<Record<string, AdjustmentProps>>({})
  const pendingAdjustmentRef = React.useRef<{ id: string; adjustment: AdjustmentProps } | null>(null)
  const adjustmentFlushTimerRef = React.useRef<number | null>(null)
  const pendingCommitRef = React.useRef<{ id: string; label: string } | null>(null)
  const adjustmentCommitTimerRef = React.useRef<number | null>(null)

  const flushPendingAdjustment = React.useCallback(() => {
    if (adjustmentFlushTimerRef.current !== null) {
      window.clearTimeout(adjustmentFlushTimerRef.current)
      adjustmentFlushTimerRef.current = null
    }
    const pending = pendingAdjustmentRef.current
    if (!pending) return
    pendingAdjustmentRef.current = null
    dispatch({ type: "set-layer-adjustment", id: pending.id, adjustment: pending.adjustment })
  }, [dispatch])

  React.useEffect(() => flushPendingAdjustment, [flushPendingAdjustment])

  const adjustmentLayer = activeLayer?.kind === "adjustment" && activeLayer.adjustment ? activeLayer : null
  const draftAdjustment = adjustmentLayer ? draftAdjustments[adjustmentLayer.id] : undefined
  const displayedAdjustment = draftAdjustment ?? adjustmentLayer?.adjustment ?? null
  const displayedAdjustmentLayer =
    adjustmentLayer && displayedAdjustment && displayedAdjustment !== adjustmentLayer.adjustment
      ? { ...adjustmentLayer, adjustment: displayedAdjustment }
      : adjustmentLayer
  const adjustmentLayerId = adjustmentLayer?.id
  const adjustmentLayerAdjustment = adjustmentLayer?.adjustment

  React.useEffect(() => {
    if (!adjustmentLayerId) {
      setDraftAdjustments((current) => (Object.keys(current).length ? {} : current))
      return
    }
    setDraftAdjustments((current) => {
      if (!current[adjustmentLayerId] || pendingAdjustmentRef.current?.id === adjustmentLayerId) return current
      const next = { ...current }
      delete next[adjustmentLayerId]
      return next
    })
  }, [adjustmentLayerId, adjustmentLayerAdjustment])

  // When the active layer changes away from an adjustment, collapse the Add section.
  React.useEffect(() => {
    if (adjustmentLayerId) setShowAddSection(false)
  }, [adjustmentLayerId])

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const createAdjustmentLayer = (filterId: AdjustmentType) => {
    const filter = FILTERS[filterId]
    if (!filter) return
    const layer = createAdjustmentLayerModel({
      filterId,
      width: activeDoc.width,
      height: activeDoc.height,
      layers: activeDoc.layers,
      makeCanvas,
      clipped: clipToBelow,
      withMask,
    })
    dispatch({ type: "add-layer", layer })
    if (!isAdjustmentNoop(layer.adjustment)) requestRender()
    window.setTimeout(() => commit(`New ${filter.name} Adjustment`, [layer.id]), 0)
    setShowAddSection(false)
  }

  const updateAdjustmentParam = (param: string, value: number | string | boolean) => {
    if (!adjustmentLayer?.adjustment || !displayedAdjustment) return
    const next: AdjustmentProps = {
      ...displayedAdjustment,
      params: { ...displayedAdjustment.params, [param]: value },
    }
    setDraftAdjustments((current) => ({ ...current, [adjustmentLayer.id]: next }))
    pendingAdjustmentRef.current = { id: adjustmentLayer.id, adjustment: next }
    if (adjustmentFlushTimerRef.current !== null) window.clearTimeout(adjustmentFlushTimerRef.current)
    adjustmentFlushTimerRef.current = window.setTimeout(flushPendingAdjustment, ADJUSTMENT_EDIT_DEBOUNCE_MS)
  }

  const flushPendingHistoryCommit = React.useCallback(() => {
    if (adjustmentCommitTimerRef.current !== null) {
      window.clearTimeout(adjustmentCommitTimerRef.current)
      adjustmentCommitTimerRef.current = null
    }
    const pending = pendingCommitRef.current
    if (!pending) return
    pendingCommitRef.current = null
    commit(pending.label, [pending.id])
  }, [commit])

  React.useEffect(() => flushPendingHistoryCommit, [flushPendingHistoryCommit])

  const commitAdjustmentParam = (label: string) => {
    if (!adjustmentLayer) return
    pendingCommitRef.current = { id: adjustmentLayer.id, label }
    if (adjustmentCommitTimerRef.current !== null) window.clearTimeout(adjustmentCommitTimerRef.current)
    adjustmentCommitTimerRef.current = window.setTimeout(() => {
      flushPendingAdjustment()
      flushPendingHistoryCommit()
    }, ADJUSTMENT_COMMIT_DEBOUNCE_MS)
  }

  const resetAdjustment = () => {
    if (!adjustmentLayer?.adjustment) return
    const next: AdjustmentProps = {
      type: adjustmentLayer.adjustment.type,
      params: defaultAdjustmentParams(adjustmentLayer.adjustment.type),
    }
    setDraftAdjustments((current) => ({ ...current, [adjustmentLayer.id]: next }))
    pendingAdjustmentRef.current = { id: adjustmentLayer.id, adjustment: next }
    flushPendingAdjustment()
    window.setTimeout(() => commit(`Reset ${FILTERS[adjustmentLayer.adjustment!.type]?.name ?? "Adjustment"}`, [adjustmentLayer.id]), 0)
  }

  const toggleAdjustmentVisible = () => {
    if (!adjustmentLayer) return
    dispatch({ type: "set-layer-visibility", id: adjustmentLayer.id, visible: !adjustmentLayer.visible })
    requestRender()
    window.setTimeout(() => commit(adjustmentLayer.visible ? "Hide Adjustment" : "Show Adjustment", [adjustmentLayer.id]), 0)
  }

  const setOpacity = (value: number) => {
    if (!adjustmentLayer) return
    dispatch({ type: "set-layer-opacity", id: adjustmentLayer.id, opacity: value / 100 })
  }

  const setMaskFill = (fill: "#ffffff" | "#000000") => {
    if (!adjustmentLayer) return
    flushPendingAdjustment()
    dispatch({ type: "set-layer-mask", id: adjustmentLayer.id, mask: makeCanvas(activeDoc.width, activeDoc.height, fill) })
    requestRender()
    window.setTimeout(() => commit(fill === "#ffffff" ? "Reveal Adjustment Mask" : "Hide Adjustment Mask", [adjustmentLayer.id]), 0)
  }

  const invertMask = () => {
    if (!adjustmentLayer?.mask) return
    flushPendingAdjustment()
    const mask = invertAdjustmentMask({
      layer: adjustmentLayer,
      width: activeDoc.width,
      height: activeDoc.height,
      makeCanvas,
    })
    dispatch({ type: "set-layer-mask", id: adjustmentLayer.id, mask })
    requestRender()
    window.setTimeout(() => commit("Invert Adjustment Mask", [adjustmentLayer.id]), 0)
  }

  const filterDef = displayedAdjustment ? FILTERS[displayedAdjustment.type] : null
  const inEditMode = !!(displayedAdjustmentLayer && displayedAdjustment && filterDef)

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      {inEditMode ? (
        <AdjustmentEditor
          doc={activeDoc}
          layer={displayedAdjustmentLayer!}
          adjustment={displayedAdjustment!}
          filterDef={filterDef!}
          onReset={resetAdjustment}
          onToggleVisible={toggleAdjustmentVisible}
          onChangeParam={updateAdjustmentParam}
          onCommitParam={commitAdjustmentParam}
          onSetOpacity={setOpacity}
          onCommitOpacity={() =>
            window.setTimeout(() => commit("Adjustment Opacity", [adjustmentLayer!.id]), 0)
          }
          onToggleClipped={() => {
            flushPendingAdjustment()
            dispatch({ type: "toggle-layer-clipped", id: adjustmentLayer!.id })
            requestRender()
            window.setTimeout(() => commit("Toggle Adjustment Clipping", [adjustmentLayer!.id]), 0)
          }}
          onMaskFill={setMaskFill}
          onMaskInvert={invertMask}
          onMaskRemove={() => {
            flushPendingAdjustment()
            dispatch({ type: "set-layer-mask", id: adjustmentLayer!.id, mask: null })
            requestRender()
            window.setTimeout(() => commit("Remove Adjustment Mask", [adjustmentLayer!.id]), 0)
          }}
          showAddSection={showAddSection}
          onToggleAddSection={() => setShowAddSection((v) => !v)}
          addSection={
            <AddAdjustmentList
              clipToBelow={clipToBelow}
              withMask={withMask}
              onClipChange={setClipToBelow}
              onMaskChange={setWithMask}
              onPick={createAdjustmentLayer}
              compact
            />
          }
        />
      ) : (
        <AddAdjustmentList
          clipToBelow={clipToBelow}
          withMask={withMask}
          onClipChange={setClipToBelow}
          onMaskChange={setWithMask}
          onPick={createAdjustmentLayer}
        />
      )}
    </div>
  )
}

/* ============================== editor view ============================== */

function AdjustmentEditor({
  doc,
  layer,
  adjustment,
  filterDef,
  onReset,
  onToggleVisible,
  onChangeParam,
  onCommitParam,
  onSetOpacity,
  onCommitOpacity,
  onToggleClipped,
  onMaskFill,
  onMaskInvert,
  onMaskRemove,
  showAddSection,
  onToggleAddSection,
  addSection,
}: {
  doc: NonNullable<ReturnType<typeof useEditor>["activeDoc"]>
  layer: Layer
  adjustment: AdjustmentProps
  filterDef: FilterDef
  onReset: () => void
  onToggleVisible: () => void
  onChangeParam: (key: string, value: number | string | boolean) => void
  onCommitParam: (label: string) => void
  onSetOpacity: (value: number) => void
  onCommitOpacity: () => void
  onToggleClipped: () => void
  onMaskFill: (fill: "#ffffff" | "#000000") => void
  onMaskInvert: () => void
  onMaskRemove: () => void
  showAddSection: boolean
  onToggleAddSection: () => void
  addSection: React.ReactNode
}) {
  const opacityPct = Math.round(Math.max(0, Math.min(1, layer.opacity)) * 100)
  const atDefaults = filterDef.params.every((p) => (adjustment.params[p.key] ?? p.default) === p.default)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-[var(--ps-divider)] bg-gradient-to-b from-[var(--ps-panel-2)] to-[var(--ps-panel)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[var(--ps-accent)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-tight text-[var(--ps-text)]">
              {filterDef.name}
            </div>
            <div className="truncate text-[10px] text-[var(--ps-text-dim)]">
              {layer.clipped ? "Clipped to layer below" : "Affects visible stack"} · {layer.name}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              title={layer.visible ? "Hide adjustment (toggle to compare)" : "Show adjustment"}
              onClick={onToggleVisible}
              active={!layer.visible}
            >
              {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </IconButton>
            <IconButton
              title={layer.clipped ? "Unclip from layer below" : "Clip to layer below"}
              onClick={onToggleClipped}
              active={layer.clipped}
            >
              <Link className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton title="Reset to defaults" onClick={onReset} disabled={atDefaults}>
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="adjustment-editor">
        {/* Controls */}
        <Section
          icon={<SlidersHorizontal className="h-3 w-3" />}
          title="Controls"
          testId="adjustment-settings-column"
        >
          {filterDef.params.length ? (
            <div className="space-y-2.5">
              {filterDef.params.map((param) => (
                <AdjustmentParamControl
                  key={param.key}
                  param={param}
                  value={adjustment.params[param.key] ?? param.default}
                  onChange={(value) => onChangeParam(param.key, value)}
                  onCommit={() => onCommitParam(`${filterDef.name}: ${param.label}`)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-4 text-center text-[10px] text-[var(--ps-text-dim)]">
              This adjustment has no controls — it always uses the same effect.
            </div>
          )}
        </Section>

        {/* Opacity */}
        <Section icon={<CircleDot className="h-3 w-3" />} title="Layer Opacity">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-[var(--ps-text-dim)]">Opacity</span>
            <span className="tabular-nums">{opacityPct}%</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[opacityPct]}
            onValueChange={(v) => onSetOpacity(v[0])}
            onValueCommit={onCommitOpacity}
          />
        </Section>

        {/* Preview */}
        <Section
          icon={<SlidersHorizontal className="h-3 w-3" />}
          title="Preview"
          testId="adjustment-preview-column"
        >
          <AdjustmentVisual doc={doc} layer={layer} />
        </Section>

        {/* Mask */}
        <Section
          icon={<PaintBucket className="h-3 w-3" />}
          title="Mask"
        >
          <div className="flex items-center gap-2">
            <MaskPreview mask={layer.mask} />
            <div className="min-w-0 flex-1 text-[10px] text-[var(--ps-text-dim)]">
              {layer.mask ? "Grayscale mask controls where the effect applies." : "No mask — the effect applies everywhere."}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <MiniButton onClick={() => onMaskFill("#ffffff")}>Reveal</MiniButton>
            <MiniButton onClick={() => onMaskFill("#000000")}>Hide</MiniButton>
            <MiniButton disabled={!layer.mask} onClick={onMaskInvert}>Invert</MiniButton>
            <MiniButton disabled={!layer.mask} onClick={onMaskRemove}>Remove</MiniButton>
          </div>
        </Section>

        {/* Add another adjustment (collapsed by default in edit mode) */}
        <div className="border-t border-[var(--ps-divider)]">
          <button
            type="button"
            onClick={onToggleAddSection}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            <span className="inline-flex items-center gap-1.5">
              <Plus className="h-3 w-3" />
              Add Another Adjustment
            </span>
            <span className="text-[9px]">{showAddSection ? "▲" : "▼"}</span>
          </button>
          {showAddSection ? (
            <div className="border-t border-[var(--ps-divider)] bg-[var(--ps-panel-2)]/40 px-2 pb-2 pt-1">
              {addSection}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ============================== add-list view ============================== */

function AddAdjustmentList({
  clipToBelow,
  withMask,
  onClipChange,
  onMaskChange,
  onPick,
  compact,
}: {
  clipToBelow: boolean
  withMask: boolean
  onClipChange: (v: boolean) => void
  onMaskChange: (v: boolean) => void
  onPick: (id: AdjustmentType) => void
  compact?: boolean
}) {
  return (
    <div className={compact ? "p-0" : "p-2"}>
      {!compact ? (
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase text-[var(--ps-text-dim)]">
          <CircleDot className="h-3 w-3" />
          Add Adjustment
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-1">
        {ADJUSTMENTS.map((id) => (
          <button
            key={id}
            type="button"
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-left text-[10px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
            onClick={() => onPick(id)}
          >
            {FILTERS[id]?.name ?? id}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-[var(--ps-text-dim)]">
        <label className="flex items-center gap-2">
          <Checkbox checked={clipToBelow} onCheckedChange={(v) => onClipChange(v === true)} />
          Clip below
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={withMask} onCheckedChange={(v) => onMaskChange(v === true)} />
          White mask
        </label>
      </div>
      {!compact ? (
        <div className="mt-3 rounded-sm border border-dashed border-[var(--ps-divider)] bg-[var(--ps-panel-2)]/40 px-2 py-2 text-[10px] text-[var(--ps-text-dim)]">
          Pick an adjustment above to add it. The Properties editor opens automatically.
        </div>
      ) : null}
    </div>
  )
}

/* ============================== shared pieces ============================== */

function Section({
  icon,
  title,
  testId,
  children,
}: {
  icon: React.ReactNode
  title: string
  testId?: string
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-[var(--ps-divider)]" data-testid={testId}>
      <div className="flex items-center gap-1.5 bg-[var(--ps-panel-2)]/60 px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
        {icon}
        {title}
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  )
}

function IconButton({
  children,
  onClick,
  title,
  active,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={[
        "grid h-6 w-6 place-items-center rounded-sm border text-[var(--ps-text-dim)]",
        "hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]",
        "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
        active
          ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)] text-[var(--ps-text)]"
          : "border-[var(--ps-divider)] bg-[var(--ps-panel-2)]",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

function AdjustmentVisual({
  doc,
  layer,
}: {
  doc: NonNullable<ReturnType<typeof useEditor>["activeDoc"]>
  layer: Layer
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas || !layer.adjustment) return
    canvas.width = 252
    canvas.height = 92
    const ctx = canvas.getContext("2d")!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#141414"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = "#2f2f2f"
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * canvas.width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
    if (layer.adjustment.type === "curves") {
      const shadow = Number(layer.adjustment.params.shadow ?? 0)
      const midtone = Number(layer.adjustment.params.midtone ?? 128)
      const highlight = Number(layer.adjustment.params.highlight ?? 255)
      // Reference diagonal
      ctx.strokeStyle = "#2a2a2a"
      ctx.beginPath()
      ctx.moveTo(0, canvas.height)
      ctx.lineTo(canvas.width, 0)
      ctx.stroke()
      ctx.strokeStyle = "#38bdf8"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, canvas.height - (shadow / 255) * canvas.height)
      ctx.quadraticCurveTo(
        canvas.width / 2,
        canvas.height - (midtone / 255) * canvas.height,
        canvas.width,
        canvas.height - (highlight / 255) * canvas.height,
      )
      ctx.stroke()
      return
    }
    if (layer.adjustment.type === "hue-saturation") {
      const grad = ctx.createLinearGradient(0, 0, canvas.width, 0)
      ;["#f00", "#ff0", "#0f0", "#0ff", "#00f", "#f0f", "#f00"].forEach((color, i) => grad.addColorStop(i / 6, color))
      ctx.fillStyle = grad
      ctx.fillRect(0, 20, canvas.width, 52)
      return
    }
    const source = renderAdjustmentPreviewSample(doc)
    const img = source.getContext("2d")!.getImageData(0, 0, source.width, source.height)
    const hist = new Array<number>(256).fill(0)
    for (let i = 0; i < img.data.length; i += 4) {
      const lum = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
      hist[lum]++
    }
    const max = Math.max(1, ...hist)
    ctx.strokeStyle = "#d1d5db"
    ctx.beginPath()
    hist.forEach((count, i) => {
      const x = (i / 255) * canvas.width
      const y = canvas.height - (count / max) * (canvas.height - 8)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }, [doc, layer])
  return <canvas ref={ref} className="block w-full rounded-sm border border-[var(--ps-divider)]" />
}

function renderAdjustmentPreviewSample(doc: NonNullable<ReturnType<typeof useEditor>["activeDoc"]>) {
  const sampleScale = Math.min(1, 192 / Math.max(doc.width, doc.height))
  const canvas = makeCanvas(Math.max(1, Math.round(doc.width * sampleScale)), Math.max(1, Math.round(doc.height * sampleScale)))
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group") continue
    if (layer.kind === "adjustment" && layer.adjustment) {
      if (isAdjustmentNoop(layer.adjustment)) continue
      const filter = FILTERS[layer.adjustment.type]
      if (!filter) continue
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const after = filter.apply(before, adjustmentParamsWithDefaults(layer.adjustment.type, layer.adjustment.params))
      ctx.putImageData(after, 0, 0)
      continue
    }
    if (typeof layer.canvas.getContext !== "function") continue
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity))
    ctx.drawImage(layer.canvas, 0, 0, canvas.width, canvas.height)
    ctx.restore()
  }
  return canvas
}

function AdjustmentParamControl({
  param,
  value,
  onChange,
  onCommit,
}: {
  param: FilterParam
  value: number | string | boolean
  onChange: (value: number | string | boolean) => void
  onCommit: () => void
}) {
  if (param.type === "slider") {
    const n = typeof value === "number" ? value : Number(param.default) || 0
    const atDefault = n === param.default
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[var(--ps-text-dim)]">{param.label}</span>
          <div className="flex items-center gap-1.5">
            <span className="tabular-nums text-[var(--ps-text)]">{n.toFixed(param.step && param.step < 1 ? 1 : 0)}{param.suffix ?? ""}</span>
            <button
              type="button"
              disabled={atDefault}
              onClick={() => {
                onChange(param.default)
                onCommit()
              }}
              title="Reset to default"
              className="grid h-4 w-4 place-items-center rounded-[2px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <RotateCcw className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
        <Slider
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          value={[n]}
          onValueChange={(v) => onChange(v[0])}
          onValueCommit={onCommit}
        />
      </div>
    )
  }
  if (param.type === "select") {
    return (
      <label className="grid gap-1 text-[10px]">
        <span className="text-[var(--ps-text-dim)]">{param.label}</span>
        <select
          value={String(value)}
          onChange={(e) => {
            onChange(e.target.value)
            onCommit()
          }}
          className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[11px]"
        >
          {param.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    )
  }
  if (param.type === "text") {
    const readFile = (file: File | undefined) => {
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        onChange(String(reader.result ?? ""))
        onCommit()
      }
      reader.readAsText(file)
    }
    return (
      <label className="grid gap-1 text-[10px]">
        <span className="flex items-center justify-between gap-2 text-[var(--ps-text-dim)]">
          {param.label}
          {param.accept ? (
            <input
              type="file"
              accept={param.accept}
              onChange={(e) => readFile(e.currentTarget.files?.[0])}
              className="max-w-[120px] text-[9px] file:mr-1 file:h-5 file:rounded-sm file:border file:border-[var(--ps-divider)] file:bg-[var(--ps-panel-2)] file:px-1"
            />
          ) : null}
        </span>
        {param.multiline ? (
          <textarea
            value={typeof value === "string" ? value : param.default}
            placeholder={param.placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            spellCheck={false}
            rows={5}
            className="min-h-[92px] resize-y rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 py-1 font-mono text-[10px]"
          />
        ) : (
          <input
            value={typeof value === "string" ? value : param.default}
            placeholder={param.placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            spellCheck={false}
            className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 font-mono text-[10px]"
          />
        )}
      </label>
    )
  }
  if (param.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-[10px]">
        <Checkbox
          checked={value === true}
          onCheckedChange={(v) => {
            onChange(v === true)
            onCommit()
          }}
        />
        {param.label}
      </label>
    )
  }
  return null
}

function MaskPreview({ mask }: { mask?: HTMLCanvasElement | null }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const dst = ref.current
    if (!dst) return
    const ctx = dst.getContext("2d")!
    ctx.clearRect(0, 0, dst.width, dst.height)
    ctx.fillStyle = "#222"
    ctx.fillRect(0, 0, dst.width, dst.height)
    if (mask) ctx.drawImage(mask, 0, 0, dst.width, dst.height)
    else {
      ctx.strokeStyle = "#777"
      ctx.strokeRect(4, 4, dst.width - 8, dst.height - 8)
      ctx.beginPath()
      ctx.moveTo(5, 5)
      ctx.lineTo(dst.width - 5, dst.height - 5)
      ctx.stroke()
    }
  }, [mask])
  return <canvas ref={ref} width={36} height={24} className="rounded-sm border border-[var(--ps-divider)]" />
}

function MiniButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}
