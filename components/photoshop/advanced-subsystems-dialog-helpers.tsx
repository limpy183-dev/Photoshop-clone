"use client"

import { makeCanvas } from "./editor-context"
import { canvasToGifDataUrl, downloadBlob, downloadDataUrl, rasterMime } from "./document-io"
import { uid } from "./uid"
import type { AutomationOutputPreset } from "./automation-engine"
import type { Layer, PsDocument } from "./types"

export function canvasToDataUrl(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/png")
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("Could not read file"))
    reader.readAsDataURL(file)
  })
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  downloadDataUrl(canvas.toDataURL("image/png"), filename)
}

export async function downloadCanvasWithPreset(canvas: HTMLCanvasElement, filename: string, output: AutomationOutputPreset) {
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

export function createLayerFromCanvas(doc: PsDocument, name: string, canvas: HTMLCanvasElement, patch?: Partial<Layer>): Layer {
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

export function imageFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Could not load embedded preview"))
    img.src = dataUrl
  })
}
