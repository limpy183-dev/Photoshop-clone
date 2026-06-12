import { expect, test } from "@playwright/test"

import {
  canvasRuntimePreferencesFrom,
  clampZoom,
  getCustomShapeRuntimeId,
  getCustomShapeRuntimePreset,
  getEyedropperSampleSize,
  getFrameRuntimeOptions,
  getMoveRuntimeOptions,
  getPathRuntimeOptions,
  getShapeRuntimeOptions,
  layerAllowsDrawing,
  layerAllowsMoving,
  layerBlocksAllEdits,
} from "../components/photoshop/canvas-view-runtime"
import { DEFAULT_PREFERENCES } from "../components/photoshop/preferences-engine"
import type { Layer, ShapeProps } from "../components/photoshop/types"

test.beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  })
})

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "window")
})

test("runtime tool options retain defaults and current normalization rules", () => {
  expect(getMoveRuntimeOptions()).toEqual({
    autoSelect: true,
    select: "layer",
    showTransformControls: false,
  })
  expect(getPathRuntimeOptions()).toEqual({ handleMode: "symmetric" })
  expect(getFrameRuntimeOptions()).toEqual({ shape: "rect" })
  expect(getEyedropperSampleSize()).toBe("point")

  window.__psMoveOptions = {
    autoSelect: false,
    select: "group",
    showTransformControls: true,
  }
  window.__psShapeOptions = {
    strokeWidth: -3,
    radius: -4,
    sides: 100,
    innerRadiusRatio: 2,
    vertexRoundness: -1,
    polygonStarMode: true,
    smoothCorners: true,
    smoothIndent: true,
    rotation: 17,
    cornerRadiusTL: 4,
  }
  window.__psPathOptions = { handleMode: "broken" }
  window.__psFrameOptions = { shape: "ellipse" }
  window.__psEyedropperSampleSize = "5x5"

  expect(getMoveRuntimeOptions()).toEqual({
    autoSelect: false,
    select: "group",
    showTransformControls: true,
  })
  expect(getShapeRuntimeOptions()).toEqual({
    strokeWidth: 0,
    radius: 0,
    sides: 64,
    innerRadiusRatio: 0.95,
    vertexRoundness: 0,
    polygonStarMode: true,
    smoothCorners: true,
    smoothIndent: true,
    rotation: 17,
    cornerRadiusTL: 4,
    cornerRadiusTR: undefined,
    cornerRadiusBR: undefined,
    cornerRadiusBL: undefined,
  })
  expect(getPathRuntimeOptions()).toEqual({ handleMode: "broken" })
  expect(getFrameRuntimeOptions()).toEqual({ shape: "ellipse" })
  expect(getEyedropperSampleSize()).toBe("5x5")
})

test("custom shape runtime values preserve supported ids and preset identity", () => {
  expect(getCustomShapeRuntimeId()).toBe("star5")
  expect(getCustomShapeRuntimePreset()).toBeNull()

  window.__psCustomShape = "heart"
  expect(getCustomShapeRuntimeId()).toBe("heart")

  window.__psCustomShape = "unsupported-shape"
  expect(getCustomShapeRuntimeId()).toBe("star5")

  const preset = {
    type: "ellipse",
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    fill: "#112233",
    stroke: null,
  } satisfies ShapeProps
  window.__psCustomShapePreset = preset
  expect(getCustomShapeRuntimePreset()).toBe(preset)

  window.__psCustomShapePreset = null as unknown as ShapeProps
  expect(getCustomShapeRuntimePreset()).toBeNull()
})

test("canvas preferences map the existing runtime fields and zoom keeps its bounds", () => {
  const preferences = structuredClone(DEFAULT_PREFERENCES)
  preferences.toolBehavior.cursorStyle = "precise"
  preferences.toolBehavior.showBrushPreview = false
  preferences.toolBehavior.showBrushSizeCrosshair = true
  preferences.toolBehavior.showToolStatusHud = false
  preferences.rulerGrid.screenDpi = 144
  preferences.rulerGrid.printResolution = 600
  preferences.rulerGrid.rulerUnits = "cm"

  expect(canvasRuntimePreferencesFrom(preferences)).toEqual({
    cursorStyle: "precise",
    showBrushPreview: false,
    showBrushSizeCrosshair: true,
    showToolStatusHud: false,
    screenDpi: 144,
    printResolution: 600,
    rulerUnits: "cm",
  })
  expect(clampZoom(-1)).toBe(0.05)
  expect(clampZoom(1.25)).toBe(1.25)
  expect(clampZoom(100)).toBe(32)
})

test("layer edit permissions retain lock and group behavior", () => {
  const raster = { kind: "raster", locked: false } as Layer
  const group = { kind: "group", locked: false } as Layer
  const locked = { kind: "raster", locked: true } as Layer
  const lockAll = { kind: "raster", locked: false, lockAll: true } as Layer
  const lockDraw = { kind: "raster", locked: false, lockDraw: true } as Layer
  const lockMove = { kind: "raster", locked: false, lockMove: true } as Layer

  expect(layerBlocksAllEdits(null)).toBe(true)
  expect(layerBlocksAllEdits(raster)).toBeFalsy()
  expect(layerBlocksAllEdits(locked)).toBe(true)
  expect(layerBlocksAllEdits(lockAll)).toBe(true)

  expect(layerAllowsDrawing(raster)).toBe(true)
  expect(layerAllowsDrawing(group)).toBe(false)
  expect(layerAllowsDrawing(lockDraw)).toBe(false)
  expect(layerAllowsDrawing(lockMove)).toBe(true)

  expect(layerAllowsMoving(raster)).toBe(true)
  expect(layerAllowsMoving(group)).toBe(false)
  expect(layerAllowsMoving(lockMove)).toBe(false)
  expect(layerAllowsMoving(lockDraw)).toBe(true)
})
