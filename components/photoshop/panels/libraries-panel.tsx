"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Download,
  Image as ImageIcon,
  Layers as LayersIcon,
  Library,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorSelector, makeCanvas } from "../editor-context"
import { uid } from "../uid"
import type { Layer } from "../types"
import { createSmartObjectSource } from "../smart-objects"
import {
  blobToCanvas,
  deleteLibraryAsset,
  filterLocalLibraryAssets,
  libraryAssetFromCanvas,
  libraryAssetFromFile,
  libraryStorageReady,
  listLibraryAssets,
  parseLibraryTagInput,
  putLibraryAsset,
  subscribeLibraryChange,
  type LibraryAssetRecord,
} from "../libraries-store"

type PlaceMode = "smart-object" | "pixel"

const ACCEPT_FILES = "image/png,image/jpeg,image/webp,image/gif,image/avif"

type LocalLibraryBundle = {
  id: string
  name: string
  category: string
  items: string[]
}

const LOCAL_LIBRARY_SAMPLES: LocalLibraryBundle[] = [
  {
    id: "project-brand-kit",
    name: "Project Brand Kit",
    category: "Brand",
    items: ["Primary logo", "Accent palette", "Social templates"],
  },
  {
    id: "editorial-sans",
    name: "Editorial Sans",
    category: "Typography",
    items: ["Display", "Text", "Caption"],
  },
]

function formatBytes(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes)) return "-"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return "-"
  try {
    return new Date(value).toLocaleString()
  } catch {
    return "-"
  }
}

export function LibrariesPanel() {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
  const [assets, setAssets] = React.useState<LibraryAssetRecord[]>([])
  const [query, setQuery] = React.useState("")
  const [groupFilter, setGroupFilter] = React.useState<string>("all")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [placeMode, setPlaceMode] = React.useState<PlaceMode>("smart-object")
  const [status, setStatus] = React.useState<string>("")
  const [bundles, setBundles] = React.useState<LocalLibraryBundle[]>([])
  const [bundleQuery, setBundleQuery] = React.useState("")
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const dragAssetIdRef = React.useRef<string | null>(null)

  const idbReady = React.useMemo(() => libraryStorageReady(), [])

  const refresh = React.useCallback(async () => {
    if (!idbReady) {
      setStatus("IndexedDB is unavailable; library assets cannot persist locally.")
      return
    }
    try {
      const next = await listLibraryAssets()
      setAssets(next)
      setStatus(`${next.length} assets`)
    } catch (err) {
      setStatus(`Failed to load library: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [idbReady])

  React.useEffect(() => {
    refresh()
    const unsubscribe = subscribeLibraryChange(refresh)
    return unsubscribe
  }, [refresh])

  const groups = React.useMemo(() => {
    const set = new Set<string>()
    for (const asset of assets) if (asset.group) set.add(asset.group)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [assets])

  const filtered = React.useMemo(() => {
    return filterLocalLibraryAssets(assets, { query, group: groupFilter })
  }, [assets, query, groupFilter])

  const selected = React.useMemo(() => filtered.find((a) => a.id === selectedId) ?? assets.find((a) => a.id === selectedId) ?? null, [assets, filtered, selectedId])
  const filteredBundles = React.useMemo(() => {
    const search = bundleQuery.trim().toLowerCase()
    if (!search) return bundles
    return bundles.filter((bundle) =>
      [bundle.name, bundle.category, ...bundle.items].some((value) => value.toLowerCase().includes(search)),
    )
  }, [bundleQuery, bundles])

  const exportLibraryBundle = React.useCallback(() => {
    if (!bundles.length) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "ps-local-library-bundles", bundles }, null, 2)], {
      type: "application/json",
    }))
    try {
      const link = document.createElement("a")
      link.href = url
      link.download = "photoshop-local-library-bundles.json"
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }, [bundles])

  const importFiles = React.useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    let imported = 0
    for (const file of list) {
      if (file.size > 32 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 32 MB; skipping import.`)
        continue
      }
      try {
        const record = await libraryAssetFromFile(file)
        await putLibraryAsset(record)
        imported++
      } catch (err) {
        toast.error(`Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (imported) toast.success(`Imported ${imported} asset${imported === 1 ? "" : "s"}.`)
  }, [])

  const importFromActiveDocument = React.useCallback(async () => {
    if (!activeDoc) return
    const layer = activeDoc.layers.find((l) => l.id === activeDoc.activeLayerId)
    const canvas = layer?.canvas ?? activeDoc.layers[0]?.canvas
    if (!canvas) {
      toast.error("No layer canvas available to snapshot.")
      return
    }
    try {
      const record = await libraryAssetFromCanvas(canvas, layer?.name ?? activeDoc.name)
      await putLibraryAsset(record)
      toast.success(`Saved "${record.name}" to your library.`)
    } catch (err) {
      toast.error(`Could not snapshot layer: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [activeDoc])

  const placeAsset = React.useCallback(async (asset: LibraryAssetRecord, x?: number, y?: number) => {
    if (!activeDoc) {
      toast.error("Open a document before placing a library asset.")
      return
    }
    if (asset.kind !== "image" || !asset.blob) {
      toast.error("Only image assets can be placed on the canvas right now.")
      return
    }
    try {
      const sourceCanvas = await blobToCanvas(asset.blob)
      const docCanvas = makeCanvas(activeDoc.width, activeDoc.height)
      const ctx = docCanvas.getContext("2d")!
      const maxW = activeDoc.width * 0.85
      const maxH = activeDoc.height * 0.85
      const scale = Math.min(1, maxW / sourceCanvas.width, maxH / sourceCanvas.height)
      const w = Math.max(1, sourceCanvas.width * scale)
      const h = Math.max(1, sourceCanvas.height * scale)
      const ox = (x ?? (activeDoc.width - w) / 2)
      const oy = (y ?? (activeDoc.height - h) / 2)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(sourceCanvas, ox, oy, w, h)
      const layer: Layer = {
        id: uid("layer"),
        name: `Library: ${asset.name}`,
        kind: placeMode === "smart-object" ? "smart-object" : "raster",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: docCanvas,
      }
      if (placeMode === "smart-object") {
        layer.smartObject = true
        layer.smartSource = createSmartObjectSource(sourceCanvas, {
          name: asset.name,
          fileName: asset.name,
          linkType: "embedded",
          status: "embedded",
          embedded: true,
          lastKnownSize: asset.sizeBytes,
        })
      }
      dispatch({ type: "add-layer", layer })
      window.setTimeout(() => commit(placeMode === "smart-object" ? "Place Library Smart Object" : "Place Library Pixel Layer", [layer.id]), 0)
      toast.success(`Placed "${asset.name}" on ${activeDoc.name}.`)
    } catch (err) {
      toast.error(`Could not place asset: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [activeDoc, commit, dispatch, placeMode])

  const removeAsset = async (asset: LibraryAssetRecord) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${asset.name}" from your local library?`)) return
    await deleteLibraryAsset(asset.id)
    if (selectedId === asset.id) setSelectedId(null)
  }

  const updateAsset = async (asset: LibraryAssetRecord, patch: Partial<LibraryAssetRecord>) => {
    await putLibraryAsset({ ...asset, ...patch, updatedAt: Date.now() })
  }

  return (
    <div
      className="flex h-full flex-col text-[11px] text-[var(--ps-text)]"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
        }
      }}
      onDrop={async (event) => {
        if (!event.dataTransfer.files.length) return
        event.preventDefault()
        await importFiles(event.dataTransfer.files)
      }}
    >
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="space-y-1.5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="grid grid-cols-2 gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setBundles(LOCAL_LIBRARY_SAMPLES)}
              className="h-7 justify-start gap-1 text-[11px]"
            >
              <Plus className="h-3 w-3" /> Add Local Library Samples
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!bundles.length}
              onClick={exportLibraryBundle}
              className="h-7 justify-start gap-1 text-[11px]"
            >
              <Download className="h-3 w-3" /> Export Library Bundle
            </Button>
          </div>
          <Input
            value={bundleQuery}
            onChange={(event) => setBundleQuery(event.target.value)}
            placeholder="Search local libraries"
            className="h-7 bg-[var(--ps-panel)] text-[11px]"
          />
          {filteredBundles.length ? (
            <div className="space-y-1">
              {filteredBundles.map((bundle) => (
                <div key={bundle.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 py-1.5">
                  <div className="font-medium">{bundle.name}</div>
                  <div className="truncate text-[10px] text-[var(--ps-text-dim)]">
                    {bundle.category}: {bundle.items.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          ) : bundles.length ? (
            <div className="text-[10px] text-[var(--ps-text-dim)]">No matching library bundles.</div>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--ps-text-dim)]">
          <Library className="h-3.5 w-3.5" />
          <span>Local library (stored in your browser)</span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()} className="h-7 justify-start gap-1 text-[11px]">
            <Upload className="h-3 w-3" /> Import
          </Button>
          <Button size="sm" variant="ghost" disabled={!activeDoc} onClick={importFromActiveDocument} className="h-7 justify-start gap-1 text-[11px]">
            <Plus className="h-3 w-3" /> From Layer
          </Button>
          <Button size="sm" variant="ghost" onClick={refresh} className="h-7 justify-start gap-1 text-[11px]">
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <select
            value={placeMode}
            onChange={(event) => setPlaceMode(event.target.value as PlaceMode)}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
            aria-label="Place as"
          >
            <option value="smart-object">Place as Smart Object</option>
            <option value="pixel">Place as Pixel Layer</option>
          </select>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ps-text-dim)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, tag, group"
            className="h-7 bg-[var(--ps-panel-2)] pl-7 text-[11px]"
          />
        </div>
        <select
          value={groupFilter}
          onChange={(event) => setGroupFilter(event.target.value)}
          className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
          aria-label="Group filter"
        >
          <option value="all">All groups</option>
          {groups.map((group) => <option key={group} value={group}>{group}</option>)}
        </select>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_FILES}
        multiple
        className="hidden"
        onChange={async (event) => {
          if (event.target.files) await importFiles(event.target.files)
          event.target.value = ""
        }}
      />

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {filtered.length ? (
          <div className="grid grid-cols-3 gap-1">
            {filtered.map((asset) => (
              <button
                key={asset.id}
                type="button"
                draggable
                onDragStart={(event) => {
                  dragAssetIdRef.current = asset.id
                  event.dataTransfer.effectAllowed = "copy"
                  event.dataTransfer.setData("application/x-ps-library-asset", asset.id)
                  event.dataTransfer.setData("text/plain", asset.name)
                }}
                onDragEnd={() => { dragAssetIdRef.current = null }}
                onDoubleClick={() => placeAsset(asset)}
                onClick={() => setSelectedId(asset.id)}
                className={`group flex flex-col gap-1 rounded-sm border ${selectedId === asset.id ? "border-[var(--ps-accent,#3b82f6)]" : "border-[var(--ps-divider)]"} bg-[var(--ps-panel-2)] p-1 text-left hover:bg-[var(--ps-tool-hover)]`}
                title={`${asset.name}\nDouble-click or drag to place.`}
              >
                <div className="relative aspect-square overflow-hidden rounded-sm bg-[var(--ps-panel)]">
                  {asset.thumbnail ? (
                    <img src={asset.thumbnail} alt={asset.name} className="h-full w-full object-contain" />
                  ) : asset.kind === "color" && asset.color ? (
                    <div className="h-full w-full" style={{ background: asset.color }} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[var(--ps-text-dim)]">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="truncate text-[10px]">{asset.name}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
            {idbReady
              ? "No library assets yet. Use Import or drop image files here."
              : "IndexedDB is unavailable, so the local library is read-only."}
          </div>
        )}
      </div>

      {selected ? (
        <div className="space-y-1 border-t border-[var(--ps-divider)] p-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
            <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" /> Metadata</span>
            <button
              type="button"
              onClick={() => removeAsset(selected)}
              className="inline-flex items-center gap-1 text-[10px] text-[var(--ps-text-dim)] hover:text-red-400"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          </div>
          <Input
            value={selected.name}
            onChange={(event) => updateAsset(selected, { name: event.target.value })}
            className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
            aria-label="Asset name"
          />
          <Input
            value={selected.description ?? ""}
            placeholder="Description"
            onChange={(event) => updateAsset(selected, { description: event.target.value })}
            className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
            aria-label="Asset description"
          />
          <Input
            value={selected.group ?? ""}
            placeholder="Group"
            onChange={(event) => updateAsset(selected, { group: event.target.value || undefined })}
            className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
            aria-label="Asset group"
          />
          <Input
            value={selected.tags.join(", ")}
            placeholder="Tags (comma separated)"
            onChange={(event) => updateAsset(selected, {
              tags: parseLibraryTagInput(event.target.value),
            })}
            className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
            aria-label="Asset tags"
          />
          <div className="grid grid-cols-3 gap-1 text-[10px] text-[var(--ps-text-dim)]">
            <Metric label="Size" value={formatBytes(selected.sizeBytes)} />
            <Metric label="Pixels" value={selected.width && selected.height ? `${selected.width} x ${selected.height}` : "-"} />
            <Metric label="Created" value={formatDate(selected.createdAt)} />
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant="ghost" disabled={!activeDoc} onClick={() => placeAsset(selected)} className="h-7 justify-start gap-1 text-[11px]">
              <LayersIcon className="h-3 w-3" /> Place
            </Button>
            {selected.blob ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!selected.blob) return
                  const url = URL.createObjectURL(selected.blob)
                  try {
                    const link = document.createElement("a")
                    link.href = url
                    link.download = `${selected.name}.${selected.mimeType?.split("/")[1] ?? "bin"}`
                    document.body.appendChild(link)
                    link.click()
                    link.remove()
                  } finally {
                    setTimeout(() => URL.revokeObjectURL(url), 1000)
                  }
                }}
                className="h-7 justify-start gap-1 text-[11px]"
              >
                <Download className="h-3 w-3" /> Export
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="border-t border-[var(--ps-divider)] p-2 text-[10px] text-[var(--ps-text-dim)]">
        {status}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1">
      <div>{label}</div>
      <div className="truncate text-[var(--ps-text)]">{value}</div>
    </div>
  )
}
