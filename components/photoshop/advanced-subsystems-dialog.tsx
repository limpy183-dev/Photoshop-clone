"use client"

import * as React from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  CapabilityNotice,
  CheckField,
  ColorField,
  EmptyState,
  FileButton,
  NumberField,
  Panel,
  SelectField,
} from "./advanced-subsystems-dialog-controls"
import {
  ADVANCED_SUBSYSTEM_TABS,
  type AdvancedSubsystemTab,
  type AdvancedSubsystemsDialogProps,
  type ColorWorkflowMode,
} from "./advanced-subsystems-dialog.types"
import {
  cleanImportText,
  isImportRecord,
  normalizeCredentialImportPayload,
  normalizeDropletImportPayload,
} from "./advanced-subsystems-import-normalizers"
import { useEditor, makeCanvas } from "./editor-context"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "./events"
import { canvasToGifDataUrl, deserializePsdFile, downloadBlob, downloadDataUrl, downloadText, inspectImportFileDimensions, loadRasterCanvasFromFile, rasterMime, renderDocumentComposite } from "./document-io"
import { assertCanvasSize } from "./canvas-limits"
import { FILTERS } from "./filters"
import { uid } from "./uid"
import {
  ADVANCED_FILE_LIMITS,
  ADVANCED_FORMAT_CAPABILITIES,
  applyPluginFilterToCanvas,
  assertAdvancedFileSize,
  buildPrintPreviewCanvas,
  buildPrintPreviewReport,
  capabilityForAdvancedFormat,
  convertCanvasToDocumentMode,
  createPrimitiveThreeDScene,
  createSubsystemCanvas,
  createVariableDocumentVariantAsync,
  decodeDicomPreview,
  decodeEpsPreview,
  decodePdfPages,
  decodeRadianceHdrPreview,
  encodeDicomImageData,
  encodeEpsCanvas,
  encodePdfCanvases,
  encodeRadianceHdrImageData,
  exportSceneToDae,
  exportSceneToObj,
  extractEmbeddedJpegDataUrl,
  extractMetadataFromFile,
  inspectAdvancedFormatFile,
  makeXmpMetadata,
  nudgeSceneVertex,
  parseDaeToScene,
  parseObjToScene,
  renderThreeDScene,
} from "./advanced-subsystems"
import {
  DEFAULT_AUTOMATION_OUTPUT,
  cleanBrushPatch,
  cleanHexColor,
  createAutomationWorkflow,
  executeCanvasWorkflow,
  parseSafeDslCommands,
  loadAutomationWorkflows,
  parseAutomationWorkflowImportPayload,
  renderTemplateName,
  saveAutomationWorkflows,
  type AutomationOperation,
  type AutomationOutputPreset,
  type AutomationWorkflow,
} from "./automation-engine"
import {
  buildDataset,
  buildVariableDataSetExportPayload,
  createBinding,
  inferVariableBindings,
  parseDataset,
  parseVariableDataSetImportPayload,
  serializeDatasetRowsCsv,
  upsertBinding,
} from "./variables-engine"
import {
  DROPLET_BUNDLE_FORMAT,
  buildDropletBundle,
  dropletBundleFileName,
  dropletBundleToAutomationAsset,
  parseDropletBundle,
  serializeDropletBundle,
} from "./droplets-bundle"
import type { Droplet } from "./automation-store"
import {
  VIDEO_EXPORT_PRESETS,
  analyzeThreeDPrintReadiness,
  applyVideoTransition,
  assignPlanarUvs,
  buildAudioMixPlan,
  buildThreeDPrintPlan,
  convertVideoTimelineToFrameAnimation,
  createThreeDCrossSection,
  createVideoGroup,
  exportAdvancedThreeDScene,
  getBakedTextureCanvas,
  getVideoPresetDiagnostics,
  importAdvancedThreeDScene,
  paintThreeDSurface,
  rayTraceScene,
  replaceBakedTexture,
  renderAudioMixToWavBlob,
  resolveVideoExportPreset,
  splitVideoLayer,
  trimVideoClip,
  updateThreeDMaterial,
} from "./three-d-video-engine"
import {
  applyIccTransformToImageData,
  describeColorPipeline,
  planProfileAssignment,
  planProfileConversion,
  supportedIccProfileNames,
  validateProfileForDocument,
} from "./color-pipeline"
import { buildColorSeparationModel, summarizeSeparationPlates, type SeparationProcess } from "./color-channel-ops"
import { decodeAdvancedRasterBufferAsync, decodedRasterToCanvas, encodeDngImageData, encodeHeifImageData, encodeJpeg2000ImageData, encodeOpenExrHighBitImage, encodeOpenExrImageData, encodeTiffHighBitImageDataAsync, encodeTiffImageDataAsync, type TiffCompression } from "./raster-codecs"
import { getHighBitExportImage } from "./high-bit-document"
import { createEmbeddedFontFromBuffer, parseOpenTypeFontMetadata } from "./typography-engine"
import { getPsbTileViewMetadata, hasPsbTileViewStore, readPsbTileViewCanvas, writePsbTileViewCanvas } from "./psb-tile-view"
import { createLargeDocumentInspectionDocument, createTileEditDocument, planLargeDocumentOpen } from "./large-document"
import {
  PLUGIN_MANIFEST_FORMAT,
  buildPluginPackagePayload,
  buildPluginExportPayload,
  buildPluginIframeSrcDoc,
  canPluginUsePermission,
  createPluginStoragePatch,
  describeNativeEightBfCompatibility,
  describePluginHostCapabilities,
  normalizeNativeEightBfPlugin,
  normalizePluginActionDescriptors,
  normalizePluginPackagePayload,
  normalizePluginUiTree,
  permissionsForPluginActionDescriptors,
  pluginInstallReview,
  safePluginJson,
  validatePluginPanelRequest,
  type PluginUiNode,
} from "./plugin-system"
import type {
  AssetLibraryItem,
  AdjustmentType,
  AudioTrack,
  ContentCredential,
  ColorManagementSettings,
  DocumentModeSettings,
  Layer,
  PluginActionDescriptor,
  PluginCommandDescriptor,
  PluginDescriptor,
  PluginPermission,
  PrintSettings,
  PsDocument,
  ThreeDScene,
  ToolId,
  VariableBinding,
  VariableDataSet,
  VideoKeyframe,
  VideoLayerProps,
} from "./types"

export type { AdvancedSubsystemTab, ColorWorkflowMode } from "./advanced-subsystems-dialog.types"

function canvasToDataUrl(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/png")
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("Could not read file"))
    reader.readAsDataURL(file)
  })
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  downloadDataUrl(canvas.toDataURL("image/png"), filename)
}

async function downloadCanvasWithPreset(canvas: HTMLCanvasElement, filename: string, output: AutomationOutputPreset) {
  const needsMatte = output.format === "jpeg" || !output.transparent
  const out = needsMatte ? makeCanvas(canvas.width, canvas.height, output.matte) : makeCanvas(canvas.width, canvas.height)
  out.getContext("2d")!.drawImage(canvas, 0, 0)
  if (output.format === "gif") {
    downloadDataUrl(canvasToGifDataUrl(out, output.transparent), `${filename}.gif`)
    return
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, rasterMime(output.format), output.quality))
  if (!blob) throw new Error(`Could not export ${filename}.`)
  downloadBlob(blob, `${filename}.${output.format === "jpeg" ? "jpg" : output.format}`)
}

function createLayerFromCanvas(doc: PsDocument, name: string, canvas: HTMLCanvasElement, patch?: Partial<Layer>): Layer {
  const layerCanvas = makeCanvas(doc.width, doc.height)
  layerCanvas.getContext("2d")!.drawImage(canvas, 0, 0, doc.width, doc.height)
  return {
    id: uid("layer"),
    name,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: layerCanvas,
    ...patch,
  }
}

export function AdvancedSubsystemsDialog({ open, onOpenChange, initialTab, initialColorWorkflow = "assign" }: AdvancedSubsystemsDialogProps) {
  const [tab, setTab] = React.useState<AdvancedSubsystemTab>(initialTab)
  React.useEffect(() => {
    if (open) setTab(initialTab)
  }, [initialTab, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(92vh,880px)] w-[min(96vw,1440px)] max-w-[min(96vw,1440px)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[var(--ps-text)] sm:max-w-[min(96vw,1440px)]">
        <DialogHeader className="shrink-0 border-b border-[var(--ps-divider)] px-4 py-3">
          <DialogTitle className="text-sm">Advanced Photoshop Subsystems</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[176px_minmax(0,1fr)]">
          <AdvancedSubsystemTabList activeTab={tab} onTabChange={setTab} />
          <div className="min-h-0 min-w-0 overflow-auto p-4">
            <AdvancedSubsystemTabContent tab={tab} initialColorWorkflow={initialColorWorkflow} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AdvancedSubsystemTabList({ activeTab, onTabChange }: { activeTab: AdvancedSubsystemTab; onTabChange: (tab: AdvancedSubsystemTab) => void }) {
  return (
    <div className="overflow-y-auto border-r border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      {ADVANCED_SUBSYSTEM_TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onTabChange(item.id)}
          className={`mb-1 flex h-8 w-full items-center rounded-sm px-3 text-left text-[12px] ${activeTab === item.id ? "bg-[var(--ps-accent)] text-white" : "hover:bg-[var(--ps-tool-hover)]"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function AdvancedSubsystemTabContent({ tab, initialColorWorkflow }: { tab: AdvancedSubsystemTab; initialColorWorkflow: ColorWorkflowMode }) {
  switch (tab) {
    case "3d":
      return <ThreeDWorkspace />
    case "video":
      return <VideoWorkspace />
    case "print":
      return <PrintWorkspace />
    case "preview":
      return <DevicePreviewWorkspace />
    case "automation":
      return <AutomationWorkspace />
    case "provenance":
      return <ProvenanceWorkspace />
    case "plugins":
      return <PluginWorkspace />
    case "libraries":
      return <LibrariesWorkspace />
    case "color":
      return <ColorWorkspace initialWorkflow={initialColorWorkflow} />
    case "formats":
      return <FormatsWorkspace />
    case "variables":
      return <VariablesWorkspace />
  }

  const _exhaustive: never = tab
  return _exhaustive
}

function ThreeDWorkspace() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [scene, setScene] = React.useState<ThreeDScene>(() => createPrimitiveThreeDScene("cube"))
  const [printReport, setPrintReport] = React.useState("")
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  const object = scene.objects.find((item) => item.id === scene.selectedObjectId) ?? scene.objects[0]
  const material = scene.materials[0]

  React.useEffect(() => {
    if (activeLayer?.threeD) setScene(activeLayer.threeD)
  }, [activeLayer?.id, activeLayer?.threeD])

  React.useEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    const rendered = renderThreeDScene(scene, 480, 320)
    const ctx = preview.getContext("2d")!
    preview.width = rendered.width
    preview.height = rendered.height
    ctx.clearRect(0, 0, preview.width, preview.height)
    ctx.drawImage(rendered, 0, 0)
  }, [scene])

  if (!activeDoc) return <EmptyState text="Open a document before adding 3D content." />

  const updateObject = (patch: Partial<typeof object>) => {
    if (!object) return
    setScene({
      ...scene,
      objects: scene.objects.map((item) => (item.id === object.id ? { ...item, ...patch } : item)),
    })
  }

  const updateMaterial = (patch: Partial<typeof material>) => {
    if (!material) return
    setScene(updateThreeDMaterial(scene, material.id, patch))
  }

  const commitScene = () => {
    const rendered = renderThreeDScene(scene, activeDoc.width, activeDoc.height)
    if (activeLayer?.kind === "3d") {
      activeLayer.canvas.width = activeDoc.width
      activeLayer.canvas.height = activeDoc.height
      activeLayer.canvas.getContext("2d")!.drawImage(rendered, 0, 0)
      dispatch({ type: "set-layer-3d", id: activeLayer.id, scene })
      requestRender()
      window.setTimeout(() => commit("Update 3D Scene", [activeLayer.id]), 0)
      return
    }
    const layer = createLayerFromCanvas(activeDoc, "3D Scene", rendered, { kind: "3d", threeD: scene })
    dispatch({ type: "add-layer", layer })
    window.setTimeout(() => commit("Create 3D Layer", "all"), 0)
  }

  const importMesh = async (file: File) => {
    try {
      const lower = file.name.toLowerCase()
      const isBinaryModel = lower.endsWith(".3ds") || lower.endsWith(".kmz") || lower.endsWith(".u3d")
      let next: ThreeDScene
      let importWarnings: string[] = []
      if (isBinaryModel) {
        assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.modelBinaryBytes, "3D model file")
        const result = importAdvancedThreeDScene(await file.arrayBuffer(), file.name)
        next = result.scene
        importWarnings = result.warnings
      } else if (lower.endsWith(".dae")) {
        assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.modelTextBytes, "DAE model file")
        next = parseDaeToScene(await file.text())
      } else {
        assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.modelTextBytes, "OBJ model file")
        next = parseObjToScene(await file.text())
      }
      setScene(next)
      const placeholderWarning = importWarnings.find((w) => /placeholder/i.test(w))
      if (placeholderWarning) {
        toast.warning(`Imported ${file.name} as a placeholder`, { description: placeholderWarning })
      } else if (importWarnings.length) {
        toast.success(`Imported ${file.name}`, { description: importWarnings[0] })
      } else {
        toast.success(`Imported ${file.name}`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import 3D model")
    }
  }

  const exportAdvanced = (format: "3ds" | "kmz" | "u3d") => {
    const result = exportAdvancedThreeDScene(scene, format, activeDoc.name)
    if (typeof result.data === "string") {
      downloadText(result.data, result.fileName, result.mime)
    } else {
      downloadBlob(new Blob([result.data], { type: result.mime }), result.fileName)
    }
    toast.info(result.warnings[0])
  }

  const assignUvs = () => {
    setScene(assignPlanarUvs(scene, object?.id))
    toast.success("Planar UVs assigned")
  }

  const paintSurface = () => {
    if (!object) return
    setScene(paintThreeDSurface(assignPlanarUvs(scene, object.id), object.id, { u: 0.5, v: 0.5, radius: 0.15, color: material?.color ?? "#5ec8ff", opacity: 1 }))
    toast.success("Paint stroke baked into editable 3D texture atlas")
  }

  const importTextureAtlas = async (file: File) => {
    if (!material) return
    try {
      assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "3D texture atlas")
      const raster = await loadRasterCanvasFromFile(file)
      const ctx = raster.canvas.getContext("2d")
      if (!ctx) throw new Error("Could not read texture atlas pixels.")
      const image = ctx.getImageData(0, 0, raster.canvas.width, raster.canvas.height)
      setScene(replaceBakedTexture(scene, material.id, image))
      toast.success(`Baked ${file.name} into ${material.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import texture atlas")
    }
  }

  const exportTextureAtlas = () => {
    if (!material) return
    const atlas = getBakedTextureCanvas(scene, material.id)
    if (!atlas) {
      toast.info("Paint or import a texture atlas before exporting.")
      return
    }
    downloadCanvas(atlas, `${activeDoc.name}-${material.name}-texture-atlas.png`)
  }

  const addTextureAtlasLayer = () => {
    if (!material) return
    const atlas = getBakedTextureCanvas(scene, material.id)
    if (!atlas) {
      toast.info("Paint or import a texture atlas before creating a layer.")
      return
    }
    const layer = createLayerFromCanvas(activeDoc, `${material.name} Texture Atlas`, atlas)
    dispatch({ type: "add-layer", layer })
    window.setTimeout(() => commit("Extract 3D Texture Atlas", "all"), 0)
  }

  const bakeActiveLayerAsTexture = () => {
    if (!material || !activeLayer?.canvas) return
    const ctx = activeLayer.canvas.getContext("2d")
    if (!ctx) {
      toast.error("Active layer pixels are not available.")
      return
    }
    const image = ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    setScene(replaceBakedTexture(scene, material.id, image))
    toast.success(`Baked active layer into ${material.name}`)
  }

  const rayTracePreview = () => {
    const image = rayTraceScene(scene, 480, 320, { background: "#101010", shadows: true })
    const preview = previewRef.current
    if (!preview) return
    preview.width = image.width
    preview.height = image.height
    preview.getContext("2d")!.putImageData(image, 0, 0)
    toast.success("Ray-traced preview rendered")
  }

  const crossSection = () => {
    setScene(createThreeDCrossSection(scene, { axis: "z", position: 0, capColor: "#ff55cc" }))
    toast.success("Cross section applied")
  }

  const runPrintCheck = () => {
    const report = analyzeThreeDPrintReadiness(scene, { minWallThickness: 0.05, maxBuildSize: { x: 10, y: 10, z: 10 } })
    setPrintReport(`${report.ready ? "Ready" : "Needs fixes"}: ${report.bounds.x.toFixed(2)} x ${report.bounds.y.toFixed(2)} x ${report.bounds.z.toFixed(2)} units; ${report.issues.length ? report.issues.map((issue) => issue.detail).join(" ") : "no print-blocking issues found."}`)
    toast[report.ready ? "success" : "warning"](report.ready ? "3D print check passed" : "3D print check found issues")
  }

  const exportPrintPlan = () => {
    const plan = buildThreeDPrintPlan(scene, {
      layerHeight: 0.2,
      nozzleDiameter: 0.4,
      filamentDiameter: 1.75,
      maxBuildSize: { x: 10, y: 10, z: 10 },
      baseName: activeDoc.name,
    })
    setPrintReport(`${plan.readiness.ready ? "Ready" : "Needs fixes"}: ${plan.slices.length} slices, ${plan.estimatedMaterialVolume.toFixed(3)} units^3 material, ${plan.estimatedPrintTimeMinutes.toFixed(1)} min estimate. ${plan.browserHandoff.detail}`)
    downloadText(plan.gcodePreview, plan.browserHandoff.fileName, plan.browserHandoff.mime)
    toast.info("Browser-local 3D print handoff exported")
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <CapabilityNotice>
          Browser-native 3D uses editable mesh metadata plus a rasterized canvas preview. It is not Photoshop Extended 3D, GPU ray tracing, or a native 3D interchange runtime.
        </CapabilityNotice>
        <canvas ref={previewRef} className="h-auto w-full max-w-[640px] rounded-sm border border-[var(--ps-divider)] bg-[#101010]" />
        <div className="grid grid-cols-4 gap-2">
          {(["cube", "sphere", "pyramid", "plane"] as const).map((kind) => (
            <Button key={kind} variant="secondary" size="sm" onClick={() => setScene(createPrimitiveThreeDScene(kind))}>{kind}</Button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          <FileButton accept=".obj,.dae,.3ds,.kmz,.u3d,.txt,.xml" label="Import 3D" onFile={importMesh} />
          <Button size="sm" variant="secondary" onClick={() => downloadText(exportSceneToObj(scene), `${activeDoc.name}-scene.obj`, "text/plain")}>Export OBJ</Button>
          <Button size="sm" variant="secondary" onClick={() => downloadText(exportSceneToDae(scene), `${activeDoc.name}-scene.dae`, "application/xml")}>Export DAE</Button>
          <Button size="sm" onClick={commitScene}>Commit Layer</Button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Button size="sm" variant="secondary" onClick={() => exportAdvanced("3ds")}>Export 3DS</Button>
          <Button size="sm" variant="secondary" onClick={() => exportAdvanced("kmz")}>Export KMZ</Button>
          <Button size="sm" variant="secondary" onClick={() => exportAdvanced("u3d")}>Export U3D</Button>
          <Button size="sm" variant="secondary" onClick={rayTracePreview}>Ray Trace</Button>
        </div>
      </div>
      <div className="space-y-3">
        <Panel title="Object Transform">
          <SelectField label="Render" value={scene.renderMode} onChange={(value) => setScene({ ...scene, renderMode: value as ThreeDScene["renderMode"] })} options={["solid", "wireframe", "solid-wire"]} />
          {object ? (
            <>
              <NumberField label="Rotate X" value={object.rotation.x} min={-180} max={180} onChange={(value) => updateObject({ rotation: { ...object.rotation, x: value } })} />
              <NumberField label="Rotate Y" value={object.rotation.y} min={-180} max={180} onChange={(value) => updateObject({ rotation: { ...object.rotation, y: value } })} />
              <NumberField label="Rotate Z" value={object.rotation.z} min={-180} max={180} onChange={(value) => updateObject({ rotation: { ...object.rotation, z: value } })} />
              <NumberField label="Scale" value={object.scale.x} min={0.1} max={4} step={0.1} onChange={(value) => updateObject({ scale: { x: value, y: value, z: value } })} />
            </>
          ) : null}
        </Panel>
        <Panel title="Materials & Mesh">
          <ColorField label="Material" value={material?.color ?? "#5ec8ff"} onChange={(value) => updateMaterial({ color: value })} />
          <NumberField label="Metallic" value={material?.metallic ?? 0} min={0} max={1} step={0.05} onChange={(value) => updateMaterial({ metallic: value })} />
          <NumberField label="Roughness" value={material?.roughness ?? 0.45} min={0} max={1} step={0.05} onChange={(value) => updateMaterial({ roughness: value })} />
          <NumberField label="UV Scale U" value={material?.uvScale?.u ?? 1} min={0.1} max={8} step={0.1} onChange={(value) => updateMaterial({ uvScale: { u: value, v: material?.uvScale?.v ?? 1 } })} />
          <NumberField label="UV Scale V" value={material?.uvScale?.v ?? 1} min={0.1} max={8} step={0.1} onChange={(value) => updateMaterial({ uvScale: { u: material?.uvScale?.u ?? 1, v: value } })} />
          <NumberField label="Vertex" value={scene.selectedVertexIndex ?? 0} min={0} max={Math.max(0, (object?.vertices.length ?? 1) - 1)} onChange={(value) => setScene({ ...scene, selectedVertexIndex: Math.round(value) })} />
          <div className="grid grid-cols-3 gap-1">
            <Button size="sm" variant="secondary" onClick={() => object && setScene(nudgeSceneVertex(scene, object.id, scene.selectedVertexIndex ?? 0, { x: -0.05, y: 0, z: 0 }))}>X-</Button>
            <Button size="sm" variant="secondary" onClick={() => object && setScene(nudgeSceneVertex(scene, object.id, scene.selectedVertexIndex ?? 0, { x: 0.05, y: 0, z: 0 }))}>X+</Button>
            <Button size="sm" variant="secondary" onClick={() => object && setScene(nudgeSceneVertex(scene, object.id, scene.selectedVertexIndex ?? 0, { x: 0, y: 0.05, z: 0 }))}>Y+</Button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button size="sm" variant="secondary" onClick={assignUvs}>Assign UVs</Button>
            <Button size="sm" variant="secondary" onClick={paintSurface}>Paint Surface</Button>
            <FileButton accept="image/*" label="Import Atlas" onFile={importTextureAtlas} />
            <Button size="sm" variant="secondary" onClick={exportTextureAtlas}>Export Atlas</Button>
            <Button size="sm" variant="secondary" onClick={addTextureAtlasLayer}>Atlas Layer</Button>
            <Button size="sm" variant="secondary" onClick={bakeActiveLayerAsTexture} disabled={!activeLayer?.canvas}>Bake Layer</Button>
            <Button size="sm" variant="secondary" onClick={crossSection}>Cross Section</Button>
            <Button size="sm" variant="secondary" onClick={runPrintCheck}>3D Print Check</Button>
            <Button size="sm" variant="secondary" onClick={exportPrintPlan}>Slice / Handoff</Button>
          </div>
          {printReport ? <p className="text-[11px] text-[var(--ps-text-dim)]">{printReport}</p> : null}
        </Panel>
      </div>
    </div>
  )
}

async function captureVideoFrame(file: File, timeMs: number, width: number, height: number) {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement("video")
    video.src = url
    video.muted = true
    video.preload = "auto"
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error("Could not read video metadata"))
    })
    video.currentTime = Math.min(video.duration || 0, timeMs / 1000)
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
    })
    const canvas = createSubsystemCanvas(width, height)
    canvas.getContext("2d")!.drawImage(video, 0, 0, width, height)
    return { canvas, durationMs: Math.round((video.duration || 0) * 1000) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function VideoWorkspace() {
  const { activeDoc, activeLayer, selectedLayers, dispatch, commit, requestRender } = useEditor()
  const [timeMs, setTimeMs] = React.useState(0)
  const [rendering, setRendering] = React.useState(false)
  const [audioRendering, setAudioRendering] = React.useState(false)
  const [progress, setProgress] = React.useState("")
  const [presetId, setPresetId] = React.useState("social-1080p")
  const [frameConversion, setFrameConversion] = React.useState("")
  const presetDiagnostics = React.useMemo(() => getVideoPresetDiagnostics(), [])
  const currentDiagnostic = presetDiagnostics.find((entry) => entry.preset.id === presetId) ?? presetDiagnostics[0]
  if (!activeDoc) return <EmptyState text="Open a document before importing video layers." />

  const frames = activeDoc.timelineFrames ?? []
  const activeVideoLayer = activeLayer?.kind === "video" && activeLayer.video ? activeLayer : null
  const selectedVideoLayers = selectedLayers.filter((layer) => layer.kind === "video" && layer.video)
  const audioTracks = [
    ...frames.flatMap((frame) => frame.audioTracks ?? []),
    ...activeDoc.layers.flatMap((layer) => layer.video?.audioTracks ?? []),
  ]
  const audioMix = buildAudioMixPlan(audioTracks, timeMs, { masterVolume: 1 })

  const importVideo = async (file: File) => {
    try {
      const sourceDataUrl = await fileToDataUrl(file)
      const capture = await captureVideoFrame(file, timeMs, activeDoc.width, activeDoc.height)
      const video: VideoLayerProps = {
        sourceName: file.name,
        sourceDataUrl,
        durationMs: capture.durationMs,
        currentTimeMs: timeMs,
        playbackRate: 1,
        inPointMs: 0,
        outPointMs: capture.durationMs,
        keyframes: [],
        posterDataUrl: canvasToDataUrl(capture.canvas),
      }
      const layer = createLayerFromCanvas(activeDoc, `Video - ${file.name}`, capture.canvas, { kind: "video", video })
      dispatch({ type: "add-layer", layer })
      window.setTimeout(() => commit("Import Video Layer", "all"), 0)
      toast.success("Video layer imported")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import video")
    }
  }

  const captureTimelineFrame = () => {
    const frame = {
      id: uid("frame"),
      name: `Frame ${frames.length + 1}`,
      durationMs: 500,
      layerVisibility: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold" as const,
      keyframes: [] as VideoKeyframe[],
      audioTracks: [] as AudioTrack[],
    }
    dispatch({ type: "set-timeline-frames", frames: [...frames, frame] })
    window.setTimeout(() => commit("Capture Video Timeline Frame", "all"), 0)
  }

  const addOpacityKeyframe = () => {
    if (!activeLayer) return
    const frame = frames[0] ?? {
      id: uid("frame"),
      name: "Video Frame 1",
      durationMs: 500,
      layerVisibility: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold" as const,
    }
    const keyframe: VideoKeyframe = { id: uid("key"), timeMs, layerId: activeLayer.id, property: "opacity", value: activeLayer.opacity, easing: "linear" }
    const nextFrames = frames.length ? frames.map((item, index) => (index === 0 ? { ...item, keyframes: [...(item.keyframes ?? []), keyframe] } : item)) : [{ ...frame, keyframes: [keyframe] }]
    dispatch({ type: "set-timeline-frames", frames: nextFrames })
  }

  const addAudioTrack = async (file: File) => {
    const dataUrl = await fileToDataUrl(file)
    const audio = document.createElement("audio")
    audio.src = dataUrl
    await new Promise<void>((resolve) => {
      audio.onloadedmetadata = () => resolve()
      audio.onerror = () => resolve()
    })
    const track: AudioTrack = { id: uid("audio"), name: file.name, startMs: timeMs, durationMs: Math.round((audio.duration || 0) * 1000), volume: 1, dataUrl }
    const frame = frames[0] ?? {
      id: uid("frame"),
      name: "Video Frame 1",
      durationMs: 500,
      layerVisibility: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold" as const,
    }
    const nextFrames = frames.length ? frames.map((item, index) => (index === 0 ? { ...item, audioTracks: [...(item.audioTracks ?? []), track] } : item)) : [{ ...frame, audioTracks: [track] }]
    dispatch({ type: "set-timeline-frames", frames: nextFrames })
  }

  const trimActiveClip = () => {
    if (!activeVideoLayer?.video) return
    const next = trimVideoClip(activeVideoLayer.video, timeMs, activeVideoLayer.video.outPointMs)
    dispatch({ type: "set-layer-video", id: activeVideoLayer.id, video: next })
    window.setTimeout(() => commit("Trim Video Clip", [activeVideoLayer.id]), 0)
  }

  const splitActiveClip = () => {
    if (!activeVideoLayer?.video) return
    const [left, right] = splitVideoLayer(activeVideoLayer, timeMs)
    dispatch({ type: "set-layer-video", id: activeVideoLayer.id, video: left.video })
    dispatch({ type: "add-layer", layer: right })
    window.setTimeout(() => commit("Split Video Clip", [activeVideoLayer.id, right.id]), 0)
  }

  const addTransition = () => {
    if (!activeVideoLayer?.video) return
    const next = applyVideoTransition(activeVideoLayer.video, { kind: "cross-dissolve", durationMs: 800, easing: "ease-in-out" })
    dispatch({ type: "set-layer-video", id: activeVideoLayer.id, video: next })
    window.setTimeout(() => commit("Add Video Transition", [activeVideoLayer.id]), 0)
  }

  const makeVideoGroup = () => {
    const layers = selectedVideoLayers.length ? selectedVideoLayers : activeVideoLayer ? [activeVideoLayer] : []
    if (!layers.length) return
    const result = createVideoGroup(layers, { name: `Video Group ${(activeDoc.layers.filter((layer) => layer.videoGroup).length ?? 0) + 1}`, transition: "cross-dissolve" })
    dispatch({ type: "add-layer", layer: result.group })
    for (const layer of result.layers) {
      if (layer.video) dispatch({ type: "set-layer-video", id: layer.id, video: layer.video })
    }
    window.setTimeout(() => commit("Create Video Group", [result.group.id, ...layers.map((layer) => layer.id)]), 0)
  }

  const convertFrames = () => {
    const animation = convertVideoTimelineToFrameAnimation(frames, { fps: resolveVideoExportPreset(presetId).fps, includeTransitions: true })
    setFrameConversion(`${animation.frames.length} animation frame${animation.frames.length === 1 ? "" : "s"} at ${animation.fps}fps, ${animation.durationMs}ms total.`)
    toast.success("Timeline converted to frame animation metadata")
  }

  const exportAudioMix = async () => {
    if (!audioTracks.length) {
      toast.error("No audio tracks to mix")
      return
    }
    setAudioRendering(true)
    try {
      const timelineDuration = frames.reduce((sum, frame) => sum + Math.max(0, frame.durationMs), 0)
      const audioDuration = audioTracks.reduce((max, track) => Math.max(max, track.startMs + track.durationMs), 0)
      const blob = await renderAudioMixToWavBlob(audioTracks, {
        durationMs: Math.max(timelineDuration, audioDuration, 1),
        sampleRate: 48_000,
        masterVolume: 1,
      })
      downloadBlob(blob, `${activeDoc.name}-audio-mix.wav`)
      toast.success("Exported WAV audio mix")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export audio mix")
    } finally {
      setAudioRendering(false)
    }
  }

  const renderVideo = async () => {
    const preset = resolveVideoExportPreset(presetId)
    const timeline = frames.length ? frames : [{
      id: uid("frame"),
      name: "Current",
      durationMs: 1000,
      layerVisibility: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold" as const,
    }]
    const wantsMp4 = preset.codec === "h264" && MediaRecorder.isTypeSupported("video/mp4;codecs=avc1.42E01E")
    const mime = wantsMp4
      ? "video/mp4;codecs=avc1.42E01E"
      : preset.codec === "vp9" && MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm"
    setRendering(true)
    setProgress("Starting encoder")
    try {
      const canvas = createSubsystemCanvas(preset.width, preset.height)
      const stream = canvas.captureStream(preset.fps)
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream, { mimeType: mime })
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime }))
      })
      recorder.start()
      for (let i = 0; i < timeline.length; i++) {
        const frame = timeline[i]
        setProgress(`Rendering ${i + 1}/${timeline.length}`)
        const variant: PsDocument = {
          ...activeDoc,
          layers: activeDoc.layers.map((layer) => ({
            ...layer,
            visible: frame.layerVisibility[layer.id] ?? layer.visible,
            opacity: frame.layerOpacity?.[layer.id] ?? layer.opacity,
          })),
        }
        const flat = renderDocumentComposite(variant, { transparent: false })
        canvas.getContext("2d")!.drawImage(flat, 0, 0, preset.width, preset.height)
        await new Promise((resolve) => window.setTimeout(resolve, Math.max(80, frame.durationMs)))
      }
      recorder.stop()
      const blob = await done
      const ext = mime.includes("mp4") ? "mp4" : "webm"
      downloadDataUrl(URL.createObjectURL(blob), `${activeDoc.name}-${preset.id}.${ext}`)
      toast.success(ext === "mp4" ? `Rendered ${preset.label}` : `Rendered WebM fallback for ${preset.label}`)
    } finally {
      setRendering(false)
      setProgress("")
      requestRender()
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Video Layers & Timeline">
        <CapabilityNotice>
          Video support stores poster frames, trim ranges, split clips, transitions, video groups, frame-animation conversion, and audio mix metadata. Browser MediaRecorder support still controls the final encoded container.
        </CapabilityNotice>
        <div className="grid grid-cols-3 gap-2">
          <FileButton accept="video/*" label="Import Video" onFile={importVideo} />
          <FileButton accept="audio/*" label="Add Audio" onFile={addAudioTrack} />
          <Button size="sm" onClick={captureTimelineFrame}>Capture Frame</Button>
        </div>
        <NumberField label="Time ms" value={timeMs} min={0} max={600000} step={100} onChange={setTimeMs} />
        <Button size="sm" variant="secondary" disabled={!activeLayer} onClick={addOpacityKeyframe}>Add Opacity Keyframe</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" disabled={!activeVideoLayer} onClick={trimActiveClip}>Trim In Here</Button>
          <Button size="sm" variant="secondary" disabled={!activeVideoLayer} onClick={splitActiveClip}>Split Clip</Button>
          <Button size="sm" variant="secondary" disabled={!activeVideoLayer} onClick={addTransition}>Add Dissolve</Button>
          <Button size="sm" variant="secondary" disabled={!activeVideoLayer && !selectedVideoLayers.length} onClick={makeVideoGroup}>Video Group</Button>
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {frames.length ? frames.map((frame, index) => (
            <div key={frame.id} className="grid grid-cols-[40px_1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 text-[11px]">
              <span className="text-[var(--ps-text-dim)]">#{index + 1}</span>
              <span>{frame.name}</span>
              <span>{frame.durationMs}ms</span>
            </div>
          )) : <EmptyState text="Capture frames or keyframes to build the video timeline." />}
        </div>
      </Panel>
      <Panel title="Render">
        <SelectField label="Preset" value={presetId} onChange={setPresetId} options={VIDEO_EXPORT_PRESETS.map((preset) => preset.id)} />
        {currentDiagnostic ? (
          <p
            className={`mt-1 text-[11px] ${currentDiagnostic.fallbackToPackage && currentDiagnostic.deliveryMode === "muxed-media" ? "text-amber-500" : "text-[var(--ps-text-dim)]"}`}
            title={currentDiagnostic.candidateMimeTypes.join(", ")}
          >
            {currentDiagnostic.reason}
          </p>
        ) : null}
        <Button disabled={rendering} onClick={renderVideo}>{rendering ? "Rendering..." : "Render Video"}</Button>
        <Button className="mt-2" size="sm" variant="secondary" disabled={!frames.length} onClick={convertFrames}>Convert to Frame Animation</Button>
        <Button className="mt-2" size="sm" variant="secondary" disabled={!audioTracks.length || audioRendering} onClick={exportAudioMix}>
          {audioRendering ? "Mixing Audio..." : "Export WAV Mix"}
        </Button>
        <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">{progress || "Uses H.264 MP4 when the browser exposes it, otherwise WebM."}</p>
        {frameConversion ? <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">{frameConversion}</p> : null}
        <details className="mt-3 text-[11px] text-[var(--ps-text-dim)]">
          <summary className="cursor-pointer">Browser codec support</summary>
          <ul className="mt-1 space-y-0.5">
            {presetDiagnostics.map((entry) => {
              const status = entry.deliveryMode === "muxed-media"
                ? entry.willMuxNatively ? "native" : "fallback"
                : entry.deliveryMode === "animated-image" ? "gif" : "zip"
              const statusColor = status === "native" ? "text-emerald-500"
                : status === "fallback" ? "text-amber-500"
                : "text-[var(--ps-text-dim)]"
              return (
                <li key={entry.preset.id} className="flex justify-between gap-2">
                  <span>{entry.preset.label}</span>
                  <span className={statusColor}>{status === "native" ? entry.resolvedMimeType : status}</span>
                </li>
              )
            })}
          </ul>
        </details>
        <p className="mt-4 text-[11px]">Video layers: {activeDoc.layers.filter((layer) => layer.kind === "video").length}</p>
        <p className="text-[11px]">Audio tracks: {audioTracks.length}; active mix L {Math.round(audioMix.leftGain * 100)}% / R {Math.round(audioMix.rightGain * 100)}%</p>
      </Panel>
    </div>
  )
}

function PrintWorkspace() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [settings, setSettings] = React.useState<PrintSettings | null>(null)
  const [previewReport, setPreviewReport] = React.useState<ReturnType<typeof buildPrintPreviewReport> | null>(null)
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    if (activeDoc) setSettings({
      paperSize: "Letter",
      orientation: "portrait",
      scale: 100,
      bleedMm: 0,
      cropMarks: false,
      registrationMarks: false,
      centerCropMarks: false,
      colorBars: false,
      description: false,
      labels: false,
      colorHandling: "app",
      proofPrint: false,
      printerProfile: "Working CMYK",
      paperColor: "#ffffff",
      marksOffsetMm: 4,
      pagePosition: "center",
      ...(activeDoc.printSettings ?? {}),
    })
  }, [activeDoc])

  React.useEffect(() => {
    if (!activeDoc || !settings || !previewRef.current) return
    const flat = renderDocumentComposite(activeDoc, { transparent: false })
    const preview = buildPrintPreviewCanvas(flat, settings, activeDoc.name)
    setPreviewReport(buildPrintPreviewReport(flat, settings, activeDoc.name, activeDoc))
    previewRef.current.width = preview.width
    previewRef.current.height = preview.height
    previewRef.current.getContext("2d")!.drawImage(preview, 0, 0)
  }, [activeDoc, settings])

  if (!activeDoc || !settings) return <EmptyState text="Open a document before printing." />
  const update = (patch: Partial<PrintSettings>) => setSettings({ ...settings, ...patch })
  const save = () => {
    dispatch({ type: "set-print-settings", settings })
    window.setTimeout(() => commit("Update Print Settings", []), 0)
  }
  const print = () => {
    save()
    const canvas = previewRef.current
    if (!canvas) return
    const win = window.open("about:blank", "_blank")
    if (!win) return
    try { (win as Window & { opener: Window | null }).opener = null } catch {}
    win.document.title = `Print - ${activeDoc.name}`
    win.document.body.style.margin = "0"
    win.document.body.style.background = "#fff"
    const img = win.document.createElement("img")
    img.src = canvas.toDataURL("image/png")
    img.style.width = "100%"
    img.onload = () => win.print()
    win.document.body.appendChild(img)
  }
  const exportReport = () => {
    if (!previewReport) return
    downloadText(JSON.stringify(previewReport, null, 2), `${activeDoc.name}-print-preview-report.json`, "application/json")
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="max-h-[640px] overflow-auto rounded-sm border border-[var(--ps-divider)] bg-[#2b2b2b] p-4">
        <canvas ref={previewRef} className="mx-auto max-w-full bg-white" />
      </div>
      <Panel title="Print Setup">
        <SelectField label="Paper" value={settings.paperSize} options={["Letter", "A4", "A3", "Tabloid", "Custom"]} onChange={(value) => update({ paperSize: value as PrintSettings["paperSize"] })} />
        <SelectField label="Orientation" value={settings.orientation} options={["portrait", "landscape"]} onChange={(value) => update({ orientation: value as PrintSettings["orientation"] })} />
        <NumberField label="Scale %" value={settings.scale} min={10} max={400} onChange={(value) => update({ scale: value })} />
        <NumberField label="Bleed mm" value={settings.bleedMm} min={0} max={50} step={0.5} onChange={(value) => update({ bleedMm: value })} />
        <NumberField label="Marks offset mm" value={settings.marksOffsetMm ?? 4} min={0} max={20} step={0.5} onChange={(value) => update({ marksOffsetMm: value })} />
        <SelectField label="Color handling" value={settings.colorHandling} options={["app", "printer"]} onChange={(value) => update({ colorHandling: value as PrintSettings["colorHandling"] })} />
        <SelectField label="Printer profile" value={settings.printerProfile ?? "Working CMYK"} options={["Working CMYK", "U.S. Web Coated SWOP v2", "Japan Color 2001 Coated", "Display P3", "Dot Gain 20%"]} onChange={(value) => update({ printerProfile: value as PrintSettings["printerProfile"] })} />
        <CheckField label="Crop marks" checked={settings.cropMarks} onChange={(checked) => update({ cropMarks: checked })} />
        <CheckField label="Center-crop marks" checked={settings.centerCropMarks ?? false} onChange={(checked) => update({ centerCropMarks: checked })} />
        <CheckField label="Registration marks" checked={settings.registrationMarks} onChange={(checked) => update({ registrationMarks: checked })} />
        <CheckField label="Color bars" checked={settings.colorBars ?? false} onChange={(checked) => update({ colorBars: checked })} />
        <CheckField label="Description" checked={settings.description ?? false} onChange={(checked) => update({ description: checked })} />
        <CheckField label="Labels" checked={settings.labels ?? false} onChange={(checked) => update({ labels: checked })} />
        <CheckField label="Proof print" checked={settings.proofPrint} onChange={(checked) => update({ proofPrint: checked })} />
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button size="sm" variant="secondary" onClick={save}>Save Setup</Button>
          <Button size="sm" onClick={print}>Print</Button>
        </div>
        {previewReport ? (
          <div className="mt-3 space-y-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px] text-[var(--ps-text-dim)]" data-testid="print-preview-report">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--ps-text)]">Preview report</span>
              <Button size="sm" variant="secondary" onClick={exportReport}>Export JSON</Button>
            </div>
            <p>{previewReport.limitations[0]}</p>
            <p>
              Marks: {previewReport.marks.filter((mark) => mark.enabled).map((mark) => mark.kind).join(", ") || "none"}; bleed {previewReport.bleed.requestedMm}mm; risks {previewReport.risks.length}.
            </p>
            {previewReport.risks.slice(0, 3).map((risk) => (
              <p key={risk.id}>{risk.severity}: {risk.detail}</p>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}

type DevicePreset = {
  id: string
  name: string
  width: number
  height: number
  background: string
}

const DEVICE_PRESETS: DevicePreset[] = [
  { id: "phone", name: "Phone 390 x 844", width: 390, height: 844, background: "#0f172a" },
  { id: "tablet", name: "Tablet 820 x 1180", width: 820, height: 1180, background: "#111827" },
  { id: "desktop", name: "Desktop 1440 x 900", width: 1440, height: 900, background: "#171717" },
  { id: "social", name: "Social Square 1080", width: 1080, height: 1080, background: "#1f2937" },
]

function DevicePreviewWorkspace() {
  const { activeDoc } = useEditor()
  const [presetId, setPresetId] = React.useState(DEVICE_PRESETS[0].id)
  const [mode, setMode] = React.useState<"contain" | "cover" | "actual">("contain")
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  const preset = DEVICE_PRESETS.find((item) => item.id === presetId) ?? DEVICE_PRESETS[0]

  React.useEffect(() => {
    const canvas = previewRef.current
    if (!canvas || !activeDoc) return
    canvas.width = preset.width
    canvas.height = preset.height
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = preset.background
    ctx.fillRect(0, 0, preset.width, preset.height)
    const flat = renderDocumentComposite(activeDoc, { transparent: true })
    const ratio =
      mode === "actual"
        ? 1
        : mode === "cover"
          ? Math.max(preset.width / activeDoc.width, preset.height / activeDoc.height)
          : Math.min(preset.width / activeDoc.width, preset.height / activeDoc.height)
    const dw = activeDoc.width * ratio
    const dh = activeDoc.height * ratio
    const dx = (preset.width - dw) / 2
    const dy = (preset.height - dh) / 2
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(flat, dx, dy, dw, dh)
    ctx.strokeStyle = "rgba(255,255,255,0.28)"
    ctx.lineWidth = Math.max(2, Math.round(Math.min(preset.width, preset.height) / 280))
    ctx.strokeRect(0, 0, preset.width, preset.height)
  }, [activeDoc, preset, mode])

  if (!activeDoc) return <EmptyState text="Open a document before using device preview." />

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="max-h-[640px] overflow-auto rounded-sm border border-[var(--ps-divider)] bg-[#202020] p-4">
        <canvas ref={previewRef} className="mx-auto block h-auto max-h-[600px] max-w-full rounded-[18px] shadow-2xl" />
      </div>
      <Panel title="Device Preview">
        <SelectField label="Device" value={presetId} options={DEVICE_PRESETS.map((item) => item.id)} onChange={setPresetId} />
        <SelectField label="Fit" value={mode} options={["contain", "cover", "actual"]} onChange={(value) => setMode(value as typeof mode)} />
        <div className="rounded-sm border border-[var(--ps-divider)] p-2 text-[11px] text-[var(--ps-text-dim)]">
          {preset.name} - document {activeDoc.width} x {activeDoc.height}
        </div>
        <Button size="sm" onClick={() => previewRef.current && downloadCanvas(previewRef.current, `${activeDoc.name}-${preset.id}-preview.png`)}>
          Export Preview PNG
        </Button>
      </Panel>
    </div>
  )
}

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

function AutomationWorkspace() {
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

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? new Blob()), "image/png"))
}

async function sha256Hex(data: Blob | string) {
  const buffer = typeof data === "string" ? new TextEncoder().encode(data) : await data.arrayBuffer()
  if (crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", buffer)
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
  }
  let h = 2166136261
  const bytes = new Uint8Array(buffer)
  for (const byte of bytes) h = Math.imul(h ^ byte, 16777619)
  return (h >>> 0).toString(16).padStart(8, "0")
}

async function hashCanvas(canvas: HTMLCanvasElement) {
  return sha256Hex(await canvasBlob(canvas))
}

function ProvenanceWorkspace() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [actor, setActor] = React.useState("Local user")
  const [assertion, setAssertion] = React.useState("Edited locally in Photoshop Web")
  const [busy, setBusy] = React.useState(false)
  if (!activeDoc) return <EmptyState text="Open a document before generating provenance." />
  const credentials = activeDoc.metadata?.contentCredentials ?? []

  const generate = async () => {
    setBusy(true)
    try {
      const flat = renderDocumentComposite(activeDoc, { transparent: true })
      const ingredients: ContentCredential["ingredients"] = []
      for (const layer of activeDoc.layers) {
        if (layer.kind === "group") continue
        ingredients.push({
          id: layer.id,
          name: layer.name,
          kind: layer.kind,
          visible: layer.visible,
          hash: await hashCanvas(layer.canvas),
        })
      }
      const credential: ContentCredential = {
        id: uid("cred"),
        action: "local-edit",
        actor,
        software: "Photoshop Web",
        createdAt: new Date().toISOString(),
        documentName: activeDoc.name,
        documentHash: await hashCanvas(flat),
        layerCount: ingredients.length,
        dimensions: { width: activeDoc.width, height: activeDoc.height },
        ingredients,
        assertion,
      }
      dispatch({ type: "set-document-metadata", metadata: { ...(activeDoc.metadata ?? {}), contentCredentials: [credential, ...credentials] } })
      window.setTimeout(() => commit("Generate Content Credentials", []), 0)
      toast.success("Local provenance manifest added")
    } finally {
      setBusy(false)
    }
  }

  const exportAll = () => {
    downloadText(JSON.stringify({ app: "Photoshop Web", format: "content-credentials", version: 1, credentials }, null, 2), `${activeDoc.name}-content-credentials.json`, "application/json")
  }
  const importCredentials = async (file: File) => {
    assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.jsonBytes, "Content credentials file")
    const parsed: unknown = JSON.parse(await file.text())
    const imported = normalizeCredentialImportPayload(parsed)
    dispatch({ type: "set-document-metadata", metadata: { ...(activeDoc.metadata ?? {}), contentCredentials: [...imported, ...credentials] } })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel title="Local Content Credentials">
        <CapabilityNotice>
          Local SHA-256 provenance manifests only. Embed Metadata exports write unsigned C2PA carrier payloads, app XMP records, and format metadata, but no certificate chain is created.
        </CapabilityNotice>
        <Input value={actor} onChange={(event) => setActor(event.target.value)} className="h-8" />
        <Input value={assertion} onChange={(event) => setAssertion(event.target.value)} className="h-8" />
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" disabled={busy} onClick={generate}>{busy ? "Hashing..." : "Generate"}</Button>
          <Button size="sm" variant="secondary" disabled={!credentials.length} onClick={exportAll}>Export</Button>
        </div>
        <FileButton accept=".json,application/json" label="Import Credentials" onFile={importCredentials} />
      </Panel>
      <Panel title="Credential Chain">
        <div className="max-h-[520px] overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {credentials.length ? credentials.map((credential) => (
            <div key={credential.id} className="border-b border-[var(--ps-divider)] p-2 text-[11px]">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <span className="font-medium">{credential.assertion}</span>
                <span className="text-[var(--ps-text-dim)]">{new Date(credential.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-[var(--ps-text-dim)]">Actor: {credential.actor} - Layers: {credential.layerCount} - SHA-256: {credential.documentHash.slice(0, 18)}...</div>
            </div>
          )) : <EmptyState text="No local content credentials have been generated." />}
        </div>
      </Panel>
    </div>
  )
}

const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  "document:read": "Document read",
  "layers:read": "Layer read",
  "layers:write": "Layer write",
  "filters:write": "Filter write",
  commands: "Commands",
  storage: "Storage",
  ui: "Host UI",
}

const PLUGIN_PERMISSION_DESCRIPTIONS: Record<PluginPermission, string> = {
  "document:read": "Read document name, dimensions, color mode, and layer count.",
  "layers:read": "Read active layer metadata.",
  "layers:write": "Create or update layer records through approved host actions.",
  "filters:write": "Modify active layer pixels through JSON-described filters.",
  commands: "Run commands declared in the plugin manifest.",
  storage: "Read and write the plugin's project-local storage namespace.",
  ui: "Render host-native controls through message passing.",
}

const SAMPLE_PANEL_HTML = `
<style>
  body{font:13px system-ui;background:#181818;color:#eee;padding:12px}
  main{display:grid;gap:10px}
  .dim{color:#a7a7a7}
</style>
<main>
  <strong>Sandboxed Plugin Panel</strong>
  <span class="dim" id="summary">Waiting for host API...</span>
</main>
<script>
  async function boot() {
    const doc = await photoshopWeb.document.getInfo();
    document.getElementById("summary").textContent = doc.name + " - " + doc.width + "x" + doc.height;
    await photoshopWeb.storage.set("lastDocument", doc.name);
    await photoshopWeb.ui.render({
      type: "stack",
      id: "root",
      children: [
        { type: "text", id: "title", text: "Plugin UI Bridge", tone: "strong" },
        { type: "text", id: "doc", text: "Active document: " + doc.name, tone: "muted" },
        { type: "button", id: "inspect", label: "Inspect Active Layer", action: "inspect-layer", variant: "primary" },
        { type: "input", id: "tag", label: "Storage key", value: "lastDocument", placeholder: "key" }
      ]
    });
  }
  window.onPhotoshopWebPluginEvent = async (event) => {
    if (event.action === "inspect-layer") {
      const layer = await photoshopWeb.layers.getActive();
      await photoshopWeb.ui.toast(layer ? ("Active layer: " + layer.name) : "No active layer");
    }
  };
  boot().catch((error) => {
    document.getElementById("summary").textContent = error.message;
  });
</script>`

const SAMPLE_PLUGINS: PluginDescriptor[] = [
  {
    id: "plug_sharpen",
    name: "8BF-style Sharpen Kernel",
    kind: "8bf-filter",
    enabled: true,
    version: "1.0",
    permissions: ["filters:write"],
    commands: [{ id: "apply", title: "Apply Sharpen Kernel", group: "Filters", action: { type: "apply-filter" } }],
    filterKernel: [0, -1, 0, -1, 5, -1, 0, -1, 0],
    filterDivisor: 1,
    filterBias: 0,
    createdAt: Date.now(),
  },
  {
    id: "plug_emboss",
    name: "8BF-style Emboss Kernel",
    kind: "8bf-filter",
    enabled: true,
    version: "1.0",
    permissions: ["filters:write"],
    commands: [{ id: "apply", title: "Apply Emboss Kernel", group: "Filters", action: { type: "apply-filter" } }],
    filterKernel: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
    filterDivisor: 1,
    filterBias: 128,
    createdAt: Date.now(),
  },
  {
    id: "plug_panel",
    name: "UXP-style Document Helper",
    kind: "ux-plugin",
    enabled: true,
    version: "1.0",
    permissions: ["document:read", "layers:read", "storage", "ui", "commands"],
    panelHtml: SAMPLE_PANEL_HTML,
    storageDefaults: { lastDocument: "", launches: 0 },
    commands: [
      { id: "open", title: "Open Document Helper Panel", group: "Panels", action: { type: "open-panel" } },
      { id: "ping", title: "Send Inspect Event", group: "Panels", action: { type: "post-message", message: { action: "inspect-layer" } } },
    ],
    createdAt: Date.now(),
  },
]

function clonePluginForInstall(plugin: PluginDescriptor, index: number, source: PluginDescriptor["source"] = "registry"): PluginDescriptor {
  return {
    ...plugin,
    id: uid("plugin"),
    createdAt: Date.now() + index,
    installedAt: Date.now() + index,
    manifestVersion: 1,
    source,
    trusted: source === "registry" || source === "sample",
    storageDefaults: isImportRecord(plugin.storageDefaults) ? (safePluginJson(plugin.storageDefaults) as Record<string, unknown>) : undefined,
  }
}

function mergePluginStorageDefaults(
  current: Record<string, Record<string, unknown>> | undefined,
  plugins: PluginDescriptor[],
) {
  const next: Record<string, Record<string, unknown>> = { ...(current ?? {}) }
  for (const plugin of plugins) {
    if (!next[plugin.id]) {
      next[plugin.id] = isImportRecord(plugin.storageDefaults)
        ? (safePluginJson(plugin.storageDefaults) as Record<string, unknown>) ?? {}
        : {}
    }
  }
  for (const id of Object.keys(next)) {
    if (!plugins.some((plugin) => plugin.id === id)) delete next[id]
  }
  return next
}

function permissionsForPluginCommand(command: PluginCommandDescriptor): PluginPermission[] {
  if (command.requiredPermissions?.length) return command.requiredPermissions
  if (command.action.type === "apply-filter") return ["filters:write"]
  if (command.action.type === "post-message") return ["commands"]
  if (command.action.type === "batch-play") return permissionsForPluginActionDescriptors(command.action.descriptors)
  if (command.action.type === "eval-script") return ["commands"]
  return []
}

function permissionForPanelMethod(method: string): PluginPermission | null {
  if (method === "host.getInfo" || method === "plugin.ready" || method === "8bf.getInfo") return null
  if (method === "document.getInfo") return "document:read"
  if (method === "layers.getActive") return "layers:read"
  if (method === "layers.create" || method === "layers.update") return "layers:write"
  if (method.startsWith("storage.")) return "storage"
  if (method.startsWith("ui.")) return "ui"
  if (method === "commands.run" || method === "action.batchPlay" || method === "uxp.executeAsModal" || method.startsWith("cep.")) return "commands"
  if (method === "8bf.run") return "filters:write"
  return null
}

function postPluginResponse(
  frame: HTMLIFrameElement | null,
  plugin: PluginDescriptor,
  requestId: string,
  payload: { ok: true; result: unknown } | { ok: false; error: string },
) {
  frame?.contentWindow?.postMessage(
    {
      channel: "photoshop-web-plugin",
      pluginId: plugin.id,
      requestId,
      type: "response",
      ...payload,
    },
    "*",
  )
}

function postPluginUiEvent(
  frame: HTMLIFrameElement | null,
  plugin: PluginDescriptor,
  event: Record<string, unknown>,
) {
  frame?.contentWindow?.postMessage(
    {
      channel: "photoshop-web-plugin",
      pluginId: plugin.id,
      type: "ui:event",
      event,
    },
    "*",
  )
}

function summarizeRuntimeLayer(layer: Layer | null) {
  return layer
    ? {
        id: layer.id,
        name: layer.name,
        kind: layer.kind ?? "raster",
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        width: layer.canvas.width,
        height: layer.canvas.height,
      }
    : null
}

function runtimeStringArg(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback
}

function runtimeNumberArg(value: unknown, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, typeof value === "number" && Number.isFinite(value) ? value : fallback))
}

function runtimeBooleanArg(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function runtimeRecord(value: unknown): Record<string, unknown> {
  return isImportRecord(value) ? value : {}
}

function resolveRuntimeLayer(doc: PsDocument, activeLayer: Layer | null, id: unknown) {
  const requested = typeof id === "string" ? id : ""
  if (!requested || requested === "active" || requested === "targetEnum") return activeLayer
  return doc.layers.find((layer) => layer.id === requested || layer.name === requested) ?? activeLayer
}

function descriptorTargetsLayer(descriptor: PluginActionDescriptor) {
  return JSON.stringify(descriptor._target ?? descriptor).toLowerCase().includes("layer")
}

function descriptorTargetsDocument(descriptor: PluginActionDescriptor) {
  return JSON.stringify(descriptor._target ?? descriptor).toLowerCase().includes("document")
}

function descriptorLayerId(descriptor: PluginActionDescriptor) {
  const target = Array.isArray(descriptor._target) ? descriptor._target.find(isImportRecord) : null
  return target && typeof target._id === "string" ? target._id : target && typeof target.name === "string" ? target.name : "active"
}

function pluginLayerPatchFromDescriptor(descriptor: PluginActionDescriptor) {
  return runtimeRecord(descriptor.to ?? descriptor.using ?? descriptor)
}

function applyFilterIdToLayer(layer: Layer, filterId: string, params?: Record<string, number | string | boolean>) {
  const filter = FILTERS[filterId]
  if (!filter) throw new Error(`Unknown filter: ${filterId}`)
  const ctx = layer.canvas.getContext("2d")
  if (!ctx) throw new Error("Active layer canvas is unavailable.")
  const defaults: Record<string, number | string | boolean> = {}
  for (const param of filter.params) defaults[param.key] = param.default
  const image = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
  ctx.putImageData(filter.apply(image, { ...defaults, ...(params ?? {}) }), 0, 0)
}

function createRuntimeLayer(doc: PsDocument, params: Record<string, unknown>): Layer {
  return {
    id: uid("plugin-layer"),
    name: runtimeStringArg(params.name, "Plugin Layer"),
    kind: "raster",
    visible: true,
    locked: false,
    opacity: runtimeNumberArg(params.opacity, 1, 0, 1),
    blendMode: "normal",
    canvas: makeCanvas(doc.width, doc.height),
  }
}

function runPluginActionDescriptors({
  descriptors,
  activeDoc,
  activeLayer,
  dispatch,
  requestRender,
  commit,
}: {
  descriptors: PluginActionDescriptor[]
  activeDoc: PsDocument
  activeLayer: Layer | null
  dispatch: ReturnType<typeof useEditor>["dispatch"]
  requestRender: () => void
  commit: ReturnType<typeof useEditor>["commit"]
}) {
  const results: unknown[] = []
  const touchedLayers = new Set<string>()
  for (const descriptor of descriptors) {
    const action = descriptor._obj.toLowerCase()
    if (action === "get") {
      if (descriptorTargetsDocument(descriptor)) {
        results.push({
          id: activeDoc.id,
          name: activeDoc.name,
          width: activeDoc.width,
          height: activeDoc.height,
          colorMode: activeDoc.colorMode,
          bitDepth: activeDoc.bitDepth,
          layerCount: activeDoc.layers.length,
        })
      } else {
        results.push(summarizeRuntimeLayer(resolveRuntimeLayer(activeDoc, activeLayer, descriptorLayerId(descriptor))))
      }
      continue
    }
    if (action === "make" && descriptorTargetsLayer(descriptor)) {
      const layer = createRuntimeLayer(activeDoc, pluginLayerPatchFromDescriptor(descriptor))
      dispatch({ type: "add-layer", layer })
      touchedLayers.add(layer.id)
      results.push(summarizeRuntimeLayer(layer))
      continue
    }
    const targetLayer = resolveRuntimeLayer(activeDoc, activeLayer, descriptorLayerId(descriptor))
    if (!targetLayer && descriptorTargetsLayer(descriptor)) throw new Error("No target layer is available.")
    if (action === "set" && targetLayer) {
      const patch = pluginLayerPatchFromDescriptor(descriptor)
      if (typeof patch.name === "string") dispatch({ type: "rename-layer", id: targetLayer.id, name: runtimeStringArg(patch.name, targetLayer.name) })
      if (typeof patch.opacity === "number") dispatch({ type: "set-layer-opacity", id: targetLayer.id, opacity: runtimeNumberArg(patch.opacity, targetLayer.opacity, 0, 1) })
      if (typeof patch.visible === "boolean") dispatch({ type: "set-layer-visibility", id: targetLayer.id, visible: patch.visible })
      touchedLayers.add(targetLayer.id)
      results.push({ ok: true, layerId: targetLayer.id })
      continue
    }
    if (action === "select" && targetLayer) {
      dispatch({ type: "set-active-layer", id: targetLayer.id })
      results.push({ ok: true, activeLayerId: targetLayer.id })
      continue
    }
    if ((action === "hide" || action === "show") && targetLayer) {
      dispatch({ type: "set-layer-visibility", id: targetLayer.id, visible: action === "show" })
      touchedLayers.add(targetLayer.id)
      results.push({ ok: true, layerId: targetLayer.id, visible: action === "show" })
      continue
    }
    if (action === "duplicate" && targetLayer) {
      dispatch({ type: "duplicate-layer", id: targetLayer.id })
      results.push({ ok: true, duplicatedLayerId: targetLayer.id })
      continue
    }
    if (action === "delete" && targetLayer) {
      dispatch({ type: "remove-layer", id: targetLayer.id })
      results.push({ ok: true, removedLayerId: targetLayer.id })
      continue
    }
    if (action === "filter" && targetLayer) {
      const filterId = runtimeStringArg(descriptor.filter ?? descriptor.filterId, "invert")
      applyFilterIdToLayer(targetLayer, filterId, runtimeRecord(descriptor.params) as Record<string, number | string | boolean>)
      touchedLayers.add(targetLayer.id)
      results.push({ ok: true, layerId: targetLayer.id, filterId })
      continue
    }
    results.push({ ok: false, unsupported: descriptor._obj })
  }
  if (touchedLayers.size) {
    requestRender()
    window.setTimeout(() => commit("Plugin Action Manager", [...touchedLayers]), 0)
  }
  return results
}

function runCepSafeScript({
  source,
  activeDoc,
  activeLayer,
  dispatch,
  requestRender,
  commit,
}: {
  source: string
  activeDoc: PsDocument
  activeLayer: Layer | null
  dispatch: ReturnType<typeof useEditor>["dispatch"]
  requestRender: () => void
  commit: ReturnType<typeof useEditor>["commit"]
}) {
  const commands = parseSafeDslCommands(source)
  const output: string[] = []
  const touchedLayers = new Set<string>()
  for (const command of commands) {
    const args = command.args
    if (command.method === "report") output.push(String(args[0] ?? "").slice(0, 500))
    else if (command.method === "reportDocument") output.push(`${activeDoc.name}: ${activeDoc.width} x ${activeDoc.height}px, ${activeDoc.layers.length} layers`)
    else if (command.method === "reportActiveLayer") output.push(activeLayer ? `Active layer: ${activeLayer.name}` : "No active layer")
    else if (command.method === "setTool") dispatch({ type: "set-tool", tool: runtimeStringArg(args[0], "move") as ToolId })
    else if (command.method === "setForeground") dispatch({ type: "set-foreground", color: cleanHexColor(args[0]) })
    else if (command.method === "setBackground") dispatch({ type: "set-background", color: cleanHexColor(args[0]) })
    else if (command.method === "setBrush") dispatch({ type: "set-brush", brush: cleanBrushPatch(args[0]) })
    else if (command.method === "renameActiveLayer" && activeLayer) {
      dispatch({ type: "rename-layer", id: activeLayer.id, name: runtimeStringArg(args[0], activeLayer.name) })
      touchedLayers.add(activeLayer.id)
    } else if (command.method === "setLayerOpacity") {
      const target = resolveRuntimeLayer(activeDoc, activeLayer, args[0])
      if (target) {
        dispatch({ type: "set-layer-opacity", id: target.id, opacity: runtimeNumberArg(args[1], target.opacity, 0, 1) })
        touchedLayers.add(target.id)
      }
    } else if (command.method === "setLayerVisibility") {
      const target = resolveRuntimeLayer(activeDoc, activeLayer, args[0])
      if (target) {
        dispatch({ type: "set-layer-visibility", id: target.id, visible: runtimeBooleanArg(args[1], target.visible) })
        touchedLayers.add(target.id)
      }
    } else if (command.method === "newLayer") {
      const layer = createRuntimeLayer(activeDoc, { name: args[0] })
      dispatch({ type: "add-layer", layer })
      touchedLayers.add(layer.id)
    } else if (command.method === "createAdjustment") {
      const adjustmentType = runtimeStringArg(args[0], "brightness-contrast") as AdjustmentType
      const filter = FILTERS[adjustmentType]
      if (!filter) throw new Error(`Unknown adjustment: ${adjustmentType}`)
      const params: Record<string, number | string | boolean> = {}
      for (const param of filter.params) params[param.key] = param.default
      const layer: Layer = {
        id: uid("plugin-adj"),
        name: filter.name,
        kind: "adjustment",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: makeCanvas(activeDoc.width, activeDoc.height),
        mask: makeCanvas(activeDoc.width, activeDoc.height, "#ffffff"),
        adjustment: { type: adjustmentType, params },
      }
      dispatch({ type: "add-layer", layer })
      touchedLayers.add(layer.id)
    } else if (command.method === "applyFilter" && activeLayer) {
      applyFilterIdToLayer(activeLayer, runtimeStringArg(args[0], "invert"), runtimeRecord(args[1]) as Record<string, number | string | boolean>)
      touchedLayers.add(activeLayer.id)
    } else if ((command.method === "invert" || command.method === "grayscale" || command.method === "desaturate" || command.method === "equalize" || command.method === "hdrToning") && activeLayer) {
      applyFilterIdToLayer(activeLayer, command.method === "hdrToning" ? "hdr-toning" : command.method)
      touchedLayers.add(activeLayer.id)
    }
  }
  if (touchedLayers.size) {
    requestRender()
    window.setTimeout(() => commit("CEP evalScript", [...touchedLayers]), 0)
  }
  return { result: output.join("\n") || `OK (${commands.length} command${commands.length === 1 ? "" : "s"})`, commands: commands.length }
}

function PluginWorkspace() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [selectedId, setSelectedId] = React.useState("")
  const [hostUi, setHostUi] = React.useState<PluginUiNode | null>(null)
  const [runtimeLog, setRuntimeLog] = React.useState<string[]>([])
  const [pendingInstall, setPendingInstall] = React.useState<{
    plugins: PluginDescriptor[]
    assets: AssetLibraryItem[]
    sourceLabel: string
  } | null>(null)
  const plugins = React.useMemo(() => activeDoc?.plugins ?? [], [activeDoc?.plugins])
  const selected = plugins.find((plugin) => plugin.id === selectedId) ?? plugins[0]

  React.useEffect(() => {
    setHostUi(null)
  }, [selected?.id])

  React.useEffect(() => {
    if (selectedId && !plugins.some((plugin) => plugin.id === selectedId)) setSelectedId(plugins[0]?.id ?? "")
    if (!selectedId && plugins[0]) setSelectedId(plugins[0].id)
  }, [plugins, selectedId])

  const setPlugins = React.useCallback((next: PluginDescriptor[]) => {
    if (!activeDoc) return
    dispatch({ type: "set-plugins", plugins: next })
    dispatch({ type: "set-plugin-storage", pluginStorage: mergePluginStorageDefaults(activeDoc.pluginStorage, next) })
  }, [activeDoc, dispatch])

  const logRuntime = React.useCallback((message: string) => {
    setRuntimeLog((current) => [message, ...current].slice(0, 8))
  }, [])

  const applyPluginFilter = React.useCallback((plugin: PluginDescriptor) => {
    if (!activeLayer || plugin.kind !== "8bf-filter") return
    if (!canPluginUsePermission(plugin, "filters:write")) {
      toast.error(`${plugin.name} does not have Filter write permission.`)
      return
    }
    const out = applyPluginFilterToCanvas(activeLayer.canvas, plugin)
    activeLayer.canvas.getContext("2d")!.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    activeLayer.canvas.getContext("2d")!.drawImage(out, 0, 0)
    requestRender()
    window.setTimeout(() => commit(`Apply Plugin: ${plugin.name}`, [activeLayer.id]), 0)
    logRuntime(`Applied ${plugin.name} to ${activeLayer.name}`)
  }, [activeLayer, commit, logRuntime, requestRender])

  const runPluginCommand = React.useCallback((plugin: PluginDescriptor, command: PluginCommandDescriptor) => {
    if (plugin.enabled === false) {
      toast.error(`${plugin.name} is disabled.`)
      return
    }
    const missing = permissionsForPluginCommand(command).filter((permission) => !canPluginUsePermission(plugin, permission))
    if (missing.length) {
      toast.error(`Missing permission: ${PLUGIN_PERMISSION_LABELS[missing[0]]}`)
      return
    }
    setSelectedId(plugin.id)
    if (command.action.type === "open-panel") {
      logRuntime(`Opened ${plugin.name} panel`)
      return
    }
    if (command.action.type === "apply-filter") {
      applyPluginFilter(plugin)
      return
    }
    if (command.action.type === "post-message") {
      dispatchPhotoshopEvent("ps-plugin-panel-command", { pluginId: plugin.id, commandId: command.id, message: command.action.message })
      logRuntime(`Sent ${command.title} to ${plugin.name}`)
      return
    }
    if (command.action.type === "batch-play") {
      dispatchPhotoshopEvent("ps-plugin-panel-command", {
        pluginId: plugin.id,
        commandId: command.id,
        message: { runtime: "action", descriptors: command.action.descriptors },
      })
      logRuntime(`Queued ${command.title} Action Manager descriptors for ${plugin.name}`)
      return
    }
    dispatchPhotoshopEvent("ps-plugin-panel-command", {
      pluginId: plugin.id,
      commandId: command.id,
      message: { runtime: "cep", source: command.action.source },
    })
    logRuntime(`Queued ${command.title} CEP script for ${plugin.name}`)
  }, [applyPluginFilter, logRuntime])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-run-plugin-command", (detail) => {
      const plugin = plugins.find((item) => item.id === detail?.pluginId)
      const command = plugin?.commands?.find((item) => item.id === detail?.commandId)
      if (plugin && command) runPluginCommand(plugin, command)
    })
  }, [plugins, runPluginCommand])

  const stageInstall = React.useCallback((nextPlugins: PluginDescriptor[], sourceLabel: string, assets: AssetLibraryItem[] = []) => {
    setPendingInstall({ plugins: nextPlugins, assets, sourceLabel })
  }, [])

  const addSamples = () => {
    if (!activeDoc) return
    stageInstall(SAMPLE_PLUGINS.map((plugin, index) => clonePluginForInstall(plugin, index, "sample")), "Sample plugins")
  }

  const installPending = () => {
    if (!activeDoc || !pendingInstall?.plugins.length) return
    const installed = pendingInstall.plugins
    setPlugins([...installed, ...plugins])
    setSelectedId(installed[0]?.id ?? "")
    const pluginAssets: AssetLibraryItem[] = installed.map((plugin) => ({
      id: uid("asset"),
      name: plugin.name,
      kind: "plugin" as const,
      group: "Plugins",
      payload: plugin,
      createdAt: Date.now(),
    }))
    dispatch({
      type: "set-asset-library",
      assets: [...pluginAssets, ...pendingInstall.assets, ...(activeDoc.assetLibrary ?? [])],
    })
    setPendingInstall(null)
    toast.success(`${installed.length} plugin${installed.length === 1 ? "" : "s"} installed`)
  }

  const importPlugin = async (file: File) => {
    if (!activeDoc) return
    assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.jsonBytes, "Plugin manifest or package file")
    if (/\.8bf$/i.test(file.name)) {
      const plugin = normalizeNativeEightBfPlugin(await file.arrayBuffer(), {
        fileName: file.name,
        now: Date.now(),
        makeId: () => uid("plugin"),
      })
      stageInstall([plugin], file.name)
      return
    }
    const parsed: unknown = JSON.parse(await file.text())
    const imported = normalizePluginPackagePayload(parsed, {
      fileSizeBytes: file.size,
      now: Date.now(),
      makeId: () => uid("plugin"),
    })
    stageInstall(imported.plugins.map((plugin) => ({ ...plugin, source: imported.assets.length ? "package" : "import" })), file.name, imported.assets)
  }

  const exportPlugins = (scope: "selected" | "all") => {
    const chosen = scope === "selected" && selected ? [selected] : plugins
    if (!chosen.length) return
    downloadText(
      JSON.stringify(buildPluginExportPayload(chosen), null, 2),
      scope === "selected" && selected ? `${selected.name}.psplugin.json` : "photoshop-web-plugins.psplugin.json",
      "application/json",
    )
  }

  const exportPluginPackage = () => {
    const chosen = selected ? [selected] : plugins
    if (!chosen.length || !activeDoc) return
    const packageAssets = (activeDoc.assetLibrary ?? []).filter((asset) =>
      asset.kind === "plugin" ||
      asset.kind === "cloud-library" ||
      asset.kind === "stock" ||
      asset.kind === "font" ||
      asset.kind === "swatch",
    )
    downloadText(
      JSON.stringify(buildPluginPackagePayload(chosen, { assets: packageAssets }), null, 2),
      selected ? `${selected.name}.psplugin.json` : "photoshop-web-plugin-package.psplugin.json",
      "application/json",
    )
  }

  const registryPlugins = SAMPLE_PLUGINS

  const toggleSelectedEnabled = () => {
    if (!selected) return
    setPlugins(plugins.map((plugin) => plugin.id === selected.id ? { ...plugin, enabled: !plugin.enabled } : plugin))
  }

  const removeSelected = () => {
    if (!selected || !activeDoc) return
    const next = plugins.filter((plugin) => plugin.id !== selected.id)
    setPlugins(next)
    setSelectedId(next[0]?.id ?? "")
  }

  if (!activeDoc) return <EmptyState text="Open a document before installing plugins." />

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="grid content-start gap-4">
        <Panel title="Installed Local Plugins">
          <CapabilityNotice>
            Browser-safe UXP and CEP adapters are available through sandboxed panels, manifest permissions, CSInterface/evalScript shims, Action Manager batchPlay descriptors, and local 8BF kernel execution. Native 8BF binaries import as metadata unless paired with a safe kernel or WebAssembly adapter.
          </CapabilityNotice>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" variant="secondary" onClick={addSamples}>Review Samples</Button>
            <FileButton accept=".json,.psplugin,.psplugin.json,.8bf,application/json" label="Import Manifest / 8BF" onFile={importPlugin} />
            <Button size="sm" variant="secondary" disabled={!selected} onClick={() => exportPlugins("selected")}>Export Selected</Button>
            <Button size="sm" variant="secondary" disabled={!plugins.length} onClick={() => exportPlugins("all")}>Export All</Button>
            <Button className="col-span-2" size="sm" variant="secondary" disabled={!selected && !plugins.length} onClick={exportPluginPackage}>Export Package</Button>
          </div>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
            {plugins.map((plugin) => (
              <button key={plugin.id} type="button" onClick={() => setSelectedId(plugin.id)} className={`grid w-full grid-cols-[1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 text-left text-[11px] ${selected?.id === plugin.id ? "bg-[var(--ps-tool-active)]" : "hover:bg-[var(--ps-tool-hover)]"}`}>
                <span className="min-w-0">
                  <span className="block truncate">{plugin.name}</span>
                  <span className="block truncate text-[var(--ps-text-dim)]">
                    {(plugin.commands?.length ?? 0)} command{plugin.commands?.length === 1 ? "" : "s"} - {(plugin.permissions ?? []).length} permission{plugin.permissions?.length === 1 ? "" : "s"} - {plugin.enabled ? "enabled" : "disabled"}
                  </span>
                </span>
                <span className="text-[var(--ps-text-dim)]">{plugin.kind}</span>
              </button>
            ))}
            {!plugins.length ? <div className="p-3 text-[12px] text-[var(--ps-text-dim)]">No plugins installed.</div> : null}
          </div>
          {selected ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" onClick={toggleSelectedEnabled}>
                {selected.enabled ? "Disable" : "Enable"}
              </Button>
              <Button size="sm" variant="destructive" onClick={removeSelected}>Remove</Button>
            </div>
          ) : null}
        </Panel>

        <Panel title="Local Plugin Registry">
          <div className="space-y-2">
            {registryPlugins.map((plugin, index) => {
              const review = pluginInstallReview(plugin)
              const installed = plugins.some((item) => item.name === plugin.name)
              return (
                <div key={plugin.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2 text-[11px]">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{plugin.name}</div>
                      <div className="text-[10px] text-[var(--ps-text-dim)]">{plugin.kind} - {review.capabilities.join(", ") || "Manifest descriptor"}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={installed}
                      aria-label={installed ? undefined : `Review install for ${plugin.name}`}
                      onClick={() => stageInstall([clonePluginForInstall(plugin, index, "registry")], "Local registry")}
                    >
                      {installed ? "Installed" : "Review"}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        {pendingInstall ? (
          <Panel title="Permission review">
            <div className="space-y-3 text-[11px]">
              <div className="text-[var(--ps-text-dim)]">
                {pendingInstall.sourceLabel}: {pendingInstall.plugins.length} plugin{pendingInstall.plugins.length === 1 ? "" : "s"}
                {pendingInstall.assets.length ? ` and ${pendingInstall.assets.length} library asset${pendingInstall.assets.length === 1 ? "" : "s"}` : ""}
              </div>
              {pendingInstall.plugins.map((plugin) => {
                const review = pluginInstallReview(plugin)
                return (
                  <div key={plugin.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2">
                    <div className="font-medium">{review.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {review.capabilities.map((capability) => (
                        <span key={capability} className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text-dim)]">{capability}</span>
                      ))}
                    </div>
                    <div className="mt-2 space-y-1">
                      {review.permissions.length ? review.permissions.map((permission) => (
                        <div key={permission.id}>
                          <span>{permission.label}</span>
                          <span className="block text-[10px] text-[var(--ps-text-dim)]">{permission.description}</span>
                        </div>
                      )) : <span className="text-[var(--ps-text-dim)]">No privileged host permissions requested.</span>}
                    </div>
                  </div>
                )
              })}
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={installPending}>Install reviewed plugin</Button>
                <Button size="sm" variant="secondary" onClick={() => setPendingInstall(null)}>Cancel</Button>
              </div>
            </div>
          </Panel>
        ) : null}
      </div>
      <Panel title="Plugin Runtime">
        {selected ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{selected.name}</div>
                  <div className="text-[11px] text-[var(--ps-text-dim)]">
                    {PLUGIN_MANIFEST_FORMAT} - {selected.version ?? "unversioned"} - {selected.enabled ? "enabled" : "disabled"}
                  </div>
                </div>
                <Button size="sm" variant="secondary" aria-label="Toggle selected plugin" onClick={toggleSelectedEnabled}>
                  {selected.enabled ? "Disable" : "Enable"}
                </Button>
                <Button size="sm" variant="destructive" onClick={removeSelected}>Remove</Button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {selected.kind === "8bf-filter" ? (
                  <Button size="sm" disabled={!activeLayer || !canPluginUsePermission(selected, "filters:write")} onClick={() => applyPluginFilter(selected)}>
                    Apply Kernel to Active Layer
                  </Button>
                ) : null}
                {(selected.commands ?? []).map((command) => (
                  <Button key={command.id} size="sm" variant="secondary" onClick={() => runPluginCommand(selected, command)}>
                    {command.title}
                  </Button>
                ))}
              </div>

              {selected.panelHtml ? (
                <PluginIframeRuntime
                  plugin={selected}
                  activeDoc={activeDoc}
                  activeLayer={activeLayer ?? null}
                  storage={activeDoc.pluginStorage ?? {}}
                  dispatch={dispatch}
                  commit={commit}
                  requestRender={requestRender}
                  applyPluginFilter={applyPluginFilter}
                  runPluginCommand={runPluginCommand}
                  onUiTree={setHostUi}
                  onLog={logRuntime}
                />
              ) : (
                <div className="mt-3 rounded-sm border border-[var(--ps-divider)] p-3 text-[12px] text-[var(--ps-text-dim)]">
                  This plugin does not declare a panel. Use its manifest commands or import a plugin with `panelHtml`.
                </div>
              )}

              {hostUi ? (
                <div className="mt-3 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-bg)] p-3">
                  <div className="mb-2 text-[11px] uppercase text-[var(--ps-text-dim)]">Host-rendered plugin UI</div>
                  <PluginUiRenderer
                    node={hostUi}
                    onEvent={(event) => dispatchPhotoshopEvent("ps-plugin-host-ui-event", { pluginId: selected.id, event })}
                  />
                </div>
              ) : null}
            </div>

            <div className="grid min-w-0 content-start gap-3 text-[11px]">
              <div className="rounded-sm border border-[var(--ps-divider)]">
                <div className="border-b border-[var(--ps-divider)] px-2 py-1.5 font-medium">Permissions</div>
                {Object.entries(PLUGIN_PERMISSION_LABELS).map(([permission, label]) => {
                  const allowed = canPluginUsePermission(selected, permission as PluginPermission)
                  return (
                    <div key={permission} className="border-b border-[var(--ps-divider)] px-2 py-1.5 last:border-b-0">
                      <div className={allowed ? "text-[var(--ps-text)]" : "text-[var(--ps-text-dim)]"}>{allowed ? "Granted" : "Denied"} - {label}</div>
                      <div className="text-[10px] text-[var(--ps-text-dim)]">{PLUGIN_PERMISSION_DESCRIPTIONS[permission as PluginPermission]}</div>
                    </div>
                  )
                })}
              </div>
              <div className="rounded-sm border border-[var(--ps-divider)]">
                <div className="border-b border-[var(--ps-divider)] px-2 py-1.5 font-medium">Storage Namespace</div>
                <pre className="max-h-44 overflow-auto p-2 text-[10px] text-[var(--ps-text-dim)]">{JSON.stringify(activeDoc.pluginStorage?.[selected.id] ?? {}, null, 2)}</pre>
              </div>
              <div className="rounded-sm border border-[var(--ps-divider)]">
                <div className="border-b border-[var(--ps-divider)] px-2 py-1.5 font-medium">Runtime Log</div>
                {runtimeLog.length ? runtimeLog.map((line, index) => <div key={`${line}-${index}`} className="border-b border-[var(--ps-divider)] px-2 py-1.5 last:border-b-0">{line}</div>) : <div className="px-2 py-2 text-[var(--ps-text-dim)]">No runtime events yet.</div>}
              </div>
            </div>
          </div>
        ) : <EmptyState text="Install or import a plugin manifest." />}
      </Panel>
    </div>
  )
}

function PluginIframeRuntime({
  plugin,
  activeDoc,
  activeLayer,
  storage,
  dispatch,
  commit,
  requestRender,
  applyPluginFilter,
  runPluginCommand,
  onUiTree,
  onLog,
}: {
  plugin: PluginDescriptor
  activeDoc: PsDocument
  activeLayer: Layer | null
  storage: Record<string, Record<string, unknown>>
  dispatch: ReturnType<typeof useEditor>["dispatch"]
  commit: ReturnType<typeof useEditor>["commit"]
  requestRender: ReturnType<typeof useEditor>["requestRender"]
  applyPluginFilter: (plugin: PluginDescriptor) => void
  runPluginCommand: (plugin: PluginDescriptor, command: PluginCommandDescriptor) => void
  onUiTree: (tree: PluginUiNode | null) => void
  onLog: (message: string) => void
}) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const seenRequestIdsRef = React.useRef<Set<string>>(new Set())
  const [token, setToken] = React.useState(() => uid("plugintoken"))
  const [runtimeState, setRuntimeState] = React.useState<"booting" | "ready" | "error">("booting")
  const [reloadKey, setReloadKey] = React.useState(0)
  React.useEffect(() => {
    seenRequestIdsRef.current.clear()
    setToken(uid("plugintoken"))
    setRuntimeState("booting")
    onUiTree(null)
  }, [onUiTree, plugin.id, reloadKey])

  const srcDoc = React.useMemo(
    () => buildPluginIframeSrcDoc({ pluginId: plugin.id, token, html: plugin.panelHtml }),
    [plugin.id, plugin.panelHtml, token],
  )

  const sendUiEvent = React.useCallback((event: Record<string, unknown>) => {
    postPluginUiEvent(iframeRef.current, plugin, event)
  }, [plugin])

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const request = validatePluginPanelRequest(event.data, {
        pluginId: plugin.id,
        token,
        source: iframeRef.current?.contentWindow ?? null,
        eventSource: event.source,
        seenRequestIds: seenRequestIdsRef.current,
      })
      if (!request) return
      const required = permissionForPanelMethod(request.method)
      if (required && !canPluginUsePermission(plugin, required)) {
        postPluginResponse(iframeRef.current, plugin, request.requestId, {
          ok: false,
          error: `Permission denied: ${PLUGIN_PERMISSION_LABELS[required]}`,
        })
        return
      }
      try {
        if (request.method === "plugin.ready") {
          setRuntimeState("ready")
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: describePluginHostCapabilities(),
          })
          onLog(`${plugin.name} panel ready`)
          return
        }
        if (request.method === "host.getInfo") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: {
              ...describePluginHostCapabilities(),
              activeDocument: {
                id: activeDoc.id,
                name: activeDoc.name,
                width: activeDoc.width,
                height: activeDoc.height,
                colorMode: activeDoc.colorMode,
                bitDepth: activeDoc.bitDepth,
              },
              plugin: {
                id: plugin.id,
                name: plugin.name,
                kind: plugin.kind,
                runtimeAdapters: plugin.runtimeAdapters ?? [],
              },
            },
          })
          onLog(`${plugin.name} read host info`)
          return
        }
        if (request.method === "document.getInfo") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: {
              id: activeDoc.id,
              name: activeDoc.name,
              width: activeDoc.width,
              height: activeDoc.height,
              colorMode: activeDoc.colorMode,
              bitDepth: activeDoc.bitDepth,
              layerCount: activeDoc.layers.length,
              activeLayerId: activeDoc.activeLayerId,
            },
          })
          onLog(`${plugin.name} read document info`)
          return
        }
        if (request.method === "layers.getActive") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: summarizeRuntimeLayer(activeLayer),
          })
          onLog(`${plugin.name} read active layer`)
          return
        }
        if (request.method === "layers.create") {
          const params = runtimeRecord(request.params)
          const layer = createRuntimeLayer(activeDoc, params)
          dispatch({ type: "add-layer", layer })
          requestRender()
          window.setTimeout(() => commit("Plugin Create Layer", [layer.id]), 0)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: summarizeRuntimeLayer(layer) })
          onLog(`${plugin.name} created layer ${layer.name}`)
          return
        }
        if (request.method === "layers.update") {
          const params = runtimeRecord(request.params)
          const patch = runtimeRecord(params.patch)
          const target = resolveRuntimeLayer(activeDoc, activeLayer, params.id)
          if (!target) throw new Error("No target layer is available.")
          if (typeof patch.name === "string") dispatch({ type: "rename-layer", id: target.id, name: runtimeStringArg(patch.name, target.name) })
          if (typeof patch.opacity === "number") dispatch({ type: "set-layer-opacity", id: target.id, opacity: runtimeNumberArg(patch.opacity, target.opacity, 0, 1) })
          if (typeof patch.visible === "boolean") dispatch({ type: "set-layer-visibility", id: target.id, visible: patch.visible })
          requestRender()
          window.setTimeout(() => commit("Plugin Update Layer", [target.id]), 0)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: { ok: true, layerId: target.id } })
          onLog(`${plugin.name} updated layer ${target.name}`)
          return
        }
        if (request.method === "action.batchPlay") {
          const params = runtimeRecord(request.params)
          const descriptors = normalizePluginActionDescriptors(params.descriptors)
          const missing = permissionsForPluginActionDescriptors(descriptors).filter((permission) => !canPluginUsePermission(plugin, permission))
          if (missing.length) throw new Error(`Permission denied: ${PLUGIN_PERMISSION_LABELS[missing[0]]}`)
          const result = runPluginActionDescriptors({ descriptors, activeDoc, activeLayer, dispatch, requestRender, commit })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result })
          onLog(`${plugin.name} ran ${descriptors.length} Action Manager descriptor${descriptors.length === 1 ? "" : "s"}`)
          return
        }
        if (request.method === "uxp.executeAsModal") {
          const params = runtimeRecord(request.params)
          postPluginResponse(iframeRef.current, plugin, request.requestId, {
            ok: true,
            result: {
              commandName: runtimeStringArg(params.commandName, "Plugin Modal Command"),
              modalBehavior: "browser-cooperative",
              cancelled: false,
            },
          })
          onLog(`${plugin.name} entered browser-safe modal scope`)
          return
        }
        if (request.method === "cep.evalScript") {
          const params = runtimeRecord(request.params)
          const source = runtimeStringArg(params.source, "")
          const result = runCepSafeScript({ source, activeDoc, activeLayer, dispatch, requestRender, commit })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: result.result })
          onLog(`${plugin.name} ran CEP evalScript (${result.commands} command${result.commands === 1 ? "" : "s"})`)
          return
        }
        if (request.method === "cep.dispatchEvent") {
          dispatchPhotoshopEvent("ps-plugin-cep-event", { pluginId: plugin.id, event: safePluginJson(request.params) })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
          onLog(`${plugin.name} dispatched CEP event`)
          return
        }
        if (request.method === "8bf.getInfo") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: describeNativeEightBfCompatibility(plugin) })
          return
        }
        if (request.method === "8bf.run") {
          if (!activeLayer) throw new Error("No active layer is available.")
          const compatibility = describeNativeEightBfCompatibility(plugin)
          if (!compatibility.executable) throw new Error(compatibility.reason)
          applyPluginFilter(plugin)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: compatibility })
          return
        }
        if (request.method === "storage.keys") {
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: Object.keys(storage[plugin.id] ?? {}) })
          return
        }
        if (request.method === "storage.get") {
          const key = isImportRecord(request.params) && typeof request.params.key === "string" ? request.params.key : ""
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: (storage[plugin.id] ?? {})[key] })
          return
        }
        if (request.method === "storage.set") {
          const key = isImportRecord(request.params) && typeof request.params.key === "string" ? request.params.key : ""
          const value = isImportRecord(request.params) ? request.params.value : undefined
          const next = createPluginStoragePatch(storage, plugin.id, { operation: "set", key, value })
          dispatch({ type: "set-plugin-storage", pluginStorage: next })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: next[plugin.id]?.[key] })
          onLog(`${plugin.name} wrote storage:${key}`)
          return
        }
        if (request.method === "storage.remove") {
          const key = isImportRecord(request.params) && typeof request.params.key === "string" ? request.params.key : ""
          const next = createPluginStoragePatch(storage, plugin.id, { operation: "remove", key })
          dispatch({ type: "set-plugin-storage", pluginStorage: next })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
          return
        }
        if (request.method === "storage.clear") {
          const next = createPluginStoragePatch(storage, plugin.id, { operation: "clear" })
          dispatch({ type: "set-plugin-storage", pluginStorage: next })
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
          return
        }
        if (request.method === "commands.run") {
          const commandId = isImportRecord(request.params) && typeof request.params.id === "string" ? request.params.id : ""
          const command = plugin.commands?.find((item) => item.id === commandId)
          if (!command) throw new Error("Command is not declared in the manifest.")
          runPluginCommand(plugin, command)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
          return
        }
        if (request.method === "ui.render") {
          const tree = normalizePluginUiTree(isImportRecord(request.params) ? request.params.tree : null)
          onUiTree(tree)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: !!tree })
          onLog(`${plugin.name} rendered host UI`)
          return
        }
        if (request.method === "ui.toast") {
          const message = isImportRecord(request.params) ? cleanImportText(request.params.message, "Plugin message", 180) : "Plugin message"
          toast.info(message)
          postPluginResponse(iframeRef.current, plugin, request.requestId, { ok: true, result: true })
        }
      } catch (error) {
        setRuntimeState("error")
        postPluginResponse(iframeRef.current, plugin, request.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : "Plugin request failed",
        })
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [activeDoc, activeLayer, applyPluginFilter, commit, dispatch, onLog, onUiTree, plugin, requestRender, runPluginCommand, storage, token])

  React.useEffect(() => {
    const commandHandler = (detail: { pluginId?: string; commandId?: string; message?: unknown }) => {
      if (detail?.pluginId !== plugin.id) return
      sendUiEvent({ componentId: "manifest-command", event: "command", commandId: detail.commandId, message: detail.message })
    }
    const uiHandler = (detail: { pluginId?: string; event?: unknown }) => {
      if (detail?.pluginId !== plugin.id || !isImportRecord(detail.event)) return
      sendUiEvent(detail.event)
    }
    const removeCommand = addPhotoshopEventListener("ps-plugin-panel-command", commandHandler)
    const removeUi = addPhotoshopEventListener("ps-plugin-host-ui-event", uiHandler)
    return () => {
      removeCommand()
      removeUi()
    }
  }, [plugin.id, sendUiEvent])

  return (
    <div className="mt-3 overflow-hidden rounded-sm border border-[var(--ps-divider)] bg-[#171717]">
      <div className="flex h-8 items-center border-b border-[var(--ps-divider)] px-2 text-[10px] text-[var(--ps-text-dim)]">
        <span>Sandbox runtime: {runtimeState}</span>
        <Button className="ml-auto h-6 px-2 text-[10px]" size="sm" variant="ghost" onClick={() => setReloadKey((value) => value + 1)}>
          Reload
        </Button>
      </div>
      <iframe
        key={`${plugin.id}-${token}`}
        ref={iframeRef}
        title={plugin.name}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={() => setRuntimeState("booting")}
        className="h-72 w-full bg-[#171717]"
      />
    </div>
  )
}

function PluginUiRenderer({ node, onEvent }: { node: PluginUiNode; onEvent: (event: Record<string, unknown>) => void }) {
  if (node.type === "stack" || node.type === "row") {
    return (
      <div className={node.type === "row" ? "flex flex-wrap items-center gap-2" : "grid gap-2"}>
        {(node.children ?? []).map((child, index) => <PluginUiRenderer key={child.id ?? index} node={child} onEvent={onEvent} />)}
      </div>
    )
  }
  if (node.type === "text") {
    const tone = node.tone ?? "normal"
    return <div className={`text-[12px] ${tone === "muted" ? "text-[var(--ps-text-dim)]" : tone === "strong" ? "font-medium" : tone === "danger" ? "text-red-300" : ""}`}>{node.text}</div>
  }
  if (node.type === "badge") {
    return <span className="inline-flex w-fit rounded-sm border border-[var(--ps-divider)] px-2 py-0.5 text-[10px] text-[var(--ps-text-dim)]">{node.label}</span>
  }
  if (node.type === "button") {
    return (
      <Button
        size="sm"
        variant={node.variant === "danger" ? "destructive" : node.variant === "secondary" ? "secondary" : "default"}
        onClick={() => onEvent({ componentId: node.id, event: "click", action: node.action })}
      >
        {node.label}
      </Button>
    )
  }
  if (node.type === "input") {
    return (
      <label className="grid gap-1 text-[11px] text-[var(--ps-text-dim)]">
        {node.label ? <span>{node.label}</span> : null}
        <Input
          defaultValue={node.value ?? ""}
          placeholder={node.placeholder}
          className="h-8"
          onChange={(event) => onEvent({ componentId: node.id, event: "change", value: event.currentTarget.value })}
        />
      </label>
    )
  }
  if (node.type === "meter") {
    const max = node.max ?? 100
    const pct = Math.max(0, Math.min(100, (node.value / max) * 100))
    return (
      <div className="grid gap-1">
        {node.label ? <div className="text-[11px] text-[var(--ps-text-dim)]">{node.label}</div> : null}
        <div className="h-1.5 overflow-hidden rounded-sm bg-[var(--ps-tool-hover)]">
          <div className="h-full bg-[var(--ps-accent)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  return <div className="h-px bg-[var(--ps-divider)]" />
}

function LibrariesWorkspace() {
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

function ColorWorkspace({ initialWorkflow }: { initialWorkflow: ColorWorkflowMode }) {
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

function FormatsWorkspace() {
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

function imageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Could not load embedded preview"))
    img.src = dataUrl
  })
}

function VariablesWorkspace() {
  const { activeDoc, dispatch, commit, requestRender } = useEditor()
  const [selectedId, setSelectedId] = React.useState("")
  const [rowIndex, setRowIndex] = React.useState(0)
  const [imageFiles, setImageFiles] = React.useState<File[]>([])
  const [bindingLayerId, setBindingLayerId] = React.useState("")
  const [bindingProperty, setBindingProperty] = React.useState<VariableBinding["property"]>("text")
  const [bindingColumn, setBindingColumn] = React.useState("")
  const [outputFormat, setOutputFormat] = React.useState<AutomationOutputPreset["format"]>("png")
  const [quality, setQuality] = React.useState(0.92)
  const [filenameTemplate, setFilenameTemplate] = React.useState("{{name}}-{{dataset}}-{{index}}")
  const [previewThumbnails, setPreviewThumbnails] = React.useState<{ index: number; dataUrl: string; label: string }[]>([])
  const [generatingPreviews, setGeneratingPreviews] = React.useState(false)
  if (!activeDoc) return <EmptyState text="Open a document before using variable data sets." />
  const dataSets = activeDoc.variableDataSets ?? []
  const selected = dataSets.find((set) => set.id === selectedId) ?? dataSets[0]
  const setDataSets = (next: VariableDataSet[]) => dispatch({ type: "set-variable-data-sets", dataSets: next })
  const columns = selected ? Array.from(new Set(selected.rows.flatMap((row) => Object.keys(row)))) : []
  const activeRow = selected?.rows[rowIndex] ?? null
  const importData = async (file: File) => {
    assertAdvancedFileSize(file, file.name.toLowerCase().endsWith(".json") ? ADVANCED_FILE_LIMITS.jsonBytes : ADVANCED_FILE_LIMITS.csvBytes, "Data set file")
    const text = await file.text()
    let imported: VariableDataSet[] = []
    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        const parsed: unknown = JSON.parse(text)
        if (isImportRecord(parsed) && parsed.format === "ps-variable-data-sets") {
          imported = parseVariableDataSetImportPayload(parsed, { doc: activeDoc, makeId: (prefix) => uid(prefix) })
        }
      } catch {
        imported = []
      }
    }
    if (!imported.length) {
      const parsed = parseDataset(text, file.name)
      const dataSet = buildDataset(file.name, parsed)
      imported = [{ ...dataSet, bindings: inferVariableBindings(activeDoc, parsed.columns) }]
    }
    setDataSets([...imported, ...dataSets])
    setSelectedId(imported[0]?.id ?? "")
    setRowIndex(0)
    setBindingLayerId(activeDoc.layers[0]?.id ?? "")
    setBindingColumn(Object.keys(imported[0]?.rows[0] ?? {})[0] ?? "")
  }
  const canvasForImageValue = async (value: string) => {
    const trimmed = value.trim()
    let img: HTMLImageElement | null = null
    let fileCanvas: HTMLCanvasElement | null = null
    if (/^data:image\//i.test(trimmed)) {
      img = await imageFromDataUrl(trimmed)
    } else {
      const base = trimmed.split(/[\\/]/).pop()?.toLowerCase()
      const file = imageFiles.find((item) => item.name.toLowerCase() === trimmed.toLowerCase() || item.name.toLowerCase() === base)
      if (file) fileCanvas = (await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })).canvas
    }
    if (fileCanvas) return fileCanvas
    if (!img) return null
    const canvas = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height)
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  }
  const addBinding = () => {
    if (!selected || !bindingLayerId || !bindingColumn) return
    const next = upsertBinding(selected, createBinding(bindingLayerId, bindingProperty, bindingColumn))
    setDataSets(dataSets.map((set) => set.id === selected.id ? next : set))
  }
  const updateBinding = (id: string, patch: Partial<VariableBinding>) => {
    if (!selected) return
    const next: VariableDataSet = {
      ...selected,
      bindings: selected.bindings.map((binding) => binding.id === id ? { ...binding, ...patch } : binding),
    }
    setDataSets(dataSets.map((set) => set.id === selected.id ? next : set))
  }
  const removeBinding = (id: string) => {
    if (!selected) return
    setDataSets(dataSets.map((set) => set.id === selected.id ? { ...set, bindings: set.bindings.filter((binding) => binding.id !== id) } : set))
  }
  const setActiveRow = (index: number) => {
    if (!selected) return
    const nextIndex = Math.max(0, Math.min(selected.rows.length - 1, Math.round(index)))
    setRowIndex(nextIndex)
    setDataSets(dataSets.map((set) => set.id === selected.id ? { ...set, activeRow: nextIndex } : set))
  }
  const exportSelectedSet = () => {
    if (!selected) return
    downloadText(JSON.stringify(buildVariableDataSetExportPayload([selected]), null, 2), `${selected.name}.psvars.json`, "application/json")
  }
  const exportSelectedRows = () => {
    if (!selected) return
    downloadText(serializeDatasetRowsCsv(selected.rows, columns), `${selected.name}.csv`, "text/csv")
  }
  const generatePreviewThumbnails = async () => {
    if (!selected || !selected.bindings.length) {
      toast.error("Add bindings before generating previews")
      return
    }
    setGeneratingPreviews(true)
    const maxPreviews = Math.min(selected.rows.length, 24)
    const thumbSize = 96
    const results: { index: number; dataUrl: string; label: string }[] = []
    try {
      for (let i = 0; i < maxPreviews; i++) {
        const row = selected.rows[i]
        const variant = await createVariableDocumentVariantAsync(
          activeDoc,
          row,
          selected.bindings,
          (value) => canvasForImageValue(value),
        )
        const flat = renderDocumentComposite(variant, { transparent: true })
        const scale = Math.min(thumbSize / flat.width, thumbSize / flat.height, 1)
        const tw = Math.max(1, Math.round(flat.width * scale))
        const th = Math.max(1, Math.round(flat.height * scale))
        const thumb = makeCanvas(tw, th)
        const tctx = thumb.getContext("2d")
        if (tctx) {
          tctx.imageSmoothingEnabled = true
          tctx.imageSmoothingQuality = "high"
          tctx.drawImage(flat, 0, 0, tw, th)
        }
        const firstCol = columns[0]
        const label = firstCol && row[firstCol] ? `${i + 1}: ${String(row[firstCol]).slice(0, 20)}` : `Row ${i + 1}`
        results.push({ index: i, dataUrl: thumb.toDataURL("image/png"), label })
      }
      setPreviewThumbnails(results)
      if (maxPreviews < selected.rows.length) {
        toast.info(`Showing previews for ${maxPreviews} of ${selected.rows.length} rows`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview generation failed")
    } finally {
      setGeneratingPreviews(false)
    }
  }
  const deleteSelectedSet = () => {
    if (!selected) return
    const next = dataSets.filter((set) => set.id !== selected.id)
    setDataSets(next)
    setSelectedId(next[0]?.id ?? "")
    setRowIndex(0)
  }
  const applyRow = async (row = selected?.rows[rowIndex]) => {
    if (!selected || !row) return
    for (const binding of selected.bindings) {
      const layer = activeDoc.layers.find((item) => item.id === binding.layerId)
      const value = row[binding.column]
      if (!layer || value === undefined) continue
      if (binding.property === "text" && layer.text) {
        dispatch({ type: "set-layer-text", id: layer.id, text: { ...layer.text, content: value } })
      } else if (binding.property === "visibility") {
        dispatch({ type: "set-layer-visibility", id: layer.id, visible: !/^(false|0|no|off)$/i.test(value.trim()) })
      } else if (binding.property === "opacity") {
        const opacity = Number(value)
        const normalized = Number.isFinite(opacity) && opacity <= 1 ? opacity : opacity / 100
        dispatch({ type: "set-layer-opacity", id: layer.id, opacity: Math.max(0, Math.min(1, normalized || 0)) })
      } else if (binding.property === "image") {
        const canvas = await canvasForImageValue(value)
        if (canvas) dispatch({ type: "replace-smart-object-contents", id: layer.id, canvas, source: { fileName: value.trim() || binding.column } })
      }
    }
    requestRender()
    window.setTimeout(() => commit("Apply Variable Data Set", "all"), 0)
  }
  const exportRows = async () => {
    if (!selected) return
    for (let index = 0; index < selected.rows.length; index++) {
      const row = selected.rows[index]
      const variant = await createVariableDocumentVariantAsync(activeDoc, row, selected.bindings, (value) => canvasForImageValue(value))
      const flat = renderDocumentComposite(variant, { transparent: true })
      const filename = renderTemplateName(filenameTemplate, row, index, { name: activeDoc.name, dataset: selected.name })
      await downloadCanvasWithPreset(flat, filename, { format: outputFormat, quality, transparent: true, matte: "#ffffff", filenameTemplate })
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel title="Data Sets">
        <FileButton accept=".csv,.json,.psvars,.psvars.json,text/csv,application/json" label="Import CSV / JSON / Set" onFile={importData} />
        <label className="flex cursor-pointer items-center justify-between rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2 text-[11px]">
          <span>{imageFiles.length ? `${imageFiles.length} image assets selected` : "Choose image assets"}</span>
          <input type="file" multiple accept="image/*" className="hidden" onChange={(event) => setImageFiles(Array.from(event.target.files ?? []))} />
        </label>
        <div className="mt-3 max-h-80 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {dataSets.map((set) => (
            <button key={set.id} type="button" onClick={() => { setSelectedId(set.id); setRowIndex(set.activeRow ?? 0) }} className={`grid w-full grid-cols-[1fr_auto] border-b border-[var(--ps-divider)] p-2 text-left text-[11px] ${selected?.id === set.id ? "bg-[var(--ps-tool-active)]" : "hover:bg-[var(--ps-tool-hover)]"}`}>
              <span>{set.name}</span>
              <span className="text-[var(--ps-text-dim)]">{set.rows.length} rows</span>
            </button>
          ))}
        </div>
        {selected ? (
          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" variant="secondary" onClick={exportSelectedSet}>Export Set</Button>
            <Button size="sm" variant="secondary" onClick={exportSelectedRows}>Export CSV</Button>
            <Button size="sm" variant="ghost" onClick={deleteSelectedSet}>Delete</Button>
          </div>
        ) : null}
        {selected && selected.bindings.length > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[var(--ps-text)]">Row Previews</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void generatePreviewThumbnails()}
                disabled={generatingPreviews}
                data-testid="variable-generate-previews"
              >
                {generatingPreviews ? "Generating…" : previewThumbnails.length ? "Refresh" : "Generate"}
              </Button>
            </div>
            {previewThumbnails.length > 0 ? (
              <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-chrome)] p-2" data-testid="variable-preview-grid">
                {previewThumbnails.map((thumb) => (
                  <button
                    key={thumb.index}
                    type="button"
                    onClick={() => setActiveRow(thumb.index)}
                    className={`flex flex-col items-center gap-1 rounded-sm border p-1 text-[9px] transition-colors ${
                      rowIndex === thumb.index
                        ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]"
                        : "border-[var(--ps-divider)] hover:border-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)]"
                    }`}
                    title={thumb.label}
                  >
                    <img src={thumb.dataUrl} alt={thumb.label} className="h-16 w-16 rounded-sm object-contain" />
                    <span className="w-full truncate text-center text-[var(--ps-text-dim)]">{thumb.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>
      <Panel title="Bindings & Output">
        {selected ? (
          <>
            <NumberField label="Row" value={rowIndex + 1} min={1} max={Math.max(1, selected.rows.length)} onChange={(value) => setActiveRow(value - 1)} />
            <div className="grid grid-cols-[1fr_120px_1fr_auto] gap-2">
              <SelectField label="Layer" value={bindingLayerId || activeDoc.layers[0]?.id || ""} options={activeDoc.layers.map((layer) => layer.id)} onChange={setBindingLayerId} />
              <SelectField label="Property" value={bindingProperty} options={["text", "visibility", "opacity", "image"]} onChange={(value) => setBindingProperty(value as VariableBinding["property"])} />
              <SelectField label="Column" value={bindingColumn || columns[0] || ""} options={columns.length ? columns : [""]} onChange={setBindingColumn} />
              <Button className="self-end" size="sm" onClick={addBinding}>Add</Button>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
              {selected.bindings.map((binding) => {
                const layer = activeDoc.layers.find((item) => item.id === binding.layerId)
                return (
                  <div key={binding.id} className="grid grid-cols-[1fr_108px_1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 text-[11px]">
                    <select value={binding.layerId} onChange={(event) => updateBinding(binding.id, { layerId: event.target.value })} className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1">
                      {activeDoc.layers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <select value={binding.property} onChange={(event) => updateBinding(binding.id, { property: event.target.value as VariableBinding["property"] })} className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1">
                      {["text", "visibility", "opacity", "image"].map((property) => <option key={property} value={property}>{property}</option>)}
                    </select>
                    <select value={binding.column} onChange={(event) => updateBinding(binding.id, { column: event.target.value })} className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1">
                      {columns.map((column) => <option key={column} value={column}>{column}</option>)}
                    </select>
                    <Button size="sm" variant="ghost" onClick={() => removeBinding(binding.id)}>{layer ? "Remove" : "Drop"}</Button>
                  </div>
                )
              })}
            </div>
            <div className="max-h-28 overflow-y-auto rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[10px]">
              {activeRow ? columns.map((column) => (
                <div key={column} className="grid grid-cols-[96px_1fr] gap-2 border-b border-[var(--ps-divider)]/40 py-0.5">
                  <span className="truncate text-[var(--ps-text-dim)]">{column}</span>
                  <span className="truncate">{activeRow[column]}</span>
                </div>
              )) : <span className="text-[var(--ps-text-dim)]">No row selected.</span>}
            </div>
            <div className="grid grid-cols-[1fr_80px] gap-2">
              <SelectField label="Format" value={outputFormat} options={["png", "jpeg", "webp", "gif", "avif"]} onChange={(value) => setOutputFormat(value as AutomationOutputPreset["format"])} />
              <NumberField label="Quality" value={quality} min={0.1} max={1} step={0.01} onChange={setQuality} />
            </div>
            <Input value={filenameTemplate} onChange={(event) => setFilenameTemplate(event.target.value)} className="h-8" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => void applyRow()}>Apply Row</Button>
              <Button size="sm" variant="secondary" onClick={() => void exportRows()}>Export All Rows</Button>
            </div>
          </>
        ) : <EmptyState text="Import a CSV to create text and visibility bindings." />}
      </Panel>
    </div>
  )
}
