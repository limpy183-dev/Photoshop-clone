/** Global augmentations for internal runtime metadata. */

import type { PathHandleMode, ShapeProps } from "@/editor/types/typography"


/* ---- Global augmentations for internal runtime metadata ---- */

declare global {
  interface HTMLCanvasElement {
    /** Internal: compressed blob store ID (editor-context.tsx) */
    __compressedBlobId?: string
    /** Internal: original width before compression (editor-context.tsx) */
    __origW?: number
    /** Internal: original height before compression (editor-context.tsx) */
    __origH?: number
    /** Internal: move-tool snapshot (canvas-view.tsx) */
    __moveSnapshot?: HTMLCanvasElement
    /**
     * Internal: pixels lifted out of `__moveSnapshot` by an active selection
     * (canvas-view.tsx). When set, the move tool drags this alone and leaves
     * the snapshot in place, matching Photoshop's floating selection.
     */
    __moveFloat?: HTMLCanvasElement
  }
  interface Window {
    /** Internal: current custom shape selection */
    __psCustomShape?: string
    /** Internal: current user-library custom shape preset */
    __psCustomShapePreset?: ShapeProps
    /** Internal: current shape tool options */
    __psShapeOptions?: Partial<{
      strokeWidth: number
      radius: number
      sides: number
      innerRadiusRatio: number
      vertexRoundness: number
      polygonStarMode: boolean
      smoothCorners: boolean
      smoothIndent: boolean
      rotation: number
      cornerRadiusTL: number
      cornerRadiusTR: number
      cornerRadiusBR: number
      cornerRadiusBL: number
    }>
    /** Internal: current direct-selection path editing options */
    __psPathOptions?: Partial<{
      handleMode: PathHandleMode
    }>
  }
  interface CanvasRenderingContext2D {
    /** Non-standard: typographic kerning control (tool-helpers.ts) */
    fontKerning?: string
    /** Non-standard: OpenType feature settings (tool-helpers.ts) */
    fontFeatureSettings?: string
    /** Non-standard: ligature control (tool-helpers.ts) */
    fontVariantLigatures?: string
    /** Non-standard: small-caps control (tool-helpers.ts) */
    fontVariantCaps?: string
    /** Non-standard: variable font axes (tool-helpers.ts) */
    fontVariationSettings?: string
    /** Non-standard: canvas letter spacing control in Chromium (tool-helpers.ts) */
    letterSpacing?: string
    /** Standard: text rendering hint (tool-helpers.ts) */
    textRendering?: string
  }
}

export {}
