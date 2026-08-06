"use client"

import * as React from "react"
import { Eye, EyeOff, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { CLIENT_STORAGE_KEYS, readClientStorageString, writeClientStorageString } from "@/editor/client-storage"
import { dispatchPhotoshopEvent } from "@/editor/events"
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_INTERFACE_PREFERENCES,
  INTERFACE_THEMES,
  UI_ELEMENTS,
  UI_ELEMENT_BY_ID,
  type InterfacePreferences,
  type InterfaceThemeId,
  type UiElementId,
} from "@/editor/ui-layout"

const DOCK_ELEMENT = UI_ELEMENT_BY_ID.panelDock

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-[11px] text-[var(--ps-text-dim)]">{children}</Label>
}

/**
 * The dock is the one element whose size already has a home: the drag handle
 * writes it and workspace layouts restore it. This row drives that value
 * instead of storing a second copy in preferences.
 */
function DockWidthRow() {
  const [width, setWidth] = React.useState(DOCK_ELEMENT.defaultSize)

  React.useEffect(() => {
    const saved = Number(readClientStorageString(CLIENT_STORAGE_KEYS.dockWidth))
    if (Number.isFinite(saved) && saved >= DOCK_ELEMENT.minSize && saved <= DOCK_ELEMENT.maxSize) setWidth(saved)
  }, [])

  const commit = (next: number) => {
    setWidth(next)
    writeClientStorageString(CLIENT_STORAGE_KEYS.dockWidth, String(next))
    dispatchPhotoshopEvent("ps-set-dock-width", next)
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <FieldLabel>Width</FieldLabel>
        <span className="text-[11px] tabular-nums text-[var(--ps-text)]">{width} px</span>
      </div>
      <Slider
        value={[width]}
        min={DOCK_ELEMENT.minSize}
        max={DOCK_ELEMENT.maxSize}
        step={2}
        onValueChange={([value]) => commit(Math.round(value))}
        aria-label="Panel dock width"
      />
      <p className="text-[10px] text-[var(--ps-text-dim)]">
        Applies immediately and is shared with the dock&apos;s drag handle, so it saves outside this page.
      </p>
    </div>
  )
}

export function InterfaceSettings({
  prefs,
  onChange,
}: {
  prefs: InterfacePreferences
  onChange: (next: InterfacePreferences) => void
}) {
  const [selectedId, setSelectedId] = React.useState<UiElementId>("menuBar")
  const selected = UI_ELEMENT_BY_ID[selectedId]
  const selectedPref = prefs.elements[selectedId]

  const updateElement = (id: UiElementId, patch: Partial<InterfacePreferences["elements"][UiElementId]>) => {
    onChange({
      ...prefs,
      elements: { ...prefs.elements, [id]: { ...prefs.elements[id], ...patch } },
    })
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-[12px] font-semibold text-[var(--ps-text)]">Appearance</h3>
        <div className="grid gap-1.5">
          <FieldLabel>Colour Theme</FieldLabel>
          <div className="grid grid-cols-3 gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1">
            {INTERFACE_THEMES.map((theme) => {
              const active = prefs.theme === theme.id
              return (
                <button
                  key={theme.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ ...prefs, theme: theme.id as InterfaceThemeId })}
                  className={`rounded-sm px-2 py-1.5 text-[11px] transition-colors ${active ? "bg-[var(--ps-accent)] text-white" : "text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"}`}
                >
                  {theme.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <FieldLabel>Accent Colour</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                type="color"
                value={prefs.accentColor}
                onChange={(event) => onChange({ ...prefs, accentColor: event.target.value })}
                className="h-8 w-20 p-1"
                aria-label="Accent colour"
              />
              <Button
                type="button"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={() => onChange({ ...prefs, accentColor: DEFAULT_ACCENT_COLOR })}
              >
                Default
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <FieldLabel>Canvas Surround</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                type="color"
                value={prefs.canvasBackground || "#535353"}
                onChange={(event) => onChange({ ...prefs, canvasBackground: event.target.value })}
                className="h-8 w-20 p-1"
                aria-label="Canvas surround colour"
              />
              <Button
                type="button"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={() => onChange({ ...prefs, canvasBackground: "" })}
              >
                Use theme
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[12px] font-semibold text-[var(--ps-text)]">Editor Layout</h3>
        <p className="text-[11px] text-[var(--ps-text-dim)]">
          Pick an interface element to hide it or change its size. Screen modes (F) still override these while active.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[190px_1fr]">
          <div
            role="listbox"
            aria-label="Interface elements"
            className="space-y-0.5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1"
          >
            {UI_ELEMENTS.map((element) => {
              const active = element.id === selectedId
              const visible = prefs.elements[element.id].visible
              return (
                <div
                  key={element.id}
                  className={`flex items-center gap-1 rounded-sm ${active ? "bg-[var(--ps-accent)]" : "hover:bg-[var(--ps-tool-hover)]"}`}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelectedId(element.id)}
                    className={`flex-1 truncate px-2 py-1.5 text-left text-[11px] ${active ? "text-white" : "text-[var(--ps-text)]"}`}
                  >
                    {element.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateElement(element.id, { visible: !visible })}
                    aria-label={`${visible ? "Hide" : "Show"} ${element.label}`}
                    aria-pressed={!visible}
                    className={`mr-1 grid h-6 w-6 place-items-center rounded-sm ${active ? "text-white" : "text-[var(--ps-text-dim)]"} hover:bg-black/20`}
                  >
                    {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )
            })}
          </div>

          <div className="space-y-3 rounded-sm border border-[var(--ps-divider)] p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-[12px] font-semibold text-[var(--ps-text)]">{selected.label}</h4>
                <p className="text-[11px] text-[var(--ps-text-dim)]">{selected.description}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => updateElement(selectedId, DEFAULT_INTERFACE_PREFERENCES.elements[selectedId])}
              >
                <RotateCcw className="mr-1 h-3 w-3" /> Reset
              </Button>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-[var(--ps-text)]">
              <Checkbox
                checked={selectedPref.visible}
                onCheckedChange={(value) => updateElement(selectedId, { visible: value === true })}
                className="border-[var(--ps-divider)]"
              />
              Show in editor
            </label>

            {selectedId === "panelDock" ? (
              <DockWidthRow />
            ) : selected.sizeVar ? (
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <FieldLabel>{selected.axis === "height" ? "Height" : "Width"}</FieldLabel>
                  <span className="text-[11px] tabular-nums text-[var(--ps-text)]">{selectedPref.size} px</span>
                </div>
                <Slider
                  value={[selectedPref.size]}
                  min={selected.minSize}
                  max={selected.maxSize}
                  step={1}
                  disabled={!selectedPref.visible}
                  onValueChange={([value]) => updateElement(selectedId, { size: Math.round(value) })}
                  aria-label={`${selected.label} ${selected.axis}`}
                />
              </div>
            ) : (
              <p className="text-[11px] text-[var(--ps-text-dim)]">This element has a fixed size.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
