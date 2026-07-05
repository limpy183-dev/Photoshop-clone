"use client"

import * as React from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useEditorSelector, makeCanvas } from "./editor-context"
import { downloadText, loadRasterCanvasFromFile } from "./document-io"
import { buildContentAwareFillPlan, contentAwareFill, focusAreaMask, rasterizeText, selectionFromMask, selectionToMaskCanvas } from "./tool-helpers"
import {
  autoAlignLayers,
  booleanMasks,
  channelMixer,
  connectedComponents,
  analyzeContentAwareScale,
  contentAwareScaleCanvas,
  drawProceduralTexture,
  edgeAwareQuickSelectionMask,
  gradientMap,
  layerContentBounds,
  motionBlur,
  offsetPolyline,
  outlinePolyline,
  parseIccProfile,
  pathToPolyline,
  polylineToPath,
  replaceColor,
  shapeToMask,
  shiftChannels,
  simplifyPolyline,
  softProof,
  transformSelectionMask,
  type ColorStop,
} from "./algorithmic-operations"
import { autoBlendImageStack } from "./photo-workflow-engine"
import { applyPromptInpaintImageData, buildGenerativeFillPlan } from "./generative-fill-engine"
import { findReplaceTextLayers } from "./typography-engine"
import type { AssetLibraryItem, CountMarker, Layer, PathProps, PrintSettings, TextProps } from "./types"
import { uid } from "./uid"
import { dispatchPhotoshopEvent } from "./events"

type TabId =
  | "paths"
  | "composite"
  | "paint"
  | "type"
  | "animation"
  | "selection"
  | "analysis"
  | "print"
  | "color"
  | "automation"
  | "smart"
  | "workspace"
  | "history"
  | "texture"

const tabs: { id: TabId; label: string }[] = [
  { id: "paths", label: "Paths" },
  { id: "composite", label: "Composite" },
  { id: "paint", label: "Paint" },
  { id: "type", label: "Type" },
  { id: "animation", label: "Animation" },
  { id: "selection", label: "Selection" },
  { id: "analysis", label: "Analysis" },
  { id: "print", label: "Print" },
  { id: "color", label: "Color" },
  { id: "automation", label: "Automation" },
  { id: "smart", label: "Smart" },
  { id: "workspace", label: "Workspace" },
  { id: "history", label: "History" },
  { id: "texture", label: "Texture" },
]

const smallInput = "h-8 bg-[var(--ps-panel-2)] text-[11px]"


export function AlgorithmicOperationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const editor = useEditorSelector((value) => value)
  const {
    activeDoc,
    activeLayer,
    selectedLayers,
    dispatch,
    commit,
    requestRender,
    foreground,
    background,
    createAction,
    createHistorySnapshot,
    editSmartObject,
  } = editor
  const [tab, setTab] = React.useState<TabId>("paths")
  const [offset, setOffset] = React.useState(16)
  const [tolerance, setTolerance] = React.useState(6)
  const [strokeWidth, setStrokeWidth] = React.useState(20)
  const [scalePct, setScalePct] = React.useState(82)
  const [replaceFrom, setReplaceFrom] = React.useState("#497098")
  const [replaceTo, setReplaceTo] = React.useState("#ff3366")
  const [findText, setFindText] = React.useState("Untitled")
  const [replaceTextValue, setReplaceTextValue] = React.useState("Edited")
  const [findUseRegex, setFindUseRegex] = React.useState(false)
  const [findCaseSensitive, setFindCaseSensitive] = React.useState(false)
  const [findWholeWord, setFindWholeWord] = React.useState(false)
  const [selectionScale, setSelectionScale] = React.useState(1.12)
  const [selectionRotate, setSelectionRotate] = React.useState(0)
  const [gamutWarning, setGamutWarning] = React.useState(false)
  const [iccInfo, setIccInfo] = React.useState<string>("")
  const [contentSamplingMode, setContentSamplingMode] = React.useState<"auto" | "all-except-fill">("auto")
  const [contentOutputTarget, setContentOutputTarget] = React.useState<"current-layer" | "new-layer">("current-layer")
  const [contentPatchRadius, setContentPatchRadius] = React.useState(4)
  const [contentSearchRadius, setContentSearchRadius] = React.useState(48)
  const [contentCandidateBudget, setContentCandidateBudget] = React.useState(56)
  const [contentBoundaryBudget, setContentBoundaryBudget] = React.useState(18)
  const [contentRefinementPasses, setContentRefinementPasses] = React.useState(3)
  const [contentSeamRelaxPasses, setContentSeamRelaxPasses] = React.useState(2)
  const [contentCoherence, setContentCoherence] = React.useState(1)
  const [contentFillOrder, setContentFillOrder] = React.useState<"edge-first" | "center-first" | "randomized">("edge-first")
  const [generativePrompt, setGenerativePrompt] = React.useState("remove distracting object")
  const [generativeMode, setGenerativeMode] = React.useState<"fill" | "remove" | "expand">("remove")
  const [seamProtectSource, setSeamProtectSource] = React.useState<"none" | "selection" | "layer">("none")
  const [seamRemoveSource, setSeamRemoveSource] = React.useState<"none" | "selection" | "layer">("none")
  const [seamProtectLayerId, setSeamProtectLayerId] = React.useState<string>("")
  const [seamRemoveLayerId, setSeamRemoveLayerId] = React.useState<string>("")
  const layers = selectedLayers.length ? selectedLayers : activeLayer ? [activeLayer] : []
  const findPreview = React.useMemo(() => {
    if (!activeDoc || !findText) return null
    return findReplaceTextLayers(activeDoc.layers, {
      find: findText,
      replace: replaceTextValue,
      caseSensitive: findCaseSensitive,
      wholeWord: findWholeWord,
      useRegex: findUseRegex,
      previewOnly: true,
    })
  }, [activeDoc, findText, replaceTextValue, findCaseSensitive, findWholeWord, findUseRegex])

  const requireDoc = () => {
    if (!activeDoc) toast.error("Open a document first.")
    return activeDoc
  }
  const requireLayer = () => {
    if (!activeLayer) toast.error("Select a layer first.")
    return activeLayer
  }
  const finish = (label: string, changed: string[] | "all" = layers.map((layer) => layer.id)) => {
    requestRender()
    window.setTimeout(() => commit(label, changed), 0)
  }

  const booleanShape = (operation: "unite" | "subtract" | "intersect" | "exclude") => {
    const doc = requireDoc()
    const layer = requireLayer()
    if (!doc || !layer?.shape) return
    const activeIndex = doc.layers.findIndex((candidate) => candidate.id === layer.id)
    const base = doc.layers.slice(0, activeIndex).reverse().find((candidate) => candidate.kind === "shape" && candidate.shape)
    if (!base?.shape) {
      toast.error("Place another shape layer below the active shape.")
      return
    }
    const baseMask = shapeToMask(base.shape, doc.width, doc.height)
    const activeMask = shapeToMask(layer.shape, doc.width, doc.height)
    const result = booleanMasks(baseMask, activeMask, operation)
    const ctx = base.canvas.getContext("2d")!
    ctx.clearRect(0, 0, doc.width, doc.height)
    ctx.fillStyle = base.shape.fill
    ctx.globalCompositeOperation = "source-over"
    ctx.drawImage(result, 0, 0)
    ctx.globalCompositeOperation = "source-in"
    ctx.fillRect(0, 0, doc.width, doc.height)
    ctx.globalCompositeOperation = "source-over"
    dispatch({ type: "set-layer-shape", id: base.id, shape: { ...base.shape, booleanOperation: operation } })
    dispatch({ type: "remove-layer", id: layer.id })
    finish(`Boolean ${operation}`, [base.id])
  }

  const pathFromActive = (): PathProps | null => {
    if (!activeLayer) return null
    if (activeLayer.path) return activeLayer.path
    if (activeLayer.shape) {
      const s = activeLayer.shape
      return {
        closed: true,
        points: [
          { x: s.x, y: s.y },
          { x: s.x + s.w, y: s.y },
          { x: s.x + s.w, y: s.y + s.h },
          { x: s.x, y: s.y + s.h },
        ],
      }
    }
    return null
  }

  const updateActivePath = (path: PathProps, label: string) => {
    if (!activeLayer) return
    dispatch({ type: "set-layer-path", id: activeLayer.id, path })
    finish(label, [activeLayer.id])
  }

  const offsetPath = () => {
    const path = pathFromActive()
    if (!path) return toast.error("Select a path or shape layer first.")
    updateActivePath(polylineToPath(offsetPolyline(pathToPolyline(path), offset, path.closed), path.closed), "Offset Path")
  }

  const simplifyPath = () => {
    const path = pathFromActive()
    if (!path) return toast.error("Select a path or shape layer first.")
    updateActivePath(polylineToPath(simplifyPolyline(pathToPolyline(path), tolerance), path.closed), "Simplify Path")
  }

  const outlinePath = () => {
    const path = pathFromActive()
    if (!path) return toast.error("Select a path or shape layer first.")
    updateActivePath(polylineToPath(outlinePolyline(pathToPolyline(path), strokeWidth, path.closed), true), "Outline Path")
  }

  const runAutoAlign = (mode: "features" | "centers" | "edges" | "canvas-center") => {
    const doc = requireDoc()
    if (!doc || layers.length < 2) return toast.error("Select at least two layers.")
    autoAlignLayers(layers, doc.width, doc.height, mode)
    finish("Auto-Align Layers", layers.map((layer) => layer.id))
  }

  const runAutoBlend = () => {
    const doc = requireDoc()
    if (!doc || layers.length < 2) return toast.error("Select at least two layers.")
    const images = layers.map((layer) => layer.canvas.getContext("2d")!.getImageData(0, 0, doc.width, doc.height))
    const placements = layers.map(() => ({ dx: 0, dy: 0, score: 0 }))
    const blended = autoBlendImageStack(images, placements, { featherRadius: 24 })
    const canvas = makeCanvas(doc.width, doc.height)
    canvas.getContext("2d")!.putImageData(blended.image, 0, 0)
    const layer: Layer = {
      id: uid("layer"),
      name: "Auto-Blend Composite",
      kind: "raster",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      canvas,
    }
    dispatch({ type: "add-layer", layer })
    finish("Auto-Blend Layers", [...layers.map((candidate) => candidate.id), layer.id])
  }

  const runContentAwareScale = () => {
    const doc = requireDoc()
    const layer = requireLayer()
    if (!doc || !layer) return
    const targetWidth = Math.round(doc.width * scalePct / 100)
    const targetHeight = Math.round(doc.height * scalePct / 100)
    const plan = analyzeContentAwareScale(layer.canvas.width, layer.canvas.height, targetWidth, targetHeight)
    if (plan.quality === "partial-seam-fallback") toast.info(`Content-Aware Scale: ${plan.message}`)
    // Resolve protect/remove masks from UI selection
    let protectMask: HTMLCanvasElement | ImageData | null = null
    let removeMask: HTMLCanvasElement | ImageData | null = null
    if (seamProtectSource === "selection" && doc.selection.bounds) {
      protectMask = selectionToMaskCanvas(doc.width, doc.height, doc.selection)
    } else if (seamProtectSource === "layer" && seamProtectLayerId) {
      const src = doc.layers.find((l) => l.id === seamProtectLayerId)
      if (src) protectMask = src.canvas
    }
    if (seamRemoveSource === "selection" && doc.selection.bounds) {
      removeMask = selectionToMaskCanvas(doc.width, doc.height, doc.selection)
    } else if (seamRemoveSource === "layer" && seamRemoveLayerId) {
      const src = doc.layers.find((l) => l.id === seamRemoveLayerId)
      if (src) removeMask = src.canvas
    }
    const scaled = contentAwareScaleCanvas(layer.canvas, targetWidth, targetHeight, { protectMask, removeMask })
    const ctx = layer.canvas.getContext("2d")!
    ctx.clearRect(0, 0, doc.width, doc.height)
    ctx.drawImage(scaled, Math.round((doc.width - scaled.width) / 2), Math.round((doc.height - scaled.height) / 2))
    finish("Content-Aware Scale", [layer.id])
  }

  const runContentAwareExtend = () => {
    const doc = requireDoc()
    const layer = requireLayer()
    if (!doc || !layer) return
    const bounds = activeDoc?.selection.bounds ?? layerContentBounds(layer) ?? { x: 0, y: 0, w: doc.width, h: doc.height }
    const padded = { x: Math.max(0, bounds.x - offset), y: Math.max(0, bounds.y - offset), w: Math.min(doc.width, bounds.w + offset * 2), h: Math.min(doc.height, bounds.h + offset * 2) }
    const targetLayer = contentOutputTarget === "new-layer"
      ? {
          ...layer,
          id: uid("layer"),
          name: `${layer.name} Content-Aware Fill`,
          locked: false,
          canvas: (() => {
            const canvas = makeCanvas(doc.width, doc.height)
            canvas.getContext("2d")!.drawImage(layer.canvas, 0, 0)
            return canvas
          })(),
        }
      : layer
    const sourceImage = targetLayer.canvas.getContext("2d")!.getImageData(0, 0, targetLayer.canvas.width, targetLayer.canvas.height)
    const plan = buildContentAwareFillPlan(sourceImage, {
      fillBounds: padded,
      sampling: { mode: contentSamplingMode },
      adaptation: { color: 0.55 },
      patch: {
        patchRadius: contentPatchRadius,
        searchRadius: contentSearchRadius,
        candidateBudget: contentCandidateBudget,
        boundaryCandidateBudget: contentBoundaryBudget,
        refinementPasses: contentRefinementPasses,
        seamRelaxPasses: contentSeamRelaxPasses,
        coherence: contentCoherence,
        fillOrder: contentFillOrder,
      },
      outputTarget: contentOutputTarget,
      preview: true,
    })
    toast.info(`Content-Aware Fill plan: ${plan.fillPixels} fill px, ${plan.samplePixels} sample px, radius ${plan.patch.patchRadius}, ${plan.patch.refinementPasses} refinement pass(es).`)
    contentAwareFill(targetLayer.canvas, padded, undefined, {
      sampling: { mode: contentSamplingMode },
      adaptation: { color: 0.55 },
      patch: plan.patch,
      outputTarget: contentOutputTarget,
    })
    if (contentOutputTarget === "new-layer") dispatch({ type: "add-layer", layer: targetLayer })
    finish("Content-Aware Extend", [targetLayer.id])
  }

  const runGenerativeFill = () => {
    const doc = requireDoc()
    const layer = requireLayer()
    if (!doc || !layer) return
    if (!doc.selection.bounds) {
      toast.error("Create a selection for Generative Fill.")
      return
    }
    const maskCanvas = selectionToMaskCanvas(doc.width, doc.height, doc.selection)
    if (!maskCanvas) return
    const maskImage = maskCanvas.getContext("2d")!.getImageData(0, 0, doc.width, doc.height)
    const sourceImage = layer.canvas.getContext("2d")!.getImageData(0, 0, doc.width, doc.height)
    const maskAlpha = new Uint8ClampedArray(doc.width * doc.height)
    for (let p = 0; p < maskAlpha.length; p++) maskAlpha[p] = maskImage.data[p * 4 + 3]
    const plan = buildGenerativeFillPlan(sourceImage, maskAlpha, {
      prompt: generativePrompt,
      mode: generativeMode,
      provider: "auto",
      outputTarget: contentOutputTarget,
    })
    const generated = applyPromptInpaintImageData(sourceImage, maskAlpha, plan)
    const targetLayer = contentOutputTarget === "new-layer"
      ? {
          ...layer,
          id: uid("layer"),
          name: `${layer.name} Generative Fill`,
          locked: false,
          canvas: makeCanvas(doc.width, doc.height),
        }
      : layer
    targetLayer.canvas.getContext("2d")!.putImageData(generated.image, 0, 0)
    if (contentOutputTarget === "new-layer") dispatch({ type: "add-layer", layer: targetLayer })
    toast.info(`Generative Fill: ${plan.provider.reason}`)
    finish("Generative Fill", [targetLayer.id])
  }

  const definePattern = () => {
    const doc = requireDoc()
    const layer = requireLayer()
    if (!doc || !layer) return
    const bounds = doc.selection.bounds ?? layerContentBounds(layer) ?? { x: 0, y: 0, w: Math.min(128, doc.width), h: Math.min(128, doc.height) }
    const pattern = makeCanvas(Math.max(1, Math.round(bounds.w)), Math.max(1, Math.round(bounds.h)))
    pattern.getContext("2d")!.drawImage(layer.canvas, -bounds.x, -bounds.y)
    const asset: AssetLibraryItem = {
      id: uid("pattern"),
      name: `Pattern ${new Date().toLocaleTimeString()}`,
      kind: "pattern",
      group: "Defined Patterns",
      payload: { dataURL: pattern.toDataURL("image/png"), width: pattern.width, height: pattern.height },
      createdAt: Date.now(),
    }
    dispatch({ type: "set-asset-library", assets: [asset, ...(doc.assetLibrary ?? [])] })
    toast.success("Pattern defined from current pixels")
  }

  const runColorReplacement = () => {
    const layer = requireLayer()
    if (!layer) return
    replaceColor(layer.canvas, replaceFrom, replaceTo, tolerance * 2, true)
    finish("Color Replacement", [layer.id])
  }

  const replaceTextLayers = () => {
    const doc = requireDoc()
    if (!doc || !findText) return
    const result = findReplaceTextLayers(doc.layers, {
      find: findText,
      replace: replaceTextValue,
      caseSensitive: findCaseSensitive,
      wholeWord: findWholeWord,
      useRegex: findUseRegex,
    })
    if (result.error) {
      toast.error(result.error)
      return
    }
    for (const id of result.changedLayerIds) {
      const next = result.layers.find((layer) => layer.id === id)
      if (!next?.text) continue
      dispatch({ type: "set-layer-text", id, text: next.text })
      rasterizeText(next.canvas, next.text)
    }
    if (!result.changedLayerIds.length) toast.info("No matching text layers found.")
    else {
      toast.success(`Replaced ${result.matchCountLabel}.`)
      finish("Find/Replace Text", result.changedLayerIds)
    }
  }

  const spellCheckText = () => {
    const doc = requireDoc()
    if (!doc) return
    const dictionary = new Set("a an and are art brush canvas color document edit edited image layer local mask path photo print scale shape text the this to tool web with".split(" "))
    const misses: string[] = []
    for (const layer of doc.layers) {
      if (layer.kind !== "text" || !layer.text) continue
      for (const word of layer.text.content.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
        if (!dictionary.has(word)) misses.push(`${layer.name}: ${word}`)
      }
    }
    const asset: AssetLibraryItem = { id: uid("spell"), name: "Spell Check Report", kind: "prepress", group: "Type QA", payload: { misses }, createdAt: Date.now() }
    dispatch({ type: "set-asset-library", assets: [asset, ...(doc.assetLibrary ?? [])] })
    toast.info(misses.length ? `${misses.length} possible spelling issue(s)` : "No spelling issues found")
  }

  const saveTextStyle = (kind: "character" | "paragraph") => {
    const doc = requireDoc()
    if (!doc || activeLayer?.kind !== "text" || !activeLayer.text) return toast.error("Select a text layer.")
    const payload =
      kind === "character"
        ? pickText(activeLayer.text, ["font", "size", "weight", "italic", "color", "tracking", "kerning", "baselineShift", "ligatures"])
        : pickText(activeLayer.text, ["align", "justify", "leading", "indentFirst", "indentLeft", "indentRight", "spaceBefore", "spaceAfter", "hyphenation"])
    const asset: AssetLibraryItem = { id: uid(kind), name: `${kind} style`, kind: "style", group: `${kind} styles`, payload, createdAt: Date.now() }
    dispatch({ type: "set-asset-library", assets: [asset, ...(doc.assetLibrary ?? [])] })
    toast.success(`${kind} style saved`)
  }

  const verticalType = () => {
    if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return toast.error("Select a text layer.")
    const next: TextProps = { ...activeLayer.text, vertical: !activeLayer.text.vertical }
    dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
    rasterizeText(activeLayer.canvas, next)
    finish("Vertical Type", [activeLayer.id])
  }

  const putTextOnPath = () => {
    const doc = requireDoc()
    if (!doc || !activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return toast.error("Select a text layer.")
    const y = activeLayer.text.y
    const path = [
      { x: activeLayer.text.x, y },
      { x: activeLayer.text.x + doc.width * 0.25, y: y - 70 },
      { x: activeLayer.text.x + doc.width * 0.55, y: y + 40 },
      { x: activeLayer.text.x + doc.width * 0.8, y: y - 20 },
    ]
    const next: TextProps = { ...activeLayer.text, textPath: path, vertical: false }
    dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
    rasterizeText(activeLayer.canvas, next)
    finish("Text on Path", [activeLayer.id])
  }

  const transformSelection = () => {
    const doc = requireDoc()
    if (!doc?.selection.bounds) return toast.error("Create a selection first.")
    const mask = selectionToMaskCanvas(doc.width, doc.height, doc.selection)
    if (!mask) return
    const next = transformSelectionMask(mask, doc.selection.bounds, selectionScale, selectionRotate)
    dispatch({ type: "set-selection", selection: selectionFromMask(next, "freehand", doc.selection.feather) })
    finish("Transform Selection", [])
  }

  const focusArea = () => {
    const doc = requireDoc()
    const layer = requireLayer()
    if (!doc || !layer) return
    const mask = focusAreaMask(layer.canvas)
    dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
    finish("Focus Area Selection", [])
  }

  const quickSelection = () => {
    const doc = requireDoc()
    const layer = requireLayer()
    if (!doc || !layer) return
    const bounds = layerContentBounds(layer)
    if (!bounds) return
    const seed = doc.selection.bounds
      ? { x: doc.selection.bounds.x + doc.selection.bounds.w / 2, y: doc.selection.bounds.y + doc.selection.bounds.h / 2 }
      : { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
    const mask = edgeAwareQuickSelectionMask(layer.canvas, { seed, tolerance: 52 })
    dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
    finish("Quick Selection", [])
  }

  const recordMeasurement = () => {
    const doc = requireDoc()
    if (!doc) return
    const measurement = doc.measurement ?? { x1: doc.width * 0.2, y1: doc.height * 0.5, x2: doc.width * 0.8, y2: doc.height * 0.5 }
    dispatch({ type: "set-measurement", m: measurement })
    const dx = measurement.x2 - measurement.x1
    const dy = measurement.y2 - measurement.y1
    const payload = { ...measurement, distancePx: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI, scale: `${Math.hypot(dx, dy).toFixed(2)} px = 1 unit` }
    const asset: AssetLibraryItem = { id: uid("measure"), name: `Measurement ${(doc.assetLibrary ?? []).length + 1}`, kind: "prepress", group: "Measurement Log", payload, createdAt: Date.now() }
    dispatch({ type: "set-asset-library", assets: [asset, ...(doc.assetLibrary ?? [])] })
    finish("Record Measurement", [])
  }

  const autoCount = () => {
    const doc = requireDoc()
    const layer = requireLayer()
    if (!doc || !layer) return
    const components = connectedComponents(layer.canvas, 16, 48).slice(0, 200)
    components.forEach((component, index) => {
      const count: CountMarker = { id: uid("count"), x: component.x, y: component.y, group: doc.countGroup ?? "Default", number: (doc.counts?.length ?? 0) + index + 1 }
      dispatch({ type: "add-count", count })
    })
    finish("Auto Count Components", [])
  }

  const setPrintDefaults = () => {
    const doc = requireDoc()
    if (!doc) return
    const settings: PrintSettings = {
      paperSize: "A4",
      orientation: doc.width > doc.height ? "landscape" : "portrait",
      scale: 100,
      bleedMm: 3,
      cropMarks: true,
      registrationMarks: true,
      colorHandling: "app",
      proofPrint: true,
      printerProfile: "Working CMYK",
      marksOffsetMm: 4,
      pagePosition: "center",
    }
    dispatch({ type: "set-print-settings", settings })
    toast.success("Print marks, proofing, and A4 paper setup applied")
  }

  const applyChannelShift = () => {
    const layer = requireLayer()
    if (!layer) return
    shiftChannels(layer.canvas, { r: { x: 6, y: 0 }, g: { x: 0, y: 0 }, b: { x: -6, y: 0 } })
    finish("Shift Channels", [layer.id])
  }

  const applyChannelMixer = () => {
    const layer = requireLayer()
    if (!layer) return
    channelMixer(layer.canvas, [[1.08, -0.04, -0.04], [-0.05, 1.12, -0.03], [0.04, -0.08, 1.1]])
    finish("Channel Mixer", [layer.id])
  }

  const applyGradientMap = () => {
    const layer = requireLayer()
    if (!layer) return
    const stops: ColorStop[] = [{ offset: 0, color: "#111827" }, { offset: 0.52, color: foreground }, { offset: 1, color: background }]
    gradientMap(layer.canvas, stops)
    finish("Gradient Map", [layer.id])
  }

  const runSoftProof = () => {
    const layer = requireLayer()
    if (!layer) return
    softProof(layer.canvas, "cmyk", gamutWarning)
    finish(gamutWarning ? "Gamut Warning" : "Soft Proof", [layer.id])
  }

  const parseIcc = async (file: File) => {
    try {
      const info = parseIccProfile(await file.arrayBuffer())
      setIccInfo(`${info.colorSpace} ${info.deviceClass} v${info.version} ${info.createdAt}`)
      const doc = requireDoc()
      if (doc) {
        const asset: AssetLibraryItem = { id: uid("icc"), name: file.name, kind: "icc-profile", group: "ICC Profiles", payload: info, createdAt: Date.now() }
        dispatch({ type: "set-asset-library", assets: [asset, ...(doc.assetLibrary ?? [])] })
      }
    } catch {
      toast.error("Could not parse ICC profile header.")
    }
  }

  const convertSmartObject = () => {
    const layer = requireLayer()
    if (!layer) return
    dispatch({ type: "set-layer-smart", id: layer.id, smart: true })
    finish("Convert to Smart Object", [layer.id])
  }

  const replaceSmartContents = async (file: File) => {
    const doc = requireDoc()
    const layer = requireLayer()
    if (!doc || !layer) return
    const raster = await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })
    const ctx = layer.canvas.getContext("2d")!
    ctx.clearRect(0, 0, doc.width, doc.height)
    const scale = Math.min(doc.width / raster.canvas.width, doc.height / raster.canvas.height)
    const w = raster.canvas.width * scale
    const h = raster.canvas.height * scale
    ctx.drawImage(raster.canvas, (doc.width - w) / 2, (doc.height - h) / 2, w, h)
    dispatch({ type: "set-layer-smart", id: layer.id, smart: true })
    finish("Replace Smart Object Contents", [layer.id])
  }

  const exportHistoryLog = () => {
    const doc = requireDoc()
    if (!doc) return
    const rows = editor.history.map((entry, index) => `${index + 1}. ${entry.label} (${new Date(Number(entry.id.split("_").pop()) || Date.now()).toISOString()})`)
    downloadText(rows.join("\n"), `${doc.name}-history-log.txt`, "text/plain")
  }

  const createTextureLayer = (mode: "noise" | "brick" | "cross-weave" | "clouds") => {
    const doc = requireDoc()
    if (!doc) return
    const canvas = makeCanvas(doc.width, doc.height)
    drawProceduralTexture(canvas, mode)
    const layer: Layer = { id: uid("layer"), name: `${mode} texture`, kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal", canvas }
    dispatch({ type: "add-layer", layer })
    finish("Procedural Texture", [layer.id])
  }

  const createOnionSkin = () => {
    const doc = requireDoc()
    if (!doc) return
    const frames = doc.timelineFrames ?? []
    const canvas = makeCanvas(doc.width, doc.height)
    const ctx = canvas.getContext("2d")!
    frames.slice(-5).forEach((frame, index) => {
      ctx.globalAlpha = 0.15 + index * 0.12
      for (const layer of doc.layers) {
        if (frame.layerVisibility[layer.id] === false) continue
        ctx.drawImage(layer.canvas, 0, 0)
      }
    })
    ctx.globalAlpha = 1
    const layer: Layer = { id: uid("layer"), name: "Onion Skin Preview", kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal", canvas }
    dispatch({ type: "add-layer", layer })
    finish("Onion Skin Preview", [layer.id])
  }

  const applyMotionBlur = () => {
    const layer = requireLayer()
    if (!layer) return
    motionBlur(layer.canvas, 32, 0, 18)
    finish("Animation Motion Blur", [layer.id])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[1120px] overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[var(--ps-text)]">
        <DialogHeader className="border-b border-[var(--ps-divider)] px-4 py-3">
          <DialogTitle className="text-sm">Algorithmic Operations</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-[680px] grid-cols-[170px_1fr]">
          <div className="border-r border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
            {tabs.map((item) => (
              <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`mb-1 flex h-8 w-full items-center rounded-sm px-3 text-left text-[12px] ${tab === item.id ? "bg-[var(--ps-accent)] text-white" : "hover:bg-[var(--ps-tool-hover)]"}`}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 overflow-y-auto p-4">
            {!activeDoc ? <Empty text="Open a document to run algorithmic operations." /> : null}
            {activeDoc && tab === "paths" && (
              <Section title="Path & Shape Operations" note="Boolean masks, Ramer-Douglas-Peucker simplification, parallel offsets, and stroke outlines.">
                <ButtonGrid>
                  {(["unite", "subtract", "intersect", "exclude"] as const).map((op) => <Button key={op} size="sm" onClick={() => booleanShape(op)}>{op}</Button>)}
                </ButtonGrid>
                <ControlGrid>
                  <NumberField label="Offset px" value={offset} onChange={setOffset} />
                  <NumberField label="Simplify tolerance" value={tolerance} onChange={setTolerance} />
                  <NumberField label="Outline width" value={strokeWidth} onChange={setStrokeWidth} />
                </ControlGrid>
                <ButtonGrid>
                  <Button size="sm" variant="secondary" onClick={offsetPath}>Offset Path</Button>
                  <Button size="sm" variant="secondary" onClick={simplifyPath}>Simplify Path</Button>
                  <Button size="sm" variant="secondary" onClick={outlinePath}>Stroke to Path</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "composite" && (
              <Section title="Compositing & Alignment" note="Geometric matching, feathered alpha blending, seam carving, patch extension, and existing panorama workflows.">
                <ButtonGrid>
                  <Button size="sm" onClick={() => runAutoAlign("centers")}>Auto-Align Centers</Button>
                  <Button size="sm" onClick={() => runAutoAlign("edges")}>Auto-Align Edges</Button>
                  <Button size="sm" onClick={() => runAutoAlign("features")}>Auto-Align Features</Button>
                  <Button size="sm" onClick={runAutoBlend}>Auto-Blend Layers</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-photomerge")}>Stitch Panorama</Button>
                </ButtonGrid>
                <ControlGrid>
                  <NumberField label="Scale %" value={scalePct} onChange={setScalePct} min={20} max={140} />
                  <NumberField label="Extend px" value={offset} onChange={setOffset} min={1} max={240} />
                  <SelectField
                    label="CAF Sampling"
                    value={contentSamplingMode}
                    onChange={(value) => setContentSamplingMode(value as "auto" | "all-except-fill")}
                    options={[
                      { value: "auto", label: "Auto ring" },
                      { value: "all-except-fill", label: "All except fill" },
                    ]}
                  />
                  <SelectField
                    label="CAF Output"
                    value={contentOutputTarget}
                    onChange={(value) => setContentOutputTarget(value as "current-layer" | "new-layer")}
                    options={[
                      { value: "current-layer", label: "Current layer" },
                      { value: "new-layer", label: "New layer" },
                    ]}
                  />
                </ControlGrid>
                <ControlGrid>
                  <NumberField label="Patch radius" value={contentPatchRadius} onChange={setContentPatchRadius} min={1} max={10} />
                  <NumberField label="Search radius" value={contentSearchRadius} onChange={setContentSearchRadius} min={1} max={512} />
                  <NumberField label="Candidates" value={contentCandidateBudget} onChange={setContentCandidateBudget} min={1} max={256} />
                  <NumberField label="Boundary candidates" value={contentBoundaryBudget} onChange={setContentBoundaryBudget} min={0} max={128} />
                  <NumberField label="Refine passes" value={contentRefinementPasses} onChange={setContentRefinementPasses} min={0} max={8} />
                  <NumberField label="Seam relax" value={contentSeamRelaxPasses} onChange={setContentSeamRelaxPasses} min={0} max={8} />
                  <NumberField label="Coherence" value={contentCoherence} onChange={setContentCoherence} min={0} max={4} step={0.05} />
                  <SelectField
                    label="Fill order"
                    value={contentFillOrder}
                    onChange={(value) => setContentFillOrder(value as typeof contentFillOrder)}
                    options={[
                      { value: "edge-first", label: "Edge first" },
                      { value: "center-first", label: "Center first" },
                      { value: "randomized", label: "Randomized" },
                    ]}
                  />
                </ControlGrid>
                <ControlGrid>
                  <SelectField
                    label="Protect Mask"
                    value={seamProtectSource}
                    onChange={(value) => setSeamProtectSource(value as typeof seamProtectSource)}
                    options={[
                      { value: "none", label: "None" },
                      { value: "selection", label: "Current selection" },
                      { value: "layer", label: "Pick layer..." },
                    ]}
                  />
                  {seamProtectSource === "layer" && activeDoc ? (
                    <SelectField
                      label="Protect Layer"
                      value={seamProtectLayerId}
                      onChange={setSeamProtectLayerId}
                      options={[{ value: "", label: "(select layer)" }, ...activeDoc.layers.map((l) => ({ value: l.id, label: l.name }))]}
                    />
                  ) : null}
                  <SelectField
                    label="Remove Mask"
                    value={seamRemoveSource}
                    onChange={(value) => setSeamRemoveSource(value as typeof seamRemoveSource)}
                    options={[
                      { value: "none", label: "None" },
                      { value: "selection", label: "Current selection" },
                      { value: "layer", label: "Pick layer..." },
                    ]}
                  />
                  {seamRemoveSource === "layer" && activeDoc ? (
                    <SelectField
                      label="Remove Layer"
                      value={seamRemoveLayerId}
                      onChange={setSeamRemoveLayerId}
                      options={[{ value: "", label: "(select layer)" }, ...activeDoc.layers.map((l) => ({ value: l.id, label: l.name }))]}
                    />
                  ) : null}
                  <TextField label="Generative Prompt" value={generativePrompt} onChange={setGenerativePrompt} />
                  <SelectField
                    label="Generative Mode"
                    value={generativeMode}
                    onChange={(value) => setGenerativeMode(value as typeof generativeMode)}
                    options={[
                      { value: "remove", label: "Remove" },
                      { value: "fill", label: "Fill" },
                      { value: "expand", label: "Expand" },
                    ]}
                  />
                </ControlGrid>
                <ButtonGrid>
                  <Button size="sm" variant="secondary" onClick={runContentAwareScale}>Content-Aware Scale</Button>
                  <Button size="sm" variant="secondary" onClick={runContentAwareExtend}>Content-Aware Extend</Button>
                  <Button size="sm" variant="secondary" onClick={runGenerativeFill}>Generative Fill</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "set-tool", tool: "content-aware-move" })}>Content-Aware Move Tool</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "paint" && (
              <Section title="Painting & Brush Tools" note="Pattern stamping, art-history source painting, eraser edge modes, and HSV color replacement.">
                <ButtonGrid>
                  <Button size="sm" onClick={() => dispatch({ type: "set-tool", tool: "pattern-stamp" })}>Pattern Stamp Tool</Button>
                  <Button size="sm" onClick={definePattern}>Define Pattern</Button>
                  <Button size="sm" onClick={() => dispatch({ type: "set-tool", tool: "art-history-brush" })}>Art History Brush</Button>
                  <Button size="sm" onClick={() => dispatch({ type: "set-tool", tool: "background-eraser" })}>Background Eraser</Button>
                </ButtonGrid>
                <ControlGrid>
                  <ColorField label="Target" value={replaceFrom} onChange={setReplaceFrom} />
                  <ColorField label="Replacement" value={replaceTo} onChange={setReplaceTo} />
                  <NumberField label="Tolerance" value={tolerance} onChange={setTolerance} min={1} max={80} />
                </ControlGrid>
                <Button size="sm" variant="secondary" onClick={runColorReplacement}>Apply Color Replacement</Button>
              </Section>
            )}
            {activeDoc && tab === "type" && (
              <Section title="Text / Type Features" note="Layer-wide find/replace, dictionary checks, style assets, vertical type, and text-on-path rendering.">
                <ControlGrid>
                  <TextField label="Find" value={findText} onChange={setFindText} />
                  <TextField label="Replace" value={replaceTextValue} onChange={setReplaceTextValue} />
                </ControlGrid>
                <div className="grid grid-cols-3 gap-2 rounded-md border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[10px]">
                  <label className="flex items-center gap-2 text-[var(--ps-text-dim)]">
                    <Checkbox checked={findUseRegex} onCheckedChange={(value) => setFindUseRegex(value === true)} />
                    Regex
                  </label>
                  <label className="flex items-center gap-2 text-[var(--ps-text-dim)]">
                    <Checkbox checked={findCaseSensitive} onCheckedChange={(value) => setFindCaseSensitive(value === true)} />
                    Case
                  </label>
                  <label className="flex items-center gap-2 text-[var(--ps-text-dim)]">
                    <Checkbox checked={findWholeWord} onCheckedChange={(value) => setFindWholeWord(value === true)} />
                    Whole word
                  </label>
                </div>
                {findPreview ? (
                  <div className="rounded-md border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[10px]">
                    <div className={findPreview.error ? "text-amber-300" : "text-[var(--ps-text)]"}>
                      {findPreview.error ?? findPreview.matchCountLabel}
                    </div>
                    {!findPreview.error && findPreview.highlights.length ? (
                      <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                        {findPreview.highlights.map((group) => (
                          <FindHighlightGroupPreview key={group.layerId} group={group} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <ButtonGrid>
                  <Button size="sm" onClick={replaceTextLayers}>Find/Replace Text</Button>
                  <Button size="sm" variant="secondary" onClick={spellCheckText}>Spell Check</Button>
                  <Button size="sm" variant="secondary" onClick={() => saveTextStyle("character")}>Save Character Style</Button>
                  <Button size="sm" variant="secondary" onClick={() => saveTextStyle("paragraph")}>Save Paragraph Style</Button>
                  <Button size="sm" variant="secondary" onClick={verticalType}>Toggle Vertical Type</Button>
                  <Button size="sm" variant="secondary" onClick={putTextOnPath}>Text on Path</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "animation" && (
              <Section title="Animation & Video" note="Video import/render lives in the video workspace; these add algorithmic onion skinning and motion blur.">
                <ButtonGrid>
                  <Button size="sm" onClick={() => dispatchPhotoshopEvent("ps-open-video-render")}>Video Timeline</Button>
                  <Button size="sm" variant="secondary" onClick={createOnionSkin}>Create Onion Skin Layer</Button>
                  <Button size="sm" variant="secondary" onClick={applyMotionBlur}>Apply Motion Blur</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-panel", "timeline")}>Timeline Panel</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "selection" && (
              <Section title="Selection Features" note="Affine selection transforms, quick-selection heuristics, and focus-area edge detection.">
                <ControlGrid>
                  <NumberField label="Scale" value={selectionScale} onChange={setSelectionScale} min={0.1} max={4} step={0.01} />
                  <NumberField label="Rotate degrees" value={selectionRotate} onChange={setSelectionRotate} min={-180} max={180} />
                </ControlGrid>
                <ButtonGrid>
                  <Button size="sm" onClick={transformSelection}>Transform Selection</Button>
                  <Button size="sm" variant="secondary" onClick={quickSelection}>Quick Selection from Layer</Button>
                  <Button size="sm" variant="secondary" onClick={focusArea}>Focus Area Selection</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-select-and-mask")}>Select and Mask</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "analysis" && (
              <Section title="Measurement & Analysis" note="Measurement log assets, custom scale metadata, connected-component counting, and ruler angle math.">
                <ButtonGrid>
                  <Button size="sm" onClick={recordMeasurement}>Record Measurement</Button>
                  <Button size="sm" variant="secondary" onClick={autoCount}>Auto Count Components</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "set-tool", tool: "ruler" })}>Ruler Tool</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-panel", "measurement-log")}>Measurement Log Panel</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "print" && (
              <Section title="Print Features" note="Print setup, print preview, print marks, bleed, paper size, and proof-print options.">
                <ButtonGrid>
                  <Button size="sm" onClick={setPrintDefaults}>Apply Print Setup</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-print-workflow")}>Print Preview Workspace</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "color" && (
              <Section title="Color Management & Pixel Operations" note="ICC header parsing, matrix conversion, soft proofing, gamut warning, LUT-style maps, and channel math.">
                <ButtonGrid>
                  <Button size="sm" onClick={applyChannelShift}>Shift Channels</Button>
                  <Button size="sm" variant="secondary" onClick={applyChannelMixer}>Channel Mixer</Button>
                  <Button size="sm" variant="secondary" onClick={applyGradientMap}>Gradient Map</Button>
                  <Button size="sm" variant="secondary" onClick={runSoftProof}>Soft Proof / Gamut</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-gap-workflow", "apply-image")}>Apply Image</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-gap-workflow", "calculations")}>Calculations</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-gap-workflow", "split-channels")}>Split Channels</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-gap-workflow", "merge-channels")}>Merge Channels</Button>
                </ButtonGrid>
                <label className="mt-3 flex items-center gap-2 text-[11px]">
                  <Checkbox checked={gamutWarning} onCheckedChange={(value) => setGamutWarning(value === true)} />
                  Show gamut warning instead of proof conversion
                </label>
                <label className="mt-3 flex cursor-pointer items-center justify-between rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2 text-[11px]">
                  <span>{iccInfo || "Import ICC/ICM profile header"}</span>
                  <input type="file" accept=".icc,.icm,application/vnd.iccprofile" className="hidden" onChange={(event) => event.target.files?.[0] && void parseIcc(event.target.files[0])} />
                </label>
              </Section>
            )}
            {activeDoc && tab === "automation" && (
              <Section title="Automation & Scripting" note="Actions, batch processing, image processor, contact sheets, variables, and datasets are connected to existing execution flows.">
                <ButtonGrid>
                  <Button size="sm" onClick={() => createAction("Algorithm Action")}>Recordable Action</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-automation-workflow")}>Droplets / Script Events</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-batch-processing")}>Batch Processing</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-image-processor")}>Image Processor</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-variables")}>Variables / Data Sets</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-gap-workflow", "pdf-presentation")}>PDF Presentation</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "smart" && (
              <Section title="Smart Objects & 3D" note="Non-destructive layer flags, content replacement, edit contents, linked-style metadata, and native 3D workspace access.">
                <ButtonGrid>
                  <Button size="sm" onClick={convertSmartObject}>Convert to Smart Object</Button>
                  <Button size="sm" variant="secondary" onClick={() => editSmartObject(activeLayer)}>Edit Contents</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-3d-workspace")}>3D Workspace</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-3d-workspace")}>3D Text / Materials</Button>
                </ButtonGrid>
                <label className="mt-3 flex cursor-pointer items-center justify-between rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2 text-[11px]">
                  <span>Replace Contents from image file</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => event.target.files?.[0] && void replaceSmartContents(event.target.files[0])} />
                </label>
              </Section>
            )}
            {activeDoc && tab === "workspace" && (
              <Section title="Workspace & UI Improvements" note="Custom workspaces, menu/shortcut management, preset assets, and tool presets are routed from one place.">
                <ButtonGrid>
                  <Button size="sm" onClick={() => dispatchPhotoshopEvent("ps-open-workspace-manager")}>Workspace Manager</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-shortcuts")}>Shortcut Customization</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-panel", "tool-presets")}>Tool Presets</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-panel", "preset-manager")}>Preset Manager</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "history" && (
              <Section title="History Enhancements" note="Snapshots, step controls, and serialized history logs for audit/replay workflows.">
                <ButtonGrid>
                  <Button size="sm" onClick={() => createHistorySnapshot("Algorithm Snapshot")}>Create Snapshot</Button>
                  <Button size="sm" variant="secondary" onClick={exportHistoryLog}>Export History Log</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-panel", "history")}>History Panel</Button>
                </ButtonGrid>
              </Section>
            )}
            {activeDoc && tab === "texture" && (
              <Section title="Texture & Pattern Generation" note="Canvas extraction, scripted patterns, procedural noise, and pattern preview generation.">
                <ButtonGrid>
                  <Button size="sm" onClick={() => createTextureLayer("noise")}>Noise Texture</Button>
                  <Button size="sm" variant="secondary" onClick={() => createTextureLayer("brick")}>Brick Pattern</Button>
                  <Button size="sm" variant="secondary" onClick={() => createTextureLayer("cross-weave")}>Cross Weave</Button>
                  <Button size="sm" variant="secondary" onClick={() => createTextureLayer("clouds")}>Cloud Texture</Button>
                  <Button size="sm" variant="secondary" onClick={definePattern}>Define Pattern</Button>
                  <Button size="sm" variant="secondary" onClick={() => dispatchPhotoshopEvent("ps-open-gap-workflow", "scripted-pattern")}>Scripted Patterns</Button>
                </ButtonGrid>
              </Section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function pickText(text: TextProps, keys: (keyof TextProps)[]) {
  return Object.fromEntries(keys.map((key) => [key, text[key]]).filter(([, value]) => value !== undefined))
}

function FindHighlightGroupPreview({
  group,
}: {
  group: ReturnType<typeof findReplaceTextLayers>["highlights"][number]
}) {
  return (
    <div className="min-w-0 rounded-sm bg-[var(--ps-panel)] px-2 py-1">
      <div className="flex items-center justify-between gap-2 text-[9px] text-[var(--ps-text-dim)]">
        <span className="truncate">{group.layerName}</span>
        <span className="shrink-0">{group.matchCountLabel}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-4">
        {group.segments.map((segment, index) => (
          segment.highlight ? (
            <mark key={index} className="rounded-sm bg-amber-400/30 px-0.5 text-amber-100">{segment.text}</mark>
          ) : (
            <React.Fragment key={index}>{segment.text}</React.Fragment>
          )
        ))}
      </div>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[var(--ps-text-dim)]">{note}</p>
      </div>
      {children}
    </div>
  )
}

function ButtonGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">{children}</div>
}

function ControlGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{children}</div>
}

function NumberField({ label, value, onChange, min = -999, max = 999, step = 1 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="grid gap-1 text-[11px] text-[var(--ps-text-dim)]">
      {label}
      <Input className={smallInput} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))} />
    </label>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-[11px] text-[var(--ps-text-dim)]">
      {label}
      <Input className={smallInput} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-1 text-[11px] text-[var(--ps-text-dim)]">
      {label}
      <select className={`${smallInput} rounded-sm border border-[var(--ps-divider)] px-2`} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-[11px] text-[var(--ps-text-dim)]">
      {label}
      <Input className="h-8 w-24 p-1" type="color" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-sm border border-[var(--ps-divider)] p-6 text-center text-[12px] text-[var(--ps-text-dim)]">{text}</div>
}
