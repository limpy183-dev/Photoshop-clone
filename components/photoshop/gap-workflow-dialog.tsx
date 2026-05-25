"use client"

import * as React from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  applyImageData,
  calculateChannelImageData,
  mergeChannelImageData,
  splitImageDataChannels,
  type ApplyImageTargetChannel,
  type PixelChannel,
} from "./color-channel-ops"
import { makeCanvas, makeDocument, useEditor } from "./editor-context"
import { downloadText, loadRasterCanvasFromFile, renderDocumentComposite } from "./document-io"
import {
  focusStackImageData,
  mergeHdrSceneLinearImageStack,
  photomergeImageStack,
  type HdrDeghostMode,
  type HdrExposureWeighting,
  type PanoramaAlignmentModel,
  type PanoramaProjection,
} from "./photo-workflow-engine"
import type { HighBitImage } from "./color-pipeline"
import type { AlphaChannel, BlendMode, Layer } from "./types"
import { selectionFromMask, selectionToMaskCanvas } from "./tool-helpers"
import { uid } from "./uid"

export type GapWorkflowKind =
  | "apply-image"
  | "calculations"
  | "split-channels"
  | "merge-channels"
  | "load-stack"
  | "photomerge"
  | "hdr-merge"
  | "focus-stack"
  | "stack-statistics"
  | "pdf-presentation"
  | "scripted-pattern"
  | "image-assets"

const blendModes: BlendMode[] = [
  "normal",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
]
const sourceChannels: PixelChannel[] = ["rgb", "gray", "red", "green", "blue", "alpha"]
const targetChannels: ApplyImageTargetChannel[] = ["rgb", "red", "green", "blue", "alpha"]

type ChannelWorkflowSource = "merged" | `layer:${string}` | `channel:${string}`
type ApplyImageDestination = "active-layer" | "layer-mask" | "new-layer"
type CalculationsDestination = "alpha-channel" | "selection" | "layer-mask" | "new-layer"
type ChannelMaskSource = "none" | "selection" | "active-mask" | `channel:${string}`
type SplitChannelsDestination = "documents" | "saved-channels"
type MergeChannelsMode = "RGB" | "CMYK" | "Multichannel" | "Grayscale"

type WorkflowCanvas = HTMLCanvasElement & {
  __highBitImageData?: HighBitImage
}


export function GapWorkflowDialog({
  workflow,
  onOpenChange,
}: {
  workflow: GapWorkflowKind | null
  onOpenChange: (open: boolean) => void
}) {
  const { documents, activeDoc, activeLayer, dispatch, commit, createDocument } = useEditor()
  const [sourceId, setSourceId] = React.useState<ChannelWorkflowSource>("merged")
  const [sourceId2, setSourceId2] = React.useState<ChannelWorkflowSource>("merged")
  const [sourceChannel, setSourceChannel] = React.useState<PixelChannel>("rgb")
  const [sourceChannel2, setSourceChannel2] = React.useState<PixelChannel>("gray")
  const [targetChannel, setTargetChannel] = React.useState<ApplyImageTargetChannel>("rgb")
  const [invertSource, setInvertSource] = React.useState(false)
  const [invertSource2, setInvertSource2] = React.useState(false)
  const [applyDestination, setApplyDestination] = React.useState<ApplyImageDestination>("active-layer")
  const [calculationsDestination, setCalculationsDestination] = React.useState<CalculationsDestination>("alpha-channel")
  const [preserveTransparency, setPreserveTransparency] = React.useState(false)
  const [maskSource, setMaskSource] = React.useState<ChannelMaskSource>("none")
  const [invertMask, setInvertMask] = React.useState(false)
  const [maskDensity, setMaskDensity] = React.useState(100)
  const [scale, setScale] = React.useState(1)
  const [offset, setOffset] = React.useState(0)
  const [blend, setBlend] = React.useState<BlendMode>("normal")
  const [opacity, setOpacity] = React.useState(100)
  const [splitDestination, setSplitDestination] = React.useState<SplitChannelsDestination>("documents")
  const [splitIncludeAlpha, setSplitIncludeAlpha] = React.useState(false)
  const [mergeMode, setMergeMode] = React.useState<MergeChannelsMode>("RGB")
  const [mergeRedDoc, setMergeRedDoc] = React.useState("")
  const [mergeGreenDoc, setMergeGreenDoc] = React.useState("")
  const [mergeBlueDoc, setMergeBlueDoc] = React.useState("")
  const [mergeAlphaDoc, setMergeAlphaDoc] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])
  const [stat, setStat] = React.useState<"mean" | "median" | "min" | "max">("median")
  const [pattern, setPattern] = React.useState<"brick" | "cross-weave" | "random-fill">("brick")
  const [photomergeAlignment, setPhotomergeAlignment] = React.useState<PanoramaAlignmentModel>("similarity")
  const [photomergeProjection, setPhotomergeProjection] = React.useState<PanoramaProjection>("planar")
  const [photomergeBlendMode, setPhotomergeBlendMode] = React.useState<"feather" | "multiband">("multiband")
  const [photomergeLensModel, setPhotomergeLensModel] = React.useState<"none" | "wide" | "phone">("none")
  const [photomergeFocalLength, setPhotomergeFocalLength] = React.useState(0)
  const [hdrDeghost, setHdrDeghost] = React.useState<HdrDeghostMode>("medium")
  const [hdrWeighting, setHdrWeighting] = React.useState<HdrExposureWeighting>("balanced")
  const [hdrExposureStep, setHdrExposureStep] = React.useState(1)
  const [hdrToneExposure, setHdrToneExposure] = React.useState(0)
  const [hdrToneCompression, setHdrToneCompression] = React.useState(1)
  const [hdrToneGamma, setHdrToneGamma] = React.useState(2.2)
  const [hdrReferenceIndex, setHdrReferenceIndex] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const open = workflow !== null

  React.useEffect(() => {
    if (!activeDoc) return
    const fallbackLayer = activeDoc.layers.find((layer) => layer.id !== activeDoc.activeLayerId && layer.kind !== "group") ?? activeLayer ?? activeDoc.layers[0]
    setSourceId(fallbackLayer ? `layer:${fallbackLayer.id}` : "merged")
    setSourceId2("merged")
    setMergeRedDoc((current) => current || documents[0]?.id || "")
    setMergeGreenDoc((current) => current || documents[1]?.id || documents[0]?.id || "")
    setMergeBlueDoc((current) => current || documents[2]?.id || documents[0]?.id || "")
    setMergeAlphaDoc((current) => current || "")
  }, [activeDoc, activeLayer, documents, workflow])

  const close = () => onOpenChange(false)

  const channelSourceOptions = React.useMemo(() => {
    if (!activeDoc) return []
    return [
      { id: "merged" as ChannelWorkflowSource, label: "Merged document" },
      ...activeDoc.layers
        .filter((layer) => layer.kind !== "group")
        .map((layer) => ({ id: `layer:${layer.id}` as ChannelWorkflowSource, label: layer.name })),
      ...(activeDoc.channels ?? []).map((channel) => ({
        id: `channel:${channel.id}` as ChannelWorkflowSource,
        label: `Saved channel: ${channel.name}`,
      })),
    ]
  }, [activeDoc])

  const channelMaskOptions = React.useMemo(() => {
    if (!activeDoc) return [{ id: "none" as ChannelMaskSource, label: "None" }]
    return [
      { id: "none" as ChannelMaskSource, label: "None" },
      { id: "selection" as ChannelMaskSource, label: "Current selection" },
      { id: "active-mask" as ChannelMaskSource, label: "Active layer mask" },
      ...(activeDoc.channels ?? []).map((channel) => ({
        id: `channel:${channel.id}` as ChannelMaskSource,
        label: `Saved channel: ${channel.name}`,
      })),
    ]
  }, [activeDoc])

  const resolveSourceImageData = (sourceRef: ChannelWorkflowSource) => {
    if (!activeDoc) return null
    if (sourceRef === "merged") return canvasImageData(renderDocumentComposite(activeDoc, { transparent: true }))
    if (sourceRef.startsWith("channel:")) {
      const channel = (activeDoc.channels ?? []).find((item) => item.id === sourceRef.slice("channel:".length))
      return channel ? alphaCanvasImageData(channel.canvas) : null
    }
    const layerId = sourceRef.slice("layer:".length)
    const layer = activeDoc.layers.find((candidate) => candidate.id === layerId)
    return layer?.canvas ? canvasImageData(layer.canvas) : null
  }

  const resolveMaskImageData = () => {
    if (!activeDoc || maskSource === "none") return null
    if (maskSource === "selection") {
      const selection = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
      return selection ? alphaCanvasImageData(selection) : null
    }
    if (maskSource === "active-mask") return activeLayer?.mask ? canvasImageData(activeLayer.mask) : null
    const channel = (activeDoc.channels ?? []).find((item) => item.id === maskSource.slice("channel:".length))
    return channel ? alphaCanvasImageData(channel.canvas) : null
  }

  const layerMaskCanvas = () => {
    if (!activeDoc || !activeLayer) return null
    const mask = activeLayer.mask ?? makeCanvas(activeDoc.width, activeDoc.height, "#ffffff")
    return mask
  }

  const runApplyImage = () => {
    if (!activeLayer || !activeDoc || activeLayer.locked) return
    const source = resolveSourceImageData(sourceId)
    if (!source) return
    const targetCanvas = applyDestination === "layer-mask" ? layerMaskCanvas() : activeLayer.canvas
    if (!targetCanvas) return
    const target = canvasImageData(targetCanvas)
    const result = applyImageData(target, source, {
      sourceChannel,
      targetChannel,
      blendMode: blend,
      opacity: opacity / 100,
      invertSource,
      mask: resolveMaskImageData(),
      maskChannel: "alpha",
      invertMask,
      maskDensity: maskDensity / 100,
      scale,
      offset,
      preserveTransparency,
    })
    if (applyDestination === "new-layer") {
      const canvas = imageDataCanvas(result)
      const layer: Layer = { id: uid("layer"), name: "Apply Image Result", kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal", canvas }
      dispatch({ type: "add-layer", layer })
      window.setTimeout(() => commit("Apply Image to New Layer", [layer.id]), 0)
    } else if (applyDestination === "layer-mask") {
      dispatch({ type: "set-layer-mask", id: activeLayer.id, mask: imageDataMaskCanvas(result) })
      window.setTimeout(() => commit("Apply Image to Layer Mask", [activeLayer.id]), 0)
    } else {
      activeLayer.canvas.getContext("2d")!.putImageData(result, 0, 0)
      commit("Apply Image", [activeLayer.id])
    }
    close()
  }

  const runCalculations = () => {
    if (!activeDoc) return
    const imgA = resolveSourceImageData(sourceId)
    const imgB = resolveSourceImageData(sourceId2)
    if (!imgA || !imgB) return
    const out = calculateChannelImageData(imgA, imgB, {
      sourceChannelA: sourceChannel === "rgb" ? "gray" : sourceChannel,
      sourceChannelB: sourceChannel2 === "rgb" ? "gray" : sourceChannel2,
      blendMode: blend,
      opacity: opacity / 100,
      invertA: invertSource,
      invertB: invertSource2,
      mask: resolveMaskImageData(),
      maskChannel: "alpha",
      invertMask,
      maskDensity: maskDensity / 100,
      scale,
      offset,
    })
    const mask = imageDataMaskCanvas(out)
    if (calculationsDestination === "selection") {
      dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
      commit("Calculations Selection", [])
    } else if (calculationsDestination === "layer-mask" && activeLayer) {
      dispatch({ type: "set-layer-mask", id: activeLayer.id, mask })
      window.setTimeout(() => commit("Calculations Layer Mask", [activeLayer.id]), 0)
    } else if (calculationsDestination === "new-layer") {
      const layer: Layer = { id: uid("layer"), name: "Calculations Result", kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal", canvas: imageDataCanvas(out) }
      dispatch({ type: "add-layer", layer })
      window.setTimeout(() => commit("Calculations New Layer", [layer.id]), 0)
    } else {
      const channel: AlphaChannel = { id: uid("alpha"), name: `Calculation ${(activeDoc.channels?.length ?? 0) + 1}`, canvas: mask }
      dispatch({ type: "save-selection", channel })
      commit("Calculations Alpha Channel", [])
    }
    close()
  }

  const loadCanvases = async () => {
    const loaded = []
    for (const file of files) {
      const raster = await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })
      loaded.push({ name: file.name, canvas: raster.canvas })
    }
    return loaded
  }

  const runFileWorkflow = async () => {
    if (!workflow || !files.length) return
    setBusy(true)
    try {
      const loaded = await loadCanvases()
      if (workflow === "pdf-presentation") {
        const pages = loaded.map((item) => `<section><img src="${item.canvas.toDataURL("image/png")}" alt="${escapeHtml(item.name)}"><p>${escapeHtml(item.name)}</p></section>`).join("\n")
        downloadText(`<!doctype html><html><head><meta charset="utf-8"><title>PDF Presentation</title><style>body{margin:0;font-family:sans-serif}section{height:100vh;page-break-after:always;display:grid;place-items:center;background:#111;color:#fff}img{max-width:95vw;max-height:88vh}p{margin:0 0 24px}</style></head><body>${pages}</body></html>`, "pdf-presentation.html", "text/html")
        close()
        return
      }
      const result = workflow === "photomerge"
        ? photomerge(loaded, {
            alignmentModel: photomergeAlignment,
            projection: photomergeProjection,
            blendMode: photomergeBlendMode,
            lensModel: photomergeLensModel,
            projectionFocalLength: photomergeFocalLength > 0 ? photomergeFocalLength : undefined,
          })
        : workflow === "hdr-merge"
          ? mergeHdr(loaded, {
              deghost: hdrDeghost,
              exposureWeighting: hdrWeighting,
              exposureStep: hdrExposureStep,
              referenceIndex: hdrReferenceIndex,
              toneMapping: {
                exposure: hdrToneExposure,
                compression: hdrToneCompression,
                gamma: hdrToneGamma,
              },
            })
          : workflow === "focus-stack"
            ? focusStack(loaded)
            : workflow === "stack-statistics"
              ? mergeStack(loaded, stat)
              : null
      if (result) {
        const workflowCanvas = result as WorkflowCanvas
        const doc = makeDocument(titleForWorkflow(workflow), workflowCanvas.width, workflowCanvas.height, "transparent")
        if (workflowCanvas.__highBitImageData) {
          doc.bitDepth = 32
          ;(doc as typeof doc & { __highBitImageData?: HighBitImage }).__highBitImageData = workflowCanvas.__highBitImageData
        }
        const layer = doc.layers.find((candidate) => candidate.id === doc.activeLayerId)
        if (layer) {
          layer.canvas.getContext("2d")!.drawImage(workflowCanvas, 0, 0)
          if (workflowCanvas.__highBitImageData) {
            ;(layer as Layer & { __highBitImageData?: HighBitImage }).__highBitImageData = workflowCanvas.__highBitImageData
          }
        }
        createDocument(doc, titleForWorkflow(workflow))
      } else {
        const width = Math.max(...loaded.map((item) => item.canvas.width))
        const height = Math.max(...loaded.map((item) => item.canvas.height))
        const doc = makeDocument("Loaded Stack", width, height, "transparent")
        doc.layers = loaded.map((item) => {
          const canvas = makeCanvas(width, height)
          canvas.getContext("2d")!.drawImage(item.canvas, (width - item.canvas.width) / 2, (height - item.canvas.height) / 2)
          return { id: uid("layer"), name: item.name, kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal", canvas } satisfies Layer
        })
        doc.activeLayerId = doc.layers[0]?.id ?? doc.activeLayerId
        doc.selectedLayerIds = doc.activeLayerId ? [doc.activeLayerId] : []
        createDocument(doc, "Load Files into Stack")
      }
      close()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Workflow failed")
    } finally {
      setBusy(false)
    }
  }

  const runPattern = () => {
    if (!activeDoc) return
    const canvas = makeCanvas(activeDoc.width, activeDoc.height)
    drawScriptedPattern(canvas, pattern)
    const layer: Layer = { id: uid("layer"), name: `Pattern ${pattern}`, kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal", canvas }
    dispatch({ type: "add-layer", layer })
    window.setTimeout(() => commit("Scripted Pattern", [layer.id]), 0)
    close()
  }

  const runSplitChannels = () => {
    if (!activeDoc) return
    const source = canvasImageData(renderDocumentComposite(activeDoc, { transparent: true }))
    const split = splitImageDataChannels(source, { includeAlpha: splitIncludeAlpha })
    const plates = [
      { key: "red", name: "Red", image: split.red },
      { key: "green", name: "Green", image: split.green },
      { key: "blue", name: "Blue", image: split.blue },
      ...(splitIncludeAlpha && split.alpha ? [{ key: "alpha", name: "Alpha", image: split.alpha }] : []),
    ]
    if (splitDestination === "saved-channels") {
      for (const plate of plates) {
        dispatch({
          type: "save-selection",
          channel: {
            id: uid("alpha"),
            name: `${plate.name} ${(activeDoc.channels?.length ?? 0) + 1}`,
            canvas: imageDataMaskCanvas(plate.image),
          },
        })
      }
      commit("Split Channels to Saved Channels", [])
    } else {
      for (const plate of plates) {
        const doc = makeDocument(`${activeDoc.name} ${plate.name}`, source.width, source.height, "transparent")
        doc.colorMode = "Grayscale"
        doc.modeSettings = { mode: "Grayscale" }
        const layer = doc.layers.find((candidate) => candidate.id === doc.activeLayerId)
        if (layer) layer.canvas.getContext("2d")!.putImageData(plate.image, 0, 0)
        createDocument(doc, `Split ${plate.name} Channel`)
      }
    }
    close()
  }

  const documentImageData = (docId: string) => {
    const doc = documents.find((candidate) => candidate.id === docId)
    return doc ? canvasImageData(renderDocumentComposite(doc, { transparent: true })) : null
  }

  const runMergeChannels = () => {
    const red = documentImageData(mergeRedDoc)
    const green = documentImageData(mergeGreenDoc)
    const blue = documentImageData(mergeBlueDoc)
    const alpha = mergeAlphaDoc ? documentImageData(mergeAlphaDoc) : null
    if (mergeMode === "Grayscale") {
      const gray = red ?? green ?? blue
      if (!gray) return
      const doc = documentFromImageData("Merged Grayscale", mergeChannelImageData({ gray, alpha }), { mode: "Grayscale" })
      createDocument(doc, "Merge Channels")
      close()
      return
    }
    if (!red || !green || !blue) return
    const merged = mergeMode === "CMYK"
      ? mergeCmykPreview(red, green, blue, alpha)
      : mergeChannelImageData({ red, green, blue, alpha })
    const doc = documentFromImageData(`Merged ${mergeMode}`, merged, {
      mode: mergeMode === "CMYK" ? "CMYK" : mergeMode === "Multichannel" ? "Multichannel" : "RGB",
    })
    createDocument(doc, "Merge Channels")
    close()
  }

  const layers = activeDoc?.layers.filter((layer) => layer.kind !== "group") ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>{workflow ? titleForWorkflow(workflow) : "Workflow"}</DialogTitle>
        </DialogHeader>
        {workflow === "apply-image" || workflow === "calculations" ? (
          <div className="grid gap-3 text-[11px]">
            <div className="grid grid-cols-2 gap-3">
              <Field label={workflow === "calculations" ? "Source 1" : "Source"}>
                <select value={sourceId} onChange={(event) => setSourceId(event.target.value as ChannelWorkflowSource)} className={selectClass}>
                  {channelSourceOptions.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                </select>
              </Field>
              <Field label={workflow === "calculations" ? "Channel 1" : "Source Channel"}>
                <select value={sourceChannel} onChange={(event) => setSourceChannel(event.target.value as PixelChannel)} className={selectClass}>
                  {sourceChannels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
                </select>
              </Field>
              {workflow === "calculations" ? (
                <>
                  <Field label="Source 2">
                    <select value={sourceId2} onChange={(event) => setSourceId2(event.target.value as ChannelWorkflowSource)} className={selectClass}>
                      {channelSourceOptions.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Channel 2">
                    <select value={sourceChannel2} onChange={(event) => setSourceChannel2(event.target.value as PixelChannel)} className={selectClass}>
                      {sourceChannels.filter((channel) => channel !== "rgb").map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
                    </select>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Destination">
                    <select value={applyDestination} onChange={(event) => setApplyDestination(event.target.value as ApplyImageDestination)} className={selectClass}>
                      <option value="active-layer">Active layer pixels</option>
                      <option value="layer-mask">Active layer mask</option>
                      <option value="new-layer">New layer</option>
                    </select>
                  </Field>
                  <Field label="Target Channel">
                    <select value={targetChannel} onChange={(event) => setTargetChannel(event.target.value as ApplyImageTargetChannel)} className={selectClass}>
                      {targetChannels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
                    </select>
                  </Field>
                </>
              )}
              {workflow === "calculations" ? (
                <Field label="Result">
                  <select value={calculationsDestination} onChange={(event) => setCalculationsDestination(event.target.value as CalculationsDestination)} className={selectClass}>
                    <option value="alpha-channel">New alpha channel</option>
                    <option value="selection">Current selection</option>
                    <option value="layer-mask">Active layer mask</option>
                    <option value="new-layer">New grayscale layer</option>
                  </select>
                </Field>
              ) : null}
              <Field label="Blend">
                <select value={blend} onChange={(event) => setBlend(event.target.value as BlendMode)} className={selectClass}>
                  {blendModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
              </Field>
              <Field label="Opacity %">
                <input type="number" min={0} max={100} value={opacity} onChange={(event) => setOpacity(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className={inputClass} />
              </Field>
              <Field label="Scale">
                <input type="number" min={0.1} max={4} step={0.1} value={scale} onChange={(event) => setScale(Math.max(0.1, Math.min(4, Number(event.target.value) || 1)))} className={inputClass} />
              </Field>
              <Field label="Offset">
                <input type="number" min={-255} max={255} value={offset} onChange={(event) => setOffset(Math.max(-255, Math.min(255, Number(event.target.value) || 0)))} className={inputClass} />
              </Field>
              <Field label="Mask">
                <select value={maskSource} onChange={(event) => setMaskSource(event.target.value as ChannelMaskSource)} className={selectClass}>
                  {channelMaskOptions.map((mask) => <option key={mask.id} value={mask.id}>{mask.label}</option>)}
                </select>
              </Field>
              <Field label="Mask Density %">
                <input type="number" min={0} max={100} value={maskDensity} onChange={(event) => setMaskDensity(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className={inputClass} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[var(--ps-text-dim)]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={invertSource} onChange={(event) => setInvertSource(event.target.checked)} />
                Invert first source
              </label>
              {workflow === "calculations" ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={invertSource2} onChange={(event) => setInvertSource2(event.target.checked)} />
                  Invert second source
                </label>
              ) : (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={preserveTransparency} onChange={(event) => setPreserveTransparency(event.target.checked)} />
                  Preserve transparency
                </label>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={invertMask} disabled={maskSource === "none"} onChange={(event) => setInvertMask(event.target.checked)} />
                Invert mask
              </label>
            </div>
          </div>
        ) : workflow === "split-channels" ? (
          <div className="grid gap-3 text-[11px]">
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[var(--ps-text-dim)]">
              Splits the current merged composite into grayscale channel plates. Saved alpha output keeps plates in the Channels panel; document output creates separate grayscale documents.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Output">
                <select value={splitDestination} onChange={(event) => setSplitDestination(event.target.value as SplitChannelsDestination)} className={selectClass}>
                  <option value="documents">Separate grayscale documents</option>
                  <option value="saved-channels">Saved alpha channels</option>
                </select>
              </Field>
              <label className="flex items-end gap-2 pb-2 text-[var(--ps-text-dim)]">
                <input type="checkbox" checked={splitIncludeAlpha} onChange={(event) => setSplitIncludeAlpha(event.target.checked)} />
                Include transparency plate
              </label>
            </div>
          </div>
        ) : workflow === "merge-channels" ? (
          <div className="grid gap-3 text-[11px]">
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[var(--ps-text-dim)]">
              Merges grayscale open documents into a new RGB, CMYK-preview, multichannel, or grayscale document. Each selected document is sampled by luminance.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mode">
                <select value={mergeMode} onChange={(event) => setMergeMode(event.target.value as MergeChannelsMode)} className={selectClass}>
                  <option value="RGB">RGB</option>
                  <option value="CMYK">CMYK preview</option>
                  <option value="Multichannel">Multichannel</option>
                  <option value="Grayscale">Grayscale</option>
                </select>
              </Field>
              <Field label={mergeMode === "CMYK" ? "Cyan / Gray" : "Red / Gray"}>
                <select value={mergeRedDoc} onChange={(event) => setMergeRedDoc(event.target.value)} className={selectClass}>
                  {documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                </select>
              </Field>
              {mergeMode !== "Grayscale" ? (
                <>
                  <Field label={mergeMode === "CMYK" ? "Magenta" : "Green"}>
                    <select value={mergeGreenDoc} onChange={(event) => setMergeGreenDoc(event.target.value)} className={selectClass}>
                      {documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                    </select>
                  </Field>
                  <Field label={mergeMode === "CMYK" ? "Yellow" : "Blue"}>
                    <select value={mergeBlueDoc} onChange={(event) => setMergeBlueDoc(event.target.value)} className={selectClass}>
                      {documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                    </select>
                  </Field>
                </>
              ) : null}
              <Field label={mergeMode === "CMYK" ? "Black" : "Alpha"}>
                <select value={mergeAlphaDoc} onChange={(event) => setMergeAlphaDoc(event.target.value)} className={selectClass}>
                  <option value="">{mergeMode === "CMYK" ? "No black plate" : "No alpha plate"}</option>
                  {documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                </select>
              </Field>
            </div>
          </div>
        ) : workflow === "scripted-pattern" ? (
          <Field label="Pattern">
            <select value={pattern} onChange={(event) => setPattern(event.target.value as typeof pattern)} className={selectClass}>
              <option value="brick">Brick Fill</option>
              <option value="cross-weave">Cross Weave</option>
              <option value="random-fill">Random Fill</option>
            </select>
          </Field>
        ) : workflow === "image-assets" ? (
          <div className="text-[11px] text-[var(--ps-text-dim)]">This opens the local visible-layer export workflow. It is not Photoshop Generator or a folder watcher.</div>
        ) : (
          <div className="grid gap-3 text-[11px]">
            <input type="file" multiple accept="image/*" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} className={inputClass} />
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[var(--ps-text-dim)]">
              File workflows use browser-decoded 8-bit image pixels. Photomerge, HDR merge, focus stack, and stack statistics are local approximations, not Photoshop camera RAW, HDR Pro, or lens-aware merge engines.
            </div>
            {workflow === "stack-statistics" ? (
              <Field label="Statistic">
                <select value={stat} onChange={(event) => setStat(event.target.value as typeof stat)} className={selectClass}>
                  <option value="mean">Mean</option>
                  <option value="median">Median</option>
                  <option value="min">Minimum</option>
                  <option value="max">Maximum</option>
                </select>
              </Field>
            ) : null}
            {workflow === "photomerge" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Alignment">
                  <select value={photomergeAlignment} onChange={(event) => setPhotomergeAlignment(event.target.value as PanoramaAlignmentModel)} className={selectClass}>
                    <option value="translation">Translation</option>
                    <option value="similarity">Similarity</option>
                    <option value="affine">Affine</option>
                    <option value="homography">Homography</option>
                  </select>
                </Field>
                <Field label="Projection">
                  <select value={photomergeProjection} onChange={(event) => setPhotomergeProjection(event.target.value as PanoramaProjection)} className={selectClass}>
                    <option value="planar">Planar</option>
                    <option value="cylindrical">Cylindrical</option>
                    <option value="spherical">Spherical</option>
                  </select>
                </Field>
                <Field label="Blend">
                  <select value={photomergeBlendMode} onChange={(event) => setPhotomergeBlendMode(event.target.value as typeof photomergeBlendMode)} className={selectClass}>
                    <option value="multiband">Multiband</option>
                    <option value="feather">Feather</option>
                  </select>
                </Field>
                <Field label="Lens model">
                  <select value={photomergeLensModel} onChange={(event) => setPhotomergeLensModel(event.target.value as typeof photomergeLensModel)} className={selectClass}>
                    <option value="none">None</option>
                    <option value="wide">Wide rectilinear</option>
                    <option value="phone">Phone wide</option>
                  </select>
                </Field>
                <Field label="Focal length px">
                  <input type="number" min={0} step={1} value={photomergeFocalLength} onChange={(event) => setPhotomergeFocalLength(Math.max(0, Number(event.target.value) || 0))} className={inputClass} />
                </Field>
              </div>
            ) : null}
            {workflow === "hdr-merge" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Deghost">
                  <select value={hdrDeghost} onChange={(event) => setHdrDeghost(event.target.value as HdrDeghostMode)} className={selectClass}>
                    <option value="off">Off</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </Field>
                <Field label="Exposure weighting">
                  <select value={hdrWeighting} onChange={(event) => setHdrWeighting(event.target.value as HdrExposureWeighting)} className={selectClass}>
                    <option value="balanced">Balanced</option>
                    <option value="shadow-priority">Shadow priority</option>
                    <option value="highlight-priority">Highlight priority</option>
                    <option value="manual">Manual EV weights</option>
                  </select>
                </Field>
                <Field label="EV step">
                  <input type="number" min={0.1} max={4} step={0.1} value={hdrExposureStep} onChange={(event) => setHdrExposureStep(Math.max(0.1, Math.min(4, Number(event.target.value) || 1)))} className={inputClass} />
                </Field>
                <Field label="Reference frame">
                  <input type="number" min={0} max={Math.max(0, files.length - 1)} step={1} value={hdrReferenceIndex} onChange={(event) => setHdrReferenceIndex(Math.max(0, Math.min(Math.max(0, files.length - 1), Number(event.target.value) || 0)))} className={inputClass} />
                </Field>
                <Field label="Tone exposure">
                  <input type="number" min={-4} max={4} step={0.1} value={hdrToneExposure} onChange={(event) => setHdrToneExposure(Math.max(-4, Math.min(4, Number(event.target.value) || 0)))} className={inputClass} />
                </Field>
                <Field label="Compression">
                  <input type="number" min={0.05} max={4} step={0.05} value={hdrToneCompression} onChange={(event) => setHdrToneCompression(Math.max(0.05, Math.min(4, Number(event.target.value) || 1)))} className={inputClass} />
                </Field>
                <Field label="Gamma">
                  <input type="number" min={0.2} max={5} step={0.05} value={hdrToneGamma} onChange={(event) => setHdrToneGamma(Math.max(0.2, Math.min(5, Number(event.target.value) || 2.2)))} className={inputClass} />
                </Field>
              </div>
            ) : null}
            <div className="text-[var(--ps-text-dim)]">{files.length} file{files.length === 1 ? "" : "s"} selected</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button
            disabled={busy || (isFileWorkflow(workflow) && !files.length) || (workflow === "merge-channels" && documents.length === 0)}
            onClick={() => {
              if (workflow === "apply-image") runApplyImage()
              else if (workflow === "calculations") runCalculations()
              else if (workflow === "split-channels") runSplitChannels()
              else if (workflow === "merge-channels") runMergeChannels()
              else if (workflow === "scripted-pattern") runPattern()
              else if (workflow === "image-assets") {
                window.dispatchEvent(new CustomEvent("ps-open-batch-export", { detail: { scope: "visible-layers" } }))
                close()
              } else void runFileWorkflow()
            }}
          >
            {busy ? "Running..." : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function isFileWorkflow(workflow: GapWorkflowKind | null) {
  return workflow === "load-stack" || workflow === "photomerge" || workflow === "hdr-merge" || workflow === "focus-stack" || workflow === "stack-statistics" || workflow === "pdf-presentation"
}

function titleForWorkflow(workflow: GapWorkflowKind) {
  const labels: Record<GapWorkflowKind, string> = {
    "apply-image": "Apply Image",
    calculations: "Calculations",
    "split-channels": "Split Channels",
    "merge-channels": "Merge Channels",
    "load-stack": "Load Files into Stack",
    photomerge: "Photomerge",
    "hdr-merge": "Merge to HDR",
    "focus-stack": "Focus Stack",
    "stack-statistics": "Stack Statistics",
    "pdf-presentation": "PDF Presentation",
    "scripted-pattern": "Scripted Patterns",
    "image-assets": "Image Assets Generator",
  }
  return labels[workflow]
}

function channelLabel(channel: PixelChannel | ApplyImageTargetChannel) {
  if (channel === "rgb") return "RGB composite"
  if (channel === "gray") return "Gray/luminance"
  if (channel === "alpha") return "Alpha"
  return `${channel[0].toUpperCase()}${channel.slice(1)}`
}

function photomerge(
  items: { name: string; canvas: HTMLCanvasElement }[],
  options: {
    alignmentModel: PanoramaAlignmentModel
    projection: PanoramaProjection
    projectionFocalLength?: number
    blendMode: "feather" | "multiband"
    lensModel: "none" | "wide" | "phone"
  },
) {
  const images = items.map((item) => canvasImageData(item.canvas))
  const radius = workflowSearchRadius(items)
  const lens =
    options.lensModel === "phone"
      ? { k1: -0.035, k2: 0.01, p1: 0.001, p2: -0.001 }
      : options.lensModel === "wide"
        ? { k1: -0.018, k2: 0.004, p1: 0, p2: 0 }
        : undefined
  const result = photomergeImageStack(images, {
    searchRadius: radius,
    maxFeatures: 120,
    alignmentModel: options.alignmentModel,
    projection: options.projection,
    projectionFocalLength: options.projectionFocalLength,
    blendMode: options.blendMode,
    cameraModel: lens ? { focalLengthPx: options.projectionFocalLength, lens } : undefined,
  })
  return imageDataCanvas(result.image)
}

function mergeStack(items: { canvas: HTMLCanvasElement }[], mode: "mean" | "median" | "min" | "max") {
  const width = Math.max(...items.map((item) => item.canvas.width))
  const height = Math.max(...items.map((item) => item.canvas.height))
  const data = items.map((item) => imageDataCentered(item.canvas, width, height))
  const out = makeCanvas(width, height)
  const img = out.getContext("2d")!.createImageData(width, height)
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      const values = data.map((source) => source.data[i + c]).sort((a, b) => a - b)
      img.data[i + c] =
        mode === "min" ? values[0] :
        mode === "max" ? values[values.length - 1] :
        mode === "median" ? values[Math.floor(values.length / 2)] :
        values.reduce((sum, value) => sum + value, 0) / values.length
    }
  }
  out.getContext("2d")!.putImageData(img, 0, 0)
  return out
}

function focusStack(items: { canvas: HTMLCanvasElement }[]) {
  const width = Math.max(...items.map((item) => item.canvas.width))
  const height = Math.max(...items.map((item) => item.canvas.height))
  const data = items.map((item) => imageDataCentered(item.canvas, width, height))
  return imageDataCanvas(focusStackImageData(data).image)
}

function imageDataCentered(canvas: HTMLCanvasElement, width: number, height: number) {
  const tmp = makeCanvas(width, height)
  tmp.getContext("2d")!.drawImage(canvas, (width - canvas.width) / 2, (height - canvas.height) / 2)
  return tmp.getContext("2d")!.getImageData(0, 0, width, height)
}

function mergeHdr(
  items: { canvas: HTMLCanvasElement }[],
  options: {
    deghost: HdrDeghostMode
    exposureWeighting: HdrExposureWeighting
    exposureStep: number
    referenceIndex: number
    toneMapping: { exposure: number; compression: number; gamma: number }
  },
) {
  const width = Math.max(...items.map((item) => item.canvas.width))
  const height = Math.max(...items.map((item) => item.canvas.height))
  const data = items.map((item) => imageDataCentered(item.canvas, width, height))
  const midpoint = (items.length - 1) / 2
  const exposures = items.map((_, index) => ({ ev: (index - midpoint) * options.exposureStep }))
  const radius = workflowSearchRadius(items)
  const scene = mergeHdrSceneLinearImageStack(
    data.map((image, index) => ({ image, ev: exposures[index].ev, sourceKind: "rendered" as const })),
    {
      align: true,
      searchRadius: radius,
      maxFeatures: 120,
      deghost: options.deghost,
      referenceIndex: options.referenceIndex,
      exposureWeighting: options.exposureWeighting,
      manualExposureWeights: options.exposureWeighting === "manual"
        ? exposures.map((exposure) => Math.max(0.1, 1 + exposure.ev * 0.2))
        : undefined,
      toneMapping: options.toneMapping,
    },
  )
  const canvas = imageDataCanvas(scene.preview) as WorkflowCanvas
  canvas.__highBitImageData = scene.highBitImage
  return canvas
}

function canvasImageData(canvas: HTMLCanvasElement) {
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height)
}

function alphaCanvasImageData(canvas: HTMLCanvasElement) {
  const img = canvasImageData(canvas)
  for (let i = 0; i < img.data.length; i += 4) {
    const value = img.data[i + 3]
    img.data[i] = value
    img.data[i + 1] = value
    img.data[i + 2] = value
    img.data[i + 3] = 255
  }
  return img
}

function imageDataCanvas(image: ImageData) {
  const canvas = makeCanvas(image.width, image.height)
  canvas.getContext("2d")!.putImageData(image, 0, 0)
  return canvas
}

function imageDataMaskCanvas(image: ImageData) {
  const mask = makeCanvas(image.width, image.height)
  const data = new Uint8ClampedArray(image.data)
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = value
  }
  mask.getContext("2d")!.putImageData(new ImageData(data, image.width, image.height), 0, 0)
  return mask
}

function documentFromImageData(name: string, image: ImageData, settings: { mode: "RGB" | "CMYK" | "Multichannel" | "Grayscale" }) {
  const doc = makeDocument(name, image.width, image.height, "transparent")
  doc.colorMode = settings.mode
  doc.modeSettings = settings.mode === "Multichannel"
    ? { mode: "Multichannel", multichannel: { channels: { r: true, g: true, b: true } } }
    : { mode: settings.mode }
  const layer = doc.layers.find((candidate) => candidate.id === doc.activeLayerId)
  if (layer) layer.canvas.getContext("2d")!.putImageData(image, 0, 0)
  return doc
}

function sampleGray(image: ImageData, x: number, y: number) {
  const i = (y * image.width + x) * 4
  return Math.round(0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2])
}

function mergeCmykPreview(cyan: ImageData, magenta: ImageData, yellow: ImageData, black: ImageData | null) {
  const width = Math.min(cyan.width, magenta.width, yellow.width, black?.width ?? cyan.width)
  const height = Math.min(cyan.height, magenta.height, yellow.height, black?.height ?? cyan.height)
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const c = sampleGray(cyan, x, y) / 255
      const m = sampleGray(magenta, x, y) / 255
      const yy = sampleGray(yellow, x, y) / 255
      const k = black ? sampleGray(black, x, y) / 255 : 0
      out[i] = Math.round(255 * (1 - c) * (1 - k))
      out[i + 1] = Math.round(255 * (1 - m) * (1 - k))
      out[i + 2] = Math.round(255 * (1 - yy) * (1 - k))
      out[i + 3] = 255
    }
  }
  return new ImageData(out, width, height)
}

function workflowSearchRadius(items: { canvas: HTMLCanvasElement }[]) {
  const longest = Math.max(...items.map((item) => Math.max(item.canvas.width, item.canvas.height)), 1)
  return Math.max(8, Math.min(96, Math.round(longest * 0.12)))
}

function drawScriptedPattern(canvas: HTMLCanvasElement, pattern: "brick" | "cross-weave" | "random-fill") {
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#f8fafc"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (pattern === "brick") {
    const w = 96, h = 42
    for (let y = 0; y < canvas.height; y += h) {
      for (let x = (Math.floor(y / h) % 2) * -w / 2; x < canvas.width; x += w) {
        ctx.fillStyle = `hsl(${18 + ((x + y) % 18)}, 58%, ${46 + ((x + y) % 9)}%)`
        ctx.fillRect(x + 2, y + 2, w - 4, h - 4)
      }
    }
  } else if (pattern === "cross-weave") {
    ctx.strokeStyle = "#334155"
    for (let i = -canvas.height; i < canvas.width; i += 14) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + canvas.height, canvas.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(i, canvas.height); ctx.lineTo(i + canvas.height, 0); ctx.stroke()
    }
  } else {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = Math.sin(i * 12.9898) * 43758.5453
      const v = Math.floor((n - Math.floor(n)) * 255)
      img.data[i] = v
      img.data[i + 1] = 90 + v * 0.45
      img.data[i + 2] = 255 - v * 0.35
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch] ?? ch)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-[11px] text-[var(--ps-text-dim)]">{label}{children}</label>
}

const inputClass = "h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)] outline-none"
const selectClass = inputClass
