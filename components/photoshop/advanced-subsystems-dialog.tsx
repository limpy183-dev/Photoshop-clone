"use client"

import * as React from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditor, makeCanvas } from "./editor-context"
import { downloadDataUrl, downloadText, loadImageFromFile, renderDocumentComposite } from "./document-io"
import {
  ADVANCED_FORMAT_CAPABILITIES,
  applyPluginFilterToCanvas,
  buildPrintPreviewCanvas,
  buildPrintPreviewReport,
  capabilityForAdvancedFormat,
  convertCanvasToDocumentMode,
  createPrimitiveThreeDScene,
  createSubsystemCanvas,
  createVariableDocumentVariant,
  decodeDicomPreview,
  decodeRadianceHdrPreview,
  exportSceneToDae,
  exportSceneToObj,
  extractEmbeddedJpegDataUrl,
  extractMetadataFromFile,
  inspectAdvancedFormatFile,
  makeXmpMetadata,
  nudgeSceneVertex,
  parseCsv,
  parseDaeToScene,
  parseObjToScene,
  renderThreeDScene,
} from "./advanced-subsystems"
import {
  VIDEO_EXPORT_PRESETS,
  analyzeThreeDPrintReadiness,
  applyVideoTransition,
  assignPlanarUvs,
  buildAudioMixPlan,
  convertVideoTimelineToFrameAnimation,
  createThreeDCrossSection,
  createVideoGroup,
  exportAdvancedThreeDScene,
  importAdvancedThreeDScene,
  paintThreeDSurface,
  rayTraceScene,
  resolveVideoExportPreset,
  splitVideoLayer,
  trimVideoClip,
  updateThreeDMaterial,
} from "./three-d-video-engine"
import { describeColorPipeline } from "./color-pipeline"
import { decodeAdvancedRasterBuffer, decodedRasterToCanvas } from "./raster-codecs"
import type {
  AssetLibraryItem,
  AudioTrack,
  ContentCredential,
  DocumentModeSettings,
  Layer,
  PluginDescriptor,
  PrintSettings,
  PsDocument,
  ThreeDScene,
  VariableBinding,
  VariableDataSet,
  VideoKeyframe,
  VideoLayerProps,
} from "./types"

export type AdvancedSubsystemTab =
  | "3d"
  | "video"
  | "print"
  | "preview"
  | "automation"
  | "provenance"
  | "plugins"
  | "libraries"
  | "color"
  | "formats"
  | "variables"

interface AdvancedSubsystemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab: AdvancedSubsystemTab
}

const TABS: { id: AdvancedSubsystemTab; label: string }[] = [
  { id: "3d", label: "3D" },
  { id: "video", label: "Video" },
  { id: "print", label: "Print" },
  { id: "preview", label: "Preview" },
  { id: "automation", label: "Automation" },
  { id: "provenance", label: "Provenance" },
  { id: "plugins", label: "Plugins" },
  { id: "libraries", label: "Libraries" },
  { id: "color", label: "Color" },
  { id: "formats", label: "Formats" },
  { id: "variables", label: "Variables" },
]

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

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

export function AdvancedSubsystemsDialog({ open, onOpenChange, initialTab }: AdvancedSubsystemsDialogProps) {
  const [tab, setTab] = React.useState<AdvancedSubsystemTab>(initialTab)
  React.useEffect(() => {
    if (open) setTab(initialTab)
  }, [initialTab, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[1120px] overflow-hidden border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0 text-[var(--ps-text)]">
        <DialogHeader className="border-b border-[var(--ps-divider)] px-4 py-3">
          <DialogTitle className="text-sm">Advanced Photoshop Subsystems</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-[680px] grid-cols-[160px_1fr]">
          <div className="border-r border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`mb-1 flex h-8 w-full items-center rounded-sm px-3 text-left text-[12px] ${tab === item.id ? "bg-[var(--ps-accent)] text-white" : "hover:bg-[var(--ps-tool-hover)]"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 overflow-y-auto p-4">
            {tab === "3d" && <ThreeDWorkspace />}
            {tab === "video" && <VideoWorkspace />}
            {tab === "print" && <PrintWorkspace />}
            {tab === "preview" && <DevicePreviewWorkspace />}
            {tab === "automation" && <AutomationWorkspace />}
            {tab === "provenance" && <ProvenanceWorkspace />}
            {tab === "plugins" && <PluginWorkspace />}
            {tab === "libraries" && <LibrariesWorkspace />}
            {tab === "color" && <ColorWorkspace />}
            {tab === "formats" && <FormatsWorkspace />}
            {tab === "variables" && <VariablesWorkspace />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
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
  }, [activeLayer?.id])

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
    const lower = file.name.toLowerCase()
    const next = lower.endsWith(".3ds") || lower.endsWith(".kmz") || lower.endsWith(".u3d")
      ? importAdvancedThreeDScene(await file.arrayBuffer(), file.name).scene
      : lower.endsWith(".dae")
        ? parseDaeToScene(await file.text())
        : parseObjToScene(await file.text())
    setScene(next)
    toast.success(`Imported ${file.name}`)
  }

  const exportAdvanced = (format: "3ds" | "kmz" | "u3d") => {
    const result = exportAdvancedThreeDScene(scene, format, activeDoc.name)
    downloadText(typeof result.data === "string" ? result.data : new TextDecoder().decode(result.data), result.fileName, result.mime)
    toast.info(result.warnings[0])
  }

  const assignUvs = () => {
    setScene(assignPlanarUvs(scene, object?.id))
    toast.success("Planar UVs assigned")
  }

  const paintSurface = () => {
    if (!object) return
    setScene(paintThreeDSurface(assignPlanarUvs(scene, object.id), object.id, { u: 0.5, v: 0.5, radius: 0.15, color: material?.color ?? "#5ec8ff", opacity: 1 }))
    toast.success("Paint stroke stored on 3D surface texture")
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
            <Button size="sm" variant="secondary" onClick={crossSection}>Cross Section</Button>
            <Button size="sm" variant="secondary" onClick={runPrintCheck}>3D Print Check</Button>
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
  const [progress, setProgress] = React.useState("")
  const [presetId, setPresetId] = React.useState("social-1080p")
  const [frameConversion, setFrameConversion] = React.useState("")
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
      const capture = await captureVideoFrame(file, timeMs, activeDoc.width, activeDoc.height)
      const video: VideoLayerProps = {
        sourceName: file.name,
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
        <Button disabled={rendering} onClick={renderVideo}>{rendering ? "Rendering..." : "Render Video"}</Button>
        <Button className="mt-2" size="sm" variant="secondary" disabled={!frames.length} onClick={convertFrames}>Convert to Frame Animation</Button>
        <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">{progress || "Uses H.264 MP4 when the browser exposes it, otherwise WebM."}</p>
        {frameConversion ? <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">{frameConversion}</p> : null}
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
      colorHandling: "app",
      proofPrint: false,
      printerProfile: "Working CMYK",
      paperColor: "#ffffff",
      marksOffsetMm: 4,
      pagePosition: "center",
      ...(activeDoc.printSettings ?? {}),
    })
  }, [activeDoc?.id])

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
    const win = window.open("", "_blank")
    if (!win) return
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
        <CheckField label="Registration marks" checked={settings.registrationMarks} onChange={(checked) => update({ registrationMarks: checked })} />
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
  type: "droplet" | "script-event" | "conditional-action"
  actionId?: string
  event?: string
  condition?: string
  falseActionId?: string
  format?: "png" | "webp" | "jpeg"
  manualOnly?: boolean
}

function conditionPasses(doc: PsDocument, condition = "always") {
  if (condition === "has-selection") return !!doc.selection.bounds
  if (condition === "has-active-layer") return !!doc.activeLayerId
  if (condition === "multi-layer") return doc.layers.filter((layer) => layer.kind !== "group").length > 1
  if (condition === "rgb") return doc.colorMode === "RGB"
  if (condition === "print-ready") return !!doc.printSettings?.cropMarks || !!doc.printSettings?.registrationMarks
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
  if (!activeDoc) return <EmptyState text="Open a document before creating automation." />

  const assets = activeDoc.assetLibrary ?? []
  const automationAssets = assets.filter((asset) => asset.group === "Automation" && automationAssetPayload(asset))
  const firstActionId = actionId || actions[0]?.id || ""
  const setAssets = (next: AssetLibraryItem[]) => dispatch({ type: "set-asset-library", assets: next })
  const addAutomation = (type: AutomationPayload["type"]) => {
    if (!firstActionId && type !== "script-event") return
    const payload: AutomationPayload = {
      type,
      actionId: firstActionId,
      falseActionId: falseActionId || undefined,
      condition,
      event,
      format: "png",
      manualOnly: true,
    }
    setAssets([{ id: uid("auto"), name: name || type, kind: "prepress", group: "Automation", payload, createdAt: Date.now() }, ...assets])
  }
  const runPayload = (payload: AutomationPayload) => {
    if (!conditionPasses(activeDoc, payload.condition)) {
      if (payload.type === "conditional-action" && payload.falseActionId) playAction(payload.falseActionId)
      else toast.info("Automation condition did not match this document.")
      return
    }
    if (payload.actionId) playAction(payload.actionId)
  }
  const exportAsset = (asset: AssetLibraryItem) => {
    downloadText(JSON.stringify({ app: "Photoshop Web", format: "psdroplet", version: 1, asset }, null, 2), `${asset.name}.psdroplet.json`, "application/json")
  }
  const importDroplet = async (file: File) => {
    const parsed = JSON.parse(await file.text()) as { asset?: AssetLibraryItem }
    if (!parsed.asset) throw new Error("Droplet file does not contain an asset.")
    setAssets([{ ...parsed.asset, id: uid("auto"), createdAt: Date.now() }, ...assets])
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel title="Create Local Automation">
        <CapabilityNotice>
          Script events are stored as local descriptors and exported with their event label. They are manual-only in this browser build; app lifecycle events are not subscribed automatically.
        </CapabilityNotice>
        <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
        <SelectField label="Action" value={firstActionId} options={actions.length ? actions.map((action) => action.id) : [""]} onChange={setActionId} />
        <SelectField label="If" value={condition} options={["always", "has-selection", "has-active-layer", "multi-layer", "rgb", "print-ready"]} onChange={setCondition} />
        <SelectField label="Else" value={falseActionId} options={["", ...actions.map((action) => action.id)]} onChange={setFalseActionId} />
        <SelectField label="Event" value={event} options={["Document Open", "Before Export", "After Save", "Layer Changed", "History Commit"]} onChange={setEvent} />
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" disabled={!actions.length} onClick={() => addAutomation("droplet")}>Droplet</Button>
          <Button size="sm" disabled={!actions.length} variant="secondary" onClick={() => addAutomation("script-event")}>Script Event</Button>
          <Button size="sm" disabled={!actions.length} variant="secondary" onClick={() => addAutomation("conditional-action")}>Conditional</Button>
        </div>
        <FileButton accept=".json,.psdroplet,.psdroplet.json,application/json" label="Import Droplet" onFile={importDroplet} />
      </Panel>
      <Panel title="Installed Automations">
        <div className="max-h-[520px] overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {automationAssets.length ? automationAssets.map((asset) => {
            const payload = automationAssetPayload(asset)!
            const action = actions.find((item) => item.id === payload.actionId)
            return (
              <div key={asset.id} className="grid grid-cols-[1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 text-[11px]">
                <div>
                  <div className="font-medium">{asset.name}</div>
                  <div className="text-[var(--ps-text-dim)]">{payload.type} - {payload.event ?? "manual"} - {payload.condition ?? "always"} - {payload.manualOnly === false ? "event-routed" : "manual-only"} - {action?.name ?? "No action"}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => runPayload(payload)}>Run</Button>
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
    const parsed = JSON.parse(await file.text()) as { credentials?: ContentCredential[] } | ContentCredential
    const imported = Array.isArray((parsed as { credentials?: ContentCredential[] }).credentials)
      ? (parsed as { credentials: ContentCredential[] }).credentials
      : [parsed as ContentCredential]
    dispatch({ type: "set-document-metadata", metadata: { ...(activeDoc.metadata ?? {}), contentCredentials: [...imported, ...credentials] } })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel title="Local Content Credentials">
        <CapabilityNotice>
          Local SHA-256 provenance manifests only. Not C2PA signed or embedded in exported images, and no certificate chain is created.
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

const SAMPLE_PLUGINS: PluginDescriptor[] = [
  { id: "plug_sharpen", name: "8BF-style Sharpen Kernel", kind: "8bf-filter", enabled: true, version: "1.0", filterKernel: [0, -1, 0, -1, 5, -1, 0, -1, 0], filterDivisor: 1, filterBias: 0, createdAt: Date.now() },
  { id: "plug_emboss", name: "8BF-style Emboss Kernel", kind: "8bf-filter", enabled: true, version: "1.0", filterKernel: [-2, -1, 0, -1, 1, 1, 0, 1, 2], filterDivisor: 1, filterBias: 128, createdAt: Date.now() },
  { id: "plug_cep", name: "CEP-style HTML Info Panel", kind: "cep-panel", enabled: true, version: "1.0", panelHtml: "<style>body{font:13px system-ui;background:#181818;color:#eee;padding:12px}</style><h3>Local Panel</h3><p>Rendered as sandboxed HTML inside Photoshop Web. It cannot call Photoshop APIs.</p>", createdAt: Date.now() },
]

function PluginWorkspace() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [selectedId, setSelectedId] = React.useState("")
  if (!activeDoc) return <EmptyState text="Open a document before installing plugins." />
  const plugins = activeDoc.plugins ?? []
  const selected = plugins.find((plugin) => plugin.id === selectedId) ?? plugins[0]
  const setPlugins = (next: PluginDescriptor[]) => dispatch({ type: "set-plugins", plugins: next })
  const addSamples = () => {
    const merged = [...SAMPLE_PLUGINS.map((plugin) => ({ ...plugin, id: uid("plugin"), createdAt: Date.now() })), ...plugins]
    setPlugins(merged)
    dispatch({
      type: "set-asset-library",
      assets: [
        ...SAMPLE_PLUGINS.map((plugin) => ({ id: uid("asset"), name: plugin.name, kind: "plugin" as const, group: "Plugins", payload: plugin, createdAt: Date.now() })),
        ...(activeDoc.assetLibrary ?? []),
      ],
    })
  }
  const importPlugin = async (file: File) => {
    const parsed = JSON.parse(await file.text()) as PluginDescriptor | { plugins: PluginDescriptor[] }
    const imported = Array.isArray((parsed as { plugins?: PluginDescriptor[] }).plugins) ? (parsed as { plugins: PluginDescriptor[] }).plugins : [parsed as PluginDescriptor]
    setPlugins([...imported.map((plugin) => ({ ...plugin, id: uid("plugin"), createdAt: Date.now(), enabled: plugin.enabled !== false })), ...plugins])
  }
  const applyFilter = () => {
    if (!activeLayer || !selected || selected.kind !== "8bf-filter") return
    const out = applyPluginFilterToCanvas(activeLayer.canvas, selected)
    activeLayer.canvas.getContext("2d")!.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    activeLayer.canvas.getContext("2d")!.drawImage(out, 0, 0)
    requestRender()
    window.setTimeout(() => commit(`Apply Plugin: ${selected.name}`, [activeLayer.id]), 0)
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Panel title="Installed Local Plugins">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" onClick={addSamples}>Install Samples</Button>
          <FileButton accept=".json,application/json" label="Import JSON" onFile={importPlugin} />
        </div>
        <div className="mt-3 max-h-96 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {plugins.map((plugin) => (
            <button key={plugin.id} type="button" onClick={() => setSelectedId(plugin.id)} className={`grid w-full grid-cols-[1fr_auto] border-b border-[var(--ps-divider)] p-2 text-left text-[11px] ${selected?.id === plugin.id ? "bg-[var(--ps-tool-active)]" : "hover:bg-[var(--ps-tool-hover)]"}`}>
              <span>{plugin.name}</span>
              <span className="text-[var(--ps-text-dim)]">{plugin.kind}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Plugin Runtime">
        <CapabilityNotice>
          No native 8BF, UXP, or CEP execution. This runtime applies JSON-described 3x3 kernels and displays sandboxed HTML panels only.
        </CapabilityNotice>
        {selected ? (
          <>
            <div className="mb-2 text-[12px]">{selected.name}</div>
            {selected.kind === "8bf-filter" ? <Button size="sm" disabled={!activeLayer} onClick={applyFilter}>Apply Kernel to Active Layer</Button> : null}
            {selected.panelHtml ? <iframe title={selected.name} sandbox="" srcDoc={selected.panelHtml} className="mt-3 h-72 w-full rounded-sm border border-[var(--ps-divider)] bg-white" /> : null}
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => downloadText(JSON.stringify(selected, null, 2), `${selected.name}.plugin.json`)}>Export Descriptor</Button>
          </>
        ) : <EmptyState text="Install or import a plugin descriptor." />}
      </Panel>
    </div>
  )
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
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const canvas = createSubsystemCanvas(activeDoc.width, activeDoc.height)
      canvas.getContext("2d")!.drawImage(img, 0, 0, activeDoc.width, activeDoc.height)
      dispatch({ type: "add-layer", layer: createLayerFromCanvas(activeDoc, "Stock Image", canvas) })
      window.setTimeout(() => commit("Place Stock Image", "all"), 0)
    }
    img.onerror = () => toast.error("Could not load the stock URL. Try an image URL that allows browser access.")
    img.src = stockUrl
    addAsset({ name: "Stock link", kind: "stock", group: "Adobe Stock-style Links", payload: { url: stockUrl } })
  }
  const importFont = async (file: File) => {
    const family = fontName || file.name.replace(/\.[^.]+$/, "")
    const data = await file.arrayBuffer()
    const face = new FontFace(family, data)
    await face.load()
    document.fonts.add(face)
    addAsset({ name: family, kind: "font", group: "Adobe Fonts-style Local Fonts", payload: { family, fileName: file.name } })
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

function ColorWorkspace() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [settings, setSettings] = React.useState<DocumentModeSettings>({ mode: "RGB" })
  const [allowDestructiveApply, setAllowDestructiveApply] = React.useState(false)
  React.useEffect(() => {
    if (activeDoc) setSettings(activeDoc.modeSettings ?? { mode: activeDoc.colorMode })
  }, [activeDoc?.id, activeDoc?.colorMode])
  if (!activeDoc) return <EmptyState text="Open a document before changing color management." />
  const color = activeDoc.colorManagement ?? {
    assignedProfile: "sRGB IEC61966-2.1" as const,
    workingSpace: "sRGB IEC61966-2.1" as const,
    renderingIntent: "relative-colorimetric" as const,
    blackPointCompensation: true,
    proofProfile: "None" as const,
    proofColors: false,
    gamutWarning: false,
  }
  const pipeline = describeColorPipeline({
    bitDepth: activeDoc.bitDepth === 32 ? 32 : activeDoc.bitDepth === 16 ? 16 : 8,
    colorMode: activeDoc.colorMode,
    profile: color.assignedProfile,
  })
  const updateColor = (patch: Partial<typeof color>) => {
    dispatch({ type: "set-color-management", settings: { ...color, ...patch } })
    requestRender()
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
      <Panel title="Profile Metadata & Simulated Proofing">
        <CapabilityNotice>
          Profile assignment and proofing use local RGB/CMYK/Lab math for visual guidance. High-bit data can be represented in typed arrays for algorithms, but browser canvas display/export remains 8-bit RGBA and this is not ICC-accurate production proofing.
        </CapabilityNotice>
        <SelectField label="Assign Profile" value={color.assignedProfile} options={["sRGB IEC61966-2.1", "Display P3", "Adobe RGB (1998)", "ProPhoto RGB", "Working CMYK", "Dot Gain 20%", "Gray Gamma 2.2"]} onChange={(value) => updateColor({ assignedProfile: value as typeof color.assignedProfile })} />
        <SelectField label="Working Space" value={color.workingSpace} options={["sRGB IEC61966-2.1", "Display P3", "Adobe RGB (1998)", "ProPhoto RGB", "Working CMYK"]} onChange={(value) => updateColor({ workingSpace: value as typeof color.workingSpace })} />
        <SelectField label="Rendering Intent" value={color.renderingIntent} options={["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"]} onChange={(value) => updateColor({ renderingIntent: value as typeof color.renderingIntent })} />
        <SelectField label="Proof Profile" value={color.proofProfile} options={["None", "Working CMYK", "U.S. Web Coated SWOP v2", "Japan Color 2001 Coated", "Display P3", "Dot Gain 20%"]} onChange={(value) => updateColor({ proofProfile: value as typeof color.proofProfile })} />
        <CheckField label="Proof colors in canvas and exports" checked={color.proofColors} onChange={(checked) => updateColor({ proofColors: checked })} />
        <CheckField label="Gamut warning overlay" checked={color.gamutWarning} onChange={(checked) => updateColor({ gamutWarning: checked })} />
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
  const importAdvanced = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    const notes = [`Opened ${file.name}`]
    let canvas: HTMLCanvasElement | null = null
    try {
      const inspection = await inspectAdvancedFormatFile(file)
      const capability = capabilityForAdvancedFormat(file.name, file.type)
      notes.push(`Detected ${capability.label}: ${capability.supportLabel}`)
      const advancedRaster = decodeAdvancedRasterBuffer(await file.arrayBuffer(), file.name)
      if (advancedRaster) {
        canvas = decodedRasterToCanvas(advancedRaster)
        notes.push(`Decoded ${advancedRaster.format}: ${advancedRaster.width}x${advancedRaster.height}, ${advancedRaster.channels} channel(s), source ${advancedRaster.bitDepth}-bit ${advancedRaster.colorModel}`)
        notes.push(...advancedRaster.warnings)
      } else if (file.type.startsWith("image/")) {
        try {
          const img = await loadImageFromFile(file)
          canvas = createSubsystemCanvas(img.naturalWidth, img.naturalHeight)
          canvas.getContext("2d")!.drawImage(img, 0, 0)
          notes.push(ext === "gif" ? "Browser decoded a static GIF frame; animation frames are not imported" : "Browser decoded raster image natively")
        } catch {
          notes.push(`Browser could not decode ${capability.label}; no layer was created`)
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
          canvas = createSubsystemCanvas(img.naturalWidth, img.naturalHeight)
          canvas.getContext("2d")!.drawImage(img, 0, 0)
          notes.push("Imported embedded RAW/DNG JPEG preview")
        } else {
          notes.push("RAW metadata scanned; no embedded JPEG preview was found")
        }
      } else if (ext === "exr" || ext === "psb") {
        notes.push(`${ext.toUpperCase()} is metadata-only here; browser-native full pixel decode is not available`)
      }
      const extracted = await extractMetadataFromFile(file)
      if (activeDoc && Object.keys(extracted.metadata).length) dispatch({ type: "set-document-metadata", metadata: extracted.metadata })
      if (canvas) addCanvas(canvas, file.name)
      else notes.push("No pixel layer was created")
      setLog([...notes, ...inspection.technical, ...extracted.technical])
    } catch (error) {
      const message = error instanceof Error ? error.message : "Advanced import failed"
      notes.push(`Import failed: ${message}`)
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
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Advanced Import">
        <FileButton accept="image/*,.tif,.tiff,.tga,.vda,.icb,.vst,.pbm,.pgm,.ppm,.pnm,.raw,.dng,.cr2,.nef,.arw,.dcm,.dicom,.exr,.hdr,.rgbe,.psb" label="Import Advanced Raster/RAW/DICOM/EXR/HDR/PSB" onFile={importAdvanced} />
        <div className="mt-3 rounded-sm border border-[var(--ps-divider)] p-3 text-[11px] text-[var(--ps-text-dim)]">
          Imports create browser 8-bit RGBA layers only when a decoder path is available. TIFF/TGA/PNM use local baseline decoders, RAW/DNG use embedded previews, DICOM/HDR are limited previews, and EXR/PSB remain metadata-only or unsupported for full decode.
        </div>
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
  if (!activeDoc) return <EmptyState text="Open a document before using variable data sets." />
  const dataSets = activeDoc.variableDataSets ?? []
  const selected = dataSets.find((set) => set.id === selectedId) ?? dataSets[0]
  const setDataSets = (next: VariableDataSet[]) => dispatch({ type: "set-variable-data-sets", dataSets: next })
  const importCsv = async (file: File) => {
    const rows = parseCsv(await file.text())
    const headers = Object.keys(rows[0] ?? {})
    const bindings: VariableBinding[] = []
    for (const layer of activeDoc.layers) {
      if (layer.text) {
        const exact = headers.find((header) => header.toLowerCase() === layer.name.toLowerCase()) ?? headers.find((header) => header.toLowerCase() === "text") ?? headers[0]
        if (exact) bindings.push({ id: uid("bind"), layerId: layer.id, property: "text", column: exact })
      }
      const visible = headers.find((header) => header.toLowerCase() === `show_${layer.name.toLowerCase()}`)
      if (visible) bindings.push({ id: uid("bind"), layerId: layer.id, property: "visibility", column: visible })
    }
    const dataSet: VariableDataSet = { id: uid("data"), name: file.name, rows, bindings, activeRow: 0 }
    setDataSets([dataSet, ...dataSets])
    setSelectedId(dataSet.id)
    setRowIndex(0)
  }
  const applyRow = (row = selected?.rows[rowIndex]) => {
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
        dispatch({ type: "set-layer-opacity", id: layer.id, opacity: Math.max(0, Math.min(1, Number(value) / 100)) })
      }
    }
    requestRender()
    window.setTimeout(() => commit("Apply Variable Data Set", "all"), 0)
  }
  const exportRows = () => {
    if (!selected) return
    selected.rows.forEach((row, index) => {
      const variant = createVariableDocumentVariant(activeDoc, row, selected.bindings)
      const flat = renderDocumentComposite(variant, { transparent: true })
      downloadCanvas(flat, `${activeDoc.name}-${selected.name}-${String(index + 1).padStart(2, "0")}.png`)
    })
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel title="Data Sets">
        <FileButton accept=".csv,text/csv" label="Import CSV" onFile={importCsv} />
        <div className="mt-3 max-h-80 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {dataSets.map((set) => (
            <button key={set.id} type="button" onClick={() => setSelectedId(set.id)} className={`grid w-full grid-cols-[1fr_auto] border-b border-[var(--ps-divider)] p-2 text-left text-[11px] ${selected?.id === set.id ? "bg-[var(--ps-tool-active)]" : "hover:bg-[var(--ps-tool-hover)]"}`}>
              <span>{set.name}</span>
              <span className="text-[var(--ps-text-dim)]">{set.rows.length} rows</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Bindings & Output">
        {selected ? (
          <>
            <NumberField label="Row" value={rowIndex + 1} min={1} max={Math.max(1, selected.rows.length)} onChange={(value) => setRowIndex(Math.max(0, Math.min(selected.rows.length - 1, Math.round(value) - 1)))} />
            <div className="max-h-56 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
              {selected.bindings.map((binding) => {
                const layer = activeDoc.layers.find((item) => item.id === binding.layerId)
                return <div key={binding.id} className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-[var(--ps-divider)] p-2 text-[11px]"><span>{layer?.name ?? "Missing layer"}</span><span>{binding.property}</span><span className="text-[var(--ps-text-dim)]">{binding.column}</span></div>
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => applyRow()}>Apply Row</Button>
              <Button size="sm" variant="secondary" onClick={exportRows}>Export All Rows</Button>
            </div>
          </>
        ) : <EmptyState text="Import a CSV to create text and visibility bindings." />}
      </Panel>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3">
      <h3 className="mb-3 text-[12px] font-semibold text-[var(--ps-text)]">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function CapabilityNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2 text-[11px] leading-5 text-[var(--ps-text-dim)]">
      {children}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-sm border border-[var(--ps-divider)] p-6 text-center text-[12px] text-[var(--ps-text-dim)]">{text}</div>
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="grid grid-cols-[110px_1fr_64px] items-center gap-2 text-[11px]">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <Input type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} className="h-7 px-2 text-[11px]" />
    </label>
  )
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="grid grid-cols-[110px_1fr] items-center gap-2 text-[11px]">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 text-[11px]">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid grid-cols-[110px_36px_1fr] items-center gap-2 text-[11px]">
      <span className="text-[var(--ps-text-dim)]">{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-9 bg-transparent" />
      <Input value={value} onChange={(event) => onChange(event.target.value)} className="h-7 px-2 text-[11px]" />
    </label>
  )
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function FileButton({ accept, label, onFile }: { accept: string; label: string; onFile: (file: File) => void | Promise<void> }) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onFile(file)
          event.currentTarget.value = ""
        }}
      />
      <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>{label}</Button>
    </>
  )
}
