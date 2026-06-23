export interface PhotoshopCommandEnvelope {
  commandId?: string
  docId?: string
  correlationId?: string
  createdAt?: number
}

export type PhotoshopEventMap = {
  "ps-open-command-palette": undefined
  "ps-open-export-as": unknown | undefined
  "ps-open-preferences": undefined
  "ps-open-shortcuts": undefined
  "ps-preferences-changed": unknown
  "ps-preferences-history-log-changed": unknown
  "ps-shortcuts-changed": Record<string, string>
  "ps-recent-colors-updated": string[]
  "ps-tech-preview-flags-changed": Record<string, boolean>
  "ps-recents-changed": undefined
  "ps-workspaces-changed": unknown[]
  "ps-menu-customization-changed": undefined
  "ps-timeline-split-at-playhead": undefined
  "ps-open-filter-gallery": undefined
  "ps-open-camera-raw": undefined
  "ps-open-batch-export": unknown | undefined
  "ps-open-batch-processing": undefined
  "ps-open-image-processor": unknown | undefined
  "ps-open-photomerge": undefined
  "ps-open-document-report": undefined
  "ps-open-preflight": undefined
  "ps-open-recent-documents": undefined
  "ps-open-file-info": undefined
  "ps-reveal-source": { docId?: string } | undefined
  "ps-open-3d-workspace": undefined
  "ps-open-video-render": undefined
  "ps-open-print-workflow": undefined
  "ps-open-device-preview": undefined
  "ps-open-automation-workflow": undefined
  "ps-open-provenance": undefined
  "ps-open-algorithmic-operations": undefined
  "ps-open-workflow-pack": { id: string }
  "ps-workspace-preset-changed": { preset: string }
  "ps-open-gap-workflow": string | { id?: string; mode?: string } | undefined
  "ps-open-color-mode": string | undefined
  "ps-open-plugin-manager": undefined
  "ps-image-assets-generator-run": { docId: string }
  "ps-image-assets-generator-directory": { docId: string; directoryHandle: unknown }
  "ps-open-cloud-libraries": undefined
  "ps-open-color-management-workflow": unknown | undefined
  "ps-open-format-metadata": undefined
  "ps-open-variables": unknown | undefined
  "ps-open-layer-comps": undefined
  "ps-open-workspace-manager": undefined
  "ps-focus-layer-search": undefined
  "ps-run-plugin-command": { pluginId: string; commandId: string }
  "ps-open-select-and-mask": undefined
  "ps-active-export-format": { format: string | null; source: "batch-export" | "export-as" | string }
  "ps-open-selection-operation": string
  "ps-open-filter": string
  "ps-open-image-size": undefined
  "ps-open-canvas-size": undefined
  "ps-open-warp-text": undefined
  "ps-open-color-picker": {
    target?: "foreground" | "background"
    surface?: "dialog" | "hud"
    x?: number
    y?: number
  } | undefined
  "ps-open-panel": string
  "ps-switch-panel": string
  "ps-set-learning-query": string
  "ps-request-zoom": { zoom?: number; factor?: number }
  "ps-request-print-size-view": undefined
  "ps-set-dock-width": number
  "ps-purge-request": { target: import("./purge-commands").PurgeTarget }
  "ps-open-learn": { topic: string }
  "ps-show-home": { open?: boolean } | undefined
  "ps-open-file": undefined
  "ps-save-document": PhotoshopCommandEnvelope & {
    mode: "save" | "save-as"
    reason?: "close" | "shortcut" | "menu"
  }
  "ps-document-saved": PhotoshopCommandEnvelope & { success: boolean }
  "ps-apply-workspace": { name: string }
  "ps-apply-workspace-preset": { preset: string }
  "ps-save-workspace": { name: string }
  "ps-delete-workspace": { name: string }
  "ps-clear-slices": undefined
  "ps-clear-ruler": undefined
  "ps-free-transform": undefined
  "ps-transform-selection-begin": undefined
  "ps-transform-selection-cancel": undefined
  "ps-transform-flip": "horizontal" | "vertical"
  "ps-transform-rotate": 90 | -90 | 180
  "ps-transform-set": unknown
  "ps-transform-commit": undefined
  "ps-transform-cancel": undefined
  "ps-edit-text": { layerId: string }
  "ps-move-options-changed": undefined
  "ps-open-color-picker-hud": { screenX?: number; screenY?: number } | undefined
  "ps-mousemove": { x: number; y: number; inside: boolean }
  "ps-blur-gallery-overlay-change": { filterId: string; params: unknown }
  "ps-blur-gallery-overlay-state": { filterId: string; params: unknown; docId?: string } | null
  "ps-lighting-effects-overlay-change": { params: unknown }
  "ps-lighting-effects-overlay-state": { params: unknown; docId?: string } | null
  "ps-timeline-transition-overlay": { canvas: HTMLCanvasElement | null; docId?: string }
  "ps-navigator-pan": { x: number; y: number }
  "ps-swatches-changed": { docId?: string; swatches: unknown[] }
  "ps-swatches-updated": { docId?: string; swatches: unknown[] }
  "ps-gradients-changed": { gradients: unknown[] }
  "ps-patterns-changed": { docId?: string; patterns: unknown[] }
  "ps-shape-presets-changed": unknown[]
  "ps-plugin-panel-command": { pluginId: string; commandId?: string; message?: unknown }
  "ps-plugin-host-ui-event": { pluginId: string; event: unknown }
  "ps-plugin-cep-event": { pluginId: string; event: unknown }
  "ps-plugin-host-undo": { pluginId: string }
  "ps-plugin-host-redo": { pluginId: string }
  "ps-plugin-lifecycle": {
    pluginId: string
    phase: "loading" | "ready" | "running" | "unloading" | "unloaded" | "error" | string
    at: number
    detail?: unknown
  }
  "ps-command-macros-changed": undefined
  "ps-droplets-changed": undefined
  "ps-droplet-bundle-dropped": { bundle: unknown; fileName: string }
  "ps-libraries-changed": undefined
  "ps-reselect": undefined
  "ps-set-screen-mode": { mode: import("./screen-modes").ScreenMode }
  "ps-cycle-screen-mode": undefined
  "ps-tool-info":
    | {
        kind: "marquee"
        width: number
        height: number
        x: number
        y: number
      }
    | {
        kind: "line"
        length: number
        angle: number
        dx: number
        dy: number
      }
    | {
        kind: "transform"
        scaleX: number
        scaleY: number
        rotation: number
        translateX: number
        translateY: number
      }
    | { kind: "clear" }
}

type PhotoshopEventName = keyof PhotoshopEventMap
type DetailOptionalEventName = {
  [K in PhotoshopEventName]: undefined extends PhotoshopEventMap[K] ? K : never
}[PhotoshopEventName]

const fallbackEventTarget = new EventTarget()

function photoshopEventTarget(): EventTarget {
  return typeof window !== "undefined" ? window : fallbackEventTarget
}

export function dispatchPhotoshopEvent<K extends DetailOptionalEventName>(type: K): boolean
export function dispatchPhotoshopEvent<K extends PhotoshopEventName>(type: K, detail: PhotoshopEventMap[K]): boolean
export function dispatchPhotoshopEvent<K extends PhotoshopEventName>(type: K, detail?: PhotoshopEventMap[K]) {
  return photoshopEventTarget().dispatchEvent(new CustomEvent(type, { detail }))
}

export function dispatchPhotoshopCustomEvent(type: string): boolean
export function dispatchPhotoshopCustomEvent(type: string, detail: unknown): boolean
export function dispatchPhotoshopCustomEvent(type: string, detail?: unknown) {
  return photoshopEventTarget().dispatchEvent(new CustomEvent(type, { detail }))
}

export function addPhotoshopEventListener<K extends PhotoshopEventName>(
  type: K,
  handler: (detail: PhotoshopEventMap[K], event: CustomEvent<PhotoshopEventMap[K]>) => void,
) {
  const target = photoshopEventTarget()
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<PhotoshopEventMap[K]>
    handler(customEvent.detail, customEvent)
  }
  target.addEventListener(type, listener)
  return () => target.removeEventListener(type, listener)
}
