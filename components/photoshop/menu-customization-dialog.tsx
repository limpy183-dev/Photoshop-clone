"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DEFAULT_MENU_CUSTOMIZATION,
  addMenuPreset,
  loadMenuCustomization,
  loadMenuPresets,
  moveMenuItem,
  removeMenuPreset,
  resetMenuCustomization,
  saveMenuCustomization,
  saveMenuPresets,
  setMenuItemVisible,
  type MenuCustomization,
  type MenuPreset,
} from "./menu-customization"

// The canonical set of top-level menus and their child item ids. This is the
// list the dialog exposes for hide/show + reorder. Items added in the future
// can be appended to this list; the dialog and storage tolerate unknown ids
// gracefully via menu-customization helpers.
const MENU_CATALOG: ReadonlyArray<{ id: string; label: string; items: ReadonlyArray<{ id: string; label: string }> }> = [
  {
    id: "File",
    label: "File",
    items: [
      { id: "File/New", label: "New..." },
      { id: "File/Open", label: "Open..." },
      { id: "File/Open Recent", label: "Open Recent" },
      { id: "File/Save", label: "Save" },
      { id: "File/Save As PNG", label: "Save As PNG..." },
      { id: "File/Save Project", label: "Save Project..." },
      { id: "File/Save As PSD", label: "Save As PSD..." },
      { id: "File/Export As", label: "Export As..." },
      { id: "File/Place Embedded", label: "Place Embedded..." },
      { id: "File/Import PDF", label: "Import PDF..." },
      { id: "File/Contact Sheet", label: "Contact Sheet II..." },
      { id: "File/Automate", label: "Automate" },
      { id: "File/Scripts", label: "Scripts" },
      { id: "File/File Info", label: "File Info..." },
      { id: "File/Print", label: "Print..." },
      { id: "File/Close", label: "Close" },
    ],
  },
  {
    id: "Edit",
    label: "Edit",
    items: [
      { id: "Edit/Undo", label: "Undo" },
      { id: "Edit/Redo", label: "Redo" },
      { id: "Edit/Cut", label: "Cut" },
      { id: "Edit/Copy", label: "Copy" },
      { id: "Edit/Paste", label: "Paste" },
      { id: "Edit/Fill", label: "Fill..." },
      { id: "Edit/Stroke", label: "Stroke..." },
      { id: "Edit/Content-Aware Fill", label: "Content-Aware Fill..." },
      { id: "Edit/Free Transform", label: "Free Transform" },
      { id: "Edit/Define Brush", label: "Define Brush Preset..." },
      { id: "Edit/Define Pattern", label: "Define Pattern..." },
      { id: "Edit/Keyboard Shortcuts", label: "Keyboard Shortcuts..." },
      { id: "Edit/Menus", label: "Menus..." },
      { id: "Edit/Preferences", label: "Preferences" },
    ],
  },
  {
    id: "Image",
    label: "Image",
    items: [
      { id: "Image/Mode", label: "Mode" },
      { id: "Image/Adjustments", label: "Adjustments" },
      { id: "Image/Auto Tone", label: "Auto Tone" },
      { id: "Image/Auto Contrast", label: "Auto Contrast" },
      { id: "Image/Auto Color", label: "Auto Color" },
      { id: "Image/Image Size", label: "Image Size..." },
      { id: "Image/Canvas Size", label: "Canvas Size..." },
      { id: "Image/Image Rotation", label: "Image Rotation" },
      { id: "Image/Crop", label: "Crop" },
      { id: "Image/Trim", label: "Trim..." },
      { id: "Image/Reveal All", label: "Reveal All" },
      { id: "Image/Duplicate", label: "Duplicate..." },
      { id: "Image/Apply Image", label: "Apply Image..." },
      { id: "Image/Calculations", label: "Calculations..." },
      { id: "Image/Variables", label: "Variables" },
      { id: "Image/Analysis", label: "Analysis" },
    ],
  },
  {
    id: "Layer",
    label: "Layer",
    items: [
      { id: "Layer/New", label: "New" },
      { id: "Layer/Duplicate", label: "Duplicate Layer..." },
      { id: "Layer/Delete", label: "Delete" },
      { id: "Layer/Rename", label: "Rename Layer..." },
      { id: "Layer/Layer Style", label: "Layer Style" },
      { id: "Layer/Smart Filter", label: "Smart Filter" },
      { id: "Layer/New Fill", label: "New Fill Layer" },
      { id: "Layer/New Adjustment", label: "New Adjustment Layer" },
      { id: "Layer/Layer Mask", label: "Layer Mask" },
      { id: "Layer/Vector Mask", label: "Vector Mask" },
      { id: "Layer/Create Clipping Mask", label: "Create Clipping Mask" },
      { id: "Layer/Smart Objects", label: "Smart Objects" },
      { id: "Layer/Video Layers", label: "Video Layers" },
      { id: "Layer/Rasterize", label: "Rasterize" },
      { id: "Layer/Group", label: "Group Layers" },
      { id: "Layer/Arrange", label: "Arrange" },
      { id: "Layer/Align", label: "Align" },
      { id: "Layer/Distribute", label: "Distribute" },
      { id: "Layer/Merge", label: "Merge" },
      { id: "Layer/Flatten", label: "Flatten Image" },
    ],
  },
  {
    id: "Type",
    label: "Type",
    items: [
      { id: "Type/Add Fonts", label: "Add Fonts..." },
      { id: "Type/Panels", label: "Panels" },
      { id: "Type/Anti-Alias", label: "Anti-Alias" },
      { id: "Type/Orientation", label: "Orientation" },
      { id: "Type/OpenType", label: "OpenType" },
      { id: "Type/Convert to Shape", label: "Convert to Shape" },
      { id: "Type/Rasterize", label: "Rasterize Type Layer" },
      { id: "Type/Warp Text", label: "Warp Text..." },
      { id: "Type/Find Replace", label: "Find and Replace Text..." },
      { id: "Type/Check Spelling", label: "Check Spelling..." },
    ],
  },
  {
    id: "Select",
    label: "Select",
    items: [
      { id: "Select/All", label: "All" },
      { id: "Select/Deselect", label: "Deselect" },
      { id: "Select/Reselect", label: "Reselect" },
      { id: "Select/Inverse", label: "Inverse" },
      { id: "Select/All Layers", label: "All Layers" },
      { id: "Select/Find Layers", label: "Find Layers" },
      { id: "Select/Color Range", label: "Color Range..." },
      { id: "Select/Focus Area", label: "Focus Area..." },
      { id: "Select/Select Subject", label: "Subject" },
      { id: "Select/Select and Mask", label: "Select and Mask..." },
      { id: "Select/Modify", label: "Modify" },
      { id: "Select/Grow", label: "Grow" },
      { id: "Select/Similar", label: "Similar" },
      { id: "Select/Transform Selection", label: "Transform Selection" },
      { id: "Select/Save Selection", label: "Save Selection..." },
      { id: "Select/Load Selection", label: "Load Selection..." },
    ],
  },
  {
    id: "Filter",
    label: "Filter",
    items: [
      { id: "Filter/Last", label: "Last Filter" },
      { id: "Filter/Convert for Smart Filters", label: "Convert for Smart Filters" },
      { id: "Filter/Filter Gallery", label: "Filter Gallery..." },
      { id: "Filter/Adaptive Wide Angle", label: "Adaptive Wide Angle..." },
      { id: "Filter/Camera Raw", label: "Camera Raw Filter..." },
      { id: "Filter/Lens Correction", label: "Lens Correction..." },
      { id: "Filter/Liquify", label: "Liquify..." },
      { id: "Filter/Vanishing Point", label: "Vanishing Point..." },
      { id: "Filter/3D", label: "3D" },
      { id: "Filter/Blur", label: "Blur" },
      { id: "Filter/Blur Gallery", label: "Blur Gallery" },
      { id: "Filter/Distort", label: "Distort" },
      { id: "Filter/Noise", label: "Noise" },
      { id: "Filter/Pixelate", label: "Pixelate" },
      { id: "Filter/Render", label: "Render" },
      { id: "Filter/Sharpen", label: "Sharpen" },
      { id: "Filter/Stylize", label: "Stylize" },
      { id: "Filter/Other", label: "Other" },
    ],
  },
  {
    id: "View",
    label: "View",
    items: [
      { id: "View/Proof Setup", label: "Proof Setup" },
      { id: "View/Proof Colors", label: "Proof Colors" },
      { id: "View/Gamut Warning", label: "Gamut Warning" },
      { id: "View/Zoom In", label: "Zoom In" },
      { id: "View/Zoom Out", label: "Zoom Out" },
      { id: "View/Fit on Screen", label: "Fit on Screen" },
      { id: "View/100%", label: "100%" },
      { id: "View/Print Size", label: "Print Size" },
      { id: "View/Screen Mode", label: "Screen Mode" },
      { id: "View/Extras", label: "Extras" },
      { id: "View/Show", label: "Show" },
      { id: "View/Rulers", label: "Rulers" },
      { id: "View/Snap", label: "Snap" },
      { id: "View/Snap To", label: "Snap To" },
      { id: "View/Lock Guides", label: "Lock Guides" },
      { id: "View/Clear Guides", label: "Clear Guides" },
      { id: "View/New Guide", label: "New Guide..." },
    ],
  },
  {
    id: "Window",
    label: "Window",
    items: [
      { id: "Window/Arrange", label: "Arrange" },
      { id: "Window/Workspace", label: "Workspace" },
      { id: "Window/Find Extensions", label: "Find Extensions on Exchange..." },
      { id: "Window/Extensions", label: "Extensions" },
      { id: "Window/Tools", label: "Tools" },
      { id: "Window/Options", label: "Options" },
      { id: "Window/Actions", label: "Actions" },
      { id: "Window/Adjustments", label: "Adjustments" },
      { id: "Window/Brushes", label: "Brushes" },
      { id: "Window/Channels", label: "Channels" },
      { id: "Window/Character", label: "Character" },
      { id: "Window/Color", label: "Color" },
      { id: "Window/Histogram", label: "Histogram" },
      { id: "Window/History", label: "History" },
      { id: "Window/Info", label: "Info" },
      { id: "Window/Layer Comps", label: "Layer Comps" },
      { id: "Window/Layers", label: "Layers" },
      { id: "Window/Navigator", label: "Navigator" },
      { id: "Window/Notes", label: "Notes" },
      { id: "Window/Paragraph", label: "Paragraph" },
      { id: "Window/Paths", label: "Paths" },
      { id: "Window/Properties", label: "Properties" },
      { id: "Window/Styles", label: "Styles" },
      { id: "Window/Swatches", label: "Swatches" },
      { id: "Window/Timeline", label: "Timeline" },
      { id: "Window/Tool Presets", label: "Tool Presets" },
    ],
  },
  {
    id: "Help",
    label: "Help",
    items: [
      { id: "Help/Photoshop Help", label: "Photoshop Help..." },
      { id: "Help/About", label: "About Photoshop Web..." },
      { id: "Help/System Info", label: "System Info..." },
      { id: "Help/Keyboard Shortcuts", label: "Keyboard Shortcuts..." },
      { id: "Help/Welcome", label: "Welcome..." },
    ],
  },
]

export function MenuCustomizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [customization, setCustomization] = React.useState<MenuCustomization>(DEFAULT_MENU_CUSTOMIZATION)
  const [presets, setPresets] = React.useState<MenuPreset[]>([])
  const [activeMenu, setActiveMenu] = React.useState<string>(MENU_CATALOG[0].id)
  const [draggedItemId, setDraggedItemId] = React.useState<string | null>(null)
  const [presetName, setPresetName] = React.useState("Custom Menus")

  React.useEffect(() => {
    if (open) {
      setCustomization(loadMenuCustomization())
      setPresets(loadMenuPresets())
    }
  }, [open])

  const catalogMenu = MENU_CATALOG.find((m) => m.id === activeMenu) ?? MENU_CATALOG[0]
  const defaultItemIds = catalogMenu.items.map((it) => it.id)
  const orderForMenu = customization.ordered[catalogMenu.id] ?? defaultItemIds
  const orderedDisplay = [
    ...orderForMenu.filter((id) => defaultItemIds.includes(id)),
    ...defaultItemIds.filter((id) => !orderForMenu.includes(id)),
  ]

  const toggleVisible = (id: string) => {
    setCustomization((prev) => setMenuItemVisible(prev, id, prev.hidden.includes(id)))
  }

  const move = (id: string, direction: -1 | 1) => {
    setCustomization((prev) => moveMenuItem(prev, catalogMenu.id, id, direction, defaultItemIds))
  }

  const onDragStart = (e: React.DragEvent, id: string) => {
    setDraggedItemId(id)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", id)
  }

  const onDragOver = (e: React.DragEvent, targetId: string) => {
    if (!draggedItemId || draggedItemId === targetId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  const onDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggedItemId || draggedItemId === targetId) {
      setDraggedItemId(null)
      return
    }
    const currentOrder = orderedDisplay
    const fromIdx = currentOrder.indexOf(draggedItemId)
    const toIdx = currentOrder.indexOf(targetId)
    if (fromIdx < 0 || toIdx < 0) { setDraggedItemId(null); return }
    const direction = toIdx > fromIdx ? 1 : -1
    let updated = customization
    const steps = Math.abs(toIdx - fromIdx)
    for (let i = 0; i < steps; i++) {
      updated = moveMenuItem(updated, catalogMenu.id, draggedItemId, direction as -1 | 1, defaultItemIds)
    }
    setCustomization(updated)
    setDraggedItemId(null)
  }

  const apply = () => {
    saveMenuCustomization(customization)
    toast.success("Menu customization saved")
    onOpenChange(false)
  }

  const reset = () => {
    const next = resetMenuCustomization()
    setCustomization(next)
    saveMenuCustomization(next)
    toast.success("Menu customization reset")
  }

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) {
      toast.error("Preset name is required")
      return
    }
    const next = addMenuPreset(presets, name, customization)
    setPresets(next)
    saveMenuPresets(next)
    toast.success(`Saved preset "${name}"`)
  }

  const applyPreset = (preset: MenuPreset) => {
    setCustomization(preset.customization)
    toast.success(`Applied "${preset.name}"`)
  }

  const deletePreset = (preset: MenuPreset) => {
    const next = removeMenuPreset(presets, preset.id)
    setPresets(next)
    saveMenuPresets(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)]">
        <DialogHeader>
          <DialogTitle className="text-sm">Menus</DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            Hide, show, or reorder menu items. Changes apply to the menu bar after you click OK.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[160px_1fr] gap-3 py-2">
          <div className="space-y-1 border-r border-[var(--ps-divider)] pr-2">
            {MENU_CATALOG.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setActiveMenu(m.id)}
                className={`block w-full text-left px-2 py-1 rounded text-[11px] ${
                  activeMenu === m.id
                    ? "bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border border-[var(--ps-accent)]/30"
                    : "hover:bg-[var(--ps-panel-2)] border border-transparent"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="space-y-2 min-h-[320px] max-h-[420px] overflow-auto">
            {orderedDisplay.map((id) => {
              const itemDef = catalogMenu.items.find((it) => it.id === id)
              const hidden = customization.hidden.includes(id)
              const isDragging = draggedItemId === id
              return (
                <div
                  key={id}
                  draggable
                  onDragStart={(e) => onDragStart(e, id)}
                  onDragOver={(e) => onDragOver(e, id)}
                  onDrop={(e) => onDrop(e, id)}
                  onDragEnd={() => setDraggedItemId(null)}
                  className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] transition-colors ${
                    isDragging
                      ? "border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 opacity-50"
                      : hidden
                        ? "border-[var(--ps-divider)] bg-[var(--ps-panel-2)] opacity-60"
                        : "border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
                  }`}
                >
                  <span className="cursor-grab active:cursor-grabbing text-[var(--ps-text-dim)] select-none pr-1" title="Drag to reorder">⋮⋮</span>
                  <label className="flex items-center gap-2 flex-1 cursor-pointer" onDragStart={(e) => e.preventDefault()}>
                    <Checkbox
                      checked={!hidden}
                      onCheckedChange={() => toggleVisible(id)}
                    />
                    <span className={hidden ? "line-through" : ""}>{itemDef?.label ?? id}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => move(id, -1)}
                      className="h-6 w-6 p-0 text-[11px]"
                      aria-label={`Move ${itemDef?.label ?? id} up`}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => move(id, 1)}
                      className="h-6 w-6 p-0 text-[11px]"
                      aria-label={`Move ${itemDef?.label ?? id} down`}
                    >
                      ↓
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="border-t border-[var(--ps-divider)] pt-2 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              className="h-7 text-[11px] flex-1"
            />
            <Button size="sm" variant="outline" onClick={savePreset} className="h-7 text-[11px]">
              Save Preset
            </Button>
          </div>
          {presets.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center gap-1 rounded border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-0.5 text-[10px]"
                >
                  <button
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="hover:text-[var(--ps-accent)]"
                  >
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(preset)}
                    className="text-[var(--ps-text-dim)] hover:text-red-400"
                    aria-label={`Delete ${preset.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={reset} className="text-[11px]">
            Reset All
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-[11px]">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={apply}
            className="text-[11px] bg-[var(--ps-accent)] hover:bg-[var(--ps-accent)]/90"
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
