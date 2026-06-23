"use client"

import * as React from "react"
import { Copy, Droplet, Eye, Layers, Plus, Trash2, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { makeCanvas, useEditorSelector } from "../editor-context"
import { renderDocumentComposite } from "../document-io"
import type { AlphaChannel, PsDocument, Selection } from "../types"
import { cn } from "@/lib/utils"
import { uid } from "../uid"
import { parseAlphaChannelMetadata, simulateSpotChannelPreview } from "../color-channel-ops"

type PreviewChannel = "rgb" | "red" | "green" | "blue" | string
type LoadMode = "replace" | "add" | "subtract" | "intersect"

export function ChannelsPanel() {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const activeLayer = useEditorSelector((editor) => editor.activeLayer)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
  const [preview, setPreview] = React.useState<PreviewChannel>("rgb")
  const [loadMode, setLoadMode] = React.useState<LoadMode>("replace")

  if (!activeDoc) return null

  const selectedAlpha = (activeDoc.channels ?? []).find((ch) => ch.id === preview)
  const hasSelection = !!activeDoc.selection.bounds

  const saveSelection = () => {
    const mask = selectionToMask(activeDoc, activeDoc.selection)
    if (!mask) return
    const channel: AlphaChannel = {
      id: uid("ch"),
      name: `Alpha ${(activeDoc.channels?.length ?? 0) + 1}`,
      canvas: mask,
    }
    dispatch({ type: "save-selection", channel })
    setPreview(channel.id)
    commit("Save Alpha Channel", [])
  }

  const saveLuminosity = () => {
    createChannelFromComponent("luminosity")
  }

  const saveSpotChannel = () => {
    const mask = selectionToMask(activeDoc, activeDoc.selection) ?? createLuminosityMask(activeDoc)
    const channel: AlphaChannel = {
      id: uid("ch"),
      name: `Spot ${(activeDoc.channels?.length ?? 0) + 1}`,
      kind: "spot",
      spotColor: "#ff00ff",
      spotOpacity: 65,
      canvas: mask,
    }
    dispatch({ type: "save-selection", channel })
    setPreview(channel.id)
    commit("Create Spot Channel", [])
  }

  const createChannelFromComponent = (component: "red" | "green" | "blue" | "luminosity") => {
    const composite = renderDocumentComposite(activeDoc, { transparent: true })
    const ctx = composite.getContext("2d")!
    const img = ctx.getImageData(0, 0, composite.width, composite.height)
    const offset = component === "red" ? 0 : component === "green" ? 1 : component === "blue" ? 2 : -1
    for (let i = 0; i < img.data.length; i += 4) {
      const value =
        offset >= 0
          ? img.data[i + offset]
          : Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round((value * img.data[i + 3]) / 255)
    }
    ctx.putImageData(img, 0, 0)
    const channel: AlphaChannel = {
      id: uid("ch"),
      name: `${component[0].toUpperCase()}${component.slice(1)} ${(activeDoc.channels?.length ?? 0) + 1}`,
      canvas: composite,
    }
    dispatch({ type: "save-selection", channel })
    setPreview(channel.id)
    commit("Create Alpha Channel", [])
  }

  const duplicateChannel = () => {
    if (!selectedAlpha) return
    const copy = makeCanvas(activeDoc.width, activeDoc.height)
    copy.getContext("2d")!.drawImage(selectedAlpha.canvas, 0, 0)
    const channel: AlphaChannel = {
      ...selectedAlpha,
      id: uid("ch"),
      name: `${selectedAlpha.name} copy`,
      canvas: copy,
    }
    dispatch({ type: "save-selection", channel })
    setPreview(channel.id)
    commit("Duplicate Alpha Channel", [])
  }

  const invertSelected = () => {
    if (!selectedAlpha) return
    const copy = cloneChannelMask(activeDoc, selectedAlpha.canvas)
    const ctx = copy.getContext("2d")!
    const img = ctx.getImageData(0, 0, copy.width, copy.height)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = 255 - img.data[i + 3]
    }
    ctx.putImageData(img, 0, 0)
    dispatch({ type: "update-channel", channelId: selectedAlpha.id, patch: { canvas: copy } })
    commit("Invert Alpha Channel", [])
  }

  const applyAsLayerMask = () => {
    if (!selectedAlpha || !activeLayer) return
    dispatch({ type: "set-layer-mask", id: activeLayer.id, mask: cloneChannelMask(activeDoc, selectedAlpha.canvas) })
    commit("Apply Alpha as Layer Mask", [activeLayer.id])
  }

  const loadAlpha = (channel: AlphaChannel) => {
    dispatch({ type: "load-selection", channelId: channel.id, mode: loadMode })
    commit("Load Alpha Channel", [])
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="border-b border-[var(--ps-divider)] p-2 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" onClick={saveSelection} disabled={!hasSelection}>
            <Plus className="w-3.5 h-3.5" />
            Selection
          </Button>
          <Button variant="outline" size="sm" onClick={saveLuminosity}>
            <Wand2 className="w-3.5 h-3.5" />
            Luminance
          </Button>
          <Button variant="outline" size="sm" onClick={saveSpotChannel}>
            <Droplet className="w-3.5 h-3.5" />
            Spot
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <Button variant="outline" size="sm" onClick={() => createChannelFromComponent("red")}>Red</Button>
          <Button variant="outline" size="sm" onClick={() => createChannelFromComponent("green")}>Green</Button>
          <Button variant="outline" size="sm" onClick={() => createChannelFromComponent("blue")}>Blue</Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[var(--ps-text-dim)]">Load</span>
          <select
            value={loadMode}
            onChange={(e) => setLoadMode(e.target.value as LoadMode)}
            className="h-7 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
          >
            <option value="replace">Replace selection</option>
            <option value="add">Add to selection</option>
            <option value="subtract">Subtract from selection</option>
            <option value="intersect">Intersect selection</option>
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2 space-y-1">
        <ChannelRow doc={activeDoc} id="rgb" name="RGB" preview={preview} setPreview={setPreview} />
        <ChannelRow doc={activeDoc} id="red" name="Red" preview={preview} setPreview={setPreview} />
        <ChannelRow doc={activeDoc} id="green" name="Green" preview={preview} setPreview={setPreview} />
        <ChannelRow doc={activeDoc} id="blue" name="Blue" preview={preview} setPreview={setPreview} />
        <div className="pt-2 text-[10px] uppercase text-[var(--ps-text-dim)]">Alpha Channels</div>
        {(activeDoc.channels ?? []).length ? (
          (activeDoc.channels ?? []).map((channel) => (
            <AlphaRow
              key={channel.id}
              doc={activeDoc}
              channel={channel}
              selected={preview === channel.id}
              onSelect={() => setPreview(channel.id)}
              onLoad={() => loadAlpha(channel)}
              onDelete={() => {
                dispatch({ type: "delete-channel", channelId: channel.id })
                setPreview("rgb")
                commit("Delete Alpha Channel", [])
              }}
            />
          ))
        ) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-3 text-center text-[var(--ps-text-dim)]">
            No saved alpha channels
          </div>
        )}
      </div>

      {selectedAlpha ? (
        <div className="grid grid-cols-[1fr_72px_72px] items-end gap-2 border-t border-[var(--ps-divider)] p-2 text-[10px] text-[var(--ps-text-dim)]">
          <label className="grid gap-1">
            Type
            <select
              value={parseAlphaChannelMetadata(selectedAlpha).kind}
              onChange={(event) => {
                const kind = event.target.value as AlphaChannel["kind"]
                dispatch({
                  type: "update-channel",
                  channelId: selectedAlpha.id,
                  patch: kind === "spot"
                    ? { kind, spotColor: selectedAlpha.spotColor ?? "#ff00ff", spotOpacity: selectedAlpha.spotOpacity ?? 65 }
                    : { kind: "alpha", spotColor: undefined, spotOpacity: undefined },
                })
              }}
              className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)]"
            >
              <option value="alpha">Alpha</option>
              <option value="spot">Spot</option>
            </select>
          </label>
          <label className="grid gap-1">
            Ink
            <input
              type="color"
              value={parseAlphaChannelMetadata(selectedAlpha).spotColor ?? "#ff00ff"}
              disabled={parseAlphaChannelMetadata(selectedAlpha).kind !== "spot"}
              onChange={(event) => dispatch({ type: "update-channel", channelId: selectedAlpha.id, patch: { kind: "spot", spotColor: event.target.value } })}
              className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
            />
          </label>
          <label className="grid gap-1">
            Opacity
            <input
              type="number"
              min={0}
              max={100}
              value={parseAlphaChannelMetadata(selectedAlpha).spotOpacity ?? 50}
              disabled={parseAlphaChannelMetadata(selectedAlpha).kind !== "spot"}
              onChange={(event) => dispatch({ type: "update-channel", channelId: selectedAlpha.id, patch: { kind: "spot", spotOpacity: Math.max(0, Math.min(100, Number(event.target.value) || 0)) } })}
              className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)]"
            />
          </label>
        </div>
      ) : null}

      <div className="flex items-center gap-1 border-t border-[var(--ps-divider)] p-2">
        {selectedAlpha ? (
          <input
            aria-label="Alpha channel name"
            value={selectedAlpha.name}
            onChange={(event) => dispatch({ type: "update-channel", channelId: selectedAlpha.id, patch: { name: event.target.value } })}
            className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
          />
        ) : null}
        <Button variant="ghost" size="icon-sm" onClick={duplicateChannel} disabled={!selectedAlpha} title="Duplicate selected alpha">
          <Copy className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={invertSelected} disabled={!selectedAlpha} title="Invert selected alpha">
          <Wand2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={applyAsLayerMask} disabled={!selectedAlpha || !activeLayer} title="Apply as layer mask">
          <Layers className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => selectedAlpha && dispatch({ type: "delete-channel", channelId: selectedAlpha.id })}
          disabled={!selectedAlpha}
          title="Delete selected alpha"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
        <div className="ml-auto flex items-center gap-1 text-[var(--ps-text-dim)]">
          <Layers className="w-3.5 h-3.5" />
          {(activeDoc.channels ?? []).length} alpha
        </div>
      </div>
    </div>
  )
}

function ChannelRow({
  doc,
  id,
  name,
  preview,
  setPreview,
}: {
  doc: PsDocument
  id: "rgb" | "red" | "green" | "blue"
  name: string
  preview: PreviewChannel
  setPreview: (id: PreviewChannel) => void
}) {
  return (
    <button
      type="button"
      onClick={() => setPreview(id)}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm border px-2 py-1 text-left",
        preview === id ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]" : "border-transparent hover:bg-[var(--ps-tool-hover)]",
      )}
    >
      <Eye className="w-3.5 h-3.5 text-[var(--ps-text-dim)]" />
      <ChannelThumb doc={doc} channel={id} />
      <span className="flex-1">{name}</span>
    </button>
  )
}

function AlphaRow({
  doc,
  channel,
  selected,
  onSelect,
  onLoad,
  onDelete,
}: {
  doc: PsDocument
  channel: AlphaChannel
  selected: boolean
  onSelect: () => void
  onLoad: () => void
  onDelete: () => void
}) {
  const meta = parseAlphaChannelMetadata(channel)
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-sm border px-2 py-1",
        selected ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]" : "border-transparent hover:bg-[var(--ps-tool-hover)]",
      )}
      onClick={onSelect}
    >
      <Eye className="w-3.5 h-3.5 text-[var(--ps-text-dim)]" />
      <ChannelThumb doc={doc} alpha={channel.canvas} alphaChannel={channel} />
      <button className="min-w-0 flex-1 truncate text-left" type="button" onClick={onSelect}>
        <span className="block truncate">{meta.baseName}</span>
        <span className="block text-[9px] uppercase text-[var(--ps-text-dim)]">{meta.kind === "spot" ? "Spot channel" : "Alpha channel"}</span>
      </button>
      {meta.kind === "spot" ? <span className="h-3 w-3 rounded-full border border-[var(--ps-divider)]" style={{ backgroundColor: meta.spotColor }} /> : null}
      <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); onLoad() }} title="Load channel as selection">
        <Wand2 className="w-3.5 h-3.5" />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); onDelete() }} title="Delete channel">
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
}

function ChannelThumb({
  doc,
  channel,
  alpha,
  alphaChannel,
}: {
  doc: PsDocument
  channel?: "rgb" | "red" | "green" | "blue"
  alpha?: HTMLCanvasElement
  alphaChannel?: AlphaChannel
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const out = ref.current
    if (!out) return
    out.width = 42
    out.height = 28
    const ctx = out.getContext("2d")!
    ctx.fillStyle = "#111"
    ctx.fillRect(0, 0, out.width, out.height)
    const source = alpha ?? renderDocumentComposite(doc, { transparent: false, matte: "#000000" })
    const tmp = makeCanvas(source.width, source.height)
    const tctx = tmp.getContext("2d")!
    tctx.drawImage(source, 0, 0)
    if (channel && channel !== "rgb") {
      const img = tctx.getImageData(0, 0, tmp.width, tmp.height)
      const offset = channel === "red" ? 0 : channel === "green" ? 1 : 2
      for (let i = 0; i < img.data.length; i += 4) {
        const v = img.data[i + offset]
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      }
      tctx.putImageData(img, 0, 0)
    } else if (alpha && alphaChannel && parseAlphaChannelMetadata(alphaChannel).kind === "spot") {
      const base = renderDocumentComposite(doc, { transparent: false, matte: "#000000" })
      const bctx = base.getContext("2d")!
      const mctx = tmp.getContext("2d")!
      const preview = simulateSpotChannelPreview(
        bctx.getImageData(0, 0, base.width, base.height),
        mctx.getImageData(0, 0, tmp.width, tmp.height),
        {
          spotColor: parseAlphaChannelMetadata(alphaChannel).spotColor ?? "#ff00ff",
          spotOpacity: parseAlphaChannelMetadata(alphaChannel).spotOpacity ?? 65,
        },
      )
      tmp.width = preview.width
      tmp.height = preview.height
      tmp.getContext("2d")!.putImageData(preview, 0, 0)
    } else if (alpha) {
      const img = tctx.getImageData(0, 0, tmp.width, tmp.height)
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3]
        img.data[i + 3] = 255
      }
      tctx.putImageData(img, 0, 0)
    }
    const scale = Math.min(out.width / tmp.width, out.height / tmp.height)
    const w = tmp.width * scale
    const h = tmp.height * scale
    ctx.drawImage(tmp, (out.width - w) / 2, (out.height - h) / 2, w, h)
  }, [alpha, alphaChannel, channel, doc])
  return <canvas ref={ref} className="h-7 w-[42px] rounded-sm border border-[var(--ps-divider)] bg-black" />
}

function createLuminosityMask(doc: PsDocument) {
  const composite = renderDocumentComposite(doc, { transparent: true })
  const ctx = composite.getContext("2d")!
  const img = ctx.getImageData(0, 0, composite.width, composite.height)
  for (let i = 0; i < img.data.length; i += 4) {
    const value = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
    img.data[i + 3] = Math.round((value * img.data[i + 3]) / 255)
  }
  ctx.putImageData(img, 0, 0)
  return composite
}

function cloneChannelMask(doc: PsDocument, canvas: HTMLCanvasElement) {
  const copy = makeCanvas(doc.width, doc.height)
  copy.getContext("2d")!.drawImage(canvas, 0, 0)
  return copy
}

function selectionToMask(doc: PsDocument, selection: Selection) {
  if (selection.mask) return cloneChannelMask(doc, selection.mask)
  if (!selection.bounds) return null
  const mask = makeCanvas(doc.width, doc.height)
  const ctx = mask.getContext("2d")!
  ctx.fillStyle = "#ffffff"
  const b = selection.bounds
  if (selection.shape === "ellipse") {
    ctx.beginPath()
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillRect(b.x, b.y, b.w, b.h)
  }
  return mask
}
