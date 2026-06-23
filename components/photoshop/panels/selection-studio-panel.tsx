"use client"

import * as React from "react"
import { toast } from "sonner"
import { useEditor } from "../editor-context"
import { dispatchPhotoshopEvent } from "../events"
import {
  focusAreaMask,
  selectionFromMask,
  selectionToPath,
  selectionToMaskCanvas,
  selectBackgroundMask,
  selectSkyMask,
  selectSubjectMask,
} from "../tool-helpers"
import type { ToolId } from "../types"
import { uid } from "../uid"

export function SelectionStudioPanel() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [amount, setAmount] = React.useState(8)
  const [feather, setFeather] = React.useState(4)
  const [border, setBorder] = React.useState(3)
  const [smooth, setSmooth] = React.useState(3)
  const [tolerance, setTolerance] = React.useState(32)
  const [channelName, setChannelName] = React.useState("Alpha Selection")

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const selection = activeDoc.selection
  const bounds = selection.bounds
  const channels = activeDoc.channels ?? []
  const hasSelection = !!bounds
  const diagnostics = selection.diagnostics

  const runSelection = (label: string, fn: () => void) => {
    fn()
    requestRender()
    window.setTimeout(() => commit(label, []), 0)
  }

  const autoMask = (kind: "subject" | "sky" | "background" | "focus") => {
    if (!activeLayer || typeof activeLayer.canvas.getContext !== "function") return
    const mask =
      kind === "subject"
        ? selectSubjectMask(activeLayer.canvas, 48)
        : kind === "sky"
          ? selectSkyMask(activeLayer.canvas)
          : kind === "background"
            ? selectBackgroundMask(activeLayer.canvas, tolerance)
          : focusAreaMask(activeLayer.canvas)
    runSelection(kind === "subject" ? "Select Subject" : kind === "sky" ? "Select Sky" : kind === "background" ? "Select Background" : "Focus Area", () => {
      dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
    })
  }

  const setTool = (tool: ToolId) => {
    dispatch({ type: "set-tool", tool })
    toast.info("Tool selected")
  }

  const saveSelection = () => {
    const mask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, selection)
    if (!mask) return
    dispatch({
      type: "save-selection",
      channel: {
        id: uid("channel"),
        name: channelName.trim() || `Alpha ${channels.length + 1}`,
        canvas: mask,
      },
    })
    setChannelName(`Alpha ${channels.length + 2}`)
    toast.success("Selection saved")
  }

  const makePathFromSelection = () => {
    if (!activeLayer || !hasSelection) return
    const path = selectionToPath(selection, activeDoc.width, activeDoc.height, 1.1)
    if (!path) return
    runSelection("Make Work Path from Selection", () => dispatch({ type: "set-layer-path", id: activeLayer.id, path }))
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="border-b border-[var(--ps-divider)] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Selection Studio</div>
        {bounds ? (
          <div className="grid grid-cols-4 gap-1 text-[10px] tabular-nums text-[var(--ps-text-dim)]">
            <Metric label="X" value={Math.round(bounds.x)} />
            <Metric label="Y" value={Math.round(bounds.y)} />
            <Metric label="W" value={Math.round(bounds.w)} />
            <Metric label="H" value={Math.round(bounds.h)} />
          </div>
        ) : (
          <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-3 text-center text-[var(--ps-text-dim)]">
            No active selection
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        <Section title="Create">
          <div className="grid grid-cols-2 gap-1">
            <PanelButton
              label="All"
              onClick={() =>
                runSelection("Select All", () =>
                  dispatch({
                    type: "set-selection",
                    selection: { bounds: { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height }, shape: "rect" },
                  }),
                )
              }
            />
            <PanelButton
              label="Deselect"
              disabled={!hasSelection}
              onClick={() =>
                runSelection("Deselect", () => dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } }))
              }
            />
            <PanelButton label="Subject" disabled={!activeLayer} title="Offline object-aware heuristic (Local). No ML model bundled; diagnostics report nativeAiParity=false." onClick={() => autoMask("subject")} />
            <PanelButton label="Sky" disabled={!activeLayer} title="Offline sky-extraction heuristic (Local). No ML model bundled; diagnostics report nativeAiParity=false." onClick={() => autoMask("sky")} />
            <PanelButton label="Background" disabled={!activeLayer} title="Offline background-extraction heuristic (Local). No ML model bundled; diagnostics report nativeAiParity=false." onClick={() => autoMask("background")} />
            <PanelButton label="Focus Area" disabled={!activeLayer} title="Offline focus/depth heuristic (Local). No ML model bundled; diagnostics report nativeAiParity=false." onClick={() => autoMask("focus")} />
            <PanelButton label="Mask..." disabled={!activeDoc} onClick={() => dispatchPhotoshopEvent("ps-open-select-and-mask")} />
            <PanelButton label="To Path" disabled={!activeLayer || !hasSelection} onClick={makePathFromSelection} />
          </div>
          <div className="grid grid-cols-2 gap-1">
            <PanelButton label="Object Tool" onClick={() => setTool("object-select")} />
            <PanelButton label="Wand Tool" onClick={() => setTool("magic-wand")} />
          </div>
        </Section>

        <Section title="Refine">
          <NumberAction
            label="Expand"
            value={amount}
            min={1}
            max={256}
            disabled={!hasSelection}
            onChange={setAmount}
            onRun={() => runSelection("Expand Selection", () => dispatch({ type: "grow-selection", amount }))}
          />
          <NumberAction
            label="Contract"
            value={amount}
            min={1}
            max={256}
            disabled={!hasSelection}
            onChange={setAmount}
            onRun={() => runSelection("Contract Selection", () => dispatch({ type: "contract-selection", amount }))}
          />
          <NumberAction
            label="Feather"
            value={feather}
            min={0}
            max={128}
            disabled={!hasSelection}
            onChange={setFeather}
            onRun={() => runSelection("Feather Selection", () => dispatch({ type: "feather-selection", radius: feather }))}
          />
          <NumberAction
            label="Border"
            value={border}
            min={1}
            max={128}
            disabled={!hasSelection}
            onChange={setBorder}
            onRun={() => runSelection("Border Selection", () => dispatch({ type: "border-selection", width: border }))}
          />
          <NumberAction
            label="Smooth"
            value={smooth}
            min={1}
            max={64}
            disabled={!hasSelection}
            onChange={setSmooth}
            onRun={() => runSelection("Smooth Selection", () => dispatch({ type: "smooth-selection", radius: smooth }))}
          />
          <NumberAction
            label="Similar"
            value={tolerance}
            min={0}
            max={255}
            disabled={!hasSelection || !activeLayer}
            onChange={setTolerance}
            onRun={() => runSelection("Similar Selection", () => dispatch({ type: "similar-selection", tolerance }))}
          />
        </Section>

        {diagnostics ? (
          <Section title="Diagnostics">
            <div className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
              <div className="text-[var(--ps-text)]">{diagnostics.summary}</div>
              <div className="grid grid-cols-2 gap-1 text-[10px] tabular-nums text-[var(--ps-text-dim)]">
                <Metric label="Accepted" value={diagnostics.acceptedPixels} />
                <Metric label="Rejected" value={diagnostics.rejectedPixels} />
              </div>
              <DiagnosticRow color="#34d399" label="Accepted" value={diagnostics.reasonCounts.accepted} />
              <DiagnosticRow color="#3b82f6" label="Color rejected" value={diagnostics.reasonCounts.color} />
              <DiagnosticRow color="#f87171" label="Edge rejected" value={diagnostics.reasonCounts.edge} />
              <DiagnosticRow color="#a855f7" label="Alpha rejected" value={diagnostics.reasonCounts.alpha} />
              {diagnostics.maxPixelsReached ? <DiagnosticRow color="#facc15" label="Pixel limit" value={diagnostics.reasonCounts.limit} /> : null}
              {diagnostics.boundsTouchesCanvas ? <DiagnosticRow color="#fb923c" label="Canvas bounds touched" value={1} /> : null}
            </div>
          </Section>
        ) : null}

        <Section title="Alpha Channels">
          <div className="flex gap-1">
            <input
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
            />
            <button
              type="button"
              disabled={!hasSelection}
              onClick={saveSelection}
              className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
            >
              Save
            </button>
          </div>
          <div className="divide-y divide-[var(--ps-divider)] rounded-sm border border-[var(--ps-divider)]">
            {channels.length === 0 ? (
              <div className="px-2 py-3 text-center text-[var(--ps-text-dim)]">No saved channels</div>
            ) : (
              channels.map((channel) => (
                <div key={channel.id} className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-1 px-2 py-1.5">
                  <span className="truncate">{channel.name}</span>
                  <SmallButton label="Replace" onClick={() => runSelection("Load Selection", () => dispatch({ type: "load-selection", channelId: channel.id, mode: "replace" }))} />
                  <SmallButton label="Add" onClick={() => runSelection("Load Selection", () => dispatch({ type: "load-selection", channelId: channel.id, mode: "add" }))} />
                  <SmallButton label="Sub" onClick={() => runSelection("Load Selection", () => dispatch({ type: "load-selection", channelId: channel.id, mode: "subtract" }))} />
                  <SmallButton label="Int" onClick={() => runSelection("Load Selection", () => dispatch({ type: "load-selection", channelId: channel.id, mode: "intersect" }))} />
                  <SmallButton label="Delete" onClick={() => dispatch({ type: "delete-channel", channelId: channel.id })} />
                </div>
              ))
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 py-1">
      <span className="text-[var(--ps-text-dim)]">{label}</span> {value}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{title}</div>
      {children}
    </div>
  )
}

function PanelButton({ label, disabled, onClick, title }: { label: string; disabled?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-left hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function SmallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]"
    >
      {label}
    </button>
  )
}

function DiagnosticRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--ps-text-dim)]">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function NumberAction({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
  onRun,
}: {
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (value: number) => void
  onRun: () => void
}) {
  return (
    <div className="grid grid-cols-[74px_1fr_auto] items-center gap-1">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))}
        className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none disabled:opacity-40"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={onRun}
        className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
      >
        Apply
      </button>
    </div>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}
