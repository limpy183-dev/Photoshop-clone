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
  | "shape-star"
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
  /**
   * Sample size used when the wand / quick-selection / object-select tools
   * read a source pixel. Matches Photoshop's eyedropper sample-size pop-up.
   */
  sampleSize?: "point" | "3x3" | "5x5" | "11x11" | "31x31" | "51x51" | "101x101"
  /** Auto-enhance edges when applying Quick Selection. */
  autoEnhance?: boolean
  quickGrowAmount?: number
  magneticWidth?: number
  magneticContrast?: number
  magneticHysteresis?: number
  magneticSmoothing?: number
  magneticFrequency?: number
  /** Modulate magnetic-lasso width by stylus pressure (Pen Pressure toggle). */
  magneticPenPressure?: boolean
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

export interface TypographyNamedInstance {
  name: string
  coordinates: Record<string, number>
}

export type EmbeddedFontFormat = "ttf" | "otf" | "woff" | "woff2" | "unknown"

export interface TypographyEmbeddedFont {
  family: string
  fileName: string
  mimeType: string
  dataBase64: string
  byteLength: number
  format: EmbeddedFontFormat
  hash: string
}

export type StylisticSetKey =
  | "ss01"
  | "ss02"
  | "ss03"
  | "ss04"
  | "ss05"
  | "ss06"
  | "ss07"
  | "ss08"
  | "ss09"
  | "ss10"
  | "ss11"
  | "ss12"
  | "ss13"
  | "ss14"
  | "ss15"
  | "ss16"
  | "ss17"
  | "ss18"
  | "ss19"
  | "ss20"

export interface OpenTypeControls {
  ligatures?: boolean
  discretionaryLigatures?: boolean
  contextualAlternates?: boolean
  stylisticAlternates?: boolean
  swash?: boolean
  ordinals?: boolean
  fractions?: boolean
  superscript?: boolean
  subscript?: boolean
  slashedZero?: boolean
  smallCaps?: boolean
  oldstyleFigures?: boolean
  tabularFigures?: boolean
  /** Use proportional figure widths (pnum). */
  proportionalFigures?: boolean
  /** Use lining figures (lnum). */
  liningFigures?: boolean
  /** Enable historical forms (hist). */
  historicalForms?: boolean
  /** Enable titling alternates (titl). */
  titling?: boolean
  /** Per-stylistic-set toggle map (ss01..ss20). */
  stylisticSets?: Partial<Record<StylisticSetKey, boolean>>
  /** Optional display names for stylistic sets from the font's name table. */
  stylisticSetNames?: Partial<Record<StylisticSetKey, string>>
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
  /** Treat textPath as a closed loop (text wraps around the path). */
  textPathClosed?: boolean
  /** Flip glyph orientation along the path (read upside-down). */
  textPathFlip?: boolean
  /** Distance from the path to lift glyph baseline (px). Negative drops below. */
  textPathBaselineOffset?: number
  /** Start offset along the path in px (lets text begin partway in). */
  textPathStartOffset?: number
  /** Align text along the path: start, center, end. */
  textPathAlign?: "start" | "center" | "end"
  /** Render glyphs top-to-bottom for vertical type layers. */
  vertical?: boolean
  /** Vertical writing mode: rl (right-to-left columns) or lr. */
  verticalWritingMode?: "rl" | "lr"
  /** Tate-chu-yoko: render runs of Latin chars upright inside vertical lines. */
  tateChuYoko?: boolean
  /** Width (in characters) of horizontal runs picked up by tate-chu-yoko grouping. Defaults to 2. */
  tateChuYokoWidth?: number
  /** CSS text-orientation behavior for vertical type. */
  textOrientation?: "mixed" | "upright" | "sideways"
  /** Vertical flow alignment within an area text box. */
  verticalAlign?: "top" | "middle" | "bottom"
  /** Explicit distance between vertical text columns in px. Defaults to leading/line height. */
  verticalColumnGap?: number
  /** Additional vertical advance between glyph units in px. */
  verticalGlyphSpacing?: number
  /** Per-glyph scale used by browser-local vertical type metrics. */
  verticalGlyphScale?: number
  /** Use measured glyph advance instead of square em-box advance for vertical units. */
  verticalUseProportionalMetrics?: boolean
  /** Mojikumi (Japanese punctuation spacing) setting name. */
  mojikumi?: "default" | "loose" | "compact" | "none"
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
  /** Name of the last applied variable-font preset/instance. */
  variableNamedInstance?: string
  /** Project-embedded font bytes used for exact local OpenType inspection and export packaging. */
  embeddedFont?: TypographyEmbeddedFont

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
  slashedZero?: boolean
  oldstyleFigures?: boolean
  tabularFigures?: boolean
  openType?: OpenTypeControls

  /** Shape metadata used as an editable area-text container and clipping path. */
  textShape?: ShapeProps
  textShapeInset?: number
  /** Per-side inset for text inside shape. Overrides textShapeInset when present. */
  textShapeInsets?: { top: number; right: number; bottom: number; left: number }
  /** Vertical alignment inside a shape text container. */
  textShapeVerticalAlign?: "top" | "middle" | "bottom"
  /** Original missing font family after a substitution has been applied. */
  missingFontOriginal?: string
  /** User-selected substitute font for the original missing family. */
  fontSubstitution?: string

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
  type: "rect" | "ellipse" | "custom" | "polygon" | "star"
  x: number
  y: number
  w: number
  h: number
  fill: string
  stroke: { color: string; width: number } | null
  radius?: number
  /** Per-corner radii [topLeft, topRight, bottomRight, bottomLeft] for rectangles. */
  cornerRadii?: [number, number, number, number]
  /** When type === "custom", which library glyph. */
  customId?: CustomShapeId
  /** When type === "polygon" or "star", how many sides/points. */
  sides?: number
  /** Inner radius ratio (0..1) for star type. */
  innerRadiusRatio?: number
  /** Rotation in degrees (around the shape center). */
  rotation?: number
  /** Corner rounding (0..1) applied to polygon vertices. */
  vertexRoundness?: number
  /** Rounds polygon vertices and star outer points when vertexRoundness is set. */
  smoothCorners?: boolean
  /** Rounds star inner points when vertexRoundness is set. */
  smoothIndent?: boolean
  /** Number of points for star type (alias for sides on stars). */
  starPoints?: number
  /** Editable compound shape components rendered with per-component boolean operations. */
  components?: ShapeComponent[]
  /** Cached computed path for compound boolean geometry. */
  computedPath?: PathProps
  /** Multiple fill/stroke entries rendered in stack order. */
  appearance?: ShapeAppearance
  booleanOperation?: "new" | "unite" | "subtract" | "intersect" | "exclude"
}

export type ShapeBooleanOperation = "new" | "unite" | "subtract" | "intersect" | "exclude"

export interface ShapeComponent {
  id: string
  operation: Exclude<ShapeBooleanOperation, "new">
  shape: ShapeProps
}

export interface ShapeFillAppearance {
  id: string
  enabled: boolean
  color: string
  opacity: number
  blendMode?: BlendMode
}

export interface ShapeStrokeAppearance {
  id: string
  enabled: boolean
  color: string
  width: number
  opacity: number
  alignment?: "inside" | "center" | "outside"
  blendMode?: BlendMode
  lineCap?: CanvasLineCap
  lineJoin?: CanvasLineJoin
  dash?: number[]
}

export interface ShapeAppearance {
  fills: ShapeFillAppearance[]
  strokes: ShapeStrokeAppearance[]
}

export type PathHandleMode = "symmetric" | "broken"

export interface PathPoint {
  x: number
  y: number
  cp1?: { x: number; y: number }
  cp2?: { x: number; y: number }
  /** Bezier handle coupling for direct on-canvas editing. */
  handleMode?: PathHandleMode
}

export interface PathProps {
  points: PathPoint[]
  closed: boolean
  /** Optional provenance for generated paths such as exact font outlines. */
  source?: "font-outline" | "approximated-glyph" | "shape" | "compound" | string
  /** Optional additional subpaths for compound paths or approximated glyph outlines. */
  subpaths?: PathProps[]
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
    invert?: boolean
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
    pattern: "checker" | "dots" | "lines" | "noise" | string
    scale: number
    opacity: number
    color?: string
    blendMode?: BlendMode
    align?: boolean
    phase?: { x: number; y: number }
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

/** Channel selector for Blend If sliders. "gray" matches Photoshop's luminance default. */
export type BlendIfChannel = "gray" | "r" | "g" | "b"

/** Optional per-channel Blend If ranges. Missing entries default to a full pass-through range. */
export type BlendIfChannels = Partial<Record<BlendIfChannel, BlendIfRange>>

export interface AdvancedBlending {
  fillOpacity: number
  knockout: "none" | "shallow" | "deep"
  channels: { r: boolean; g: boolean; b: boolean }
  blendIfThis: BlendIfRange
  blendIfUnderlying: BlendIfRange
  /** Per-channel Blend If overrides for the source ("This Layer") slider. Gray range mirrors blendIfThis. */
  blendIfThisChannels?: BlendIfChannels
  /** Per-channel Blend If overrides for the underlying-layer slider. Gray range mirrors blendIfUnderlying. */
  blendIfUnderlyingChannels?: BlendIfChannels
  /** UI-only: which channel the Blend If sliders are currently editing. */
  blendIfActiveChannel?: BlendIfChannel
  /** When false, layer effects use a full layer rectangle instead of the layer's transparency. Defaults true. */
  transparencyShapesLayer?: boolean
  /** When true, the raster layer mask also clips layer effects. Defaults false. */
  layerMaskHidesEffects?: boolean
  /** When true, the vector mask also clips layer effects. Defaults false. */
  vectorMaskHidesEffects?: boolean
}

export interface BlurGalleryMeshResource {
  signature: "8BIM"
  resourceKey: "blurGalleryMesh"
  version: 1
  descriptor: {
    filterId: string
    params: Record<string, number | string | boolean>
    controlState: {
      selectedFieldPinIndexes: number[]
      selectedPathPointIndexes: number[]
      activeControl: string | null
      previewQuality: "full" | "interactive"
    }
    mesh:
      | { kind: "field"; pins: { x: number; y: number; blur: number }[]; falloff: number; blur: number }
      | { kind: "iris"; center: { x: number; y: number }; radius: number; feather: number; blur: number }
      | { kind: "tilt"; center: { x: number; y: number }; angle: number; radius: number; feather: number; blur: number }
      | { kind: "path"; points: { x: number; y: number }[]; distance: number; taper: number; angle: number }
      | { kind: "spin"; center: { x: number; y: number }; radius: number; amount: number }
  }
  payloadBase64: string
  checksum: string
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
  /** 0 disables the mask influence; 1 applies mask pixels fully. */
  maskDensity?: number
  /** Feather radius in document pixels for the smart filter mask. */
  maskFeather?: number
  /** False keeps the filter mask independent from layer movement/placement workflows. */
  maskLinked?: boolean
  /** Deterministic browser-side descriptor for Blur Gallery pins/path/mesh state. */
  blurGalleryMesh?: BlurGalleryMeshResource
}

export interface SmartObjectEditPackage {
  id: string
  name: string
  version: number
  createdAt: number
  updatedAt: number
  documentId?: string
  layerCount?: number
  sourceHash?: string
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
  fileHandle?: FileSystemFileHandle
  fileHandleName?: string
  handlePermission?: PermissionState | "unsupported"
  lastKnownModified?: number
  lastKnownSize?: number
  sourceHash?: string
  editPackage?: SmartObjectEditPackage
  exportedAt?: number
  relinkedAt?: number
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

export interface PluginDescriptor {
  id: string
  name: string
  kind: "cep-panel" | "ux-plugin" | "8bf-filter"
  enabled: boolean
  manifestVersion?: number
  version?: string
  author?: string
  description?: string
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

export interface DocumentModeSettings {
  mode: "RGB" | "CMYK" | "Grayscale" | "Duotone" | "Indexed" | "Multichannel" | "Bitmap"
  duotone?: {
    /** Number of inks: 1=mono, 2=duo, 3=tri, 4=quad. Defaults to 2 for back-compat. */
    inkCount?: 1 | 2 | 3 | 4
    ink1: string
    ink2: string
    ink3?: string
    ink4?: string
    /** Legacy single curve exponent (kept for back-compat). */
    curve: number
    ink1Name?: string
    ink2Name?: string
    ink3Name?: string
    ink4Name?: string
    opacity1?: number
    opacity2?: number
    opacity3?: number
    opacity4?: number
    balance?: number
    /** Per-ink response curve (13 control points 0..255 mapping input coverage). */
    curves?: { ink1?: number[]; ink2?: number[]; ink3?: number[]; ink4?: number[] }
    /** Optional preset key the dialog last applied. */
    preset?: string
  }
  indexed?: {
    colors: number
    dither: boolean
    palette?: "adaptive" | "perceptual" | "web" | "uniform" | "grayscale" | "custom" | "selective" | "exact" | "system"
    ditherMethod?: "none" | "ordered" | "diffusion" | "noise"
    /** Dither amount 0..100. Defaults to 75. */
    ditherAmount?: number
    colorTable?: string[]
    transparency?: boolean
    matte?: string
    forced?: "none" | "black-white" | "primaries" | "web"
    /** When true, palette-exact pixels skip dithering and pass through unchanged. */
    preserveExact?: boolean
  }
  multichannel?: { channels: { r: boolean; g: boolean; b: boolean; c?: boolean; m?: boolean; y?: boolean; k?: boolean } }
  bitmap?: {
    method: "threshold" | "halftone" | "pattern-dither" | "diffusion-dither"
    threshold: number
    frequency: number
    angle: number
    shape?: "round" | "line" | "diamond" | "ellipse"
    outputResolution?: number
  }
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
  /** App-only notes attached directly to this layer. */
  notes?: LayerNote[]
  /** App-only searchable metadata attached directly to this layer. */
  metadata?: LayerMetadata
  smartFilters?: SmartFilter[]
  smartSource?: SmartObjectSource
}

export interface Selection {
  bounds: { x: number; y: number; w: number; h: number } | null
  shape: "rect" | "ellipse" | "polygon" | "freehand" | "wand" | "color"
  mask?: HTMLCanvasElement | null
  feather?: number
  diagnostics?: SelectionDiagnostics
}

export type SelectionDiagnosticReason = "accepted" | "color" | "edge" | "alpha" | "limit" | "bounds"

export interface SelectionDiagnostics {
  acceptedPixels: number
  rejectedPixels: number
  coverageRatio: number
  boundsTouchesCanvas: boolean
  maxPixelsReached: boolean
  queueExhausted: boolean
  summary: string
  reasonCounts: Record<SelectionDiagnosticReason, number>
  /**
   * Per-document-pixel reason map used to render visual diagnostics.
   * 0 = unvisited, 1 = accepted, 2 = color rejected, 3 = edge rejected,
   * 4 = alpha rejected, 5 = max-pixel limit, 6 = canvas bounds.
   */
  reasonMap: Uint8ClampedArray
}

export type QuickMaskPaintMode = "add" | "subtract" | "auto"

/** Saved alpha channel for selection save/load */
export interface AlphaChannel {
  id: string
  name: string
  canvas: HTMLCanvasElement
  /** Alpha channels store selections; spot channels additionally carry ink preview metadata. */
  kind?: "alpha" | "spot"
  /** Spot ink preview color. PSD export also preserves this through the encoded channel name convention. */
  spotColor?: string
  /** Spot ink preview opacity, 0..100. */
  spotOpacity?: number
}

export interface Guide {
  id: string
  orientation: "horizontal" | "vertical"
  position: number
  color?: string
  name?: string
  locked?: boolean
  visible?: boolean
}

export interface LayerNote {
  id: string
  text: string
  author?: string
  color?: string
  createdAt: number
  updatedAt?: number
}

export type ReviewStatus = "open" | "resolved"

export interface CommentReply {
  id: string
  author: string
  text: string
  createdAt: number
  updatedAt?: number
}

export type AnnotationGeometry =
  | { kind: "pin"; x: number; y: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "freehand"; points: { x: number; y: number }[]; closed?: boolean }

export interface Note {
  id: string
  x: number
  y: number
  author: string
  text: string
  color: string
  kind?: "note" | "comment" | "annotation"
  status?: ReviewStatus
  replies?: CommentReply[]
  tags?: string[]
  geometry?: AnnotationGeometry
  createdAt?: number
  updatedAt?: number
  resolvedAt?: number
  resolvedBy?: string
}

export interface Slice {
  id: string
  x: number
  y: number
  w: number
  h: number
  name: string
  url?: string
  target?: string
  altText?: string
  format?: "png" | "jpeg" | "webp" | "gif" | "avif"
  quality?: number
  compression?: number
  filename?: string
  scale?: number
  locked?: boolean
  visible?: boolean
}

export interface LayerMetadata {
  title?: string
  description?: string
  tags?: string[]
  custom?: Record<string, string | number | boolean>
  createdAt?: number
  modifiedAt?: number
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
      advancedBlending?: AdvancedBlending
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
      notes?: LayerNote[]
      metadata?: LayerMetadata
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
  tags?: string[]
  description?: string
  payload: unknown
  createdAt: number
  updatedAt?: number
}

export interface FrameLayerTransform {
  /** Translation in document pixels. */
  tx: number
  ty: number
  /** 1.0 = no scale. */
  scaleX: number
  scaleY: number
  /** Rotation in degrees, around the layer center. */
  rotation: number
}

export type FrameEasing = "hold" | "linear" | "ease-in" | "ease-out" | "ease-in-out"

export interface TimelineFrame {
  id: string
  name: string
  durationMs: number
  layerVisibility: Record<string, boolean>
  layerOpacity?: Record<string, number>
  /** Fill opacity overrides keyed by layer id. */
  layerFillOpacity?: Record<string, number>
  /** Layer style overrides keyed by layer id. Use null to clear style. */
  layerStyle?: Record<string, LayerStyle | null>
  /** Blend-mode overrides keyed by layer id. */
  layerBlend?: Record<string, BlendMode>
  /** Per-layer transform keyframes (position, scale, rotation). */
  layerTransform?: Record<string, FrameLayerTransform>
  transition?: "hold" | "dissolve" | VideoTransition["kind"]
  /** Easing applied when interpolating tween properties into the next frame. */
  easing?: FrameEasing
  audioLabel?: string
  compId?: string
  keyframes?: VideoKeyframe[]
  audioTracks?: AudioTrack[]
  /** Optional thumbnail dataURL cached at capture time. */
  thumbnail?: string
}

export interface OnionSkinSettings {
  enabled: boolean
  /** Number of frames before the current frame to ghost. */
  before: number
  /** Number of frames after the current frame to ghost. */
  after: number
  /** Maximum overlay opacity (0..1) for adjacent frames. */
  opacity: number
  /** Tint color applied to before/after ghosts ("none" leaves originals untinted). */
  tint?: "none" | "red-cyan" | "red-blue" | "green-red" | "mono"
}

export interface TimelineSettings {
  /** Frame-rate hint used by exporters and tween density. */
  fps: number
  /** 0 = infinite loop. */
  loopCount: number
  onionSkin?: OnionSkinSettings
}

export interface DocumentReport {
  id: string
  title: string
  createdAt: number
  source: "PSD Import" | "PSD Export" | "Project Import" | "Project Export" | "Batch Export" | "Image Assets Generator"
  items: { label: string; status: "preserved" | "approximated" | "flattened" | "unsupported" | "info"; detail: string }[]
}

export interface ImageAssetGeneratorSettings {
  enabled?: boolean
  autoExportOnSave?: boolean
  autoExportOnChange?: boolean
  outputFolderName?: string
  lastRunAt?: number
  lastTrigger?: "manual" | "save" | "change"
  lastSummary?: string
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
  /** Browser-safe overview plus full-resolution tile access for oversized PSB files. */
  largeDocumentTileView?: LargeDocumentTileViewMetadata
  /** Read-only parsed-file fallback when pixels cannot be opened safely. */
  largeDocumentInspection?: LargeDocumentInspectionMetadata
  /** Full-resolution tile document opened from a tile-only parent. */
  largeDocumentTileEdit?: LargeDocumentTileEditMetadata
  /** Focused import repair actions for PSD layer/resource structures represented locally. */
  psdRepairPlan?: PsdRepairPlanMetadata
  /** Exact original PSD/PSB bytes retained for native-source replay when the file is small enough. */
  psdNativeSource?: PsdNativeSourceSnapshotMetadata
  /** Photoshop Generator-style layer-name asset export settings. */
  imageAssetGenerator?: ImageAssetGeneratorSettings
}

export interface PsdNativeSourceSnapshotMetadata {
  kind: "psd-native-source"
  version: 1
  sourceName: string
  format: "psd" | "psb"
  byteLength: number
  width?: number
  height?: number
  colorMode?: string
  bitDepth?: number
  checksum: string
  encoding: "base64"
  data: string
}

export interface PsdParsedStructureMetadata {
  layerCount?: number
  colorMode?: string
  bitDepth?: number
  resources?: string[]
  repairableItems?: string[]
}

export interface PsdRepairPlanMetadata {
  summary: string
  actions: {
    label: string
    status: "represented" | "repairable" | "inspect-only"
    localRepresentation: string
    detail: string
  }[]
}

export interface LargeDocumentTileViewMetadata {
  mode: "psb-tile-view"
  sourceName: string
  originalWidth: number
  originalHeight: number
  overviewScale: number
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
  selectedTile?: { col: number; row: number }
}

export interface LargeDocumentInspectionMetadata {
  mode: "inspection"
  sourceName: string
  kind: "raster" | "psd" | "psb" | "project" | "advanced"
  originalWidth: number
  originalHeight: number
  previewWidth: number
  previewHeight: number
  editable: false
  reason: string
  warnings: string[]
  parsedStructure?: PsdParsedStructureMetadata
}

export interface LargeDocumentTileEditMetadata {
  mode: "tile-edit"
  parentDocId: string
  sourceName: string
  originalWidth: number
  originalHeight: number
  tileSize: number
  tile: {
    col: number
    row: number
    x: number
    y: number
    width: number
    height: number
  }
  editable: true
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

export type ColorProfileName =
  | "sRGB IEC61966-2.1"
  | "Display P3"
  | "Adobe RGB (1998)"
  | "ProPhoto RGB"
  | "Working CMYK"
  | "U.S. Web Coated SWOP v2"
  | "Japan Color 2001 Coated"
  | "Dot Gain 20%"
  | "Gray Gamma 2.2"

export interface ColorManagementSettings {
  assignedProfile: ColorProfileName
  workingSpace: ColorProfileName
  renderingIntent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric"
  blackPointCompensation: boolean
  proofProfile: "None" | ColorProfileName
  proofColors: boolean
  gamutWarning: boolean
  simulateBlackInk?: boolean
  preserveNumbers?: boolean
  proofChannels?: Array<"red" | "green" | "blue" | "cyan" | "magenta" | "yellow" | "black" | "gray">
  proofPlateView?: "composite" | "ink" | "mask"
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
  quickMaskPaintMode?: QuickMaskPaintMode
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
  timelineSettings?: TimelineSettings
  plugins?: PluginDescriptor[]
  pluginStorage?: Record<string, Record<string, unknown>>
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
  notes?: LayerNote[]
  metadata?: LayerMetadata
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
  quickMaskPaintMode?: QuickMaskPaintMode
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
  folder?: string
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
  erodibleTip?: {
    sharpness: number
    flatness: number
    erosionRate: number
    softness: number
    aspectRatio: number
    rotation: number
    /**
     * Accumulated wear across strokes (0-100). Increments while painting,
     * driving the heightfield simulation; reset by "Sharpen Tip".
     */
    wear?: number
    /** Tip silhouette shape — controls the unworn profile. */
    shape?: "round" | "flat" | "chisel" | "calligraphic"
  }
  bristleTip?: {
    length: number
    density: number
    thickness: number
    stiffness: number
    splay: number
    wetness: number
    /** Number of bristles modelled. When omitted, derived from density. */
    bristles?: number
    /** Bristle bundle rotation in degrees relative to the stroke direction. */
    angle?: number
    /** Stroke spacing override for bristle dabs as % of tip size. */
    spacing?: number
  }
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
  mixer?: {
    wet: number
    load: number
    mix: number
    flow: number
    sampleAllLayers: boolean
    cleanAfterStroke: boolean
    reservoirColor?: string
    /** Reservoir alpha (0-1). Drops as paint deposits and is replenished on load. */
    reservoirAlpha?: number
    /** Replenish amount applied at the start of each stroke (0-100). */
    loadPerStroke?: number
    /** When true the reservoir reloads at the start of every stroke. */
    autoLoad?: boolean
    /** When true the reservoir is cleaned at the start of every stroke. */
    autoClean?: boolean
  }
  colorReplacement?: {
    sampling: "continuous" | "once" | "background-swatch"
    limits: "contiguous" | "discontiguous" | "find-edges"
    mode: "color" | "hue" | "saturation" | "luminosity"
    tolerance: number
    antiAlias: boolean
  }
  artHistory?: {
    style:
      | "tight-short"
      | "tight-medium"
      | "tight-long"
      | "loose-medium"
      | "loose-long"
      | "dab"
      | "tight-curl"
      | "loose-curl"
      | "tight-curl-long"
      | "loose-curl-long"
      /** @deprecated retained for compatibility with previously saved presets. */
      | "curl"
    area: number
    fidelity: number
    /** Tonal distance between source and dab area; lower = paint only flat regions. */
    tolerance?: number
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
    /** Internal: current user-library custom shape preset */
    __psCustomShapePreset?: ShapeProps
    /** Internal: current shape tool options */
    __psShapeOptions?: Partial<{
      strokeWidth: number
      radius: number
      sides: number
      innerRadiusRatio: number
      vertexRoundness: number
      polygonStarMode: boolean
      smoothCorners: boolean
      smoothIndent: boolean
      rotation: number
      cornerRadiusTL: number
      cornerRadiusTR: number
      cornerRadiusBR: number
      cornerRadiusBL: number
    }>
    /** Internal: current direct-selection path editing options */
    __psPathOptions?: Partial<{
      handleMode: PathHandleMode
    }>
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
