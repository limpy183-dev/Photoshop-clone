"use client"

import * as React from "react"
import { useEditor, makeCanvas } from "../editor-context"
import { FILTERS, type FilterParam } from "../filters"
import { Slider } from "@/components/ui/slider"
import { Type as TypeIcon, Square, Pen, Image, Layers as LayersIcon, Paintbrush, Eraser, Move, Scissors, Wand2 } from "lucide-react"
import type { Layer, BlendMode, ToolId } from "../types"
import { renderThreeDScene } from "../advanced-subsystems"
import {
  applyTextInsideShape,
  buildFontPreview,
  convertTextToEditablePath,
  createTextExtrusionScene,
  diagnoseDocumentFonts,
  matchFontForLayer,
} from "../typography-engine"

const BLEND_MODES: BlendMode[] = [
  "normal","dissolve","darken","multiply","color-burn","linear-burn","darker-color",
  "lighten","screen","color-dodge","linear-dodge","lighter-color",
  "overlay","soft-light","hard-light","vivid-light","linear-light","pin-light","hard-mix",
  "difference","exclusion","subtract","divide","hue","saturation","color","luminosity",
]

export function PropertiesPanel() {
  const { activeDoc, activeLayer, tool, brush, eraser, cloneSource, dispatch, foreground, background, commit, requestRender } = useEditor()
  if (!activeDoc) return <EmptyState text="No document open" />
  const globalLight = activeDoc.globalLight ?? { angle: 120, altitude: 30 }
  const setGlobalLight = (patch: Partial<typeof globalLight>) => {
    dispatch({ type: "set-global-light", globalLight: { ...globalLight, ...patch } })
    requestRender()
  }

  return (
    <div className="p-2 flex flex-col gap-2 text-[11px] overflow-y-auto max-h-full">
      {/* Document Info (always visible) */}
      <Section title="Document" icon={<Image className="w-3 h-3" />}>
        <Row label="Name">{activeDoc.name}</Row>
        <Row label="Size">{activeDoc.width} × {activeDoc.height} px</Row>
        <Row label="Mode">{activeDoc.colorMode}, {activeDoc.bitDepth}-bit</Row>
        <Row label="Zoom">{Math.round(activeDoc.zoom * 100)}%</Row>
        <div className="grid grid-cols-2 gap-1 pt-1">
          <NumberField
            label="Light Angle"
            value={globalLight.angle}
            onChange={(value) => setGlobalLight({ angle: value })}
            onCommit={() => commit("Global Light", "all")}
          />
          <NumberField
            label="Light Alt"
            value={globalLight.altitude}
            onChange={(value) => setGlobalLight({ altitude: value })}
            onCommit={() => commit("Global Light", "all")}
          />
        </div>
      </Section>

      {/* Layer Section (when layer selected) */}
      {activeLayer && (
        <LayerSection layer={activeLayer} doc={activeDoc} dispatch={dispatch} commit={commit} requestRender={requestRender} />
      )}

      {/* Tool-specific sections */}
      <ToolSection
        tool={tool}
        layer={activeLayer}
        brush={brush}
        eraser={eraser}
        cloneSource={cloneSource}
        dispatch={dispatch}
        requestRender={requestRender}
        commit={commit}
        foreground={foreground}
        background={background}
        doc={activeDoc}
      />

      {/* Selection info */}
      {activeDoc.selection.bounds && (
        <Section title="Selection" icon={<Scissors className="w-3 h-3" />}>
          <Row label="X">{Math.round(activeDoc.selection.bounds.x)} px</Row>
          <Row label="Y">{Math.round(activeDoc.selection.bounds.y)} px</Row>
          <Row label="W">{Math.round(activeDoc.selection.bounds.w)} px</Row>
          <Row label="H">{Math.round(activeDoc.selection.bounds.h)} px</Row>
          <Row label="Shape">{activeDoc.selection.shape}</Row>
          {activeDoc.selection.feather ? (
            <Row label="Feather">{activeDoc.selection.feather} px</Row>
          ) : null}
        </Section>
      )}

      {/* Quick Actions */}
      <Section title="Quick Actions" icon={<Wand2 className="w-3 h-3" />}>
        <div className="grid grid-cols-2 gap-1">
          <QuickBtn label="Auto Tone" onClick={() => {
            if (activeLayer) {
              const ctx = activeLayer.canvas.getContext("2d")!
              const img = ctx.getImageData(0, 0, activeDoc.width, activeDoc.height)
              autoTone(img)
              ctx.putImageData(img, 0, 0)
              requestRender()
              commit("Auto Tone", [activeLayer.id])
            }
          }} />
          <QuickBtn label="Auto Contrast" onClick={() => {
            if (activeLayer) {
              const ctx = activeLayer.canvas.getContext("2d")!
              const img = ctx.getImageData(0, 0, activeDoc.width, activeDoc.height)
              autoContrast(img)
              ctx.putImageData(img, 0, 0)
              requestRender()
              commit("Auto Contrast", [activeLayer.id])
            }
          }} />
          <QuickBtn label="Flatten Image" onClick={() => {
            dispatch({ type: "flatten" })
            requestRender()
            window.setTimeout(() => commit("Flatten Image", "all"), 0)
          }} />
          <QuickBtn label="Deselect" onClick={() => {
            dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
            requestRender()
            window.setTimeout(() => commit("Deselect", "all"), 0)
          }} />
          <QuickBtn label="Select All" onClick={() => {
            dispatch({ type: "set-selection", selection: { bounds: { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height }, shape: "rect" } })
            requestRender()
            window.setTimeout(() => commit("Select All", "all"), 0)
          }} />
          <QuickBtn label="Stamp Visible" onClick={() => {
            dispatch({ type: "stamp-visible" })
            requestRender()
            window.setTimeout(() => commit("Stamp Visible", "all"), 0)
          }} />
        </div>
      </Section>
    </div>
  )
}

/* ---- Layer Section ---- */
function LayerSection({
  layer,
  doc,
  dispatch,
  commit,
  requestRender,
}: {
  layer: Layer
  doc: NonNullable<ReturnType<typeof useEditor>["activeDoc"]>
  dispatch: (a: import("../editor-context").Action) => void
  commit: (label: string, changedLayerIds?: string[]) => void
  requestRender: () => void
}) {
  const commitLayerChange = (label: string) => {
    requestRender()
    window.setTimeout(() => commit(label, [layer.id]), 0)
  }
  const setSmartFilters = (next: NonNullable<Layer["smartFilters"]>, label: string) => {
    dispatch({ type: "set-layer-smart-filters", id: layer.id, smartFilters: next })
    requestRender()
    window.setTimeout(() => commit(label, [layer.id]), 0)
  }
  const addSmartFilterMask = (filterId: string, fill: "#ffffff" | "#000000" = "#ffffff") => {
    setSmartFilters(
      (layer.smartFilters ?? []).map((sf) =>
        sf.id === filterId ? { ...sf, mask: makeCanvas(doc.width, doc.height, fill), maskEnabled: true } : sf,
      ),
      fill === "#ffffff" ? "Reveal Smart Filter Mask" : "Hide Smart Filter Mask",
    )
  }
  const invertSmartFilterMask = (filterId: string) => {
    const filter = layer.smartFilters?.find((sf) => sf.id === filterId)
    if (!filter?.mask) return
    const mask = makeCanvas(filter.mask.width, filter.mask.height)
    const ctx = mask.getContext("2d")!
    ctx.drawImage(filter.mask, 0, 0)
    const img = ctx.getImageData(0, 0, mask.width, mask.height)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 255 - img.data[i]
      img.data[i + 1] = 255 - img.data[i + 1]
      img.data[i + 2] = 255 - img.data[i + 2]
    }
    ctx.putImageData(img, 0, 0)
    setSmartFilters(
      (layer.smartFilters ?? []).map((sf) => (sf.id === filterId ? { ...sf, mask, maskEnabled: true } : sf)),
      "Invert Smart Filter Mask",
    )
  }

  return (
    <Section title="Layer" icon={<LayersIcon className="w-3 h-3" />}>
      <Row label="Name">
        <input
          className="bg-transparent border-b border-[var(--ps-divider)] w-full outline-none focus:border-[var(--ps-accent)]"
          value={layer.name}
          onChange={(e) => dispatch({ type: "rename-layer", id: layer.id, name: e.target.value })}
          onBlur={() => commitLayerChange("Rename Layer")}
        />
      </Row>
      <Row label="Kind">{layer.kind || "pixel"}</Row>
      <Row label="Blend">
        <select
          value={layer.blendMode}
          onChange={(e) => {
            dispatch({ type: "set-layer-blend", id: layer.id, blendMode: e.target.value as import("../types").BlendMode })
            commitLayerChange("Layer Blend Mode")
          }}
          className="bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 h-5 text-[10px] w-full"
        >
          {BLEND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Row>
      <Row label="Opacity">
        <div className="flex items-center gap-2 flex-1">
          <Slider
            min={0} max={100}
            value={[Math.round(layer.opacity * 100)]}
            onValueChange={(v) => dispatch({ type: "set-layer-opacity", id: layer.id, opacity: v[0] / 100 })}
            onValueCommit={() => commitLayerChange("Layer Opacity")}
            className="flex-1"
          />
          <span className="tabular-nums w-9 text-right">{Math.round(layer.opacity * 100)}%</span>
        </div>
      </Row>
      <Row label="Fill">
        <div className="flex items-center gap-2 flex-1">
          <Slider
            min={0} max={100}
            value={[Math.round((layer.fillOpacity ?? 1) * 100)]}
            onValueChange={(v) => dispatch({ type: "set-layer-fill-opacity", id: layer.id, fillOpacity: v[0] / 100 })}
            onValueCommit={() => commitLayerChange("Layer Fill Opacity")}
            className="flex-1"
          />
          <span className="tabular-nums w-9 text-right">{Math.round((layer.fillOpacity ?? 1) * 100)}%</span>
        </div>
      </Row>
      <Row label="Lock">
        <div className="flex gap-1">
          <LockBtn active={!!layer.lockTransparency} label="T" title="Lock Transparency"
            onClick={() => { dispatch({ type: "toggle-layer-lock-transparency", id: layer.id }); commitLayerChange("Layer Lock") }} />
          <LockBtn active={!!layer.lockDraw} label="B" title="Lock Draw"
            onClick={() => { dispatch({ type: "toggle-layer-lock-draw", id: layer.id }); commitLayerChange("Layer Lock") }} />
          <LockBtn active={!!layer.lockMove} label="P" title="Lock Move"
            onClick={() => { dispatch({ type: "toggle-layer-lock-move", id: layer.id }); commitLayerChange("Layer Lock") }} />
          <LockBtn active={!!layer.lockAll} label="A" title="Lock All"
            onClick={() => { dispatch({ type: "toggle-layer-lock-all", id: layer.id }); commitLayerChange("Layer Lock") }} />
        </div>
      </Row>
      {layer.mask && <Row label="Mask">Active (grayscale)</Row>}
      {layer.clipped && <Row label="Clipped">Clipping Mask</Row>}
      {layer.style && <Row label="Effects">{Object.keys(layer.style).filter(k => k !== "blendingOptions").join(", ") || "None"}</Row>}
      {layer.kind === "adjustment" && layer.adjustment ? (
        <div className="mt-1 rounded-sm border border-[var(--ps-divider)]">
          <div className="border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
            Adjustment
          </div>
          <div className="space-y-2 p-2">
            {(FILTERS[layer.adjustment.type]?.params ?? []).map((param) => (
              <AdjustmentParamControl
                key={param.key}
                param={param}
                value={layer.adjustment!.params[param.key] ?? param.default}
                onChange={(value) => {
                  dispatch({
                    type: "set-layer-adjustment",
                    id: layer.id,
                    adjustment: {
                      ...layer.adjustment!,
                      params: { ...layer.adjustment!.params, [param.key]: value },
                    },
                  })
                  requestRender()
                }}
                onCommit={() => commitLayerChange("Adjustment Parameters")}
              />
            ))}
          </div>
        </div>
      ) : null}
      {(layer.smartObject || layer.kind === "smart-object") && (
        <div className="mt-1 rounded-sm border border-[var(--ps-divider)]">
          <div className="flex items-center justify-between border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
            <span>Smart Filters</span>
            <button
              type="button"
              className="text-[10px] normal-case text-[var(--ps-text)] hover:text-[var(--ps-accent)]"
              onClick={() => window.dispatchEvent(new CustomEvent("ps-open-filter-gallery"))}
            >
              Edit
            </button>
          </div>
          {(layer.smartFilters?.length ?? 0) === 0 ? (
            <div className="px-2 py-2 text-[10px] text-[var(--ps-text-dim)]">No smart filters.</div>
          ) : (
            <div className="divide-y divide-[var(--ps-divider)]">
              {layer.smartFilters!.map((filter, idx) => (
                <div
                  key={filter.id}
                  className="space-y-1 px-2 py-1.5 text-[10px]"
                  onDoubleClick={() => window.dispatchEvent(new CustomEvent("ps-open-filter-gallery"))}
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="w-5 text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
                      title={filter.enabled ? "Disable filter" : "Enable filter"}
                      onClick={() =>
                        setSmartFilters(
                          layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, enabled: !sf.enabled } : sf),
                          "Toggle Smart Filter",
                        )
                      }
                    >
                      {filter.enabled ? "On" : "Off"}
                    </button>
                    <SmartFilterMaskThumb mask={filter.mask} enabled={filter.maskEnabled !== false} />
                    <span className={filter.enabled ? "flex-1 truncate" : "flex-1 truncate line-through text-[var(--ps-text-dim)]"}>
                      {filter.name}
                    </span>
                    <button
                      type="button"
                      className="px-1 text-[var(--ps-text-dim)] hover:text-[var(--ps-text)] disabled:opacity-30"
                      disabled={idx === 0}
                      onClick={() => {
                        const next = [...layer.smartFilters!]
                        ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                        setSmartFilters(next, "Reorder Smart Filter")
                      }}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="px-1 text-[var(--ps-text-dim)] hover:text-[var(--ps-text)] disabled:opacity-30"
                      disabled={idx === layer.smartFilters!.length - 1}
                      onClick={() => {
                        const next = [...layer.smartFilters!]
                        ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
                        setSmartFilters(next, "Reorder Smart Filter")
                      }}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="px-1 text-red-300 hover:text-red-200"
                      onClick={() => setSmartFilters(layer.smartFilters!.filter((sf) => sf.id !== filter.id), "Delete Smart Filter")}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="grid grid-cols-[1fr_86px] gap-1">
                    <label className="grid gap-1">
                      <span className="text-[var(--ps-text-dim)]">Opacity {Math.round((filter.opacity ?? 1) * 100)}%</span>
                      <Slider
                        min={0}
                        max={100}
                        value={[Math.round((filter.opacity ?? 1) * 100)]}
                        onValueChange={(v) =>
                          setSmartFilters(
                            layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, opacity: v[0] / 100 } : sf),
                            "Smart Filter Opacity",
                          )
                        }
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[var(--ps-text-dim)]">Blend</span>
                      <select
                        value={filter.blendMode ?? "normal"}
                        onChange={(e) =>
                          setSmartFilters(
                            layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, blendMode: e.target.value as import("../types").BlendMode as BlendMode } : sf),
                            "Smart Filter Blend Mode",
                          )
                        }
                        className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
                      >
                        {BLEND_MODES.map((mode) => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {filter.mask ? (
                      <>
                        <button
                          type="button"
                          className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 hover:bg-[var(--ps-tool-hover)]"
                          onClick={() =>
                            setSmartFilters(
                              layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, maskEnabled: sf.maskEnabled === false } : sf),
                              "Toggle Smart Filter Mask",
                            )
                          }
                        >
                          {filter.maskEnabled === false ? "Enable mask" : "Disable mask"}
                        </button>
                        <button type="button" className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 hover:bg-[var(--ps-tool-hover)]" onClick={() => invertSmartFilterMask(filter.id)}>Invert</button>
                        <button
                          type="button"
                          className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 hover:bg-[var(--ps-tool-hover)]"
                          onClick={() => setSmartFilters(layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, mask: null, maskEnabled: true } : sf), "Remove Smart Filter Mask")}
                        >
                          Remove mask
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 hover:bg-[var(--ps-tool-hover)]" onClick={() => addSmartFilterMask(filter.id, "#ffffff")}>White mask</button>
                        <button type="button" className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 hover:bg-[var(--ps-tool-hover)]" onClick={() => addSmartFilterMask(filter.id, "#000000")}>Black mask</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

function SmartFilterMaskThumb({ mask, enabled }: { mask?: HTMLCanvasElement | null; enabled: boolean }) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#202020"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (mask) {
      ctx.globalAlpha = enabled ? 1 : 0.35
      ctx.drawImage(mask, 0, 0, canvas.width, canvas.height)
      ctx.globalAlpha = 1
    } else {
      ctx.strokeStyle = "#666"
      ctx.setLineDash([2, 2])
      ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
      ctx.setLineDash([])
    }
  }, [mask, enabled])
  return <canvas ref={ref} width={18} height={14} className="shrink-0 rounded-sm border border-[var(--ps-divider)]" title={mask ? "Smart filter mask" : "No filter mask"} />
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
    const n = typeof value === "number" ? value : Number(value) || Number(param.default) || 0
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[var(--ps-text-dim)]">{param.label}</span>
          <span className="tabular-nums">{n.toFixed(param.step && param.step < 1 ? 1 : 0)}{param.suffix ?? ""}</span>
        </div>
        <Slider
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          value={[n]}
          onValueChange={(next) => onChange(next[0])}
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
  if (param.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-[10px]">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => {
            onChange(e.target.checked)
            onCommit()
          }}
          className="accent-[var(--ps-accent)]"
        />
        {param.label}
      </label>
    )
  }
  return null
}

function NumberField({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  onCommit: () => void
}) {
  return (
    <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        onBlur={onCommit}
        className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] text-[var(--ps-text)] outline-none"
      />
    </label>
  )
}

/* ---- Tool-specific Section ---- */
function ToolSection({ tool, layer, brush, eraser, cloneSource, dispatch, requestRender, commit, foreground, background, doc }: {
  tool: ToolId
  layer: Layer | null
  brush: import("../types").BrushSettings
  eraser: import("../types").EraserSettings
  cloneSource: import("../types").CloneSourceSettings
  dispatch: (a: import("../editor-context").Action) => void
  requestRender: () => void
  commit: (label: string, changedLayerIds?: string[]) => void
  foreground: string
  background: string
  doc: import("../types").PsDocument
}) {
  // Text tool
  if ((tool === "type" || tool === "type-vertical" || layer?.kind === "text") && layer?.text) {
    const updateText = (patch: Partial<NonNullable<Layer["text"]>>) => {
      dispatch({ type: "set-layer-text", id: layer.id, text: { ...layer.text!, ...patch } })
      requestRender()
    }
    const pathLayer = doc.layers.find((candidate: Layer) => candidate.id !== layer.id && (candidate.path || candidate.shape))
    const shapeLayer = doc.layers.find((candidate: Layer) => candidate.id !== layer.id && candidate.shape)
    const diagnostics = diagnoseDocumentFonts(doc.layers)
    const fontStatus = diagnostics.diagnostics.find((item) => item.layerId === layer.id)
    const preview = buildFontPreview(layer.text.font, "Ag 123", {
      size: 20,
      weight: layer.text.weight,
      italic: layer.text.italic,
      color: layer.text.color,
      variableAxes: layer.text.variableAxes,
      variableAxisDefinitions: layer.text.variableAxisDefinitions,
    })
    const axisValue = (tag: string, fallback: number) => layer.text!.variableAxes?.[tag] ?? fallback
    const updateAxis = (tag: string, value: number) => {
      updateText({ variableAxes: { ...(layer.text!.variableAxes ?? {}), [tag]: value } })
    }
    const attachPath = () => {
      if (!pathLayer) return
      const points =
        pathLayer.path?.points ??
        (pathLayer.shape
          ? [
              { x: pathLayer.shape.x, y: pathLayer.shape.y + pathLayer.shape.h / 2 },
              { x: pathLayer.shape.x + pathLayer.shape.w / 2, y: pathLayer.shape.y },
              { x: pathLayer.shape.x + pathLayer.shape.w, y: pathLayer.shape.y + pathLayer.shape.h / 2 },
              { x: pathLayer.shape.x + pathLayer.shape.w / 2, y: pathLayer.shape.y + pathLayer.shape.h },
              { x: pathLayer.shape.x, y: pathLayer.shape.y + pathLayer.shape.h / 2 },
            ]
          : undefined)
      if (!points?.length) return
      updateText({ textPath: points })
      window.setTimeout(() => commit("Type on Path", [layer.id]), 0)
    }
    const putInsideShape = () => {
      if (!shapeLayer?.shape) return
      updateText(applyTextInsideShape(layer.text!, shapeLayer.shape, { inset: layer.text!.textShapeInset ?? 8 }))
      window.setTimeout(() => commit("Text Inside Shape", [layer.id]), 0)
    }
    const convertToPath = () => {
      const path = convertTextToEditablePath(layer.text!)
      dispatch({ type: "set-layer-path", id: layer.id, path })
      dispatch({ type: "set-layer-kind", id: layer.id, kind: "shape" })
      window.setTimeout(() => commit("Convert Text to Path", [layer.id]), 0)
    }
    const matchFont = () => {
      const match = matchFontForLayer(layer.text!)
      const best = match.best
      updateText({
        font: best.family,
        variableAxisDefinitions: best.variableAxes,
        variableAxes: best.variableAxes?.length ? { wght: layer.text!.weight === "bold" ? 700 : 400 } : layer.text!.variableAxes,
      })
      window.setTimeout(() => commit(`Match Font: ${best.family}`, [layer.id]), 0)
    }
    const create3DText = () => {
      const scene = createTextExtrusionScene({
        ...layer.text!,
        extrusion: layer.text!.extrusion ?? { enabled: true, depth: 28, bevel: 3, angle: 35, color: layer.text!.color },
      })
      const rendered = renderThreeDScene(scene, doc.width, doc.height)
      const canvas = makeCanvas(doc.width, doc.height)
      canvas.getContext("2d")!.drawImage(rendered, 0, 0)
      const newLayer: Layer = {
        id: `layer_text3d_${Date.now()}`,
        name: `${layer.name} 3D Text`,
        kind: "3d",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas,
        threeD: scene,
      }
      dispatch({ type: "add-layer", layer: newLayer })
      requestRender()
      window.setTimeout(() => commit("Create 3D Text", [newLayer.id]), 0)
    }
    return (
      <Section title="Text Properties" icon={<TypeIcon className="w-3 h-3" />}>
        <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
          Content
          <textarea
            value={layer.text.content}
            spellCheck
            onChange={(e) => updateText({ content: e.target.value })}
            onBlur={() => commit("Edit Text", [layer.id])}
            className="min-h-16 resize-y rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[11px] text-[var(--ps-text)] outline-none"
          />
        </label>
        <Row label="Font">
          <input
            value={layer.text.font}
            onChange={(e) => updateText({ font: e.target.value })}
            onBlur={() => commit("Type Font", [layer.id])}
            className="w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] outline-none"
          />
        </Row>
        <Row label="Size">
          <input
            type="number"
            min={1}
            value={layer.text.size}
            onChange={(e) => updateText({ size: Math.max(1, Number(e.target.value) || layer.text!.size) })}
            onBlur={() => commit("Type Size", [layer.id])}
            className="w-20 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] outline-none"
          />
        </Row>
        <Row label="Weight">
          <select
            value={layer.text.weight}
            onChange={(e) => updateText({ weight: e.target.value as "normal" | "bold" })}
            onBlur={() => commit("Type Weight", [layer.id])}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="normal">Normal</option>
            <option value="bold">Bold</option>
          </select>
        </Row>
        <Row label="Align">
          <select
            value={layer.text.align}
            onChange={(e) => updateText({ align: e.target.value as "left" | "center" | "right" })}
            onBlur={() => commit("Type Align", [layer.id])}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </Row>
        <Row label="Color">
          <input
            type="color"
            value={layer.text.color}
            onChange={(e) => updateText({ color: e.target.value })}
            onBlur={() => commit("Type Color", [layer.id])}
            className="h-5 w-10"
          />
        </Row>
        <Row label="Preview">
          <span
            className="block min-h-7 truncate rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1"
            style={preview.previewStyle as React.CSSProperties}
            title={`${preview.cssFont}; ${preview.fontVariationSettings || "no variable axes"}`}
          >
            {preview.sample}
          </span>
        </Row>
        <Row label="Font">
          <span className={fontStatus?.status === "missing" ? "text-amber-300" : "text-emerald-300"}>
            {fontStatus?.status === "missing" ? `Missing, substitutes ${fontStatus.substitute}` : "Available"}
          </span>
        </Row>
        <Row label="AA Mode">
          <select
            value={layer.text.antiAlias === false ? "none" : layer.text.antiAliasMode ?? "smooth"}
            onChange={(e) => updateText({ antiAliasMode: e.target.value as NonNullable<Layer["text"]>["antiAliasMode"], antiAlias: e.target.value !== "none" })}
            onBlur={() => commit("Type Anti-Alias", [layer.id])}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="none">None</option>
            <option value="sharp">Sharp</option>
            <option value="crisp">Crisp</option>
            <option value="strong">Strong</option>
            <option value="smooth">Smooth</option>
          </select>
        </Row>
        <div className="grid grid-cols-2 gap-1">
          <NumberField label="X" value={layer.text.x} onChange={(value) => updateText({ x: value })} onCommit={() => commit("Type Bounds", [layer.id])} />
          <NumberField label="Y" value={layer.text.y} onChange={(value) => updateText({ y: value })} onCommit={() => commit("Type Bounds", [layer.id])} />
          <NumberField label="Box W" value={layer.text.boxWidth ?? 0} onChange={(value) => updateText({ boxWidth: value > 0 ? value : undefined })} onCommit={() => commit("Type Area", [layer.id])} />
          <NumberField label="Box H" value={layer.text.boxHeight ?? 0} onChange={(value) => updateText({ boxHeight: value > 0 ? value : undefined })} onCommit={() => commit("Type Area", [layer.id])} />
          <NumberField label="Tracking" value={layer.text.tracking ?? 0} onChange={(value) => updateText({ tracking: value })} onCommit={() => commit("Type Tracking", [layer.id])} />
          <NumberField label="Leading" value={layer.text.leading ?? 0} onChange={(value) => updateText({ leading: value > 0 ? value : undefined })} onCommit={() => commit("Type Leading", [layer.id])} />
          <NumberField label="Baseline" value={layer.text.baselineShift ?? 0} onChange={(value) => updateText({ baselineShift: value })} onCommit={() => commit("Type Baseline", [layer.id])} />
          <NumberField label="Kerning" value={typeof layer.text.kerning === "number" ? layer.text.kerning : 0} onChange={(value) => updateText({ kerning: value })} onCommit={() => commit("Type Kerning", [layer.id])} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <NumberField label="Axis wght" value={axisValue("wght", layer.text.weight === "bold" ? 700 : 400)} onChange={(value) => updateAxis("wght", value)} onCommit={() => commit("Variable Font Axis", [layer.id])} />
          <NumberField label="Axis wdth" value={axisValue("wdth", 100)} onChange={(value) => updateAxis("wdth", value)} onCommit={() => commit("Variable Font Axis", [layer.id])} />
          <NumberField label="Axis slnt" value={axisValue("slnt", 0)} onChange={(value) => updateAxis("slnt", value)} onCommit={() => commit("Variable Font Axis", [layer.id])} />
          <NumberField label="Axis opsz" value={axisValue("opsz", layer.text.size)} onChange={(value) => updateAxis("opsz", value)} onCommit={() => commit("Variable Font Axis", [layer.id])} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <QuickToggle label="Ligatures" active={layer.text.ligatures !== false} onClick={() => { updateText({ ligatures: layer.text!.ligatures === false }); commit("Type Ligatures", [layer.id]) }} />
          <QuickToggle label="Discretionary" active={!!layer.text.discretionaryLigatures} onClick={() => { updateText({ discretionaryLigatures: !layer.text!.discretionaryLigatures }); commit("Type Ligatures", [layer.id]) }} />
          <QuickToggle label="Contextual" active={layer.text.contextualAlternates !== false} onClick={() => { updateText({ contextualAlternates: layer.text!.contextualAlternates === false }); commit("Type Alternates", [layer.id]) }} />
          <QuickToggle label="Stylistic" active={!!layer.text.stylisticAlternates} onClick={() => { updateText({ stylisticAlternates: !layer.text!.stylisticAlternates }); commit("Type Alternates", [layer.id]) }} />
          <QuickToggle label="Swash" active={!!layer.text.swash} onClick={() => { updateText({ swash: !layer.text!.swash }); commit("Type Swash", [layer.id]) }} />
          <QuickToggle label="Ordinals" active={!!layer.text.ordinals} onClick={() => { updateText({ ordinals: !layer.text!.ordinals }); commit("Type Ordinals", [layer.id]) }} />
          <QuickToggle label="Fractions" active={!!layer.text.fractions} onClick={() => { updateText({ fractions: !layer.text!.fractions }); commit("Type Fractions", [layer.id]) }} />
          <QuickToggle label="All Caps" active={!!layer.text.allCaps} onClick={() => { updateText({ allCaps: !layer.text!.allCaps }); commit("Type Case", [layer.id]) }} />
          <QuickToggle label="Small Caps" active={!!layer.text.smallCaps} onClick={() => { updateText({ smallCaps: !layer.text!.smallCaps }); commit("Type Case", [layer.id]) }} />
          <QuickToggle label="Oldstyle" active={!!layer.text.oldstyleFigures} onClick={() => { updateText({ oldstyleFigures: !layer.text!.oldstyleFigures }); commit("Type Figures", [layer.id]) }} />
          <QuickToggle label="Tabular" active={!!layer.text.tabularFigures} onClick={() => { updateText({ tabularFigures: !layer.text!.tabularFigures }); commit("Type Figures", [layer.id]) }} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <QuickToggle label="Extrusion" active={!!layer.text.extrusion?.enabled} onClick={() => { updateText({ extrusion: { enabled: !layer.text!.extrusion?.enabled, depth: layer.text!.extrusion?.depth ?? 28, bevel: layer.text!.extrusion?.bevel ?? 3, angle: layer.text!.extrusion?.angle ?? 35, color: layer.text!.extrusion?.color ?? layer.text!.color } }); commit("Type Extrusion", [layer.id]) }} />
          <NumberField label="Depth" value={layer.text.extrusion?.depth ?? 28} onChange={(value) => updateText({ extrusion: { enabled: layer.text!.extrusion?.enabled ?? true, depth: Math.max(0, value), bevel: layer.text!.extrusion?.bevel ?? 3, angle: layer.text!.extrusion?.angle ?? 35, color: layer.text!.extrusion?.color ?? layer.text!.color } })} onCommit={() => commit("Type Extrusion", [layer.id])} />
          <NumberField label="Bevel" value={layer.text.extrusion?.bevel ?? 3} onChange={(value) => updateText({ extrusion: { enabled: layer.text!.extrusion?.enabled ?? true, depth: layer.text!.extrusion?.depth ?? 28, bevel: Math.max(0, value), angle: layer.text!.extrusion?.angle ?? 35, color: layer.text!.extrusion?.color ?? layer.text!.color } })} onCommit={() => commit("Type Extrusion", [layer.id])} />
          <NumberField label="Angle" value={layer.text.extrusion?.angle ?? 35} onChange={(value) => updateText({ extrusion: { enabled: layer.text!.extrusion?.enabled ?? true, depth: layer.text!.extrusion?.depth ?? 28, bevel: layer.text!.extrusion?.bevel ?? 3, angle: value, color: layer.text!.extrusion?.color ?? layer.text!.color } })} onCommit={() => commit("Type Extrusion", [layer.id])} />
        </div>
        <button
          type="button"
          disabled={!pathLayer}
          onClick={attachPath}
          className="h-7 rounded-sm border border-[var(--ps-divider)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        >
          Attach to Active Path
        </button>
        <div className="grid grid-cols-2 gap-1">
          <QuickBtn label="Match Font" onClick={matchFont} />
          <QuickBtn label="Inside Shape" onClick={putInsideShape} />
          <QuickBtn label="Convert Path" onClick={convertToPath} />
          <QuickBtn label="3D Text" onClick={create3DText} />
        </div>
      </Section>
    )
  }

  // Shape tool
  if ((tool === "shape-rect" || tool === "shape-ellipse" || tool === "shape-line" || tool === "custom-shape") && layer?.shape) {
    const updateShape = (patch: Partial<NonNullable<Layer["shape"]>>) => {
      dispatch({ type: "set-layer-shape", id: layer.id, shape: { ...layer.shape!, ...patch } })
      requestRender()
    }
    return (
      <Section title="Shape Properties" icon={<Square className="w-3 h-3" />}>
        <Row label="Type">{layer.shape.type}</Row>
        <Row label="Fill">
          <input
            type="color"
            value={layer.shape.fill}
            onChange={(e) => updateShape({ fill: e.target.value })}
            onBlur={() => commit("Shape Fill", [layer.id])}
            className="h-5 w-10"
          />
        </Row>
        <Row label="Stroke">
          <input
            type="color"
            value={layer.shape.stroke?.color ?? "#000000"}
            onChange={(e) => updateShape({ stroke: { color: e.target.value, width: layer.shape!.stroke?.width ?? 1 } })}
            onBlur={() => commit("Shape Stroke", [layer.id])}
            className="h-5 w-10"
          />
        </Row>
        <div className="grid grid-cols-2 gap-1">
          <NumberField label="X" value={Math.round(layer.shape.x)} onChange={(value) => updateShape({ x: value })} onCommit={() => commit("Shape Bounds", [layer.id])} />
          <NumberField label="Y" value={Math.round(layer.shape.y)} onChange={(value) => updateShape({ y: value })} onCommit={() => commit("Shape Bounds", [layer.id])} />
          <NumberField label="W" value={Math.round(layer.shape.w)} onChange={(value) => updateShape({ w: value })} onCommit={() => commit("Shape Bounds", [layer.id])} />
          <NumberField label="H" value={Math.round(layer.shape.h)} onChange={(value) => updateShape({ h: value })} onCommit={() => commit("Shape Bounds", [layer.id])} />
          <NumberField label="Stroke W" value={layer.shape.stroke?.width ?? 0} onChange={(value) => updateShape({ stroke: value > 0 ? { color: layer.shape!.stroke?.color ?? background, width: value } : null })} onCommit={() => commit("Shape Stroke", [layer.id])} />
          <NumberField label="Radius" value={layer.shape.radius ?? 0} onChange={(value) => updateShape({ radius: Math.max(0, value) })} onCommit={() => commit("Shape Radius", [layer.id])} />
        </div>
      </Section>
    )
  }

  // Brush/Pencil/Eraser
  if (tool === "brush" || tool === "pencil" || tool === "eraser" || tool === "background-eraser" || tool === "magic-eraser" || tool === "clone-stamp" || tool === "healing-brush") {
    const ToolIcon = tool === "eraser" ? Eraser : Paintbrush
    return (
      <Section title={`${tool.charAt(0).toUpperCase() + tool.slice(1)} Settings`} icon={<ToolIcon className="w-3 h-3" />}>
        <Row label="Size">
          <div className="flex items-center gap-2 flex-1">
            <Slider min={1} max={500} value={[brush.size]}
              onValueChange={(v) => dispatch({ type: "set-brush", brush: { size: v[0] } })}
              className="flex-1" />
            <span className="tabular-nums w-9 text-right">{brush.size}px</span>
          </div>
        </Row>
        <Row label="Hardness">
          <div className="flex items-center gap-2 flex-1">
            <Slider min={0} max={100} value={[brush.hardness]}
              onValueChange={(v) => dispatch({ type: "set-brush", brush: { hardness: v[0] } })}
              className="flex-1" />
            <span className="tabular-nums w-9 text-right">{brush.hardness}%</span>
          </div>
        </Row>
        <Row label="Opacity">
          <div className="flex items-center gap-2 flex-1">
            <Slider min={0} max={100} value={[brush.opacity]}
              onValueChange={(v) => dispatch({ type: "set-brush", brush: { opacity: v[0] } })}
              className="flex-1" />
            <span className="tabular-nums w-9 text-right">{brush.opacity}%</span>
          </div>
        </Row>
        <Row label="Flow">
          <div className="flex items-center gap-2 flex-1">
            <Slider min={0} max={100} value={[brush.flow]}
              onValueChange={(v) => dispatch({ type: "set-brush", brush: { flow: v[0] } })}
              className="flex-1" />
            <span className="tabular-nums w-9 text-right">{brush.flow}%</span>
          </div>
        </Row>
        <Row label="Spacing">{brush.spacing}%</Row>
        <Row label="Tip">{brush.tipShape}</Row>
        {(tool === "background-eraser" || tool === "magic-eraser") && (
          <>
            <Row label="Sampling">{eraser.sampling}</Row>
            <Row label="Limits">{eraser.limits}</Row>
            <Row label="Tolerance">{eraser.tolerance}</Row>
          </>
        )}
        {(tool === "clone-stamp" || tool === "healing-brush") && (
          <>
            <Row label="Sample">{cloneSource.sample}</Row>
            <Row label="Aligned">{cloneSource.aligned ? "Yes" : "No"}</Row>
            <Row label="Scale">{cloneSource.scale}%</Row>
            <Row label="Rotation">{cloneSource.rotation} deg</Row>
            <Row label="Sources">{cloneSource.presets.length ? cloneSource.presets.map((preset: import("../types").CloneSourcePreset) => preset.name).join(", ") : "Alt-click to add"}</Row>
          </>
        )}
        <Row label="Color">
          <div className="flex items-center gap-1">
            <span className="w-4 h-4 rounded-sm border border-[var(--ps-divider)] inline-block" style={{ background: foreground }} />
            <span>{foreground}</span>
          </div>
        </Row>
      </Section>
    )
  }

  // Move tool
  if (tool === "move") {
    return (
      <Section title="Transform" icon={<Move className="w-3 h-3" />}>
        <Row label="Position">
          {layer ? `Layer "${layer.name}"` : "No layer"}
        </Row>
        <Row label="Canvas">{doc.width} × {doc.height}</Row>
        <div className="text-[10px] text-[var(--ps-text-dim)] mt-1">
          Use Ctrl+T to enter Free Transform mode
        </div>
      </Section>
    )
  }

  // Pen tool
  if (tool === "pen") {
    return (
      <Section title="Pen Tool" icon={<Pen className="w-3 h-3" />}>
        <Row label="Mode">Path</Row>
        <div className="text-[10px] text-[var(--ps-text-dim)] mt-1">
          Click to add anchor points. Close the path to create a selection.
        </div>
      </Section>
    )
  }

  return null
}

/* ---- Reusable components ---- */
function Section({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false)
  return (
    <div className="border border-[var(--ps-divider)] rounded-sm">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)] bg-[var(--ps-panel-2)] border-b border-[var(--ps-divider)] flex items-center gap-1.5 hover:text-[var(--ps-text)]"
      >
        <span className={`transition-transform text-[8px] ${collapsed ? "" : "rotate-90"}`}>▶</span>
        {icon}
        {title}
      </button>
      {!collapsed && <div className="p-2 flex flex-col gap-1.5">{children}</div>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[var(--ps-text-dim)] shrink-0">{label}</span>
      <span className="flex-1 truncate">{children}</span>
    </div>
  )
}

function LockBtn({ active, label, title, onClick }: { active: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button
      className={`w-5 h-5 text-[8px] rounded-sm flex items-center justify-center ${active ? "bg-[var(--ps-tool-active)] text-[var(--ps-text)]" : "hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text-dim)]"}`}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function QuickBtn({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 px-2 text-[11px] rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)] text-left"
    >
      {label}
    </button>
  )
}

function QuickToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-sm border px-2 text-left text-[10px] ${
        active
          ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]"
          : "border-[var(--ps-divider)] bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)]"
      }`}
    >
      {label}
    </button>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex items-center justify-center h-24 text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}

/* ---- Auto adjustments ---- */
function autoTone(img: ImageData) {
  for (let ch = 0; ch < 3; ch++) {
    let min = 255, max = 0
    for (let i = ch; i < img.data.length; i += 4) {
      if (img.data[i] < min) min = img.data[i]
      if (img.data[i] > max) max = img.data[i]
    }
    const range = max - min || 1
    for (let i = ch; i < img.data.length; i += 4) {
      img.data[i] = Math.round(((img.data[i] - min) / range) * 255)
    }
  }
}

function autoContrast(img: ImageData) {
  let min = 255, max = 0
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
    if (lum < min) min = lum
    if (lum > max) max = lum
  }
  const range = max - min || 1
  for (let i = 0; i < img.data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      img.data[i + ch] = Math.round(Math.max(0, Math.min(255, ((img.data[i + ch] - min) / range) * 255)))
    }
  }
}
