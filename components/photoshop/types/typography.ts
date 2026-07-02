import type { BlendMode } from "./core"

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
