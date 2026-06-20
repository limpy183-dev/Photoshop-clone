import type { Layer, PsDocument } from "./types"

export interface CommandAvailability {
  id: string
  label: string
  enabled: boolean
  reason?: string
}

export function documentCommandAvailability(doc: PsDocument | null | undefined): CommandAvailability[] {
  return [
    {
      id: "file.save-project",
      label: "Save Project",
      enabled: !!doc,
      reason: doc ? undefined : "Open a document before saving.",
    },
    {
      id: "file.export-psd",
      label: "Export PSD",
      enabled: !!doc,
      reason: doc ? undefined : "Open a document before exporting.",
    },
    {
      id: "review.export-packet",
      label: "Export Review Packet",
      enabled: !!doc && !!doc.notes?.length,
      reason: !doc ? "Open a document before exporting review packets." : doc.notes?.length ? undefined : "Add comments or annotations before exporting a review packet.",
    },
  ]
}

export function layerCommandAvailability(layer: Layer | null | undefined): CommandAvailability[] {
  return [
    {
      id: "layer.duplicate",
      label: "Duplicate Layer",
      enabled: !!layer,
      reason: layer ? undefined : "Select a layer before duplicating.",
    },
    {
      id: "layer.edit-smart-object",
      label: "Edit Smart Object",
      enabled: !!layer?.smartObject || layer?.kind === "smart-object",
      reason: layer?.smartObject || layer?.kind === "smart-object" ? undefined : "Select a smart object layer.",
    },
  ]
}
