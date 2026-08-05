"use client"

/**
 * Formats tab — import/export across the codecs, high-bit output and PSB tiled views.
 *
 * One tab of the Advanced Subsystems dialog. The dialog itself
 * (`subsystems-dialog.tsx`) only owns the tab list and the switch that picks
 * a workspace; each workspace holds its own state and talks to the editor
 * directly, so opening the dialog does not mount the other ten.
 */

import {
  createLayerFromCanvas,
  imageFromDataUrl,
} from "@/components/photoshop/advanced/subsystems-dialog-helpers"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FileButton, Panel } from "@/components/photoshop/advanced/subsystems-dialog-controls"
import { useEditor, makeCanvas } from "@/components/photoshop/editor/context"
import {
  deserializePsdFile,
  downloadBlob,
  downloadText,
  inspectImportFileDimensions,
  loadRasterCanvasFromFile,
  renderDocumentComposite,
} from "@/editor/document/io"
import { assertCanvasSize } from "@/editor/canvas/limits"
import { uid } from "@/editor/uid"
import {
  ADVANCED_FILE_LIMITS,
  ADVANCED_FORMAT_CAPABILITIES,
  assertAdvancedFileSize,
  capabilityForAdvancedFormat,
  createSubsystemCanvas,
  decodeDicomPreview,
  decodeEpsPreview,
  decodePdfPages,
  decodeRadianceHdrPreview,
  encodeDicomImageData,
  encodeEpsCanvas,
  encodePdfCanvases,
  encodeRadianceHdrImageData,
  extractEmbeddedJpegDataUrl,
  extractMetadataFromFile,
  inspectAdvancedFormatFile,
  makeXmpMetadata,
} from "@/editor/advanced/subsystems"
import {
  decodeAdvancedRasterBufferAsync,
  decodedRasterToCanvas,
  encodeDngImageData,
  encodeHeifImageData,
  encodeJpeg2000ImageData,
  encodeOpenExrHighBitImage,
  encodeOpenExrImageData,
  encodeTiffHighBitImageDataAsync,
  encodeTiffImageDataAsync,
  type TiffCompression,
} from "@/editor/raster/codecs"
import { getHighBitExportImage } from "@/editor/high-bit-document"
import {
  getPsbTileViewMetadata,
  hasPsbTileViewStore,
  readPsbTileViewCanvas,
  writePsbTileViewCanvas,
} from "@/editor/psb-tile-view"
import {
  createLargeDocumentInspectionDocument,
  createTileEditDocument,
  planLargeDocumentOpen,
} from "@/editor/large-document"
import type { Layer } from "@/editor/types"
export function FormatsWorkspace() {
  const { activeDoc, dispatch, commit, createDocument } = useEditor()
  const [log, setLog] = React.useState<string[]>([])
  const [tiffCompression, setTiffCompression] = React.useState<TiffCompression>("none")
  const [tileCol, setTileCol] = React.useState(0)
  const [tileRow, setTileRow] = React.useState(0)
  const tileView = getPsbTileViewMetadata(activeDoc)
  React.useEffect(() => {
    setTileCol(0)
    setTileRow(0)
  }, [tileView?.sourceName, tileView?.tileColumns, tileView?.tileRows])
  const addCanvas = (canvas: HTMLCanvasElement, name: string) => {
    if (activeDoc) {
      dispatch({ type: "add-layer", layer: createLayerFromCanvas(activeDoc, name, canvas) })
      window.setTimeout(() => commit(`Import ${name}`, "all"), 0)
    } else {
      const docCanvas = makeCanvas(canvas.width, canvas.height)
      docCanvas.getContext("2d")!.drawImage(canvas, 0, 0)
      const layer: Layer = { id: uid("layer"), name, kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal", canvas: docCanvas }
      createDocument({
        id: uid("doc"),
        name,
        width: canvas.width,
        height: canvas.height,
        zoom: 1,
        layers: [layer],
        activeLayerId: layer.id,
        selectedLayerIds: [layer.id],
        background: "#ffffff",
        colorMode: "RGB",
        bitDepth: 8,
        selection: { bounds: null, shape: "rect" },
      }, `Import ${name}`)
    }
  }
  const inspectLargeImport = async (file: File, reason: string, notes: string[]) => {
    const dimensions = await inspectImportFileDimensions(file).catch(() => null)
    if (!dimensions) return false
    const plan = planLargeDocumentOpen({
      fileName: file.name,
      kind: dimensions.kind,
      width: dimensions.width,
      height: dimensions.height,
      tileable: dimensions.kind === "psb",
    })
    const doc = createLargeDocumentInspectionDocument({
      fileName: file.name,
      kind: dimensions.kind,
      width: dimensions.width,
      height: dimensions.height,
      reason,
      warnings: plan.warnings,
    })
    createDocument(doc, "Inspect Large Import")
    notes.push(`Opened inspection mode for ${dimensions.width}x${dimensions.height}px source`)
    setLog([...notes, ...plan.warnings])
    toast.info("Opened inspection mode")
    return true
  }
  const importAdvanced = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    const notes = [`Opened ${file.name}`]
    let canvas: HTMLCanvasElement | null = null
    try {
      assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "Advanced import file")
      if (ext === "psb") {
        const doc = await deserializePsdFile(file)
        createDocument(doc, "Open PSB")
        notes.push("Opened PSB through ag-psd Large Document mode")
        setLog(notes)
        return
      }
      const inspection = await inspectAdvancedFormatFile(file)
      const capability = capabilityForAdvancedFormat(file.name, file.type)
      notes.push(`Detected ${capability.label}: ${capability.supportLabel}`)
      const buffer = await file.arrayBuffer()
      const advancedRaster = await decodeAdvancedRasterBufferAsync(buffer, file.name, file.type)
      if (advancedRaster) {
        canvas = decodedRasterToCanvas(advancedRaster)
        notes.push(`Decoded ${advancedRaster.format}: ${advancedRaster.width}x${advancedRaster.height}, ${advancedRaster.channels} channel(s), source ${advancedRaster.bitDepth}-bit ${advancedRaster.colorModel}`)
        notes.push(...advancedRaster.warnings)
      } else if (ext === "pdf") {
        const pages = await decodePdfPages(file)
        if (pages.length) {
          canvas = pages[0].canvas
          for (const page of pages.slice(1)) addCanvas(page.canvas, `${file.name} page ${page.pageNumber}`)
          notes.push(`Rendered ${pages.length} PDF page${pages.length === 1 ? "" : "s"} into editable flattened raster layer${pages.length === 1 ? "" : "s"}`)
        } else {
          notes.push("PDF header detected; page rendering failed")
        }
      } else if (ext === "eps" || ext === "ps") {
        canvas = await decodeEpsPreview(file)
        notes.push(canvas ? "Rendered supported EPS/PostScript subset into an editable raster layer" : "EPS/PostScript metadata detected; unsupported operators prevented rendering")
      } else if (file.type.startsWith("image/")) {
        try {
          const raster = await loadRasterCanvasFromFile(file)
          canvas = raster.canvas
          notes.push(ext === "gif" ? "Browser decoded a static GIF frame; animation frames are not imported" : "Browser decoded raster image natively")
        } catch (rasterError) {
          const raster = await loadRasterCanvasFromFile(file, { mode: "reduced-scale" }).catch(() => null)
          if (raster) {
            canvas = raster.canvas
            notes.push(`Browser opened ${capability.label} at ${(raster.scale * 100).toFixed(1)}% reduced scale from ${raster.originalWidth}x${raster.originalHeight}px`)
            notes.push(...raster.warnings)
          } else {
            notes.push(`Browser could not decode ${capability.label}; ${rasterError instanceof Error ? rasterError.message : "no layer was created"}`)
          }
        }
      } else if (ext === "dcm" || ext === "dicom") {
        canvas = await decodeDicomPreview(file)
        notes.push(canvas ? "Decoded uncompressed DICOM pixel data" : "DICOM metadata detected; pixel encoding is unsupported")
      } else if (ext === "hdr" || ext === "rgbe") {
        canvas = await decodeRadianceHdrPreview(file)
        notes.push(canvas ? "Decoded Radiance HDR RGBE preview into 8-bit canvas data" : "HDR header detected; unsupported scanline encoding")
      } else if (["raw", "dng", "cr2", "nef", "arw"].includes(ext)) {
        const dataUrl = await extractEmbeddedJpegDataUrl(file)
        if (dataUrl) {
          const img = await imageFromDataUrl(dataUrl)
          const size = assertCanvasSize(img.naturalWidth, img.naturalHeight, "RAW embedded JPEG preview")
          canvas = createSubsystemCanvas(size.width, size.height)
          canvas.getContext("2d")!.drawImage(img, 0, 0)
          notes.push("Imported embedded RAW/DNG JPEG preview")
        } else {
          notes.push("RAW metadata scanned; neither LibRaw pixels nor an embedded JPEG preview were available")
        }
      }
      const extracted = await extractMetadataFromFile(file)
      if (activeDoc && Object.keys(extracted.metadata).length) dispatch({ type: "set-document-metadata", metadata: extracted.metadata })
      if (canvas) addCanvas(canvas, file.name)
      else notes.push("No pixel layer was created")
      setLog([...notes, ...inspection.technical, ...extracted.technical])
    } catch (error) {
      const message = error instanceof Error ? error.message : "Advanced import failed"
      notes.push(`Import failed: ${message}`)
      if (await inspectLargeImport(file, message, notes)) return
      setLog(notes)
      toast.error(message)
    }
  }
  const exportMetadata = () => {
    if (!activeDoc) return
    downloadText(JSON.stringify(activeDoc.metadata ?? {}, null, 2), `${activeDoc.name}-metadata.json`, "application/json")
  }
  const exportXmp = () => {
    if (!activeDoc) return
    downloadText(makeXmpMetadata(activeDoc.metadata ?? { title: activeDoc.name }), `${activeDoc.name}.xmp`, "application/rdf+xml")
  }
  const compositeImageData = () => {
    if (!activeDoc) return null
    const canvas = renderDocumentComposite(activeDoc, { transparent: true })
    return { canvas, imageData: canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height) }
  }
  const exportAdvancedRaster = async (format: "tiff" | "dng" | "exr" | "hdr" | "dicom" | "pdf" | "eps" | "heif" | "jpeg2000") => {
    if (!activeDoc) return
    try {
      const composite = compositeImageData()
      if (!composite) return
      const highBit = activeDoc.bitDepth > 8 && (format === "tiff" || format === "exr")
        ? getHighBitExportImage(activeDoc, { transparent: true })
        : null
      const base = activeDoc.name.replace(/[\\/:*?"<>|]+/g, "-") || "document"
      if (format === "tiff") {
        downloadBlob(new Blob([
          highBit
            ? await encodeTiffHighBitImageDataAsync(highBit, { compression: tiffCompression })
            : await encodeTiffImageDataAsync(composite.imageData, { compression: tiffCompression }),
        ], { type: "image/tiff" }), `${base}.tiff`)
      } else if (format === "dng") {
        downloadBlob(new Blob([encodeDngImageData(composite.imageData, {
          metadata: { title: activeDoc.name, author: activeDoc.metadata?.author, xmp: makeXmpMetadata(activeDoc.metadata ?? { title: activeDoc.name }) },
          cameraModel: activeDoc.metadata?.source || "Photoshop Web",
          uniqueCameraModel: `${activeDoc.name} browser DNG`,
          sidecar: makeXmpMetadata(activeDoc.metadata ?? { title: activeDoc.name }),
        })], { type: "image/x-adobe-dng" }), `${base}.dng`)
      } else if (format === "heif") {
        downloadBlob(new Blob([await encodeHeifImageData(composite.imageData)], { type: "image/heif" }), `${base}.heif`)
      } else if (format === "jpeg2000") {
        downloadBlob(new Blob([await encodeJpeg2000ImageData(composite.imageData, { container: "jpx", includeAlpha: true })], { type: "image/jpx" }), `${base}.jpx`)
      } else if (format === "exr") {
        downloadBlob(new Blob([
          highBit
            ? encodeOpenExrHighBitImage(highBit, { channels: "rgba", pixelType: "float" })
            : encodeOpenExrImageData(composite.imageData, { channels: "rgba", pixelType: "float" }),
        ], { type: "image/x-exr" }), `${base}.exr`)
      } else if (format === "hdr") {
        downloadBlob(new Blob([encodeRadianceHdrImageData(composite.imageData)], { type: "image/vnd.radiance" }), `${base}.hdr`)
      } else if (format === "dicom") {
        downloadBlob(new Blob([encodeDicomImageData(composite.imageData, activeDoc.name)], { type: "application/dicom" }), `${base}.dcm`)
      } else if (format === "pdf") {
        downloadBlob(new Blob([await encodePdfCanvases([composite.canvas], activeDoc.name)], { type: "application/pdf" }), `${base}.pdf`)
      } else {
        downloadBlob(new Blob([encodeEpsCanvas(composite.canvas, activeDoc.name)], { type: "application/postscript" }), `${base}.eps`)
      }
      setLog((current) => [`Exported ${format.toUpperCase()} flattened composite for ${activeDoc.name}`, ...current])
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not export ${format.toUpperCase()}`
      toast.error(message)
    }
  }
  const importPsbLargeDocument = async (file: File, mode: "downscale-50" | "tile-view") => {
    const notes = [`Opened ${file.name}`]
    try {
      assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "Advanced import file")
      const doc = await deserializePsdFile(file, { psbLargeDocumentMode: mode })
      createDocument(doc, mode === "downscale-50" ? "Open PSB 50%" : "Open PSB Tile View")
      notes.push(mode === "downscale-50"
        ? "Opened oversized PSB at 50% scale for browser-safe editing"
        : "Opened oversized PSB tile overview with full-resolution tile plan metadata")
      setLog(notes)
    } catch (error) {
      const message = error instanceof Error ? error.message : "PSB large-document import failed"
      notes.push(`Import failed: ${message}`)
      setLog(notes)
      toast.error(message)
    }
  }
  const openSelectedPsbTile = async () => {
    if (!activeDoc || !tileView) {
      toast.error("Open a PSB tile overview first")
      return
    }
    if (!hasPsbTileViewStore(activeDoc.id)) {
      toast.error("Full-resolution PSB tile cache is no longer available; reopen the PSB tile view")
      return
    }
    const col = Math.max(0, Math.min(tileView.tileColumns - 1, Math.round(tileCol)))
    const row = Math.max(0, Math.min(tileView.tileRows - 1, Math.round(tileRow)))
    const canvas = await readPsbTileViewCanvas(activeDoc.id, col, row)
    if (!canvas) {
      toast.error("Could not read that PSB tile")
      return
    }
    const tileDoc = createTileEditDocument({
      parentDocId: activeDoc.id,
      sourceName: tileView.sourceName,
      col,
      row,
      sourceX: col * tileView.tileSize,
      sourceY: row * tileView.tileSize,
      originalWidth: tileView.originalWidth,
      originalHeight: tileView.originalHeight,
      tileSize: tileView.tileSize,
      canvas,
    })
    createDocument(tileDoc, "Open PSB Tile")
    setLog([`Opened full-resolution tile ${col},${row} (${canvas.width} x ${canvas.height}px) from ${tileView.sourceName}`])
  }
  const updateActiveTileEdit = async () => {
    if (!activeDoc?.metadata?.largeDocumentTileEdit) {
      toast.error("Open a full-resolution tile before updating the tile cache")
      return
    }
    const edit = activeDoc.metadata.largeDocumentTileEdit
    const composite = renderDocumentComposite(activeDoc, { transparent: true })
    const ok = await writePsbTileViewCanvas(edit.parentDocId, edit.tile.col, edit.tile.row, composite)
    if (!ok) {
      toast.error("The tile cache is no longer available; reopen the tile-only source")
      return
    }
    setLog([`Updated source tile ${edit.tile.col},${edit.tile.row} for ${edit.sourceName}`])
    toast.success("Tile cache updated")
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Advanced Import">
        <FileButton accept="image/*,.tif,.tiff,.tga,.vda,.icb,.vst,.pbm,.pgm,.ppm,.pnm,.raw,.dng,.cr2,.nef,.arw,.dcm,.dicom,.exr,.hdr,.rgbe,.pdf,.eps,.ps,.heif,.heic,.hif,.jp2,.j2k,.jpf,.jpx,.jpm,.psb" label="Import Advanced Raster/RAW/DICOM/EXR/HDR/PDF/EPS/PSB" onFile={importAdvanced} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <FileButton accept=".psb,image/vnd.adobe.photoshop" label="Open PSB 50%" onFile={(file) => importPsbLargeDocument(file, "downscale-50")} />
          <FileButton accept=".psb,image/vnd.adobe.photoshop" label="PSB Tile View" onFile={(file) => importPsbLargeDocument(file, "tile-view")} />
        </div>
        <div className="mt-3 rounded-sm border border-[var(--ps-divider)] p-3 text-[11px] text-[var(--ps-text-dim)]">
          Imports create browser 8-bit RGBA preview layers when a decoder path is available and retain high-bit side-band sources where the importer exposes them. TIFF/BigTIFF, EXR, HEIC, JPEG 2000, RAW/DNG, DICOM, HDR, PDF, and EPS use browser-local decoders or safe preview renderers; oversized PSB files can be opened as a 50% composite or tile overview when the full canvas exceeds browser limits.
        </div>
      </Panel>
      <Panel title="PSB Tile View">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-[var(--ps-text-dim)]">
            Column
            <Input
              type="number"
              min={0}
              max={Math.max(0, (tileView?.tileColumns ?? 1) - 1)}
              value={tileCol}
              onChange={(event) => setTileCol(Number(event.target.value) || 0)}
              className="mt-1 h-8 bg-[var(--ps-panel-2)] text-[11px]"
              disabled={!tileView}
            />
          </label>
          <label className="text-[11px] text-[var(--ps-text-dim)]">
            Row
            <Input
              type="number"
              min={0}
              max={Math.max(0, (tileView?.tileRows ?? 1) - 1)}
              value={tileRow}
              onChange={(event) => setTileRow(Number(event.target.value) || 0)}
              className="mt-1 h-8 bg-[var(--ps-panel-2)] text-[11px]"
              disabled={!tileView}
            />
          </label>
        </div>
        <Button className="mt-2 w-full" size="sm" variant="secondary" disabled={!tileView} onClick={() => void openSelectedPsbTile()}>
          Open Full-Resolution Tile
        </Button>
        <Button className="mt-2 w-full" size="sm" variant="secondary" disabled={!activeDoc?.metadata?.largeDocumentTileEdit} onClick={() => void updateActiveTileEdit()}>
          Update Source Tile
        </Button>
        <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">
          {tileView
            ? `${tileView.originalWidth} x ${tileView.originalHeight}px source, ${tileView.tileColumns} x ${tileView.tileRows} tiles`
            : "Open a PSB tile overview to inspect source tiles."}
        </p>
      </Panel>
      <Panel title="Format Capability Matrix">
        <div className="overflow-hidden rounded-sm border border-[var(--ps-divider)] text-[11px]">
          {ADVANCED_FORMAT_CAPABILITIES.map((capability) => (
            <div key={capability.id} data-testid={`format-${capability.id}`} className="grid grid-cols-[86px_118px_1fr] gap-2 border-b border-[var(--ps-divider)] p-2 last:border-b-0">
              <span className="font-medium">{capability.label}</span>
              <span className="text-[var(--ps-text-dim)]">{capability.supportLabel}</span>
              <span className="text-[var(--ps-text-dim)]">{capability.layerResult}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Metadata">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={exportMetadata}>Export JSON</Button>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={exportXmp}>Export XMP</Button>
          <select
            aria-label="TIFF compression"
            value={tiffCompression}
            onChange={(event) => setTiffCompression(event.target.value as TiffCompression)}
            className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
          >
            <option value="none">TIFF none</option>
            <option value="lzw">TIFF LZW</option>
            <option value="deflate">TIFF Deflate</option>
          </select>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={() => void exportAdvancedRaster("tiff")}>Export TIFF</Button>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={() => void exportAdvancedRaster("dng")}>Export DNG</Button>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={() => void exportAdvancedRaster("heif")}>Export HEIF</Button>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={() => void exportAdvancedRaster("jpeg2000")}>Export JPX</Button>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={() => void exportAdvancedRaster("exr")}>Export EXR</Button>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={() => void exportAdvancedRaster("hdr")}>Export HDR</Button>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={() => void exportAdvancedRaster("dicom")}>Export DICOM</Button>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={() => void exportAdvancedRaster("pdf")}>Export PDF</Button>
          <Button size="sm" variant="secondary" disabled={!activeDoc} onClick={() => void exportAdvancedRaster("eps")}>Export EPS</Button>
        </div>
        <div className="mt-3 max-h-80 overflow-y-auto rounded-sm border border-[var(--ps-divider)] p-2 text-[11px]">
          {log.length ? log.map((line, index) => <div key={`${line}-${index}`}>{line}</div>) : <span className="text-[var(--ps-text-dim)]">No file analyzed yet.</span>}
        </div>
      </Panel>
    </div>
  )
}
