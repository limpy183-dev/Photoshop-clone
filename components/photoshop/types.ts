export type ToolId =
  | "move"
  | "marquee-rect"
  | "marquee-ellipse"
  | "marquee-row"
  | "marquee-col"
  | "lasso"
  | "lasso-polygon"
  | "lasso-magnetic"
  | "magic-wand"
  | "quick-selection"
  | "object-select"
  | "refine-edge-brush"
  | "crop"
  | "perspective-crop"
  | "slice"
  | "slice-select"
  | "frame"
  | "eyedropper"
  | "ruler"
  | "note"
  | "count"
  | "color-sampler"
  | "red-eye"
  | "spot-healing"
  | "healing-brush"
  | "patch-tool"
  | "content-aware-move"
  | "brush"
  | "pencil"
  | "mixer-brush"
  | "clone-stamp"
  | "history-brush"
  | "art-history-brush"
  | "eraser"
  | "gradient"
  | "paint-bucket"
  | "blur"
  | "sharpen"
  | "smudge"
  | "dodge"
  | "burn"
  | "sponge"
  | "pen"
  | "freeform-pen"
  | "curvature-pen"
  | "add-anchor-point"
  | "delete-anchor-point"
  | "convert-point"
  | "type"
  | "type-vertical"
  | "type-mask-horizontal"
  | "type-mask-vertical"
  | "path-select"
  | "direct-select"
  | "shape-rect"
  | "shape-rounded-rect"
  | "shape-ellipse"
  | "shape-polygon"
  | "shape-triangle"
  | "shape-line"
  | "custom-shape"
  | "artboard"
  | "hand"
  | "rotate-view"
  | "zoom"
  | "transform"
  | "select-subject"
  | "remove-tool"
  | "select-sky"
  | "select-background"
  | "color-replace"
  | "pattern-stamp"
  | "magic-eraser"
  | "background-eraser"
  | "material-eyedropper"
  | "material-drop"

export interface SelectionOptions {
  mode: "new" | "add" | "subtract" | "intersect"
  feather: number
  antiAlias: boolean
  tolerance: number
  contiguous: boolean
  sampleAllLayers?: boolean
}

export interface TextOptions {
  font: string
  size: number
  weight: "normal" | "bold"
  italic: boolean
  align: "left" | "center" | "right"
}

export interface ShapeOptions {
  fill: string
  stroke: string
  strokeWidth: number
  radius: number
}

export interface CropState {
  active: boolean
  bounds: { x: number; y: number; w: number; h: number } | null
}

export interface TransformState {
  active: boolean
  layerId: string
  source: HTMLCanvasElement | null
  bounds: { x: number; y: number; w: number; h: number }
  tx: number
  ty: number
  rotation: number
  scaleX: number
  scaleY: number
  skewX: number
  skewY: number
  referencePoint?: "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br"
  constrainProportions?: boolean
  interpolation?: "nearest" | "bilinear" | "bicubic" | "bicubic-smoother" | "bicubic-sharper"
  perspective?: {
    tl: { x: number; y: number }
    tr: { x: number; y: number }
    br: { x: number; y: number }
    bl: { x: number; y: number }
  }
}

export type BlendMode =
  | "normal"
  | "dissolve"
  | "behind"
  | "clear"
  | "darken"
  | "multiply"
  | "color-burn"
  | "linear-burn"
  | "darker-color"
  | "lighten"
  | "screen"
  | "color-dodge"
  | "linear-dodge"
  | "lighter-color"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "vivid-light"
  | "linear-light"
  | "pin-light"
  | "hard-mix"
  | "difference"
  | "exclusion"
  | "subtract"
  | "divide"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"

export type LayerKind =
  | "raster"
  | "text"
  | "shape"
  | "group"
  | "smart-object"
  | "adjustment"
  | "frame"
  | "artboard"
  | "3d"
  | "video"

export type WarpStyle =
  | "none"
  | "arc"
  | "arch"
  | "bulge"
  | "flag"
  | "wave"
  | "fish"
  | "rise"
  | "squeeze"
  | "twist"

export type TextAntiAliasMode = "none" | "sharp" | "crisp" | "strong" | "smooth"

export interface TypographyAxisDefinition {
  tag: string
  name: string
  min: number
  max: number
  defaultValue: number
}

export interface OpenTypeControls {
  ligatures?: boolean
  discretionaryLigatures?: boolean
  contextualAlternates?: boolean
  stylisticAlternates?: boolean
  swash?: boolean
  ordinals?: boolean
  fractions?: boolean
  smallCaps?: boolean
  oldstyleFigures?: boolean
  tabularFigures?: boolean
}

export interface TextExtrusionOptions {
  enabled: boolean
  depth: number
  bevel: number
  angle: number
  color?: string
}

export interface TextProps {
  content: string
  font: string
  size: number
  weight: "normal" | "bold"
  italic: boolean
  color: string
  align: "left" | "center" | "right"
  x: number
  y: number
  /** Area text bounds. When width is set, text wraps inside the box. */
  boxWidth?: number
  boxHeight?: number
  /** Basic editable text path control points for path-bound type tools. */
  textPath?: { x: number; y: number }[]
  /** Render glyphs top-to-bottom for vertical type layers. */
  vertical?: boolean
  /** Per-character overrides stored as editable metadata. */
  characterStyles?: { start: number; end: number; style: Partial<Pick<TextProps, "font" | "size" | "weight" | "italic" | "color" | "tracking">> }[]
  /** Anti-alias rendering on/off. Defaults true. */
  antiAlias?: boolean
  /** Photoshop-style text anti-alias preset. Defaults to smooth. */
  antiAliasMode?: TextAntiAliasMode
  /** CSS variable font axis values, keyed by four-letter axis tag. */
  variableAxes?: Record<string, number>
  /** Optional axis definitions discovered from a loaded font. */
  variableAxisDefinitions?: TypographyAxisDefinition[]

  /* --- Character properties --- */
  /** Character spacing in 1/1000 em units (-200 to 500). */
  tracking?: number
  /** Line height in px. "auto" uses size * 1.2. */
  leading?: number
  /** Kerning: "metrics" (font default), "optical", or number in 1/1000 em. */
  kerning?: "metrics" | "optical" | number
  /** Baseline shift in px (negative = down, positive = up). */
  baselineShift?: number
  /** Text decorations */
  underline?: boolean
  strikethrough?: boolean
  /** Case transforms */
  allCaps?: boolean
  smallCaps?: boolean
  /** Superscript / subscript */
  superscript?: boolean
  subscript?: boolean

  /* --- Paragraph properties --- */
  /** Text justification */
  justify?: "left" | "center" | "right" | "justify-left" | "justify-center" | "justify-right" | "justify-all"
  /** First line indent in px. */
  indentFirst?: number
  /** Left indent in px. */
  indentLeft?: number
  /** Right indent in px. */
  indentRight?: number
  /** Space before paragraph in px. */
  spaceBefore?: number
  /** Space after paragraph in px. */
  spaceAfter?: number
  /** Enable auto-hyphenation. */
  hyphenation?: boolean
  ligatures?: boolean
  discretionaryLigatures?: boolean
  contextualAlternates?: boolean
  stylisticAlternates?: boolean
  swash?: boolean
  ordinals?: boolean
  fractions?: boolean
  oldstyleFigures?: boolean
  tabularFigures?: boolean
  openType?: OpenTypeControls

  /** Shape metadata used as an editable area-text container and clipping path. */
  textShape?: ShapeProps
  textShapeInset?: number

  /** Optional warp transformation. */
  warp?: { style: WarpStyle; bend: number; horizontal: number; vertical: number }
  /** Browser-native 3D extrusion metadata used to generate 3D text scene layers. */
  extrusion?: TextExtrusionOptions
}

export type CustomShapeId =
  | "star5"
  | "star6"
  | "heart"
  | "arrow-right"
  | "arrow-left"
  | "arrow-up"
  | "arrow-down"
  | "speech"
  | "check"
  | "cross"
  | "lightning"
  | "polygon-hex"
  | "polygon-tri"
  | "diamond"

export interface ShapeProps {
  type: "rect" | "ellipse" | "custom" | "polygon"
  x: number
  y: number
  w: number
  h: number
  fill: string
  stroke: { color: string; width: number } | null
  radius?: number
  /** When type === "custom", which library glyph. */
  customId?: CustomShapeId
  /** When type === "polygon", how many sides. */
  sides?: number
  booleanOperation?: "new" | "unite" | "subtract" | "intersect" | "exclude"
}

export interface PathPoint {
  x: number
  y: number
  cp1?: { x: number; y: number }
  cp2?: { x: number; y: number }
}

export interface PathProps {
  points: PathPoint[]
  closed: boolean
}

export interface GradientStop {
  /** 0..1 along the gradient. */
  offset: number
  color: string
  opacity: number
}

export interface MultiGradient {
  type: "linear" | "radial" | "angular" | "reflected" | "diamond"
  angle: number
  stops: GradientStop[]
}

export interface LayerStyle {
  stroke?: {
    enabled: boolean
    color: string
    size: number
    position: "inside" | "outside" | "center"
    opacity?: number
    blendMode?: BlendMode
    fillType?: "color" | "gradient"
    gradient?: MultiGradient
  }
  outerGlow?: {
    enabled: boolean
    color: string
    size: number
    opacity: number
    blendMode?: BlendMode
    spread?: number
    range?: number
    noise?: number
    contour?: "linear" | "soft" | "sharp" | "ring" | "cone"
  }
  innerGlow?: {
    enabled: boolean
    color: string
    size: number
    opacity: number
    blendMode?: BlendMode
    source?: "edge" | "center"
    choke?: number
    range?: number
    noise?: number
    contour?: "linear" | "soft" | "sharp" | "ring" | "cone"
  }
  innerShadow?: {
    enabled: boolean
    color: string
    size: number
    offsetX: number
    offsetY: number
    opacity: number
    blendMode?: BlendMode
    angle?: number
    distance?: number
    choke?: number
    useGlobalLight?: boolean
  }
  bevel?: {
    enabled: boolean
    style: "inner" | "outer" | "emboss" | "pillow"
    direction?: "up" | "down"
    depth: number
    size: number
    soften: number
    angle: number
    altitude: number
    highlight: string
    shadow: string
    opacity: number
    highlightOpacity?: number
    shadowOpacity?: number
    highlightBlendMode?: BlendMode
    shadowBlendMode?: BlendMode
    useGlobalLight?: boolean
    contour?: "linear" | "soft" | "sharp" | "ring" | "cone"
  }
  satin?: {
    enabled: boolean
    color: string
    angle: number
    distance: number
    size: number
    opacity: number
    blendMode?: BlendMode
  }
  colorOverlay?: { enabled: boolean; color: string; opacity: number; blendMode?: BlendMode }
  gradientOverlay?: {
    enabled: boolean
    gradient: MultiGradient
    opacity: number
    blendMode?: BlendMode
  }
  patternOverlay?: {
    enabled: boolean
    pattern: "checker" | "dots" | "lines" | "noise"
    scale: number
    opacity: number
    color: string
    blendMode?: BlendMode
  }
  dropShadow?: {
    enabled: boolean
    color: string
    size: number
    offsetX: number
    offsetY: number
    opacity: number
    blendMode?: BlendMode
    angle?: number
    distance?: number
    spread?: number
    noise?: number
    useGlobalLight?: boolean
    contour?: "linear" | "soft" | "sharp" | "ring" | "cone"
  }
}

export interface BlendIfRange {
  black: number
  blackFeather: number
  whiteFeather: number
  white: number
}

export interface AdvancedBlending {
  fillOpacity: number
  knockout: "none" | "shallow" | "deep"
  channels: { r: boolean; g: boolean; b: boolean }
  blendIfThis: BlendIfRange
  blendIfUnderlying: BlendIfRange
}

export interface SmartFilter {
  id: string
  filterId: string
  name: string
  enabled: boolean
  opacity?: number
  blendMode?: BlendMode
  params: Record<string, number | string | boolean>
  mask?: HTMLCanvasElement | null
  maskEnabled?: boolean
}

export interface SmartObjectSource {
  width: number
  height: number
  canvas?: HTMLCanvasElement | null
  id?: string
  name?: string
  linkType?: "embedded" | "linked"
  fileName?: string
  relativePath?: string
  status?: "current" | "missing" | "modified" | "embedded"
  embedded?: boolean
  updatedAt?: number
}

export type AdjustmentType =
  | "brightness-contrast"
  | "levels"
  | "curves"
  | "exposure"
  | "vibrance"
  | "hue-saturation"
  | "color-balance"
  | "black-white"
  | "photo-filter"
  | "channel-mixer"
  | "color-lookup"
  | "invert"
  | "posterize"
  | "threshold"
  | "gradient-map"
  | "selective-color"
  | "shadows-highlights"
  | "hdr-toning"
  | "desaturate"
  | "match-color"
  | "replace-color"
  | "equalize"

export interface AdjustmentProps {
  type: AdjustmentType
  /** Free-form params per adjustment type. */
  params: Record<string, number | string | boolean>
}

export interface FrameProps {
  shape: "rect" | "ellipse"
  x: number
  y: number
  w: number
  h: number
  /** Optional fitted image dataURL or canvas. */
  imageCanvas?: HTMLCanvasElement | null
}

export interface ArtboardProps {
  x: number
  y: number
  w: number
  h: number
  background: string
}

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
  dataUrl?: string
  pan?: number
  fadeInMs?: number
  fadeOutMs?: number
  playbackRate?: number
}

export interface VideoLayerProps {
  sourceName: string
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

export interface PluginDescriptor {
  id: string
  name: string
  kind: "cep-panel" | "ux-plugin" | "8bf-filter"
  enabled: boolean
  version?: string
  author?: string
  permissions?: string[]
  panelHtml?: string
  filterKernel?: number[]
  filterBias?: number
  filterDivisor?: number
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

export interface DocumentModeSettings {
  mode: "RGB" | "CMYK" | "Grayscale" | "Duotone" | "Indexed" | "Multichannel" | "Bitmap"
  duotone?: { ink1: string; ink2: string; curve: number }
  indexed?: { colors: number; dither: boolean }
  multichannel?: { channels: { r: boolean; g: boolean; b: boolean; c?: boolean; m?: boolean; y?: boolean; k?: boolean } }
  bitmap?: { method: "threshold" | "halftone"; threshold: number; frequency: number; angle: number }
  trap?: { enabled: boolean; widthPx: number; strength: number }
}

export interface Layer {
  id: string
  name: string
  kind?: LayerKind
  visible: boolean
  locked: boolean
  /** Granular Photoshop-style locks */
  lockTransparency?: boolean
  lockDraw?: boolean
  lockMove?: boolean
  lockAll?: boolean
  smartObject?: boolean
  opacity: number
  /** Fill opacity dims only layer pixels, not layer styles. 0..1 */
  fillOpacity?: number
  advancedBlending?: AdvancedBlending
  blendMode: BlendMode
  linkGroupId?: string
  canvas: HTMLCanvasElement
  /** Optional grayscale mask canvas - white reveals, black hides. */
  mask?: HTMLCanvasElement | null
  /** False keeps the mask stored but temporarily disables it in compositing. */
  maskEnabled?: boolean
  /** Optional vector path mask (rendered as grayscale mask before composite). */
  vectorMask?: PathProps | null
  /** Whether this layer is clipped to the layer beneath it. */
  clipped?: boolean
  style?: LayerStyle
  childIds?: string[]
  parentId?: string
  expanded?: boolean
  text?: TextProps
  shape?: ShapeProps
  path?: PathProps
  /** Adjustment-layer config when kind === "adjustment". */
  adjustment?: AdjustmentProps
  /** Frame-layer config when kind === "frame". */
  frame?: FrameProps
  /** Artboard config when kind === "artboard". */
  artboard?: ArtboardProps
  /** Browser-native 3D scene metadata and rasterized preview when kind === "3d". */
  threeD?: ThreeDScene
  /** Browser-native video layer metadata and current-frame pixels when kind === "video". */
  video?: VideoLayerProps
  videoGroup?: VideoGroupProps
  /** User-controlled color tag for organization. */
  colorLabel?: "none" | "red" | "orange" | "yellow" | "green" | "blue" | "violet" | "gray"
  smartFilters?: SmartFilter[]
  smartSource?: SmartObjectSource
}

export interface Selection {
  bounds: { x: number; y: number; w: number; h: number } | null
  shape: "rect" | "ellipse" | "polygon" | "freehand" | "wand" | "color"
  mask?: HTMLCanvasElement | null
  feather?: number
}

/** Saved alpha channel for selection save/load */
export interface AlphaChannel {
  id: string
  name: string
  canvas: HTMLCanvasElement
}

export interface Guide {
  id: string
  orientation: "horizontal" | "vertical"
  position: number
  color?: string
}

export interface Note {
  id: string
  x: number
  y: number
  author: string
  text: string
  color: string
}

export interface Slice {
  id: string
  x: number
  y: number
  w: number
  h: number
  name: string
}

export interface CountMarker {
  id: string
  x: number
  y: number
  group: string
  /** Index within group. */
  number: number
}

export interface ColorSampler {
  id: string
  x: number
  y: number
  label: string
  rgba: [number, number, number, number]
}

export interface LayerComp {
  id: string
  name: string
  /** Snapshot of visibility, appearance metadata, masks, and editable layer props per layer. */
  state: Record<
    string,
    {
      visible: boolean
      opacity: number
      fillOpacity?: number
      blendMode: BlendMode
      clipped?: boolean
      maskEnabled?: boolean
      vectorMask?: PathProps | null
      style?: LayerStyle
      text?: TextProps
      shape?: ShapeProps
      path?: PathProps
      adjustment?: AdjustmentProps
      smartFilters?: SmartFilter[]
      colorLabel?: Layer["colorLabel"]
    }
  >
  activeLayerId?: string
  selectedLayerIds?: string[]
  createdAt?: number
  updatedAt?: number
}

export interface AssetLibraryItem {
  id: string
  name: string
  kind:
    | "brush"
    | "gradient"
    | "pattern"
    | "style"
    | "swatch"
    | "shape"
    | "export"
    | "tool-preset"
    | "plugin"
    | "cloud-library"
    | "stock"
    | "font"
    | "icc-profile"
    | "variable-data"
    | "prepress"
  group?: string
  payload: unknown
  createdAt: number
}

export interface TimelineFrame {
  id: string
  name: string
  durationMs: number
  layerVisibility: Record<string, boolean>
  layerOpacity?: Record<string, number>
  transition?: "hold" | "dissolve" | VideoTransition["kind"]
  audioLabel?: string
  compId?: string
  keyframes?: VideoKeyframe[]
  audioTracks?: AudioTrack[]
}

export interface DocumentReport {
  id: string
  title: string
  createdAt: number
  source: "PSD Import" | "PSD Export" | "Project Import" | "Project Export" | "Batch Export"
  items: { label: string; status: "preserved" | "approximated" | "flattened" | "unsupported" | "info"; detail: string }[]
}

export interface DocumentMetadata {
  title?: string
  author?: string
  description?: string
  copyright?: string
  keywords?: string[]
  credit?: string
  source?: string
  createdAt?: string
  modifiedAt?: string
  /** Local, browser-generated provenance manifests inspired by Content Credentials. */
  contentCredentials?: ContentCredential[]
}

export interface ContentCredential {
  id: string
  action: string
  actor: string
  software: string
  createdAt: string
  documentName: string
  documentHash: string
  layerCount: number
  dimensions: { width: number; height: number }
  ingredients: { id: string; name: string; kind?: LayerKind; visible: boolean; hash: string }[]
  assertion: string
}

export interface ColorManagementSettings {
  assignedProfile: "sRGB IEC61966-2.1" | "Display P3" | "Adobe RGB (1998)" | "ProPhoto RGB" | "Working CMYK" | "Dot Gain 20%" | "Gray Gamma 2.2"
  workingSpace: "sRGB IEC61966-2.1" | "Display P3" | "Adobe RGB (1998)" | "ProPhoto RGB" | "Working CMYK"
  renderingIntent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric"
  blackPointCompensation: boolean
  proofProfile: "None" | "Working CMYK" | "U.S. Web Coated SWOP v2" | "Japan Color 2001 Coated" | "Display P3" | "Dot Gain 20%"
  proofColors: boolean
  gamutWarning: boolean
  simulateBlackInk?: boolean
  preserveNumbers?: boolean
}

export interface PrintSettings {
  paperSize: "Letter" | "A4" | "A3" | "Tabloid" | "Custom"
  orientation: "portrait" | "landscape"
  scale: number
  bleedMm: number
  cropMarks: boolean
  registrationMarks: boolean
  colorHandling: "app" | "printer"
  proofPrint: boolean
  printerProfile?: ColorManagementSettings["proofProfile"]
  paperColor?: string
  marksOffsetMm?: number
  pagePosition?: "center" | "top-left"
}

export interface PsDocument {
  id: string
  name: string
  width: number
  height: number
  zoom: number
  layers: Layer[]
  activeLayerId: string
  selectedLayerIds: string[]
  background: string
  colorMode: DocumentModeSettings["mode"]
  bitDepth: 8 | 16 | 32
  selection: Selection
  rotation?: 0 | 90 | 180 | 270
  guides?: Guide[]
  showGrid?: boolean
  showSmartGuides?: boolean
  gridSize?: number
  snap?: boolean
  snapToGrid?: boolean
  snapToGuides?: boolean
  quickMask?: boolean
  quickMaskCanvas?: HTMLCanvasElement | null
  /** Collaborative notes attached to the doc. */
  notes?: Note[]
  /** Web export slices. */
  slices?: Slice[]
  /** Active slice selected by the Slice Select tool/panel. */
  selectedSliceId?: string
  /** Count tool markers (per-group). */
  counts?: CountMarker[]
  countGroup?: string
  /** Persistent color sampler readouts from the Color Sampler tool. */
  colorSamplers?: ColorSampler[]
  /** Saved layer comps. */
  comps?: LayerComp[]
  /** Active ruler measurement (HUD info). */
  measurement?: {
    x1: number
    y1: number
    x2: number
    y2: number
  } | null
  /** Saved alpha channels for selection save/load. */
  channels?: AlphaChannel[]
  rulerUnits?: "px" | "in" | "cm" | "mm" | "pt" | "pc"
  rulerOrigin?: { x: number; y: number }
  gridColor?: string
  gridSubdivisions?: number
  gridOpacity?: number
  showPixelGrid?: boolean
  globalLight?: { angle: number; altitude: number }
  patternLibrary?: { id: string; name: string; type: "checker" | "dots" | "lines" | "noise"; color: string; scale: number }[]
  stylePresets?: { id: string; name: string; style: LayerStyle }[]
  gradientPresets?: { id: string; name: string; gradient: MultiGradient }[]
  characterStyles?: Record<string, Partial<TextProps>>
  paragraphStyles?: Record<string, Record<string, number | string | boolean>>
  assetLibrary?: AssetLibraryItem[]
  timelineFrames?: TimelineFrame[]
  plugins?: PluginDescriptor[]
  variableDataSets?: VariableDataSet[]
  modeSettings?: DocumentModeSettings
  reports?: DocumentReport[]
  metadata?: DocumentMetadata
  colorManagement?: ColorManagementSettings
  printSettings?: PrintSettings
  smartObjectParent?: { docId: string; layerId: string }
  /** Dots per inch resolution metadata. */
  dpi?: number
}

export interface CanvasPatch {
  x: number
  y: number
  w: number
  h: number
  canvas: HTMLCanvasElement
}

/** A snapshot of one layer's pixels + metadata, used by history. */
export interface LayerSnapshot {
  id: string
  name: string
  kind?: LayerKind
  visible: boolean
  locked: boolean
  lockTransparency?: boolean
  lockDraw?: boolean
  lockMove?: boolean
  lockAll?: boolean
  smartObject?: boolean
  opacity: number
  fillOpacity?: number
  advancedBlending?: AdvancedBlending
  blendMode: BlendMode
  linkGroupId?: string
  canvas: HTMLCanvasElement | null
  canvasPatches?: CanvasPatch[]
  mask?: HTMLCanvasElement | null
  maskEnabled?: boolean
  vectorMask?: PathProps | null
  clipped?: boolean
  style?: LayerStyle
  childIds?: string[]
  parentId?: string
  expanded?: boolean
  text?: TextProps
  shape?: ShapeProps
  path?: PathProps
  adjustment?: AdjustmentProps
  frame?: FrameProps
  artboard?: ArtboardProps
  threeD?: ThreeDScene
  video?: VideoLayerProps
  colorLabel?: Layer["colorLabel"]
  smartFilters?: SmartFilter[]
  smartSource?: Layer["smartSource"]
}

export interface HistoryEntry {
  id: string
  label: string
  layers: LayerSnapshot[]
  activeLayerId: string
  selectedLayerIds: string[]
  thumb?: string
  width?: number
  height?: number
  selection?: Selection
  guides?: Guide[]
  notes?: Note[]
  slices?: Slice[]
  counts?: CountMarker[]
  colorSamplers?: ColorSampler[]
  comps?: LayerComp[]
  channels?: AlphaChannel[]
  quickMask?: boolean
  quickMaskCanvas?: HTMLCanvasElement | null
  colorMode?: PsDocument["colorMode"]
  modeSettings?: DocumentModeSettings
  variableDataSets?: VariableDataSet[]
  assetLibrary?: AssetLibraryItem[]
}

export interface HistorySnapshot {
  id: string
  name: string
  createdAt: number
  entry: HistoryEntry
}

export interface MacroStep {
  id: string
  label: string
  createdAt: number
  entry: HistoryEntry
}

export interface MacroAction {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  steps: MacroStep[]
}

export interface BrushSettings {
  size: number
  hardness: number
  opacity: number
  flow: number
  smoothing: number
  spacing?: number
  tipShape?: "round" | "square" | "bristle" | "erodible"
  sizeControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  angleControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  roundnessControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  /** Shape Dynamics */
  sizeJitter?: number          // 0–100 % random size variation
  angleJitter?: number         // 0–360 degrees random rotation
  roundnessJitter?: number     // 0–100 % random ellipse squash
  flipX?: boolean
  flipY?: boolean
  minDiameter?: number         // 0–100 % of size as floor
  /** Scattering */
  scatter?: number             // 0–1000 % distance scatter perpendicular to stroke
  scatterCount?: number        // 1–16 stamps per spacing interval
  scatterCountJitter?: number  // 0–100 % random count variation
  /** Color Dynamics */
  fgBgJitter?: number          // 0–100 % chance of using background color
  hueJitter?: number           // 0–100 % hue shift range
  satJitter?: number           // 0–100 % saturation shift range
  brightJitter?: number        // 0–100 % brightness shift range
  purity?: number
  /** Transfer */
  opacityJitter?: number       // 0–100 % random opacity variation
  flowJitter?: number          // 0–100 % random flow variation
  opacityControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  flowControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  texture?: {
    enabled: boolean
    pattern: "noise" | "canvas" | "paper" | "linen"
    mode: "multiply" | "subtract" | "burn"
    depth: number
    depthJitter: number
    minDepth: number
    scale: number
  }
  dualBrush?: {
    enabled: boolean
    size: number
    spacing: number
    scatter: number
    count: number
    mode: "multiply" | "screen" | "subtract"
  }
  pose?: {
    tiltX: number
    tiltY: number
    rotation: number
    pressure: number
    stylusAngle: number
  }
  /** Other */
  wetEdges?: boolean
  buildUp?: boolean
  noise?: boolean
  protectTexture?: boolean
}

export interface GradientSettings {
  type: "linear" | "radial" | "angular" | "reflected" | "diamond"
  reverse: boolean
  dither?: boolean
  cycle?: boolean
  /** Multi-stop gradient (when set, used over fg/bg). */
  stops?: GradientStop[]
}

export type SymmetryAxis =
  | "horizontal"
  | "vertical"
  | "both"
  | "diagonal"
  | "wavy"
  | "circle"
  | "parallel"
  | "radial"
  | "mandala"
  | "spiral"

export interface SymmetrySettings {
  enabled: boolean
  axis: SymmetryAxis
  /** Number of segments for radial / mandala modes (2–32) */
  segments?: number
  /** Parallel symmetry spacing in canvas pixels. */
  parallelSpacing?: number
  /** Wavy symmetry amplitude in canvas pixels. */
  waveAmplitude?: number
  /** Number of sine periods across the document for wavy symmetry. */
  waveFrequency?: number
}

export interface BrushPreset {
  id: string
  name: string
  folder?: string
  size: number
  hardness: number
  spacing: number
  settings?: Partial<BrushSettings>
  thumbnail?: string
}

export interface PaintBucketSettings {
  tolerance: number
  contiguous: boolean
}

export interface MagicWandSettings {
  tolerance: number
  contiguous: boolean
}

export interface CloneStampState {
  layerId: string
  ax: number
  ay: number
}

export interface EraserSettings {
  sampling: "continuous" | "once" | "background-swatch"
  limits: "contiguous" | "discontiguous" | "find-edges"
  tolerance: number
  antiAlias: boolean
  protectForeground: boolean
}

export interface CloneSourcePreset {
  id: string
  name: string
  layerId: string
  sourceX: number
  sourceY: number
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
}

export interface CloneSourceSettings {
  activePresetId: string | null
  presets: CloneSourcePreset[]
  aligned: boolean
  sample: "current-layer" | "current-below" | "all-layers"
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
  showOverlay: boolean
}

export interface CustomShapeSettings {
  shape: CustomShapeId
}

export interface NoteSettings {
  author: string
  color: string
}

/* ---- Global augmentations for internal runtime metadata ---- */

declare global {
  interface HTMLCanvasElement {
    /** Internal: compressed blob store ID (editor-context.tsx) */
    __compressedBlobId?: string
    /** Internal: original width before compression (editor-context.tsx) */
    __origW?: number
    /** Internal: original height before compression (editor-context.tsx) */
    __origH?: number
    /** Internal: move-tool snapshot (canvas-view.tsx) */
    __moveSnapshot?: HTMLCanvasElement
  }
  interface Window {
    /** Internal: current custom shape selection */
    __psCustomShape?: string
  }
  interface CanvasRenderingContext2D {
    /** Non-standard: typographic kerning control (tool-helpers.ts) */
    fontKerning?: string
    /** Non-standard: OpenType feature settings (tool-helpers.ts) */
    fontFeatureSettings?: string
    /** Non-standard: ligature control (tool-helpers.ts) */
    fontVariantLigatures?: string
    /** Non-standard: small-caps control (tool-helpers.ts) */
    fontVariantCaps?: string
    /** Non-standard: variable font axes (tool-helpers.ts) */
    fontVariationSettings?: string
    /** Non-standard: canvas letter spacing control in Chromium (tool-helpers.ts) */
    letterSpacing?: string
    /** Standard: text rendering hint (tool-helpers.ts) */
    textRendering?: string
  }
}

export {}
