"use client"

import { createHighBitImageFromImageData, type HighBitImage } from "./color-pipeline"
import { makeCanvas, makeDocument } from "./editor-context"
import { modeSettings, type NewDocumentPreset } from "./new-document-presets"
import type { PsDocument } from "./types"

type DocumentWithHighBitSource = PsDocument & { __highBitImageData?: HighBitImage }

export function createDocumentFromPreset(preset: NewDocumentPreset): PsDocument {
  const doc = makeDocument(preset.name, preset.w, preset.h, "#ffffff")
  doc.dpi = preset.dpi
  doc.colorMode = preset.mode
  doc.bitDepth = preset.bitDepth
  doc.modeSettings = modeSettings(preset.mode)

  if (preset.bitDepth > 8) {
    const sourceCanvas = makeCanvas(doc.width, doc.height)
    const sourceCtx = sourceCanvas.getContext("2d")!
    for (const layer of doc.layers) {
      if (layer.visible === false || layer.kind === "group") continue
      sourceCtx.drawImage(layer.canvas, 0, 0)
    }
    const sourcePixels = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
    ;(doc as DocumentWithHighBitSource).__highBitImageData = createHighBitImageFromImageData(sourcePixels, {
      bitDepth: preset.bitDepth,
      colorMode: preset.mode,
      profile: doc.colorManagement?.assignedProfile,
    })
  }

  return doc
}
