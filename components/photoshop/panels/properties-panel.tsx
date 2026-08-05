"use client"

import * as React from "react"
import { useEditorSelector, makeCanvas, useRenderSubscription } from "@/components/photoshop/editor/context"
import { dispatchPhotoshopEvent } from "@/editor/events"
import type { MergedRenderChange } from "@/editor/render-bus"
import { FILTERS, type FilterParam } from "@/editor/filters"
import { Slider } from "@/components/ui/slider"
import { Image, Layers as LayersIcon, Scissors, Wand2, Eye, EyeOff, Link2, Link2Off } from "lucide-react"
import type { Layer, BlendMode, PsDocument } from "@/editor/types"
import type { ActiveSmartFilterMaskTarget } from "@/editor/reducer"
import { BLEND_MODE_OPTIONS } from "@/editor/document/layer-options"
import { maskCoverageState } from "@/editor/document/mask-state"
import { autoContrast, autoTone } from "@/editor/document/auto-adjust"
import {
  EmptyState,
  LockBtn,
  NumberField,
  QuickBtn,
  Row,
  Section,
} from "@/components/photoshop/panels/properties-controls"
import { ToolSection } from "@/components/photoshop/panels/properties-tool-section"


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
  dispatch: (a: import("@/components/photoshop/editor/context").Action) => void
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
            dispatch({ type: "set-layer-blend", id: layer.id, blendMode: e.target.value as import("@/editor/types").BlendMode })
            commitLayerChange("Layer Blend Mode")
          }}
          className="bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 h-5 text-[10px] w-full"
        >
          {BLEND_MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
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
                            layer.smartFilters!.map((sf) => sf.id === filter.id ? { ...sf, blendMode: e.target.value as import("@/editor/types").BlendMode as BlendMode } : sf),
                            "Smart Filter Blend Mode",
                          )
                        }
                        className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
                      >
                        {BLEND_MODE_OPTIONS.map((mode) => (
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
  const state = maskCoverageState(mask, enabled)
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
