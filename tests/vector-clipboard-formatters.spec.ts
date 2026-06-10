import { expect, test } from "@playwright/test"

import {
  __test as formatterTestHelpers,
  buildLayerCss,
  buildLayerSvg,
  canCopyVectorClipboard,
  writeClipboardText,
} from "../components/photoshop/vector-clipboard-formatters"
import type { Layer } from "../components/photoshop/types"
import { fixtureCanvas, installFixtureDom } from "./photoshop-fixtures"

function shapeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "shape",
    name: "Hero <Badge>",
    kind: "shape",
    visible: true,
    locked: false,
    opacity: 0.8,
    blendMode: "normal",
    canvas: fixtureCanvas(120, 80),
    shape: {
      type: "rect",
      x: 10,
      y: 20,
      w: 120,
      h: 80,
      fill: "#336699",
      stroke: { color: "#ffffff", width: 3 },
      cornerRadii: [4, 8, 12, 16],
    },
    style: {
      dropShadow: {
        enabled: true,
        color: "#000000",
        size: 10,
        offsetX: 2,
        offsetY: 4,
        opacity: 0.5,
      },
      innerShadow: {
        enabled: true,
        color: "#ff0000",
        size: 3,
        offsetX: 1,
        offsetY: 2,
        opacity: 0.25,
      },
    },
    ...overrides,
  }
}

test.beforeEach(() => {
  Reflect.deleteProperty(globalThis, "document")
  installFixtureDom()
  Reflect.deleteProperty(globalThis, "window")
  Reflect.deleteProperty(globalThis, "navigator")
})

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "window")
  Reflect.deleteProperty(globalThis, "navigator")
  Reflect.deleteProperty(globalThis, "document")
})

test("layer CSS serializes shape dimensions, corners, fill, stroke, effects, opacity, and safe class names", () => {
  const css = buildLayerCss(shapeLayer())

  expect(css).toBe(
    ".hero-badge {\n" +
    "  width: 120px;\n" +
    "  height: 80px;\n" +
    "  border-radius: 4px 8px 12px 16px;\n" +
    "  background: #336699;\n" +
    "  border: 3px solid #ffffff;\n" +
    "  box-shadow: 2px 4px 10px 0px rgba(0, 0, 0, 0.5), inset 1px 2px 3px 0px rgba(255, 0, 0, 0.25);\n" +
    "  opacity: 0.8;\n" +
    "}",
  )
  expect(buildLayerCss(shapeLayer({ shape: undefined }))).toBeNull()
})

test("gradient overlays take precedence over solid fills and helper formatting is deterministic", () => {
  const layer = shapeLayer({
    name: "---",
    style: {
      gradientOverlay: {
        enabled: true,
        opacity: 1,
        gradient: {
          type: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: "#000000", opacity: 0.5 },
            { offset: 1, color: "#ffffff", opacity: 1 },
          ],
        },
      },
    },
  })
  const css = buildLayerCss(layer)

  expect(css).toContain(".shape {")
  expect(css).toContain("background: linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, rgba(255, 255, 255, 1) 100%);")
  expect(formatterTestHelpers.round(1.23456, 3)).toBe(1.235)
  expect(formatterTestHelpers.colorToRgba("#abc", 2)).toBe("rgba(170, 187, 204, 1)")
  expect(formatterTestHelpers.sanitizeClassName("  Layer / One  ")).toBe("layer-one")
})

test("layer SVG normalizes geometry bounds, escapes titles, and includes stroke and effect definitions", () => {
  const svg = buildLayerSvg(shapeLayer())

  expect(svg).toMatch(/^<svg xmlns=/)
  expect(svg).toContain('viewBox="0 0 120 80"')
  expect(svg).toContain("<title>Hero &lt;Badge&gt;</title>")
  expect(svg).toContain('transform="translate(-10 -20)"')
  expect(svg).toContain('fill="#336699"')
  expect(svg).toContain('stroke="#ffffff" stroke-width="3"')
  expect(svg).toContain("<filter id=")
  expect(svg).toContain('opacity="0.8"')
  expect(svg).toContain("SVG stroke is centered")
})

test("layer SVG can return a fragment and preserve document-space coordinates", () => {
  const fragment = buildLayerSvg(shapeLayer({ style: undefined, opacity: 1 }), {
    standalone: false,
    normalize: false,
  })

  expect(fragment).not.toContain("<svg")
  expect(fragment).not.toContain("transform=")
  expect(fragment).toContain("<path")
})

test("vector clipboard capability accepts shape, path, and vector-mask geometry only", () => {
  const canvas = fixtureCanvas(4, 4)
  const base: Layer = {
    id: "layer",
    name: "Layer",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
  }

  expect(canCopyVectorClipboard(shapeLayer())).toBe(true)
  expect(canCopyVectorClipboard({
    ...base,
    path: { closed: false, points: [{ x: 0, y: 0 }, { x: 2, y: 2 }] },
  })).toBe(true)
  expect(canCopyVectorClipboard({
    ...base,
    vectorMask: { closed: true, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }] },
  })).toBe(true)
  expect(canCopyVectorClipboard(base)).toBe(false)
  expect(canCopyVectorClipboard(null)).toBe(false)
  expect(buildLayerSvg(base)).toBeNull()
})

test("secure clipboard writing uses navigator.clipboard and returns success", async () => {
  const written: string[] = []
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: true },
  })
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (value: string) => { written.push(value) } } },
  })

  expect(await writeClipboardText("vector data")).toBe(true)
  expect(written).toEqual(["vector data"])
})

test("clipboard writing falls back to a temporary textarea when the async API fails", async () => {
  const actions: string[] = []
  const textarea = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: (name: string) => actions.push(`attr:${name}`),
    select: () => actions.push("select"),
  }
  const body = {
    appendChild: (node: unknown) => { expect(node).toBe(textarea); actions.push("append") },
    removeChild: (node: unknown) => { expect(node).toBe(textarea); actions.push("remove") },
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: true },
  })
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error("denied") } } },
  })
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        expect(tag).toBe("textarea")
        return textarea
      },
      body,
      execCommand: (command: string) => {
        actions.push(`exec:${command}`)
        return true
      },
    },
  })

  expect(await writeClipboardText("fallback data")).toBe(true)
  expect(textarea.value).toBe("fallback data")
  expect(actions).toEqual(["attr:readonly", "append", "select", "exec:copy", "remove"])
})

test("clipboard writing reports false during SSR or when both copy paths fail", async () => {
  expect(await writeClipboardText("no window")).toBe(false)

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: false },
  })
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => { throw new Error("blocked") } },
  })
  expect(await writeClipboardText("blocked")).toBe(false)
})
