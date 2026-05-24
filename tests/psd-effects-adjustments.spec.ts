import { expect, test } from "@playwright/test"

import {
  EFFECTS_ADJUSTMENTS_CAPABILITY,
  SMART_FILTERS_INFO_KEY,
  appAdjustmentToPsdLayer,
  appAdvancedBlendingToPsd,
  appSmartFiltersToPsd,
  layerStyleToPsdEffects,
  psdEffectsToLayerStyle,
  psdLayerToAppAdjustment,
  psdToAppAdvancedBlending,
  psdToAppSmartFilters,
} from "../components/photoshop/psd-effects-adjustments"
import type {
  AdjustmentProps,
  AdjustmentType,
  AdvancedBlending,
  Layer,
  LayerStyle,
  SmartFilter,
} from "../components/photoshop/types"

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function fixtureCanvas(): HTMLCanvasElement {
  // Minimal stub good enough for serialization paths that read .width/.height.
  return {
    width: 64,
    height: 48,
    getContext: () => null,
  } as unknown as HTMLCanvasElement
}

function adjustmentLayer(adjustment: AdjustmentProps): Layer {
  return {
    id: `adj_${adjustment.type}`,
    name: `Adjustment ${adjustment.type}`,
    kind: "adjustment",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(),
    adjustment,
  }
}

/* -------------------------------------------------------------------------- */
/* Capability surface                                                          */
/* -------------------------------------------------------------------------- */

test("capability descriptor enumerates every adjustment type", () => {
  const expected: AdjustmentType[] = [
    "brightness-contrast",
    "levels",
    "curves",
    "exposure",
    "vibrance",
    "hue-saturation",
    "color-balance",
    "black-white",
    "photo-filter",
    "channel-mixer",
    "color-lookup",
    "invert",
    "posterize",
    "threshold",
    "gradient-map",
    "selective-color",
    "shadows-highlights",
    "hdr-toning",
    "desaturate",
    "match-color",
    "replace-color",
    "equalize",
  ]
  for (const type of expected) {
    expect(EFFECTS_ADJUSTMENTS_CAPABILITY.adjustments[type]).toBeDefined()
  }
  expect(EFFECTS_ADJUSTMENTS_CAPABILITY.layerStyles).toBe("round-trip")
  expect(EFFECTS_ADJUSTMENTS_CAPABILITY.smartFilters).toBe("metadata-preserved")
  expect(EFFECTS_ADJUSTMENTS_CAPABILITY.advancedBlending).toBe("round-trip")
})

/* -------------------------------------------------------------------------- */
/* Layer styles                                                                */
/* -------------------------------------------------------------------------- */

test("drop shadow round-trips through PSD effects with global light", () => {
  const style: LayerStyle = {
    dropShadow: {
      enabled: true,
      color: "#102030",
      size: 12,
      offsetX: 6,
      offsetY: -6,
      opacity: 0.6,
      blendMode: "multiply",
      spread: 3,
      contour: "sharp",
      useGlobalLight: false,
    },
  }
  const psd = layerStyleToPsdEffects(style)
  expect(psd?.dropShadow?.[0]?.enabled).toBe(true)
  const back = psdEffectsToLayerStyle(psd)
  expect(back?.dropShadow?.enabled).toBe(true)
  expect(back?.dropShadow?.color).toBe("#102030")
  expect(back?.dropShadow?.size).toBeCloseTo(12)
  expect(back?.dropShadow?.opacity).toBeCloseTo(0.6, 3)
  expect(back?.dropShadow?.blendMode).toBe("multiply")
  expect(back?.dropShadow?.contour).toBe("sharp")
})

test("drop shadow honours global light when useGlobalLight is set", () => {
  const psd = layerStyleToPsdEffects(
    {
      dropShadow: {
        enabled: true,
        color: "#000000",
        size: 4,
        offsetX: 3,
        offsetY: -3,
        opacity: 0.5,
        blendMode: "multiply",
        useGlobalLight: true,
      },
    },
    { angle: 30, altitude: 45 },
  )
  expect(psd?.dropShadow?.[0]?.angle).toBe(30)
  expect(psd?.dropShadow?.[0]?.useGlobalLight).toBe(true)
})

test("inner shadow round-trips choke and color", () => {
  const style: LayerStyle = {
    innerShadow: {
      enabled: true,
      color: "#883322",
      size: 8,
      offsetX: -4,
      offsetY: 4,
      opacity: 0.4,
      blendMode: "darken",
      choke: 2,
    },
  }
  const back = psdEffectsToLayerStyle(layerStyleToPsdEffects(style))
  expect(back?.innerShadow?.enabled).toBe(true)
  expect(back?.innerShadow?.color).toBe("#883322")
  expect(back?.innerShadow?.choke).toBe(2)
  expect(back?.innerShadow?.blendMode).toBe("darken")
})

test("outer glow round-trips noise and range fields", () => {
  const style: LayerStyle = {
    outerGlow: {
      enabled: true,
      color: "#ffeecc",
      size: 16,
      opacity: 0.55,
      blendMode: "screen",
      spread: 4,
      range: 60,
      noise: 12,
      contour: "ring",
    },
  }
  const back = psdEffectsToLayerStyle(layerStyleToPsdEffects(style))
  expect(back?.outerGlow?.enabled).toBe(true)
  expect(back?.outerGlow?.color).toBe("#ffeecc")
  expect(back?.outerGlow?.range).toBe(60)
  expect(back?.outerGlow?.noise).toBe(12)
  expect(back?.outerGlow?.contour).toBe("ring")
})

test("inner glow round-trips source and contour", () => {
  const style: LayerStyle = {
    innerGlow: {
      enabled: true,
      color: "#ffaa88",
      size: 5,
      opacity: 0.7,
      blendMode: "lighter-color",
      source: "center",
      choke: 1,
      contour: "cone",
    },
  }
  const back = psdEffectsToLayerStyle(layerStyleToPsdEffects(style))
  expect(back?.innerGlow?.enabled).toBe(true)
  expect(back?.innerGlow?.source).toBe("center")
  expect(back?.innerGlow?.contour).toBe("cone")
  expect(back?.innerGlow?.blendMode).toBe("lighter-color")
})

test("stroke round-trips position, color and gradient fill", () => {
  const colorStroke: LayerStyle = {
    stroke: {
      enabled: true,
      color: "#112233",
      size: 6,
      position: "inside",
      opacity: 0.9,
      blendMode: "normal",
      fillType: "color",
    },
  }
  const back = psdEffectsToLayerStyle(layerStyleToPsdEffects(colorStroke))
  expect(back?.stroke?.enabled).toBe(true)
  expect(back?.stroke?.position).toBe("inside")
  expect(back?.stroke?.fillType).toBe("color")
  expect(back?.stroke?.color).toBe("#112233")

  const gradientStroke: LayerStyle = {
    stroke: {
      enabled: true,
      color: "#000000",
      size: 4,
      position: "center",
      opacity: 1,
      blendMode: "normal",
      fillType: "gradient",
      gradient: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#ff0000", opacity: 1 },
          { offset: 1, color: "#0000ff", opacity: 1 },
        ],
      },
    },
  }
  const gBack = psdEffectsToLayerStyle(layerStyleToPsdEffects(gradientStroke))
  expect(gBack?.stroke?.fillType).toBe("gradient")
  expect(gBack?.stroke?.gradient?.stops.length).toBe(2)
  expect(gBack?.stroke?.gradient?.stops[0].color).toBe("#ff0000")
  expect(gBack?.stroke?.gradient?.stops[1].color).toBe("#0000ff")
})

test("color overlay round-trips blend mode and opacity", () => {
  const back = psdEffectsToLayerStyle(
    layerStyleToPsdEffects({
      colorOverlay: { enabled: true, color: "#445566", opacity: 0.33, blendMode: "overlay" },
    }),
  )
  expect(back?.colorOverlay?.enabled).toBe(true)
  expect(back?.colorOverlay?.color).toBe("#445566")
  expect(back?.colorOverlay?.opacity).toBeCloseTo(0.33, 3)
  expect(back?.colorOverlay?.blendMode).toBe("overlay")
})

test("gradient overlay round-trips type, angle, stops", () => {
  const style: LayerStyle = {
    gradientOverlay: {
      enabled: true,
      blendMode: "soft-light",
      opacity: 0.85,
      gradient: {
        type: "radial",
        angle: 45,
        stops: [
          { offset: 0, color: "#ffff00", opacity: 1 },
          { offset: 0.5, color: "#00ff00", opacity: 0.8 },
          { offset: 1, color: "#0000ff", opacity: 0.3 },
        ],
      },
    },
  }
  const back = psdEffectsToLayerStyle(layerStyleToPsdEffects(style))
  expect(back?.gradientOverlay?.enabled).toBe(true)
  expect(back?.gradientOverlay?.gradient.type).toBe("radial")
  expect(back?.gradientOverlay?.gradient.stops.length).toBe(3)
  expect(back?.gradientOverlay?.gradient.stops[2].opacity).toBeCloseTo(0.3, 2)
})

test("bevel round-trips style, direction, colors, contour", () => {
  const style: LayerStyle = {
    bevel: {
      enabled: true,
      style: "emboss",
      direction: "down",
      depth: 80,
      size: 10,
      soften: 2,
      angle: 120,
      altitude: 30,
      highlight: "#ffffff",
      shadow: "#222222",
      opacity: 0.75,
      highlightOpacity: 0.8,
      shadowOpacity: 0.6,
      highlightBlendMode: "screen",
      shadowBlendMode: "multiply",
      contour: "soft",
    },
  }
  const back = psdEffectsToLayerStyle(layerStyleToPsdEffects(style))
  expect(back?.bevel?.enabled).toBe(true)
  expect(back?.bevel?.style).toBe("emboss")
  expect(back?.bevel?.direction).toBe("down")
  expect(back?.bevel?.depth).toBe(80)
  expect(back?.bevel?.highlight).toBe("#ffffff")
  expect(back?.bevel?.shadow).toBe("#222222")
  expect(back?.bevel?.contour).toBe("soft")
})

test("satin round-trips invert and distance", () => {
  const style: LayerStyle = {
    satin: {
      enabled: true,
      color: "#332211",
      blendMode: "multiply",
      opacity: 0.4,
      angle: 19,
      distance: 12,
      size: 18,
      invert: true,
    },
  }
  const back = psdEffectsToLayerStyle(layerStyleToPsdEffects(style))
  expect(back?.satin?.enabled).toBe(true)
  expect(back?.satin?.invert).toBe(true)
  expect(back?.satin?.distance).toBe(12)
})

test("pattern overlay round-trips name, scale, align, phase", () => {
  const style: LayerStyle = {
    patternOverlay: {
      enabled: true,
      pattern: "Houndstooth",
      blendMode: "multiply",
      opacity: 0.7,
      scale: 150,
      align: false,
      phase: { x: 4, y: 8 },
    },
  }
  const back = psdEffectsToLayerStyle(layerStyleToPsdEffects(style))
  expect(back?.patternOverlay?.enabled).toBe(true)
  expect(back?.patternOverlay?.pattern).toBe("Houndstooth")
  expect(back?.patternOverlay?.scale).toBe(150)
  expect(back?.patternOverlay?.align).toBe(false)
  expect(back?.patternOverlay?.phase).toEqual({ x: 4, y: 8 })
})

test("layerStyleToPsdEffects returns undefined for empty style", () => {
  expect(layerStyleToPsdEffects({})).toBeUndefined()
  expect(layerStyleToPsdEffects(undefined)).toBeUndefined()
})

/* -------------------------------------------------------------------------- */
/* Adjustments: native ag-psd round-trip                                       */
/* -------------------------------------------------------------------------- */

function roundTripNative(adjustment: AdjustmentProps): AdjustmentProps | null {
  const psdFields = appAdjustmentToPsdLayer(adjustmentLayer(adjustment))
  const stub = {
    name: "Adjustment",
    adjustment: psdFields.adjustment,
  } as unknown as Parameters<typeof psdLayerToAppAdjustment>[0]
  return psdLayerToAppAdjustment(stub)
}

test("brightness-contrast round-trips natively", () => {
  const result = roundTripNative({
    type: "brightness-contrast",
    params: { brightness: 22, contrast: -12, useLegacy: true },
  })
  expect(result?.type).toBe("brightness-contrast")
  expect(result?.params.brightness).toBe(22)
  expect(result?.params.contrast).toBe(-12)
  expect(result?.params.useLegacy).toBe(true)
})

test("levels round-trips per channel", () => {
  const result = roundTripNative({
    type: "levels",
    params: { channel: "red", inputBlack: 12, inputWhite: 240, gamma: 1.2, outputBlack: 10, outputWhite: 250 },
  })
  expect(result?.type).toBe("levels")
  expect(result?.params.channel).toBe("red")
  expect(result?.params.inputBlack).toBe(12)
  expect(result?.params.inputWhite).toBe(240)
  expect(Number(result?.params.gamma)).toBeCloseTo(1.2, 2)
})

test("curves round-trips shadow/midtone/highlight points", () => {
  const result = roundTripNative({
    type: "curves",
    params: { channel: "rgb", shadow: 8, midtone: 140, highlight: 248 },
  })
  expect(result?.type).toBe("curves")
  expect(result?.params.channel).toBe("rgb")
  expect(result?.params.shadow).toBe(8)
  expect(result?.params.midtone).toBe(140)
  expect(result?.params.highlight).toBe(248)
})

test("exposure round-trips EV", () => {
  const result = roundTripNative({ type: "exposure", params: { ev: 1.5 } })
  expect(result?.params.ev).toBeCloseTo(1.5, 3)
})

test("vibrance round-trips amount and saturation", () => {
  const result = roundTripNative({
    type: "vibrance",
    params: { amount: 30, saturation: -10 },
  })
  expect(result?.params.amount).toBe(30)
  expect(result?.params.saturation).toBe(-10)
})

test("hue-saturation round-trips master channel", () => {
  const result = roundTripNative({
    type: "hue-saturation",
    params: { range: "master", hue: 12, saturation: -8, lightness: 4, colorize: false },
  })
  expect(result?.type).toBe("hue-saturation")
  expect(result?.params.hue).toBe(12)
  expect(result?.params.saturation).toBe(-8)
  expect(result?.params.lightness).toBe(4)
})

test("color-balance round-trips per-tone CMY values", () => {
  const result = roundTripNative({
    type: "color-balance",
    params: {
      tone: "shadows",
      cyanRed: 10,
      magentaGreen: -5,
      yellowBlue: 8,
      preserveLuminosity: true,
    },
  })
  expect(result?.params.tone).toBe("shadows")
  expect(result?.params.cyanRed).toBe(10)
  expect(result?.params.magentaGreen).toBe(-5)
  expect(result?.params.yellowBlue).toBe(8)
})

test("black-white round-trips channel mixers", () => {
  const result = roundTripNative({
    type: "black-white",
    params: {
      reds: 40,
      yellows: 60,
      greens: 30,
      cyans: 50,
      blues: 25,
      magentas: 70,
      tint: false,
    },
  })
  expect(result?.type).toBe("black-white")
  expect(result?.params.reds).toBe(40)
  expect(result?.params.yellows).toBe(60)
  expect(result?.params.magentas).toBe(70)
})

test("photo-filter round-trips color key and density", () => {
  const result = roundTripNative({
    type: "photo-filter",
    params: { color: "blue", density: 40 },
  })
  expect(result?.type).toBe("photo-filter")
  expect(result?.params.color).toBe("blue")
  expect(result?.params.density).toBe(40)
})

test("channel-mixer round-trips all rows", () => {
  const result = roundTripNative({
    type: "channel-mixer",
    params: {
      rR: 80, rG: 10, rB: 5,
      gR: 5, gG: 90, gB: 5,
      bR: 0, bG: 10, bB: 90,
    },
  })
  expect(result?.params.rR).toBe(80)
  expect(result?.params.gG).toBe(90)
  expect(result?.params.bB).toBe(90)
})

test("color-lookup preserves strength via encoded name", () => {
  const result = roundTripNative({ type: "color-lookup", params: { strength: 75 } })
  expect(result?.type).toBe("color-lookup")
  expect(result?.params.strength).toBe(75)
})

test("invert round-trips with empty params", () => {
  const result = roundTripNative({ type: "invert", params: {} })
  expect(result?.type).toBe("invert")
})

test("posterize round-trips levels", () => {
  const result = roundTripNative({ type: "posterize", params: { levels: 6 } })
  expect(result?.params.levels).toBe(6)
})

test("threshold round-trips level", () => {
  const result = roundTripNative({ type: "threshold", params: { level: 80 } })
  expect(result?.params.level).toBe(80)
})

test("gradient-map round-trips dither and reverse", () => {
  const result = roundTripNative({
    type: "gradient-map",
    params: { dither: false, reverse: true },
  })
  expect(result?.params.dither).toBe(false)
  expect(result?.params.reverse).toBe(true)
})

test("selective-color round-trips CMY+K buckets", () => {
  const result = roundTripNative({
    type: "selective-color",
    params: {
      cyans: 10,
      magentas: 15,
      yellows: 20,
      whites: 5,
      neutrals: 25,
      blacks: 30,
    },
  })
  expect(result?.type).toBe("selective-color")
  expect(result?.params.cyans).toBe(10)
  expect(result?.params.whites).toBe(5)
  expect(result?.params.blacks).toBe(30)
})

/* -------------------------------------------------------------------------- */
/* Adjustments: marker-fallback round-trip                                     */
/* -------------------------------------------------------------------------- */

function roundTripMarker(adjustment: AdjustmentProps): AdjustmentProps | null {
  const psdFields = appAdjustmentToPsdLayer(adjustmentLayer(adjustment))
  // Marker-fallback path produces a `name` field instead of `adjustment`.
  expect(psdFields.adjustment).toBeUndefined()
  expect(typeof psdFields.name).toBe("string")
  const stub = { name: psdFields.name } as unknown as Parameters<typeof psdLayerToAppAdjustment>[0]
  return psdLayerToAppAdjustment(stub)
}

test("shadows-highlights round-trips through marker-name encoding", () => {
  const result = roundTripMarker({
    type: "shadows-highlights",
    params: { shadowAmount: 35, highlightAmount: 20, midtoneContrast: 5 },
  })
  expect(result?.type).toBe("shadows-highlights")
  expect(result?.params.shadowAmount).toBe(35)
  expect(result?.params.highlightAmount).toBe(20)
  expect(result?.params.midtoneContrast).toBe(5)
})

test("hdr-toning round-trips via marker", () => {
  const result = roundTripMarker({
    type: "hdr-toning",
    params: { method: "local", radius: 30, strength: 0.7 },
  })
  expect(result?.type).toBe("hdr-toning")
  expect(result?.params.method).toBe("local")
  expect(result?.params.radius).toBe(30)
})

test("desaturate round-trips via marker", () => {
  const result = roundTripMarker({ type: "desaturate", params: {} })
  expect(result?.type).toBe("desaturate")
})

test("match-color round-trips via marker", () => {
  const result = roundTripMarker({
    type: "match-color",
    params: { source: "doc-a", luminance: 0.9, colorIntensity: 1.1, fadeAmount: 0 },
  })
  expect(result?.type).toBe("match-color")
  expect(result?.params.source).toBe("doc-a")
  expect(result?.params.luminance).toBeCloseTo(0.9, 3)
})

test("replace-color round-trips via marker", () => {
  const result = roundTripMarker({
    type: "replace-color",
    params: { target: "#aabbcc", replacement: "#112233", fuzziness: 40 },
  })
  expect(result?.type).toBe("replace-color")
  expect(result?.params.target).toBe("#aabbcc")
  expect(result?.params.replacement).toBe("#112233")
  expect(result?.params.fuzziness).toBe(40)
})

test("equalize round-trips via marker", () => {
  const result = roundTripMarker({ type: "equalize", params: {} })
  expect(result?.type).toBe("equalize")
})

test("non-marker non-adjustment names yield null", () => {
  expect(psdLayerToAppAdjustment({ name: "Just a layer" } as unknown as Parameters<typeof psdLayerToAppAdjustment>[0])).toBeNull()
})

test("malformed marker decodes safely to null", () => {
  expect(
    psdLayerToAppAdjustment({ name: "__adj:invalid-type:zzzz__" } as unknown as Parameters<typeof psdLayerToAppAdjustment>[0]),
  ).toBeNull()
})

/* -------------------------------------------------------------------------- */
/* Smart filters                                                               */
/* -------------------------------------------------------------------------- */

test("smart filter stack serializes into additionalLayerInfo and round-trips", () => {
  const smartFilters: SmartFilter[] = [
    {
      id: "sf_1",
      filterId: "gaussian-blur",
      name: "Gaussian Blur",
      enabled: true,
      opacity: 0.8,
      blendMode: "soft-light",
      params: { radius: 5 },
      mask: null,
      maskEnabled: true,
    },
    {
      id: "sf_2",
      filterId: "unsharp-mask",
      name: "Unsharp Mask",
      enabled: false,
      opacity: 1,
      blendMode: "normal",
      params: { amount: 80, radius: 1.2, threshold: 4 },
      mask: null,
      maskEnabled: false,
    },
  ]
  const layer: Layer = {
    id: "layer_smart",
    name: "Smart",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(),
    smartFilters,
  }

  const captured: HTMLCanvasElement[] = []
  const result = appSmartFiltersToPsd(layer, (source) => {
    captured.push(source)
    return source
  })
  expect(result).not.toBeNull()
  expect(captured.length).toBe(1)
  expect(result?.additionalInfo[SMART_FILTERS_INFO_KEY]).toBeDefined()

  const back = psdToAppSmartFilters({
    additionalLayerInfo: result!.additionalInfo,
  } as unknown as Parameters<typeof psdToAppSmartFilters>[0])

  expect(back?.length).toBe(2)
  expect(back?.[0].filterId).toBe("gaussian-blur")
  expect(back?.[0].enabled).toBe(true)
  expect(back?.[0].opacity).toBeCloseTo(0.8, 3)
  expect(back?.[0].blendMode).toBe("soft-light")
  expect(back?.[0].params.radius).toBe(5)
  expect(back?.[1].filterId).toBe("unsharp-mask")
  expect(back?.[1].enabled).toBe(false)
  expect(back?.[1].params.amount).toBe(80)
  expect(back?.[1].maskEnabled).toBe(false)
})

test("smart filters helper returns null when no filters are attached", () => {
  const layer: Layer = {
    id: "no_sf",
    name: "Plain",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(),
  }
  expect(appSmartFiltersToPsd(layer)).toBeNull()
  expect(psdToAppSmartFilters({} as unknown as Parameters<typeof psdToAppSmartFilters>[0])).toBeUndefined()
})

/* -------------------------------------------------------------------------- */
/* Advanced blending                                                           */
/* -------------------------------------------------------------------------- */

test("advanced blending round-trips fillOpacity, knockout, channels and blend-if ranges", () => {
  const advancedBlending: AdvancedBlending = {
    fillOpacity: 0.55,
    knockout: "shallow",
    channels: { r: true, g: false, b: true },
    blendIfThis: { black: 20, blackFeather: 30, whiteFeather: 200, white: 230 },
    blendIfUnderlying: { black: 5, blackFeather: 15, whiteFeather: 240, white: 255 },
  }
  const layer: Layer = {
    id: "layer_ab",
    name: "Advanced Blending",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(),
    advancedBlending,
  }
  const psdFields = appAdvancedBlendingToPsd(layer)
  expect(psdFields.fillOpacity).toBeCloseTo(0.55, 3)
  expect(psdFields.knockout).toBe(true)
  expect(psdFields.channelBlendingRestrictions).toEqual([1])
  expect(psdFields.blendingRanges?.compositeGrayBlendSource).toEqual([20, 30, 200, 230])
  expect(psdFields.blendingRanges?.compositeGraphBlendDestinationRange).toEqual([5, 15, 240, 255])

  const back = psdToAppAdvancedBlending({
    fillOpacity: psdFields.fillOpacity,
    knockout: psdFields.knockout,
    channelBlendingRestrictions: psdFields.channelBlendingRestrictions,
    blendingRanges: psdFields.blendingRanges,
  } as unknown as Parameters<typeof psdToAppAdvancedBlending>[0])

  expect(back?.fillOpacity).toBeCloseTo(0.55, 3)
  expect(back?.knockout).toBe("shallow")
  expect(back?.channels.r).toBe(true)
  expect(back?.channels.g).toBe(false)
  expect(back?.channels.b).toBe(true)
  expect(back?.blendIfThis.black).toBe(20)
  expect(back?.blendIfThis.white).toBe(230)
  expect(back?.blendIfUnderlying.blackFeather).toBe(15)
  expect(back?.blendIfUnderlying.whiteFeather).toBe(240)
})

test("advanced blending helper returns empty when no advanced blend data", () => {
  const layer: Layer = {
    id: "no_ab",
    name: "Plain",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(),
  }
  expect(appAdvancedBlendingToPsd(layer)).toEqual({})
  expect(
    psdToAppAdvancedBlending({} as unknown as Parameters<typeof psdToAppAdvancedBlending>[0]),
  ).toBeUndefined()
})

test("advanced blending decodes default blend-if when ranges missing", () => {
  const back = psdToAppAdvancedBlending({
    fillOpacity: 1,
    knockout: false,
    blendingRanges: { compositeGrayBlendSource: undefined, compositeGraphBlendDestinationRange: undefined, ranges: [] },
  } as unknown as Parameters<typeof psdToAppAdvancedBlending>[0])
  expect(back?.blendIfThis).toEqual({ black: 0, blackFeather: 0, whiteFeather: 255, white: 255 })
  expect(back?.blendIfUnderlying).toEqual({ black: 0, blackFeather: 0, whiteFeather: 255, white: 255 })
  expect(back?.knockout).toBe("none")
})
