"use client"

import type {
ImageResources,
LayerColor,
PixelData,
Psd,
Layer as PsdLayer
} from "ag-psd"
import {
MAX_PROJECT_LAYERS,
MAX_PSD_FILE_BYTES,
MAX_RASTER_FILE_BYTES,
assertCanvasSize,
assertFileSize,
canvasSizeError
} from "./canvas-limits"
import { createHighBitImageFromImageData } from "./color-pipeline"
import {
readPsdHeaderDimensions
} from "./document-import-sniffers"
import { makeIoCanvas,renderDocumentComposite } from "./document-rendering"
import {
getHighBitExportImage,
getLayerHighBitImage
} from "./high-bit-document"
import { planLargeDocumentOpen } from "./large-document"
import { PSB_TILE_VIEW_LAYER_ID,PSB_TILE_VIEW_SOURCE_VERSION,registerPsbTileViewStore } from "./psb-tile-view"
import {
appAlphaChannelsToMarkerLayers,
appAlphaChannelsToPsd,
appClippingToPsd,
appLayerMaskToNativeMaskInput,
appLayerMaskToPsd,
appVectorMaskOnLayerToPsd,
isAlphaChannelMarkerLayer,
psdAlphaChannelsToApp,
psdLayerMaskToApp,
psdVectorMaskOnLayerToApp
} from "./psd-channels-masks"
import {
appBitDepthToPsd,
appColorModeToPsd,
applyIccProfileToPsd,
extractIccProfile,
psdBitDepthToApp,
psdColorModeData,
psdColorModeToApp
} from "./psd-color-modes"
import {
applyPsdAppPreservationPayload,
createPsdAppPreservationPayload,
createPsdNativeSourceSnapshot,
createPsdRepairPlanFromParsedPsd,
embedPsdAppPreservationInXmp,
extractPsdAppPreservationFromXmp,
restorePsdNativeSourceSnapshot,
} from "./psd-compatibility"
import {
appAdjustmentToPsdLayer,
appAdvancedBlendingToPsd,
appSmartFiltersToPsd,
layerStyleToPsdEffects,
psdEffectsToLayerStyle,
psdLayerToAppAdjustment,
psdToAppAdvancedBlending,
psdToAppSmartFilters
} from "./psd-effects-adjustments"
import {
canWriteNativeLayeredPsd,
writeNativeCompositePsd,
writeNativeLayeredPsd,
type NativeExtraChannelInput,
type NativeLayeredPsdLayerInput,
} from "./psd-native-writer"
import {
appGlobalLightToPsdResources,
appGuidesToPsd,
appLayerCompsToPsd,
appMetadataToPsdResources,
appNotesToPsd,
appPrintSettingsToPsdResources,
appResolutionToPsd,
appSlicesToPsd,
appSmartObjectToPsdLayer,
psdGlobalLightToApp,
psdGuidesToApp,
psdLayerCompsToApp,
psdMetadataToApp,
psdNotesToApp,
psdPrintSettingsToApp,
psdResolutionToApp,
psdSlicesToApp,
psdSmartObjectToAppLayer
} from "./psd-resources-metadata"
import {
appPathsToPsdResources,
appShapeToPsd,
appTextToPsd,
decodeShapeMarker,
psdResourceToAppPaths,
psdShapeToApp,
psdTextToApp,
stripMarkers
} from "./psd-vector-text"
import {
planPsbLargeDocumentOpen
} from "./raster-codecs"
import { TiledBackingStore } from "./tiled-backing-store"
import type {
Layer,
PsDocument
} from "./types"
import { uid } from "./uid"

import { MAX_LAYER_NAME_LENGTH,appBlendToPsd,assertRasterHeaderCanvasSize,canvasAtDocumentSize,cleanText,cloneIoCanvas,countPsdLayers,inspectImportFileDimensions,loadPsdCodec,parseHexColor,psdBlendToApp,validatePsdHeaderDimensions,type LoadRasterCanvasOptions,type LoadedRasterCanvas,type PsbLargeDocumentMode,type PsdDeserializeOptions } from "./document-io-shared"
import { canvasImageData } from "./document-raster-export"
function psdColorToHex(color: unknown, fallback = "#ffffff") {
  if (!color || typeof color !== "object") return fallback
  const c = color as Record<string, unknown>
  const toHex = (value: unknown) => {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 255
    return n.toString(16).padStart(2, "0")
  }
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`
}

function psdArtboardToApp(artboard: PsdLayer["artboard"] | undefined): NonNullable<Layer["artboard"]> | undefined {
  if (!artboard?.rect) return undefined
  const left = Math.round(Number(artboard.rect.left) || 0)
  const top = Math.round(Number(artboard.rect.top) || 0)
  const right = Math.round(Number(artboard.rect.right) || left)
  const bottom = Math.round(Number(artboard.rect.bottom) || top)
  return {
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
    background: psdColorToHex(artboard.color, artboard.backgroundType === 0 ? "transparent" : "#ffffff"),
  }
}

function psdPixelSourceToVideo(layer: PsdLayer): NonNullable<Layer["video"]> | undefined {
  const pixelSource = layer.pixelSource
  if (!pixelSource) return undefined
  const link = pixelSource.frameReader?.link
  const sourceName = link?.name || link?.relativePath || link?.fullPath || layer.name || "PSD video source"
  return {
    sourceName,
    durationMs: 0,
    currentTimeMs: 0,
    playbackRate: 1,
    inPointMs: 0,
    outPointMs: 0,
    keyframes: [],
  }
}

function appArtboardToPsd(layer: Layer): PsdLayer["artboard"] | undefined {
  if (!layer.artboard) return undefined
  return {
    rect: {
      top: layer.artboard.y,
      left: layer.artboard.x,
      bottom: layer.artboard.y + layer.artboard.h,
      right: layer.artboard.x + layer.artboard.w,
    },
    backgroundType: layer.artboard.background === "transparent" ? 0 : 1,
    color: parseHexColor(layer.artboard.background === "transparent" ? "#ffffff" : layer.artboard.background),
  }
}

function flattenPsdChildren(children: PsdLayer[] | undefined, docW: number, docH: number, parentId?: string) {
  const layers: Layer[] = []
  const directIds: string[] = []
  for (const child of [...(children ?? [])].reverse()) {
    if (isAlphaChannelMarkerLayer(child)) continue
    const isGroup = Array.isArray(child.children)
    if (isGroup) {
      const groupId = uid("group")
      const nested = flattenPsdChildren(child.children, docW, docH, groupId)
      layers.push(...nested.layers)
      const artboard = psdArtboardToApp(child.artboard)
      const group: Layer = {
        id: groupId,
        name: cleanText(stripMarkers(child.name ?? "") || child.name, "Group", MAX_LAYER_NAME_LENGTH),
        kind: artboard ? "artboard" : "group",
        visible: !child.hidden,
        locked: !!child.protected?.composite,
        lockTransparency: !!(child.transparencyProtected || child.protected?.transparency),
        lockDraw: !!child.protected?.composite,
        lockMove: !!child.protected?.position,
        lockAll: !!(child.protected?.composite && child.protected?.position && child.protected?.transparency),
        opacity: child.opacity ?? 1,
        blendMode: psdBlendToApp(child.blendMode),
        canvas: makeIoCanvas(docW, docH),
        childIds: nested.directIds,
        parentId,
        expanded: child.opened !== false,
        colorLabel: child.layerColor,
        artboard,
      }
      const groupAdvancedBlending = psdToAppAdvancedBlending(child)
      if (groupAdvancedBlending) group.advancedBlending = groupAdvancedBlending
      layers.push(group)
      directIds.push(groupId)
      continue
    }

    const layerId = uid("layer")
    const sourceCanvas = child.canvas
    const left = Math.round(child.left ?? 0)
    const top = Math.round(child.top ?? 0)

    const adjustment = psdLayerToAppAdjustment(child)
    const shape = adjustment ? null : psdShapeToApp(child) ?? decodeShapeMarker(child.name ?? "")
    const text = adjustment || shape ? null : (child.text ? psdTextToApp(child.text, left, top) : null)

    const maskInfo = child.mask ? psdLayerMaskToApp(child.mask, docW, docH) : null
    const vectorMaskPath = child.vectorMask ? psdVectorMaskOnLayerToApp(child.vectorMask) : null
    const artboard = psdArtboardToApp(child.artboard)
    const video = psdPixelSourceToVideo(child)
    const layerKind: Layer["kind"] = artboard
      ? "artboard"
      : video
        ? "video"
        : adjustment
          ? "adjustment"
          : shape
            ? "shape"
            : text
              ? "text"
              : vectorMaskPath
                ? "shape"
                : "raster"

    const layer: Layer = {
      id: layerId,
      name: cleanText(stripMarkers(child.name ?? "") || child.name, "Layer", MAX_LAYER_NAME_LENGTH),
      kind: layerKind,
      visible: !child.hidden,
      locked: !!child.protected?.composite,
      lockTransparency: !!(child.transparencyProtected || child.protected?.transparency),
      lockDraw: !!child.protected?.composite,
      lockMove: !!child.protected?.position,
      lockAll: !!(child.protected?.composite && child.protected?.position && child.protected?.transparency),
      opacity: child.opacity ?? 1,
      blendMode: psdBlendToApp(child.blendMode),
      linkGroupId: child.linkGroup ? String(child.linkGroup) : undefined,
      canvas: canvasAtDocumentSize(sourceCanvas, docW, docH, left, top),
      mask: maskInfo?.mask ?? null,
      clipped: child.clipping,
      parentId,
      text: text ?? undefined,
      shape: shape ?? undefined,
      vectorMask: vectorMaskPath ?? undefined,
      adjustment: adjustment ?? undefined,
      artboard,
      video,
      style: psdEffectsToLayerStyle(child.effects),
      colorLabel: child.layerColor,
    }
    if (maskInfo && !maskInfo.maskEnabled) layer.maskEnabled = false
    const advancedBlending = psdToAppAdvancedBlending(child)
    if (advancedBlending) layer.advancedBlending = advancedBlending
    const smartFilters = psdToAppSmartFilters(child)
    if (smartFilters && smartFilters.length) layer.smartFilters = smartFilters
    layers.push(layer)
    directIds.push(layerId)
  }
  return { layers, directIds }
}

export async function deserializePsdFile(file: File, options: PsdDeserializeOptions = {}): Promise<PsDocument> {
  assertFileSize(file, MAX_PSD_FILE_BYTES, "PSD file")
  const buffer = await file.arrayBuffer()
  const header = readPsdHeaderDimensions(buffer)
  if (
    header &&
    canvasSizeError(header.width || 1, header.height || 1, "PSD canvas") &&
    options.psbLargeDocumentMode &&
    options.psbLargeDocumentMode !== "full"
  ) {
    return deserializeOversizedPsb(buffer, file, options.psbLargeDocumentMode)
  }
  validatePsdHeaderDimensions(buffer, file.name)
  const { readPsd } = await loadPsdCodec()
  const metadata = readPsd(buffer, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
    useImageData: false,
  })
  const { width, height } = assertCanvasSize(Math.round(metadata.width || 1), Math.round(metadata.height || 1), "PSD canvas")
  if (countPsdLayers(metadata.children) > MAX_PROJECT_LAYERS) {
    throw new Error(`PSD contains too many layers. Maximum supported layers: ${MAX_PROJECT_LAYERS}.`)
  }
  const psd = readPsd(buffer, {
    skipLayerImageData: false,
    skipCompositeImageData: false,
    skipThumbnail: true,
    useImageData: false,
  })
  const repairPlan = createPsdRepairPlanFromParsedPsd(psd)
  const appPreservationPayload = extractPsdAppPreservationFromXmp(psd.imageResources?.xmpMetadata)
  const flattened = flattenPsdChildren(psd.children, width, height)
  const layers = flattened.layers.length
    ? flattened.layers
    : [{
        id: uid("layer"),
        name: "Background",
        kind: "raster" as const,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal" as const,
        canvas: canvasAtDocumentSize(psd.canvas, width, height),
      }]

  // Async smart-object decoding pass — read any embedded linked-file
  // PNG bytes back into HTMLCanvasElement sources.
  const linkedFilesById = new Map<string, NonNullable<Psd["linkedFiles"]>[number]>()
  for (const linked of (psd as Psd & { linkedFiles?: NonNullable<Psd["linkedFiles"]> }).linkedFiles ?? []) {
    if (linked?.id) linkedFilesById.set(linked.id, linked)
  }
  const layerNodes = collectPsdLayerNodes(psd.children)
  for (const layer of layers) {
    if (layer.kind !== "smart-object" && layer.kind !== "raster") continue
    const node = layerNodes.shift()
    if (!node) break
    if (!(node as PsdLayer & { placedLayer?: unknown }).placedLayer) continue
    const smartSource = await psdSmartObjectToAppLayer(node, width, height, linkedFilesById)
    if (smartSource) {
      layer.smartSource = smartSource
      layer.smartObject = true
      layer.kind = "smart-object"
    }
  }

  const colorModeData = psdColorModeData(psd)
  const colorModeResult = psdColorModeToApp(psd.colorMode ?? 3, colorModeData ?? undefined)
  const bitDepth = psdBitDepthToApp(
    psd.bitsPerChannel as 1 | 8 | 16 | 32 | undefined,
    psd.colorMode ?? 3,
  )
  const iccExtraction = extractIccProfile(psd)
  const docMetadata = psdMetadataToApp(psd)
  const docGuides = psdGuidesToApp(psd.imageResources?.gridAndGuidesInformation?.guides)
  const docSlices = psdSlicesToApp(
    (psd.imageResources as ImageResources & { slices?: unknown })?.slices as
      | Parameters<typeof psdSlicesToApp>[0]
      | undefined,
  )
  const docComps = psdLayerCompsToApp(
    psd.imageResources?.layerComps as Parameters<typeof psdLayerCompsToApp>[0],
    layers,
  )
  const docNotes = psdNotesToApp(psd)
  const docPrint = psdPrintSettingsToApp(psd)
  const docGlobalLight = psdGlobalLightToApp(psd) ?? { angle: 120, altitude: 30 }
  const docDpi = psdResolutionToApp(psd.imageResources?.resolutionInfo)
  const alphaChannels = await psdAlphaChannelsToApp(psd, width, height)
  const storedPaths = psdResourceToAppPaths(psd)
  const nativeSourceSnapshot = createPsdNativeSourceSnapshot(buffer, file.name, {
    format: header?.version === 2 ? "psb" : "psd",
    width,
    height,
    colorMode: colorModeResult.colorMode,
    bitDepth,
  })
  const mergedMetadata = hasMeaningfulMetadata(docMetadata) || nativeSourceSnapshot
    ? {
        ...(hasMeaningfulMetadata(docMetadata) ? docMetadata : {}),
        ...(nativeSourceSnapshot ? { psdNativeSource: nativeSourceSnapshot } : {}),
      }
    : undefined

  const activeLayerId = [...layers].reverse().find((layer) => layer.kind !== "group")?.id ?? layers[layers.length - 1].id
  const doc: PsDocument = {
    id: uid("doc"),
    name: file.name.replace(/\.(?:psd|psb)$/i, ""),
    width,
    height,
    zoom: 1,
    layers,
    activeLayerId,
    selectedLayerIds: [activeLayerId],
    background: "#ffffff",
    colorMode: colorModeResult.colorMode,
    modeSettings: colorModeResult.modeSettings,
    bitDepth,
    selection: { bounds: null, shape: "rect" },
    rotation: 0,
    guides: docGuides,
    showGrid: false,
    showSmartGuides: true,
    gridSize: 50,
    snap: true,
    snapToGrid: false,
    snapToGuides: true,
    quickMask: false,
    quickMaskCanvas: null,
    rulerUnits: "px",
    rulerOrigin: { x: 0, y: 0 },
    gridColor: "#78b4ff",
    gridSubdivisions: 1,
    gridOpacity: 0.42,
    showPixelGrid: false,
    slices: docSlices,
    globalLight: docGlobalLight,
    notes: docNotes.length ? docNotes : undefined,
    channels: alphaChannels.length ? alphaChannels : undefined,
    comps: docComps.length ? docComps : undefined,
    metadata: mergedMetadata,
    printSettings: docPrint,
    dpi: docDpi,
  }
  if (iccExtraction) {
    const profileName = iccExtraction.profileName
    const isCmyk = doc.colorMode === "CMYK"
    const isGray = doc.colorMode === "Grayscale"
    const assignedProfile = mapIccNameToAssignedProfileLoose(profileName, doc.colorMode)
    type ColorMgmt = NonNullable<PsDocument["colorManagement"]>
    const workingSpace: ColorMgmt["workingSpace"] = isCmyk
      ? "Working CMYK"
      : assignedProfile === "Working CMYK" || assignedProfile === "Dot Gain 20%" || assignedProfile === "Gray Gamma 2.2"
        ? "sRGB IEC61966-2.1"
        : (assignedProfile as ColorMgmt["workingSpace"])
    doc.colorManagement = {
      assignedProfile,
      workingSpace,
      renderingIntent: "perceptual",
      blackPointCompensation: true,
      proofProfile: isCmyk ? "Working CMYK" : isGray ? "Dot Gain 20%" : "None",
      proofColors: false,
      gamutWarning: false,
    } satisfies ColorMgmt
  }
  if (repairPlan.actions.length) {
    doc.metadata = {
      ...(doc.metadata ?? {}),
      psdRepairPlan: {
        summary: repairPlan.summary,
        actions: repairPlan.actions.map((action) => ({
          label: action.label,
          status: action.status,
          localRepresentation: action.localRepresentation,
          detail: action.detail,
        })),
      },
    }
  }
  if (appPreservationPayload) {
    await applyPsdAppPreservationPayload(doc, appPreservationPayload)
  }
  if (storedPaths.length) {
    const pathLayers = storedPaths.map((entry) => ({
      id: uid("path"),
      name: entry.name,
      kind: "shape" as const,
      visible: false,
      locked: false,
      opacity: 1,
      blendMode: "normal" as const,
      canvas: makeIoCanvas(width, height),
      path: entry.path,
    }))
    // Stored document paths are surfaced as hidden shape layers so the
    // app's Paths panel can re-attach them; mirroring Photoshop's "Paths"
    // resource into editable surfaces.
    doc.layers = [...pathLayers, ...doc.layers]
  }
  return doc
}

function collectPsdLayerNodes(children: PsdLayer[] | undefined): PsdLayer[] {
  const out: PsdLayer[] = []
  const walk = (list: PsdLayer[] | undefined) => {
    for (const child of (list ?? [])) {
      if (Array.isArray(child.children)) walk(child.children)
      else out.push(child)
    }
  }
  walk(children)
  return out
}

function pixelDataToScaledCanvas(pixelData: PixelData | undefined, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const canvas = makeIoCanvas(targetWidth, targetHeight)
  if (!pixelData?.data) return canvas
  const target = new ImageData(targetWidth, targetHeight)
  const source = pixelData.data
  const channels = Math.max(1, Math.floor(source.length / Math.max(1, sourceWidth * sourceHeight)))
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(sourceHeight - 1, Math.floor((y / targetHeight) * sourceHeight))
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(sourceWidth - 1, Math.floor((x / targetWidth) * sourceWidth))
      const src = (sy * sourceWidth + sx) * channels
      const dst = (y * targetWidth + x) * 4
      target.data[dst] = Number(source[src] ?? 0)
      target.data[dst + 1] = Number(source[src + 1] ?? source[src] ?? 0)
      target.data[dst + 2] = Number(source[src + 2] ?? source[src] ?? 0)
      target.data[dst + 3] = channels >= 4 ? Number(source[src + 3] ?? 255) : 255
    }
  }
  canvas.getContext("2d")!.putImageData(target, 0, 0)
  return canvas
}

function pixelDataToTileCanvas(pixelData: PixelData | undefined, sourceWidth: number, sourceHeight: number, x0: number, y0: number, tileWidth: number, tileHeight: number) {
  const canvas = makeIoCanvas(tileWidth, tileHeight)
  if (!pixelData?.data) return canvas
  const tile = new ImageData(tileWidth, tileHeight)
  const source = pixelData.data
  const channels = Math.max(1, Math.floor(source.length / Math.max(1, sourceWidth * sourceHeight)))
  for (let y = 0; y < tileHeight; y++) {
    const sy = y0 + y
    for (let x = 0; x < tileWidth; x++) {
      const sx = x0 + x
      const src = (sy * sourceWidth + sx) * channels
      const dst = (y * tileWidth + x) * 4
      tile.data[dst] = Number(source[src] ?? 0)
      tile.data[dst + 1] = Number(source[src + 1] ?? source[src] ?? 0)
      tile.data[dst + 2] = Number(source[src + 2] ?? source[src] ?? 0)
      tile.data[dst + 3] = channels >= 4 ? Number(source[src + 3] ?? 255) : 255
    }
  }
  canvas.getContext("2d")!.putImageData(tile, 0, 0)
  return canvas
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("Could not encode PSB tile"))
    }, "image/png")
  })
}

async function registerPsbCompositeTiles(docId: string, pixelData: PixelData | undefined, sourceWidth: number, sourceHeight: number, plan: ReturnType<typeof planPsbLargeDocumentOpen>) {
  if (!pixelData?.data) return
  const store = new TiledBackingStore({
    width: sourceWidth,
    height: sourceHeight,
    tileSize: plan.tileView.tileSize,
    memoryBudgetMB: 256,
    scratchNamespace: docId,
  })
  for (let row = 0; row < plan.tileView.tileRows; row++) {
    for (let col = 0; col < plan.tileView.tileColumns; col++) {
      const x = col * plan.tileView.tileSize
      const y = row * plan.tileView.tileSize
      const w = Math.min(plan.tileView.tileSize, sourceWidth - x)
      const h = Math.min(plan.tileView.tileSize, sourceHeight - y)
      const tile = pixelDataToTileCanvas(pixelData, sourceWidth, sourceHeight, x, y, w, h)
      await store.writeLayerTile({
        layerId: PSB_TILE_VIEW_LAYER_ID,
        layerKind: "raster",
        sourceVersion: PSB_TILE_VIEW_SOURCE_VERSION,
        col,
        row,
      }, await canvasToPngBlob(tile))
    }
  }
  registerPsbTileViewStore(docId, store)
}

async function deserializeOversizedPsb(buffer: ArrayBuffer, file: File, mode: Exclude<PsbLargeDocumentMode, "full">): Promise<PsDocument> {
  const header = readPsdHeaderDimensions(buffer)
  if (!header) throw new Error("Photoshop document header could not be read")
  const plan = planPsbLargeDocumentOpen({ width: header.width, height: header.height, fileName: file.name })
  const reducedPlan = planLargeDocumentOpen({
    fileName: file.name,
    kind: header.version === 2 ? "psb" : "psd",
    width: header.width,
    height: header.height,
  })
  const scale = mode === "downscale-50"
    ? 0.5
    : mode === "reduced-scale"
      ? reducedPlan.reducedScale.scale
      : plan.tileView.overviewScale
  const width = mode === "downscale-50"
    ? plan.downscale50.width
    : mode === "reduced-scale"
      ? reducedPlan.reducedScale.width
      : plan.tileView.overviewWidth
  const height = mode === "downscale-50"
    ? plan.downscale50.height
    : mode === "reduced-scale"
      ? reducedPlan.reducedScale.height
      : plan.tileView.overviewHeight
  const sizeError = canvasSizeError(width, height, mode === "tile-view" ? "PSB tile overview" : "Reduced PSB canvas")
  if (sizeError) throw new Error(sizeError)
  const { readPsd } = await loadPsdCodec()
  const psd = readPsd(buffer, {
    skipLayerImageData: true,
    skipCompositeImageData: false,
    skipThumbnail: true,
    useImageData: true,
  }) as Psd
  const canvas = pixelDataToScaledCanvas(psd.imageData, header.width, header.height, width, height)
  const docId = uid("doc")
  const layer: Layer = {
    id: uid("layer"),
    name: mode === "tile-view" ? "Tile overview" : mode === "downscale-50" ? "50% composite" : "Reduced composite",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
    metadata: {
      description: `Source: ${file.name}`,
      tags: [header.version === 2 ? "psb" : "psd", mode],
      custom: {
        originalWidth: header.width,
        originalHeight: header.height,
        overviewScale: scale,
        tileSize: plan.tileView.tileSize,
        tileColumns: plan.tileView.tileColumns,
        tileRows: plan.tileView.tileRows,
      },
    },
  }
  if (mode === "tile-view") await registerPsbCompositeTiles(docId, psd.imageData, header.width, header.height, plan)
  return {
    id: docId,
    name: file.name.replace(/\.(?:psd|psb)$/i, mode === "tile-view" ? " (Tile Overview)" : mode === "downscale-50" ? " (50%)" : " (Reduced)"),
    width,
    height,
    zoom: 1,
    layers: [layer],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    metadata: {
      title: file.name,
      description: mode !== "tile-view"
        ? `Opened oversized Photoshop document at ${(scale * 100).toFixed(1)}% scale from ${header.width} x ${header.height} px.`
        : `Opened oversized Photoshop document tile overview from ${header.width} x ${header.height} px using ${plan.tileView.tileColumns} x ${plan.tileView.tileRows} tiles.`,
      source: file.name,
      createdAt: new Date().toISOString(),
      largeDocumentTileView: mode === "tile-view" ? {
        mode: "psb-tile-view",
        sourceName: file.name,
        originalWidth: header.width,
        originalHeight: header.height,
        overviewScale: plan.tileView.overviewScale,
        tileSize: plan.tileView.tileSize,
        tileColumns: plan.tileView.tileColumns,
        tileRows: plan.tileView.tileRows,
        tileCount: plan.tileView.tileCount,
        selectedTile: { col: 0, row: 0 },
      } : undefined,
    },
  }
}

type AssignedProfile = NonNullable<PsDocument["colorManagement"]>["assignedProfile"]

function mapIccNameToAssignedProfileLoose(
  raw: string | undefined,
  colorMode: PsDocument["colorMode"],
): AssignedProfile {
  if (raw) {
    const lower = raw.toLowerCase()
    if (lower.includes("display p3") || lower.includes("displayp3")) return "Display P3"
    if (lower.includes("prophoto") || lower.includes("pro photo")) return "ProPhoto RGB"
    if (lower.includes("adobe rgb") || lower.includes("adobergb")) return "Adobe RGB (1998)"
    if (lower.includes("srgb")) return "sRGB IEC61966-2.1"
    if (lower.includes("dot gain") || lower.includes("dotgain")) return "Dot Gain 20%"
    if (lower.includes("gray gamma") || lower.includes("graygamma")) return "Gray Gamma 2.2"
    if (lower.includes("cmyk") || lower.includes("swop") || lower.includes("coated")) return "Working CMYK"
  }
  if (colorMode === "CMYK") return "Working CMYK"
  if (colorMode === "Grayscale") return "Dot Gain 20%"
  return "sRGB IEC61966-2.1"
}

function hasMeaningfulMetadata(m: ReturnType<typeof psdMetadataToApp>): boolean {
  if (!m) return false
  const fields: Array<keyof typeof m> = [
    "title",
    "author",
    "description",
    "copyright",
    "credit",
    "source",
    "createdAt",
    "modifiedAt",
  ]
  if (fields.some((f) => typeof m[f] === "string" && (m[f] as string).length > 0)) return true
  if (Array.isArray(m.keywords) && m.keywords.length > 0) return true
  return false
}

function psdChildrenFromLayers(
  doc: PsDocument,
  parentId?: string,
  linkedFiles?: NonNullable<Psd["linkedFiles"]>,
): PsdLayer[] {
  const direct = doc.layers.filter((layer) => layer.parentId === parentId)
  return [...direct].reverse().map((layer): PsdLayer => {
    const protectedState = {
      transparency: !!layer.lockTransparency,
      composite: !!(layer.lockDraw || layer.lockAll || layer.locked),
      position: !!(layer.lockMove || layer.lockAll),
    }
    const adjustmentExtras = layer.kind === "adjustment" ? appAdjustmentToPsdLayer(layer) : {}
    const advancedBlendExtras = appAdvancedBlendingToPsd(layer)
    const clippingExtras = appClippingToPsd(layer)
    const smartObjectExtras = layer.kind === "smart-object" && layer.smartSource
      ? appSmartObjectToPsdLayer(layer)
      : null
    const smartFilterExtras = appSmartFiltersToPsd(
      layer,
      (source) => cloneIoCanvas(source) ?? source,
    )

    const layerName = (adjustmentExtras as { name?: string }).name ?? layer.name
    const groupLike = layer.kind === "group" || layer.kind === "artboard"
    const base: PsdLayer = {
      name: layerName,
      hidden: !layer.visible,
      opacity: layer.opacity,
      blendMode: appBlendToPsd(groupLike ? "normal" : layer.blendMode),
      layerColor: (layer.colorLabel ?? "none") as LayerColor,
      transparencyProtected: !!layer.lockTransparency,
      protected: protectedState,
      clipping: clippingExtras.clipping,
      linkGroup: layer.linkGroupId ? Number.parseInt(layer.linkGroupId, 10) || undefined : undefined,
      effects: layerStyleToPsdEffects(layer.style, doc.globalLight),
    }
    if (groupLike) {
      return {
        ...base,
        ...advancedBlendExtras,
        artboard: appArtboardToPsd(layer),
        opened: layer.expanded !== false,
        children: psdChildrenFromLayers(doc, layer.id, linkedFiles),
      }
    }

    const sourceCanvas =
      (smartFilterExtras?.rastered as HTMLCanvasElement | undefined) ?? layer.canvas
    const baseCanvas = cloneIoCanvas(sourceCanvas) ?? makeIoCanvas(doc.width, doc.height)
    const mask = appLayerMaskToPsd(layer, doc.width, doc.height)
    const vectorMask = layer.vectorMask
      ? appVectorMaskOnLayerToPsd(layer.vectorMask, doc.width, doc.height)
      : undefined
    const textPayload = layer.text ? appTextToPsd(layer.text, 0, 0) : null
    const shapePayload = layer.shape ? appShapeToPsd(layer.shape, doc.width, doc.height) : null
    const additionalLayerInfo: Record<string, unknown> = {
      ...(smartFilterExtras?.additionalInfo ?? {}),
    }
    const out: PsdLayer = {
      ...base,
      ...advancedBlendExtras,
      ...adjustmentExtras,
      ...(textPayload ?? {}),
      top: 0,
      left: 0,
      bottom: doc.height,
      right: doc.width,
      canvas: baseCanvas,
      mask,
    }
    if (vectorMask) (out as PsdLayer).vectorMask = vectorMask
    else if (shapePayload?.vectorMask) (out as PsdLayer).vectorMask = shapePayload.vectorMask
    if (shapePayload?.vectorStroke) {
      (out as PsdLayer).vectorStroke = shapePayload.vectorStroke
    }
    if (shapePayload?.vectorFill) {
      ;(out as PsdLayer & { vectorFill?: unknown }).vectorFill = shapePayload.vectorFill
    }
    if (shapePayload?.markerName) out.name = shapePayload.markerName
    if (smartObjectExtras?.placedLayer) {
      ;(out as PsdLayer & { placedLayer?: unknown }).placedLayer = smartObjectExtras.placedLayer
    }
    if (smartObjectExtras?.linkedFile) linkedFiles?.push(smartObjectExtras.linkedFile)
    if (smartFilterExtras?.nativeFilter) {
      const placed = (out as PsdLayer & { placedLayer?: { filter?: unknown } }).placedLayer
      if (placed) placed.filter = smartFilterExtras.nativeFilter
    }
    if (smartFilterExtras?.filterEffectsMasks) {
      ;(out as PsdLayer).filterEffectsMasks = smartFilterExtras.filterEffectsMasks
    }
    if (Object.keys(additionalLayerInfo).length) {
      ;(out as PsdLayer & { additionalLayerInfo?: Record<string, unknown> }).additionalLayerInfo = additionalLayerInfo
    }
    return out
  })
}

export interface PsdSerializeOptions {
  psb?: boolean
  preserveNativeSource?: boolean
}

function canvasForNativeLayer(doc: PsDocument, layer: Layer): HTMLCanvasElement {
  if (layer.canvas?.width === doc.width && layer.canvas.height === doc.height) return layer.canvas
  const canvas = makeIoCanvas(doc.width, doc.height)
  const ctx = canvas.getContext("2d")
  if (ctx && layer.canvas) {
    ctx.drawImage(layer.canvas, 0, 0)
  }
  return canvas
}

function nativeLayerImageInput(
  doc: PsDocument,
  layer: Layer,
  bitDepth: 1 | 8 | 16 | 32,
): NativeLayeredPsdLayerInput | null {
  if (layer.kind === "group") return null
  const source = getLayerHighBitImage(layer, doc)
  const image = source && source.width === doc.width && source.height === doc.height
    ? source
    : createHighBitImageFromImageData(
        canvasImageData(canvasForNativeLayer(doc, layer)),
        {
          bitDepth: bitDepth === 1 ? 8 : bitDepth,
          colorMode: doc.colorMode,
          profile: doc.colorManagement?.assignedProfile,
        },
      )
  return {
    name: layer.name.slice(0, MAX_LAYER_NAME_LENGTH),
    image,
    blendMode: layer.blendMode,
    opacity: layer.opacity,
    hidden: !layer.visible,
    hasHighBitSource: !!source,
    mask: appLayerMaskToNativeMaskInput(layer),
    clipping: !!layer.clipped,
    transparencyProtected: !!layer.lockTransparency,
  }
}

const NATIVE_GROUP_DIVIDER_NAME = "</Layer group>"

/**
 * Convert the document's saved alpha/spot channels into native extra
 * composite channels for the native PSD writer (8-bit luminance planes at
 * document size plus display metadata).
 */
function nativeExtraChannelsFromDocument(doc: PsDocument): NativeExtraChannelInput[] {
  const { displayInfo } = appAlphaChannelsToPsd(doc)
  const channels = doc.channels ?? []
  if (!displayInfo || !channels.length) return []
  const out: NativeExtraChannelInput[] = []
  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i]
    const info = displayInfo[i]
    if (!channel?.canvas || typeof channel.canvas.getContext !== "function" || !info) continue
    const surface = makeIoCanvas(doc.width, doc.height)
    const ctx = surface.getContext("2d")
    if (!ctx) continue
    ctx.drawImage(channel.canvas, 0, 0)
    const image = ctx.getImageData(0, 0, doc.width, doc.height)
    const plane = new Uint8Array(doc.width * doc.height)
    for (let p = 0; p < plane.length; p++) {
      const o = p * 4
      plane[p] = Math.max(
        0,
        Math.min(255, Math.round((image.data[o] + image.data[o + 1] + image.data[o + 2]) / 3)),
      )
    }
    out.push({
      name: info.name,
      kind: info.kind,
      color: info.color,
      opacity: info.opacity,
      data: plane,
    })
  }
  return out
}

/**
 * Walk the document's layer tree (flat array linked by `parentId`) into the
 * bottom-most-first entry list the native writer expects, preserving group
 * hierarchy through folder/divider section records.
 */
function nativeLayerEntriesFromDocument(
  doc: PsDocument,
  bitDepth: 1 | 8 | 16 | 32,
): NativeLayeredPsdLayerInput[] {
  const walk = (parentId: string | undefined): NativeLayeredPsdLayerInput[] => {
    const direct = doc.layers.filter((layer) => layer.parentId === parentId)
    const out: NativeLayeredPsdLayerInput[] = []
    // doc.layers is top-most-first within each parent; PSD wants bottom-first.
    for (const layer of [...direct].reverse()) {
      if (layer.kind === "group" || layer.kind === "artboard") {
        out.push({
          name: NATIVE_GROUP_DIVIDER_NAME,
          section: "divider",
          hidden: true,
        })
        out.push(...walk(layer.id))
        out.push({
          name: layer.name.slice(0, MAX_LAYER_NAME_LENGTH),
          section: layer.expanded === false ? "closed" : "open",
          blendMode: layer.blendMode,
          opacity: layer.opacity,
          hidden: !layer.visible,
          mask: appLayerMaskToNativeMaskInput(layer),
        })
        continue
      }
      const input = nativeLayerImageInput(doc, layer, bitDepth)
      if (input) out.push(input)
    }
    return out
  }
  return walk(undefined)
}

export async function serializePsd(doc: PsDocument, options: PsdSerializeOptions = {}): Promise<Blob> {
  if (options.preserveNativeSource) {
    const sourceBytes = restorePsdNativeSourceSnapshot(doc.metadata?.psdNativeSource)
    if (sourceBytes) return new Blob([sourceBytes], { type: "image/vnd.adobe.photoshop" })
  }

  const colorModeExport = appColorModeToPsd(doc)
  const bitsPerChannel = appBitDepthToPsd(doc)
  const linkedFiles: NonNullable<Psd["linkedFiles"]> = []
  const children = psdChildrenFromLayers(doc, undefined, linkedFiles)

  // Prepend the saved-alpha-channel marker group so per-channel pixel
  // data survives a vanilla ag-psd write/read cycle (ag-psd does not
  // expose `Psd.channels` as a pixel array).
  const alphaMarkerGroup = appAlphaChannelsToMarkerLayers(doc)
  if (alphaMarkerGroup) children.unshift(alphaMarkerGroup)

  const alphaChannelInfo = appAlphaChannelsToPsd(doc)
  const guides = appGuidesToPsd(doc.guides)
  const slices = appSlicesToPsd(doc.slices, doc.width, doc.height)
  const layerComps = appLayerCompsToPsd(doc.comps)
  const metadataResources = appMetadataToPsdResources(doc.metadata)
  const appPreservation = createPsdAppPreservationPayload(doc)
  const xmpMetadata = appPreservation.layers.length
    ? embedPsdAppPreservationInXmp(metadataResources.xmpMetadata, appPreservation)
    : metadataResources.xmpMetadata
  const printResources = appPrintSettingsToPsdResources(doc.printSettings)
  const resolutionInfo = appResolutionToPsd(doc)
  const globalLightResources = appGlobalLightToPsdResources(doc.globalLight)
  const annotations = appNotesToPsd(doc.notes)
  const documentPathResources = appPathsToPsdResources(doc.layers)

  const imageResources: ImageResources = {
    resolutionInfo,
    ...(guides && guides.length ? { gridAndGuidesInformation: { guides } } : {}),
    ...(alphaChannelInfo.channelNames?.length
      ? { alphaChannelNames: alphaChannelInfo.channelNames }
      : {}),
    ...(xmpMetadata ? { xmpMetadata } : {}),
    ...(globalLightResources ?? {}),
    ...(printResources ?? {}),
    ...(slices ? { slices } : {}),
    ...(layerComps ? { layerComps } : {}),
  }

  // Document path resources are encoded as a marker token attached to the
  // PSD's top-level name (see psdResourceToAppPaths). ag-psd doesn't expose
  // 0x07D0+ path image resources directly through `imageResources`.
  const pathMarkerName = documentPathResources?.markerName

  if (bitsPerChannel !== 8 || doc.colorMode !== "RGB") {
    const highBit = getHighBitExportImage(doc, { transparent: true })
    const composite = highBit
      ? highBit
      : createHighBitImageFromImageData(
          canvasImageData(renderDocumentComposite(doc, { transparent: true })),
          {
            bitDepth: bitsPerChannel === 1 ? 8 : bitsPerChannel,
            colorMode: doc.colorMode,
            profile: doc.colorManagement?.assignedProfile,
          },
        )
    if (canWriteNativeLayeredPsd(doc)) {
      const nativeLayers = nativeLayerEntriesFromDocument(doc, bitsPerChannel)
      if (nativeLayers.length) {
        const buffer = await writeNativeLayeredPsd(doc, {
          psb: options.psb,
          xmpMetadata,
          colorModeData: colorModeExport.colorModeData,
          composite,
          layers: nativeLayers,
          extraChannels: nativeExtraChannelsFromDocument(doc),
        })
        return new Blob([buffer], { type: "image/vnd.adobe.photoshop" })
      }
    }
    const buffer = writeNativeCompositePsd(doc, composite, {
      psb: options.psb,
      xmpMetadata,
      colorModeData: colorModeExport.colorModeData,
    })
    return new Blob([buffer], { type: "image/vnd.adobe.photoshop" })
  }

  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    channels: 4,
    bitsPerChannel,
    colorMode: colorModeExport.colorMode,
    canvas: renderDocumentComposite(doc, { transparent: true }),
    children,
    imageResources,
    ...(linkedFiles.length ? { linkedFiles } : {}),
    ...(annotations.length ? { annotations } : {}),
    ...(pathMarkerName ? { name: pathMarkerName } : {}),
  }

  if (colorModeExport.palette) {
    ;(psd as Psd & { palette?: unknown }).palette = colorModeExport.palette
  }

  // Apply ICC profile bytes into the imageResources (or stash as side-band
  // metadata when ag-psd's writer can't emit the iccProfile field).
  applyIccProfileToPsd(doc, psd)

  const { writePsd } = await loadPsdCodec()
  const buffer = writePsd(psd, {
    generateThumbnail: false,
    noBackground: true,
    trimImageData: true,
    psb: options.psb,
  })
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" })
}

export async function serializePsb(doc: PsDocument): Promise<Blob> {
  return serializePsd(doc, { psb: true })
}

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  assertFileSize(file, MAX_RASTER_FILE_BYTES, "Image file")
  await assertRasterHeaderCanvasSize(file)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        assertCanvasSize(img.naturalWidth, img.naturalHeight, "Image canvas")
        resolve(img)
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not load ${file.name}`))
    }
    img.src = url
  })
}

export async function loadRasterCanvasFromFile(file: File, options: LoadRasterCanvasOptions = {}): Promise<LoadedRasterCanvas> {
  assertFileSize(file, MAX_RASTER_FILE_BYTES, "Image file")
  const mode = options.mode ?? "full"
  const header = await inspectImportFileDimensions(file)
  if (mode === "full" && header?.kind === "raster") {
    assertCanvasSize(header.width, header.height, "Image canvas")
  }

  return new Promise<LoadedRasterCanvas>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const originalWidth = Math.max(1, Math.round(img.naturalWidth || header?.width || 1))
        const originalHeight = Math.max(1, Math.round(img.naturalHeight || header?.height || 1))
        const fullError = canvasSizeError(originalWidth, originalHeight, "Image canvas")
        const plan = planLargeDocumentOpen({
          fileName: file.name,
          kind: "raster",
          width: originalWidth,
          height: originalHeight,
          memoryBudgetMB: options.memoryBudgetMB,
          tileable: false,
        })

        if (mode === "full") {
          if (fullError) throw new Error(fullError)
          const canvas = makeIoCanvas(originalWidth, originalHeight)
          canvas.getContext("2d")!.drawImage(img, 0, 0)
          resolve({
            canvas,
            originalWidth,
            originalHeight,
            scale: 1,
            mode: "full",
            warnings: [],
          })
          return
        }

        if (!fullError) {
          const canvas = makeIoCanvas(originalWidth, originalHeight)
          canvas.getContext("2d")!.drawImage(img, 0, 0)
          resolve({
            canvas,
            originalWidth,
            originalHeight,
            scale: 1,
            mode: "full",
            warnings: [],
          })
          return
        }

        if (!plan.reducedScale.editable) {
          throw new Error(plan.inspection.reason)
        }
        const canvas = makeIoCanvas(plan.reducedScale.width, plan.reducedScale.height)
        const ctx = canvas.getContext("2d")!
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve({
          canvas,
          originalWidth,
          originalHeight,
          scale: plan.reducedScale.scale,
          mode: "reduced-scale",
          warnings: plan.warnings,
        })
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not load ${file.name}`))
    }
    img.src = url
  })
}
