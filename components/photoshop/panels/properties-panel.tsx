"use client"

import * as React from "react"
import { useEditorSelector, makeCanvas, useRenderSubscription } from "../editor-context"
import { dispatchPhotoshopEvent } from "../events"
import type { MergedRenderChange } from "../render-bus"
import { FILTERS, type FilterParam } from "../filters"
import { Slider } from "@/components/ui/slider"
import { Type as TypeIcon, Square, Pen, Image, Layers as LayersIcon, Paintbrush, Eraser, Move, Scissors, Wand2, Eye, EyeOff, Link2, Link2Off } from "lucide-react"
import type { Layer, BlendMode, PsDocument, ToolId } from "../types"
import type { ActiveSmartFilterMaskTarget } from "../editor-reducer"
import { renderThreeDScene } from "../advanced-subsystems"
import {
  applyTextInsideShape,
  buildFontSubstitutionComparison,
  buildFontPreview,
  buildTextPathHandleModel,
  buildVariableFontAxisControlModel,
  convertTextToEditablePath,
  createTextExtrusionScene,
  DEFAULT_VARIABLE_AXIS_DEFINITIONS,
  deleteTextPathPoint,
  detectOpenTypeFeatureSupport,
  diagnoseDocumentFonts,
  findEmbeddedFontForFamily,
  insertTextPathPoint,
  inspectVariableFont,
  listOpenTypeFeatureToggles,
  matchFontFromImageData,
  matchFontForLayer,
  reverseTextPath,
  resolveFontSubstitutions,
  updateTextPathPoint,
  type VariableFontInspection,
} from "../typography-engine"
import { createDefaultShapeAppearance, shapeToEditablePath } from "../vector-path-operations"

const BLEND_MODES: BlendMode[] = [
  "normal","dissolve","darken","multiply","color-burn","linear-burn","darker-color",
  "lighten","screen","color-dodge","linear-dodge","lighter-color",
  "overlay","soft-light","hard-light","vivid-light","linear-light","pin-light","hard-mix",
  "difference","exclusion","subtract","divide","hue","saturation","color","luminosity",
]

function smartFilterMaskState(mask: HTMLCanvasElement | null | undefined, enabled: boolean) {
  if (!enabled) return "disabled"
  if (!mask) return "none"
  const ctx = mask.getContext("2d")
  if (!ctx) return "none"
  const points = [
    [0, 0],
    [Math.max(0, Math.floor(mask.width / 2)), Math.max(0, Math.floor(mask.height / 2))],
    [Math.max(0, mask.width - 1), 0],
    [0, Math.max(0, mask.height - 1)],
    [Math.max(0, mask.width - 1), Math.max(0, mask.height - 1)],
  ]
  let min = 255
  let max = 0
  for (const [x, y] of points) {
    const px = ctx.getImageData(x, y, 1, 1).data
    const lum = (px[0] + px[1] + px[2]) / 3
    min = Math.min(min, lum)
    max = Math.max(max, lum)
  }
  if (max <= 8) return "hidden"
  if (min >= 247) return "revealed"
  return "mixed"
}

export function PropertiesPanel() {
  const { activeDoc, activeLayer, tool, brush, eraser, cloneSource, dispatch, foreground, background, commit, requestRender, activeSmartFilterMaskTarget } = useEditorSelector((editor) => editor)
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
        <LayerSection layer={activeLayer} doc={activeDoc} dispatch={dispatch} commit={commit} requestRender={requestRender} activeSmartFilterMaskTarget={activeSmartFilterMaskTarget} />
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
  activeSmartFilterMaskTarget,
}: {
  layer: Layer
  doc: PsDocument
  dispatch: (a: import("../editor-context").Action) => void
  commit: (label: string, changedLayerIds?: string[]) => void
  requestRender: () => void
  activeSmartFilterMaskTarget: ActiveSmartFilterMaskTarget | null
}) {
  const [draggedSmartFilterId, setDraggedSmartFilterId] = React.useState<string | null>(null)
  const commitLayerChange = (label: string) => {
    requestRender()
    window.setTimeout(() => commit(label, [layer.id]), 0)
  }
  const previewSmartFilters = (next: NonNullable<Layer["smartFilters"]>) => {
    dispatch({ type: "set-layer-smart-filters", id: layer.id, smartFilters: next })
    requestRender()
  }
  const commitSmartFilters = (label: string) => {
    window.setTimeout(() => commit(label, [layer.id]), 0)
  }
  const setSmartFilters = (next: NonNullable<Layer["smartFilters"]>, label: string) => {
    previewSmartFilters(next)
    commitSmartFilters(label)
  }
  const moveSmartFilterByDrop = (fromId: string | null, toId: string) => {
    if (!fromId || fromId === toId) return
    const filters = layer.smartFilters ?? []
    const from = filters.findIndex((filter) => filter.id === fromId)
    const to = filters.findIndex((filter) => filter.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...filters]
    const [entry] = next.splice(from, 1)
    next.splice(to, 0, entry)
    setSmartFilters(next, "Reorder Smart Filter")
  }
  const editSmartFilterMask = (filterId: string) => {
    const filter = layer.smartFilters?.find((sf) => sf.id === filterId)
    if (!filter) return
    if (!filter.mask) {
      dispatch({ type: "set-smart-filter-mask", layerId: layer.id, filterId, mask: makeCanvas(doc.width, doc.height, "#ffffff"), enabled: true })
      commitSmartFilters("Reveal Smart Filter Mask")
    } else if (filter.maskEnabled === false) {
      previewSmartFilters((layer.smartFilters ?? []).map((sf) => sf.id === filterId ? { ...sf, maskEnabled: true } : sf))
      commitSmartFilters("Enable Smart Filter Mask")
    }
    dispatch({ type: "set-active-smart-filter-mask", target: { layerId: layer.id, filterId } })
    dispatch({ type: "set-tool", tool: "brush" })
    requestRender()
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
              onClick={() => dispatchPhotoshopEvent("ps-open-filter-gallery")}
            >
              Edit
            </button>
          </div>
          {(layer.smartFilters?.length ?? 0) === 0 ? (
            <div className="px-2 py-2 text-[10px] text-[var(--ps-text-dim)]">No smart filters.</div>
          ) : (
            <div className="divide-y divide-[var(--ps-divider)]">
              {layer.smartFilters!.map((filter, idx) => {
                const enabled = filter.enabled !== false
                const maskEnabled = filter.maskEnabled !== false
                const maskLinked = filter.maskLinked !== false
                const editing = activeSmartFilterMaskTarget?.layerId === layer.id && activeSmartFilterMaskTarget.filterId === filter.id
                return (
                <div
                  key={filter.id}
                  draggable
                  data-testid={`properties-smart-filter-row-${filter.name}`}
                  data-smart-filter-enabled={enabled ? "true" : "false"}
                  data-smart-filter-mask-editing={editing ? "true" : "false"}
                  className="space-y-1 px-2 py-1.5 text-[10px]"
                  onDragStart={(e) => {
                    setDraggedSmartFilterId(filter.id)
                    e.dataTransfer.setData("application/x-ps-smart-filter-id", filter.id)
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  onDragOver={(e) => {
                    const sourceId = e.dataTransfer.getData("application/x-ps-smart-filter-id") || draggedSmartFilterId
                    if (!sourceId || sourceId === filter.id) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "move"
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    moveSmartFilterByDrop(e.dataTransfer.getData("application/x-ps-smart-filter-id") || draggedSmartFilterId, filter.id)
                    setDraggedSmartFilterId(null)
                  }}
                  onDragEnd={() => setDraggedSmartFilterId(null)}
                  onDoubleClick={() => dispatchPhotoshopEvent("ps-open-filter-gallery")}
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`${enabled ? "Disable" : "Enable"} ${filter.name} smart filter`}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
                      title={enabled ? "Disable filter" : "Enable filter"}
                      onClick={() =>
                        setSmartFilters(
                          layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, enabled: !enabled } : sf),
                          "Toggle Smart Filter",
                        )
                      }
                    >
                      {enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <SmartFilterMaskThumb
                      layerId={layer.id}
                      filterName={filter.name}
                      mask={filter.mask}
                      enabled={maskEnabled}
                      linked={maskLinked}
                      editing={editing}
                      density={filter.maskDensity ?? 1}
                      feather={filter.maskFeather ?? 0}
                    />
                    <button
                      type="button"
                      aria-label={`${maskLinked ? "Unlink" : "Link"} ${filter.name} smart filter mask`}
                      title={`${maskLinked ? "Unlink" : "Link"} smart filter mask`}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
                      onClick={() =>
                        setSmartFilters(
                          layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, maskLinked: !maskLinked } : sf),
                          "Toggle Smart Filter Mask Link",
                        )
                      }
                    >
                      {maskLinked ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
                    </button>
                    <span className={enabled ? "flex-1 truncate" : "flex-1 truncate line-through text-[var(--ps-text-dim)]"}>
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
                          previewSmartFilters(
                            layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, opacity: v[0] / 100 } : sf),
                          )
                        }
                        onValueCommit={() => commitSmartFilters("Smart Filter Opacity")}
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
                    <button
                      type="button"
                      className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 hover:bg-[var(--ps-tool-hover)]"
                      onClick={() => editSmartFilterMask(filter.id)}
                    >
                      Edit mask
                    </button>
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
                  {filter.mask ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1">
                        <span className="text-[var(--ps-text-dim)]">Density {Math.round((filter.maskDensity ?? 1) * 100)}%</span>
                        <Slider
                          min={0}
                          max={100}
                          value={[Math.round((filter.maskDensity ?? 1) * 100)]}
                          onValueChange={(v) =>
                            previewSmartFilters(
                              layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, maskDensity: v[0] / 100 } : sf),
                            )
                          }
                          onValueCommit={() => commitSmartFilters("Smart Filter Mask Density")}
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[var(--ps-text-dim)]">Feather {Math.round(filter.maskFeather ?? 0)} px</span>
                        <Slider
                          min={0}
                          max={250}
                          value={[Math.round(filter.maskFeather ?? 0)]}
                          onValueChange={(v) =>
                            previewSmartFilters(
                              layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, maskFeather: v[0] } : sf),
                            )
                          }
                          onValueCommit={() => commitSmartFilters("Smart Filter Mask Feather")}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

function SmartFilterMaskThumb({
  layerId,
  filterName,
  mask,
  enabled,
  linked,
  editing,
  density,
  feather,
}: {
  layerId: string
  filterName: string
  mask?: HTMLCanvasElement | null
  enabled: boolean
  linked: boolean
  editing: boolean
  density: number
  feather: number
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const state = smartFilterMaskState(mask, enabled)
  const draw = React.useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
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
      ctx.strokeStyle = "#666"
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
  }, [mask, enabled, linked, editing, density, feather])
  React.useEffect(() => {
    draw()
  }, [draw])
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
      data-testid={`properties-smart-filter-mask-thumb-${filterName}`}
      data-smart-filter-mask-state={state}
      data-smart-filter-mask-linked={linked ? "true" : "false"}
      data-smart-filter-mask-density={String(Math.round(Math.max(0, Math.min(1, density)) * 100))}
      data-smart-filter-mask-feather={String(Math.round(Math.max(0, feather)))}
      className={`shrink-0 rounded-sm border ${editing ? "border-[var(--ps-accent)]" : "border-[var(--ps-divider)]"}`}
      title={`Smart filter mask: ${state}, ${linked ? "linked" : "unlinked"}, density ${Math.round(Math.max(0, Math.min(1, density)) * 100)}%, feather ${Math.round(Math.max(0, feather))} px`}
      aria-label={editing ? `Editing ${filterName} smart filter mask` : `${filterName} smart filter mask`}
    />
  )
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
  const textFont = layer?.kind === "text" ? layer.text?.font : undefined
  const textEmbeddedFont = layer?.kind === "text" && layer.text
    ? layer.text.embeddedFont ?? findEmbeddedFontForFamily(doc.assetLibrary, layer.text.font)
    : undefined
  const [fontInspection, setFontInspection] = React.useState<VariableFontInspection | null>(null)
  const [customAxisTag, setCustomAxisTag] = React.useState("")

  React.useEffect(() => {
    if (!textFont) {
      setFontInspection(null)
      return
    }
    let cancelled = false
    inspectVariableFont(textFont, { embeddedFont: textEmbeddedFont }).then((inspection) => {
      if (!cancelled) setFontInspection(inspection)
    })
    return () => {
      cancelled = true
    }
  }, [textFont, textEmbeddedFont])

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
    const embeddedFont = textEmbeddedFont
    const preview = buildFontPreview(layer.text.font, "Ag 123", {
      size: 20,
      weight: layer.text.weight,
      italic: layer.text.italic,
      color: layer.text.color,
      variableAxes: layer.text.variableAxes,
      variableAxisDefinitions: layer.text.variableAxisDefinitions,
    })
    const axisModel = buildVariableFontAxisControlModel(layer.text, fontInspection)
    const axisDefinitions = axisModel.axes.length
      ? axisModel.axes
      : DEFAULT_VARIABLE_AXIS_DEFINITIONS.map((axis) => ({ ...axis, value: layer.text!.variableAxes?.[axis.tag] ?? axis.defaultValue, source: "default" as const }))
    const featureSupport = detectOpenTypeFeatureSupport(layer.text.font, { embeddedFont })
    const openTypeToggles = listOpenTypeFeatureToggles(featureSupport.supportedTags.size ? { supportedTags: featureSupport.supportedTags } : {})
    const matchFontResult = matchFontForLayer(layer.text)
    const imageMatchFontResult = (() => {
      try {
        const ctx = layer.canvas?.getContext("2d")
        if (!ctx || !layer.canvas?.width || !layer.canvas?.height) return null
        return matchFontFromImageData(ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height), {
          expectedText: layer.text!.content,
          fontSize: layer.text!.size,
        })
      } catch {
        return null
      }
    })()
    const activeMatchFontResult = imageMatchFontResult && imageMatchFontResult.recognition.confidence > 0.45
      ? imageMatchFontResult
      : matchFontResult
    const textPathModel = buildTextPathHandleModel(layer.text)
    const comparison = buildFontSubstitutionComparison(
      layer.text.missingFontOriginal ?? layer.text.font,
      fontStatus?.substitute ?? layer.text.fontSubstitution ?? layer.text.font,
      layer.text.content || "The quick brown fox 123",
      { color: layer.text.color },
    )
    const baseShapeInset = layer.text.textShapeInset ?? 8
    const textShapeInsets = layer.text.textShapeInsets ?? {
      top: baseShapeInset,
      right: baseShapeInset,
      bottom: baseShapeInset,
      left: baseShapeInset,
    }
    const axisValue = (tag: string, fallback: number) => layer.text!.variableAxes?.[tag] ?? fallback
    const updateAxis = (tag: string, value: number) => {
      updateText({ variableAxes: { ...(layer.text!.variableAxes ?? {}), [tag]: value } })
    }
    const inspectActiveTextFont = async (allowLocalFontAccess = false) => {
      const inspection = await inspectVariableFont(layer.text!.font, { allowLocalFontAccess, embeddedFont })
      setFontInspection(inspection)
      if (inspection.axes.length && allowLocalFontAccess) {
        updateText({ variableAxisDefinitions: inspection.axes })
        window.setTimeout(() => commit("Inspect Variable Font", [layer.id]), 0)
      }
    }
    const addCustomAxis = () => {
      const tag = customAxisTag.trim().slice(0, 4)
      if (!/^[A-Za-z0-9]{4}$/.test(tag)) return
      updateText({
        variableAxes: { ...(layer.text!.variableAxes ?? {}), [tag]: layer.text!.variableAxes?.[tag] ?? 0 },
        variableAxisDefinitions: [
          ...(layer.text!.variableAxisDefinitions ?? []),
          { tag, name: tag.toUpperCase(), min: -1000, max: 1000, defaultValue: 0 },
        ].filter((axis, index, all) => all.findIndex((candidate) => candidate.tag === axis.tag) === index),
      })
      setCustomAxisTag("")
      window.setTimeout(() => commit(`Add Variable Axis ${tag}`, [layer.id]), 0)
    }
    const updateShapeInset = (side: keyof typeof textShapeInsets, value: number) => {
      updateText({ textShapeInsets: { ...textShapeInsets, [side]: Math.max(0, value) } })
    }
    const applySubstitution = () => {
      const result = resolveFontSubstitutions([layer], { fallbackFont: fontStatus?.substitute ?? "Arial" })
      const next = result.layers[0]?.text
      if (!next || !result.changedLayerIds.includes(layer.id)) return
      updateText(next)
      window.setTimeout(() => commit("Substitute Missing Font", [layer.id]), 0)
    }
    const restoreOriginalFont = () => {
      if (!layer.text!.missingFontOriginal) return
      updateText({
        font: layer.text!.missingFontOriginal,
        missingFontOriginal: undefined,
        fontSubstitution: undefined,
      })
      window.setTimeout(() => commit("Restore Missing Font", [layer.id]), 0)
    }
    const attachPath = () => {
      if (!pathLayer) return
      const points =
        pathLayer.path?.points ??
        (pathLayer.shape ? shapeToEditablePath(pathLayer.shape).points : undefined)
      if (!points?.length) return
      updateText({ textPath: points })
      window.setTimeout(() => commit("Type on Path", [layer.id]), 0)
    }
    const putInsideShape = () => {
      if (!shapeLayer?.shape) return
      updateText(applyTextInsideShape(layer.text!, shapeLayer.shape, {
        insets: textShapeInsets,
        verticalAlign: layer.text!.textShapeVerticalAlign ?? "top",
      }))
      window.setTimeout(() => commit("Text Inside Shape", [layer.id]), 0)
    }
    const convertToPath = () => {
      const path = convertTextToEditablePath({ ...layer.text!, embeddedFont })
      dispatch({ type: "set-layer-path", id: layer.id, path })
      dispatch({ type: "set-layer-kind", id: layer.id, kind: "shape" })
      window.setTimeout(() => commit("Convert Text to Path", [layer.id]), 0)
    }
    const applyMatchedFont = (best = activeMatchFontResult.best) => {
      updateText({
        font: best.family,
        variableAxisDefinitions: best.variableAxes,
        variableAxes: best.variableAxes?.length ? { wght: layer.text!.weight === "bold" ? 700 : 400 } : layer.text!.variableAxes,
      })
      window.setTimeout(() => commit(`Match Font: ${best.family}`, [layer.id]), 0)
    }
    const updatePathPoint = (index: number, point: { x: number; y: number }) => {
      updateText(updateTextPathPoint(layer.text!, index, point))
    }
    const addPathPoint = (index: number) => {
      const current = layer.text!.textPath ?? []
      const before = current[Math.max(0, index - 1)] ?? current[0] ?? { x: layer.text!.x, y: layer.text!.y }
      const after = current[index] ?? before
      updateText(insertTextPathPoint(layer.text!, index, { x: Math.round((before.x + after.x) / 2), y: Math.round((before.y + after.y) / 2) }))
      window.setTimeout(() => commit("Add Type Path Point", [layer.id]), 0)
    }
    const removePathPoint = (index: number) => {
      updateText(deleteTextPathPoint(layer.text!, index))
      window.setTimeout(() => commit("Delete Type Path Point", [layer.id]), 0)
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
        {fontStatus?.status === "missing" ? (
          <button
            type="button"
            onClick={applySubstitution}
            className="h-7 rounded-sm border border-[var(--ps-divider)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]"
          >
            Apply Substitute Font
          </button>
        ) : null}
        {layer.text.missingFontOriginal ? (
          <div className="grid grid-cols-[70px_1fr] items-center gap-2">
            <span className="text-[var(--ps-text-dim)]">Original</span>
            <button
              type="button"
              onClick={restoreOriginalFont}
              className="min-h-6 rounded-sm border border-[var(--ps-divider)] px-2 text-left text-[10px] hover:bg-[var(--ps-tool-hover)]"
              title={layer.text.missingFontOriginal}
            >
              {layer.text.missingFontOriginal}
            </button>
          </div>
        ) : null}
        <div className="space-y-1">
          <div className="grid grid-cols-2 gap-1">
            {[comparison.original, comparison.fallback].map((item, index) => (
              <div key={`${item.family}-${index}`} className="min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 py-1">
                <div className="truncate text-[9px] text-[var(--ps-text-dim)]">{index === 0 ? "Original" : "Fallback"} · {item.family}</div>
                {item.canvasDataUrl ? (
                  <img src={item.canvasDataUrl} alt="" className="mt-1 h-10 w-full rounded-sm object-cover" />
                ) : (
                  <div className="truncate text-[15px]" style={item.previewStyle as React.CSSProperties}>{item.sample}</div>
                )}
                <div className="mt-1 grid grid-cols-2 gap-1 text-[9px] tabular-nums text-[var(--ps-text-dim)]">
                  <span>W {item.geometry.averageGlyphWidth.toFixed(2)}</span>
                  <span>XH {item.geometry.xHeight.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[9px] text-[var(--ps-text-dim)]">
            Fallback delta: width {comparison.geometryDelta.averageGlyphWidth >= 0 ? "+" : ""}{comparison.geometryDelta.averageGlyphWidth.toFixed(2)}, x-height {comparison.geometryDelta.xHeight >= 0 ? "+" : ""}{comparison.geometryDelta.xHeight.toFixed(2)}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {comparison.specimens.slice(0, 6).map((specimen) => (
              <button
                key={`${specimen.source}-${specimen.family}`}
                type="button"
                onClick={() => updateText({ font: specimen.family })}
                onBlur={() => commit("Type Font Specimen", [layer.id])}
                className="min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
                title={`${specimen.source}: ${specimen.family}`}
              >
                <span className="block truncate text-[9px] text-[var(--ps-text-dim)]">{specimen.family}</span>
                <span className="block truncate text-[13px]" style={specimen.previewStyle as React.CSSProperties}>Ag 123</span>
              </button>
            ))}
          </div>
        </div>
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
        <Row label="Writing">
          <select
            value={layer.text.vertical ? (layer.text.verticalWritingMode === "lr" ? "vertical-lr" : "vertical-rl") : "horizontal"}
            onChange={(e) => {
              const value = e.target.value
              updateText({
                vertical: value !== "horizontal",
                verticalWritingMode: value === "vertical-lr" ? "lr" : "rl",
              })
            }}
            onBlur={() => commit("Type Writing Mode", [layer.id])}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="horizontal">Horizontal</option>
            <option value="vertical-rl">Vertical RL</option>
            <option value="vertical-lr">Vertical LR</option>
          </select>
        </Row>
        <Row label="Orientation">
          <select
            value={layer.text.textOrientation ?? (layer.text.tateChuYoko ? "mixed" : "upright")}
            onChange={(e) => updateText({ textOrientation: e.target.value as NonNullable<Layer["text"]>["textOrientation"] })}
            onBlur={() => commit("Type Orientation", [layer.id])}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="mixed">Mixed</option>
            <option value="upright">Upright</option>
            <option value="sideways">Sideways</option>
          </select>
        </Row>
        <Row label="Vert Align">
          <select
            value={layer.text.verticalAlign ?? "top"}
            onChange={(e) => updateText({ verticalAlign: e.target.value as NonNullable<Layer["text"]>["verticalAlign"] })}
            onBlur={() => commit("Type Vertical Align", [layer.id])}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </Row>
        <Row label="Mojikumi">
          <select
            value={layer.text.mojikumi ?? "default"}
            onChange={(e) => updateText({ mojikumi: e.target.value as NonNullable<Layer["text"]>["mojikumi"] })}
            onBlur={() => commit("Type Mojikumi", [layer.id])}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="default">Default</option>
            <option value="compact">Compact</option>
            <option value="loose">Loose</option>
            <option value="none">None</option>
          </select>
        </Row>
        <div className="grid grid-cols-2 gap-1">
          <QuickToggle label="Tate Chu Yoko" active={!!layer.text.tateChuYoko} onClick={() => { updateText({ tateChuYoko: !layer.text!.tateChuYoko }); commit("Type Tate Chu Yoko", [layer.id]) }} />
          <QuickToggle label="Proportional Metrics" active={!!layer.text.verticalUseProportionalMetrics} onClick={() => { updateText({ verticalUseProportionalMetrics: !layer.text!.verticalUseProportionalMetrics }); commit("Type Vertical Metrics", [layer.id]) }} />
          <QuickToggle label="Path Flip" active={!!layer.text.textPathFlip} onClick={() => { updateText({ textPathFlip: !layer.text!.textPathFlip }); commit("Type Path Flip", [layer.id]) }} />
          <QuickToggle label="Path Closed" active={!!layer.text.textPathClosed} onClick={() => { updateText({ textPathClosed: !layer.text!.textPathClosed }); commit("Type Path Closed", [layer.id]) }} />
        </div>
        <div className="grid grid-cols-3 gap-1">
          <NumberField label="Col Gap" value={Math.round(layer.text.verticalColumnGap ?? layer.text.leading ?? layer.text.size * 1.2)} onChange={(value) => updateText({ verticalColumnGap: Math.max(0, value) })} onCommit={() => commit("Type Vertical Column Gap", [layer.id])} />
          <NumberField label="Glyph Gap" value={layer.text.verticalGlyphSpacing ?? 0} onChange={(value) => updateText({ verticalGlyphSpacing: value })} onCommit={() => commit("Type Vertical Glyph Spacing", [layer.id])} />
          <NumberField label="Glyph %" value={Math.round((layer.text.verticalGlyphScale ?? 1) * 100)} onChange={(value) => updateText({ verticalGlyphScale: Math.max(10, Math.min(400, value)) / 100 })} onCommit={() => commit("Type Vertical Glyph Scale", [layer.id])} />
        </div>
        <Row label="Path Align">
          <select
            value={layer.text.textPathAlign ?? "start"}
            onChange={(e) => updateText({ textPathAlign: e.target.value as NonNullable<Layer["text"]>["textPathAlign"] })}
            onBlur={() => commit("Type Path Align", [layer.id])}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="start">Start</option>
            <option value="center">Center</option>
            <option value="end">End</option>
          </select>
        </Row>
        <div className="grid grid-cols-2 gap-1">
          <NumberField label="Path Start" value={layer.text.textPathStartOffset ?? 0} onChange={(value) => updateText({ textPathStartOffset: value })} onCommit={() => commit("Type Path Start", [layer.id])} />
          <NumberField label="Path Base" value={layer.text.textPathBaselineOffset ?? 0} onChange={(value) => updateText({ textPathBaselineOffset: value })} onCommit={() => commit("Type Path Baseline", [layer.id])} />
        </div>
        {layer.text.textPath?.length ? (
          <div className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
            <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--ps-text-dim)]">
              <span>Path Handles · {Math.round(textPathModel.totalLength)} px</span>
              <button
                type="button"
                className="h-5 rounded-sm border border-[var(--ps-divider)] px-1.5 text-[9px] hover:bg-[var(--ps-tool-hover)]"
                onClick={() => { updateText(reverseTextPath(layer.text!)); commit("Reverse Type Path", [layer.id]) }}
              >
                Reverse
              </button>
            </div>
            <div className="max-h-36 space-y-1 overflow-auto">
              {textPathModel.points.map((point) => (
                <div key={point.index} className="grid grid-cols-[22px_1fr_1fr_22px_22px] items-end gap-1">
                  <span className="pb-1 text-[9px] text-[var(--ps-text-dim)]">{point.label}</span>
                  <NumberField label="X" value={Math.round(point.x)} onChange={(value) => updatePathPoint(point.index, { x: value, y: point.y })} onCommit={() => commit("Move Type Path Point", [layer.id])} />
                  <NumberField label="Y" value={Math.round(point.y)} onChange={(value) => updatePathPoint(point.index, { x: point.x, y: value })} onCommit={() => commit("Move Type Path Point", [layer.id])} />
                  <button
                    type="button"
                    className="h-6 rounded-sm border border-[var(--ps-divider)] text-[10px] hover:bg-[var(--ps-tool-hover)]"
                    title="Insert point after this point"
                    onClick={() => addPathPoint(point.index + 1)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="h-6 rounded-sm border border-[var(--ps-divider)] text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
                    disabled={textPathModel.points.length <= 2}
                    title="Delete this point"
                    onClick={() => removePathPoint(point.index)}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-[var(--ps-text-dim)]">
              Start handle {Math.round(textPathModel.startHandle.x)}, {Math.round(textPathModel.startHandle.y)} · baseline {textPathModel.baselineHandle.offset}px
            </div>
          </div>
        ) : null}
        <Row label="Inside Align">
          <select
            value={layer.text.textShapeVerticalAlign ?? "top"}
            onChange={(e) => updateText({ textShapeVerticalAlign: e.target.value as NonNullable<Layer["text"]>["textShapeVerticalAlign"] })}
            onBlur={() => commit("Text Shape Align", [layer.id])}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </Row>
        <div className="grid grid-cols-4 gap-1">
          <NumberField label="Inset T" value={textShapeInsets.top} onChange={(value) => updateShapeInset("top", value)} onCommit={() => commit("Text Shape Insets", [layer.id])} />
          <NumberField label="Inset R" value={textShapeInsets.right} onChange={(value) => updateShapeInset("right", value)} onCommit={() => commit("Text Shape Insets", [layer.id])} />
          <NumberField label="Inset B" value={textShapeInsets.bottom} onChange={(value) => updateShapeInset("bottom", value)} onCommit={() => commit("Text Shape Insets", [layer.id])} />
          <NumberField label="Inset L" value={textShapeInsets.left} onChange={(value) => updateShapeInset("left", value)} onCommit={() => commit("Text Shape Insets", [layer.id])} />
        </div>
        <div className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--ps-text-dim)]">
            <span>Variable Axes · {axisModel.source}</span>
            <button
              type="button"
              onClick={() => void inspectActiveTextFont(true)}
              className="h-5 rounded-sm border border-[var(--ps-divider)] px-1.5 text-[9px] hover:bg-[var(--ps-tool-hover)]"
            >
              Inspect
            </button>
          </div>
          <div className="text-[9px] leading-snug text-[var(--ps-text-dim)]">{axisModel.status}</div>
          {axisModel.namedInstances.length ? (
            <select
              value={layer.text.variableNamedInstance ?? ""}
              onChange={(event) => {
                const instance = axisModel.namedInstances.find((candidate) => candidate.name === event.target.value)
                if (!instance) {
                  updateText({ variableNamedInstance: undefined })
                  return
                }
                updateText({
                  variableAxes: instance.coordinates,
                  variableNamedInstance: instance.name,
                  variableAxisDefinitions: axisDefinitions,
                })
                window.setTimeout(() => commit(`Variable Font ${instance.name}`, [layer.id]), 0)
              }}
              className="h-6 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1 text-[10px]"
            >
              <option value="">Custom instance</option>
              {axisModel.namedInstances.map((instance) => (
                <option key={instance.name} value={instance.name}>{instance.label} · {instance.summary}</option>
              ))}
            </select>
          ) : null}
          <div className="grid grid-cols-2 gap-1">
            {axisDefinitions.map((axis) => (
              <div key={axis.tag} className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-1">
                <NumberField
                  label={`${axis.tag} ${axis.name}`}
                  value={axisValue(axis.tag, axis.defaultValue)}
                  onChange={(value) => updateAxis(axis.tag, Math.max(axis.min, Math.min(axis.max, value)))}
                  onCommit={() => commit("Variable Font Axis", [layer.id])}
                />
                <div className="flex items-center justify-between text-[8px] text-[var(--ps-text-dim)]">
                  <span>{axis.min}/{axis.defaultValue}/{axis.max}</span>
                  <button
                    type="button"
                    className="rounded-sm border border-[var(--ps-divider)] px-1 hover:bg-[var(--ps-tool-hover)]"
                    onClick={() => { updateAxis(axis.tag, axis.defaultValue); commit("Variable Font Axis", [layer.id]) }}
                  >
                    Default
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_44px] gap-1">
            <input
              value={customAxisTag}
              maxLength={4}
              onChange={(event) => setCustomAxisTag(event.target.value)}
              placeholder="Tag"
              className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1 text-[10px]"
            />
            <button
              type="button"
              onClick={addCustomAxis}
              className="h-6 rounded-sm border border-[var(--ps-divider)] text-[10px] hover:bg-[var(--ps-tool-hover)]"
            >
              Add
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {openTypeToggles.map((toggle) => {
            const value = layer.text!.openType?.[toggle.key] ?? (layer.text! as unknown as Record<string, boolean | undefined>)[toggle.key] ?? toggle.defaultEnabled
            return (
              <QuickToggle
                key={toggle.tag}
                label={toggle.label}
                active={!!value}
                onClick={() => {
                  updateText({ openType: { ...(layer.text!.openType ?? {}), [toggle.key]: !value } })
                  commit(`Type ${toggle.label}`, [layer.id])
                }}
              />
            )
          })}
          <QuickToggle label="All Caps" active={!!layer.text.allCaps} onClick={() => { updateText({ allCaps: !layer.text!.allCaps }); commit("Type Case", [layer.id]) }} />
        </div>
        <div className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="flex items-center justify-between text-[10px] text-[var(--ps-text-dim)]">
            <span>Match Font · {activeMatchFontResult.target.source}</span>
            <span>target W {activeMatchFontResult.target.averageGlyphWidth.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {activeMatchFontResult.candidates.slice(0, 4).map((candidate) => (
              <button
                key={candidate.family}
                type="button"
                onClick={() => applyMatchedFont(candidate)}
                className="min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
                title={candidate.reasons.join("; ")}
              >
                <span className="block truncate text-[10px]">{candidate.family}</span>
                <span className="block truncate text-[9px] text-[var(--ps-text-dim)]">{Math.round(candidate.score * 100)}% · {candidate.geometry.source}</span>
              </button>
            ))}
          </div>
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
          <QuickBtn label="Match Font" onClick={() => applyMatchedFont()} />
          <QuickBtn label="Inside Shape" onClick={putInsideShape} />
          <QuickBtn label="Convert Path" onClick={convertToPath} />
          <QuickBtn label="3D Text" onClick={create3DText} />
        </div>
      </Section>
    )
  }

  // Shape tool
  if (layer?.shape) {
    const updateShape = (patch: Partial<NonNullable<Layer["shape"]>>) => {
      dispatch({ type: "set-layer-shape", id: layer.id, shape: { ...layer.shape!, ...patch } })
      requestRender()
    }
    const appearance = createDefaultShapeAppearance(layer.shape)
    const updateAppearance = (patch: Partial<typeof appearance>) => {
      updateShape({ appearance: { ...appearance, ...patch } })
    }
    const updateFill = (index: number, patch: Partial<(typeof appearance.fills)[number]>) => {
      updateAppearance({ fills: appearance.fills.map((fill, i) => i === index ? { ...fill, ...patch } : fill) })
    }
    const updateStroke = (index: number, patch: Partial<(typeof appearance.strokes)[number]>) => {
      updateAppearance({ strokes: appearance.strokes.map((stroke, i) => i === index ? { ...stroke, ...patch } : stroke) })
    }
    const moveFill = (index: number, offset: number) => {
      const nextIndex = Math.max(0, Math.min(appearance.fills.length - 1, index + offset))
      if (nextIndex === index) return
      const fills = [...appearance.fills]
      const [item] = fills.splice(index, 1)
      fills.splice(nextIndex, 0, item)
      updateAppearance({ fills })
    }
    const moveStroke = (index: number, offset: number) => {
      const nextIndex = Math.max(0, Math.min(appearance.strokes.length - 1, index + offset))
      if (nextIndex === index) return
      const strokes = [...appearance.strokes]
      const [item] = strokes.splice(index, 1)
      strokes.splice(nextIndex, 0, item)
      updateAppearance({ strokes })
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
          <NumberField label="Rotate °" value={Math.round(layer.shape.rotation ?? 0)} onChange={(value) => updateShape({ rotation: value })} onCommit={() => commit("Shape Rotation", [layer.id])} />
        </div>
        {layer.shape.type === "rect" ? (
          <>
            <Row label="Uniform R">
              <NumberField
                label=""
                value={layer.shape.radius ?? 0}
                onChange={(value) => {
                  const r = Math.max(0, value)
                  updateShape({ radius: r, cornerRadii: [r, r, r, r] })
                }}
                onCommit={() => commit("Shape Radius", [layer.id])}
              />
            </Row>
            <div className="grid grid-cols-2 gap-1">
              <NumberField
                label="TL"
                value={Math.round((layer.shape.cornerRadii?.[0] ?? layer.shape.radius ?? 0))}
                onChange={(value) => {
                  const c = (layer.shape!.cornerRadii ?? [layer.shape!.radius ?? 0, layer.shape!.radius ?? 0, layer.shape!.radius ?? 0, layer.shape!.radius ?? 0]) as [number, number, number, number]
                  updateShape({ cornerRadii: [Math.max(0, value), c[1], c[2], c[3]] })
                }}
                onCommit={() => commit("Corner TL", [layer.id])}
              />
              <NumberField
                label="TR"
                value={Math.round((layer.shape.cornerRadii?.[1] ?? layer.shape.radius ?? 0))}
                onChange={(value) => {
                  const c = (layer.shape!.cornerRadii ?? [layer.shape!.radius ?? 0, layer.shape!.radius ?? 0, layer.shape!.radius ?? 0, layer.shape!.radius ?? 0]) as [number, number, number, number]
                  updateShape({ cornerRadii: [c[0], Math.max(0, value), c[2], c[3]] })
                }}
                onCommit={() => commit("Corner TR", [layer.id])}
              />
              <NumberField
                label="BL"
                value={Math.round((layer.shape.cornerRadii?.[3] ?? layer.shape.radius ?? 0))}
                onChange={(value) => {
                  const c = (layer.shape!.cornerRadii ?? [layer.shape!.radius ?? 0, layer.shape!.radius ?? 0, layer.shape!.radius ?? 0, layer.shape!.radius ?? 0]) as [number, number, number, number]
                  updateShape({ cornerRadii: [c[0], c[1], c[2], Math.max(0, value)] })
                }}
                onCommit={() => commit("Corner BL", [layer.id])}
              />
              <NumberField
                label="BR"
                value={Math.round((layer.shape.cornerRadii?.[2] ?? layer.shape.radius ?? 0))}
                onChange={(value) => {
                  const c = (layer.shape!.cornerRadii ?? [layer.shape!.radius ?? 0, layer.shape!.radius ?? 0, layer.shape!.radius ?? 0, layer.shape!.radius ?? 0]) as [number, number, number, number]
                  updateShape({ cornerRadii: [c[0], c[1], Math.max(0, value), c[3]] })
                }}
                onCommit={() => commit("Corner BR", [layer.id])}
              />
            </div>
          </>
        ) : null}
        {layer.shape.type === "polygon" ? (
          <div className="grid grid-cols-2 gap-1">
            <NumberField
              label="Sides"
              value={layer.shape.sides ?? 6}
              onChange={(value) => updateShape({ sides: Math.max(3, Math.min(64, Math.round(value))) })}
              onCommit={() => commit("Polygon Sides", [layer.id])}
            />
            <NumberField
              label="Roundness"
              value={Math.round((layer.shape.vertexRoundness ?? 0) * 100)}
              onChange={(value) => updateShape({ vertexRoundness: Math.max(0, Math.min(1, value / 100)) })}
              onCommit={() => commit("Polygon Roundness", [layer.id])}
            />
          </div>
        ) : null}
        {layer.shape.type === "star" ? (
          <div className="grid grid-cols-2 gap-1">
            <NumberField
              label="Points"
              value={layer.shape.starPoints ?? layer.shape.sides ?? 5}
              onChange={(value) => updateShape({ starPoints: Math.max(3, Math.min(32, Math.round(value))) })}
              onCommit={() => commit("Star Points", [layer.id])}
            />
            <NumberField
              label="Inner %"
              value={Math.round((layer.shape.innerRadiusRatio ?? 0.45) * 100)}
              onChange={(value) => updateShape({ innerRadiusRatio: Math.max(0.05, Math.min(0.95, value / 100)) })}
              onCommit={() => commit("Star Inner Radius", [layer.id])}
            />
            <NumberField
              label="Roundness"
              value={Math.round((layer.shape.vertexRoundness ?? 0) * 100)}
              onChange={(value) => updateShape({ vertexRoundness: Math.max(0, Math.min(1, value / 100)) })}
              onCommit={() => commit("Star Roundness", [layer.id])}
            />
          </div>
        ) : null}
        <div className="space-y-1 border-t border-[var(--ps-divider)] pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--ps-text-dim)]">Fill Stack</span>
            <button
              type="button"
              className="h-5 rounded-sm border border-[var(--ps-divider)] px-2 text-[9px] hover:bg-[var(--ps-tool-hover)]"
              onClick={() => {
                updateAppearance({
                  fills: [
                    ...appearance.fills,
                    { id: `fill_${Date.now()}`, enabled: true, color: foreground, opacity: 1 },
                  ],
                })
                commit("Add Shape Fill", [layer.id])
              }}
            >
              Add
            </button>
          </div>
          {appearance.fills.map((fill, index) => (
            <div key={fill.id} className="grid grid-cols-[18px_26px_1fr_34px_34px_20px] items-center gap-1">
              <input
                type="checkbox"
                checked={fill.enabled}
                onChange={(e) => updateFill(index, { enabled: e.target.checked })}
                onBlur={() => commit("Shape Fill Stack", [layer.id])}
              />
              <input
                type="color"
                value={fill.color}
                onChange={(e) => updateFill(index, { color: e.target.value })}
                onBlur={() => commit("Shape Fill Stack", [layer.id])}
                className="h-5 w-6"
              />
              <NumberField
                label={`Fill ${index + 1}`}
                value={Math.round(fill.opacity * 100)}
                onChange={(value) => updateFill(index, { opacity: Math.max(0, Math.min(1, value / 100)) })}
                onCommit={() => commit("Shape Fill Opacity", [layer.id])}
              />
              <button type="button" className="h-5 rounded-sm border border-[var(--ps-divider)] text-[9px]" onClick={() => { moveFill(index, -1); commit("Reorder Shape Fill", [layer.id]) }}>Up</button>
              <button type="button" className="h-5 rounded-sm border border-[var(--ps-divider)] text-[9px]" onClick={() => { moveFill(index, 1); commit("Reorder Shape Fill", [layer.id]) }}>Down</button>
              <button type="button" className="h-5 rounded-sm border border-[var(--ps-divider)] text-[9px]" onClick={() => { updateAppearance({ fills: appearance.fills.filter((_, i) => i !== index) }); commit("Remove Shape Fill", [layer.id]) }}>X</button>
            </div>
          ))}
        </div>
        <div className="space-y-1 border-t border-[var(--ps-divider)] pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--ps-text-dim)]">Stroke Stack</span>
            <button
              type="button"
              className="h-5 rounded-sm border border-[var(--ps-divider)] px-2 text-[9px] hover:bg-[var(--ps-tool-hover)]"
              onClick={() => {
                updateAppearance({
                  strokes: [
                    ...appearance.strokes,
                    { id: `stroke_${Date.now()}`, enabled: true, color: background, width: Math.max(1, layer.shape!.stroke?.width ?? 2), opacity: 1, alignment: "center" },
                  ],
                })
                commit("Add Shape Stroke", [layer.id])
              }}
            >
              Add
            </button>
          </div>
          {appearance.strokes.map((stroke, index) => (
            <div key={stroke.id} className="space-y-1 rounded-sm border border-[var(--ps-divider)] p-1">
              <div className="grid grid-cols-[18px_26px_1fr_34px_34px_20px] items-center gap-1">
                <input
                  type="checkbox"
                  checked={stroke.enabled}
                  onChange={(e) => updateStroke(index, { enabled: e.target.checked })}
                  onBlur={() => commit("Shape Stroke Stack", [layer.id])}
                />
                <input
                  type="color"
                  value={stroke.color}
                  onChange={(e) => updateStroke(index, { color: e.target.value })}
                  onBlur={() => commit("Shape Stroke Stack", [layer.id])}
                  className="h-5 w-6"
                />
                <NumberField
                  label={`Stroke ${index + 1}`}
                  value={Math.round(stroke.width)}
                  onChange={(value) => updateStroke(index, { width: Math.max(0, value) })}
                  onCommit={() => commit("Shape Stroke Width", [layer.id])}
                />
                <button type="button" className="h-5 rounded-sm border border-[var(--ps-divider)] text-[9px]" onClick={() => { moveStroke(index, -1); commit("Reorder Shape Stroke", [layer.id]) }}>Up</button>
                <button type="button" className="h-5 rounded-sm border border-[var(--ps-divider)] text-[9px]" onClick={() => { moveStroke(index, 1); commit("Reorder Shape Stroke", [layer.id]) }}>Down</button>
                <button type="button" className="h-5 rounded-sm border border-[var(--ps-divider)] text-[9px]" onClick={() => { updateAppearance({ strokes: appearance.strokes.filter((_, i) => i !== index) }); commit("Remove Shape Stroke", [layer.id]) }}>X</button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <NumberField
                  label="Opacity"
                  value={Math.round(stroke.opacity * 100)}
                  onChange={(value) => updateStroke(index, { opacity: Math.max(0, Math.min(1, value / 100)) })}
                  onCommit={() => commit("Shape Stroke Opacity", [layer.id])}
                />
                <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
                  Align
                  <select
                    value={stroke.alignment ?? "center"}
                    onChange={(e) => updateStroke(index, { alignment: e.target.value as NonNullable<typeof stroke.alignment> })}
                    onBlur={() => commit("Shape Stroke Align", [layer.id])}
                    className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
                  >
                    <option value="inside">Inside</option>
                    <option value="center">Center</option>
                    <option value="outside">Outside</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
                  Dash
                  <input
                    value={(stroke.dash ?? []).join(",")}
                    onChange={(e) => {
                      const dash = e.target.value.split(",").map((part) => Number(part.trim())).filter((value) => Number.isFinite(value) && value > 0)
                      updateStroke(index, { dash: dash.length ? dash : undefined })
                    }}
                    onBlur={() => commit("Shape Stroke Dash", [layer.id])}
                    className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
                  />
                </label>
              </div>
            </div>
          ))}
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
