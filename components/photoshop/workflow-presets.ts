import type { ExportPresetPayload } from "./export-presets"
import type { LearningIndexItem } from "./learning-types"
import type { ToolId } from "./types"

export const PHASE_TWO_WORKFLOW_PACK_IDS = [
  "background-removal",
  "portrait-retouch",
  "social-export",
  "print-prep",
  "batch-watermark-resize",
] as const

export type WorkflowPackId = (typeof PHASE_TWO_WORKFLOW_PACK_IDS)[number]

export type WorkflowPackAction =
  | { kind: "tool"; tool: ToolId }
  | { kind: "event"; event: string; detail?: unknown }
  | { kind: "panel"; panel: string }
  | { kind: "apply-selection-mask" }
  | { kind: "duplicate-active-layer" }

export interface WorkflowPackStep {
  id: string
  title: string
  detail: string
  action: WorkflowPackAction
  requiresDocument?: boolean
  requiresLayer?: boolean
  requiresSelection?: boolean
}

export interface WorkflowPack {
  id: WorkflowPackId
  title: string
  shortTitle: string
  category: "Cutout" | "Retouching" | "Social" | "Print" | "Batch"
  summary: string
  keywords: string[]
  expectedOutput: string
  steps: WorkflowPackStep[]
  exportPreset?: ExportPresetPayload
  imageProcessorPreset?: ImageProcessorWorkflowPreset
}

export type ImageProcessorWorkflowPreset = Partial<{
  format: "jpeg" | "png" | "webp" | "gif" | "avif"
  quality: number
  resize: boolean
  maxWidth: number
  maxHeight: number
  transparent: boolean
  matte: string
  openFirst: boolean
  watermark: Partial<{
    enabled: boolean
    text: string
    position:
      | "top-left"
      | "top-center"
      | "top-right"
      | "middle-left"
      | "center"
      | "middle-right"
      | "bottom-left"
      | "bottom-center"
      | "bottom-right"
    opacity: number
    fontSize: number
    color: string
    shadow: boolean
  }>
  metadata: Partial<{
    copyright: string
    author: string
    title: string
  }>
}>

const transparentPngPreset: ExportPresetPayload = {
  dialog: "export-as",
  format: "png",
  scale: 100,
  quality: 100,
  transparent: true,
  includeMetadata: true,
}

const socialWebpPreset: ExportPresetPayload = {
  dialog: "export-as",
  format: "webp",
  scale: 100,
  quality: 86,
  transparent: false,
  matte: "#ffffff",
  includeMetadata: true,
  metadataDescription: "Social image export from Photoshop Web workflow pack",
}

const printPreviewPreset: ExportPresetPayload = {
  dialog: "export-as",
  format: "tiff",
  scale: 100,
  quality: 100,
  transparent: false,
  matte: "#ffffff",
  includeMetadata: true,
  tiffCompression: "lzw",
  metadataDescription: "Print prep preview from Photoshop Web workflow pack",
}

export const WORKFLOW_PACKS: WorkflowPack[] = [
  {
    id: "background-removal",
    title: "Background Removal Workflow",
    shortTitle: "Remove Background",
    category: "Cutout",
    summary: "Select the subject, refine the edge, turn the selection into a mask, and export a transparent PNG with metadata preserved.",
    keywords: ["remove background", "transparent png", "select subject", "mask", "cutout", "edge cleanup"],
    expectedOutput: "Transparent PNG cutout with a non-destructive layer mask.",
    exportPreset: transparentPngPreset,
    steps: [
      {
        id: "select-subject",
        title: "Select the subject",
        detail: "Switches to Select Subject so the next canvas click builds the initial subject selection.",
        action: { kind: "tool", tool: "select-subject" },
        requiresDocument: true,
      },
      {
        id: "refine-edge",
        title: "Refine edge",
        detail: "Opens Select and Mask for edge smoothing, feathering, and view-mode checks before masking.",
        action: { kind: "event", event: "ps-open-select-and-mask" },
        requiresDocument: true,
        requiresSelection: true,
      },
      {
        id: "add-layer-mask",
        title: "Add mask from selection",
        detail: "Converts the current selection to a layer mask on the active layer.",
        action: { kind: "apply-selection-mask" },
        requiresDocument: true,
        requiresLayer: true,
        requiresSelection: true,
      },
      {
        id: "export-transparent",
        title: "Export transparent PNG",
        detail: "Opens Export As with PNG, transparency, and metadata enabled.",
        action: { kind: "event", event: "ps-open-export-as", detail: transparentPngPreset },
        requiresDocument: true,
      },
    ],
  },
  {
    id: "portrait-retouch",
    title: "Portrait Retouch Workflow",
    shortTitle: "Retouch Portrait",
    category: "Retouching",
    summary: "Duplicate the working layer, clean blemishes, soften texture, dodge and burn locally, sharpen detail, then export a delivery JPEG.",
    keywords: ["portrait", "retouch", "spot healing", "skin smoothing", "dodge", "burn", "sharpen"],
    expectedOutput: "Retouched portrait with the original layer preserved underneath.",
    exportPreset: {
      dialog: "export-as",
      format: "jpeg",
      scale: 100,
      quality: 92,
      transparent: false,
      matte: "#ffffff",
      includeMetadata: true,
      metadataDescription: "Portrait retouch export from Photoshop Web workflow pack",
    },
    steps: [
      {
        id: "duplicate-layer",
        title: "Duplicate the source layer",
        detail: "Keeps the original pixels available before spot healing and local tone work.",
        action: { kind: "duplicate-active-layer" },
        requiresDocument: true,
        requiresLayer: true,
      },
      {
        id: "spot-heal",
        title: "Spot healing pass",
        detail: "Switches to Spot Healing for small blemishes and dust.",
        action: { kind: "tool", tool: "spot-healing" },
        requiresDocument: true,
        requiresLayer: true,
      },
      {
        id: "skin-softening",
        title: "Skin smoothing approximation",
        detail: "Opens Surface Blur as the browser-local softening pass.",
        action: { kind: "event", event: "ps-open-filter", detail: "surface-blur" },
        requiresDocument: true,
        requiresLayer: true,
      },
      {
        id: "dodge",
        title: "Dodge highlights",
        detail: "Switches to Dodge for controlled local brightening.",
        action: { kind: "tool", tool: "dodge" },
        requiresDocument: true,
        requiresLayer: true,
      },
      {
        id: "burn",
        title: "Burn shadows",
        detail: "Switches to Burn for controlled local darkening.",
        action: { kind: "tool", tool: "burn" },
        requiresDocument: true,
        requiresLayer: true,
      },
      {
        id: "sharpen",
        title: "Sharpen output detail",
        detail: "Opens Smart Sharpen for final detail control.",
        action: { kind: "event", event: "ps-open-filter", detail: "smart-sharpen" },
        requiresDocument: true,
        requiresLayer: true,
      },
      {
        id: "export-jpeg",
        title: "Export delivery JPEG",
        detail: "Opens Export As with a high-quality JPEG preset and metadata enabled.",
        action: {
          kind: "event",
          event: "ps-open-export-as",
          detail: {
            dialog: "export-as",
            format: "jpeg",
            scale: 100,
            quality: 92,
            transparent: false,
            matte: "#ffffff",
            includeMetadata: true,
            metadataDescription: "Portrait retouch export from Photoshop Web workflow pack",
          } satisfies ExportPresetPayload,
        },
        requiresDocument: true,
      },
    ],
  },
  {
    id: "social-export",
    title: "Social Export Workflow",
    shortTitle: "Social Export",
    category: "Social",
    summary: "Crop to a social-safe composition, add text, inspect safe dimensions, and export a compressed WebP or PNG.",
    keywords: ["social", "instagram", "webp", "png", "crop", "text", "safe dimensions"],
    expectedOutput: "Social-ready raster export with a compact WebP preset.",
    exportPreset: socialWebpPreset,
    steps: [
      {
        id: "crop",
        title: "Crop to preset",
        detail: "Switches to Crop so you can frame the image for square, story, or feed output.",
        action: { kind: "tool", tool: "crop" },
        requiresDocument: true,
      },
      {
        id: "add-text",
        title: "Add or edit text",
        detail: "Switches to the Type tool for captions, labels, or safe-area text.",
        action: { kind: "tool", tool: "type" },
        requiresDocument: true,
      },
      {
        id: "fit-image",
        title: "Check output dimensions",
        detail: "Opens Image Size so you can fit to platform dimensions before export.",
        action: { kind: "event", event: "ps-open-image-size" },
        requiresDocument: true,
      },
      {
        id: "export-webp",
        title: "Export social WebP",
        detail: "Opens Export As with WebP, matte, metadata, and an 86 quality target.",
        action: { kind: "event", event: "ps-open-export-as", detail: socialWebpPreset },
        requiresDocument: true,
      },
    ],
  },
  {
    id: "print-prep",
    title: "Print Prep Workflow",
    shortTitle: "Prepare Print",
    category: "Print",
    summary: "Resize, proof color, add metadata, preview print marks, run preflight, and export a print-preview TIFF.",
    keywords: ["print", "preflight", "proof", "metadata", "print marks", "tiff"],
    expectedOutput: "Preflighted print preview with metadata and print-readiness checks.",
    exportPreset: printPreviewPreset,
    steps: [
      {
        id: "image-size",
        title: "Confirm image size",
        detail: "Opens Image Size for print dimensions, resampling, and resolution checks.",
        action: { kind: "event", event: "ps-open-image-size" },
        requiresDocument: true,
      },
      {
        id: "proof-setup",
        title: "Set proof intent",
        detail: "Opens color management directly in proof mode.",
        action: { kind: "event", event: "ps-open-color-management-workflow", detail: { mode: "proof" } },
        requiresDocument: true,
      },
      {
        id: "metadata",
        title: "Add file metadata",
        detail: "Opens File Info for title, author, copyright, and project metadata.",
        action: { kind: "event", event: "ps-open-file-info" },
        requiresDocument: true,
      },
      {
        id: "print-preview",
        title: "Preview print marks",
        detail: "Opens the print workspace for marks, bleed, proof, and page preview.",
        action: { kind: "event", event: "ps-open-print-workflow" },
        requiresDocument: true,
      },
      {
        id: "preflight",
        title: "Run preflight",
        detail: "Opens Preflight Check for export, print, and compatibility warnings.",
        action: { kind: "event", event: "ps-open-preflight" },
        requiresDocument: true,
      },
      {
        id: "export-tiff",
        title: "Export print preview TIFF",
        detail: "Opens Export As with TIFF, LZW compression, matte, and metadata enabled.",
        action: { kind: "event", event: "ps-open-export-as", detail: printPreviewPreset },
        requiresDocument: true,
      },
    ],
  },
  {
    id: "batch-watermark-resize",
    title: "Batch Watermark And Resize Workflow",
    shortTitle: "Batch Resize",
    category: "Batch",
    summary: "Choose a folder of images, resize to safe web dimensions, apply a watermark, embed basic metadata, and export a batch.",
    keywords: ["batch", "resize", "watermark", "metadata", "folder", "image processor", "webp"],
    expectedOutput: "Batch of resized watermarked WebP images with metadata.",
    imageProcessorPreset: {
      resize: true,
      maxWidth: 1920,
      maxHeight: 1080,
      format: "webp",
      quality: 0.86,
      transparent: false,
      matte: "#ffffff",
      watermark: {
        enabled: true,
        text: "(c) Copyright",
        position: "bottom-right",
        opacity: 0.62,
        fontSize: 28,
        color: "#ffffff",
        shadow: true,
      },
      metadata: {
        copyright: "(c) Copyright",
        title: "Batch watermark export",
      },
    },
    steps: [
      {
        id: "open-processor",
        title: "Open Image Processor preset",
        detail: "Opens Image Processor with resize, WebP, watermark, and metadata defaults already filled.",
        action: {
          kind: "event",
          event: "ps-open-image-processor",
          detail: {
            resize: true,
            maxWidth: 1920,
            maxHeight: 1080,
            format: "webp",
            quality: 0.86,
            transparent: false,
            matte: "#ffffff",
            watermark: {
              enabled: true,
              text: "(c) Copyright",
              position: "bottom-right",
              opacity: 0.62,
              fontSize: 28,
              color: "#ffffff",
              shadow: true,
            },
            metadata: {
              copyright: "(c) Copyright",
              title: "Batch watermark export",
            },
          } satisfies ImageProcessorWorkflowPreset,
        },
      },
      {
        id: "choose-files",
        title: "Choose source images",
        detail: "Use the file picker in Image Processor to pick the images for the batch.",
        action: {
          kind: "event",
          event: "ps-open-image-processor",
          detail: {
            resize: true,
            maxWidth: 1920,
            maxHeight: 1080,
            format: "webp",
            watermark: { enabled: true, text: "(c) Copyright", position: "bottom-right", shadow: true },
            metadata: { copyright: "(c) Copyright" },
          } satisfies ImageProcessorWorkflowPreset,
        },
      },
      {
        id: "review-watermark",
        title: "Review watermark and metadata",
        detail: "Adjust text, opacity, placement, title, author, and copyright before running the batch.",
        action: {
          kind: "event",
          event: "ps-open-image-processor",
          detail: {
            resize: true,
            maxWidth: 1920,
            maxHeight: 1080,
            format: "webp",
            watermark: { enabled: true, text: "(c) Copyright", position: "bottom-right", shadow: true },
            metadata: { copyright: "(c) Copyright" },
          } satisfies ImageProcessorWorkflowPreset,
        },
      },
      {
        id: "run-batch",
        title: "Run batch export",
        detail: "Process the selected files after confirming format, resize, watermark, and metadata settings.",
        action: {
          kind: "event",
          event: "ps-open-image-processor",
          detail: {
            resize: true,
            maxWidth: 1920,
            maxHeight: 1080,
            format: "webp",
            watermark: { enabled: true, text: "(c) Copyright", position: "bottom-right", shadow: true },
            metadata: { copyright: "(c) Copyright" },
          } satisfies ImageProcessorWorkflowPreset,
        },
      },
    ],
  },
]

export function findWorkflowPack(id: string | null | undefined) {
  return WORKFLOW_PACKS.find((pack) => pack.id === id) ?? null
}

export function exportPresetForWorkflowPack(id: WorkflowPackId) {
  return findWorkflowPack(id)?.exportPreset
}

export function imageProcessorPresetForWorkflowPack(id: WorkflowPackId) {
  return findWorkflowPack(id)?.imageProcessorPreset
}

export function workflowPackLearningItems(): LearningIndexItem[] {
  return WORKFLOW_PACKS.map((pack) => ({
    id: `workflow-pack-${pack.id}`,
    type: "workflow",
    title: pack.title,
    category: pack.category,
    description: pack.summary,
    keywords: [pack.shortTitle, pack.expectedOutput, ...pack.keywords],
    action: { kind: "event", target: "ps-open-workflow-pack", detail: { id: pack.id } },
  }))
}
