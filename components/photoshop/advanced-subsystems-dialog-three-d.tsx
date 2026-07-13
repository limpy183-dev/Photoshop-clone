"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  CapabilityNotice,
  ColorField,
  EmptyState,
  FileButton,
  NumberField,
  Panel,
  SelectField,
} from "./advanced-subsystems-dialog-controls"
import { createLayerFromCanvas, downloadCanvas } from "./advanced-subsystems-dialog-helpers"
import { useEditor } from "./editor-context"
import { downloadBlob, downloadText, loadRasterCanvasFromFile } from "./document-io"
import {
  ADVANCED_FILE_LIMITS,
  assertAdvancedFileSize,
  createPrimitiveThreeDScene,
  exportSceneToDae,
  exportSceneToObj,
  nudgeSceneVertex,
  parseDaeToScene,
  parseObjToScene,
  renderThreeDScene,
} from "./advanced-subsystems"
import {
  analyzeThreeDPrintReadiness,
  assignPlanarUvs,
  buildThreeDPrintPlan,
  createThreeDCrossSection,
  exportAdvancedThreeDScene,
  getBakedTextureCanvas,
  importAdvancedThreeDScene,
  paintThreeDSurface,
  rayTraceScene,
  replaceBakedTexture,
  updateThreeDMaterial,
} from "./three-d-video-engine"
import type { ThreeDScene } from "./types"

export function ThreeDWorkspace() {
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
