/**
 * Photoshop-compatible modifier key mapping for path / vector editing tools.
 *
 * This module is the single discoverable source of truth for how Pen, Curvature
 * Pen, Direct Selection, and Path Selection interpret Alt/Option, Ctrl/Cmd, and
 * Shift. The keyboard runtime (canvas-view) and the UI (options bar, contextual
 * help, tooltips) both consume the same descriptors so a change here propagates
 * everywhere.
 *
 * Naming follows Photoshop's documentation: `alt` covers both macOS Option and
 * Windows Alt; `meta` covers macOS Cmd; `ctrl` is the Windows control key. The
 * runtime should accept either `ctrl` or `meta` for the "temp Direct Selection"
 * switch so the cross-platform shortcut works.
 */

export type PathModifierKey = "alt" | "ctrl" | "meta" | "shift"
export type PathModifierTool = "pen" | "curvature-pen" | "freeform-pen" | "direct-select" | "path-select"
export type PathModifierInteraction =
  | "click-anchor"
  | "drag-handle"
  | "place-anchor"
  | "click-segment"
  | "drag-anchor"
  | "drag-subpath"
  | "marquee"
export type PathModifierIntent =
  | "toggle-smooth-corner"
  | "break-handle-symmetry"
  | "temp-direct-select"
  | "constrain-45"
  | "toggle-anchor-selection"
  | "select-subpath"
  | "duplicate-subpath"
  | "marquee-select"
  | "none"

export interface PathModifierBinding {
  /** Stable id used by tests / contextual help / command registry. */
  id: string
  /** Tool the modifier applies to. */
  tool: "pen" | "curvature-pen" | "freeform-pen" | "direct-select" | "path-select"
  /** Modifier keys, ANDed together. Empty array means "no modifier". */
  keys: PathModifierKey[]
  /** Plain-English description ("Alt-click anchor: toggle smooth/corner"). */
  description: string
  /** Short label suitable for tooltips. */
  label: string
}

/**
 * Pen tool modifier bindings.
 *
 * Photoshop standard:
 *   - Alt-click on an existing anchor: converts smooth -> corner (or back).
 *   - Alt-drag on a handle: breaks tangent symmetry (handles move independently).
 *   - Ctrl (Windows) / Cmd (macOS) held: temporarily switch to Direct Selection.
 *   - Shift: constrain new anchors to 45 degree increments from previous anchor.
 */
export const PEN_TOOL_MODIFIERS: readonly PathModifierBinding[] = [
  {
    id: "pen.alt-click-anchor.toggle-smooth-corner",
    tool: "pen",
    keys: ["alt"],
    description: "Alt-click an anchor: toggle between smooth and corner.",
    label: "Toggle anchor type",
  },
  {
    id: "pen.alt-drag-handle.break-symmetry",
    tool: "pen",
    keys: ["alt"],
    description: "Alt-drag a handle: break tangent symmetry (broken handles).",
    label: "Break handle symmetry",
  },
  {
    id: "pen.ctrl.temp-direct-select",
    tool: "pen",
    keys: ["ctrl"],
    description: "Hold Ctrl (Cmd on macOS) to temporarily activate Direct Selection.",
    label: "Direct Selection (hold)",
  },
  {
    id: "pen.meta.temp-direct-select",
    tool: "pen",
    keys: ["meta"],
    description: "Hold Cmd (macOS) to temporarily activate Direct Selection.",
    label: "Direct Selection (hold)",
  },
  {
    id: "pen.shift.constrain-45",
    tool: "pen",
    keys: ["shift"],
    description: "Shift while placing a new anchor: constrain to 45 degree angles from the previous anchor.",
    label: "Constrain to 45",
  },
]

/**
 * Direct Selection tool modifier bindings.
 *
 * Photoshop standard:
 *   - Shift-click anchor: add/remove from current anchor selection.
 *   - Marquee drag from empty area: rubber-band select anchors.
 *   - Alt-click on a path edge: select every anchor in that subpath.
 *   - Shift while dragging anchors: constrain motion to 45 degree axes.
 */
export const DIRECT_SELECT_MODIFIERS: readonly PathModifierBinding[] = [
  {
    id: "direct-select.shift-click.toggle-anchor",
    tool: "direct-select",
    keys: ["shift"],
    description: "Shift-click an anchor: add or remove it from the active selection.",
    label: "Toggle anchor selection",
  },
  {
    id: "direct-select.marquee.rubber-band",
    tool: "direct-select",
    keys: [],
    description: "Drag in empty space: rubber-band select all anchors inside the marquee.",
    label: "Marquee select anchors",
  },
  {
    id: "direct-select.alt-click-edge.select-subpath",
    tool: "direct-select",
    keys: ["alt"],
    description: "Alt-click a path edge: select every anchor in that subpath.",
    label: "Select subpath",
  },
  {
    id: "direct-select.shift-drag.constrain-45",
    tool: "direct-select",
    keys: ["shift"],
    description: "Shift-drag selected anchors: constrain motion to 45 degree axes.",
    label: "Constrain motion",
  },
]

/**
 * Path Selection tool modifier bindings.
 *
 * Photoshop standard:
 *   - Alt-drag: duplicate the subpath being dragged.
 *   - Ctrl/Cmd: temporarily activate Direct Selection.
 */
export const PATH_SELECT_MODIFIERS: readonly PathModifierBinding[] = [
  {
    id: "path-select.alt-drag.duplicate",
    tool: "path-select",
    keys: ["alt"],
    description: "Alt-drag the active subpath: duplicate it.",
    label: "Duplicate subpath",
  },
  {
    id: "path-select.ctrl.temp-direct-select",
    tool: "path-select",
    keys: ["ctrl"],
    description: "Hold Ctrl (Cmd on macOS) to temporarily activate Direct Selection.",
    label: "Direct Selection (hold)",
  },
]

export const ALL_PATH_MODIFIERS: readonly PathModifierBinding[] = [
  ...PEN_TOOL_MODIFIERS,
  ...DIRECT_SELECT_MODIFIERS,
  ...PATH_SELECT_MODIFIERS,
]

export interface ModifierEventLike {
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/** Returns true when `event` matches the binding's keys exactly (no extra modifier set). */
export function matchesModifier(event: ModifierEventLike, keys: readonly PathModifierKey[]): boolean {
  const wantsAlt = keys.includes("alt")
  const wantsCtrl = keys.includes("ctrl")
  const wantsMeta = keys.includes("meta")
  const wantsShift = keys.includes("shift")
  return (
    !!event.altKey === wantsAlt &&
    !!event.ctrlKey === wantsCtrl &&
    !!event.metaKey === wantsMeta &&
    !!event.shiftKey === wantsShift
  )
}

/**
 * Photoshop treats Ctrl (Windows) and Cmd (macOS) as the same "command"
 * modifier when temporarily switching to Direct Selection from the Pen tool.
 * This helper bypasses the exact-match check above for that one case.
 */
export function isTempDirectSelectModifier(event: ModifierEventLike): boolean {
  return !!(event.ctrlKey || event.metaKey)
}

export function activePathToolForModifiers(tool: PathModifierTool, event: ModifierEventLike): PathModifierTool {
  if (
    (tool === "pen" || tool === "curvature-pen" || tool === "freeform-pen" || tool === "path-select") &&
    isTempDirectSelectModifier(event)
  ) {
    return "direct-select"
  }
  return tool
}

export function pathModifierIntent(
  tool: PathModifierTool,
  interaction: PathModifierInteraction,
  event: ModifierEventLike,
): PathModifierIntent {
  if (
    (tool === "pen" || tool === "curvature-pen" || tool === "freeform-pen" || tool === "path-select") &&
    isTempDirectSelectModifier(event)
  ) {
    return "temp-direct-select"
  }
  if ((tool === "pen" || tool === "curvature-pen") && interaction === "click-anchor" && event.altKey) {
    return "toggle-smooth-corner"
  }
  if ((tool === "pen" || tool === "curvature-pen") && interaction === "place-anchor" && event.shiftKey) {
    return "constrain-45"
  }
  if (tool === "direct-select" && interaction === "drag-handle" && event.altKey) {
    return "break-handle-symmetry"
  }
  if (tool === "direct-select" && interaction === "click-anchor" && event.shiftKey) {
    return "toggle-anchor-selection"
  }
  if (tool === "direct-select" && interaction === "drag-anchor" && event.shiftKey) {
    return "constrain-45"
  }
  if (tool === "direct-select" && interaction === "click-segment" && event.altKey) {
    return "select-subpath"
  }
  if (tool === "direct-select" && interaction === "marquee") {
    return "marquee-select"
  }
  if (tool === "path-select" && interaction === "drag-subpath" && event.altKey) {
    return "duplicate-subpath"
  }
  return "none"
}

/**
 * Snap a (dx, dy) delta to the nearest 45-degree axis. Used while Shift is held
 * during anchor drag to constrain motion. Mirrors Photoshop's behavior of
 * locking the dominant axis once it exceeds the other.
 */
export function constrainTo45Degrees(dx: number, dy: number): { dx: number; dy: number } {
  if (dx === 0 && dy === 0) return { dx, dy }
  const angle = Math.atan2(dy, dx)
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
  const magnitude = Math.hypot(dx, dy)
  return { dx: Math.cos(snapped) * magnitude, dy: Math.sin(snapped) * magnitude }
}

/**
 * Snap an absolute pen-tool placement so the new anchor lies on a 45-degree
 * line through `origin`. Used while Shift is held during new-anchor placement.
 */
export function constrainPointTo45(origin: { x: number; y: number }, point: { x: number; y: number }): { x: number; y: number } {
  const delta = constrainTo45Degrees(point.x - origin.x, point.y - origin.y)
  return { x: origin.x + delta.dx, y: origin.y + delta.dy }
}
