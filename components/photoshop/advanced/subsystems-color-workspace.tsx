"use client"

/**
 * Color tab — ICC profile assign/convert workflows and document colour mode changes.
 *
 * One tab of the Advanced Subsystems dialog. The dialog itself
 * (`subsystems-dialog.tsx`) only owns the tab list and the switch that picks
 * a workspace; each workspace holds its own state and talks to the editor
 * directly, so opening the dialog does not mount the other ten.
 */

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  CapabilityNotice,
  CheckField,
  ColorField,
  EmptyState,
  NumberField,
  Panel,
  SelectField,
} from "@/components/photoshop/advanced/subsystems-dialog-controls"
import { type ColorWorkflowMode } from "@/editor/advanced/subsystems-dialog.types"
import { useEditor } from "@/components/photoshop/editor/context"
import { convertCanvasToDocumentMode } from "@/editor/advanced/subsystems"
import {
  applyIccTransformToImageData,
  describeColorPipeline,
  planProfileAssignment,
  planProfileConversion,
  supportedIccProfileNames,
  validateProfileForDocument,
} from "@/editor/color/pipeline"
import {
  buildColorSeparationModel,
  summarizeSeparationPlates,
  type SeparationProcess,
} from "@/editor/color/channel-ops"
import type { ColorManagementSettings, DocumentModeSettings } from "@/editor/types"
export function ColorWorkspace({ initialWorkflow }: { initialWorkflow: ColorWorkflowMode }) {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [settings, setSettings] = React.useState<DocumentModeSettings>({ mode: "RGB" })
  const [allowDestructiveApply, setAllowDestructiveApply] = React.useState(false)
  const [workflow, setWorkflow] = React.useState<ColorWorkflowMode>(initialWorkflow)
  const [assignTarget, setAssignTarget] = React.useState<ColorManagementSettings["assignedProfile"]>("sRGB IEC61966-2.1")
  const [convertTarget, setConvertTarget] = React.useState<ColorManagementSettings["workingSpace"]>("sRGB IEC61966-2.1")
  React.useEffect(() => {
    if (activeDoc) setSettings(activeDoc.modeSettings ?? { mode: activeDoc.colorMode })
  }, [activeDoc])
  const color = activeDoc?.colorManagement ?? {
    assignedProfile: "sRGB IEC61966-2.1" as const,
    workingSpace: "sRGB IEC61966-2.1" as const,
    renderingIntent: "relative-colorimetric" as const,
    blackPointCompensation: true,
    proofProfile: "None" as const,
    proofColors: false,
    gamutWarning: false,
    proofChannels: [],
    proofPlateView: "composite" as const,
  }
  React.useEffect(() => {
    if (!activeDoc) return
    setWorkflow(initialWorkflow)
    setAssignTarget(color.assignedProfile)
    setConvertTarget(color.workingSpace)
  }, [activeDoc, color.assignedProfile, color.workingSpace, initialWorkflow])
  if (!activeDoc) return <EmptyState text="Open a document before changing color management." />
  const pipeline = describeColorPipeline({
    bitDepth: activeDoc.bitDepth === 32 ? 32 : activeDoc.bitDepth === 16 ? 16 : 8,
    colorMode: activeDoc.colorMode,
    profile: color.assignedProfile,
  })
  const updateColor = (patch: Partial<typeof color>, label?: string) => {
    dispatch({ type: "set-color-management", settings: { ...color, ...patch } })
    requestRender()
    if (label) window.setTimeout(() => commit(label, "all"), 0)
  }
  const bitDepth = activeDoc.bitDepth === 32 ? 32 : activeDoc.bitDepth === 16 ? 16 : 8
  const assignmentPlan = planProfileAssignment(color.assignedProfile, assignTarget)
  const assignmentValidation = validateProfileForDocument(assignTarget, activeDoc.colorMode, bitDepth)
  const conversionPlan = planProfileConversion(color.assignedProfile, convertTarget, color.renderingIntent)
  const conversionValidation = validateProfileForDocument(convertTarget, activeDoc.colorMode, bitDepth)
  const assignProfile = () => {
    updateColor({ assignedProfile: assignTarget }, `Assign Profile: ${assignTarget}`)
  }
  const proofChannels = color.proofChannels ?? []
  const proofChannelOptions: NonNullable<ColorManagementSettings["proofChannels"]> = activeDoc.colorMode === "CMYK"
    ? ["cyan", "magenta", "yellow", "black"]
    : activeDoc.colorMode === "Grayscale"
      ? ["gray"]
      : ["red", "green", "blue"]
  const toggleProofChannel = (channel: NonNullable<ColorManagementSettings["proofChannels"]>[number], checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...proofChannels, channel]))
      : proofChannels.filter((item) => item !== channel)
    updateColor({ proofChannels: next })
  }
  const plateStats = (() => {
    const layer = activeLayer?.canvas ? activeLayer : activeDoc.layers.find((item) => item.kind !== "group" && item.canvas)
    const ctx = layer?.canvas?.getContext?.("2d")
    if (!layer || !ctx) return []
    const image = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    const colorMode = String(activeDoc.colorMode)
    const mode: SeparationProcess = colorMode === "CMYK" || colorMode === "Lab" || colorMode === "Grayscale" || colorMode === "Multichannel"
      ? colorMode
      : "RGB"
    return summarizeSeparationPlates(buildColorSeparationModel(image, {
      mode,
      processProfile: color.proofProfile !== "None" ? color.proofProfile : color.workingSpace,
    })).slice(0, 5)
  })()
  const convertCanvasProfile = (canvas: HTMLCanvasElement, sourceProfile: typeof color.assignedProfile, targetProfile: typeof color.workingSpace) => {
    const ctx = canvas.getContext("2d")
    if (!ctx) return false
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const converted = applyIccTransformToImageData(image, {
      sourceProfile,
      targetProfile,
      renderingIntent: color.renderingIntent,
      blackPointCompensation: color.blackPointCompensation,
    })
    ctx.putImageData(converted, 0, 0)
    return true
  }
  const convertProfile = (scope: "active" | "all") => {
    if (color.assignedProfile === convertTarget) return
    const layers = scope === "active" && activeLayer ? [activeLayer] : activeDoc.layers.filter((layer) => layer.kind !== "group")
    const changedIds: string[] = []
    for (const layer of layers) {
      if (layer.kind === "group" || typeof layer.canvas?.getContext !== "function") continue
      if (convertCanvasProfile(layer.canvas, color.assignedProfile, convertTarget)) changedIds.push(layer.id)
    }
    dispatch({ type: "set-color-management", settings: { ...color, assignedProfile: convertTarget, workingSpace: convertTarget } })
    requestRender()
    window.setTimeout(() => commit(`Convert Profile: ${convertTarget}`, changedIds.length ? changedIds : "all"), 0)
  }
  const setMode = (mode: DocumentModeSettings["mode"], patch: Partial<DocumentModeSettings> = {}) => {
    const next = { ...settings, ...patch, mode }
    setSettings(next)
    dispatch({ type: "set-document-mode-settings", colorMode: mode, settings: next })
    requestRender()
    window.setTimeout(() => commit(`Mode: ${mode}`, []), 0)
  }
  const applyToActive = () => {
    if (!activeLayer) return
    const out = convertCanvasToDocumentMode(activeLayer.canvas, settings)
    activeLayer.canvas.getContext("2d")!.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    activeLayer.canvas.getContext("2d")!.drawImage(out, 0, 0)
    requestRender()
    window.setTimeout(() => commit(`Apply ${settings.mode} Conversion`, [activeLayer.id]), 0)
  }
  const applyToAll = () => {
    for (const layer of activeDoc.layers) {
      if (layer.kind === "group") continue
      const out = convertCanvasToDocumentMode(layer.canvas, settings)
      layer.canvas.getContext("2d")!.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
      layer.canvas.getContext("2d")!.drawImage(out, 0, 0)
    }
    requestRender()
    window.setTimeout(() => commit(`Apply ${settings.mode} Conversion`, "all"), 0)
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="ICC Profiles & Proofing">
        <CapabilityNotice>
          Profile assignment, conversion, proof preview, gamut warning, and raster export conversion use the browser-local ICC transform engine for supported profiles. High-bit documents keep typed-array sources where supported; canvas display remains an 8-bit RGBA preview.
        </CapabilityNotice>
        <div className="grid grid-cols-3 gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1">
          {(["assign", "convert", "proof"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={workflow === item}
              onClick={() => setWorkflow(item)}
              className={`h-7 rounded-sm text-[11px] capitalize ${workflow === item ? "bg-[var(--ps-accent)] text-white" : "hover:bg-[var(--ps-tool-hover)]"}`}
            >
              {item}
            </button>
          ))}
        </div>
        {workflow === "assign" ? (
          <div className="grid gap-2">
            <SelectField label="Assign Profile" value={assignTarget} options={supportedIccProfileNames()} onChange={(value) => setAssignTarget(value as typeof assignTarget)} />
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px] text-[var(--ps-text-dim)]">
              <div>Current {assignmentPlan.currentProfile}; new {assignmentPlan.newProfile}; expected shift {assignmentPlan.expectedShift}.</div>
              <div>{assignmentPlan.gamutMappingNote}</div>
              {[...assignmentPlan.warnings, ...assignmentValidation.warnings].map((warning) => (
                <div key={warning} className="text-amber-200">{warning}</div>
              ))}
            </div>
            <Button size="sm" variant="secondary" disabled={!assignmentValidation.valid} onClick={assignProfile}>Assign Profile</Button>
          </div>
        ) : null}
        {workflow === "convert" ? (
          <div className="grid gap-2">
            <SelectField label="Convert To Profile" value={convertTarget} options={supportedIccProfileNames()} onChange={(value) => setConvertTarget(value as typeof convertTarget)} />
            <SelectField label="Rendering Intent" value={color.renderingIntent} options={["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"]} onChange={(value) => updateColor({ renderingIntent: value as typeof color.renderingIntent })} />
            <CheckField label="Black point compensation" checked={color.blackPointCompensation} onChange={(checked) => updateColor({ blackPointCompensation: checked })} />
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px] text-[var(--ps-text-dim)]">
              <div>Current {conversionPlan.currentProfile}; target {conversionPlan.newProfile}; expected shift {conversionPlan.expectedShift}.</div>
              <div>{conversionPlan.gamutMappingNote}</div>
              {[...conversionPlan.warnings, ...conversionValidation.warnings].map((warning) => (
                <div key={warning} className="text-amber-200">{warning}</div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" disabled={!activeLayer || !conversionValidation.valid || color.assignedProfile === convertTarget} onClick={() => convertProfile("active")}>Convert Layer</Button>
              <Button size="sm" variant="secondary" disabled={!conversionValidation.valid || color.assignedProfile === convertTarget} onClick={() => convertProfile("all")}>Convert Document</Button>
            </div>
          </div>
        ) : null}
        {workflow === "proof" ? (
          <div className="grid gap-2">
            <SelectField label="Working / Export Profile" value={color.workingSpace} options={supportedIccProfileNames()} onChange={(value) => updateColor({ workingSpace: value as typeof color.workingSpace })} />
            <SelectField label="Proof Profile" value={color.proofProfile} options={["None", ...supportedIccProfileNames()]} onChange={(value) => updateColor({ proofProfile: value as typeof color.proofProfile })} />
            <CheckField label="Proof colors in canvas and exports" checked={color.proofColors} onChange={(checked) => updateColor({ proofColors: checked })} />
            <CheckField label="Gamut warning overlay" checked={color.gamutWarning} onChange={(checked) => updateColor({ gamutWarning: checked })} />
            <SelectField label="Plate View" value={color.proofPlateView ?? "composite"} options={["composite", "ink", "mask"]} onChange={(value) => updateColor({ proofPlateView: value as NonNullable<ColorManagementSettings["proofPlateView"]> })} />
          </div>
        ) : null}
        <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Preview plates</div>
          <div className="grid grid-cols-2 gap-2">
            {proofChannelOptions.map((channel) => (
              <CheckField
                key={channel}
                label={channel[0].toUpperCase() + channel.slice(1)}
                checked={proofChannels.includes(channel)}
                onChange={(checked) => toggleProofChannel(channel, checked)}
              />
            ))}
          </div>
          {plateStats.length ? (
            <div className="mt-2 grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
              {plateStats.map((plate) => (
                <div key={plate.id} className="grid grid-cols-[1fr_auto] gap-2">
                  <span>{plate.name}</span>
                  <span>{plate.averageCoverage.toFixed(1)}% avg / {plate.maxCoverage.toFixed(1)}% max</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Panel>
      <Panel title="Color Modes & Prepress">
        <div className="mb-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px] text-[var(--ps-text-dim)]">
          Local pipeline: {pipeline.storage}, {pipeline.bitDepth}-bit {pipeline.colorMode}, high-bit math {pipeline.supportsHighBitMath ? "available" : "inactive"}, ICC engine {pipeline.supportsIccTransforms ? "available" : "not installed"}.
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMode("RGB")}>RGB</Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("CMYK")}>CMYK</Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("Grayscale")}>Grayscale</Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("Duotone", { duotone: settings.duotone ?? { ink1: "#111111", ink2: "#0066ff", curve: 1 } })}>Duotone</Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("Indexed", { indexed: settings.indexed ?? { colors: 64, dither: true } })}>Indexed</Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("Bitmap", { bitmap: settings.bitmap ?? { method: "halftone", threshold: 128, frequency: 10, angle: 45 } })}>Bitmap</Button>
        </div>
        <ColorField label="Duotone Ink 1" value={settings.duotone?.ink1 ?? "#111111"} onChange={(value) => setSettings({ ...settings, duotone: { ...(settings.duotone ?? { ink2: "#0066ff", curve: 1 }), ink1: value } })} />
        <ColorField label="Duotone Ink 2" value={settings.duotone?.ink2 ?? "#0066ff"} onChange={(value) => setSettings({ ...settings, duotone: { ...(settings.duotone ?? { ink1: "#111111", curve: 1 }), ink2: value } })} />
        <NumberField label="Indexed colors" value={settings.indexed?.colors ?? 64} min={2} max={256} onChange={(value) => setSettings({ ...settings, indexed: { ...(settings.indexed ?? { dither: true }), colors: value } })} />
        <NumberField label="Trap width px" value={settings.trap?.widthPx ?? 1} min={0} max={8} step={1} onChange={(value) => setSettings({ ...settings, trap: { ...(settings.trap ?? { enabled: true, strength: 0.35 }), widthPx: value } })} />
        <CheckField label="Enable CMYK trapping" checked={settings.trap?.enabled ?? false} onChange={(checked) => setSettings({ ...settings, trap: { ...(settings.trap ?? { widthPx: 1, strength: 0.35 }), enabled: checked } })} />
        <CheckField label="Allow destructive simulated 8-bit conversion" checked={allowDestructiveApply} onChange={setAllowDestructiveApply} />
        <div className="grid grid-cols-3 gap-2 pt-2">
          <Button size="sm" onClick={() => setMode(settings.mode, settings)}>Preview Mode</Button>
          <Button size="sm" variant="secondary" disabled={!activeLayer || !allowDestructiveApply} onClick={applyToActive}>Apply Layer</Button>
          <Button size="sm" variant="secondary" disabled={!allowDestructiveApply} onClick={applyToAll}>Apply All</Button>
        </div>
      </Panel>
    </div>
  )
}
