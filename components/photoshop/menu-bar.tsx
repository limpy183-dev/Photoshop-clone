"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Menubar,
  MenubarContent as DropdownMenuContent,
  MenubarItem as DropdownMenuItem,
  MenubarLabel as DropdownMenuLabel,
  MenubarMenu as DropdownMenu,
  MenubarSeparator as DropdownMenuSeparator,
  MenubarShortcut as DropdownMenuShortcut,
  MenubarSub as DropdownMenuSub,
  MenubarSubContent as DropdownMenuSubContent,
  MenubarSubTrigger as DropdownMenuSubTrigger,
  MenubarTrigger as DropdownMenuTrigger,
} from "@/components/ui/menubar"
import { useEditor, makeDocument, makeCanvas, type DocumentLifecycleState, type FileSystemFileHandleLike } from "./editor-context"
import { compositeLayer } from "./blend-modes"
import { FilterDialog } from "./filter-dialog"
import { FILTERS } from "./filters"
import { ImageSizeDialog } from "./image-size-dialog"
import { CanvasSizeDialog } from "./canvas-size-dialog"
import { StrokeDialog } from "./stroke-dialog"
import { ColorRangeDialog } from "./color-range-dialog"
import { RefineEdgeDialog } from "./refine-edge-dialog"
import { LiquifyDialog } from "./liquify-dialog"
import { PuppetWarpDialog } from "./puppet-warp-dialog"
import { LayerStyleDialog } from "./layer-style-dialog"
import { WarpTextDialog } from "./warp-text-dialog"
import { LayerCompsDialog } from "./layer-comps-dialog"
import { ColorLabelsDialog } from "./color-labels-dialog"
import { ExportAsDialog } from "./export-as-dialog"
import { BatchExportDialog } from "./batch-export-dialog"
import { BatchProcessingDialog, ImageProcessorDialog } from "./processing-dialogs"
import { DocumentReportDialog } from "./document-report-dialog"
import { PreflightDialog } from "./preflight-dialog"
import { FilterGalleryDialog } from "./filter-gallery"
import { CameraRawDialog } from "./camera-raw-dialog"
import { SelectAndMaskDialog } from "./select-and-mask"
import { FileInfoDialog } from "./file-info-dialog"
import { AdvancedSubsystemsDialog, type AdvancedSubsystemTab } from "./advanced-subsystems-dialog"
import { renderThreeDScene } from "./advanced-subsystems"
import { AlgorithmicOperationsDialog } from "./algorithmic-operations-dialog"
import { GapWorkflowDialog, type GapWorkflowKind } from "./gap-workflow-dialog"
import { PreferencesDialog } from "./preferences-dialog"
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog"
import { AboutDialog } from "./about-dialog"
import {
  RecentDocumentsDialog,
  SelectionOperationDialog,
  WorkspaceManagerDialog,
  type SelectionOperation,
} from "./management-dialogs"
import {
  ContactSheetDialog,
  GridSettingsDialog,
  GuideLayoutDialog,
  NewGuideDialog,
} from "./workspace-dialogs"
import {
  PANEL_CATEGORIES,
  PANEL_DEFINITIONS,
  WORKSPACE_PRESET_OPTIONS,
  type WorkspacePresetId,
} from "./panel-registry"
import {
  createDocumentReport,
  deserializePsdFile,
  deserializeProject,
  downloadBlob,
  downloadText,
  generateDocumentThumbnail,
  loadImageFromFile,
  serializePsd,
  serializeProject,
} from "./document-io"
import {
  readRecentDocuments,
  rememberRecentDocument,
  removeRecentDocument,
  type RecentDocument,
} from "./recent-documents"
import {
  contentAwareFill,
  focusAreaMask,
  rasterizeText,
  selectSkyMask,
  selectSubjectMask,
  selectionFromMask,
  selectionToMaskCanvas,
} from "./tool-helpers"
import { MAX_PROJECT_FILE_BYTES, assertFileSize } from "./canvas-limits"
import type { AdjustmentType, DocumentModeSettings, Layer, LayerStyle, TextAntiAliasMode } from "./types"
import {
  applyTextInsideShape,
  convertTextToEditablePath,
  createTextExtrusionScene,
  diagnoseDocumentFonts,
  matchFontForLayer,
} from "./typography-engine"
import { requestCanvasZoom } from "./zoom-events"
import { createAdjustmentLayer as createAdjustmentLayerModel, isAdjustmentNoop } from "./adjustment-layers"

const menuClass =
  "h-7 px-2 inline-flex items-center text-[12px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)] data-[state=open]:bg-[var(--ps-tool-active)] rounded-none outline-none cursor-default"

function cloneLayerStyle(style: LayerStyle): LayerStyle {
  if (typeof structuredClone === "function") return structuredClone(style)
  return JSON.parse(JSON.stringify(style))
}

type SaveMode = "save" | "save-as"

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileSystemFileHandleLike>
}

interface MenuBarProps {
  onOpenNew: () => void
  statusBarVisible?: boolean
  onToggleStatusBar?: () => void
}

export function MenuBar({
  onOpenNew,
  statusBarVisible = true,
  onToggleStatusBar,
}: MenuBarProps) {
  const {
    documents,
    dispatch,
    activeDoc,
    activeLayer,
    commit,
    newLayer,
    newGroup,
    addLayerMask,
    editSmartObject,
    updateSmartObjectParent,
    toggleQuickMask,
    history,
    historyIndex,
    requestRender,
    foreground,
    background,
    selectedLayers,
    jumpHistory,
    createDocument,
    copySelection,
    pasteAsLayer,
    clipboard,
    styleClipboard,
    closedDocuments,
    documentStatuses,
    duplicateDocument,
    requestCloseDocument,
    closeOtherDocuments,
    reopenClosedDocument,
    markDocumentSaved,
    setDocumentLifecycle,
  } = useEditor()
  const [openFilter, setOpenFilter] = React.useState<string | null>(null)
  const [lastFilter, setLastFilter] = React.useState<string | null>(null)
  const [imageSizeOpen, setImageSizeOpen] = React.useState(false)
  const [canvasSizeOpen, setCanvasSizeOpen] = React.useState(false)
  const [strokeOpen, setStrokeOpen] = React.useState(false)
  const [colorRangeOpen, setColorRangeOpen] = React.useState(false)
  const [refineEdgeOpen, setRefineEdgeOpen] = React.useState(false)
  const [liquifyOpen, setLiquifyOpen] = React.useState(false)
  const [puppetWarpOpen, setPuppetWarpOpen] = React.useState(false)
  const [layerStyleOpen, setLayerStyleOpen] = React.useState(false)
  const [warpTextOpen, setWarpTextOpen] = React.useState(false)
  const [layerCompsOpen, setLayerCompsOpen] = React.useState(false)
  const [colorLabelsOpen, setColorLabelsOpen] = React.useState(false)
  const [exportAsOpen, setExportAsOpen] = React.useState(false)
  const [exportAsInitial, setExportAsInitial] = React.useState<any>(undefined)
  const [batchExportOpen, setBatchExportOpen] = React.useState(false)
  const [batchExportInitial, setBatchExportInitial] = React.useState<any>(undefined)
  const [batchProcessingOpen, setBatchProcessingOpen] = React.useState(false)
  const [imageProcessorOpen, setImageProcessorOpen] = React.useState(false)
  const [documentReportOpen, setDocumentReportOpen] = React.useState(false)
  const [preflightOpen, setPreflightOpen] = React.useState(false)
  const [filterGalleryOpen, setFilterGalleryOpen] = React.useState(false)
  const [cameraRawOpen, setCameraRawOpen] = React.useState(false)
  const [selectMaskOpen, setSelectMaskOpen] = React.useState(false)
  const [gridSettingsOpen, setGridSettingsOpen] = React.useState(false)
  const [newGuideOpen, setNewGuideOpen] = React.useState(false)
  const [guideLayoutOpen, setGuideLayoutOpen] = React.useState(false)
  const [contactSheetOpen, setContactSheetOpen] = React.useState(false)
  const [fileInfoOpen, setFileInfoOpen] = React.useState(false)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [advancedTab, setAdvancedTab] = React.useState<AdvancedSubsystemTab>("3d")
  const [algorithmOpen, setAlgorithmOpen] = React.useState(false)
  const [gapWorkflow, setGapWorkflow] = React.useState<GapWorkflowKind | null>(null)
  const [preferencesOpen, setPreferencesOpen] = React.useState(false)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const [aboutOpen, setAboutOpen] = React.useState(false)
  const [recentManagerOpen, setRecentManagerOpen] = React.useState(false)
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = React.useState(false)
  const [selectionOperation, setSelectionOperation] = React.useState<SelectionOperation | null>(null)
  const [savedWorkspaces, setSavedWorkspaces] = React.useState<{ name: string; savedAt?: number }[]>([])
  const [recentDocuments, setRecentDocuments] = React.useState<RecentDocument[]>([])

  const refreshWorkspaces = React.useCallback(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("ps-workspaces-v2") ?? localStorage.getItem("ps-workspaces-v1") ?? "[]")
      setSavedWorkspaces(Array.isArray(parsed) ? parsed : [])
    } catch {
      setSavedWorkspaces([])
    }
  }, [])

  React.useEffect(() => {
    refreshWorkspaces()
    window.addEventListener("ps-workspaces-changed", refreshWorkspaces)
    return () => window.removeEventListener("ps-workspaces-changed", refreshWorkspaces)
  }, [refreshWorkspaces])

  const refreshRecents = React.useCallback(() => {
    setRecentDocuments(readRecentDocuments())
  }, [])

  React.useEffect(() => {
    refreshRecents()
    window.addEventListener("ps-recents-changed", refreshRecents)
    return () => window.removeEventListener("ps-recents-changed", refreshRecents)
  }, [refreshRecents])

  const rememberDoc = React.useCallback((doc: NonNullable<typeof activeDoc>, kind: RecentDocument["kind"]) => {
    try {
      rememberRecentDocument({ name: doc.name, kind, serialized: serializeProject(doc), thumbnail: generateDocumentThumbnail(doc) })
      refreshRecents()
    } catch {}
  }, [refreshRecents])

  const openRecent = async (recent: RecentDocument) => {
    try {
      const doc = await deserializeProject(recent.serialized)
      createDocument(doc, "Open Recent")
      dispatch({ type: "add-document-report", report: createDocumentReport(doc, "Project Import") })
      rememberRecentDocument({ ...recent, updatedAt: Date.now() })
      refreshRecents()
    } catch (err) {
      removeRecentDocument(recent.id)
      refreshRecents()
      toast.error(err instanceof Error ? err.message : "Could not open recent document")
    }
  }

  // Remember the last non-empty selection so the user can "Reselect" (Cmd+Shift+D).
  const lastSelectionRef = React.useRef<NonNullable<typeof activeDoc>["selection"] | null>(null)
  React.useEffect(() => {
    if (activeDoc?.selection?.bounds) {
      lastSelectionRef.current = activeDoc.selection
    }
  }, [activeDoc?.selection])

  // Allow other panels (e.g. Layers panel adjustment menu) to open filter dialogs
  React.useEffect(() => {
    const handler = (e: CustomEvent<string>) => {
      const id = e.detail
      if (typeof id === "string") {
        setOpenFilter(id)
        setLastFilter(id)
      }
    }
    window.addEventListener("ps-open-filter", handler as EventListener)
    return () => window.removeEventListener("ps-open-filter", handler as EventListener)
  }, [])

  // Reselect via Cmd+Shift+D
  React.useEffect(() => {
    const handler = () => {
      if (lastSelectionRef.current) {
        dispatch({ type: "set-selection", selection: lastSelectionRef.current })
      }
    }
    window.addEventListener("ps-reselect", handler)
    return () => window.removeEventListener("ps-reselect", handler)
  }, [dispatch])

  // Open warp text dialog from options bar / shortcuts
  React.useEffect(() => {
    const handler = () => setWarpTextOpen(true)
    window.addEventListener("ps-open-warp-text", handler)
    return () => window.removeEventListener("ps-open-warp-text", handler)
  }, [])

  React.useEffect(() => {
    const galleryHandler = () => setFilterGalleryOpen(true)
    const cameraRawHandler = () => setCameraRawOpen(true)
    const preferencesHandler = () => setPreferencesOpen(true)
    const shortcutsHandler = () => setShortcutsOpen(true)
    const exportAsHandler = (event: Event) => {
      setExportAsInitial((event as CustomEvent).detail)
      setExportAsOpen(true)
    }
    const batchExportHandler = (event: Event) => {
      setBatchExportInitial((event as CustomEvent).detail)
      setBatchExportOpen(true)
    }
    const batchProcessingHandler = () => setBatchProcessingOpen(true)
    const imageProcessorHandler = () => setImageProcessorOpen(true)
    const reportHandler = () => setDocumentReportOpen(true)
    const preflightHandler = () => setPreflightOpen(true)
    const layerCompsHandler = () => setLayerCompsOpen(true)
    const selectMaskHandler = () => setSelectMaskOpen(true)
    const recentManagerHandler = () => setRecentManagerOpen(true)
    const workspaceManagerHandler = () => setWorkspaceManagerOpen(true)
    const fileInfoHandler = () => setFileInfoOpen(true)
    const algorithmHandler = () => setAlgorithmOpen(true)
    const advancedHandler = (tab: AdvancedSubsystemTab) => {
      setAdvancedTab(tab)
      setAdvancedOpen(true)
    }
    const threeDHandler = () => advancedHandler("3d")
    const videoHandler = () => advancedHandler("video")
    const printHandler = () => advancedHandler("print")
    const previewHandler = () => advancedHandler("preview")
    const automationHandler = () => advancedHandler("automation")
    const provenanceHandler = () => advancedHandler("provenance")
    const pluginsHandler = () => advancedHandler("plugins")
    const librariesHandler = () => advancedHandler("libraries")
    const colorWorkflowHandler = () => advancedHandler("color")
    const formatsHandler = () => advancedHandler("formats")
    const variablesHandler = () => advancedHandler("variables")
    const gapWorkflowHandler = (event: Event) => {
      const detail = (event as CustomEvent<GapWorkflowKind>).detail
      if (detail) setGapWorkflow(detail)
    }
    const selectionOperationHandler = (event: Event) => {
      const operation = (event as CustomEvent<SelectionOperation>).detail
      if (operation) setSelectionOperation(operation)
    }
    window.addEventListener("ps-open-filter-gallery", galleryHandler)
    window.addEventListener("ps-open-camera-raw", cameraRawHandler)
    window.addEventListener("ps-open-preferences", preferencesHandler)
    window.addEventListener("ps-open-shortcuts", shortcutsHandler)
    window.addEventListener("ps-open-export-as", exportAsHandler)
    window.addEventListener("ps-open-batch-export", batchExportHandler)
    window.addEventListener("ps-open-batch-processing", batchProcessingHandler)
    window.addEventListener("ps-open-image-processor", imageProcessorHandler)
    window.addEventListener("ps-open-document-report", reportHandler)
    window.addEventListener("ps-open-preflight", preflightHandler)
    window.addEventListener("ps-open-layer-comps", layerCompsHandler)
    window.addEventListener("ps-open-select-and-mask", selectMaskHandler)
    window.addEventListener("ps-open-recent-documents", recentManagerHandler)
    window.addEventListener("ps-open-workspace-manager", workspaceManagerHandler)
    window.addEventListener("ps-open-file-info", fileInfoHandler)
    window.addEventListener("ps-open-algorithmic-operations", algorithmHandler)
    window.addEventListener("ps-open-3d-workspace", threeDHandler)
    window.addEventListener("ps-open-video-render", videoHandler)
    window.addEventListener("ps-open-print-workflow", printHandler)
    window.addEventListener("ps-open-device-preview", previewHandler)
    window.addEventListener("ps-open-automation-workflow", automationHandler)
    window.addEventListener("ps-open-provenance", provenanceHandler)
    window.addEventListener("ps-open-plugin-manager", pluginsHandler)
    window.addEventListener("ps-open-cloud-libraries", librariesHandler)
    window.addEventListener("ps-open-color-management-workflow", colorWorkflowHandler)
    window.addEventListener("ps-open-format-metadata", formatsHandler)
    window.addEventListener("ps-open-variables", variablesHandler)
    window.addEventListener("ps-open-gap-workflow", gapWorkflowHandler as EventListener)
    window.addEventListener("ps-open-selection-operation", selectionOperationHandler as EventListener)
    return () => {
      window.removeEventListener("ps-open-filter-gallery", galleryHandler)
      window.removeEventListener("ps-open-camera-raw", cameraRawHandler)
      window.removeEventListener("ps-open-preferences", preferencesHandler)
      window.removeEventListener("ps-open-shortcuts", shortcutsHandler)
      window.removeEventListener("ps-open-export-as", exportAsHandler)
      window.removeEventListener("ps-open-batch-export", batchExportHandler)
      window.removeEventListener("ps-open-batch-processing", batchProcessingHandler)
      window.removeEventListener("ps-open-image-processor", imageProcessorHandler)
      window.removeEventListener("ps-open-document-report", reportHandler)
      window.removeEventListener("ps-open-preflight", preflightHandler)
      window.removeEventListener("ps-open-layer-comps", layerCompsHandler)
      window.removeEventListener("ps-open-select-and-mask", selectMaskHandler)
      window.removeEventListener("ps-open-recent-documents", recentManagerHandler)
      window.removeEventListener("ps-open-workspace-manager", workspaceManagerHandler)
      window.removeEventListener("ps-open-file-info", fileInfoHandler)
      window.removeEventListener("ps-open-algorithmic-operations", algorithmHandler)
      window.removeEventListener("ps-open-3d-workspace", threeDHandler)
      window.removeEventListener("ps-open-video-render", videoHandler)
      window.removeEventListener("ps-open-print-workflow", printHandler)
      window.removeEventListener("ps-open-device-preview", previewHandler)
      window.removeEventListener("ps-open-automation-workflow", automationHandler)
      window.removeEventListener("ps-open-provenance", provenanceHandler)
      window.removeEventListener("ps-open-plugin-manager", pluginsHandler)
      window.removeEventListener("ps-open-cloud-libraries", librariesHandler)
      window.removeEventListener("ps-open-color-management-workflow", colorWorkflowHandler)
      window.removeEventListener("ps-open-format-metadata", formatsHandler)
      window.removeEventListener("ps-open-variables", variablesHandler)
      window.removeEventListener("ps-open-gap-workflow", gapWorkflowHandler as EventListener)
      window.removeEventListener("ps-open-selection-operation", selectionOperationHandler as EventListener)
    }
  }, [])

  // Clear slices/ruler from options bar
  React.useEffect(() => {
    const sliceHandler = () => dispatch({ type: "clear-slices" })
    const rulerHandler = () => dispatch({ type: "set-measurement", m: null })
    window.addEventListener("ps-clear-slices", sliceHandler)
    window.addEventListener("ps-clear-ruler", rulerHandler)
    return () => {
      window.removeEventListener("ps-clear-slices", sliceHandler)
      window.removeEventListener("ps-clear-ruler", rulerHandler)
    }
  }, [dispatch])

  const undo = () => historyIndex > 0 && jumpHistory(historyIndex - 1)
  const redo = () => historyIndex < history.length - 1 && jumpHistory(historyIndex + 1)
  const openAdvancedTab = (tab: AdvancedSubsystemTab) => {
    setAdvancedTab(tab)
    setAdvancedOpen(true)
  }

  const closeOtherDocumentsFromMenu = () => {
    if (!activeDoc) {
      toast.info("Open a document before closing other documents.")
      return
    }
    if (documents.length < 2) {
      toast.info("There are no other open documents to close.")
      return
    }
    closeOtherDocuments(activeDoc.id)
  }

  const reopenClosedDocumentFromMenu = () => {
    if (!closedDocuments.length) {
      toast.info("No closed documents are available to reopen.")
      return
    }
    reopenClosedDocument()
  }

  const copyLayerStyle = () => {
    if (!activeLayer) {
      toast.info("Select a layer before copying a layer style.")
      return
    }
    if (!activeLayer.style) {
      toast.info("The active layer has no layer style to copy.")
      return
    }
    dispatch({ type: "set-style-clipboard", style: cloneLayerStyle(activeLayer.style) })
  }

  const pasteLayerStyle = () => {
    if (!styleClipboard) {
      toast.info("Copy a layer style before pasting one.")
      return
    }
    if (!selectedLayers.length) {
      toast.info("Select at least one layer before pasting a layer style.")
      return
    }
    const ids: string[] = []
    for (const layer of selectedLayers) {
      dispatch({ type: "set-layer-style", id: layer.id, style: cloneLayerStyle(styleClipboard) })
      ids.push(layer.id)
    }
    setTimeout(() => commit("Paste Layer Style", ids), 0)
  }

  const clearLayerStyle = () => {
    if (!selectedLayers.length) {
      toast.info("Select at least one layer before clearing layer styles.")
      return
    }
    const ids = selectedLayers.filter((layer) => layer.style).map((layer) => layer.id)
    if (!ids.length) {
      toast.info("The selected layers do not have layer styles to clear.")
      return
    }
    for (const id of ids) dispatch({ type: "set-layer-style", id, style: undefined })
    setTimeout(() => commit("Clear Layer Style", ids), 0)
  }

  const toggleLayerMaskEnabled = () => {
    if (!activeLayer) {
      toast.info("Select a layer before toggling its mask.")
      return
    }
    if (!activeLayer.mask) {
      toast.info("Add a layer mask before toggling mask visibility.")
      return
    }
    dispatch({ type: "set-layer-mask-enabled", id: activeLayer.id, enabled: activeLayer.maskEnabled === false })
    setTimeout(() => commit(activeLayer.maskEnabled === false ? "Enable Layer Mask" : "Disable Layer Mask", [activeLayer.id]), 0)
  }

  const applyLayerMask = () => {
    if (!activeLayer) {
      toast.info("Select a layer before applying a mask.")
      return
    }
    if (!activeLayer.mask) {
      toast.info("Add a layer mask before applying it.")
      return
    }
    if (activeLayer.locked) {
      toast.info("Unlock the active layer before applying its mask.")
      return
    }
    if (typeof activeLayer.canvas.getContext !== "function") return
    const ctx = activeLayer.canvas.getContext("2d")!
    ctx.save()
    ctx.globalCompositeOperation = "destination-in"
    ctx.drawImage(activeLayer.mask, 0, 0)
    ctx.restore()
    dispatch({ type: "set-layer-mask", id: activeLayer.id, mask: null })
    setTimeout(() => commit("Apply Layer Mask", [activeLayer.id]), 0)
  }

  const editSmartObjectContentsFromMenu = () => {
    if (!activeLayer) {
      toast.info("Select a smart object layer before editing its contents.")
      return
    }
    if (!activeLayer.smartObject && activeLayer.kind !== "smart-object") {
      toast.info("Convert the active layer to a smart object before editing its contents.")
      return
    }
    editSmartObject(activeLayer)
  }

  const updateSmartObjectParentFromMenu = () => {
    if (!activeDoc?.smartObjectParent) {
      toast.info("Open a smart object contents document before updating its parent.")
      return
    }
    updateSmartObjectParent()
  }

  const fillForeground = (with_: "fg" | "bg" | "white" | "black" | "transparent") => {
    if (!activeDoc || !activeLayer || activeLayer.locked) return
    const ctx = activeLayer.canvas.getContext("2d")!
    if (with_ === "transparent") {
      ctx.clearRect(0, 0, activeDoc.width, activeDoc.height)
    } else {
      const fillStyle =
        with_ === "fg"
          ? foreground
          : with_ === "bg"
            ? background
            : with_ === "white"
              ? "#ffffff"
              : "#000000"
      ctx.fillStyle = fillStyle
      ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
    }
    commit(`Fill ${with_}`, [activeLayer.id])
  }

  const fillContentAware = () => {
    if (!activeDoc) {
      toast.info("Open a document before using Content-Aware Fill.")
      return
    }
    if (!activeLayer) {
      toast.info("Select a layer before using Content-Aware Fill.")
      return
    }
    if (activeLayer.locked) {
      toast.info("Unlock the active layer before using Content-Aware Fill.")
      return
    }
    if (!activeDoc.selection.bounds) {
      toast.info("Create a selection before using Content-Aware Fill.")
      return
    }
    const mask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
    if (!mask) return
    const maskData = mask.getContext("2d")!.getImageData(0, 0, activeDoc.width, activeDoc.height)
    contentAwareFill(activeLayer.canvas, activeDoc.selection.bounds, maskData)
    commit("Content-Aware Fill", [activeLayer.id])
  }

  /** Apply a "no-param" filter immediately to all unlocked selected layers. */
  const applyInstant = (filterId: string) => {
    if (!activeDoc) return
    const f = FILTERS[filterId]
    if (!f) return
    let count = 0
    const changedLayerIds: string[] = []
    for (const l of selectedLayers) {
      if (l.locked) continue
      if (typeof l.canvas.getContext !== "function") continue
      const ctx = l.canvas.getContext("2d")!
      const src = ctx.getImageData(0, 0, l.canvas.width, l.canvas.height)
      const def: Record<string, number | string | boolean> = {}
      for (const p of f.params) def[p.key] = p.default
      const out = f.apply(src, def)
      ctx.putImageData(out, 0, 0)
      count++
      changedLayerIds.push(l.id)
    }
    if (count) {
      commit(`${f.name}${count > 1 ? ` (${count} layers)` : ""}`, changedLayerIds)
      setLastFilter(filterId)
    }
  }

  const openFilterDialog = (filterId: string) => {
    if (selectedLayers.every((l) => l.locked)) return
    setOpenFilter(filterId)
    setLastFilter(filterId)
  }

  const addAdjustmentLayer = (filterId: AdjustmentType) => {
    if (!activeDoc) {
      toast.info("Open a document before adding an adjustment layer.")
      return
    }
    const filter = FILTERS[filterId]
    if (!filter) return
    const layer = createAdjustmentLayerModel({
      filterId,
      width: activeDoc.width,
      height: activeDoc.height,
      layers: activeDoc.layers,
      makeCanvas,
    })
    dispatch({ type: "add-layer", layer })
    if (!isAdjustmentNoop(layer.adjustment)) requestRender()
    setLastFilter(filterId)
    window.setTimeout(() => commit(`New ${filter.name} Adjustment`, [layer.id]), 0)
  }

  const rotateImage = (deg: number) => {
    if (!activeDoc) return
    const w = activeDoc.width
    const h = activeDoc.height
    const radians = (deg * Math.PI) / 180
    const cos = Math.abs(Math.cos(radians))
    const sin = Math.abs(Math.sin(radians))
    const newW = Math.max(1, Math.ceil(w * cos + h * sin))
    const newH = Math.max(1, Math.ceil(w * sin + h * cos))
    const rotateCanvasInPlace = (canvas: HTMLCanvasElement | null | undefined, fill?: string) => {
      if (!canvas || typeof canvas.getContext !== "function") return
      const tmp = makeCanvas(newW, newH)
      const ctx = tmp.getContext("2d")!
      if (fill) {
        ctx.fillStyle = fill
        ctx.fillRect(0, 0, newW, newH)
      }
      ctx.translate(newW / 2, newH / 2)
      ctx.rotate(radians)
      ctx.drawImage(canvas, -w / 2, -h / 2)
      canvas.width = newW
      canvas.height = newH
      const lctx = canvas.getContext("2d")!
      lctx.clearRect(0, 0, newW, newH)
      lctx.drawImage(tmp, 0, 0)
    }
    const rotatePoint = (x: number, y: number) => {
      const dx = x - w / 2
      const dy = y - h / 2
      return {
        x: newW / 2 + dx * Math.cos(radians) - dy * Math.sin(radians),
        y: newH / 2 + dx * Math.sin(radians) + dy * Math.cos(radians),
      }
    }
    for (const layer of activeDoc.layers) {
      rotateCanvasInPlace(layer.canvas)
      rotateCanvasInPlace(layer.mask)
      if (layer.frame?.imageCanvas) rotateCanvasInPlace(layer.frame.imageCanvas)
      if (layer.text) {
        const p = rotatePoint(layer.text.x, layer.text.y)
        layer.text = { ...layer.text, x: p.x, y: p.y }
      }
      if (layer.shape) {
        const center = rotatePoint(layer.shape.x + layer.shape.w / 2, layer.shape.y + layer.shape.h / 2)
        layer.shape = { ...layer.shape, x: center.x - layer.shape.w / 2, y: center.y - layer.shape.h / 2 }
      }
      if (layer.path) {
        layer.path = {
          ...layer.path,
          points: layer.path.points.map((point) => {
            const p = rotatePoint(point.x, point.y)
            const cp1 = point.cp1 ? rotatePoint(point.cp1.x, point.cp1.y) : undefined
            const cp2 = point.cp2 ? rotatePoint(point.cp2.x, point.cp2.y) : undefined
            return { ...point, ...p, cp1, cp2 }
          }),
        }
      }
      if (layer.vectorMask) {
        layer.vectorMask = {
          ...layer.vectorMask,
          points: layer.vectorMask.points.map((point) => {
            const p = rotatePoint(point.x, point.y)
            const cp1 = point.cp1 ? rotatePoint(point.cp1.x, point.cp1.y) : undefined
            const cp2 = point.cp2 ? rotatePoint(point.cp2.x, point.cp2.y) : undefined
            return { ...point, ...p, cp1, cp2 }
          }),
        }
      }
    }
    activeDoc.width = newW
    activeDoc.height = newH
    commit(`Rotate ${deg}°`, "all")
  }

  const setColorMode = (mode: DocumentModeSettings["mode"]) => {
    if (!activeDoc) return
    for (const l of activeDoc.layers) {
      if (typeof l.canvas.getContext !== "function") continue
      const ctx = l.canvas.getContext("2d")!
      const img = ctx.getImageData(0, 0, l.canvas.width, l.canvas.height)
      for (let i = 0; i < img.data.length; i += 4) {
        const r = img.data[i]
        const g = img.data[i + 1]
        const b = img.data[i + 2]
        const v = 0.299 * r + 0.587 * g + 0.114 * b
        if (mode === "Grayscale") {
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        } else if (mode === "CMYK") {
          const k = 1 - Math.max(r, g, b) / 255
          img.data[i] = Math.round(255 * (1 - Math.min(1, (1 - r / 255 - k) / Math.max(0.0001, 1 - k) * 0.92 + k * 0.08)))
          img.data[i + 1] = Math.round(255 * (1 - Math.min(1, (1 - g / 255 - k) / Math.max(0.0001, 1 - k) * 0.92 + k * 0.08)))
          img.data[i + 2] = Math.round(255 * (1 - Math.min(1, (1 - b / 255 - k) / Math.max(0.0001, 1 - k) * 0.92 + k * 0.08)))
        } else if (mode === "Indexed") {
          img.data[i] = Math.round(r / 32) * 32
          img.data[i + 1] = Math.round(g / 32) * 32
          img.data[i + 2] = Math.round(b / 32) * 32
        } else if (mode === "Bitmap") {
          const bw = v >= 128 ? 255 : 0
          img.data[i] = img.data[i + 1] = img.data[i + 2] = bw
        } else if (mode === "Duotone") {
          const t = v / 255
          img.data[i] = Math.round(20 + 68 * t)
          img.data[i + 1] = Math.round(25 + 112 * t)
          img.data[i + 2] = Math.round(34 + 146 * t)
        } else if (mode === "Multichannel") {
          img.data[i] = r
          img.data[i + 1] = Math.round(g * 0.92 + b * 0.08)
          img.data[i + 2] = Math.round(b * 0.92 + r * 0.08)
        }
      }
      ctx.putImageData(img, 0, 0)
    }
    dispatch({ type: "set-document-mode-settings", colorMode: mode, settings: { mode } })
    commit(`Mode: ${mode}`, mode === "RGB" ? [] : "all")
  }

  const autoContrast = () => {
    if (!activeLayer || activeLayer.locked) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    const ctx = activeLayer.canvas.getContext("2d")!
    const src = ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    const mins = [255, 255, 255]
    const maxs = [0, 0, 0]
    for (let i = 0; i < src.data.length; i += 4) {
      if (src.data[i + 3] === 0) continue
      for (let k = 0; k < 3; k++) {
        if (src.data[i + k] < mins[k]) mins[k] = src.data[i + k]
        if (src.data[i + k] > maxs[k]) maxs[k] = src.data[i + k]
      }
    }
    for (let i = 0; i < src.data.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const range = Math.max(1, maxs[k] - mins[k])
        src.data[i + k] = Math.max(0, Math.min(255, ((src.data[i + k] - mins[k]) * 255) / range))
      }
    }
    ctx.putImageData(src, 0, 0)
    commit("Auto Contrast", [activeLayer.id])
  }

  const autoColor = () => {
    if (!activeLayer || activeLayer.locked) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    const ctx = activeLayer.canvas.getContext("2d")!
    const src = ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let count = 0
    for (let i = 0; i < src.data.length; i += 4) {
      if (src.data[i + 3] === 0) continue
      sumR += src.data[i]
      sumG += src.data[i + 1]
      sumB += src.data[i + 2]
      count++
    }
    if (count === 0) return
    const gray = (sumR + sumG + sumB) / (3 * count)
    const gains = [gray / Math.max(1, sumR / count), gray / Math.max(1, sumG / count), gray / Math.max(1, sumB / count)]
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = Math.max(0, Math.min(255, src.data[i] * gains[0]))
      src.data[i + 1] = Math.max(0, Math.min(255, src.data[i + 1] * gains[1]))
      src.data[i + 2] = Math.max(0, Math.min(255, src.data[i + 2] * gains[2]))
    }
    ctx.putImageData(src, 0, 0)
    commit("Auto Color", [activeLayer.id])
  }

  const autoWhiteBalance = () => {
    if (!activeLayer || activeLayer.locked) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    const ctx = activeLayer.canvas.getContext("2d")!
    const src = ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let count = 0
    for (let i = 0; i < src.data.length; i += 4) {
      if (src.data[i + 3] === 0) continue
      sumR += src.data[i]
      sumG += src.data[i + 1]
      sumB += src.data[i + 2]
      count++
    }
    if (count === 0) return
    const avgR = sumR / count
    const avgG = sumG / count
    const avgB = sumB / count
    const gray = (avgR + avgG + avgB) / 3
    const sR = gray / Math.max(1, avgR)
    const sG = gray / Math.max(1, avgG)
    const sB = gray / Math.max(1, avgB)
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = Math.max(0, Math.min(255, src.data[i] * sR))
      src.data[i + 1] = Math.max(0, Math.min(255, src.data[i + 1] * sG))
      src.data[i + 2] = Math.max(0, Math.min(255, src.data[i + 2] * sB))
    }
    ctx.putImageData(src, 0, 0)
    commit("Auto White Balance", [activeLayer.id])
  }

  const flipImage = (axis: "horizontal" | "vertical") => {
    if (!activeDoc) return
    for (const layer of activeDoc.layers) {
      if (typeof layer.canvas.getContext !== "function") continue
      const tmp = makeCanvas(layer.canvas.width, layer.canvas.height)
      const ctx = tmp.getContext("2d")!
      if (axis === "horizontal") {
        ctx.translate(layer.canvas.width, 0)
        ctx.scale(-1, 1)
      } else {
        ctx.translate(0, layer.canvas.height)
        ctx.scale(1, -1)
      }
      ctx.drawImage(layer.canvas, 0, 0)
      const lctx = layer.canvas.getContext("2d")!
      lctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
      lctx.drawImage(tmp, 0, 0)
    }
    commit(`Flip ${axis}`, "all")
  }

  const layerAlphaBounds = (layer: Layer) => {
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return null
    const img = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    let minX = layer.canvas.width
    let minY = layer.canvas.height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < layer.canvas.height; y++) {
      for (let x = 0; x < layer.canvas.width; x++) {
        if (img.data[(y * layer.canvas.width + x) * 4 + 3] <= 8) continue
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    return maxX >= minX ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
  }

  const contentBounds = () => {
    if (!activeDoc) return null
    const bounds = activeDoc.layers.filter((layer) => layer.visible && layer.kind !== "group").map(layerAlphaBounds).filter(Boolean) as { x: number; y: number; w: number; h: number }[]
    if (!bounds.length) return null
    const left = Math.min(...bounds.map((b) => b.x))
    const top = Math.min(...bounds.map((b) => b.y))
    const right = Math.max(...bounds.map((b) => b.x + b.w))
    const bottom = Math.max(...bounds.map((b) => b.y + b.h))
    return { x: left, y: top, w: right - left, h: bottom - top }
  }

  const cropDocumentToBounds = (bounds: { x: number; y: number; w: number; h: number }, label: string) => {
    if (!activeDoc || bounds.w <= 0 || bounds.h <= 0) return
    for (const layer of activeDoc.layers) {
      const next = makeCanvas(bounds.w, bounds.h)
      next.getContext("2d")!.drawImage(layer.canvas, -bounds.x, -bounds.y)
      layer.canvas.width = bounds.w
      layer.canvas.height = bounds.h
      layer.canvas.getContext("2d")!.clearRect(0, 0, bounds.w, bounds.h)
      layer.canvas.getContext("2d")!.drawImage(next, 0, 0)
      if (layer.mask) {
        const mask = makeCanvas(bounds.w, bounds.h)
        mask.getContext("2d")!.drawImage(layer.mask, -bounds.x, -bounds.y)
        layer.mask.width = bounds.w
        layer.mask.height = bounds.h
        layer.mask.getContext("2d")!.clearRect(0, 0, bounds.w, bounds.h)
        layer.mask.getContext("2d")!.drawImage(mask, 0, 0)
      }
      if (layer.text) layer.text = { ...layer.text, x: layer.text.x - bounds.x, y: layer.text.y - bounds.y }
      if (layer.shape) layer.shape = { ...layer.shape, x: layer.shape.x - bounds.x, y: layer.shape.y - bounds.y }
    }
    activeDoc.width = bounds.w
    activeDoc.height = bounds.h
    commit(label, "all")
  }

  const revealAll = () => {
    if (!activeDoc) return
    const bounds = contentBounds()
    if (!bounds) return
    const x = Math.min(0, bounds.x)
    const y = Math.min(0, bounds.y)
    const right = Math.max(activeDoc.width, bounds.x + bounds.w)
    const bottom = Math.max(activeDoc.height, bounds.y + bounds.h)
    const next = { x, y, w: right - x, h: bottom - y }
    cropDocumentToBounds(next, "Reveal All")
  }

  const exportImage = (format: "png" | "jpg") => {
    if (!activeDoc) return
    const flat = makeCanvas(activeDoc.width, activeDoc.height)
    const ctx = flat.getContext("2d")!
    if (format === "jpg") {
      ctx.fillStyle = activeDoc.background
      ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
    }
    for (const l of activeDoc.layers) {
      if (!l.visible) continue
      if (typeof l.canvas.getContext !== "function") continue
      compositeLayer(ctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
    }
    const a = document.createElement("a")
    const mime = format === "png" ? "image/png" : "image/jpeg"
    a.href = flat.toDataURL(mime, 0.92)
    a.download = `${safeDocName()}.${format}`
    a.click()
  }

  const safeNameFor = (name: string) =>
    name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_") || "Untitled"

  const safeDocName = () => safeNameFor(activeDoc?.name ?? "Untitled")

  const writeProjectHandle = async (handle: FileSystemFileHandleLike, text: string) => {
    const writable = await handle.createWritable()
    await writable.write(new Blob([text], { type: "application/json" }))
    await writable.close()
  }

  const chooseProjectSaveHandle = async (suggestedName: string) => {
    const picker = (window as SavePickerWindow).showSaveFilePicker
    if (!picker) return null
    return picker({
      suggestedName,
      types: [
        {
          description: "Photoshop Web Project",
          accept: { "application/json": [".psprojson"] },
        },
      ],
    })
  }

  const saveProjectDocument = React.useCallback(async (docId?: string, mode: SaveMode = "save") => {
    const doc = documents.find((candidate) => candidate.id === (docId ?? activeDoc?.id))
    if (!doc) return false
    const lifecycle = documentStatuses[doc.id]
    const report = createDocumentReport(doc, "Project Export")
    const docWithReport = { ...doc, reports: [report, ...(doc.reports ?? [])].slice(0, 12) }
    const serialized = serializeProject(docWithReport)
    const fallbackName = `${safeNameFor(lifecycle?.fileName ?? doc.name)}.psprojson`
    let nextLifecycle: Partial<DocumentLifecycleState> = {
      fileKind: "project",
      fileName: fallbackName,
    }

    try {
      if (mode === "save" && lifecycle?.fileHandle && lifecycle.fileKind === "project") {
        await writeProjectHandle(lifecycle.fileHandle, serialized)
        nextLifecycle = {
          ...nextLifecycle,
          storage: "file-system-access",
          fileHandle: lifecycle.fileHandle,
          fileName: lifecycle.fileHandle.name,
          lastSaveNote: "Saved to the existing browser file handle.",
        }
      } else {
        const handle = await chooseProjectSaveHandle(fallbackName)
        if (handle) {
          await writeProjectHandle(handle, serialized)
          nextLifecycle = {
            ...nextLifecycle,
            storage: "file-system-access",
            fileHandle: handle,
            fileName: handle.name,
            lastSaveNote: "Saved to a browser file handle; future Save will overwrite this handle while permission remains available.",
          }
        } else {
          downloadText(serialized, fallbackName, "application/json")
          nextLifecycle = {
            ...nextLifecycle,
            storage: "download",
            fileHandle: undefined,
            lastSaveNote: "Saved by browser download. This app cannot overwrite downloaded files without File System Access support.",
          }
        }
      }
      if (doc.id === activeDoc?.id) dispatch({ type: "add-document-report", report })
      rememberRecentDocument({
        name: doc.name,
        kind: "project",
        serialized,
        fileName: nextLifecycle.fileName,
        storage: nextLifecycle.storage,
      })
      markDocumentSaved(doc.id, nextLifecycle)
      refreshRecents()
      toast.success(nextLifecycle.storage === "download" ? "Project downloaded" : "Project saved")
      return true
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast.error(err instanceof Error ? err.message : "Could not save project")
      }
      return false
    }
  }, [activeDoc?.id, dispatch, documentStatuses, documents, markDocumentSaved, refreshRecents])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string; mode?: SaveMode }>).detail
      void saveProjectDocument(detail?.docId, detail?.mode ?? "save").then((success) => {
        window.dispatchEvent(new CustomEvent("ps-document-saved", { detail: { docId: detail?.docId, success } }))
      })
    }
    window.addEventListener("ps-save-document", handler as EventListener)
    return () => window.removeEventListener("ps-save-document", handler as EventListener)
  }, [saveProjectDocument])

  const openImageOrPsd = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*,.psd,image/vnd.adobe.photoshop,application/octet-stream"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        if (/\.psd$/i.test(file.name) || file.type === "image/vnd.adobe.photoshop") {
          const doc = await deserializePsdFile(file)
          createDocument(doc, "Open PSD")
          dispatch({ type: "add-document-report", report: createDocumentReport(doc, "PSD Import") })
          rememberDoc(doc, "psd")
          return
        }
        const img = await loadImageFromFile(file)
        const doc = makeDocument(file.name, img.naturalWidth, img.naturalHeight)
        doc.layers[0].canvas.getContext("2d")!.drawImage(img, 0, 0)
        createDocument(doc, "Open")
        rememberDoc(doc, "image")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not open file")
      }
    }
    input.click()
  }

  const saveProject = () => {
    void saveProjectDocument(activeDoc?.id, "save")
  }

  const saveProjectAs = () => {
    void saveProjectDocument(activeDoc?.id, "save-as")
  }

  const savePsd = () => {
    if (!activeDoc) return
    try {
      const report = createDocumentReport(activeDoc, "PSD Export")
      downloadBlob(serializePsd(activeDoc), `${safeDocName()}.psd`)
      dispatch({ type: "add-document-report", report })
      rememberDoc(activeDoc, "psd")
      toast.success("PSD exported. Save Project keeps the editable app document clean.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save PSD")
    }
  }

  const openProject = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".psprojson,application/json"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        assertFileSize(file, MAX_PROJECT_FILE_BYTES, "Project file")
        const doc = await deserializeProject(await file.text())
        createDocument(doc, "Open Project")
        dispatch({ type: "add-document-report", report: createDocumentReport(doc, "Project Import") })
        rememberDoc(doc, "project")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not open project")
      }
    }
    input.click()
  }

  const placeEmbedded = () => {
    if (!activeDoc) return
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file || !activeDoc) return
      try {
        const img = await loadImageFromFile(file)
        const canvas = makeCanvas(activeDoc.width, activeDoc.height)
        const ctx = canvas.getContext("2d")!
        const maxW = activeDoc.width * 0.9
        const maxH = activeDoc.height * 0.9
        const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight)
        const w = Math.max(1, img.naturalWidth * scale)
        const h = Math.max(1, img.naturalHeight * scale)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(img, (activeDoc.width - w) / 2, (activeDoc.height - h) / 2, w, h)
        const layer: Layer = {
          id: `layer_${Math.random().toString(36).slice(2, 9)}`,
          name: `Placed ${file.name}`,
          kind: "smart-object",
          smartObject: true,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          canvas,
        }
        dispatch({ type: "add-layer", layer })
        setTimeout(() => commit("Place Embedded", [layer.id]), 0)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not place image")
      }
    }
    input.click()
  }

  const applyWorkspacePreset = (preset: WorkspacePresetId) => {
    window.dispatchEvent(new CustomEvent("ps-apply-workspace-preset", { detail: { preset } }))
  }

  const openPanel = (id: string) => {
    window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: id }))
  }

  const saveCurrentWorkspace = () => {
    setWorkspaceManagerOpen(true)
  }

  const deleteSavedWorkspace = () => {
    setWorkspaceManagerOpen(true)
  }

  const clearRecentDocuments = () => {
    for (const recent of recentDocuments) removeRecentDocument(recent.id)
    refreshRecents()
  }

  const openSelectionOperation = (operation: SelectionOperation) => {
    setSelectionOperation(operation)
  }

  return (
    <>
      <div className="flex items-center h-7 bg-[var(--ps-chrome)] border-b border-[var(--ps-divider)] px-1 select-none">
        <div className="flex items-center pr-2 mr-1 border-r border-[var(--ps-divider)]">
          <div className="w-5 h-5 rounded-sm bg-[var(--ps-accent)] text-white text-[10px] font-semibold flex items-center justify-center mx-1">
            Ps
          </div>
        </div>

        <Menubar className="h-full min-w-0 flex-1 justify-start gap-0 rounded-none border-0 bg-transparent p-0 shadow-none">

        {/* File */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>File</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onSelect={onOpenNew}>
              New… <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openImageOrPsd}>
              Open… <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openProject}>
              Open Project…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Open Recent</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {recentDocuments.length === 0 ? (
                  <DropdownMenuItem disabled>(empty)</DropdownMenuItem>
                ) : (
                  recentDocuments.map((recent) => (
                    <DropdownMenuItem key={recent.id} onSelect={() => openRecent(recent)}>
                      <span className="truncate max-w-56">{recent.name}</span>
                      <DropdownMenuShortcut>{recent.kind}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  ))
                )}
                {recentDocuments.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setRecentManagerOpen(true)}>
                      Manage Recent Documents...
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        clearRecentDocuments()
                      }}
                    >
                      Clear Recent Files
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setRecentManagerOpen(true)}>
                      Manage Recent Documents...
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                requestCloseDocument(activeDoc.id)
              }}
            >
              Close <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => duplicateDocument()} disabled={!activeDoc}>
              Duplicate Document...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={closeOtherDocumentsFromMenu}>
              Close Others
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={reopenClosedDocumentFromMenu}>
              Reopen Closed Document
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => exportImage("png")}>
              Save As PNG… <DropdownMenuShortcut>⌘⇧S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={saveProject} disabled={!activeDoc}>
              Save Project (.psprojson)…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={savePsd} disabled={!activeDoc}>
              Save As PSD...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={placeEmbedded} disabled={!activeDoc}>
              Place Embedded…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setContactSheetOpen(true)}>
              Contact Sheet II…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Automate</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => openAdvancedTab("automation")} disabled={!activeDoc}>Automation Manager...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openAdvancedTab("automation")} disabled={!activeDoc}>Droplets...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openAdvancedTab("automation")} disabled={!activeDoc}>Script Events Manager...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openAdvancedTab("automation")} disabled={!activeDoc}>Conditional Actions...</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setGapWorkflow("load-stack")}>Load Files into Stack...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setGapWorkflow("photomerge")}>Photomerge...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setGapWorkflow("hdr-merge")}>Merge to HDR Pro...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setGapWorkflow("focus-stack")}>Focus Stack...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setGapWorkflow("stack-statistics")}>Statistics...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setGapWorkflow("pdf-presentation")}>PDF Presentation...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setGapWorkflow("image-assets")}>Generate Image Assets...</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setBatchProcessingOpen(true)}>
              Batch Processing...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImageProcessorOpen(true)}>
              Image Processor...
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Export As</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => {
                    setExportAsInitial(undefined)
                    setExportAsOpen(true)
                  }}
                >
                  Export As Dialog…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setBatchExportInitial(undefined)
                    setBatchExportOpen(true)
                  }}
                  disabled={!activeDoc}
                >
                  Batch Export...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setBatchExportInitial({ scope: "slices" })
                    setBatchExportOpen(true)
                  }}
                  disabled={!activeDoc}
                >
                  Export Slices...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setBatchExportInitial({ scope: "visible-layers" })
                    setBatchExportOpen(true)
                  }}
                  disabled={!activeDoc}
                >
                  Export Layers to Files...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setBatchExportInitial({ scope: "sprite-layers" })
                    setBatchExportOpen(true)
                  }}
                  disabled={!activeDoc}
                >
                  Sprite Sheet...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => exportImage("png")}>PNG</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportImage("jpg")}>JPG</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setFileInfoOpen(true)}>File Info…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("formats")}>
              Advanced Import / Metadata...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("variables")} disabled={!activeDoc}>
              Data Sets / Variables...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPreflightOpen(true)} disabled={!activeDoc}>Preflight Check...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDocumentReportOpen(true)} disabled={!activeDoc}>Round-Trip Inspector...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("print")} disabled={!activeDoc}>
              Print Setup / Proof...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                const flat = makeCanvas(activeDoc.width, activeDoc.height)
                const fctx = flat.getContext("2d")!
                fctx.fillStyle = activeDoc.background
                fctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
                for (const l of activeDoc.layers) {
                  if (!l.visible || typeof l.canvas.getContext !== "function") continue
                  compositeLayer(fctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
                }
                const win = window.open("", "_blank")!
                if (!win) return
                win.document.title = `Print — ${activeDoc.name}`
                const img = win.document.createElement("img")
                img.src = flat.toDataURL("image/png")
                img.style.maxWidth = "100%"
                win.document.body.style.margin = "0"
                win.document.body.style.display = "flex"
                win.document.body.style.justifyContent = "center"
                win.document.body.style.alignItems = "center"
                win.document.body.style.minHeight = "100vh"
                win.document.body.style.background = "#fff"
                win.document.body.appendChild(img)
                img.onload = () => { win.print() }
              }}

            >
              Print… <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Edit */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Edit</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onSelect={undo}>
              Undo <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={redo}>
              Redo <DropdownMenuShortcut>⌘Y</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={undo}>
              Step Backward <DropdownMenuShortcut>⌘⌥Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => copySelection(true)}
              disabled={!activeLayer || activeLayer.locked}
            >
              Cut <DropdownMenuShortcut>⌘X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => copySelection(false)}
              disabled={!activeLayer}
            >
              Copy <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                const flat = makeCanvas(activeDoc.width, activeDoc.height)
                const fctx = flat.getContext("2d")!
                for (const l of activeDoc.layers) {
                  if (!l.visible) continue
                  if (typeof l.canvas.getContext !== "function") continue
                  compositeLayer(fctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
                }
                dispatch({ type: "set-clipboard", canvas: flat })
              }}
              disabled={!activeDoc}
            >
              Copy Merged <DropdownMenuShortcut>⌘⇧C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={pasteAsLayer}>
              Paste <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => fillForeground("fg")}>
              Fill <DropdownMenuShortcut>⇧F5</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={fillContentAware}
            >
              Content-Aware Fill...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setStrokeOpen(true)} disabled={!activeLayer}>
              Stroke…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => window.dispatchEvent(new CustomEvent("ps-free-transform"))}
              disabled={!activeLayer || activeLayer.locked}
            >
              Free Transform <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAlgorithmOpen(true)} disabled={!activeDoc}>
              Algorithmic Operations...
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Transform</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-transform-flip", { detail: "horizontal" }))} disabled={!activeLayer}>
                  Flip Horizontal
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-transform-flip", { detail: "vertical" }))} disabled={!activeLayer}>
                  Flip Vertical
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-transform-rotate", { detail: 90 }))} disabled={!activeLayer}>
                  Rotate 90° CW
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-transform-rotate", { detail: -90 }))} disabled={!activeLayer}>
                  Rotate 90° CCW
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-transform-rotate", { detail: 180 }))} disabled={!activeLayer}>
                  Rotate 180°
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setPreferencesOpen(true)}>
              Preferences
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>Keyboard Shortcuts…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Image */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Image</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Mode</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => setColorMode("RGB")}>
                  {activeDoc?.colorMode === "RGB" ? "✓ " : ""}RGB Color
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("Grayscale")}>
                  {activeDoc?.colorMode === "Grayscale" ? "✓ " : ""}Grayscale
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("CMYK")}>
                  {activeDoc?.colorMode === "CMYK" ? "✓ " : ""}CMYK Color
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("Duotone")}>
                  {activeDoc?.colorMode === "Duotone" ? "âœ“ " : ""}Duotone...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("Indexed")}>
                  {activeDoc?.colorMode === "Indexed" ? "âœ“ " : ""}Indexed Color...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("Multichannel")}>
                  {activeDoc?.colorMode === "Multichannel" ? "âœ“ " : ""}Multichannel...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("Bitmap")}>
                  {activeDoc?.colorMode === "Bitmap" ? "âœ“ " : ""}Bitmap / Halftone...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>{activeDoc?.bitDepth ?? 8} Bits/Channel</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openAdvancedTab("color")} disabled={!activeDoc}>
                  Assign / Convert Profile...
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setGapWorkflow("apply-image")} disabled={!activeLayer}>
              Apply Image...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGapWorkflow("calculations")} disabled={!activeDoc}>
              Calculations...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAlgorithmOpen(true)} disabled={!activeDoc}>
              Algorithmic Operations...
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Adjustments</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("levels")}>
                  Levels… <DropdownMenuShortcut>⌘L</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("curves")}>
                  Curves… <DropdownMenuShortcut>⌘M</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("brightness-contrast")}>
                  Brightness/Contrast…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("exposure")}>
                  Exposure…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("vibrance")}>
                  Vibrance…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("hue-saturation")}>
                  Hue/Saturation… <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("color-balance")}>
                  Color Balance… <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("black-white")}>
                  Black & White…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("photo-filter")}>
                  Photo Filter…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("channel-mixer")}>
                  Channel Mixer…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("color-lookup")}>
                  Color Lookup…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("invert")}>
                  Invert <DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("posterize")}>
                  Posterize…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("threshold")}>
                  Threshold…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("gradient-map")}>
                  Gradient Map…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("selective-color")}>
                  Selective Color…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("shadows-highlights")}>
                  Shadows/Highlights…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("hdr-toning")}>
                  HDR Toning…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("desaturate")}>
                  Desaturate
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("match-color")}>
                  Match Color
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("replace-color")}>
                  Replace Color…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("equalize")}>
                  Equalize
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Auto</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => openSelectionOperation("expand")}
                >
                  Expand...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => openSelectionOperation("contract")}
                >
                  Contract...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    // Auto Tone: stretch luminance
                    if (!activeLayer || activeLayer.locked) return
                    if (typeof activeLayer.canvas.getContext !== "function") return
                    const ctx = activeLayer.canvas.getContext("2d")!
                    const src = ctx.getImageData(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
                    let min = 255
                    let max = 0
                    for (let i = 0; i < src.data.length; i += 4) {
                      const lum =
                        0.299 * src.data[i] +
                        0.587 * src.data[i + 1] +
                        0.114 * src.data[i + 2]
                      if (src.data[i + 3] === 0) continue
                      if (lum < min) min = lum
                      if (lum > max) max = lum
                    }
                    const range = Math.max(1, max - min)
                    for (let i = 0; i < src.data.length; i += 4) {
                      src.data[i] = Math.max(0, Math.min(255, ((src.data[i] - min) * 255) / range))
                      src.data[i + 1] = Math.max(0, Math.min(255, ((src.data[i + 1] - min) * 255) / range))
                      src.data[i + 2] = Math.max(0, Math.min(255, ((src.data[i + 2] - min) * 255) / range))
                    }
                    ctx.putImageData(src, 0, 0)
                    commit("Auto Tone", [activeLayer.id])
                  }}
                >
                  Auto Tone
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={autoContrast}>Auto Contrast</DropdownMenuItem>
                <DropdownMenuItem onSelect={autoColor}>Auto Color</DropdownMenuItem>
                <DropdownMenuItem onSelect={autoWhiteBalance}>Auto White Balance</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setImageSizeOpen(true)} disabled={!activeDoc}>
              Image Size… <DropdownMenuShortcut>⌘⌥I</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCanvasSizeOpen(true)} disabled={!activeDoc}>
              Canvas Size… <DropdownMenuShortcut>⌘⌥C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Image Rotation</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => rotateImage(180)}>180°</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rotateImage(90)}>90° Clockwise</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rotateImage(-90)}>
                  90° Counter Clockwise
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const raw = window.prompt("Rotate canvas by degrees", "15")
                    const deg = raw == null ? NaN : Number(raw)
                    if (Number.isFinite(deg) && deg !== 0) rotateImage(deg)
                  }}
                >
                  Arbitrary...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => flipImage("horizontal")}>
                  Flip Horizontal
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => flipImage("vertical")}>
                  Flip Vertical
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => {
                const bounds = contentBounds()
                if (bounds) cropDocumentToBounds(bounds, "Trim Transparent Pixels")
              }}
              disabled={!activeDoc}
            >
              Trim Transparent Pixels
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={revealAll} disabled={!activeDoc}>
              Reveal All
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Layer */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Layer</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>New</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => newLayer()}>
                  Layer… <DropdownMenuShortcut>⌘⇧N</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => newGroup()}
                  disabled={!selectedLayers.length}
                >
                  Group from Layers… <DropdownMenuShortcut>⌘G</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Layer Style</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => setLayerStyleOpen(true)} disabled={!activeLayer}>
                  Blending Options...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={copyLayerStyle}>
                  Copy Layer Style
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={pasteLayerStyle}>
                  Paste Layer Style
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={clearLayerStyle}>
                  Clear Layer Style
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Layer Mask</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={addLayerMask}
                  disabled={!activeLayer || !!activeLayer?.mask}
                >
                  Reveal All
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    if (!activeDoc || !activeLayer) return
                    addLayerMask()
                    setTimeout(() => {
                      if (activeLayer.mask) {
                        const ctx = activeLayer.mask.getContext("2d")!
                        ctx.fillStyle = "#000"
                        ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
                        commit("Hide All Mask", [activeLayer.id])
                      }
                    }, 16)
                  }}
                  disabled={!activeLayer || !!activeLayer?.mask}
                >
                  Hide All
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={toggleLayerMaskEnabled}
                >
                  {activeLayer?.maskEnabled === false ? "Enable Mask" : "Disable Mask"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setSelectMaskOpen(true)}
                >
                  Refine Mask...
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={applyLayerMask}
                >
                  Apply Mask
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    if (!activeLayer) {
                      toast.info("Select a layer before deleting a mask.")
                      return
                    }
                    if (!activeLayer.mask) {
                      toast.info("Add a layer mask before deleting it.")
                      return
                    }
                    dispatch({ type: "set-layer-mask", id: activeLayer.id, mask: null })
                    setTimeout(() => commit("Delete Mask", [activeLayer.id]), 0)
                  }}
                >
                  Delete Mask
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeLayer) return
                dispatch({ type: "set-layer-smart", id: activeLayer.id, smart: true })
                setTimeout(() => commit("Convert to Smart Object", [activeLayer.id]), 0)
              }}
              disabled={!activeLayer || activeLayer.smartObject}
            >
              Convert to Smart Object
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={editSmartObjectContentsFromMenu}
            >
              Edit Smart Object Contents
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={updateSmartObjectParentFromMenu}
            >
              Update Parent Smart Object
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeLayer) return
                dispatch({ type: "toggle-layer-clipped", id: activeLayer.id })
                setTimeout(() => commit("Toggle Clipping Mask", [activeLayer.id]), 0)
              }}
              disabled={!activeLayer}
            >
              Create Clipping Mask <DropdownMenuShortcut>⌘⌥G</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => activeLayer && dispatch({ type: "duplicate-layer", id: activeLayer.id })}
              disabled={!activeLayer}
            >
              Duplicate Layer… <DropdownMenuShortcut>⌘J</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => activeLayer && dispatch({ type: "remove-layer", id: activeLayer.id })}
              disabled={!activeLayer}
            >
              Delete Layer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => dispatch({ type: "link-selected" })}
            >
              Link Layers
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "unlink-selected" })}>
              Unlink Layers
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => activeLayer && dispatch({ type: "merge-down", id: activeLayer.id })}
            >
              Merge Down <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                dispatch({ type: "merge-selected" })
                setTimeout(() => commit("Merge Layers", "all"), 0)
              }}
            >
              Merge Selected
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                dispatch({ type: "flatten" })
                setTimeout(() => commit("Flatten", "all"), 0)
              }}
            >
              Flatten Image
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                dispatch({ type: "stamp-visible" })
                setTimeout(() => commit("Stamp Visible", "all"), 0)
              }}
            >
              Stamp Visible <DropdownMenuShortcut>⌘⇧⌥E</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Type */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Type</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Type</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
                const enabled = activeLayer.text.antiAlias === false
                const next = { ...activeLayer.text, antiAlias: enabled, antiAliasMode: enabled ? "smooth" : "none" as TextAntiAliasMode }
                dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
                rasterizeText(activeLayer.canvas, next)
                setTimeout(() => commit(`Anti-Alias ${enabled ? "On" : "Off"}`, [activeLayer.id]), 0)
              }}
            >
              {activeLayer?.text?.antiAlias === false ? "" : "✓ "}Anti-Alias
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
                const path = convertTextToEditablePath(activeLayer.text)
                dispatch({ type: "set-layer-path", id: activeLayer.id, path })
                dispatch({ type: "set-layer-kind", id: activeLayer.id, kind: "shape" })
                setTimeout(() => commit("Convert Text to Path", [activeLayer.id]), 0)
              }}
            >
              Convert to Shape/Path
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) {
                  toast.info("Open a document before placing text inside a shape.")
                  return
                }
                if (!activeLayer?.text) {
                  toast.info("Select a text layer before placing text inside a shape.")
                  return
                }
                const shapeLayer = activeDoc.layers.find((layer) => layer.id !== activeLayer.id && layer.shape)
                if (!shapeLayer?.shape) {
                  toast.info("Select or create a shape layer to use as the text container.")
                  return
                }
                const next = applyTextInsideShape(activeLayer.text, shapeLayer.shape, { inset: activeLayer.text.textShapeInset ?? 8 })
                dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
                rasterizeText(activeLayer.canvas, next)
                setTimeout(() => commit("Text Inside Shape", [activeLayer.id]), 0)
              }}
            >
              Text Inside Shape
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setWarpTextOpen(true)}
            >
              Warp Text…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
                const match = matchFontForLayer(activeLayer.text)
                const next = {
                  ...activeLayer.text,
                  font: match.best.family,
                  variableAxisDefinitions: match.best.variableAxes,
                  variableAxes: match.best.variableAxes?.length ? { wght: activeLayer.text.weight === "bold" ? 700 : 400 } : activeLayer.text.variableAxes,
                }
                dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
                rasterizeText(activeLayer.canvas, next)
                setTimeout(() => commit(`Match Font: ${next.font}`, [activeLayer.id]), 0)
              }}
            >
              Match Font…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                const diagnostics = diagnoseDocumentFonts(activeDoc.layers)
                if (diagnostics.missingFonts.length) {
                  toast.warning(`Missing fonts: ${diagnostics.missingFonts.join(", ")}`)
                } else {
                  toast.success("All text layer fonts are available in this browser.")
                }
                setPreflightOpen(true)
              }}
              disabled={!activeDoc}
            >
              Font Diagnostics...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) {
                  toast.info("Open a document before creating 3D text.")
                  return
                }
                if (!activeLayer?.text) {
                  toast.info("Select a text layer before creating 3D text extrusion.")
                  return
                }
                const scene = createTextExtrusionScene({
                  ...activeLayer.text,
                  extrusion: activeLayer.text.extrusion ?? { enabled: true, depth: 30, bevel: 3, angle: 35, color: activeLayer.text.color },
                })
                const rendered = renderThreeDScene(scene, activeDoc.width, activeDoc.height)
                const canvas = makeCanvas(activeDoc.width, activeDoc.height)
                canvas.getContext("2d")!.drawImage(rendered, 0, 0)
                const layer: Layer = {
                  id: `layer_text3d_${Date.now()}`,
                  name: `${activeLayer.name} 3D Text`,
                  kind: "3d",
                  visible: true,
                  locked: false,
                  opacity: 1,
                  blendMode: "normal",
                  canvas,
                  threeD: scene,
                }
                dispatch({ type: "add-layer", layer })
                setTimeout(() => commit("Create 3D Text", [layer.id]), 0)
              }}
            >
              3D Text Extrusion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Select */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Select</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                dispatch({
                  type: "set-selection",
                  selection: {
                    bounds: { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height },
                    shape: "rect",
                  },
                })
              }}
            >
              All <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
              }
            >
              Deselect <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                if (lastSelectionRef.current) {
                  dispatch({ type: "set-selection", selection: lastSelectionRef.current })
                }
              }}
            >
              Reselect <DropdownMenuShortcut>⌘⇧D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) {
                  toast.info("Open a document before saving a selection.")
                  return
                }
                if (!activeDoc.selection.bounds) {
                  toast.info("Create a selection before saving it.")
                  return
                }
                const sel = activeDoc.selection
                const inverseMask = makeCanvas(activeDoc.width, activeDoc.height)
                const ictx = inverseMask.getContext("2d")!
                ictx.fillStyle = "#fff"
                ictx.fillRect(0, 0, activeDoc.width, activeDoc.height)
                ictx.globalCompositeOperation = "destination-out"
                if (sel.mask) {
                  ictx.drawImage(sel.mask, 0, 0)
                } else if (sel.bounds) {
                  if (sel.shape === "ellipse") {
                    ictx.beginPath()
                    ictx.ellipse(
                      sel.bounds.x + sel.bounds.w / 2,
                      sel.bounds.y + sel.bounds.h / 2,
                      sel.bounds.w / 2,
                      sel.bounds.h / 2,
                      0,
                      0,
                      Math.PI * 2,
                    )
                    ictx.fill()
                  } else {
                    ictx.fillRect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h)
                  }
                }
                dispatch({
                  type: "set-selection",
                  selection: {
                    bounds: { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height },
                    shape: "freehand",
                    mask: inverseMask,
                  },
                })
              }}
            >
              Inverse <DropdownMenuShortcut>⌘⇧I</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc) return
                const ids = activeDoc.layers.map((l) => l.id)
                dispatch({ type: "set-selected-layers", ids, activeId: activeDoc.activeLayerId })
              }}
            >
              All Layers <DropdownMenuShortcut>⌘⌥A</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorRangeOpen(true)} disabled={!activeDoc}>
              Color Range…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRefineEdgeOpen(true)}>
              Refine Edge…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSelectMaskOpen(true)} disabled={!activeDoc}>
              Select and Mask… <DropdownMenuShortcut>⌘⌥R</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc || !activeLayer) return
                if (typeof activeLayer.canvas.getContext !== "function") return
                const mask = selectSubjectMask(activeLayer.canvas, 48)
                dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
                commit("Select Subject", [])
              }}
              disabled={!activeLayer}
            >
              Select Subject
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc || !activeLayer) return
                if (typeof activeLayer.canvas.getContext !== "function") return
                // "Sky" — heuristic: pick top 30% pixels with high blue and low red
                const mask = selectSkyMask(activeLayer.canvas)
                dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
                commit("Select Sky", [])
              }}
              disabled={!activeLayer}
            >
              Select Sky
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc || !activeLayer || !activeLayer.canvas) return
                if (typeof activeLayer.canvas.getContext !== "function") return
                const mask = focusAreaMask(activeLayer.canvas)
                dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
                commit("Focus Area", [])
              }}
              disabled={!activeLayer}
            >
              Focus Area
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => openSelectionOperation("expand")}
            >
              Expand...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => openSelectionOperation("contract")}
            >
              Contract...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => openSelectionOperation("similar")}
            >
              Similar…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Modify</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => openSelectionOperation("feather")}
                >
                  Feather… <DropdownMenuShortcut>⇧F6</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => openSelectionOperation("border")}
                >
                  Border…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => openSelectionOperation("smooth")}
                >
                  Smooth…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                if (!activeDoc?.selection.bounds) return
                const id = `ch_${Math.random().toString(36).slice(2, 9)}`
                const c = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
                if (!c) return
                dispatch({ type: "save-selection", channel: { id, name: `Alpha ${(activeDoc.channels?.length ?? 0) + 1}`, canvas: c } })
                commit("Save Selection", [])
              }}
            >
              Save Selection…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Load Selection</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(activeDoc?.channels ?? []).map((ch) => (
                  <DropdownMenuItem
                    key={ch.id}
                    onSelect={() => {
                      dispatch({ type: "load-selection", channelId: ch.id })
                    }}
                  >
                    {ch.name}
                  </DropdownMenuItem>
                ))}
                {!(activeDoc?.channels?.length) && (
                  <DropdownMenuItem disabled>No saved channels</DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Filter</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem
              onSelect={() => lastFilter && openFilterDialog(lastFilter)}
            >
              Last Filter
              {lastFilter ? `: ${FILTERS[lastFilter]?.name}` : ""}
              <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFilterGalleryOpen(true)} disabled={!activeLayer}>
              Filter Gallery…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCameraRawOpen(true)} disabled={!activeLayer}>
              Camera Raw Filter...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openFilterDialog("sky-replacement")} disabled={!activeLayer}>
              Sky Replacement...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLiquifyOpen(true)} disabled={!activeLayer}>
              Liquify… <DropdownMenuShortcut>⌘⇧X</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPuppetWarpOpen(true)} disabled={!activeLayer}>
              Puppet Warp…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Blur</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => openFilterDialog("gaussian-blur")}>
                  Gaussian Blur…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => applyInstant("average-blur")}>
                  Average
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => applyInstant("blur-more")}>
                  Blur More
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("box-blur")}>
                  Box Blur…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("smart-blur")}>
                  Smart Blur…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("shape-blur")}>
                  Shape Blur…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("motion-blur")}>
                  Motion Blur…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("lens-blur")}>
                  Lens Blur…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Sharpen</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => openFilterDialog("sharpen")}>
                  Sharpen…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("unsharp-mask")}>
                  Unsharp Mask…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("smart-sharpen")}>
                  Smart Sharpen…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Stylize</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => applyInstant("find-edges")}>
                  Find Edges
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("glowing-edges")}>
                  Glowing Edges…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("wind")}>
                  Wind…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("extrude")}>
                  Extrude…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("emboss")}>
                  Emboss…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("solarize")}>
                  Solarize…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Pixelate</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => openFilterDialog("pixelate")}>
                  Mosaic…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Noise</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => openFilterDialog("noise")}>
                  Add Noise…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("reduce-noise")}>
                  Reduce Noise…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("dust-scratches")}>
                  Dust & Scratches…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => applyInstant("despeckle")}>
                  Despeckle
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Artistic</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {["colored-pencil", "cutout", "dry-brush", "film-grain", "fresco", "neon-glow", "paint-daubs", "palette-knife", "plastic-wrap", "poster-edges", "rough-pastels", "smudge-stick", "sponge-filter", "underpainting", "watercolor"].map((id) => (
                  <DropdownMenuItem key={id} onSelect={() => openFilterDialog(id)}>{FILTERS[id]?.name ?? id}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Brush Strokes</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {["accented-edges", "angled-strokes", "crosshatch", "dark-strokes", "ink-outlines", "spatter", "sprayed-strokes", "sumi-e"].map((id) => (
                  <DropdownMenuItem key={id} onSelect={() => openFilterDialog(id)}>{FILTERS[id]?.name ?? id}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Sketch</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {["bas-relief", "chalk-charcoal", "charcoal", "chrome", "conte-crayon", "graphic-pen", "halftone-pattern", "note-paper", "photocopy", "plaster", "reticulation", "stamp-filter", "torn-edges", "water-paper"].map((id) => (
                  <DropdownMenuItem key={id} onSelect={() => openFilterDialog(id)}>{FILTERS[id]?.name ?? id}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Texture</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {["craquelure", "grain", "mosaic-tiles", "patchwork", "stained-glass", "texturizer"].map((id) => (
                  <DropdownMenuItem key={id} onSelect={() => openFilterDialog(id)}>{FILTERS[id]?.name ?? id}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Distort</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => openFilterDialog("adaptive-wide-angle")}>Adaptive Wide Angle...</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("vanishing-point")}>Vanishing Point...</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => openFilterDialog("displace")}>Displace…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("diffuse-glow")}>Diffuse Glow…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("ocean-ripple")}>Ocean Ripple…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("twirl")}>Twirl…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("pinch")}>Pinch…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("spherize")}>Spherize…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("wave")}>Wave…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("ripple")}>Ripple…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("zigzag")}>ZigZag…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("polar-coordinates")}>Polar Coordinates…</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Render</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => openFilterDialog("clouds")}>Clouds…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("difference-clouds")}>Difference Clouds…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("fibers")}>Fibers…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("lens-flare")}>Lens Flare…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("flame")}>Flame…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("picture-frame")}>Picture Frame…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("tree")}>Tree…</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Other</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => openFilterDialog("high-pass")}>High Pass…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("offset")}>Offset…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("maximum")}>Maximum…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("minimum")}>Minimum…</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Color</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => applyInstant("grayscale")}>
                  Grayscale
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openFilterDialog("sepia")}>
                  Sepia…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => applyInstant("invert")}>
                  Invert
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>View</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem
              onSelect={() => activeDoc && requestCanvasZoom({ factor: 2 })}
            >
              Zoom In <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => activeDoc && requestCanvasZoom({ factor: 0.5 })}
            >
              Zoom Out <DropdownMenuShortcut>⌘-</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => requestCanvasZoom({ zoom: 1 })}>
              100% <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => requestCanvasZoom({ zoom: 0.5 })}>
              Fit on Screen <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("preview")} disabled={!activeDoc}>
              Device Preview...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleStatusBar?.()} disabled={!onToggleStatusBar}>
              {statusBarVisible ? "Hide Info Bar" : "Show Info Bar"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => dispatch({ type: "toggle-grid" })}
            >
              {activeDoc?.showGrid ? "✓ " : ""}Show Grid <DropdownMenuShortcut>⌘'</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGridSettingsOpen(true)} disabled={!activeDoc}>
              Grid Settings…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "toggle-pixel-grid" })} disabled={!activeDoc}>
              {activeDoc?.showPixelGrid ? "✓ " : ""}Pixel Grid
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "toggle-snap" })}>
              {activeDoc?.snap ? "✓ " : ""}Snap
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "toggle-snap-grid" })}>
              {activeDoc?.snapToGrid ? "✓ " : ""}Snap to Grid
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => dispatch({ type: "toggle-snap-guides" })}>
              {activeDoc?.snapToGuides ? "✓ " : ""}Snap to Guides
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setNewGuideOpen(true)}
              disabled={!activeDoc}
            >
              New Guide…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGuideLayoutOpen(true)} disabled={!activeDoc}>
              New Guide Layout…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => dispatch({ type: "clear-guides" })}
            >
              Clear Guides
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setGapWorkflow("scripted-pattern")} disabled={!activeDoc}>
              Pattern Preview / Scripted Patterns...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleQuickMask}>
              {activeDoc?.quickMask ? "✓ " : ""}Edit in Quick Mask <DropdownMenuShortcut>Q</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 3D */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>3D</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem onSelect={() => openAdvancedTab("3d")} disabled={!activeDoc}>3D Workspace...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("3d")} disabled={!activeDoc}>New Mesh from Primitive...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("3d")} disabled={!activeDoc}>Import / Export OBJ or DAE...</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Video */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Video</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem onSelect={() => openAdvancedTab("video")} disabled={!activeDoc}>Video Timeline...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("video")} disabled={!activeDoc}>Import Video Layer...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("video")} disabled={!activeDoc}>Render Video...</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Plugins */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Plugins</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onSelect={() => openAdvancedTab("plugins")} disabled={!activeDoc}>Plugin Manager...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("libraries")} disabled={!activeDoc}>Creative Cloud Libraries...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("libraries")} disabled={!activeDoc}>Adobe Stock / Fonts...</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Window */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Window</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Workspace</DropdownMenuLabel>
            {WORKSPACE_PRESET_OPTIONS.map((preset) => (
              <DropdownMenuItem key={preset.id} onSelect={() => applyWorkspacePreset(preset.id)}>
                {preset.id === "essentials" ? `${preset.label} (Default)` : preset.label}
              </DropdownMenuItem>
            ))}
            {savedWorkspaces.length ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Saved Workspaces</DropdownMenuLabel>
                {savedWorkspaces.map((workspace) => (
                  <DropdownMenuItem
                    key={workspace.name}
                    onSelect={() =>
                      window.dispatchEvent(new CustomEvent("ps-apply-workspace", { detail: { name: workspace.name } }))
                    }
                  >
                    {workspace.name}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={saveCurrentWorkspace}>Save Current Workspace...</DropdownMenuItem>
            <DropdownMenuItem onSelect={deleteSavedWorkspace} disabled={!savedWorkspaces.length}>
              Delete Saved Workspace...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setWorkspaceManagerOpen(true)}>
              Workspace Manager...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyWorkspacePreset("essentials")}>
              Reset Essentials
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Panels</DropdownMenuLabel>
            {PANEL_CATEGORIES.map((category) => {
              const panels = PANEL_DEFINITIONS.filter((panel) => panel.category === category)
              return (
                <DropdownMenuSub key={category}>
                  <DropdownMenuSubTrigger>{category}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-60">
                    {panels.map((panel) => (
                      <DropdownMenuItem key={panel.id} onSelect={() => openPanel(panel.id)}>
                        {panel.label}
                        <DropdownMenuShortcut className="capitalize">{panel.complexity}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setLayerCompsOpen(true)}>
              Layer Comps...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorLabelsOpen(true)}>
              Color Labels...
            </DropdownMenuItem>
            {/*
            <DropdownMenuItem>✓ Layers</DropdownMenuItem>
            <DropdownMenuItem>✓ Color</DropdownMenuItem>
            <DropdownMenuItem>✓ Properties</DropdownMenuItem>
            <DropdownMenuItem>✓ History</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "selection-studio" }))}>Selection Studio</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "guides" }))}>Guides</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "adjustments" }))}>Adjustments</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "assets" }))}>Assets</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "libraries" }))}>Libraries</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "glyphs" }))}>Glyphs</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "styles" }))}>Styles</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "shapes" }))}>Shapes</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "tool-presets" }))}>Tool Presets</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "clone-source" }))}>Clone Source</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "timeline" }))}>Timeline</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "animation" }))}>Animation</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "comments" }))}>Comments</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "annotations" }))}>Annotations</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "notes" }))}>Notes</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "measurement-log" }))}>Measurement Log</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "slices" }))}>Slices</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "scripting" }))}>Scripting</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "learn" }))}>Learn</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "discover" }))}>Discover</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLayerCompsOpen(true)}>
              Layer Comps…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "layer-comps" }))}>
              Layer Comps Panel
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorLabelsOpen(true)}>
              Color Labels…
            </DropdownMenuItem>
            <DropdownMenuItem>✓ Channels</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => {
              window.dispatchEvent(new CustomEvent("ps-switch-panel", { detail: "paths" }))
            }}>Paths</DropdownMenuItem>
            */}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Help */}
        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Help</DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setAboutOpen(true)}>About Photoshop Web</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>Keyboard Shortcuts</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFileInfoOpen(true)} disabled={!activeDoc}>System Info…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </Menubar>
      </div>

      <FilterDialog filterId={openFilter} onClose={() => setOpenFilter(null)} />
      <ImageSizeDialog open={imageSizeOpen} onOpenChange={setImageSizeOpen} />
      <CanvasSizeDialog open={canvasSizeOpen} onOpenChange={setCanvasSizeOpen} />
      <StrokeDialog open={strokeOpen} onOpenChange={setStrokeOpen} />
      <ColorRangeDialog open={colorRangeOpen} onOpenChange={setColorRangeOpen} />
      <RefineEdgeDialog open={refineEdgeOpen} onOpenChange={setRefineEdgeOpen} />
      <LiquifyDialog open={liquifyOpen} onOpenChange={setLiquifyOpen} />
      <PuppetWarpDialog open={puppetWarpOpen} onOpenChange={setPuppetWarpOpen} />
      <LayerStyleDialog open={layerStyleOpen} onOpenChange={setLayerStyleOpen} />
      <WarpTextDialog open={warpTextOpen} onOpenChange={setWarpTextOpen} />
      <LayerCompsDialog open={layerCompsOpen} onOpenChange={setLayerCompsOpen} />
      <ColorLabelsDialog open={colorLabelsOpen} onOpenChange={setColorLabelsOpen} />
      <ExportAsDialog open={exportAsOpen} onOpenChange={setExportAsOpen} initial={exportAsInitial} />
      <BatchExportDialog open={batchExportOpen} onOpenChange={setBatchExportOpen} initial={batchExportInitial} />
      <BatchProcessingDialog open={batchProcessingOpen} onOpenChange={setBatchProcessingOpen} />
      <ImageProcessorDialog open={imageProcessorOpen} onOpenChange={setImageProcessorOpen} />
      <DocumentReportDialog open={documentReportOpen} onOpenChange={setDocumentReportOpen} />
      <PreflightDialog open={preflightOpen} onOpenChange={setPreflightOpen} />
      <GridSettingsDialog open={gridSettingsOpen} onOpenChange={setGridSettingsOpen} />
      <NewGuideDialog open={newGuideOpen} onOpenChange={setNewGuideOpen} />
      <GuideLayoutDialog open={guideLayoutOpen} onOpenChange={setGuideLayoutOpen} />
      <ContactSheetDialog open={contactSheetOpen} onOpenChange={setContactSheetOpen} />
      <FileInfoDialog open={fileInfoOpen} onOpenChange={setFileInfoOpen} />
      <AdvancedSubsystemsDialog open={advancedOpen} onOpenChange={setAdvancedOpen} initialTab={advancedTab} />
      <AlgorithmicOperationsDialog open={algorithmOpen} onOpenChange={setAlgorithmOpen} />
      <GapWorkflowDialog workflow={gapWorkflow} onOpenChange={(open) => !open && setGapWorkflow(null)} />
      <PreferencesDialog open={preferencesOpen} onOpenChange={setPreferencesOpen} />
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <FilterGalleryDialog open={filterGalleryOpen} onOpenChange={setFilterGalleryOpen} />
      <CameraRawDialog open={cameraRawOpen} onOpenChange={setCameraRawOpen} />
      <SelectAndMaskDialog open={selectMaskOpen} onOpenChange={setSelectMaskOpen} />
      <RecentDocumentsDialog
        open={recentManagerOpen}
        onOpenChange={setRecentManagerOpen}
        recents={recentDocuments}
        onOpenRecent={openRecent}
        onRemoveRecent={(id) => {
          removeRecentDocument(id)
          refreshRecents()
        }}
        onClearRecents={clearRecentDocuments}
      />
      <WorkspaceManagerDialog
        open={workspaceManagerOpen}
        onOpenChange={setWorkspaceManagerOpen}
        savedWorkspaces={savedWorkspaces}
        onRefresh={refreshWorkspaces}
      />
      <SelectionOperationDialog
        operation={selectionOperation}
        open={!!selectionOperation}
        onOpenChange={(open) => {
          if (!open) setSelectionOperation(null)
        }}
      />
    </>
  )
}
