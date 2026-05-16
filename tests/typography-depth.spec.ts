import { expect, test } from "@playwright/test"

import {
  applyTextInsideShape,
  buildFontPreview,
  buildOpenTypeFeatureSettings,
  buildTypographyRenderPlan,
  convertTextToEditablePath,
  createTextExtrusionScene,
  diagnoseDocumentFonts,
  findReplaceTextLayers,
  matchFontForLayer,
  normalizeVariableAxes,
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

test("text can be constrained inside a shape and converted to editable path outlines", () => {
  const shape: ShapeProps = { type: "ellipse", x: 10, y: 12, w: 180, h: 90, fill: "#ffffff", stroke: null }
  const inside = applyTextInsideShape(baseText({ content: "inside a live shape" }), shape, { inset: 8 })
  const path = convertTextToEditablePath(inside)

  expect(inside.textShape?.type).toBe("ellipse")
  expect(inside.boxWidth).toBe(164)
  expect(path.closed).toBe(true)
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
    oldstyleFigures: true,
    tabularFigures: true,
  })
  const smooth = buildTypographyRenderPlan(baseText({ antiAliasMode: "smooth" }))
  const none = buildTypographyRenderPlan(baseText({ antiAliasMode: "none" }))

  expect(features).toContain('"dlig" 1')
  expect(features).toContain('"swsh" 1')
  expect(features).toContain('"tnum" 1')
  expect(smooth.renderHints.textRendering).toBe("optimizeLegibility")
  expect(none.renderHints.imageSmoothingEnabled).toBe(false)
})

test("3D text extrusion creates a renderable scene with per-glyph depth geometry", () => {
  const scene = createTextExtrusionScene(baseText({ content: "3D", extrusion: { enabled: true, depth: 36, bevel: 4, angle: 30, color: "#cc5500" } }))

  expect(scene.objects).toHaveLength(2)
  expect(scene.materials[0].color).toBe("#cc5500")
  expect(scene.objects[0].vertices.some((vertex) => vertex.z > 0)).toBe(true)
  expect(scene.objects[0].faces.length).toBeGreaterThanOrEqual(6)
  expect(scene.selectedObjectId).toBe(scene.objects[0].id)
})
