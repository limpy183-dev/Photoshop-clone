/** Frame animation and onion skinning. */

import type { BlendMode } from "@/editor/types/core"
import type { LayerStyle } from "@/editor/types/layers"
import type { AudioTrack, VideoKeyframe, VideoTransition } from "@/editor/types/rendering"


export interface FrameLayerTransform {
  /** Translation in document pixels. */
  tx: number
  ty: number
  /** 1.0 = no scale. */
  scaleX: number
  scaleY: number
  /** Rotation in degrees, around the layer center. */
  rotation: number
}

export type FrameEasing = "hold" | "linear" | "ease-in" | "ease-out" | "ease-in-out"

export interface TimelineFrame {
  id: string
  name: string
  durationMs: number
  layerVisibility: Record<string, boolean>
  layerOpacity?: Record<string, number>
  /** Fill opacity overrides keyed by layer id. */
  layerFillOpacity?: Record<string, number>
  /** Layer style overrides keyed by layer id. Use null to clear style. */
  layerStyle?: Record<string, LayerStyle | null>
  /** Blend-mode overrides keyed by layer id. */
  layerBlend?: Record<string, BlendMode>
  /** Per-layer transform keyframes (position, scale, rotation). */
  layerTransform?: Record<string, FrameLayerTransform>
  transition?: "hold" | "dissolve" | VideoTransition["kind"]
  /** Duration of the transition into the next frame. Defaults to the frame duration. */
  transitionDurationMs?: number
  /** Easing applied when interpolating tween properties into the next frame. */
  easing?: FrameEasing
  audioLabel?: string
  compId?: string
  keyframes?: VideoKeyframe[]
  audioTracks?: AudioTrack[]
  /** Optional thumbnail dataURL cached at capture time. */
  thumbnail?: string
}

export interface OnionSkinSettings {
  enabled: boolean
  /** Number of frames before the current frame to ghost. */
  before: number
  /** Number of frames after the current frame to ghost. */
  after: number
  /** Maximum overlay opacity (0..1) for adjacent frames. */
  opacity: number
  /** Tint color applied to before/after ghosts ("none" leaves originals untinted). */
  tint?: "none" | "red-cyan" | "red-blue" | "green-red" | "mono"
}

export interface TimelineSettings {
  /** Frame-rate hint used by exporters and tween density. */
  fps: number
  /** 0 = infinite loop. */
  loopCount: number
  onionSkin?: OnionSkinSettings
}
