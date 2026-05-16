"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { FILTERS } from "./filters"
import { useEditor } from "./editor-context"
import { selectionToMaskCanvas } from "./tool-helpers"
import type { ToolId } from "./types"
import { toast } from "sonner"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenNew: () => void
}

interface CommandItem {
  id: string
  group: string
  title: string
  hint?: string
  disabled?: boolean
  disabledReason?: string
  run: () => void
}

const TOOL_COMMANDS: { tool: ToolId; title: string; hint: string }[] = [
  { tool: "move", title: "Move Tool", hint: "V" },
  { tool: "brush", title: "Brush Tool", hint: "B" },
  { tool: "mixer-brush", title: "Mixer Brush Tool", hint: "B" },
  { tool: "pattern-stamp", title: "Pattern Stamp Tool", hint: "S" },
  { tool: "art-history-brush", title: "Art History Brush Tool", hint: "Y" },
  { tool: "eraser", title: "Eraser Tool", hint: "E" },
  { tool: "gradient", title: "Gradient Tool", hint: "G" },
  { tool: "type", title: "Type Tool", hint: "T" },
  { tool: "marquee-rect", title: "Rectangular Marquee Tool", hint: "M" },
  { tool: "marquee-row", title: "Single Row Marquee Tool", hint: "M" },
  { tool: "marquee-col", title: "Single Column Marquee Tool", hint: "M" },
  { tool: "lasso", title: "Lasso Tool", hint: "L" },
  { tool: "object-select", title: "Object Selection Tool", hint: "W" },
  { tool: "quick-selection", title: "Quick Selection Tool", hint: "W" },
  { tool: "magic-wand", title: "Magic Wand Tool", hint: "W" },
  { tool: "crop", title: "Crop Tool", hint: "C" },
  { tool: "slice", title: "Slice Tool", hint: "C" },
  { tool: "slice-select", title: "Slice Select Tool", hint: "C" },
  { tool: "frame", title: "Frame Tool", hint: "K" },
  { tool: "eyedropper", title: "Eyedropper Tool", hint: "I" },
  { tool: "clone-stamp", title: "Clone Stamp Tool", hint: "S" },
  { tool: "content-aware-move", title: "Content-Aware Move Tool", hint: "J" },
  { tool: "red-eye", title: "Red Eye Tool", hint: "J" },
  { tool: "color-sampler", title: "Color Sampler Tool", hint: "I" },
  { tool: "pen", title: "Pen Tool", hint: "P" },
  { tool: "freeform-pen", title: "Freeform Pen Tool", hint: "P" },
  { tool: "add-anchor-point", title: "Add Anchor Point Tool", hint: "P" },
  { tool: "delete-anchor-point", title: "Delete Anchor Point Tool", hint: "P" },
  { tool: "convert-point", title: "Convert Point Tool", hint: "P" },
  { tool: "type-vertical", title: "Vertical Type Tool", hint: "T" },
  { tool: "type-mask-horizontal", title: "Horizontal Type Mask Tool", hint: "T" },
  { tool: "type-mask-vertical", title: "Vertical Type Mask Tool", hint: "T" },
  { tool: "shape-rect", title: "Rectangle Tool", hint: "U" },
  { tool: "shape-rounded-rect", title: "Rounded Rectangle Tool", hint: "U" },
  { tool: "shape-ellipse", title: "Ellipse Tool", hint: "U" },
  { tool: "shape-polygon", title: "Polygon Tool", hint: "U" },
  { tool: "shape-triangle", title: "Triangle Tool", hint: "U" },
  { tool: "shape-line", title: "Line Tool", hint: "U" },
  { tool: "custom-shape", title: "Custom Shape Tool", hint: "U" },
  { tool: "hand", title: "Hand Tool", hint: "H" },
  { tool: "rotate-view", title: "Rotate View Tool", hint: "R" },
  { tool: "zoom", title: "Zoom Tool", hint: "Z" },
]

const PANEL_COMMANDS = [
  ["layers", "Layers Panel"],
  ["properties", "Properties Panel"],
  ["selection-studio", "Selection Studio Panel"],
  ["guides", "Guides Panel"],
  ["adjustments", "Adjustments Panel"],
  ["assets", "Asset Library Panel"],
  ["timeline", "Timeline Panel"],
  ["annotations", "Annotations Panel"],
  ["slices", "Slice Manager Panel"],
  ["scripting", "Scripting Console"],
  ["navigator", "Navigator Panel"],
  ["histogram", "Histogram Panel"],
  ["history", "History Panel"],
  ["actions", "Actions Panel"],
  ["layer-comps", "Layer Comps Panel"],
  ["tool-presets", "Tool Presets Panel"],
  ["clone-source", "Clone Source Panel"],
  ["glyphs", "Glyphs Panel"],
  ["animation", "Animation Panel"],
  ["libraries", "Libraries Panel"],
  ["learn", "Learn Panel"],
  ["comments", "Comments Panel"],
  ["discover", "Discover Panel"],
  ["measurement-log", "Measurement Log Panel"],
  ["notes", "Notes Panel"],
  ["shapes", "Shapes Panel"],
  ["styles", "Styles Panel"],
] as const

export function CommandPalette({ open, onOpenChange, onOpenNew }: CommandPaletteProps) {
  const { activeDoc, activeLayer, closedDocuments, dispatch, newLayer, newGroup, duplicateDocument, closeOtherDocuments, reopenClosedDocument } = useEditor()
  const [query, setQuery] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(0)

  React.useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
    }
  }, [open])

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange])

  const commands = React.useMemo<CommandItem[]>(() => {
    const needsDocument = activeDoc ? undefined : "Open or create a document first"
    const needsLayer = activeLayer ? undefined : "Select a layer first"
    const needsSelection = activeDoc?.selection.bounds ? undefined : "Create a selection first"
    const needsClosedDocument = closedDocuments.length ? undefined : "No closed documents"
    const needsOtherDocument = activeDoc ? undefined : "Open a document first"
    const items: CommandItem[] = [
      {
        id: "file-new",
        group: "File",
        title: "New Document",
        hint: "Ctrl/Cmd+N",
        run: () => {
          onOpenNew()
          close()
        },
      },
      {
        id: "layer-new",
        group: "Layer",
        title: "New Layer",
        hint: "Ctrl/Cmd+Shift+N",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          newLayer()
          close()
        },
      },
      {
        id: "layer-group",
        group: "Layer",
        title: "Group Selected Layers",
        hint: "Ctrl/Cmd+G",
        disabled: !!needsDocument || (activeDoc?.selectedLayerIds.length ?? 0) === 0,
        disabledReason: needsDocument ?? "Select one or more layers first",
        run: () => {
          newGroup()
          close()
        },
      },
      {
        id: "layer-find",
        group: "Layer",
        title: "Find Layers",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "layers" }))
          window.setTimeout(() => window.dispatchEvent(new CustomEvent("ps-focus-layer-search")), 0)
          close()
        },
      },
      {
        id: "filter-gallery",
        group: "Filter",
        title: activeLayer?.smartObject || activeLayer?.kind === "smart-object" ? "Edit Smart Filters" : "Filter Gallery",
        disabled: !!needsLayer,
        disabledReason: needsLayer,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-filter-gallery"))
          close()
        },
      },
      {
        id: "camera-raw-filter",
        group: "Filter",
        title: "Camera Raw Filter",
        disabled: !!needsLayer,
        disabledReason: needsLayer,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-camera-raw"))
          close()
        },
      },
      {
        id: "file-batch-export",
        group: "File",
        title: "Batch Export",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-batch-export"))
          close()
        },
      },
      {
        id: "file-batch-processing",
        group: "File",
        title: "Batch Processing",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-batch-processing"))
          close()
        },
      },
      {
        id: "file-image-processor",
        group: "File",
        title: "Image Processor",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-image-processor"))
          close()
        },
      },
      {
        id: "automate-photomerge",
        group: "File",
        title: "Photomerge",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-gap-workflow", { detail: "photomerge" }))
          close()
        },
      },
      {
        id: "file-export-as",
        group: "File",
        title: "Export As",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-export-as"))
          close()
        },
      },
      {
        id: "file-batch-export-slices",
        group: "File",
        title: "Batch Export Slices",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-batch-export", { detail: { scope: "slices" } }))
          close()
        },
      },
      {
        id: "file-export-layers",
        group: "File",
        title: "Export Layers to Files",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-batch-export", { detail: { scope: "visible-layers" } }))
          close()
        },
      },
      {
        id: "file-export-sprite-sheet",
        group: "File",
        title: "Sprite Sheet Export",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-batch-export", { detail: { scope: "sprite-layers" } }))
          close()
        },
      },
      {
        id: "file-round-trip",
        group: "File",
        title: "Round-Trip Inspector",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-document-report"))
          close()
        },
      },
      {
        id: "file-preflight",
        group: "File",
        title: "Preflight Check",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-preflight"))
          close()
        },
      },
      {
        id: "file-recent-documents",
        group: "File",
        title: "Recent Documents",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-recent-documents"))
          close()
        },
      },
      {
        id: "file-duplicate-document",
        group: "File",
        title: "Duplicate Document",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          duplicateDocument()
          close()
        },
      },
      {
        id: "file-close-others",
        group: "File",
        title: "Close Other Documents",
        disabled: !!needsOtherDocument,
        disabledReason: needsOtherDocument,
        run: () => {
          if (activeDoc) closeOtherDocuments(activeDoc.id)
          close()
        },
      },
      {
        id: "file-reopen-closed-document",
        group: "File",
        title: closedDocuments[0] ? `Reopen Closed Document: ${closedDocuments[0].name}` : "Reopen Closed Document",
        disabled: !!needsClosedDocument,
        disabledReason: needsClosedDocument,
        run: () => {
          reopenClosedDocument()
          close()
        },
      },
      {
        id: "file-info",
        group: "File",
        title: "File Info",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-file-info"))
          close()
        },
      },
      {
        id: "advanced-3d-workspace",
        group: "3D",
        title: "3D Workspace",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-3d-workspace"))
          close()
        },
      },
      {
        id: "advanced-video-timeline",
        group: "Video",
        title: "Video Timeline and Render",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-video-render"))
          close()
        },
      },
      {
        id: "advanced-print-workflow",
        group: "File",
        title: "Print Setup and Proof",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-print-workflow"))
          close()
        },
      },
      {
        id: "advanced-device-preview",
        group: "View",
        title: "Device Preview",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-device-preview"))
          close()
        },
      },
      {
        id: "advanced-automation-workflow",
        group: "File",
        title: "Droplets, Script Events, and Conditional Actions",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-automation-workflow"))
          close()
        },
      },
      {
        id: "advanced-content-credentials",
        group: "File",
        title: "Content Credentials",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-provenance"))
          close()
        },
      },
      {
        id: "algorithmic-operations",
        group: "Edit",
        title: "Algorithmic Operations",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-algorithmic-operations"))
          close()
        },
      },
      {
        id: "algorithmic-path-boolean",
        group: "Paths",
        title: "Path Boolean, Offset, Simplify, and Outline",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-algorithmic-operations"))
          close()
        },
      },
      {
        id: "algorithmic-content-aware",
        group: "Composite",
        title: "Auto-Align, Auto-Blend, Content-Aware Scale",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-algorithmic-operations"))
          close()
        },
      },
      {
        id: "algorithmic-color-pixel",
        group: "Image",
        title: "Shift Channels, Apply Image, Calculations, and Gradient Map",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-algorithmic-operations"))
          close()
        },
      },
      {
        id: "algorithmic-pattern-generation",
        group: "View",
        title: "Scripted Patterns and Procedural Textures",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-algorithmic-operations"))
          close()
        },
      },
      {
        id: "advanced-plugin-manager",
        group: "Plugins",
        title: "Plugin Manager",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-plugin-manager"))
          close()
        },
      },
      {
        id: "advanced-cloud-libraries",
        group: "Plugins",
        title: "Creative Cloud Libraries, Stock, and Fonts",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-cloud-libraries"))
          close()
        },
      },
      {
        id: "advanced-color-management",
        group: "Image",
        title: "Assign Profile, Convert Profile, and Color Modes",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-color-management-workflow"))
          close()
        },
      },
      {
        id: "advanced-format-metadata",
        group: "File",
        title: "RAW, DNG, DICOM, EXR, HDR, PSB, and Metadata",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-format-metadata"))
          close()
        },
      },
      {
        id: "advanced-variable-data",
        group: "File",
        title: "Variable Data Sets",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-variables"))
          close()
        },
      },
      {
        id: "window-layer-comps",
        group: "Window",
        title: "Layer Comps",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-layer-comps"))
          close()
        },
      },
      {
        id: "window-workspace-manager",
        group: "Window",
        title: "Workspace Manager",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-workspace-manager"))
          close()
        },
      },
      {
        id: "edit-preferences",
        group: "Edit",
        title: "Preferences",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-preferences"))
          close()
        },
      },
      {
        id: "edit-shortcuts",
        group: "Edit",
        title: "Keyboard Shortcuts",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-shortcuts"))
          close()
        },
      },
      {
        id: "select-all",
        group: "Select",
        title: "Select All",
        hint: "Ctrl/Cmd+A",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          if (activeDoc) {
            dispatch({
              type: "set-selection",
              selection: { bounds: { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height }, shape: "rect" },
            })
          }
          close()
        },
      },
      {
        id: "select-deselect",
        group: "Select",
        title: "Deselect",
        hint: "Ctrl/Cmd+D",
        disabled: !!needsSelection,
        disabledReason: needsSelection,
        run: () => {
          dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
          close()
        },
      },
      {
        id: "select-subject-command",
        group: "Select",
        title: "Select Subject",
        disabled: !!needsDocument,
        disabledReason: needsDocument,
        run: () => {
          dispatch({ type: "set-tool", tool: "select-subject" })
          close()
        },
      },
      {
        id: "select-and-mask-command",
        group: "Select",
        title: "Select and Mask",
        disabled: !!needsSelection,
        disabledReason: needsSelection,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-select-and-mask"))
          close()
        },
      },
      {
        id: "select-expand-command",
        group: "Select",
        title: "Expand Selection",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-selection-operation", { detail: "expand" }))
          close()
        },
      },
      {
        id: "select-contract-command",
        group: "Select",
        title: "Contract Selection",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-selection-operation", { detail: "contract" }))
          close()
        },
      },
      {
        id: "select-border-command",
        group: "Select",
        title: "Border Selection",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-selection-operation", { detail: "border" }))
          close()
        },
      },
      {
        id: "select-smooth-command",
        group: "Select",
        title: "Smooth Selection",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-selection-operation", { detail: "smooth" }))
          close()
        },
      },
      {
        id: "select-feather-command",
        group: "Select",
        title: "Feather Selection",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-selection-operation", { detail: "feather" }))
          close()
        },
      },
      {
        id: "select-save-alpha",
        group: "Select",
        title: "Save Selection as Alpha Channel",
        disabled: !!needsSelection,
        disabledReason: needsSelection,
        run: () => {
          if (activeDoc?.selection.bounds) {
            const mask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
            if (mask) {
              dispatch({
                type: "save-selection",
                channel: {
                  id: `ch_${Math.random().toString(36).slice(2, 9)}`,
                  name: `Alpha ${(activeDoc.channels?.length ?? 0) + 1}`,
                  canvas: mask,
                },
              })
            }
          }
          close()
        },
      },
      {
        id: "select-load-alpha",
        group: "Select",
        title: "Load Selection from Alpha Channel",
        disabled: !activeDoc?.channels?.length,
        disabledReason: activeDoc?.channels?.length ? undefined : "No saved alpha channels",
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "channels" }))
          close()
        },
      },
    ]

    for (const [id, title] of PANEL_COMMANDS) {
      items.push({
        id: `panel-${id}`,
        group: "Panels",
        title,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: id }))
          close()
        },
      })
    }

    for (const tool of TOOL_COMMANDS) {
      items.push({
        id: `tool-${tool.tool}`,
        group: "Tools",
        title: tool.title,
        hint: tool.hint,
        run: () => {
          dispatch({ type: "set-tool", tool: tool.tool })
          close()
        },
      })
    }

    for (const filter of Object.values(FILTERS).slice().sort((a, b) => a.name.localeCompare(b.name))) {
      items.push({
        id: `filter-${filter.id}`,
        group: "Filters",
        title: filter.name,
        hint: filter.category,
        disabled: !!needsLayer,
        disabledReason: needsLayer,
        run: () => {
          window.dispatchEvent(new CustomEvent("ps-open-filter", { detail: filter.id }))
          close()
        },
      })
    }

    return items
  }, [activeDoc, activeLayer, close, closedDocuments, dispatch, duplicateDocument, closeOtherDocuments, reopenClosedDocument, newGroup, newLayer, onOpenNew])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 60)
    return commands
      .filter((command) =>
        `${command.group} ${command.title} ${command.hint ?? ""}`.toLowerCase().includes(q),
      )
      .slice(0, 80)
  }, [commands, query])

  React.useEffect(() => {
    setActiveIndex(0)
  }, [query])

  React.useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  const runCommand = React.useCallback((command?: CommandItem) => {
    if (!command) return
    if (command.disabled) {
      toast.info(command.disabledReason ?? "Command unavailable")
      return
    }
    command.run()
  }, [])

  const moveActive = React.useCallback(
    (delta: number) => {
      if (!filtered.length) return
      let next = activeIndex
      for (let i = 0; i < filtered.length; i++) {
        next = (next + delta + filtered.length) % filtered.length
        if (!filtered[next]?.disabled) {
          setActiveIndex(next)
          return
        }
      }
      setActiveIndex(next)
    },
    [activeIndex, filtered],
  )

  const runActive = () => {
    runCommand(filtered[activeIndex] ?? filtered[0])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0 overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[var(--ps-text)]">
        <DialogHeader className="border-b border-[var(--ps-divider)] px-3 py-2">
          <DialogTitle className="text-sm">Command Palette</DialogTitle>
        </DialogHeader>
        <div className="p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                moveActive(1)
                return
              }
              if (e.key === "ArrowUp") {
                e.preventDefault()
                moveActive(-1)
                return
              }
              if (e.key === "Escape") {
                e.preventDefault()
                onOpenChange(false)
                return
              }
              if (e.key === "Enter") {
                e.preventDefault()
                runActive()
              }
            }}
            placeholder="Search tools, filters, panels, and commands"
            className="h-9"
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto border-t border-[var(--ps-divider)] py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-[var(--ps-text-dim)]">No commands found.</div>
          ) : (
            filtered.map((command, index) => {
              const active = index === activeIndex
              return (
              <button
                key={command.id}
                type="button"
                disabled={command.disabled}
                aria-selected={active}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(command)}
                className={`grid w-full grid-cols-[86px_1fr_auto] items-center gap-2 px-3 py-2 text-left text-[12px] ${
                  command.disabled
                    ? "cursor-not-allowed text-[var(--ps-text-dim)] opacity-55"
                    : active
                      ? "bg-[var(--ps-tool-active)] text-[var(--ps-text)]"
                      : "hover:bg-[var(--ps-tool-hover)]"
                }`}
              >
                <span className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{command.group}</span>
                <span className="min-w-0">
                  <span className="block truncate">{command.title}</span>
                  {command.disabledReason ? (
                    <span className="block truncate text-[10px] text-[var(--ps-text-dim)]">{command.disabledReason}</span>
                  ) : null}
                </span>
                {command.hint ? <span className="text-[10px] text-[var(--ps-text-dim)]">{command.hint}</span> : null}
              </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
