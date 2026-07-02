"use client"

import * as React from "react"
import { useEditor, useRenderSubscription } from "../editor-context"
import { makeCanvas } from "../editor-context"
import { FILTERS } from "../filters"
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Copy,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Folder,
  FolderOpen,
  Link2,
  Link2Off,
  CircleSlash2,
  CornerDownRight,
  Search,
  Filter,
  ListChecks,
  X,
  Type as TypeIcon,
  Square as SquareIcon,
  Image as ImageIcon,
  PenTool,
  Palette,
  GripVertical,
  AlertTriangle,
  Sparkles,
  Tag,
  Download,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { AdjustmentType, BlendMode, Layer, LayerKind, PsDocument } from "../types"
import { createAdjustmentLayer as createAdjustmentLayerModel, isAdjustmentNoop } from "../adjustment-layers"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "../events"
import type { MergedRenderChange } from "../render-bus"
import { createLayerMetadata, layerMatchesQuery } from "../layer-workflows"
import { copyLayerCss, copyLayerSvg } from "../vector-clipboard"
import { uid } from "../uid"

const BLENDS: BlendMode[] = [
  "normal",
  "dissolve",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "darker-color",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "lighter-color",
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
  "hue",
  "saturation",
  "color",
  "luminosity",
]

type FilterKind = "all" | string

const LAYER_FILTER_TOKENS: Record<string, string> = {
  // Kind
  raster: "kind:pixel",
  text: "kind:text",
  shape: "kind:shape",
  adjustment: "kind:adjustment",
  "smart-object": "attr:smart",
  frame: "kind:frame",
  artboard: "kind:artboard",
  group: "kind:group",
  threeD: "kind:3d",
  video: "kind:video",
  // Attribute
  locked: "attr:locked",
  hidden: "attr:hidden",
  visible: "visible:true",
  linked: "attr:linked",
  masked: "attr:masked",
  styled: "attr:effects",
  smart: "attr:smart",
  clipped: "attr:clipped",
  "attr:smart-filter": "attr:smart-filter",
  "attr:knockout": "attr:knockout",
  "attr:blend-if": "attr:blend-if",
  // Mode
  "mode:normal": "mode:normal",
  "mode:multiply": "mode:multiply",
  "mode:screen": "mode:screen",
  "mode:overlay": "mode:overlay",
  "mode:soft-light": "mode:soft-light",
  "mode:hard-light": "mode:hard-light",
  "mode:darken": "mode:darken",
  "mode:lighten": "mode:lighten",
  // Effect
  "effect:drop-shadow": "effect:drop-shadow",
  "effect:inner-shadow": "effect:inner-shadow",
  "effect:outer-glow": "effect:outer-glow",
  "effect:inner-glow": "effect:inner-glow",
  "effect:bevel": "effect:bevel",
  "effect:satin": "effect:satin",
  "effect:stroke": "effect:stroke",
  "effect:glow": "effect:glow",
  "effect:color-overlay": "effect:color-overlay",
  "effect:gradient-overlay": "effect:gradient-overlay",
  "effect:pattern-overlay": "effect:pattern-overlay",
  // Color label
  "label:red": "color:red",
  "label:orange": "color:orange",
  "label:yellow": "color:yellow",
  "label:green": "color:green",
  "label:blue": "color:blue",
  "label:violet": "color:violet",
  "label:gray": "color:gray",
  "label:none": "color:none",
  // Channels
  "channel:r-off": "channel:r-off",
  "channel:g-off": "channel:g-off",
  "channel:b-off": "channel:b-off",
}

export const COLOR_LABELS: { id: NonNullable<Layer["colorLabel"]>; bg: string; label: string }[] = [
  { id: "none", bg: "transparent", label: "None" },
  { id: "red", bg: "#d04a4a", label: "Red" },
  { id: "orange", bg: "#e08a3c", label: "Orange" },
  { id: "yellow", bg: "#d8c44a", label: "Yellow" },
  { id: "green", bg: "#5fa55a", label: "Green" },
  { id: "blue", bg: "#4f88c8", label: "Blue" },
  { id: "violet", bg: "#9266c4", label: "Violet" },
  { id: "gray", bg: "#7d7d7d", label: "Gray" },
]

function adjustmentMaskState(layer: Layer) {
  if (layer.kind !== "adjustment") return undefined
  if (layer.maskEnabled === false) return "disabled"
  if (!layer.mask) return "none"
  const ctx = layer.mask.getContext("2d")
  if (!ctx) return "none"
  const points = [
    [0, 0],
    [Math.max(0, Math.floor(layer.mask.width / 2)), Math.max(0, Math.floor(layer.mask.height / 2))],
    [Math.max(0, layer.mask.width - 1), 0],
    [0, Math.max(0, layer.mask.height - 1)],
    [Math.max(0, layer.mask.width - 1), Math.max(0, layer.mask.height - 1)],
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

// One-click filter presets surfaced as buttons above the layer list. Each maps
// to the same query tokens the dropdown filter uses, except "empty" which is
// resolved against the live emptiness analysis below.
const LAYER_FILTER_PRESETS: { label: string; kind: string }[] = [
  { label: "Visible only", kind: "visible" },
  { label: "Has mask", kind: "masked" },
  { label: "Has effects", kind: "styled" },
  { label: "Smart object", kind: "smart-object" },
  { label: "Adjustment", kind: "adjustment" },
  { label: "Locked", kind: "locked" },
  { label: "Empty", kind: "empty" },
]

interface LayerHealthWarning {
  id: string
  layerId?: string
  message: string
  severity: "warn" | "info"
}

/** Cheap downscaled probe — true if the canvas has any non-transparent pixel. */
function canvasHasPixels(canvas: HTMLCanvasElement): boolean {
  const sw = Math.max(1, Math.min(64, canvas.width))
  const sh = Math.max(1, Math.min(64, canvas.height))
  const probe = makeCanvas(sw, sh)
  const ctx = probe.getContext("2d", { willReadFrequently: true })
  if (!ctx) return true
  try {
    ctx.clearRect(0, 0, sw, sh)
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, sw, sh)
    const data = ctx.getImageData(0, 0, sw, sh).data
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true
  } catch {
    return true
  }
  return false
}

/** True if a mask is effectively all-black (fully hides its layer). */
function maskFullyHidden(mask: HTMLCanvasElement): boolean {
  const sw = Math.max(1, Math.min(64, mask.width))
  const sh = Math.max(1, Math.min(64, mask.height))
  const probe = makeCanvas(sw, sh)
  const ctx = probe.getContext("2d", { willReadFrequently: true })
  if (!ctx) return false
  try {
    ctx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, sw, sh)
    const data = ctx.getImageData(0, 0, sw, sh).data
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 8) return false
    }
  } catch {
    return false
  }
  return true
}

/** Surface non-fatal "layer health" issues a user would want flagged. */
function analyzeLayerHealth(doc: PsDocument): { warnings: LayerHealthWarning[]; emptyIds: Set<string> } {
  const warnings: LayerHealthWarning[] = []
  const emptyIds = new Set<string>()
  for (const layer of doc.layers) {
    if (layer.kind === "group") continue
    const isPixel = !layer.kind || layer.kind === "raster"
    if (isPixel && !layer.smartObject && layer.kind !== "smart-object" && !canvasHasPixels(layer.canvas)) {
      emptyIds.add(layer.id)
      warnings.push({ id: `empty-${layer.id}`, layerId: layer.id, message: `"${layer.name}" is empty`, severity: "warn" })
    }
    if (layer.visible === false) {
      warnings.push({ id: `hidden-${layer.id}`, layerId: layer.id, message: `"${layer.name}" is hidden`, severity: "info" })
    }
    if (layer.mask && maskFullyHidden(layer.mask)) {
      warnings.push({ id: `masked-${layer.id}`, layerId: layer.id, message: `"${layer.name}" is fully hidden by its mask`, severity: "warn" })
    }
  }
  const bytes = doc.width * doc.height * 4 * Math.max(1, doc.layers.length)
  if (bytes > 320 * 1024 * 1024) {
    warnings.push({
      id: "memory",
      message: `High memory: ~${Math.round(bytes / (1024 * 1024))} MB across ${doc.layers.length} layers`,
      severity: "warn",
    })
  }
  return { warnings, emptyIds }
}

export function LayersPanel() {
  const {
    activeDoc,
    dispatch,
    newLayer,
    newGroup,
    addLayerMask,
    commit,
    requestRender,
    selectedLayers,
    activeSmartFilterMaskTarget,
  } = useEditor()
  const [search, setSearch] = React.useState("")
  const [filterKind, setFilterKind] = React.useState<FilterKind>("all")
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [hoverId, setHoverId] = React.useState<string | null>(null)
  const [hoverPos, setHoverPos] = React.useState<"above" | "below" | "into">("above")
  const [altDown, setAltDown] = React.useState(false)
  const [altClipLayerId, setAltClipLayerId] = React.useState<string | null>(null)
  const [contextMenu, setContextMenu] = React.useState<{ layerId: string; x: number; y: number } | null>(null)
  const [smartFilterContextMenu, setSmartFilterContextMenu] = React.useState<{ layerId: string; filterId: string; x: number; y: number } | null>(null)
  const [draggedSmartFilter, setDraggedSmartFilter] = React.useState<{ layerId: string; filterId: string } | null>(null)
  const draggedSmartFilterRef = React.useRef<{ layerId: string; filterId: string } | null>(null)
  const mouseSmartFilterDragRef = React.useRef<{ layerId: string; filterId: string } | null>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!contextMenu && !smartFilterContextMenu) return
    const close = () => {
      setContextMenu(null)
      setSmartFilterContextMenu(null)
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", close)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", close)
    }
  }, [contextMenu, smartFilterContextMenu])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const query = String((event as CustomEvent).detail?.query ?? "")
      if (query) setSearch(query)
      window.setTimeout(() => {
        searchRef.current?.focus()
        searchRef.current?.select()
      }, 0)
    }
    return addPhotoshopEventListener("ps-focus-layer-search", (_detail, event) => handler(event))
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltDown(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setAltDown(false)
        setAltClipLayerId(null)
      }
    }
    const onBlur = () => {
      setAltDown(false)
      setAltClipLayerId(null)
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
    }
  }, [])

  const { warnings: healthWarnings, emptyIds: emptyLayerIds } = React.useMemo(
    () => (activeDoc ? analyzeLayerHealth(activeDoc) : { warnings: [], emptyIds: new Set<string>() }),
    [activeDoc],
  )

  if (!activeDoc) return null

  const active = activeDoc.layers.find((l) => l.id === activeDoc.activeLayerId)
  const layerLocked = (layer: Layer | null | undefined) => !!layer && (layer.locked || layer.lockAll)
  const layerMoveLocked = (layer: Layer | null | undefined) => layerLocked(layer) || !!layer?.lockMove
  const activeLocked = layerLocked(active)
  const activeMoveLocked = layerMoveLocked(active)
  const selectedHasLocked = selectedLayers.some(layerLocked)
  const canMergeSelected = selectedLayers.length > 1 && !selectedHasLocked
  const canDeleteActive = !!active && !activeLocked && activeDoc.layers.length > 1
  const canMoveActive = !!active && !activeMoveLocked
  // Display in top-of-stack-first order (Photoshop convention)
  const reversed = [...activeDoc.layers].reverse()
  // Hide layers whose parent group is collapsed
  const layerById = new Map(activeDoc.layers.map((layer) => [layer.id, layer]))
  const isHiddenByCollapsedAncestor = (layer: Layer) => {
    let parentId = layer.parentId
    while (parentId) {
      const parent = layerById.get(parentId)
      if (!parent) return false
      if (parent.expanded === false) return true
      parentId = parent.parentId
    }
    return false
  }
  const collapseFiltered = reversed.filter((l) => {
    return !isHiddenByCollapsedAncestor(l)
  })

  const visibleLayers = collapseFiltered.filter((l) => {
    if (search && !layerMatchesQuery(l, search)) return false
    if (filterKind === "all") return true
    if (filterKind === "empty") return emptyLayerIds.has(l.id)
    return layerMatchesQuery(l, LAYER_FILTER_TOKENS[filterKind] ?? filterKind)
  })

  const filtersActive = search.trim() || filterKind !== "all"
  const selectedVisibleCount = visibleLayers.filter((layer) => activeDoc.selectedLayerIds.includes(layer.id)).length

  const linkedSelected = selectedLayers.length >= 2 && selectedLayers.every((l) => l.linkGroupId)

  const setLayerColorLabel = (id: string, label: Layer["colorLabel"]) => {
    dispatch({ type: "set-layer-color-label", id, label })
    setContextMenu(null)
    setTimeout(() => commit("Layer Color Label", [id]), 0)
  }

  // ---- Batch operations across the current multi-selection ----
  const batchTargets = (): Layer[] => (selectedLayers.length ? selectedLayers : active ? [active] : [])

  const batchRenameSelected = () => {
    const targets = batchTargets().filter((l) => !layerLocked(l))
    if (!targets.length) {
      toast.info("Select one or more unlocked layers to rename.")
      return
    }
    const base = window.prompt(
      `Rename ${targets.length} selected layer${targets.length === 1 ? "" : "s"} to:`,
      targets[0].name,
    )
    if (!base?.trim()) return
    const trimmed = base.trim()
    targets.forEach((layer, index) => {
      const name = targets.length === 1 ? trimmed : `${trimmed} ${index + 1}`
      dispatch({ type: "rename-layer", id: layer.id, name })
    })
    setTimeout(() => commit("Rename Selected Layers", targets.map((l) => l.id)), 0)
  }

  const batchColorLabelSelected = (label: NonNullable<Layer["colorLabel"]>) => {
    const targets = batchTargets()
    if (!targets.length) return
    targets.forEach((layer) => dispatch({ type: "set-layer-color-label", id: layer.id, label }))
    setTimeout(() => commit("Color Label Selected Layers", targets.map((l) => l.id)), 0)
  }

  const batchConvertSelectedToSmartObject = () => {
    const targets = batchTargets().filter((l) => !l.smartObject && l.kind !== "smart-object")
    if (!targets.length) {
      toast.info("Selected layers are already smart objects.")
      return
    }
    targets.forEach((layer) => dispatch({ type: "set-layer-smart", id: layer.id, smart: true }))
    setTimeout(() => commit("Convert Selected to Smart Object", targets.map((l) => l.id)), 0)
  }

  const batchExportSelectedLayers = () => {
    const targets = batchTargets().filter((l) => l.kind !== "group")
    if (!targets.length) {
      toast.info("Select one or more pixel layers to export.")
      return
    }
    let exported = 0
    for (const layer of targets) {
      try {
        const url = layer.canvas.toDataURL("image/png")
        const a = document.createElement("a")
        a.href = url
        a.download = `${(layer.name || "layer").replace(/[\\/:*?"<>|]/g, "_")}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
        exported++
      } catch {
        // Ignore layers whose canvas cannot be serialized.
      }
    }
    toast.success(`Exported ${exported} layer${exported === 1 ? "" : "s"} as PNG.`)
  }

  const addLayerNote = (layer: Layer) => {
    const text = window.prompt("Layer note", layer.notes?.[0]?.text ?? "")
    if (!text?.trim()) return
    dispatch({
      type: "add-layer-note",
      id: layer.id,
      note: {
        id: uid("layer_note"),
        text: text.trim(),
        createdAt: Date.now(),
      },
    })
    setContextMenu(null)
    setTimeout(() => commit("Layer Note", [layer.id]), 0)
  }

  const editLayerTags = (layer: Layer) => {
    const value = window.prompt("Layer tags", (layer.metadata?.tags ?? []).join(", "))
    if (value === null) return
    dispatch({
      type: "set-layer-metadata",
      id: layer.id,
      metadata: createLayerMetadata({
        ...(layer.metadata ?? {}),
        tags: value.split(",").map((tag) => tag.trim()).filter(Boolean),
      }),
    })
    setContextMenu(null)
    setTimeout(() => commit("Layer Metadata", [layer.id]), 0)
  }

  const writeClipboardText = (text: string) => {
    if (!text) return
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.left = "-9999px"
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      textarea.remove()
    }
  }

  const copyVectorLayerCss = (layer: Layer) => {
    writeClipboardText(copyLayerCss(layer))
    setContextMenu(null)
  }

  const copyVectorLayerSvg = (layer: Layer) => {
    writeClipboardText(copyLayerSvg(layer, { width: activeDoc.width, height: activeDoc.height }))
    setContextMenu(null)
  }

  const updateSmartFilter = (layer: Layer, filterId: string, patch: Partial<NonNullable<Layer["smartFilters"]>[number]>, label: string) => {
    dispatch({ type: "update-smart-filter", layerId: layer.id, filterId, patch })
    requestRender()
    setTimeout(() => commit(label, [layer.id]), 0)
  }

  const moveSmartFilterByDrop = (layer: Layer, fromFilterId: string | null, toFilterId: string) => {
    if (!fromFilterId || fromFilterId === toFilterId || layerLocked(layer)) return
    const filters = layer.smartFilters ?? []
    const from = filters.findIndex((filter) => filter.id === fromFilterId)
    const to = filters.findIndex((filter) => filter.id === toFilterId)
    if (from < 0 || to < 0 || from === to) return
    const next = filters.slice()
    const [entry] = next.splice(from, 1)
    next.splice(to, 0, entry)
    dispatch({ type: "set-layer-smart-filters", id: layer.id, smartFilters: next })
    requestRender()
    setTimeout(() => commit("Reorder Smart Filter", [layer.id]), 0)
  }

  const editSmartFilterMask = (layer: Layer, filterId: string) => {
    if (layerLocked(layer)) return
    const filter = layer.smartFilters?.find((candidate) => candidate.id === filterId)
    if (!filter) return
    dispatch({ type: "set-active-layer", id: layer.id })
    if (!filter.mask) {
      dispatch({ type: "set-smart-filter-mask", layerId: layer.id, filterId, mask: makeCanvas(activeDoc.width, activeDoc.height, "#ffffff"), enabled: true })
      setTimeout(() => commit("Reveal Smart Filter Mask", [layer.id]), 0)
    } else if (filter.maskEnabled === false) {
      dispatch({ type: "update-smart-filter", layerId: layer.id, filterId, patch: { maskEnabled: true } })
      setTimeout(() => commit("Enable Smart Filter Mask", [layer.id]), 0)
    }
    dispatch({ type: "set-active-smart-filter-mask", target: { layerId: layer.id, filterId } })
    dispatch({ type: "set-tool", tool: "brush" })
    requestRender()
    setSmartFilterContextMenu(null)
  }

  const commitLayerChange = (label: string, ids: string[] = active ? [active.id] : []) => {
    requestRender()
    window.setTimeout(() => commit(label, ids), 0)
  }

  const canClipToLayerBelow = (layer: Layer) => {
    if (layer.kind === "group" || layerLocked(layer)) return false
    return activeDoc.layers.findIndex((candidate) => candidate.id === layer.id) > 0
  }

  const toggleClipToLayerBelow = (layer: Layer) => {
    if (!canClipToLayerBelow(layer)) return
    dispatch({ type: "toggle-layer-clipped", id: layer.id })
    requestRender()
    window.setTimeout(() => commit(layer.clipped ? "Release Clipping Mask" : "Create Clipping Mask", [layer.id]), 0)
  }

  const toggleLayerLock = (id: string, type: "all" | "transparency" | "draw" | "move" | "legacy") => {
    const action =
      type === "all"
        ? ({ type: "toggle-layer-lock-all", id } as const)
        : type === "transparency"
          ? ({ type: "toggle-layer-lock-transparency", id } as const)
          : type === "draw"
            ? ({ type: "toggle-layer-lock-draw", id } as const)
            : type === "move"
              ? ({ type: "toggle-layer-lock-move", id } as const)
              : ({ type: "toggle-layer-lock", id } as const)
    dispatch(action)
    commitLayerChange("Layer Lock", [id])
  }

  const createAdjustmentLayer = (filterId: AdjustmentType) => {
    const filter = FILTERS[filterId]
    if (!filter) return
    const layer = createAdjustmentLayerModel({
      filterId,
      width: activeDoc.width,
      height: activeDoc.height,
      layers: activeDoc.layers,
      makeCanvas,
    })
    dispatch({ type: "add-layer", layer })
    if (!isAdjustmentNoop(layer.adjustment)) requestRender()
    setTimeout(() => commit(`New ${filter.name} Adjustment`, [layer.id]), 0)
  }

  const selectVisibleResults = () => {
    if (!visibleLayers.length) return
    const ids = visibleLayers.map((layer) => layer.id)
    dispatch({ type: "set-selected-layers", ids, activeId: ids[0] })
  }

  const onLayerClick = (e: React.MouseEvent, layer: Layer) => {
    if (!activeDoc) return
    if (e.shiftKey) {
      const fromIdx = activeDoc.layers.findIndex((l) => l.id === activeDoc.activeLayerId)
      const toIdx = activeDoc.layers.findIndex((l) => l.id === layer.id)
      if (fromIdx < 0 || toIdx < 0) return
      const [a, b] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
      const ids = activeDoc.layers.slice(a, b + 1).map((l) => l.id)
      dispatch({ type: "set-selected-layers", ids, activeId: layer.id })
      return
    }
    if (e.metaKey || e.ctrlKey) {
      if (layer.kind === "adjustment") {
        dispatch({ type: "toggle-layer-clipped", id: layer.id })
        requestRender()
        window.setTimeout(() => commit(layer.clipped ? "Unclip Adjustment Layer" : "Clip Adjustment Layer", [layer.id]), 0)
        return
      }
      const set = new Set(activeDoc.selectedLayerIds)
      if (set.has(layer.id)) {
        set.delete(layer.id)
        if (set.size === 0) set.add(layer.id)
      } else {
        set.add(layer.id)
      }
      dispatch({
        type: "set-selected-layers",
        ids: Array.from(set),
        activeId: layer.id,
      })
      return
    }
    dispatch({ type: "set-active-layer", id: layer.id })
  }

  const openAdjustmentSettings = (layer: Layer) => {
    if (layer.kind !== "adjustment") return
    dispatch({ type: "set-active-layer", id: layer.id })
    dispatchPhotoshopEvent("ps-open-panel", "adjustments")
  }

  const renderSmartFilterSubItems = (layer: Layer, indent: number) => {
    if (!(layer.smartObject || layer.kind === "smart-object") || !layer.smartFilters?.length) return null
    return layer.smartFilters.map((filter) => {
      const editing = activeSmartFilterMaskTarget?.layerId === layer.id && activeSmartFilterMaskTarget.filterId === filter.id
      const enabled = filter.enabled !== false
      const maskEnabled = filter.maskEnabled !== false
      const maskLinked = filter.maskLinked !== false
      return (
        <div
          key={`${layer.id}-${filter.id}`}
          draggable={!layerLocked(layer)}
          data-testid={`layer-smart-filter-row-${layer.name}-${filter.name}`}
          data-smart-filter-enabled={enabled ? "true" : "false"}
          data-smart-filter-mask-editing={editing ? "true" : "false"}
          className={cn(
            "flex h-7 items-center gap-1.5 border-b border-[var(--ps-divider)]/40 px-1.5 text-[10px] text-[var(--ps-text-dim)]",
            editing ? "bg-[var(--ps-accent)]/15 text-[var(--ps-text)]" : "bg-[var(--ps-panel)] hover:bg-[var(--ps-tool-hover)]/40",
          )}
          style={{ paddingLeft: indent + 28 }}
          onClick={(e) => {
            e.stopPropagation()
            dispatch({ type: "set-active-layer", id: layer.id })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            dispatch({ type: "set-active-layer", id: layer.id })
            setSmartFilterContextMenu({ layerId: layer.id, filterId: filter.id, x: e.clientX, y: e.clientY })
          }}
          onMouseDown={(e) => {
            if (e.button !== 0 || layerLocked(layer)) return
            if ((e.target as HTMLElement).closest("button")) return
            mouseSmartFilterDragRef.current = { layerId: layer.id, filterId: filter.id }
          }}
          onMouseUp={() => {
            const source = mouseSmartFilterDragRef.current
            mouseSmartFilterDragRef.current = null
            if (!source || source.layerId !== layer.id || source.filterId === filter.id) return
            moveSmartFilterByDrop(layer, source.filterId, filter.id)
          }}
          onDragStart={(e) => {
            if (layerLocked(layer)) {
              e.preventDefault()
              return
            }
            e.stopPropagation()
            const source = { layerId: layer.id, filterId: filter.id }
            draggedSmartFilterRef.current = source
            setDraggedSmartFilter(source)
            e.dataTransfer.setData("application/x-ps-smart-filter-layer-id", layer.id)
            e.dataTransfer.setData("application/x-ps-smart-filter-id", filter.id)
            e.dataTransfer.effectAllowed = "move"
          }}
          onDragOver={(e) => {
            const sourceLayerId = e.dataTransfer.getData("application/x-ps-smart-filter-layer-id") || draggedSmartFilterRef.current?.layerId || draggedSmartFilter?.layerId
            const sourceFilterId = e.dataTransfer.getData("application/x-ps-smart-filter-id") || draggedSmartFilterRef.current?.filterId || draggedSmartFilter?.filterId
            if (sourceLayerId !== layer.id || !sourceFilterId || sourceFilterId === filter.id || layerLocked(layer)) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = "move"
          }}
          onDrop={(e) => {
            const sourceLayerId = e.dataTransfer.getData("application/x-ps-smart-filter-layer-id") || draggedSmartFilterRef.current?.layerId || draggedSmartFilter?.layerId
            const sourceFilterId = e.dataTransfer.getData("application/x-ps-smart-filter-id") || draggedSmartFilterRef.current?.filterId || draggedSmartFilter?.filterId || null
            if (sourceLayerId !== layer.id) return
            e.preventDefault()
            e.stopPropagation()
            moveSmartFilterByDrop(layer, sourceFilterId, filter.id)
            draggedSmartFilterRef.current = null
            setDraggedSmartFilter(null)
          }}
          onDragEnd={() => {
            draggedSmartFilterRef.current = null
            setDraggedSmartFilter(null)
          }}
        >
          <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-[var(--ps-text-dim)]" aria-hidden="true" />
          <button
            type="button"
            aria-label={`${enabled ? "Disable" : "Enable"} ${filter.name} smart filter`}
            title={`${enabled ? "Disable" : "Enable"} smart filter`}
            className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text)]"
            onClick={(e) => {
              e.stopPropagation()
              updateSmartFilter(layer, filter.id, { enabled: !enabled }, "Toggle Smart Filter")
            }}
          >
            {enabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 opacity-50" />}
          </button>
          <SmartFilterMaskThumb
            layerId={layer.id}
            layerName={layer.name}
            filterName={filter.name}
            mask={filter.mask}
            enabled={maskEnabled}
            editing={editing}
            linked={maskLinked}
            density={filter.maskDensity ?? 1}
            feather={filter.maskFeather ?? 0}
          />
          <button
            type="button"
            aria-label={`${maskLinked ? "Unlink" : "Link"} ${filter.name} smart filter mask`}
            title={`${maskLinked ? "Unlink" : "Link"} smart filter mask`}
            className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text)]"
            onClick={(e) => {
              e.stopPropagation()
              updateSmartFilter(layer, filter.id, { maskLinked: !maskLinked }, "Toggle Smart Filter Mask Link")
            }}
          >
            {maskLinked ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3 text-[var(--ps-text-dim)]" />}
          </button>
          <span className={cn("min-w-0 flex-1 truncate", !enabled && "line-through opacity-60")}>{filter.name}</span>
          <span className="shrink-0 tabular-nums">{Math.round((filter.opacity ?? 1) * 100)}%</span>
        </div>
      )
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 py-2 border-b border-[var(--ps-divider)]">
        <Select
          value={active?.blendMode ?? "normal"}
          disabled={!active || activeLocked}
          onValueChange={(v) => {
            if (!active || activeLocked) return
            dispatch({ type: "set-layer-blend", id: active.id, blendMode: v as BlendMode })
            commitLayerChange("Layer Blend Mode", [active.id])
          }}
        >
          <SelectTrigger aria-label="Layer blend mode" className="h-6 w-full text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLENDS.map((b) => (
              <SelectItem key={b} value={b} className="text-[11px] capitalize">
                {b.replace("-", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="px-2 py-1.5 space-y-1 border-b border-[var(--ps-divider)]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--ps-text-dim)]">Opacity</span>
          <span className="text-[10px] tabular-nums w-8 text-right">
            {Math.round((active?.opacity ?? 1) * 100)}%
          </span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          disabled={!active || activeLocked}
          value={[Math.round((active?.opacity ?? 1) * 100)]}
          onValueChange={(v) =>
            active && !activeLocked && dispatch({ type: "set-layer-opacity", id: active.id, opacity: v[0] / 100 })
          }
          onValueCommit={() => active && !activeLocked && commitLayerChange("Layer Opacity", [active.id])}
        />
      </div>
      <div className="px-2 py-1.5 space-y-1 border-b border-[var(--ps-divider)]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--ps-text-dim)]">Fill</span>
          <span className="text-[10px] tabular-nums w-8 text-right">
            {Math.round((active?.fillOpacity ?? 1) * 100)}%
          </span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          disabled={!active || activeLocked}
          value={[Math.round((active?.fillOpacity ?? 1) * 100)]}
          onValueChange={(v) =>
            active && !activeLocked && dispatch({ type: "set-layer-fill-opacity", id: active.id, fillOpacity: v[0] / 100 })
          }
          onValueCommit={() => active && !activeLocked && commitLayerChange("Layer Fill Opacity", [active.id])}
        />
      </div>
      <div className="px-2 py-1.5 flex items-center gap-1.5 border-b border-[var(--ps-divider)]">
        <Select value={filterKind} onValueChange={(v) => setFilterKind(v as FilterKind)}>
          <SelectTrigger aria-label="Layer filter" className="h-6 w-[112px] text-[10px]">
            <Filter className="w-3 h-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[11px]">All</SelectItem>
            {/* Kind */}
            <SelectItem value="raster" className="text-[11px]">Kind: Pixel</SelectItem>
            <SelectItem value="text" className="text-[11px]">Kind: Type</SelectItem>
            <SelectItem value="shape" className="text-[11px]">Kind: Shape</SelectItem>
            <SelectItem value="adjustment" className="text-[11px]">Kind: Adjustment</SelectItem>
            <SelectItem value="smart-object" className="text-[11px]">Kind: Smart Object</SelectItem>
            <SelectItem value="frame" className="text-[11px]">Kind: Frame</SelectItem>
            <SelectItem value="artboard" className="text-[11px]">Kind: Artboard</SelectItem>
            <SelectItem value="group" className="text-[11px]">Kind: Group</SelectItem>
            <SelectItem value="video" className="text-[11px]">Kind: Video</SelectItem>
            <SelectItem value="threeD" className="text-[11px]">Kind: 3D</SelectItem>
            {/* Attribute */}
            <SelectItem value="visible" className="text-[11px]">Attr: Visible</SelectItem>
            <SelectItem value="hidden" className="text-[11px]">Attr: Hidden</SelectItem>
            <SelectItem value="locked" className="text-[11px]">Attr: Locked</SelectItem>
            <SelectItem value="linked" className="text-[11px]">Attr: Linked</SelectItem>
            <SelectItem value="clipped" className="text-[11px]">Attr: Clipped</SelectItem>
            <SelectItem value="masked" className="text-[11px]">Attr: Masked</SelectItem>
            <SelectItem value="styled" className="text-[11px]">Attr: Has Effects</SelectItem>
            <SelectItem value="smart" className="text-[11px]">Attr: Smart Source</SelectItem>
            <SelectItem value="attr:smart-filter" className="text-[11px]">Attr: Smart Filter</SelectItem>
            <SelectItem value="attr:knockout" className="text-[11px]">Attr: Knockout</SelectItem>
            <SelectItem value="attr:blend-if" className="text-[11px]">Attr: Blend If</SelectItem>
            {/* Mode */}
            <SelectItem value="mode:normal" className="text-[11px]">Mode: Normal</SelectItem>
            <SelectItem value="mode:multiply" className="text-[11px]">Mode: Multiply</SelectItem>
            <SelectItem value="mode:screen" className="text-[11px]">Mode: Screen</SelectItem>
            <SelectItem value="mode:overlay" className="text-[11px]">Mode: Overlay</SelectItem>
            <SelectItem value="mode:soft-light" className="text-[11px]">Mode: Soft Light</SelectItem>
            <SelectItem value="mode:hard-light" className="text-[11px]">Mode: Hard Light</SelectItem>
            <SelectItem value="mode:darken" className="text-[11px]">Mode: Darken</SelectItem>
            <SelectItem value="mode:lighten" className="text-[11px]">Mode: Lighten</SelectItem>
            {/* Effect */}
            <SelectItem value="effect:drop-shadow" className="text-[11px]">FX: Drop Shadow</SelectItem>
            <SelectItem value="effect:inner-shadow" className="text-[11px]">FX: Inner Shadow</SelectItem>
            <SelectItem value="effect:outer-glow" className="text-[11px]">FX: Outer Glow</SelectItem>
            <SelectItem value="effect:inner-glow" className="text-[11px]">FX: Inner Glow</SelectItem>
            <SelectItem value="effect:bevel" className="text-[11px]">FX: Bevel & Emboss</SelectItem>
            <SelectItem value="effect:satin" className="text-[11px]">FX: Satin</SelectItem>
            <SelectItem value="effect:stroke" className="text-[11px]">FX: Stroke</SelectItem>
            <SelectItem value="effect:color-overlay" className="text-[11px]">FX: Color Overlay</SelectItem>
            <SelectItem value="effect:gradient-overlay" className="text-[11px]">FX: Gradient Overlay</SelectItem>
            <SelectItem value="effect:pattern-overlay" className="text-[11px]">FX: Pattern Overlay</SelectItem>
            {/* Color label */}
            <SelectItem value="label:red" className="text-[11px]">Label: Red</SelectItem>
            <SelectItem value="label:orange" className="text-[11px]">Label: Orange</SelectItem>
            <SelectItem value="label:yellow" className="text-[11px]">Label: Yellow</SelectItem>
            <SelectItem value="label:green" className="text-[11px]">Label: Green</SelectItem>
            <SelectItem value="label:blue" className="text-[11px]">Label: Blue</SelectItem>
            <SelectItem value="label:violet" className="text-[11px]">Label: Violet</SelectItem>
            <SelectItem value="label:gray" className="text-[11px]">Label: Gray</SelectItem>
            <SelectItem value="label:none" className="text-[11px]">Label: None</SelectItem>
            {/* Channels */}
            <SelectItem value="channel:r-off" className="text-[11px]">Channel: R Off</SelectItem>
            <SelectItem value="channel:g-off" className="text-[11px]">Channel: G Off</SelectItem>
            <SelectItem value="channel:b-off" className="text-[11px]">Channel: B Off</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1 flex items-center bg-[var(--ps-panel-2)] rounded-sm px-1 h-6">
          <Search className="w-3 h-3 text-[var(--ps-text-dim)]" />
          <input
            ref={searchRef}
            aria-label="Layer search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="bg-transparent flex-1 text-[11px] outline-none px-1"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear layer search"
              onClick={() => {
                setSearch("")
                searchRef.current?.focus()
              }}
              className="flex h-4 w-4 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      {/* One-click filter presets */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--ps-divider)] px-2 py-1.5">
        {LAYER_FILTER_PRESETS.map((preset) => {
          const activePreset = filterKind === preset.kind
          return (
            <button
              key={preset.kind}
              type="button"
              onClick={() => setFilterKind(activePreset ? "all" : preset.kind)}
              aria-pressed={activePreset}
              className={cn(
                "h-5 rounded-sm border px-1.5 text-[10px] leading-none",
                activePreset
                  ? "border-[var(--ps-accent)] bg-[var(--ps-accent)]/20 text-[var(--ps-text)]"
                  : "border-[var(--ps-divider)] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]",
              )}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      {/* Layer health summary */}
      <div
        data-testid="layer-health-summary"
        className="border-b border-[var(--ps-divider)] px-2 py-1.5 text-[10px]"
      >
        {healthWarnings.length ? (
          <>
            <div className="mb-1 flex items-center gap-1 text-[var(--ps-text-dim)]">
              <AlertTriangle className="h-3 w-3 text-amber-300" />
              {healthWarnings.length} layer health {healthWarnings.length === 1 ? "warning" : "warnings"}
            </div>
            <ul className="grid gap-0.5">
              {healthWarnings.slice(0, 4).map((warning, index) => (
                <li
                  key={warning.id}
                  data-testid={`layer-health-warning-${index}`}
                  className={cn(
                    "flex items-start gap-1 leading-snug",
                    warning.severity === "warn" ? "text-amber-200" : "text-[var(--ps-text-dim)]",
                  )}
                >
                  <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span className="min-w-0 flex-1 truncate">{warning.message}</span>
                </li>
              ))}
              {healthWarnings.length > 4 ? (
                <li className="text-[var(--ps-text-dim)]">+{healthWarnings.length - 4} more…</li>
              ) : null}
            </ul>
          </>
        ) : (
          <div className="flex items-center gap-1 text-emerald-300/80">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Layers look healthy
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] px-2 py-1 text-[10px] text-[var(--ps-text-dim)]">
        <span className="min-w-0 flex-1 truncate">
          {visibleLayers.length} of {collapseFiltered.length} visible in list
          {filtersActive ? ` / ${selectedVisibleCount} selected` : ""}
        </span>
        {filtersActive ? (
          <button
            type="button"
            aria-label="Clear layer filters"
            onClick={() => {
              setSearch("")
              setFilterKind("all")
            }}
            className="h-6 rounded-sm px-1.5 hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            Clear
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Select matched layers"
          disabled={!visibleLayers.length}
          onClick={selectVisibleResults}
          className="flex h-6 items-center gap-1 rounded-sm px-1.5 hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)] disabled:opacity-40"
        >
          <ListChecks className="h-3.5 w-3.5" />
          Select
        </button>
      </div>

      <div className="px-2 py-1.5 flex items-center gap-1 border-b border-[var(--ps-divider)] text-[10px] text-[var(--ps-text-dim)]">
        Lock:
        <button
          className={cn("hover:text-[var(--ps-text)] p-0.5 rounded-sm", active?.lockTransparency && "bg-[var(--ps-tool-active)] text-[var(--ps-text)]")}
          aria-label="Lock transparent pixels"
          title="Lock transparent pixels"
          onClick={() => active && toggleLayerLock(active.id, "transparency")}
        >
          <span className="w-3 h-3 inline-block text-[8px] leading-3 text-center">▦</span>
        </button>
        <button
          className={cn("hover:text-[var(--ps-text)] p-0.5 rounded-sm", active?.lockDraw && "bg-[var(--ps-tool-active)] text-[var(--ps-text)]")}
          aria-label="Lock image pixels"
          title="Lock image pixels"
          onClick={() => active && toggleLayerLock(active.id, "draw")}
        >
          <span className="w-3 h-3 inline-block text-[8px] leading-3 text-center">🖌</span>
        </button>
        <button
          className={cn("hover:text-[var(--ps-text)] p-0.5 rounded-sm", active?.lockMove && "bg-[var(--ps-tool-active)] text-[var(--ps-text)]")}
          aria-label="Lock position"
          title="Lock position"
          onClick={() => active && toggleLayerLock(active.id, "move")}
        >
          <span className="w-3 h-3 inline-block text-[8px] leading-3 text-center">✥</span>
        </button>
        <button
          className={cn("hover:text-[var(--ps-text)] p-0.5 rounded-sm", active?.lockAll && "bg-[var(--ps-tool-active)] text-[var(--ps-text)]")}
          aria-label="Lock all"
          title="Lock all"
          onClick={() => active && toggleLayerLock(active.id, "all")}
        >
          <Lock className="w-3 h-3" />
        </button>
        <span className="ml-auto" suppressHydrationWarning>
          {activeDoc?.selectedLayerIds.length ?? 0} of {activeDoc?.layers.length ?? 0} selected
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2" onDragLeave={() => setHoverId(null)}>
        {visibleLayers.map((l) => {
          const isActive = l.id === activeDoc.activeLayerId
          const isSelected = activeDoc.selectedLayerIds.includes(l.id)
          const isGroup = l.kind === "group"
          const isInGroup = !!l.parentId
          const isLocked = layerLocked(l)
          const isMoveLocked = layerMoveLocked(l)
          const canAltClip = canClipToLayerBelow(l)
          const isAltClipTarget = altDown && canAltClip && altClipLayerId === l.id
          const colorBg =
            l.colorLabel && l.colorLabel !== "none"
              ? COLOR_LABELS.find((c) => c.id === l.colorLabel)?.bg
              : undefined
          const maskState = adjustmentMaskState(l)
          const rowIndent = isInGroup ? 18 : 6
          return (
            <React.Fragment key={l.id}>
            <div
              data-testid={`layer-row-${l.name}`}
              data-layer-kind={l.kind || "raster"}
              data-adjustment-clipped={l.kind === "adjustment" ? String(!!l.clipped) : undefined}
              data-adjustment-mask={maskState}
              data-alt-clip-target={isAltClipTarget ? "true" : undefined}
              draggable={!isMoveLocked && !altDown}
              onDragStart={(e) => {
                const ids = activeDoc.selectedLayerIds.includes(l.id) ? activeDoc.selectedLayerIds : [l.id]
                const draggedLayers = ids
                  .map((id) => activeDoc.layers.find((layer) => layer.id === id))
                  .filter(Boolean) as Layer[]
                if (isMoveLocked || draggedLayers.some(layerMoveLocked)) {
                  e.preventDefault()
                  return
                }
                setDragId(l.id)
                e.dataTransfer.setData("application/x-ps-source-doc", activeDoc.id)
                e.dataTransfer.setData("application/x-ps-layer-ids", JSON.stringify(ids))
                e.dataTransfer.setData("text/plain", ids.map((id) => activeDoc.layers.find((layer) => layer.id === id)?.name ?? id).join(", "))
                e.dataTransfer.effectAllowed = "copyMove"
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === l.id) return
                if (isMoveLocked) return
                e.preventDefault()
                const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                const ratio = (e.clientY - r.top) / r.height
                let pos: "above" | "below" | "into" = "above"
                if (isGroup && ratio > 0.25 && ratio < 0.75) pos = "into"
                else if (ratio > 0.5) pos = "below"
                setHoverId(l.id)
                setHoverPos(pos)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dragId !== l.id) {
                  let ids: string[] = []
                  try {
                    const parsed = JSON.parse(e.dataTransfer.getData("application/x-ps-layer-ids") || "[]")
                    if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === "string")
                  } catch {
                    ids = []
                  }
                  const movedIds = ids.length ? ids : [dragId]
                  const movedLayers = movedIds
                    .map((id) => activeDoc.layers.find((layer) => layer.id === id))
                    .filter(Boolean) as Layer[]
                  if (!isMoveLocked && !movedLayers.some(layerMoveLocked)) {
                    if (movedIds.length > 1) {
                      dispatch({
                        type: "reorder-layers",
                        ids: movedIds,
                        targetId: l.id,
                        position: hoverPos,
                      })
                    } else {
                      dispatch({
                        type: "reorder-layer",
                        id: dragId,
                        targetId: l.id,
                        position: hoverPos,
                      })
                    }
                    setTimeout(() => commit(movedIds.length > 1 ? "Reorder Layers" : "Reorder Layer", []), 0)
                  }
                }
                setDragId(null)
                setHoverId(null)
              }}
              onDragEnd={() => {
                setDragId(null)
                setHoverId(null)
              }}
              onClick={(e) => onLayerClick(e, l)}
              onDoubleClick={() => openAdjustmentSettings(l)}
              onMouseEnter={() => {
                if (canAltClip) setAltClipLayerId(l.id)
              }}
              onMouseMove={() => {
                if (canAltClip) setAltClipLayerId(l.id)
                else if (altClipLayerId === l.id) setAltClipLayerId(null)
              }}
              onMouseLeave={() => {
                if (altClipLayerId === l.id) setAltClipLayerId(null)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                dispatch({ type: "set-active-layer", id: l.id })
                setContextMenu({ layerId: l.id, x: e.clientX, y: e.clientY })
              }}
              className={cn(
                "flex items-center gap-1.5 px-1.5 py-1 border-b border-[var(--ps-divider)]/60 cursor-pointer relative scroll-mt-12 scroll-mb-12",
                altDown && canAltClip && "cursor-alias",
                isActive
                  ? "bg-[var(--ps-tool-active)]"
                  : isSelected
                    ? "bg-[var(--ps-tool-hover)]"
                    : "hover:bg-[var(--ps-tool-hover)]/60",
              )}
              style={{ paddingLeft: rowIndent }}
            >
              {/* Drop indicator */}
              {hoverId === l.id ? (
                hoverPos === "into" ? (
                  <span className="absolute inset-0 ring-2 ring-[var(--ps-accent)] pointer-events-none" />
                ) : (
                  <span
                    className={cn(
                      "absolute left-0 right-0 h-0.5 bg-[var(--ps-accent)] pointer-events-none",
                      hoverPos === "above" ? "top-0" : "bottom-0",
                    )}
                  />
                )
              ) : null}

              {isActive ? (
                <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--ps-accent)]" />
              ) : null}

              {isAltClipTarget ? (
                <button
                  type="button"
                  data-testid={`alt-clip-link-${l.name}`}
                  aria-label={`${l.clipped ? "Release" : "Clip"} ${l.name} to layer below`}
                  title={l.clipped ? "Release clipping mask" : "Clip to layer below"}
                  className="absolute -bottom-2 left-8 right-2 z-30 flex h-4 items-center justify-center gap-1 rounded-sm border border-[var(--ps-accent)] bg-[var(--ps-panel)] text-[9px] text-[var(--ps-text)] shadow-lg cursor-alias"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleClipToLayerBelow(l)
                  }}
                >
                  <Link2 className="h-3 w-3 text-[var(--ps-accent)]" />
                  {l.clipped ? "Release" : "Clip"}
                </button>
              ) : null}

              {/* Color label */}
              {colorBg ? (
                <span
                  className="absolute left-0 top-0 bottom-0 w-1"
                  style={{ background: colorBg }}
                  aria-hidden
                />
              ) : null}

              {isGroup ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch({ type: "toggle-group-expanded", id: l.id })
                  }}
                  className="text-[var(--ps-text-dim)] hover:text-[var(--ps-text)] -ml-0.5"
                  aria-label={l.expanded ? "Collapse group" : "Expand group"}
                >
                  <ChevronRight
                    className={cn(
                      "w-3 h-3 transition-transform",
                      l.expanded ? "rotate-90" : "",
                    )}
                  />
                </button>
              ) : null}

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (isLocked) return
                  dispatch({ type: "toggle-layer-visibility", id: l.id })
                  commitLayerChange("Layer Visibility", [l.id])
                }}
                disabled={isLocked}
                className={cn("text-[var(--ps-text)]", isLocked && "cursor-not-allowed opacity-40")}
                aria-label="Toggle visibility"
              >
                {l.visible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 opacity-40" />
                )}
              </button>

              {isGroup ? (
                l.expanded ? (
                  <FolderOpen className="w-4 h-4 text-[var(--ps-accent-2)] shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-[var(--ps-accent-2)] shrink-0" />
                )
              ) : l.kind === "adjustment" ? (
                <>
                  {l.clipped ? (
                    <CornerDownRight
                      className="h-3 w-3 shrink-0 text-[var(--ps-accent-2)]"
                      data-testid={`adjustment-clip-icon-${l.name}`}
                      aria-label="Adjustment clipped to layer below"
                    />
                  ) : (
                    <span className="h-3 w-3 shrink-0" aria-hidden />
                  )}
                  <AdjustmentThumb layer={l} />
                  <AdjustmentMaskThumb layer={l} maskState={maskState ?? "none"} />
                </>
              ) : (
                <LayerThumb layer={l} />
              )}

              {l.kind === "adjustment" ? null : <KindIcon kind={l.kind || "raster"} />}

              {l.clipped && l.kind !== "adjustment" ? (
                <CircleSlash2
                  className="w-2.5 h-2.5 text-[var(--ps-text-dim)] shrink-0"
                  aria-label="Clipped"
                />
              ) : null}

              <input
                aria-label={`Layer name: ${l.name}`}
                value={l.name}
                disabled={isLocked}
                onChange={(e) => {
                  if (isLocked) return
                  dispatch({ type: "rename-layer", id: l.id, name: e.target.value })
                }}
                onBlur={() => {
                  if (!isLocked) commitLayerChange("Rename Layer", [l.id])
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="bg-transparent flex-1 text-[11px] outline-none focus:bg-[var(--ps-panel-2)] px-1 rounded-sm min-w-0 disabled:cursor-not-allowed disabled:opacity-70"
              />

              {/* Color label picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="w-3 h-3 rounded-full border border-[var(--ps-divider)] shrink-0"
                    style={{ background: colorBg ?? "transparent" }}
                    title="Color label"
                    aria-label="Color label"
                  />
                </PopoverTrigger>
                <PopoverContent className="p-2 w-auto" align="end">
                  <div className="flex gap-1">
                    {COLOR_LABELS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setLayerColorLabel(l.id, c.id)}
                        title={c.label}
                        className={cn(
                          "w-5 h-5 rounded-full border",
                          c.id === "none" ? "border-dashed" : "border-[var(--ps-divider)]",
                        )}
                        style={{ background: c.id === "none" ? "transparent" : c.bg }}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {l.linkGroupId ? (
                <Link2
                  className="w-3 h-3 text-[var(--ps-accent-2)]"
                  aria-label={`Linked group`}
                />
              ) : null}
              {l.smartObject ? (
                <span
                  className="w-3 h-3 rounded-sm bg-[var(--ps-accent)] text-[8px] text-white flex items-center justify-center font-bold"
                  title="Smart Object"
                >
                  S<span className="sr-only">mart Object</span>
                </span>
              ) : null}
              {l.smartFilters?.length ? (
                <span
                  data-testid={`smart-filter-count-${l.name}`}
                  className="h-3 rounded-sm bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] px-1 text-[7px] text-[var(--ps-text-dim)] flex items-center justify-center font-bold"
                  title={`${l.smartFilters.length} smart filter${l.smartFilters.length === 1 ? "" : "s"}`}
                >
                  {l.smartFilters.length}
                </span>
              ) : null}
              {l.style ? (
                <span
                  className="w-3 h-3 rounded-sm bg-[var(--ps-accent-2)] text-[7px] text-white flex items-center justify-center font-bold"
                  title="Layer Style"
                >
                  fx
                </span>
              ) : null}
              {l.locked ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleLayerLock(l.id, "legacy")
                  }}
                  className="text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
                  aria-label="Unlock"
                >
                  <Lock className="w-3 h-3" />
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleLayerLock(l.id, "legacy")
                  }}
                  className="text-[var(--ps-text-dim)] hover:text-[var(--ps-text)] opacity-0 hover:opacity-100"
                  aria-label="Lock"
                >
                  <Unlock className="w-3 h-3" />
                </button>
              )}
            </div>
            {renderSmartFilterSubItems(l, rowIndent)}
            </React.Fragment>
          )
        })}
      </div>

      {contextMenu ? (
        <div
          className="fixed z-50 w-52 border border-[var(--ps-divider)] bg-[var(--ps-panel)] py-1 text-[11px] shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(() => {
            const layer = activeDoc.layers.find((candidate) => candidate.id === contextMenu.layerId)
            if (!layer) return null
            return (
              <>
                <button
                  className="flex w-full items-center px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
                  onClick={() => addLayerNote(layer)}
                >
                  Add Layer Note
                </button>
                <button
                  className="flex w-full items-center px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
                  onClick={() => editLayerTags(layer)}
                >
                  Edit Tags/Metadata
                </button>
                {(layer.shape || layer.path || layer.vectorMask) ? (
                  <>
                    <button
                      className="flex w-full items-center px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
                      onClick={() => copyVectorLayerCss(layer)}
                    >
                      Copy CSS
                    </button>
                    <button
                      className="flex w-full items-center px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
                      onClick={() => copyVectorLayerSvg(layer)}
                    >
                      Copy SVG
                    </button>
                  </>
                ) : null}
                <div className="my-1 border-t border-[var(--ps-divider)]" />
              </>
            )
          })()}
          <div className="px-2 py-1 text-[10px] text-[var(--ps-text-dim)]">Layer Color</div>
          {COLOR_LABELS.map((label) => (
            <button
              key={label.id}
              className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
              onClick={() => setLayerColorLabel(contextMenu.layerId, label.id)}
            >
              <span
                className={cn(
                  "h-3 w-3 rounded-full border border-[var(--ps-divider)]",
                  label.id === "none" && "border-dashed",
                )}
                style={{ background: label.id === "none" ? "transparent" : label.bg }}
              />
              <span>{label.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {smartFilterContextMenu ? (
        <div
          className="fixed z-50 w-48 border border-[var(--ps-divider)] bg-[var(--ps-panel)] py-1 text-[11px] shadow-xl"
          style={{ left: smartFilterContextMenu.x, top: smartFilterContextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(() => {
            const layer = activeDoc.layers.find((candidate) => candidate.id === smartFilterContextMenu.layerId)
            const filter = layer?.smartFilters?.find((candidate) => candidate.id === smartFilterContextMenu.filterId)
            if (!layer || !filter) return null
            return (
              <>
                <button
                  role="menuitem"
                  className="flex w-full items-center px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
                  onClick={() => editSmartFilterMask(layer, filter.id)}
                >
                  Edit Smart Filter Mask
                </button>
                <button
                  role="menuitem"
                  className="flex w-full items-center px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]"
                  onClick={() => updateSmartFilter(layer, filter.id, { enabled: filter.enabled === false }, "Toggle Smart Filter")}
                >
                  {filter.enabled === false ? "Enable Smart Filter" : "Disable Smart Filter"}
                </button>
              </>
            )
          })()}
        </div>
      ) : null}

      <div className="border-t border-[var(--ps-divider)] flex items-center px-1 py-1 gap-0.5 text-[var(--ps-text)]">
        <PanelBtn
          label={linkedSelected ? "Unlink layers" : "Link layers"}
          disabled={selectedLayers.length < 2 && !linkedSelected}
          onClick={() => {
            if (selectedLayers.length < 2 && !linkedSelected) return
            dispatch({ type: linkedSelected ? "unlink-selected" : "link-selected" })
          }}
        >
          {linkedSelected ? <Link2Off className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
        </PanelBtn>
        <PanelBtn
          label={active?.mask ? "Remove layer mask" : "Add layer mask"}
          disabled={!active || activeLocked}
          onClick={() => {
            if (!active || activeLocked) return
            if (active.mask) {
              dispatch({ type: "set-layer-mask", id: active.id, mask: null })
              commitLayerChange("Remove Layer Mask", [active.id])
            } else {
              addLayerMask()
              commitLayerChange("Add Layer Mask", [active.id])
            }
          }}
        >
          <span
            className={cn(
              "inline-block w-3.5 h-3.5 rounded-full border-2",
              active?.mask ? "bg-[var(--ps-accent)] border-[var(--ps-accent)]" : "border-current",
            )}
          />
        </PanelBtn>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Adjustment layer"
              aria-label="Adjustment layer"
              className="w-7 h-7 rounded-sm flex items-center justify-center hover:bg-[var(--ps-tool-hover)]"
            >
              <span className="inline-block w-3.5 h-3.5 rounded-full bg-gradient-to-br from-white to-black" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("brightness-contrast")}
            >
              Brightness/Contrast
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("levels")}
            >
              Levels
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("curves")}
            >
              Curves
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("hue-saturation")}
            >
              Hue/Saturation
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("color-balance")}
            >
              Color Balance
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("vibrance")}
            >
              Vibrance
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("exposure")}
            >
              Exposure
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("photo-filter")}
            >
              Photo Filter
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("channel-mixer")}
            >
              Channel Mixer
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("black-white")}
            >
              Black & White...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("color-lookup")}
            >
              Color Lookup…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("invert")}
            >
              Invert
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("posterize")}
            >
              Posterize…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("threshold")}
            >
              Threshold…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("gradient-map")}
            >
              Gradient Map…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("selective-color")}
            >
              Selective Color…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("shadows-highlights")}
            >
              Shadows/Highlights…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("hdr-toning")}
            >
              HDR Toning…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("desaturate")}
            >
              Desaturate
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("match-color")}
            >
              Match Color
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("replace-color")}
            >
              Replace Color…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => createAdjustmentLayer("equalize")}
            >
              Equalize
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Batch layer operations"
              aria-label="Batch layer operations"
              className="w-7 h-7 rounded-sm flex items-center justify-center hover:bg-[var(--ps-tool-hover)]"
            >
              <ListChecks className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={batchRenameSelected}>
              <Tag className="mr-2 h-3.5 w-3.5" /> Rename Selected...
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette className="mr-2 h-3.5 w-3.5" /> Color Label Selected
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {COLOR_LABELS.map((colorLabel) => (
                  <DropdownMenuItem key={colorLabel.id} onSelect={() => batchColorLabelSelected(colorLabel.id)}>
                    <span
                      className="mr-2 inline-block h-3 w-3 rounded-full border border-[var(--ps-divider)]"
                      style={{ background: colorLabel.id === "none" ? "transparent" : colorLabel.bg }}
                    />
                    {colorLabel.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={batchConvertSelectedToSmartObject}>
              <Sparkles className="mr-2 h-3.5 w-3.5" /> Convert Selected to Smart Object
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={batchExportSelectedLayers}>
              <Download className="mr-2 h-3.5 w-3.5" /> Export Selected Layers
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PanelBtn
          label="New group"
          onClick={() => newGroup()}
          disabled={!selectedLayers.length || selectedHasLocked}
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </PanelBtn>
        <PanelBtn label="New layer" onClick={() => newLayer()}>
          <Plus className="w-3.5 h-3.5" />
        </PanelBtn>
        <PanelBtn
          label="Duplicate layer"
          onClick={() => active && dispatch({ type: "duplicate-layer", id: active.id })}
          disabled={!active}
        >
          <Copy className="w-3.5 h-3.5" />
        </PanelBtn>
        <PanelBtn
          label="Move up"
          disabled={!canMoveActive}
          onClick={() => {
            if (!active || !canMoveActive) return
            dispatch({ type: "move-layer", id: active.id, direction: "up" })
            setTimeout(() => commit("Move Layer", [active.id]), 0)
          }}
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </PanelBtn>
        <PanelBtn
          label="Move down"
          disabled={!canMoveActive}
          onClick={() => {
            if (!active || !canMoveActive) return
            dispatch({ type: "move-layer", id: active.id, direction: "down" })
            setTimeout(() => commit("Move Layer", [active.id]), 0)
          }}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </PanelBtn>
        <PanelBtn
          label={selectedLayers.length > 1 ? "Merge selected" : "Delete layer"}
          disabled={selectedLayers.length > 1 ? !canMergeSelected : !canDeleteActive}
          onClick={() => {
            if (!active) return
            if (selectedLayers.length > 1) {
              if (!canMergeSelected) return
              dispatch({ type: "merge-selected" })
              setTimeout(() => commit("Merge Layers", "all"), 0)
            } else {
              if (!canDeleteActive) return
              dispatch({ type: "remove-layer", id: active.id })
              setTimeout(() => commit("Delete Layer", []), 0)
            }
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </PanelBtn>
      </div>
    </div>
  )
}

function PanelBtn({
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

function KindIcon({ kind }: { kind: LayerKind }) {
  const cls = "w-2.5 h-2.5 text-[var(--ps-text-dim)] shrink-0"
  if (kind === "text") return <TypeIcon className={cls} aria-label="Text" />
  if (kind === "shape") return <SquareIcon className={cls} aria-label="Shape" />
  if (kind === "adjustment") return <Palette className={cls} aria-label="Adjustment" />
  if (kind === "frame") return <ImageIcon className={cls} aria-label="Frame" />
  if (kind === "artboard") return <SquareIcon className={cls} aria-label="Artboard" />
  if (kind === "raster") return <PenTool className={cls} aria-label="Pixel" />
  return null
}

function AdjustmentThumb({ layer }: { layer: Layer }) {
  const label = layer.adjustment ? FILTERS[layer.adjustment.type]?.name ?? layer.adjustment.type : "Adjustment"
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

function AdjustmentMaskThumb({ layer, maskState }: { layer: Layer; maskState: string }) {
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

function SmartFilterMaskThumb({
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
  const state = smartFilterMaskState(mask, enabled)
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

function LayerThumb({ layer }: { layer: Layer }) {
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
