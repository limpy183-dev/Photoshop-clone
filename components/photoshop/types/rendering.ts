export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface ThreeDUv {
  u: number
  v: number
}

export interface ThreeDTexturePixel {
  u: number
  v: number
  radius: number
  color: string
  opacity: number
  blendMode?: "normal" | "multiply" | "screen" | "overlay"
}

export interface ThreeDTextureMap {
  width: number
  height: number
  pixels: ThreeDTexturePixel[]
  sourceName?: string
  /**
   * Optional baked atlas data. When painting accumulates into a real bitmap,
   * we store the bytes here so the texture round-trips as an editable image.
   * `dataUrl` is preferred for serialization round-trip (PSD app-preservation
   * envelope, U3D JSON subset, etc.); `bakedBytes` is populated for in-memory
   * hand-offs to layer canvases.
   */
  bakedBytes?: Uint8ClampedArray
  dataUrl?: string
}

export interface ThreeDTextureRef {
  /** Filename inside the source package (e.g. KMZ texture entries, MTL refs). */
  fileName?: string
  /** Mime type when known (image/png, image/jpeg). */
  mime?: string
  /** Optional base64-encoded payload when the source bundled the pixels. */
  dataBase64?: string
  /** Optional intensity / strength channel multiplier expressed in 0..1. */
  strength?: number
  /** UV tile/wrap mode when the source format records it. */
  wrap?: "repeat" | "clamp" | "mirror"
}

export interface ThreeDMaterialMaps {
  diffuse?: ThreeDTextureRef
  specular?: ThreeDTextureRef
  normal?: ThreeDTextureRef
  opacity?: ThreeDTextureRef
  bump?: ThreeDTextureRef
  emissive?: ThreeDTextureRef
}

export interface ThreeDVertexAnimationFrame {
  /** Frame time in milliseconds since stack start. */
  timeMs: number
  /** Per-vertex positions for this frame. Length must equal mesh vertex count. */
  positions: Vec3[]
}

export interface ThreeDFace {
  indices: number[]
  materialId?: string
  uvIndices?: number[]
}

export interface ThreeDMaterial {
  id: string
  name: string
  color: string
  metallic: number
  roughness: number
  opacity: number
  wireframe?: boolean
  texture?: ThreeDTextureMap
  uvScale?: { u: number; v: number }
  uvOffset?: { u: number; v: number }
  normalStrength?: number
  doubleSided?: boolean
  /** Optional per-channel external texture references discovered on import. */
  maps?: ThreeDMaterialMaps
  /** Free-form RGB specular tint, useful when 3DS/COLLADA records 0xA040+0xA041. */
  specularColor?: string
  /** Self-illumination ratio in 0..1 (3DS 0xA084 SHIN_STRENGTH / 0xA08A SELF_ILPCT). */
  emissiveStrength?: number
  /** Shininess in 0..1 used by formats with 0xA040 SHININESS. */
  shininess?: number
}

export interface ThreeDObject {
  id: string
  name: string
  vertices: Vec3[]
  faces: ThreeDFace[]
  uvs?: ThreeDUv[]
  materialId: string
  position: Vec3
  rotation: Vec3
  scale: Vec3
  visible?: boolean
  crossSection?: ThreeDCrossSection
  /**
   * Optional smoothing-group bitmask per face (3DS 0x4150). Bit n set means the
   * face contributes to smoothing group n+1, used to average normals across
   * neighboring faces in same group during shading.
   */
  smoothingGroups?: number[]
  /**
   * Optional vertex animation frames (morph targets / mesh shape keys).
   * Each frame holds per-vertex positions captured at `timeMs`. The browser
   * preview interpolates linearly between adjacent frames.
   */
  vertexAnimation?: ThreeDVertexAnimationFrame[]
}

export interface ThreeDCrossSection {
  axis: "x" | "y" | "z"
  position: number
  capMaterialId?: string
}

export interface ThreeDPrintIssue {
  kind: "non-manifold" | "thin-wall" | "oversized" | "empty" | "inverted-normal"
  severity: "info" | "warning" | "error"
  detail: string
}

export interface ThreeDPrintReport {
  ready: boolean
  bounds: { x: number; y: number; z: number }
  volumeEstimate: number
  issues: ThreeDPrintIssue[]
}

export type ThreeDAnimationTarget = "object" | "camera" | "material"
export type ThreeDAnimationProperty =
  | "position"
  | "rotation"
  | "scale"
  | "target"
  | "fov"
  | "focalLength"
  | "color"
  | "opacity"
  | "metallic"
  | "roughness"

export interface ThreeDAnimationKeyframe {
  timeMs: number
  value: Vec3 | number | string
  easing?: "hold" | "linear" | "ease-in" | "ease-out" | "ease-in-out"
}

export interface ThreeDAnimationTrack {
  id: string
  target: ThreeDAnimationTarget
  targetId?: string
  property: ThreeDAnimationProperty
  keyframes: ThreeDAnimationKeyframe[]
}

export interface ThreeDAnimationStack {
  id: string
  name: string
  durationMs: number
  loop?: boolean
  tracks: ThreeDAnimationTrack[]
}

export interface ThreeDPrintSlice {
  index: number
  z: number
  contours: Array<{
    points: Array<{ x: number; y: number }>
    closed: boolean
  }>
  segmentCount: number
  areaEstimate: number
}

export interface ThreeDPrintBrowserHandoff {
  kind: "download-gcode"
  driverIntegration: false
  fileName: string
  mime: string
  detail: string
}

export interface ThreeDPrintPlan {
  readiness: ThreeDPrintReport
  layerHeight: number
  nozzleDiameter: number
  filamentDiameter: number
  slices: ThreeDPrintSlice[]
  estimatedMaterialVolume: number
  estimatedPrintTimeMinutes: number
  browserHandoff: ThreeDPrintBrowserHandoff
  gcodePreview: string
  warnings: string[]
}

export interface ThreeDLight {
  id: string
  name: string
  kind: "ambient" | "directional" | "point"
  color: string
  intensity: number
  position?: Vec3
  direction?: Vec3
}

export interface ThreeDCamera {
  position: Vec3
  target: Vec3
  fov: number
  focalLength: number
}

export interface ThreeDScene {
  objects: ThreeDObject[]
  materials: ThreeDMaterial[]
  lights: ThreeDLight[]
  camera: ThreeDCamera
  renderMode: "solid" | "wireframe" | "solid-wire"
  background?: string
  selectedObjectId?: string
  selectedVertexIndex?: number
  animations?: ThreeDAnimationStack[]
  activeAnimationId?: string
  currentTimeMs?: number
}

export interface VideoKeyframe {
  id: string
  timeMs: number
  layerId: string
  property: "position" | "opacity" | "scale" | "rotation" | "style"
  value: number | { x: number; y: number } | Record<string, number | string | boolean>
  easing?: "hold" | "linear" | "ease-in" | "ease-out" | "ease-in-out"
}

export interface VideoTransition {
  id?: string
  kind: "hold" | "cross-dissolve" | "fade-black" | "fade-white" | "wipe-left" | "wipe-right"
  durationMs: number
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out"
  targetLayerId?: string
}

export interface AudioTrack {
  id: string
  name: string
  startMs: number
  durationMs: number
  volume: number
  muted?: boolean
  /** When any track in the mix is soloed, only soloed tracks should play. */
  solo?: boolean
  dataUrl?: string
  pan?: number
  fadeInMs?: number
  fadeOutMs?: number
  playbackRate?: number
}

export interface VideoLayerProps {
  sourceName: string
  /** Serializable source media used for browser video seeking, thumbnails, and frame extraction. */
  sourceDataUrl?: string
  durationMs: number
  currentTimeMs: number
  playbackRate: number
  inPointMs: number
  outPointMs: number
  keyframes: VideoKeyframe[]
  audioTracks?: AudioTrack[]
  posterDataUrl?: string
  transitions?: VideoTransition[]
  trackGroupId?: string
  trimHandles?: { inMs: number; outMs: number }
}

export interface VideoGroupProps {
  id: string
  name: string
  layerIds: string[]
  durationMs: number
  transition?: VideoTransition["kind"]
}

export interface VideoExportPreset {
  id: string
  label: string
  width: number
  height: number
  fps: number
  codec: "h264" | "vp9" | "webm" | "gif" | "png-sequence"
  bitrateKbps: number
  audioKbps: number
  container: "mp4" | "webm" | "gif" | "zip"
}

export type PluginPermission =
  | "document:read"
  | "layers:read"
  | "layers:write"
  | "filters:write"
  | "commands"
  | "storage"
  | "ui"

export type PluginCommandAction =
  | { type: "open-panel" }
  | { type: "apply-filter" }
  | { type: "post-message"; message?: unknown }
  | { type: "batch-play"; descriptors: PluginActionDescriptor[] }
  | { type: "eval-script"; source: string }

export interface PluginActionDescriptor {
  _obj: string
  _target?: unknown[]
  [key: string]: unknown
}

export interface PluginCommandDescriptor {
  id: string
  title: string
  group?: string
  description?: string
  requiredPermissions?: PluginPermission[]
  action: PluginCommandAction
}

export interface PluginUxpEntrypoint {
  id: string
  type: "panel" | "command"
  label: string
}

export interface PluginUxpManifestSummary {
  manifestVersion: number
  id: string
  main?: string
  hostApp?: string
  minVersion?: string
  entrypoints: PluginUxpEntrypoint[]
}

export interface PluginCepManifestSummary {
  extensionId: string
  bundleName: string
  bundleVersion?: string
  host?: string
  mainPath?: string
}

export interface PluginEightBfBinarySummary {
  fileName: string
  byteLength: number
  signature: string
  executable: boolean
  reason: string
}

export interface PluginManifestSignatureSummary {
  signed: boolean
  verified: boolean
  signer?: string
  algorithm?: string
  digest?: string
  reason: string
}

export interface PluginMarketplaceMetadata {
  bundleId?: string
  rating?: number
  ratingsCount?: number
  dependencyWarnings?: string[]
  signature?: PluginManifestSignatureSummary
}

export interface PluginDescriptor {
  id: string
  name: string
  kind: "cep-panel" | "ux-plugin" | "8bf-filter"
  enabled: boolean
  manifestVersion?: number
  version?: string
  author?: string
  description?: string
  dependencies?: string[]
  marketplace?: PluginMarketplaceMetadata
  permissions?: PluginPermission[]
  capabilities?: string[]
  runtimeAdapters?: Array<"browser" | "uxp" | "cep" | "8bf-native">
  uxpManifest?: PluginUxpManifestSummary
  cepManifest?: PluginCepManifestSummary
  binary8bf?: PluginEightBfBinarySummary
  panelHtml?: string
  commands?: PluginCommandDescriptor[]
  storageDefaults?: Record<string, unknown>
  filterKernel?: number[]
  filterBias?: number
  filterDivisor?: number
  installedAt?: number
  source?: "sample" | "registry" | "import" | "package"
  trusted?: boolean
  createdAt: number
}

export interface VariableBinding {
  id: string
  layerId: string
  property: "text" | "visibility" | "opacity" | "image"
  column: string
}

export interface VariableDataSet {
  id: string
  name: string
  rows: Record<string, string>[]
  bindings: VariableBinding[]
  activeRow?: number
}
