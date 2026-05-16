"use client"

import * as React from "react"
import { toast } from "sonner"
import { useEditor } from "../editor-context"
import { downloadText } from "../document-io"
import { Archive, Brush, CircleDot, Download, Palette, Plus, Sparkles, Trash2, Upload } from "lucide-react"
import type { AssetLibraryItem, BrushSettings, GradientSettings, LayerStyle } from "../types"

type AssetKind = AssetLibraryItem["kind"] | "all"

const KIND_LABEL: Record<AssetLibraryItem["kind"], string> = {
  brush: "Brush",
  gradient: "Gradient",
  pattern: "Pattern",
  style: "Style",
  swatch: "Swatch",
  shape: "Shape",
  export: "Export",
  "tool-preset": "Tool Preset",
  plugin: "Plugin",
  "cloud-library": "Cloud Library",
  stock: "Stock",
  font: "Font",
  "icc-profile": "ICC Profile",
  "variable-data": "Variable Data",
  prepress: "Prepress",
}

export function AssetsPanel() {
  const { activeDoc, activeLayer, brush, gradient, foreground, dispatch, commit } = useEditor()
  const [kind, setKind] = React.useState<AssetKind>("all")
  const [group, setGroup] = React.useState("Project")

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const assets = activeDoc.assetLibrary ?? []
  const visible = kind === "all" ? assets : assets.filter((asset) => asset.kind === kind)

  const setAssets = (next: AssetLibraryItem[]) => dispatch({ type: "set-asset-library", assets: next })

  const addAsset = (asset: Omit<AssetLibraryItem, "id" | "createdAt">) => {
    const next: AssetLibraryItem = {
      ...asset,
      id: `asset_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
    }
    setAssets([next, ...assets])
  }

  const captureBrush = () => addAsset({ name: `Brush ${Math.round(brush.size)}px`, kind: "brush", group, payload: brush })
  const captureGradient = () => addAsset({ name: `${gradient.type} gradient`, kind: "gradient", group, payload: gradient })
  const captureSwatch = () => addAsset({ name: foreground.toUpperCase(), kind: "swatch", group, payload: { color: foreground } })
  const captureStyle = () => {
    if (!activeLayer?.style) return
    addAsset({ name: `${activeLayer.name} style`, kind: "style", group, payload: activeLayer.style })
  }
  const addExportPreset = () => addAsset({
    name: "PNG 200% transparent",
    kind: "export",
    group,
    payload: { dialog: "export-as", format: "png", scale: 200, quality: 92, transparent: true, matte: "#ffffff" },
  })

  const applyAsset = (asset: AssetLibraryItem) => {
    if (asset.kind === "swatch") {
      const color = (asset.payload as { color?: string }).color
      if (typeof color === "string") dispatch({ type: "set-foreground", color })
    }
    if (asset.kind === "brush") dispatch({ type: "set-brush", brush: asset.payload as Partial<BrushSettings> })
    if (asset.kind === "gradient") dispatch({ type: "set-gradient", gradient: asset.payload as Partial<GradientSettings> })
    if (asset.kind === "style" && activeLayer) {
      dispatch({ type: "set-layer-style", id: activeLayer.id, style: asset.payload as LayerStyle })
      window.setTimeout(() => commit("Apply Asset Style", [activeLayer.id]), 0)
    }
    if (asset.kind === "export") {
      const payload = asset.payload as { dialog?: string; scope?: string }
      if (payload.dialog === "batch-export" || payload.scope) {
        window.dispatchEvent(new CustomEvent("ps-open-batch-export", { detail: asset.payload }))
      } else {
        window.dispatchEvent(new CustomEvent("ps-open-export-as", { detail: { dialog: "export-as", ...payload } }))
      }
    }
  }

  const importAssets = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json,application/json"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const parsed = JSON.parse(await file.text())
        const imported = (Array.isArray(parsed) ? parsed : parsed.assets) as AssetLibraryItem[]
        if (!Array.isArray(imported)) throw new Error("Asset file does not contain an asset array")
        const cleaned = imported
          .filter((asset) => asset && typeof asset.name === "string" && typeof asset.kind === "string")
          .map((asset) => ({
            ...asset,
            id: asset.id ?? `asset_${Math.random().toString(36).slice(2, 9)}`,
            createdAt: Number(asset.createdAt) || Date.now(),
          }))
        setAssets([...cleaned, ...assets])
        toast.success(`Imported ${cleaned.length} asset${cleaned.length === 1 ? "" : "s"}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not import assets")
      }
    }
    input.click()
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-2">
          <Archive className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="h-6 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
            placeholder="Asset group"
          />
        </div>
        <div className="grid grid-cols-3 gap-1">
          <AssetButton icon={Palette} label="Swatch" onClick={captureSwatch} />
          <AssetButton icon={Brush} label="Brush" onClick={captureBrush} />
          <AssetButton icon={CircleDot} label="Gradient" onClick={captureGradient} />
          <AssetButton icon={Sparkles} label="Style" disabled={!activeLayer?.style} onClick={captureStyle} />
          <AssetButton icon={Plus} label="Export" onClick={addExportPreset} />
          <AssetButton icon={Upload} label="Import" onClick={importAssets} />
        </div>
        <div className="flex items-center gap-1">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AssetKind)}
            className="h-6 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[11px]"
          >
            <option value="all">All assets</option>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button
            type="button"
            className="flex h-6 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]"
            onClick={() => downloadText(JSON.stringify({ app: "Photoshop Web", assets }, null, 2), `${activeDoc.name}-assets.json`)}
          >
            <Download className="h-3 w-3" />
            JSON
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <PanelEmpty text="Capture brushes, gradients, styles, swatches, and export presets into this project." />
        ) : (
          visible.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="grid w-full grid-cols-[28px_1fr_auto] items-center gap-2 border-b border-[var(--ps-divider)] px-2 py-2 text-left hover:bg-[var(--ps-tool-hover)]"
              onClick={() => applyAsset(asset)}
            >
              <AssetPreview asset={asset} />
              <span className="min-w-0">
                <span className="block truncate text-[11px]">{asset.name}</span>
                <span className="block truncate text-[10px] text-[var(--ps-text-dim)]">{KIND_LABEL[asset.kind]} · {asset.group ?? "Ungrouped"}</span>
              </span>
              <span
                role="button"
                tabIndex={0}
                className="rounded-sm p-1 text-[var(--ps-text-dim)] hover:bg-red-500/15 hover:text-red-200"
                onClick={(e) => {
                  e.stopPropagation()
                  setAssets(assets.filter((item) => item.id !== asset.id))
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    e.stopPropagation()
                    setAssets(assets.filter((item) => item.id !== asset.id))
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function AssetPreview({ asset }: { asset: AssetLibraryItem }) {
  if (asset.kind === "swatch") {
    const color = (asset.payload as { color?: string }).color ?? "#000000"
    return <span className="h-7 w-7 rounded-sm border border-[var(--ps-divider)]" style={{ background: color }} />
  }
  if (asset.kind === "gradient") {
    return <span className="h-7 w-7 rounded-sm border border-[var(--ps-divider)] bg-gradient-to-br from-black via-white to-[var(--ps-accent)]" />
  }
  const Icon = asset.kind === "brush" ? Brush : asset.kind === "style" ? Sparkles : asset.kind === "export" ? Download : Archive
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]">
      <Icon className="h-3.5 w-3.5 text-[var(--ps-text-dim)]" />
    </span>
  )
}

function AssetButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 items-center justify-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}
