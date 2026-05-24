import { expect, test } from "@playwright/test"

import {
  applyTextInsideShape,
  buildFontPreview,
  buildFontSubstitutionComparison,
  buildOpenTypeFeatureSettings,
  buildTypographyRenderPlan,
  convertTextToEditablePath,
  createTextExtrusionScene,
  diagnoseDocumentFonts,
  parseVariableFontMetadata,
  layoutTextOnPath,
  listOpenTypeFeatureToggles,
  findReplaceTextLayers,
  matchFontForLayer,
  normalizeVariableAxes,
  resolveFontSubstitutions,
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
  expect(sideways.textOrientation).toBe("sideways")
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
})

test("3D text extrusion creates a renderable scene with per-glyph depth geometry", () => {
  const scene = createTextExtrusionScene(baseText({ content: "3D", extrusion: { enabled: true, depth: 36, bevel: 4, angle: 30, color: "#cc5500" } }))

  expect(scene.objects).toHaveLength(2)
  expect(scene.materials[0].color).toBe("#cc5500")
  expect(scene.objects[0].vertices.some((vertex) => vertex.z > 0)).toBe(true)
  expect(scene.objects[0].faces.length).toBeGreaterThanOrEqual(6)
  expect(scene.selectedObjectId).toBe(scene.objects[0].id)
})
