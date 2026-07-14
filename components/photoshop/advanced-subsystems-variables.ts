import type { Layer, PsDocument, VariableBinding } from "./types"
import { clamp, createSubsystemCanvas } from "./advanced-subsystems-shared"

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' && text[i + 1] === '"') {
      cell += '"'
      i++
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === "," && !quoted) {
      row.push(cell)
      cell = ""
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ""
    } else {
      cell += ch
    }
  }
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  const headers = rows.shift()?.map((value) => value.trim()) ?? []
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])))
}

function drawTextLayer(canvas: HTMLCanvasElement, text: NonNullable<Layer["text"]>) {
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const size = text.size
  ctx.font = `${text.italic ? "italic " : ""}${text.weight} ${size}px ${text.font}`
  ctx.fillStyle = text.color
  ctx.textAlign = text.align
  ctx.textBaseline = "alphabetic"
  const content = text.allCaps ? text.content.toUpperCase() : text.content
  const words = content.split(/\s+/)
  const lines: string[] = []
  const maxWidth = text.boxWidth ?? canvas.width - text.x
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (text.boxWidth && ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  lines.push(line)
  const leading = text.leading ?? size * 1.2
  lines.forEach((lineText, index) => ctx.fillText(lineText, text.x, text.y + index * leading + (text.baselineShift ?? 0)))
}

export function createVariableDocumentVariant(doc: PsDocument, row: Record<string, string>, bindings: VariableBinding[]) {
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      let next: Layer = { ...layer }
      for (const binding of bindings.filter((item) => item.layerId === layer.id)) {
        const value = row[binding.column]
        if (value === undefined) continue
        if (binding.property === "text" && next.text) {
          const canvas = createSubsystemCanvas(layer.canvas.width, layer.canvas.height)
          const text = { ...next.text, content: value }
          next = { ...next, canvas, text }
          drawTextLayer(canvas, text)
        } else if (binding.property === "visibility") {
          next = { ...next, visible: !/^(false|0|no|off)$/i.test(value.trim()) }
        } else if (binding.property === "opacity") {
          next = { ...next, opacity: clamp(Number(value), 0, 100) / 100 }
        }
      }
      return next
    }),
  }
}

export type VariableImageResolver = (
  value: string,
  binding: VariableBinding,
  row: Record<string, string>,
) => Promise<HTMLCanvasElement | null>

function drawImageContained(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  const ctx = target.getContext("2d")!
  ctx.clearRect(0, 0, target.width, target.height)
  const scale = Math.min(target.width / source.width, target.height / source.height)
  const width = Math.max(1, source.width * scale)
  const height = Math.max(1, source.height * scale)
  const x = (target.width - width) / 2
  const y = (target.height - height) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, x, y, width, height)
}

export async function createVariableDocumentVariantAsync(
  doc: PsDocument,
  row: Record<string, string>,
  bindings: VariableBinding[],
  resolveImage?: VariableImageResolver,
) {
  const layers = await Promise.all(doc.layers.map(async (layer) => {
    let next: Layer = { ...layer }
    for (const binding of bindings.filter((item) => item.layerId === layer.id)) {
      const value = row[binding.column]
      if (value === undefined) continue
      if (binding.property === "text" && next.text) {
        const canvas = createSubsystemCanvas(layer.canvas.width, layer.canvas.height)
        const text = { ...next.text, content: value }
        next = { ...next, canvas, text }
        drawTextLayer(canvas, text)
      } else if (binding.property === "visibility") {
        next = { ...next, visible: !/^(false|0|no|off)$/i.test(value.trim()) }
      } else if (binding.property === "opacity") {
        next = { ...next, opacity: clamp(Number(value), 0, 100) / 100 }
      } else if (binding.property === "image" && resolveImage) {
        const source = await resolveImage(value, binding, row)
        if (source) {
          const canvas = createSubsystemCanvas(layer.canvas.width, layer.canvas.height)
          drawImageContained(canvas, source)
          next = { ...next, canvas, kind: next.kind ?? "raster" }
        }
      }
    }
    return next
  }))
  return { ...doc, layers }
}
