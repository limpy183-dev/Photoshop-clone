import type { OpenTypeControls, TextProps, TypographyEmbeddedFont } from "../types"
import {
  fontFamilyList,
  OPEN_TYPE_FEATURE_SAMPLES,
  OPEN_TYPE_FEATURE_TOGGLES,
  type OpenTypeFeatureSupport,
} from "../typography-engine-types"
import { embeddedFontToArrayBuffer } from "./embedded-fonts"
import { parseOpenTypeFontMetadata } from "./font-metadata"

export function textOpenTypeControls(text: TextProps): OpenTypeControls {
  return {
    ligatures: text.ligatures,
    discretionaryLigatures: text.discretionaryLigatures,
    contextualAlternates: text.contextualAlternates,
    stylisticAlternates: text.stylisticAlternates,
    swash: text.swash,
    ordinals: text.ordinals,
    fractions: text.fractions,
    superscript: text.superscript,
    subscript: text.subscript,
    slashedZero: text.slashedZero,
    smallCaps: text.smallCaps,
    oldstyleFigures: text.oldstyleFigures,
    tabularFigures: text.tabularFigures,
    ...text.openType,
  }
}

export function buildOpenTypeFeatureSettings(controls: OpenTypeControls = {}) {
  const ligatures = controls.ligatures !== false
  const features: Array<[string, boolean]> = [
    ["liga", ligatures],
    ["clig", ligatures],
    ["dlig", !!controls.discretionaryLigatures],
    ["calt", controls.contextualAlternates !== false],
    ["salt", !!controls.stylisticAlternates],
    ["swsh", !!controls.swash],
    ["ordn", !!controls.ordinals],
    ["frac", !!controls.fractions],
    ["sups", !!controls.superscript],
    ["subs", !!controls.subscript],
    ["zero", !!controls.slashedZero],
    ["smcp", !!controls.smallCaps],
    ["onum", !!controls.oldstyleFigures],
    ["tnum", !!controls.tabularFigures],
  ]
  return features.map(([tag, enabled]) => `"${tag}" ${enabled ? 1 : 0}`).join(", ")
}

export function listOpenTypeFeatureToggles(options: { supportedTags?: Set<string> | string[] } = {}) {
  const supported = Array.isArray(options.supportedTags)
    ? new Set(options.supportedTags)
    : options.supportedTags
  if (!supported) return OPEN_TYPE_FEATURE_TOGGLES.map((toggle) => ({ ...toggle }))
  return OPEN_TYPE_FEATURE_TOGGLES
    .filter((toggle) => supported.has(toggle.tag))
    .map((toggle) => ({ ...toggle }))
}

function cssSupportsOpenTypeTag(tag: string) {
  const css = (globalThis as typeof globalThis & { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS
  if (!css?.supports) return true
  try {
    return css.supports("font-feature-settings", `"${tag}" 1`)
  } catch {
    return true
  }
}

function browserFontCheck(font: string) {
  if (typeof document === "undefined" || !("fonts" in document)) return true
  try {
    return document.fonts.check(`16px ${fontFamilyList(font)}`)
  } catch {
    return true
  }
}

function canvasFeatureDiffers(font: string, tag: string) {
  if (typeof document === "undefined") return undefined
  try {
    const sample = OPEN_TYPE_FEATURE_SAMPLES[tag] ?? "Hamburgefonts 123"
    const canvas = document.createElement("canvas")
    canvas.width = 240
    canvas.height = 48
    const ctx = canvas.getContext("2d")
    if (!ctx || typeof ctx.fillText !== "function" || typeof ctx.getImageData !== "function") return undefined
    const draw = (feature: string) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = "#ffffff"
      ctx.font = `28px ${fontFamilyList(font)}`
      ctx.fontFeatureSettings = feature
      ctx.fillText(sample, 6, 34)
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const off = draw("normal")
    const on = draw(`"${tag}" 1`)
    for (let i = 0; i < off.length; i += 4) {
      if (off[i + 3] !== on[i + 3] || off[i] !== on[i] || off[i + 1] !== on[i + 1] || off[i + 2] !== on[i + 2]) return true
    }
    return false
  } catch {
    return undefined
  }
}

export function detectOpenTypeFeatureSupport(
  font: string,
  options: { embeddedFont?: TypographyEmbeddedFont; fontData?: ArrayBuffer } = {},
): OpenTypeFeatureSupport {
  const browserSupportedTags = new Set(OPEN_TYPE_FEATURE_TOGGLES.filter((toggle) => cssSupportsOpenTypeTag(toggle.tag)).map((toggle) => toggle.tag))
  const fontData = options.fontData ?? (options.embeddedFont ? embeddedFontToArrayBuffer(options.embeddedFont) : undefined)
  if (fontData) {
    const metadata = parseOpenTypeFontMetadata(fontData)
    if (metadata.featureTags.length) {
      return {
        fontAvailable: true,
        supportedTags: new Set(metadata.featureTags),
        browserSupportedTags,
        source: "embedded-font",
      }
    }
  }
  const fontAvailable = browserFontCheck(font)
  const supportedTags = new Set<string>()
  for (const tag of browserSupportedTags) {
    const differs = fontAvailable ? canvasFeatureDiffers(font, tag) : undefined
    if (differs !== false) supportedTags.add(tag)
  }
  return { fontAvailable, supportedTags, browserSupportedTags, source: fontAvailable ? "browser" : "fallback" }
}
