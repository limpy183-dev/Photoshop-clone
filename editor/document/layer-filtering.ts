/**
 * Filter vocabulary for the Layers panel's search box and dropdown.
 *
 * Each selectable filter maps to the query token that `layerMatchesQuery`
 * already understands, so the dropdown, the preset buttons and anything typed
 * by hand all run through one matcher. "empty" is the exception — it is
 * resolved against the live emptiness analysis in `layer-health.ts`.
 */

export type FilterKind = "all" | string

export const LAYER_FILTER_TOKENS: Record<string, string> = {
  // Kind
  raster: "kind:pixel",
  text: "kind:text",
  shape: "kind:shape",
  adjustment: "kind:adjustment",
  "smart-object": "attr:smart",
  frame: "kind:frame",
  artboard: "kind:artboard",
  group: "kind:group",
  threeD: "kind:3d",
  video: "kind:video",
  // Attribute
  locked: "attr:locked",
  hidden: "attr:hidden",
  visible: "visible:true",
  linked: "attr:linked",
  masked: "attr:masked",
  styled: "attr:effects",
  smart: "attr:smart",
  clipped: "attr:clipped",
  "attr:smart-filter": "attr:smart-filter",
  "attr:knockout": "attr:knockout",
  "attr:blend-if": "attr:blend-if",
  // Mode
  "mode:normal": "mode:normal",
  "mode:multiply": "mode:multiply",
  "mode:screen": "mode:screen",
  "mode:overlay": "mode:overlay",
  "mode:soft-light": "mode:soft-light",
  "mode:hard-light": "mode:hard-light",
  "mode:darken": "mode:darken",
  "mode:lighten": "mode:lighten",
  // Effect
  "effect:drop-shadow": "effect:drop-shadow",
  "effect:inner-shadow": "effect:inner-shadow",
  "effect:outer-glow": "effect:outer-glow",
  "effect:inner-glow": "effect:inner-glow",
  "effect:bevel": "effect:bevel",
  "effect:satin": "effect:satin",
  "effect:stroke": "effect:stroke",
  "effect:glow": "effect:glow",
  "effect:color-overlay": "effect:color-overlay",
  "effect:gradient-overlay": "effect:gradient-overlay",
  "effect:pattern-overlay": "effect:pattern-overlay",
  // Color label
  "label:red": "color:red",
  "label:orange": "color:orange",
  "label:yellow": "color:yellow",
  "label:green": "color:green",
  "label:blue": "color:blue",
  "label:violet": "color:violet",
  "label:gray": "color:gray",
  "label:none": "color:none",
  // Channels
  "channel:r-off": "channel:r-off",
  "channel:g-off": "channel:g-off",
  "channel:b-off": "channel:b-off",
}

// One-click filter presets surfaced as buttons above the layer list. Each maps
// to the same query tokens the dropdown filter uses, except "empty" which is
// resolved against the live emptiness analysis below.
export const LAYER_FILTER_PRESETS: { label: string; kind: string }[] = [
  { label: "Visible only", kind: "visible" },
  { label: "Has mask", kind: "masked" },
  { label: "Has effects", kind: "styled" },
  { label: "Smart object", kind: "smart-object" },
  { label: "Adjustment", kind: "adjustment" },
  { label: "Locked", kind: "locked" },
  { label: "Empty", kind: "empty" },
]
