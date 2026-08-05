"use client"

/**
 * Libraries tab — the document asset library: adding, previewing and placing items.
 *
 * One tab of the Advanced Subsystems dialog. The dialog itself
 * (`subsystems-dialog.tsx`) only owns the tab list and the switch that picks
 * a workspace; each workspace holds its own state and talks to the editor
 * directly, so opening the dialog does not mount the other ten.
 */

import { createLayerFromCanvas } from "@/components/photoshop/advanced/subsystems-dialog-helpers"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  CapabilityNotice,
  EmptyState,
  FileButton,
  Panel,
} from "@/components/photoshop/advanced/subsystems-dialog-controls"
import { useEditor } from "@/components/photoshop/editor/context"
import { uid } from "@/editor/uid"
import {
  ADVANCED_FILE_LIMITS,
  assertAdvancedFileSize,
  createSubsystemCanvas,
} from "@/editor/advanced/subsystems"
import { createEmbeddedFontFromBuffer, parseOpenTypeFontMetadata } from "@/editor/typography-engine"
import type { AssetLibraryItem } from "@/editor/types"
export function LibrariesWorkspace() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [stockUrl, setStockUrl] = React.useState("")
  const [fontName, setFontName] = React.useState("Activated Font")
  if (!activeDoc) return <EmptyState text="Open a document before using libraries." />
  const assets = activeDoc.assetLibrary ?? []
  const addAsset = (asset: Omit<AssetLibraryItem, "id" | "createdAt">) => {
    dispatch({ type: "set-asset-library", assets: [{ ...asset, id: uid("asset"), createdAt: Date.now() }, ...assets] })
  }
  const placeStock = async () => {
    if (!stockUrl) return
    // Restrict the URL to http/https only and bound the length so we
    // don't load javascript:, data:, file:, blob: etc. — anything other
    // than a fetched image goes nowhere useful, and unbounded URLs make
    // the address harmless to type but easy to corrupt the assetLibrary
    // entry that we autosave.
    const trimmedUrl = stockUrl.trim()
    if (trimmedUrl.length > 2048) {
      toast.error("Stock URL is too long.")
      return
    }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(trimmedUrl)
    } catch {
      toast.error("Stock URL must be a valid http(s):// URL.")
      return
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      toast.error("Stock URL must use http or https.")
      return
    }
    const safeUrl = parsedUrl.toString()
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const canvas = createSubsystemCanvas(activeDoc.width, activeDoc.height)
      canvas.getContext("2d")!.drawImage(img, 0, 0, activeDoc.width, activeDoc.height)
      dispatch({ type: "add-layer", layer: createLayerFromCanvas(activeDoc, "Stock Image", canvas) })
      window.setTimeout(() => commit("Place Stock Image", "all"), 0)
    }
    img.onerror = () => toast.error("Could not load the stock URL. Try an image URL that allows browser access.")
    img.src = safeUrl
    addAsset({ name: "Stock link", kind: "stock", group: "Adobe Stock-style Links", payload: { url: safeUrl } })
  }
  const importFont = async (file: File) => {
    const family = fontName || file.name.replace(/\.[^.]+$/, "")
    assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.fontBytes, "Font file")
    const data = await file.arrayBuffer()
    const face = new FontFace(family, data)
    await face.load()
    document.fonts.add(face)
    const embedded = createEmbeddedFontFromBuffer(family, file.name, data, file.type || "font/ttf")
    const metadata = parseOpenTypeFontMetadata(data)
    addAsset({
      name: family,
      kind: "font",
      group: "Adobe Fonts-style Local Fonts",
      payload: {
        ...embedded,
        axes: metadata.axes,
        namedInstances: metadata.namedInstances,
        featureTags: metadata.featureTags,
        unitsPerEm: metadata.unitsPerEm,
        glyphCount: metadata.glyphCount,
      },
    })
    toast.success(`Activated ${family}`)
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Local Libraries">
        <CapabilityNotice>
          Project-local library records only. No Creative Cloud sync, Adobe Stock licensing, or Adobe Fonts account integration is performed.
        </CapabilityNotice>
        <Button size="sm" onClick={() => addAsset({ name: "Project Brand Library", kind: "cloud-library", group: "Local Libraries", payload: { swatches: ["#0ea5e9", "#111827"], linked: false } })}>Create Local Library</Button>
        <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">Assets are stored in the project and appear in the Assets panel.</p>
      </Panel>
      <Panel title="Stock URL Links">
        <Input value={stockUrl} onChange={(event) => setStockUrl(event.target.value)} placeholder="https://example.com/image.jpg" className="h-8" />
        <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">Places only browser-accessible image URLs. Licensing, search, purchase, and Adobe Stock metadata are outside this app.</p>
        <Button className="mt-2" size="sm" onClick={placeStock}>Place Linked URL Image</Button>
      </Panel>
      <Panel title="Local Font Activation">
        <Input value={fontName} onChange={(event) => setFontName(event.target.value)} className="mb-2 h-8" />
        <FileButton accept=".ttf,.otf,.woff,.woff2,font/*" label="Activate Font File" onFile={importFont} />
        <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">Loads a user-provided font file into the current browser session; it does not sync with Adobe Fonts.</p>
      </Panel>
      <Panel title="Library Assets">
        <div className="max-h-80 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {assets.filter((asset) => ["cloud-library", "stock", "font"].includes(asset.kind)).map((asset) => (
            <div key={asset.id} className="grid grid-cols-[1fr_auto] border-b border-[var(--ps-divider)] p-2 text-[11px]">
              <span>{asset.name}</span>
              <span className="text-[var(--ps-text-dim)]">{asset.kind}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
