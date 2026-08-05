"use client"

/**
 * Automation tab — droplets, conditional actions and batch playback over the asset library.
 *
 * One tab of the Advanced Subsystems dialog. The dialog itself
 * (`subsystems-dialog.tsx`) only owns the tab list and the switch that picks
 * a workspace; each workspace holds its own state and talks to the editor
 * directly, so opening the dialog does not mount the other ten.
 */

import { downloadCanvasWithPreset } from "@/components/photoshop/advanced/subsystems-dialog-helpers"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  CapabilityNotice,
  EmptyState,
  FileButton,
  NumberField,
  Panel,
  SelectField,
} from "@/components/photoshop/advanced/subsystems-dialog-controls"
import {
  isImportRecord,
  normalizeDropletImportPayload,
} from "@/editor/advanced/subsystems-import-normalizers"
import { useEditor, makeCanvas } from "@/components/photoshop/editor/context"
import { downloadText, renderDocumentComposite } from "@/editor/document/io"
import { uid } from "@/editor/uid"
import { ADVANCED_FILE_LIMITS, assertAdvancedFileSize } from "@/editor/advanced/subsystems"
import {
  DEFAULT_AUTOMATION_OUTPUT,
  createAutomationWorkflow,
  executeCanvasWorkflow,
  loadAutomationWorkflows,
  parseAutomationWorkflowImportPayload,
  renderTemplateName,
  saveAutomationWorkflows,
  type AutomationOperation,
  type AutomationOutputPreset,
  type AutomationWorkflow,
} from "@/editor/automation-engine"
import {
  DROPLET_BUNDLE_FORMAT,
  buildDropletBundle,
  dropletBundleFileName,
  dropletBundleToAutomationAsset,
  parseDropletBundle,
  serializeDropletBundle,
} from "@/editor/droplets-bundle"
import type { Droplet } from "@/editor/automation-store"
import type { AssetLibraryItem, PsDocument } from "@/editor/types"
type AutomationPayload = {
  type: "droplet" | "script-event" | "conditional-action" | "workflow"
  actionId?: string
  event?: string
  condition?: string
  falseActionId?: string
  preScript?: string
  postScript?: string
  format?: AutomationOutputPreset["format"]
  manualOnly?: boolean
  workflow?: AutomationWorkflow
}

function conditionPasses(doc: PsDocument, condition = "always") {
  if (condition === "has-selection") return !!doc.selection.bounds
  if (condition === "has-active-layer") return !!doc.activeLayerId
  if (condition === "multi-layer") return doc.layers.filter((layer) => layer.kind !== "group").length > 1
  if (condition === "rgb") return doc.colorMode === "RGB"
  if (condition === "print-ready") return !!doc.printSettings?.cropMarks || !!doc.printSettings?.registrationMarks
  if (condition === "document-open") return true
  return true
}

function automationAssetPayload(asset: AssetLibraryItem): AutomationPayload | null {
  const payload = asset.payload as Partial<AutomationPayload> | null
  return payload && typeof payload === "object" && typeof payload.type === "string" ? payload as AutomationPayload : null
}

export function AutomationWorkspace() {
  const { activeDoc, actions, playAction, dispatch } = useEditor()
  const [name, setName] = React.useState("Local Droplet")
  const [actionId, setActionId] = React.useState("")
  const [falseActionId, setFalseActionId] = React.useState("")
  const [condition, setCondition] = React.useState("always")
  const [event, setEvent] = React.useState("Document Open")
  const [operation, setOperation] = React.useState<AutomationOperation>("auto-tone")
  const [manualOnly, setManualOnly] = React.useState(true)
  const [preScript, setPreScript] = React.useState("")
  const [scriptSource, setScriptSource] = React.useState('report("Droplet run")')
  const [postScript, setPostScript] = React.useState("")
  const [outputFormat, setOutputFormat] = React.useState<AutomationOutputPreset["format"]>("png")
  const [quality, setQuality] = React.useState(0.92)
  const [filenameTemplate, setFilenameTemplate] = React.useState(DEFAULT_AUTOMATION_OUTPUT.filenameTemplate)
  const [savedWorkflows, setSavedWorkflows] = React.useState<AutomationWorkflow[]>([])
  React.useEffect(() => {
    setSavedWorkflows(loadAutomationWorkflows())
  }, [])
  if (!activeDoc) return <EmptyState text="Open a document before creating automation." />

  const assets = activeDoc.assetLibrary ?? []
  const automationAssets = assets.filter((asset) => asset.group === "Automation" && automationAssetPayload(asset))
  const firstActionId = actionId || actions[0]?.id || ""
  const setAssets = (next: AssetLibraryItem[]) => dispatch({ type: "set-asset-library", assets: next })
  const setWorkflowStore = (next: AutomationWorkflow[]) => {
    setSavedWorkflows(next)
    saveAutomationWorkflows(next)
  }
  const addAutomation = (type: AutomationPayload["type"]) => {
    if (!firstActionId && type !== "script-event") return
    const payload: AutomationPayload = {
      type,
      actionId: firstActionId,
      falseActionId: falseActionId || undefined,
      condition,
      event,
      preScript: preScript.trim() || undefined,
      postScript: postScript.trim() || undefined,
      format: "png",
      manualOnly,
    }
    setAssets([{ id: uid("auto"), name: name || type, kind: "prepress", group: "Automation", payload, createdAt: Date.now() }, ...assets])
  }
  const addWorkflowAutomation = () => {
    const steps: AutomationWorkflow["steps"] = []
    if (operation !== "none") steps.push({ id: uid("step"), type: "operation", operation })
    if (firstActionId) steps.push({ id: uid("step"), type: "action", actionId: firstActionId })
    if (scriptSource.trim()) steps.push({ id: uid("step"), type: "script", source: scriptSource })
    if (!steps.length) return
    const workflow = createAutomationWorkflow(name || "Local Workflow", steps, {
      format: outputFormat,
      quality,
      transparent: true,
      matte: "#ffffff",
      filenameTemplate,
    })
    const payload: AutomationPayload = {
      type: "workflow",
      workflow,
      condition,
      event,
      actionId: firstActionId || undefined,
      preScript: preScript.trim() || undefined,
      postScript: postScript.trim() || undefined,
      manualOnly,
    }
    setAssets([{ id: uid("auto"), name: workflow.name, kind: "prepress", group: "Automation", payload, createdAt: Date.now() }, ...assets])
    setWorkflowStore([workflow, ...savedWorkflows.filter((item) => item.id !== workflow.id)])
    toast.success("Workflow droplet saved")
  }
  const runPayload = async (payload: AutomationPayload) => {
    if (!conditionPasses(activeDoc, payload.condition)) {
      if (payload.type === "conditional-action" && payload.falseActionId) playAction(payload.falseActionId)
      else toast.info("Automation condition did not match this document.")
      return
    }
    if (payload.workflow) {
      const workflowSteps = [
        ...(payload.preScript ? [{ id: uid("step"), type: "script" as const, source: payload.preScript }] : []),
        ...payload.workflow.steps,
        ...(payload.postScript ? [{ id: uid("step"), type: "script" as const, source: payload.postScript }] : []),
      ]
      for (const step of payload.workflow.steps) {
        if (step.type === "action" && step.actionId) playAction(step.actionId)
      }
      const rasterSteps = workflowSteps.filter((step) => step.type !== "action")
      if (rasterSteps.length) {
        const flat = renderDocumentComposite(activeDoc, { transparent: true })
        const output = await executeCanvasWorkflow(flat, { ...payload.workflow, steps: rasterSteps }, { makeCanvas })
        const filename = renderTemplateName(payload.workflow.output.filenameTemplate, { name: activeDoc.name, workflow: payload.workflow.name }, 0)
        await downloadCanvasWithPreset(output, filename, payload.workflow.output)
      }
      return
    }
    if (payload.actionId) playAction(payload.actionId)
  }
  const exportAsset = (asset: AssetLibraryItem) => {
    const payload = automationAssetPayload(asset)
    if (!payload) return
    const action = actions.find((item) => item.id === payload.actionId) ?? null
    const payloadFormat = payload.workflow?.output.format ?? payload.format
    const dropletFormat = payloadFormat === "jpeg" || payloadFormat === "png" || payloadFormat === "webp" ? payloadFormat : undefined
    const droplet: Droplet = {
      id: asset.id,
      name: asset.name,
      actionId: payload.actionId,
      preScript: payload.preScript,
      postScript: payload.postScript,
      condition: payload.condition as Droplet["condition"],
      event: payload.event,
      manualOnly: payload.manualOnly ?? true,
      workflow: payload.workflow,
      exportFormat: dropletFormat,
      exportName: payload.workflow?.output.filenameTemplate,
      createdAt: asset.createdAt,
      updatedAt: Date.now(),
    }
    const bundle = buildDropletBundle(droplet, action, { workflow: payload.workflow })
    downloadText(serializeDropletBundle(bundle), dropletBundleFileName(bundle), "application/json")
  }
  const importDroplet = async (file: File) => {
    assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.jsonBytes, "Droplet file")
    const parsed: unknown = JSON.parse(await file.text())
    let asset: AssetLibraryItem
    if (isImportRecord(parsed) && parsed.format === DROPLET_BUNDLE_FORMAT) {
      asset = dropletBundleToAutomationAsset(parseDropletBundle(JSON.stringify(parsed)), { makeId: () => uid("auto") })
      const payload = automationAssetPayload(asset)
      if (payload?.workflow) setWorkflowStore([payload.workflow, ...savedWorkflows.filter((item) => item.id !== payload.workflow!.id)])
    } else if (isImportRecord(parsed) && parsed.workflow !== undefined) {
      const workflow = parseAutomationWorkflowImportPayload(parsed)
      asset = { id: uid("auto"), name: workflow.name, kind: "prepress", group: "Automation", payload: { type: "workflow", workflow, condition: "always", manualOnly: true }, createdAt: Date.now() }
      setWorkflowStore([workflow, ...savedWorkflows.filter((item) => item.id !== workflow.id)])
    } else {
      asset = normalizeDropletImportPayload(parsed)
      const payload = automationAssetPayload(asset)
      if (payload?.workflow) setWorkflowStore([payload.workflow, ...savedWorkflows.filter((item) => item.id !== payload.workflow!.id)])
    }
    setAssets([{ ...asset, id: uid("auto"), createdAt: Date.now() }, ...assets])
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel title="Create Local Automation">
        <CapabilityNotice>
          Script events are stored as local descriptors and exported with their event label. They are manual-only in this browser build; app lifecycle events are not subscribed automatically.
        </CapabilityNotice>
        <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
        <SelectField label="Action" value={firstActionId} options={actions.length ? actions.map((action) => action.id) : [""]} onChange={setActionId} />
        <SelectField label="If" value={condition} options={["always", "has-selection", "has-active-layer", "multi-layer", "rgb", "print-ready", "document-open"]} onChange={setCondition} />
        <SelectField label="Else" value={falseActionId} options={["", ...actions.map((action) => action.id)]} onChange={setFalseActionId} />
        <SelectField label="Event" value={event} options={["Document Open", "Before Export", "After Save", "Layer Changed", "History Commit"]} onChange={setEvent} />
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={!manualOnly} onChange={(event) => setManualOnly(!event.target.checked)} />
          Event routed
        </label>
        <SelectField label="Raster Step" value={operation} options={["none", "auto-tone", "auto-contrast", "auto-color", "equalize", "hdr-toning", "invert", "grayscale", "desaturate"]} onChange={(value) => setOperation(value as AutomationOperation)} />
        <Textarea value={preScript} onChange={(event) => setPreScript(event.target.value)} placeholder="Pre-script (optional)" className="h-16 resize-none font-mono text-[11px]" spellCheck={false} />
        <Textarea value={scriptSource} onChange={(event) => setScriptSource(event.target.value)} className="h-20 resize-none font-mono text-[11px]" spellCheck={false} />
        <Textarea value={postScript} onChange={(event) => setPostScript(event.target.value)} placeholder="Post-script (optional)" className="h-16 resize-none font-mono text-[11px]" spellCheck={false} />
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Output" value={outputFormat} options={["png", "jpeg", "webp", "gif", "avif"]} onChange={(value) => setOutputFormat(value as AutomationOutputPreset["format"])} />
          <NumberField label="Quality" value={quality} min={0.1} max={1} step={0.01} onChange={setQuality} />
        </div>
        <Input value={filenameTemplate} onChange={(event) => setFilenameTemplate(event.target.value)} className="h-8" />
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" disabled={!actions.length} onClick={() => addAutomation("droplet")}>Droplet</Button>
          <Button size="sm" disabled={!actions.length} variant="secondary" onClick={() => addAutomation("script-event")}>Script Event</Button>
          <Button size="sm" disabled={!actions.length} variant="secondary" onClick={() => addAutomation("conditional-action")}>Conditional</Button>
        </div>
        <Button size="sm" onClick={addWorkflowAutomation}>Save Workflow Droplet</Button>
        <FileButton accept=".json,.psworkflow,.psworkflow.json,.psdroplet,.psdroplet.json,application/json" label="Import Droplet" onFile={importDroplet} />
      </Panel>
      <Panel title="Installed Automations">
        <CapabilityNotice>
          Saved workflow droplets are also available to Batch Processing for browser-local files.
        </CapabilityNotice>
        <div className="max-h-[520px] overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {automationAssets.length ? automationAssets.map((asset) => {
            const payload = automationAssetPayload(asset)!
            const action = actions.find((item) => item.id === payload.actionId)
            return (
              <div key={asset.id} className="grid grid-cols-[1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 text-[11px]">
                <div>
                  <div className="font-medium">{asset.name}</div>
                  <div className="text-[var(--ps-text-dim)]">{payload.type} - {payload.event ?? "manual"} - {payload.condition ?? "always"} - {payload.manualOnly === false ? "event-routed" : "manual-only"} - {payload.workflow?.steps.length ?? action?.name ?? "No action"}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => void runPayload(payload)}>Run</Button>
                  <Button size="sm" variant="secondary" onClick={() => exportAsset(asset)}>Export</Button>
                </div>
              </div>
            )
          }) : <EmptyState text="Create droplets, script events, or conditional actions from recorded Actions." />}
        </div>
      </Panel>
    </div>
  )
}
