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
} from "lucide-react"
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
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { AdjustmentType, BlendMode, Layer, LayerKind } from "../types"
import { createAdjustmentLayer as createAdjustmentLayerModel, isAdjustmentNoop } from "../adjustment-layers"
import { dispatchPhotoshopEvent } from "../events"
import type { MergedRenderChange } from "../render-bus"
import { createLayerMetadata, layerMatchesQuery } from "../layer-workflows"
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

type FilterKind = "all" | LayerKind | "locked" | "hidden" | "masked" | "styled" | "smart" | "clipped"

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
  } = useEditor()
  const [search, setSearch] = React.useState("")
  const [filterKind, setFilterKind] = React.useState<FilterKind>("all")
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [hoverId, setHoverId] = React.useState<string | null>(null)
  const [hoverPos, setHoverPos] = React.useState<"above" | "below" | "into">("above")
  const [altDown, setAltDown] = React.useState(false)
  const [altClipLayerId, setAltClipLayerId] = React.useState<string | null>(null)
  const [contextMenu, setContextMenu] = React.useState<{ layerId: string; x: number; y: number } | null>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", close)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", close)
    }
  }, [contextMenu])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const query = String((event as CustomEvent).detail?.query ?? "")
      if (query) setSearch(query)
      window.setTimeout(() => {
        searchRef.current?.focus()
        searchRef.current?.select()
      }, 0)
    }
    window.addEventListener("ps-focus-layer-search", handler)
    return () => window.removeEventListener("ps-focus-layer-search", handler)
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
    if (filterKind === "locked") return layerLocked(l) || !!l.lockDraw || !!l.lockMove || !!l.lockTransparency
    if (filterKind === "hidden") return !l.visible
    if (filterKind === "masked") return !!l.mask || !!l.vectorMask
    if (filterKind === "styled") return !!l.style
    if (filterKind === "smart") return !!l.smartObject || l.kind === "smart-object" || !!l.smartFilters?.length
    if (filterKind === "clipped") return !!l.clipped
    return l.kind === filterKind
  })

  const filtersActive = search.trim() || filterKind !== "all"
  const selectedVisibleCount = visibleLayers.filter((layer) => activeDoc.selectedLayerIds.includes(layer.id)).length

  const linkedSelected = selectedLayers.length >= 2 && selectedLayers.every((l) => l.linkGroupId)

  const setLayerColorLabel = (id: string, label: Layer["colorLabel"]) => {
    dispatch({ type: "set-layer-color-label", id, label })
    setContextMenu(null)
    setTimeout(() => commit("Layer Color Label", [id]), 0)
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

  return (
    <div className="flex flex-col h-full">
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
          <SelectTrigger className="h-6 w-full text-[11px]">
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
          <SelectTrigger aria-label="Layer filter" className="h-6 w-[78px] text-[10px]">
            <Filter className="w-3 h-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[11px]">All</SelectItem>
            <SelectItem value="raster" className="text-[11px]">Pixel</SelectItem>
            <SelectItem value="text" className="text-[11px]">Type</SelectItem>
            <SelectItem value="shape" className="text-[11px]">Shape</SelectItem>
            <SelectItem value="adjustment" className="text-[11px]">Adjustment</SelectItem>
            <SelectItem value="frame" className="text-[11px]">Frame</SelectItem>
            <SelectItem value="artboard" className="text-[11px]">Artboard</SelectItem>
            <SelectItem value="group" className="text-[11px]">Group</SelectItem>
            <SelectItem value="locked" className="text-[11px]">Locked</SelectItem>
            <SelectItem value="hidden" className="text-[11px]">Hidden</SelectItem>
            <SelectItem value="masked" className="text-[11px]">Masked</SelectItem>
            <SelectItem value="styled" className="text-[11px]">Effects</SelectItem>
            <SelectItem value="smart" className="text-[11px]">Smart</SelectItem>
            <SelectItem value="clipped" className="text-[11px]">Clipped</SelectItem>
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

      <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] px-2 py-1 text-[10px] text-[var(--ps-text-dim)]">
        <span className="min-w-0 flex-1 truncate">
          {visibleLayers.length} of {collapseFiltered.length} visible in list
          {filtersActive ? ` · ${selectedVisibleCount} selected` : ""}
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

      <div className="flex-1 overflow-y-auto" onDragLeave={() => setHoverId(null)}>
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
          return (
            <div
              key={l.id}
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
              style={{ paddingLeft: isInGroup ? 18 : 6 }}
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
                  S
                </span>
              ) : null}
              {l.smartFilters?.length ? (
                <span
                  className="h-3 rounded-sm bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] px-1 text-[7px] text-[var(--ps-text-dim)] flex items-center justify-center font-bold"
                  title={`${l.smartFilters.length} smart filter${l.smartFilters.length === 1 ? "" : "s"}`}
                >
                  SF {l.smartFilters.length}
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
