import { expect, test } from "@playwright/test"

import {
  applyTextInsideShape,
  buildFontPreview,
  buildFontSubstitutionComparison,
  buildOpenTypeFeatureSettings,
  buildTypographyRenderPlan,
  buildFindReplaceHighlights,
  buildTextPathHandleModel,
  buildVariableFontAxisControlModel,
  createEmbeddedFontFromBuffer,
  convertTextToEditablePath,
  createTextExtrusionScene,
  deleteTextPathPoint,
  diagnoseDocumentFonts,
  detectOpenTypeFeatureSupport,
  insertTextPathPoint,
  matchFontFromImageData,
  parseOpenTypeFontMetadata,
  parseVariableFontMetadata,
  layoutTextOnPath,
  listOpenTypeFeatureToggles,
  findReplaceTextLayers,
  matchFontForLayer,
  normalizeVariableAxes,
  reverseTextPath,
  resolveFontSubstitutions,
  updateTextPathPoint,
} from "../components/photoshop/typography-engine"
import type { Layer, ShapeProps, TextProps } from "../components/photoshop/types"
import { installFixtureDom } from "./photoshop-fixtures"

function baseText(patch: Partial<TextProps> = {}): TextProps {
  return {
    content: "Design Type",
    font: "Inter",
    size: 42,
    weight: "normal",
    italic: false,
    color: "#112233",
    align: "left",
    x: 20,
    y: 30,
    ...patch,
  }
}

function layer(id: string, text: TextProps | undefined): Layer {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = 320
  canvas.height = 180
  return {
    id,
    name: `Layer ${id}`,
    kind: text ? "text" : "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
    text,
  }
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, false)
}

function writeInt16(view: DataView, offset: number, value: number) {
  view.setInt16(offset, value, false)
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, false)
}

function writeTag(bytes: Uint8Array, offset: number, tag: string) {
  for (let i = 0; i < 4; i++) bytes[offset + i] = tag.charCodeAt(i)
}

function writeFixed(view: DataView, offset: number, value: number) {
  const whole = Math.trunc(value)
  const fraction = Math.round((value - whole) * 65536)
  writeInt16(view, offset, whole)
  writeUint16(view, offset + 2, fraction & 0xffff)
}

function utf16be(value: string) {
  const bytes = new Uint8Array(value.length * 2)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    bytes[i * 2] = code >> 8
    bytes[i * 2 + 1] = code & 0xff
  }
  return bytes
}

function buildVariationFixtureFont() {
  const names = [
    { id: 256, text: "Weight" },
    { id: 257, text: "Width" },
    { id: 258, text: "Condensed Bold" },
  ]
  const nameHeaderLength = 6 + names.length * 12
  const nameStrings = names.map((name) => utf16be(name.text))
  const nameLength = nameHeaderLength + nameStrings.reduce((sum, bytes) => sum + bytes.length, 0)
  const nameTable = new Uint8Array(nameLength)
  const nameView = new DataView(nameTable.buffer)
  writeUint16(nameView, 0, 0)
  writeUint16(nameView, 2, names.length)
  writeUint16(nameView, 4, nameHeaderLength)
  let stringOffset = 0
  names.forEach((name, index) => {
    const recordOffset = 6 + index * 12
    const bytes = nameStrings[index]
    writeUint16(nameView, recordOffset, 3)
    writeUint16(nameView, recordOffset + 2, 1)
    writeUint16(nameView, recordOffset + 4, 0x0409)
    writeUint16(nameView, recordOffset + 6, name.id)
    writeUint16(nameView, recordOffset + 8, bytes.length)
    writeUint16(nameView, recordOffset + 10, stringOffset)
    nameTable.set(bytes, nameHeaderLength + stringOffset)
    stringOffset += bytes.length
  })

  const fvarTable = new Uint8Array(16 + 2 * 20 + 12)
  const fvarView = new DataView(fvarTable.buffer)
  writeUint16(fvarView, 0, 1)
  writeUint16(fvarView, 2, 0)
  writeUint16(fvarView, 4, 16)
  writeUint16(fvarView, 6, 0)
  writeUint16(fvarView, 8, 2)
  writeUint16(fvarView, 10, 20)
  writeUint16(fvarView, 12, 1)
  writeUint16(fvarView, 14, 12)
  writeTag(fvarTable, 16, "wght")
  writeFixed(fvarView, 20, 100)
  writeFixed(fvarView, 24, 400)
  writeFixed(fvarView, 28, 900)
  writeUint16(fvarView, 34, 256)
  writeTag(fvarTable, 36, "wdth")
  writeFixed(fvarView, 40, 50)
  writeFixed(fvarView, 44, 100)
  writeFixed(fvarView, 48, 200)
  writeUint16(fvarView, 54, 257)
  writeUint16(fvarView, 56, 258)
  writeFixed(fvarView, 60, 700)
  writeFixed(fvarView, 64, 75)

  const sfnt = new Uint8Array(12 + 2 * 16 + nameTable.length + fvarTable.length)
  const view = new DataView(sfnt.buffer)
  writeUint32(view, 0, 0x00010000)
  writeUint16(view, 4, 2)
  writeTag(sfnt, 12, "fvar")
  writeUint32(view, 20, 44)
  writeUint32(view, 24, fvarTable.length)
  writeTag(sfnt, 28, "name")
  writeUint32(view, 36, 44 + fvarTable.length)
  writeUint32(view, 40, nameTable.length)
  sfnt.set(fvarTable, 44)
  sfnt.set(nameTable, 44 + fvarTable.length)
  return sfnt.buffer
}

function align4(length: number) {
  return (length + 3) & ~3
}

function tableRecord(tag: string, data: Uint8Array) {
  return { tag, data }
}

function buildOutlineFixtureFont() {
  const head = new Uint8Array(54)
  const headView = new DataView(head.buffer)
  writeUint32(headView, 0, 0x00010000)
  writeUint32(headView, 4, 0x00010000)
  writeUint16(headView, 18, 1000)
  writeInt16(headView, 36, 0)
  writeInt16(headView, 38, 0)
  writeInt16(headView, 40, 700)
  writeInt16(headView, 42, 700)
  writeUint16(headView, 50, 0)

  const hhea = new Uint8Array(36)
  const hheaView = new DataView(hhea.buffer)
  writeUint32(hheaView, 0, 0x00010000)
  writeInt16(hheaView, 4, 800)
  writeInt16(hheaView, 6, -200)
  writeUint16(hheaView, 34, 2)

  const maxp = new Uint8Array(6)
  const maxpView = new DataView(maxp.buffer)
  writeUint32(maxpView, 0, 0x00010000)
  writeUint16(maxpView, 4, 2)

  const hmtx = new Uint8Array(8)
  const hmtxView = new DataView(hmtx.buffer)
  writeUint16(hmtxView, 0, 500)
  writeInt16(hmtxView, 2, 0)
  writeUint16(hmtxView, 4, 700)
  writeInt16(hmtxView, 6, 0)

  const glyphA = new Uint8Array(30)
  const glyphView = new DataView(glyphA.buffer)
  writeInt16(glyphView, 0, 1)
  writeInt16(glyphView, 2, 0)
  writeInt16(glyphView, 4, 0)
  writeInt16(glyphView, 6, 700)
  writeInt16(glyphView, 8, 700)
  writeUint16(glyphView, 10, 2)
  writeUint16(glyphView, 12, 0)
  glyphA.set([1, 1, 1], 14)
  writeInt16(glyphView, 17, 0)
  writeInt16(glyphView, 19, 700)
  writeInt16(glyphView, 21, -350)
  writeInt16(glyphView, 23, 0)
  writeInt16(glyphView, 25, 0)
  writeInt16(glyphView, 27, 700)

  const glyf = glyphA
  const loca = new Uint8Array(6)
  const locaView = new DataView(loca.buffer)
  writeUint16(locaView, 0, 0)
  writeUint16(locaView, 2, 0)
  writeUint16(locaView, 4, glyphA.length / 2)

  const cmapSubtable = new Uint8Array(32)
  const cmapSubView = new DataView(cmapSubtable.buffer)
  writeUint16(cmapSubView, 0, 4)
  writeUint16(cmapSubView, 2, 32)
  writeUint16(cmapSubView, 6, 4)
  writeUint16(cmapSubView, 8, 4)
  writeUint16(cmapSubView, 10, 1)
  writeUint16(cmapSubView, 14, 65)
  writeUint16(cmapSubView, 16, 0xffff)
  writeUint16(cmapSubView, 20, 65)
  writeUint16(cmapSubView, 22, 0xffff)
  writeUint16(cmapSubView, 24, 0xffc0)
  writeUint16(cmapSubView, 26, 1)

  const cmap = new Uint8Array(12 + cmapSubtable.length)
  const cmapView = new DataView(cmap.buffer)
  writeUint16(cmapView, 2, 1)
  writeUint16(cmapView, 4, 3)
  writeUint16(cmapView, 6, 1)
  writeUint32(cmapView, 8, 12)
  cmap.set(cmapSubtable, 12)

  const scriptList = new Uint8Array([0, 0])
  const featureList = new Uint8Array(22)
  const featureView = new DataView(featureList.buffer)
  writeUint16(featureView, 0, 2)
  writeTag(featureList, 2, "liga")
  writeUint16(featureView, 6, 14)
  writeTag(featureList, 8, "smcp")
  writeUint16(featureView, 12, 18)
  const gsub = new Uint8Array(10 + scriptList.length + featureList.length + 2)
  const gsubView = new DataView(gsub.buffer)
  writeUint16(gsubView, 0, 1)
  writeUint16(gsubView, 4, 10)
  writeUint16(gsubView, 6, 12)
  writeUint16(gsubView, 8, 34)
  gsub.set(scriptList, 10)
  gsub.set(featureList, 12)

  const tables = [
    tableRecord("head", head),
    tableRecord("hhea", hhea),
    tableRecord("maxp", maxp),
    tableRecord("hmtx", hmtx),
    tableRecord("loca", loca),
    tableRecord("glyf", glyf),
    tableRecord("cmap", cmap),
    tableRecord("GSUB", gsub),
  ]
  const directoryLength = 12 + tables.length * 16
  let offset = directoryLength
  const total = directoryLength + tables.reduce((sum, table) => sum + align4(table.data.length), 0)
  const sfnt = new Uint8Array(total)
  const view = new DataView(sfnt.buffer)
  writeUint32(view, 0, 0x00010000)
  writeUint16(view, 4, tables.length)
  tables.forEach((table, index) => {
    const record = 12 + index * 16
    writeTag(sfnt, record, table.tag)
    writeUint32(view, record + 8, offset)
    writeUint32(view, record + 12, table.data.length)
    sfnt.set(table.data, offset)
    offset += align4(table.data.length)
  })
  return sfnt.buffer
}

function blackRectImageData(width: number, height: number, rect: { x: number; y: number; w: number; h: number }) {
  const image = new ImageData(width, height)
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const index = (y * width + x) * 4
      image.data[index] = 8
      image.data[index + 1] = 8
      image.data[index + 2] = 8
      image.data[index + 3] = 255
    }
  }
  return image
}

test("variable font axes are normalized and reflected in render plans", () => {
  const axes = normalizeVariableAxes({ wght: 980, wdth: 20, slnt: -8 }, [
    { tag: "wght", name: "Weight", min: 100, max: 900, defaultValue: 400 },
    { tag: "wdth", name: "Width", min: 75, max: 125, defaultValue: 100 },
    { tag: "opsz", name: "Optical Size", min: 8, max: 72, defaultValue: 14 },
  ])
  const plan = buildTypographyRenderPlan(baseText({ variableAxes: axes, antiAliasMode: "sharp" }))

  expect(axes).toEqual({ wght: 900, wdth: 75, opsz: 14 })
  expect(plan.fontVariationSettings).toContain('"wght" 900')
  expect(plan.renderHints.contrast).toBeGreaterThan(1)
})

test("variable font axis controls merge discovered axes, active custom axes, and named instances", () => {
  const model = buildVariableFontAxisControlModel(
    baseText({
      variableAxes: { wght: 980, XTRA: 25 },
      variableAxisDefinitions: [
        { tag: "wght", name: "Weight", min: 100, max: 900, defaultValue: 400 },
      ],
    }),
    {
      family: "Fixture VF",
      source: "font-access",
      axes: [
        { tag: "wght", name: "Weight", min: 100, max: 900, defaultValue: 400 },
        { tag: "GRAD", name: "Grade", min: -1, max: 1, defaultValue: 0 },
      ],
      namedInstances: [
        { name: "Display Bold", coordinates: { wght: 720, GRAD: 0.5 } },
      ],
    },
  )

  expect(model.source).toBe("font-access")
  expect(model.axes.map((axis) => `${axis.tag}:${axis.value}:${axis.source}`)).toEqual([
    "wght:900:discovered",
    "GRAD:0:discovered",
    "XTRA:25:custom",
  ])
  expect(model.namedInstances[0].label).toBe("Display Bold")
  expect(model.namedInstances[0].summary).toContain("wght 720")
  expect(model.status).toContain("2 discovered")
})

test("font preview and diagnostics identify available, missing, and substituted fonts", () => {
  const preview = buildFontPreview("Inter", "AaBb 123", { size: 32, variableAxes: { wght: 720 } })
  const diagnostics = diagnoseDocumentFonts(
    [
      layer("a", baseText({ font: "Inter" })),
      layer("b", baseText({ font: "Missing Serif", content: "Poster" })),
    ],
    { availableFonts: new Set(["Inter", "Arial"]), fallbackFont: "Arial" },
  )

  expect(preview.sample).toBe("AaBb 123")
  expect(preview.cssFont).toContain("Inter")
  expect(preview.fontVariationSettings).toContain('"wght" 720')
  expect(diagnostics.missingFonts).toEqual(["Missing Serif"])
  expect(diagnostics.layersByFont["Missing Serif"]).toEqual(["b"])
  expect(diagnostics.substitutions["Missing Serif"]).toBe("Arial")
})

test("font substitution workflow returns patched layers and preserves the original request", () => {
  const source = [
    layer("a", baseText({ font: "Missing Serif" })),
    layer("b", baseText({ font: "Inter" })),
  ]
  const result = resolveFontSubstitutions(source, {
    availableFonts: new Set(["Inter", "Georgia"]),
    substitutions: { "Missing Serif": "Georgia" },
  })

  expect(result.changedLayerIds).toEqual(["a"])
  expect(result.layers[0].text?.font).toBe("Georgia")
  expect(result.layers[0].text?.missingFontOriginal).toBe("Missing Serif")
  expect(result.report.substitutions["Missing Serif"]).toBe("Georgia")
})

test("match font ranks candidates deterministically from text geometry", () => {
  const result = matchFontForLayer(baseText({ content: "mmmm", boxWidth: 220 }), [
    { family: "Condensed Sans", averageGlyphWidth: 0.42, xHeight: 0.48, serif: false },
    { family: "Display Wide", averageGlyphWidth: 0.78, xHeight: 0.62, serif: false },
    { family: "Book Serif", averageGlyphWidth: 0.53, xHeight: 0.5, serif: true },
  ])

  expect(result.best.family).toBe("Display Wide")
  expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1].score)
  expect(result.target.source).toBe("layer-box")
  expect(result.candidates[0].geometry.averageGlyphWidth).toBeCloseTo(0.78)
})

test("find and replace edits text layers across the document and returns match metadata", () => {
  const result = findReplaceTextLayers(
    [
      layer("a", baseText({ content: "Color color COLOR" })),
      layer("b", baseText({ content: "No hit" })),
      layer("c", baseText({ content: "brand color", font: "Georgia" })),
    ],
    { find: "color", replace: "tone", caseSensitive: false, wholeWord: true },
  )

  expect(result.changedLayerIds).toEqual(["a", "c"])
  expect(result.replacements).toBe(4)
  expect(result.layers[0].text?.content).toBe("tone tone tone")
  expect(result.matches.map((match) => match.layerId)).toEqual(["a", "a", "a", "c"])
})

test("find and replace previews regex matches with layer counts before editing", () => {
  const source = [
    layer("a", baseText({ content: "SKU A12, sku B34" })),
    layer("b", baseText({ content: "sku C56" })),
    layer("c", baseText({ content: "No product code" })),
  ]
  const preview = findReplaceTextLayers(source, {
    find: "\\bsku\\s+[A-Z]\\d{2}\\b",
    replace: "item",
    caseSensitive: false,
    useRegex: true,
    previewOnly: true,
  })

  expect(preview.matchCountLabel).toBe("3 matches in 2 layers")
  expect(preview.replacements).toBe(0)
  expect(preview.changedLayerIds).toEqual([])
  expect(preview.layers[0].text?.content).toBe("SKU A12, sku B34")
  expect(preview.matches.map((match) => match.text)).toEqual(["SKU A12", "sku B34", "sku C56"])
  expect(preview.highlights.map((group) => `${group.layerName}:${group.matches.length}`)).toEqual(["Layer a:2", "Layer b:1"])
  expect(preview.highlights[0].segments.filter((segment) => segment.highlight)).toHaveLength(2)
})

test("find and replace can build highlight-all groups for every matched text layer", () => {
  const matches = [
    { layerId: "a", layerName: "Headline", index: 0, length: 5, text: "Color" },
    { layerId: "a", layerName: "Headline", index: 11, length: 5, text: "color" },
    { layerId: "b", layerName: "Caption", index: 6, length: 5, text: "color" },
  ]
  const groups = buildFindReplaceHighlights(
    [
      layer("a", baseText({ content: "Color tone color" })),
      layer("b", baseText({ content: "brand color deck" })),
    ],
    matches,
  )

  expect(groups).toHaveLength(2)
  expect(groups[0].segments.map((segment) => segment.highlight ? `[${segment.text}]` : segment.text).join("")).toBe("[Color] tone [color]")
  expect(groups[1].matchCountLabel).toBe("1 match")
})

test("find and replace reports invalid regex patterns without throwing", () => {
  const result = findReplaceTextLayers([layer("a", baseText({ content: "abc" }))], {
    find: "(",
    replace: "",
    useRegex: true,
  })

  expect(result.error).toContain("Invalid regular expression")
  expect(result.matchCountLabel).toBe("0 matches")
  expect(result.layers[0].text?.content).toBe("abc")
})

test("text can be constrained inside a shape and converted to editable path outlines", () => {
  const shape: ShapeProps = { type: "rect", x: 10, y: 12, w: 180, h: 90, fill: "#ffffff", stroke: null, cornerRadii: [12, 0, 24, 6] }
  const inside = applyTextInsideShape(baseText({ content: "inside a live shape" }), shape, {
    inset: 8,
    insets: { top: 6, right: 10, bottom: 12, left: 14 },
    verticalAlign: "middle",
  })
  const path = convertTextToEditablePath(inside)

  expect(inside.textShape?.cornerRadii).toEqual([12, 0, 24, 6])
  expect(inside.boxWidth).toBe(156)
  expect(inside.textShapeInsets).toEqual({ top: 6, right: 10, bottom: 12, left: 14 })
  expect(inside.textShapeVerticalAlign).toBe("middle")
  expect(path.closed).toBe(true)
  expect(path.subpaths?.length).toBeGreaterThan(inside.content.replace(/\s/g, "").length)
  expect(path.points.length).toBeGreaterThan(inside.content.length * 3)
  expect(path.points.some((point) => point.cp1 || point.cp2)).toBe(true)
})

test("OpenType controls and anti-alias modes produce browser render settings", () => {
  const features = buildOpenTypeFeatureSettings({
    ligatures: true,
    discretionaryLigatures: true,
    contextualAlternates: false,
    stylisticAlternates: true,
    swash: true,
    ordinals: true,
    fractions: true,
    superscript: true,
    subscript: true,
    oldstyleFigures: true,
    tabularFigures: true,
    slashedZero: true,
  })
  const smooth = buildTypographyRenderPlan(baseText({ antiAliasMode: "smooth" }))
  const none = buildTypographyRenderPlan(baseText({ antiAliasMode: "none" }))

  expect(features).toContain('"dlig" 1')
  expect(features).toContain('"swsh" 1')
  expect(features).toContain('"sups" 1')
  expect(features).toContain('"subs" 1')
  expect(features).toContain('"zero" 1')
  expect(features).toContain('"tnum" 1')
  expect(smooth.renderHints.textRendering).toBe("optimizeLegibility")
  expect(none.renderHints.imageSmoothingEnabled).toBe(false)
})

test("OpenType toggles are filtered by browser support hints and text-on-path layout respects offsets", () => {
  const toggles = listOpenTypeFeatureToggles({ supportedTags: new Set(["liga", "calt", "tnum"]) })
  const glyphs = layoutTextOnPath(baseText({
    content: "ABC",
    textPath: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
    textPathStartOffset: 20,
    textPathBaselineOffset: 10,
    textPathAlign: "start",
  }))
  const vertical = buildTypographyRenderPlan(baseText({
    content: "AB12",
    vertical: true,
    verticalWritingMode: "lr",
    tateChuYoko: true,
    mojikumi: "compact",
  }))

  expect(toggles.map((toggle) => toggle.tag)).toEqual(["liga", "calt", "tnum"])
  expect(glyphs[0].x).toBeGreaterThan(20)
  expect(glyphs[0].baselineOffset).toBe(10)
  expect(vertical.writingMode).toBe("vertical-lr")
  expect(vertical.textOrientation).toBe("mixed")
})

test("vertical type exposes flow alignment and explicit glyph orientation", () => {
  const upright = buildTypographyRenderPlan(baseText({
    content: "AB12",
    vertical: true,
    verticalAlign: "bottom",
    textOrientation: "upright",
    tracking: 120,
  }))
  const sideways = buildTypographyRenderPlan(baseText({
    content: "AB12",
    vertical: true,
    textOrientation: "sideways",
  }))

  expect(upright.verticalAlign).toBe("bottom")
  expect(upright.textOrientation).toBe("upright")
  expect(upright.letterSpacing).toBe("5.04px")
  expect(upright.verticalMetrics.columnGap).toBeCloseTo(50.4)
  expect(upright.verticalMetrics.glyphSpacing).toBe(0)
  expect(sideways.textOrientation).toBe("sideways")
})

test("vertical type render plans expose explicit metric controls", () => {
  const plan = buildTypographyRenderPlan(baseText({
    content: "AB12",
    vertical: true,
    verticalColumnGap: 64,
    verticalGlyphSpacing: 6,
    verticalGlyphScale: 1.25,
    verticalUseProportionalMetrics: true,
  }))

  expect(plan.verticalMetrics).toEqual({
    columnGap: 64,
    glyphSpacing: 6,
    glyphScale: 1.25,
    proportional: true,
  })
})

test("variable font metadata parser reads axis ranges and named instances", () => {
  const metadata = parseVariableFontMetadata(buildVariationFixtureFont())

  expect(metadata.axes).toEqual([
    { tag: "wght", name: "Weight", min: 100, max: 900, defaultValue: 400 },
    { tag: "wdth", name: "Width", min: 50, max: 200, defaultValue: 100 },
  ])
  expect(metadata.namedInstances).toEqual([
    { name: "Condensed Bold", coordinates: { wght: 700, wdth: 75 } },
  ])
})

test("embedded OpenType font bytes provide feature detection, shaping, and exact glyph paths", () => {
  const fontBuffer = buildOutlineFixtureFont()
  const embeddedFont = createEmbeddedFontFromBuffer("Fixture Outline", "fixture-outline.ttf", fontBuffer, "font/ttf")
  const metadata = parseOpenTypeFontMetadata(fontBuffer)
  const support = detectOpenTypeFeatureSupport("Fixture Outline", { embeddedFont })
  const text = baseText({
    content: "A",
    font: "Fixture Outline",
    size: 100,
    x: 10,
    y: 20,
    embeddedFont,
  })
  const plan = buildTypographyRenderPlan(text)
  const path = convertTextToEditablePath(text)

  expect(metadata.unitsPerEm).toBe(1000)
  expect(metadata.glyphCount).toBe(2)
  expect(metadata.featureTags).toEqual(expect.arrayContaining(["liga", "smcp"]))
  expect(support.supportedTags.has("liga")).toBe(true)
  expect(support.supportedTags.has("smcp")).toBe(true)
  expect(plan.shaping.engine).toBe("embedded-opentype")
  expect(plan.shaping.glyphRun.map((glyph) => glyph.glyphId)).toEqual([1])
  expect(plan.shaping.advanceWidth).toBeCloseTo(70)
  expect(path.subpaths?.[0].source).toBe("font-outline")
  expect(path.subpaths?.[0].points.map((point) => [Math.round(point.x), Math.round(point.y)])).toEqual([
    [10, 100],
    [80, 100],
    [45, 30],
  ])
})

test("image-backed Match Font uses raster recognition features when no editable text is available", () => {
  installFixtureDom()
  const result = matchFontFromImageData(
    blackRectImageData(120, 60, { x: 12, y: 8, w: 88, h: 38 }),
    {
      expectedText: "AB",
      fontSize: 52,
      candidates: [
        { family: "Condensed Sans", averageGlyphWidth: 0.42, xHeight: 0.55, serif: false },
        { family: "Display Wide", averageGlyphWidth: 0.85, xHeight: 0.73, serif: false },
        { family: "Book Serif", averageGlyphWidth: 0.54, xHeight: 0.5, serif: true },
      ],
    },
  )

  expect(result.best.family).toBe("Display Wide")
  expect(result.target.source).toBe("image-recognition")
  expect(result.recognition.confidence).toBeGreaterThan(0.5)
  expect(result.candidates[0].reasons).toContain("image model")
})

test("font substitution comparison builds side-by-side previews and specimens", () => {
  const comparison = buildFontSubstitutionComparison("Missing Serif", "Georgia", "Sphinx 123", {
    systemFonts: ["Arial", "Georgia"],
    webFonts: [{ family: "Inter", averageGlyphWidth: 0.54, xHeight: 0.55, variableAxes: [{ tag: "wght", name: "Weight", min: 100, max: 900, defaultValue: 400 }] }],
  })

  expect(comparison.original.family).toBe("Missing Serif")
  expect(comparison.fallback.family).toBe("Georgia")
  expect(comparison.specimens.map((specimen) => `${specimen.source}:${specimen.family}`)).toEqual([
    "system:Arial",
    "system:Georgia",
    "web:Inter",
  ])
  expect(comparison.specimens[2].fontVariationSettings).toContain('"wght" 400')
  expect(comparison.original.geometry.averageGlyphWidth).toBeGreaterThan(0)
  expect(comparison.fallback.geometry.averageGlyphWidth).toBeGreaterThan(0)
  expect(comparison.geometryDelta.averageGlyphWidth).toBeDefined()
})

test("text-on-path handle model supports point insert, move, delete, and reverse edits", () => {
  const text = baseText({
    textPath: [
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 130, y: 60 },
    ],
    textPathAlign: "center",
    textPathStartOffset: 12,
    textPathBaselineOffset: -6,
    textPathClosed: false,
  })
  const model = buildTextPathHandleModel(text)
  const inserted = insertTextPathPoint(text, 1, { x: 50, y: 12 })
  const moved = updateTextPathPoint(inserted, 2, { x: 100, y: 28 })
  const deleted = deleteTextPathPoint(moved, 0)
  const reversed = reverseTextPath(deleted)

  expect(model.points.map((point) => point.label)).toEqual(["P1", "P2", "P3"])
  expect(model.totalLength).toBeGreaterThan(130)
  expect(model.startHandle.distance).toBe(12)
  expect(model.baselineHandle.offset).toBe(-6)
  expect(inserted.textPath?.map((point) => point.x)).toEqual([10, 50, 90, 130])
  expect(moved.textPath?.[2]).toEqual({ x: 100, y: 28 })
  expect(deleted.textPath).toHaveLength(3)
  expect(reversed.textPath?.[0]).toEqual(deleted.textPath?.[2])
})

test("3D text extrusion creates a renderable scene with per-glyph depth geometry", () => {
  const scene = createTextExtrusionScene(baseText({ content: "3D", extrusion: { enabled: true, depth: 36, bevel: 4, angle: 30, color: "#cc5500" } }))

  expect(scene.objects).toHaveLength(2)
  expect(scene.materials[0].color).toBe("#cc5500")
  expect(scene.objects[0].vertices.some((vertex) => vertex.z > 0)).toBe(true)
  expect(scene.objects[0].faces.length).toBeGreaterThanOrEqual(6)
  expect(scene.selectedObjectId).toBe(scene.objects[0].id)
})
