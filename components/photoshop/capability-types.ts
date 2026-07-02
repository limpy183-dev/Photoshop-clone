export type CapabilityStatus =
  | "complete"
  | "usable"
  | "approximation"
  | "stub"
  | "unsupported"

export type CapabilityKind =
  | "tool"
  | "filter"
  | "panel"
  | "format"
  | "export"
  | "color"
  | "smart-object"
  | "typography"
  | "3d"
  | "video"
  | "workflow"
  | "external"
  | "performance"
  | "preferences"

export interface CapabilityRecord {
  id: string
  label: string
  kind: CapabilityKind
  status: CapabilityStatus
  summary: string
  limitations?: string[]
  recommendedAction?: string
  dependsOn?: string[]
  testCoverage?: "none" | "reachability" | "unit" | "e2e" | "golden"
}

export interface CapabilityWarning {
  label: string
  capabilityId: string
  status: CapabilityStatus
  detail: string
  recommendedAction?: string
}

export interface CapabilityDocumentSnapshot {
  colorMode?: string
  bitDepth?: number
  layers?: Array<{
    kind?: string
    smartObject?: boolean
    smartFilters?: Array<{ enabled?: boolean }>
    adjustment?: unknown
    frame?: unknown
    artboard?: unknown
    threeD?: unknown
    video?: unknown
    plugins?: unknown
  }>
  plugins?: unknown[]
  variableDataSets?: unknown[]
  comps?: unknown[]
  slices?: unknown[]
  guides?: unknown[]
  metadata?: unknown
  colorManagement?: unknown
}
