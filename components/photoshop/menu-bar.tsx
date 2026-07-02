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
import { FILTER_META } from "./filters-meta"
import type { AdvancedSubsystemTab, ColorWorkflowMode } from "./advanced-subsystems-dialog"
import type { GapWorkflowKind } from "./gap-workflow-dialog"
import type { SelectionOperation } from "./management-dialogs"
import type { WorkflowPackId } from "./workflow-presets"
import { WORKFLOW_PACKS } from "./workflow-presets"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "./events"
import { DEFAULT_COLOR_MANAGEMENT } from "./menus/color-management-defaults"
import { MenuDialogs, type AutoAlgorithmId } from "./menus/menu-dialogs"
import { loadAdvancedCommands } from "./menus/advanced-command-service"
import { loadDocumentCommands } from "./menus/document-command-service"
import { FilterMenu } from "./menus/filter-menu"
import {
  FileMenu,
  LINKED_SMART_OBJECT_POLL_MS,
  MENU_TRIGGER_CLASS,
  cloneLayerStyle,
  pluginCommandUnavailable,
  smartLinkFingerprint,
  type OpenPickerWindow,
  type ReadableFileHandle,
  type SaveMode,
  type SavePickerWindow,
} from "./menus/file-menu"
import { loadImageCommands } from "./menus/image-command-service"
import { MediaWorkspaceMenus } from "./menus/media-workspace-menus"
import { SelectMenu } from "./menus/select-menu"
import { loadTypeCommands } from "./menus/type-command-service"
import { ViewMenu } from "./menus/view-menu"
import { readWorkspaceLibrary } from "./workspace-layouts"

import {
  PANEL_CATEGORIES,
  PANEL_DEFINITIONS,
  WORKSPACE_PRESET_OPTIONS,
  type WorkspacePresetId,
} from "./panel-registry"
import {
  createLargeDocumentInspectionDocument,
  describeLargeDocumentRecovery,
  planLargeDocumentOpen,
  type LargeDocumentOpenPlan,
} from "./large-document"
import {
  readRecentDocuments,
  rememberRecentDocument,
  removeRecentDocument,
  type RecentDocument,
} from "./recent-documents"
import { MAX_PROJECT_FILE_BYTES, assertFileSize } from "./canvas-limits"
import type { AdjustmentType, ColorManagementSettings, DocumentModeSettings, Layer, PluginCommandDescriptor, PluginDescriptor, TextAntiAliasMode } from "./types"
import { createAdjustmentLayer as createAdjustmentLayerModel, isAdjustmentNoop } from "./adjustment-layers"
import { createSmartObjectSource, relinkSmartObjectToFile, syncLinkedSmartObjectSource } from "./smart-objects"
import { PURGE_COMMANDS, formatPurgeStatus, type PurgeTarget } from "./purge-commands"
import {
  revealSourceInBrowser,
  sourceInfoForSmartObject,
  type SourceFileHandleLike,
} from "./source-location"

const menuClass = MENU_TRIGGER_CLASS

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
    requestRender,
    foreground,
    background,
    selectedLayers,
    stepHistoryBy,
    createDocument,
    copySelection,
    pasteAsLayer,
    purgeCaches,
    clipboard: _clipboard,
    styleClipboard,
    closedDocuments,
    documentStatuses,
    documentHistoryVersions,
    duplicateDocument,
    requestCloseDocument,
    closeOtherDocuments,
    reopenClosedDocument,
    markDocumentSaved,
    setDocumentLifecycle: _setDocumentLifecycle,
  } = useEditor()
  const [openFilter, setOpenFilter] = React.useState<string | null>(null)
  const [lastFilter, setLastFilter] = React.useState<string | null>(null)
  const [imageSizeOpen, setImageSizeOpen] = React.useState(false)
  const [canvasSizeOpen, setCanvasSizeOpen] = React.useState(false)
  const [strokeOpen, setStrokeOpen] = React.useState(false)
  const [flattenTransparencyOpen, setFlattenTransparencyOpen] = React.useState(false)
  const [colorRangeOpen, setColorRangeOpen] = React.useState(false)
  const [refineEdgeOpen, setRefineEdgeOpen] = React.useState(false)
  const [liquifyOpen, setLiquifyOpen] = React.useState(false)
  const [puppetWarpOpen, setPuppetWarpOpen] = React.useState(false)
  const [layerStyleOpen, setLayerStyleOpen] = React.useState(false)
  const [warpTextOpen, setWarpTextOpen] = React.useState(false)
  const [layerCompsOpen, setLayerCompsOpen] = React.useState(false)
  const [colorLabelsOpen, setColorLabelsOpen] = React.useState(false)
  const [fitImageOpen, setFitImageOpen] = React.useState(false)
  const [exportAsOpen, setExportAsOpen] = React.useState(false)
  const [exportAsInitial, setExportAsInitial] = React.useState<unknown>(undefined)
  const [batchExportOpen, setBatchExportOpen] = React.useState(false)
  const [batchExportInitial, setBatchExportInitial] = React.useState<unknown>(undefined)
  const [batchProcessingOpen, setBatchProcessingOpen] = React.useState(false)
  const [imageProcessorOpen, setImageProcessorOpen] = React.useState(false)
  const [imageProcessorInitial, setImageProcessorInitial] = React.useState<unknown>(undefined)
  const [cropAndStraightenOpen, setCropAndStraightenOpen] = React.useState(false)
  const [pdfImportOpen, setPdfImportOpen] = React.useState(false)
  const [documentReportOpen, setDocumentReportOpen] = React.useState(false)
  const [preflightOpen, setPreflightOpen] = React.useState(false)
  const [filterGalleryOpen, setFilterGalleryOpen] = React.useState(false)
  const [cameraRawOpen, setCameraRawOpen] = React.useState(false)
  const [selectMaskOpen, setSelectMaskOpen] = React.useState(false)
  const [gridSettingsOpen, setGridSettingsOpen] = React.useState(false)
  const [newGuideOpen, setNewGuideOpen] = React.useState(false)
  const [guideLayoutOpen, setGuideLayoutOpen] = React.useState(false)
  const [contactSheetOpen, setContactSheetOpen] = React.useState(false)
  const [photomergeOpen, setPhotomergeOpen] = React.useState(false)
  const [fileInfoOpen, setFileInfoOpen] = React.useState(false)
  const [revealSourceOpen, setRevealSourceOpen] = React.useState(false)
  const [revealSourceDocId, setRevealSourceDocId] = React.useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [advancedTab, setAdvancedTab] = React.useState<AdvancedSubsystemTab>("3d")
  const [advancedColorWorkflow, setAdvancedColorWorkflow] = React.useState<ColorWorkflowMode>("assign")
  const [algorithmOpen, setAlgorithmOpen] = React.useState(false)
  const [gapWorkflow, setGapWorkflow] = React.useState<GapWorkflowKind | null>(null)
  const [workflowPack, setWorkflowPack] = React.useState<WorkflowPackId | null>(null)
  const [colorModeTarget, setColorModeTarget] = React.useState<import("./color-mode-dialog").ColorModeDialogTarget | null>(null)
  const [preferencesOpen, setPreferencesOpen] = React.useState(false)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const [menuCustomizationOpen, setMenuCustomizationOpen] = React.useState(false)
  const [presetManagerOpen, setPresetManagerOpen] = React.useState(false)
  const [aboutOpen, setAboutOpen] = React.useState(false)
  const [recentManagerOpen, setRecentManagerOpen] = React.useState(false)
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = React.useState(false)
  const [selectionOperation, setSelectionOperation] = React.useState<SelectionOperation | null>(null)
  const [saveSelectionOpen, setSaveSelectionOpen] = React.useState(false)
  const [loadSelectionOpen, setLoadSelectionOpen] = React.useState(false)
  const [shadowsHighlightsOpen, setShadowsHighlightsOpen] = React.useState(false)
  const [hdrToningOpen, setHdrToningOpen] = React.useState(false)
  const [matchColorOpen, setMatchColorOpen] = React.useState(false)
  const [replaceColorOpen, setReplaceColorOpen] = React.useState(false)
  const [equalizePromptOpen, setEqualizePromptOpen] = React.useState(false)
  const [autoOptions, setAutoOptions] = React.useState<{ algorithm: AutoAlgorithmId; label: string } | null>(null)
  const [savedWorkspaces, setSavedWorkspaces] = React.useState<{ name: string; savedAt?: number }[]>([])
  const [recentDocuments, setRecentDocuments] = React.useState<RecentDocument[]>([])
  const [largeDocumentRecovery, setLargeDocumentRecovery] = React.useState<{
    file: File
    picked?: { handle?: ReadableFileHandle; permission?: PermissionState | "unsupported" }
    plan: LargeDocumentOpenPlan
    source: "open" | "place"
    reason: string
  } | null>(null)
  const [largeDocumentRecoveryBusy, setLargeDocumentRecoveryBusy] = React.useState(false)

  const refreshWorkspaces = React.useCallback(() => {
    setSavedWorkspaces(readWorkspaceLibrary().map(({ name, savedAt }) => ({ name, savedAt })))
  }, [])

  React.useEffect(() => {
    refreshWorkspaces()
    return addPhotoshopEventListener("ps-workspaces-changed", refreshWorkspaces)
  }, [refreshWorkspaces])

  const refreshRecents = React.useCallback(() => {
    setRecentDocuments(readRecentDocuments())
  }, [])

  React.useEffect(() => {
    refreshRecents()
    return addPhotoshopEventListener("ps-recents-changed", refreshRecents)
  }, [refreshRecents])

  const rememberDoc = React.useCallback((doc: NonNullable<typeof activeDoc>, kind: RecentDocument["kind"]) => {
    void loadDocumentCommands().then(({ generateDocumentThumbnail, serializeProject }) => {
      try {
        rememberRecentDocument({ name: doc.name, kind, serialized: serializeProject(doc), thumbnail: generateDocumentThumbnail(doc) })
        refreshRecents()
      } catch {}
    })
  }, [refreshRecents])

  const openRecent = async (recent: RecentDocument) => {
    try {
      const { createDocumentReport, deserializeProject } = await loadDocumentCommands()
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
    const handler = (id: string) => {
      if (typeof id === "string") {
        setOpenFilter(id)
        setLastFilter(id)
      }
    }
    return addPhotoshopEventListener("ps-open-filter", handler)
  }, [])

  // Reselect via Cmd+Shift+D
  React.useEffect(() => {
    const handler = () => {
      if (lastSelectionRef.current) {
        dispatch({ type: "set-selection", selection: lastSelectionRef.current })
      }
    }
    return addPhotoshopEventListener("ps-reselect", handler)
  }, [dispatch])

  // Open warp text dialog from options bar / shortcuts
  React.useEffect(() => {
    const handler = () => setWarpTextOpen(true)
    return addPhotoshopEventListener("ps-open-warp-text", handler)
  }, [])

  React.useEffect(() => {
    const galleryHandler = () => setFilterGalleryOpen(true)
    const cameraRawHandler = () => setCameraRawOpen(true)
    const preferencesHandler = () => setPreferencesOpen(true)
    const shortcutsHandler = () => setShortcutsOpen(true)
    const exportAsHandler = (detail: unknown) => {
      setExportAsInitial(detail)
      setExportAsOpen(true)
    }
    const batchExportHandler = (detail: unknown) => {
      setBatchExportInitial(detail)
      setBatchExportOpen(true)
    }
    const batchProcessingHandler = () => setBatchProcessingOpen(true)
    const imageProcessorHandler = (detail: unknown) => {
      setImageProcessorInitial(detail)
      setImageProcessorOpen(true)
    }
    const reportHandler = () => setDocumentReportOpen(true)
    const preflightHandler = () => setPreflightOpen(true)
    const layerCompsHandler = () => setLayerCompsOpen(true)
    const selectMaskHandler = () => setSelectMaskOpen(true)
    const recentManagerHandler = () => setRecentManagerOpen(true)
    const workspaceManagerHandler = () => setWorkspaceManagerOpen(true)
    const fileInfoHandler = () => setFileInfoOpen(true)
    const algorithmHandler = () => setAlgorithmOpen(true)
    const advancedHandler = (tab: AdvancedSubsystemTab, colorWorkflow: ColorWorkflowMode = "assign") => {
      if (tab === "color") setAdvancedColorWorkflow(colorWorkflow)
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
    const colorWorkflowHandler = (detail?: unknown) => {
      const mode = (detail as { mode?: ColorWorkflowMode } | undefined)?.mode
      advancedHandler("color", mode ?? "assign")
    }
    const colorModeHandler = (detail: import("./color-mode-dialog").ColorModeDialogTarget | undefined) => {
      if (detail) setColorModeTarget(detail)
    }
    const formatsHandler = () => advancedHandler("formats")
    const variablesHandler = () => advancedHandler("variables")
    const photomergeHandler = () => setPhotomergeOpen(true)
    const gapWorkflowHandler = (detail: string | { id?: string; mode?: string } | undefined) => {
      if (detail === "photomerge") {
        setPhotomergeOpen(true)
        return
      }
      if (typeof detail === "string") setGapWorkflow(detail as GapWorkflowKind)
    }
    const workflowPackHandler = (detail: { id?: WorkflowPackId } | WorkflowPackId) => {
      const id = typeof detail === "string" ? detail : detail?.id
      if (id && WORKFLOW_PACKS.some((pack) => pack.id === id)) setWorkflowPack(id)
    }
    const selectionOperationHandler = (detail: string) => {
      const operation = detail as SelectionOperation
      if (operation) setSelectionOperation(operation)
    }
    const removers = [
      addPhotoshopEventListener("ps-open-filter-gallery", galleryHandler),
      addPhotoshopEventListener("ps-open-camera-raw", cameraRawHandler),
      addPhotoshopEventListener("ps-open-preferences", preferencesHandler),
      addPhotoshopEventListener("ps-open-shortcuts", shortcutsHandler),
      addPhotoshopEventListener("ps-open-export-as", exportAsHandler),
      addPhotoshopEventListener("ps-open-batch-export", batchExportHandler),
      addPhotoshopEventListener("ps-open-batch-processing", batchProcessingHandler),
      addPhotoshopEventListener("ps-open-image-processor", imageProcessorHandler),
      addPhotoshopEventListener("ps-open-document-report", reportHandler),
      addPhotoshopEventListener("ps-open-preflight", preflightHandler),
      addPhotoshopEventListener("ps-open-layer-comps", layerCompsHandler),
      addPhotoshopEventListener("ps-open-select-and-mask", selectMaskHandler),
      addPhotoshopEventListener("ps-open-recent-documents", recentManagerHandler),
      addPhotoshopEventListener("ps-open-workspace-manager", workspaceManagerHandler),
      addPhotoshopEventListener("ps-open-file-info", fileInfoHandler),
      addPhotoshopEventListener("ps-open-algorithmic-operations", algorithmHandler),
      addPhotoshopEventListener("ps-open-3d-workspace", threeDHandler),
      addPhotoshopEventListener("ps-open-video-render", videoHandler),
      addPhotoshopEventListener("ps-open-print-workflow", printHandler),
      addPhotoshopEventListener("ps-open-device-preview", previewHandler),
      addPhotoshopEventListener("ps-open-automation-workflow", automationHandler),
      addPhotoshopEventListener("ps-open-provenance", provenanceHandler),
      addPhotoshopEventListener("ps-open-plugin-manager", pluginsHandler),
      addPhotoshopEventListener("ps-open-cloud-libraries", librariesHandler),
      addPhotoshopEventListener("ps-open-color-management-workflow", colorWorkflowHandler),
      addPhotoshopEventListener("ps-open-color-mode", (detail) => colorModeHandler(detail as import("./color-mode-dialog").ColorModeDialogTarget | undefined)),
      addPhotoshopEventListener("ps-open-format-metadata", formatsHandler),
      addPhotoshopEventListener("ps-open-variables", variablesHandler),
      addPhotoshopEventListener("ps-open-photomerge", photomergeHandler),
      addPhotoshopEventListener("ps-open-gap-workflow", gapWorkflowHandler),
      addPhotoshopEventListener("ps-open-workflow-pack", (detail) => workflowPackHandler(detail as { id?: WorkflowPackId } | WorkflowPackId)),
      addPhotoshopEventListener("ps-open-selection-operation", selectionOperationHandler),
    ]
    return () => {
      removers.forEach((remove) => remove())
    }
  }, [])

  // Clear slices/ruler from options bar
  React.useEffect(() => {
    const sliceHandler = () => dispatch({ type: "clear-slices" })
    const rulerHandler = () => dispatch({ type: "set-measurement", m: null })
    const removeSlices = addPhotoshopEventListener("ps-clear-slices", sliceHandler)
    const removeRuler = addPhotoshopEventListener("ps-clear-ruler", rulerHandler)
    return () => {
      removeSlices()
      removeRuler()
    }
  }, [dispatch])

  const undo = () => stepHistoryBy(-1)
  const redo = () => stepHistoryBy(1)
  const [pendingPurge, setPendingPurge] = React.useState<PurgeTarget | null>(null)
  const executePurge = React.useCallback((target: PurgeTarget) => {
    const result = purgeCaches(target)
    toast.info(formatPurgeStatus(target, result.freedBytes))
  }, [purgeCaches])
  const runPurge = React.useCallback((target: PurgeTarget) => {
    // Clipboard purge is non-destructive (no history loss) — skip confirmation.
    if (target === "clipboard") {
      executePurge(target)
      return
    }
    setPendingPurge(target)
  }, [executePurge])
  React.useEffect(() => {
    const handler = (detail: { target: PurgeTarget }) => {
      if (detail?.target) runPurge(detail.target)
    }
    return addPhotoshopEventListener("ps-purge-request", handler)
  }, [runPurge])
  const pendingPurgeCommand = pendingPurge ? PURGE_COMMANDS.find((c) => c.target === pendingPurge) : null
  const openAdvancedTab = (tab: AdvancedSubsystemTab, colorWorkflow: ColorWorkflowMode = "assign") => {
    if (tab === "color") setAdvancedColorWorkflow(colorWorkflow)
    setAdvancedTab(tab)
    setAdvancedOpen(true)
  }
  const colorSettings: ColorManagementSettings = {
    ...DEFAULT_COLOR_MANAGEMENT,
    ...(activeDoc?.colorManagement ?? {}),
  }
  const updateColorManagement = (patch: Partial<ColorManagementSettings>, label: string) => {
    if (!activeDoc) return
    dispatch({ type: "set-color-management", settings: { ...colorSettings, ...patch } })
    requestRender()
    window.setTimeout(() => commit(label, "all"), 0)
  }
  const openColorWorkflow = (mode: ColorWorkflowMode = "assign") => {
    openAdvancedTab("color", mode)
  }
  const toggleProofChannel = (channel: NonNullable<ColorManagementSettings["proofChannels"]>[number]) => {
    const channels = colorSettings.proofChannels ?? []
    const next = channels.includes(channel)
      ? channels.filter((item) => item !== channel)
      : [...channels, channel]
    updateColorManagement({ proofChannels: next }, `Proof Channels: ${next.length ? next.join(", ") : "Composite"}`)
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

  const flattenAllLayerEffects = () => {
    if (!activeDoc) {
      toast.info("Open a document before flattening layer effects.")
      return
    }
    dispatch({ type: "flatten-all-layer-effects" })
    requestRender()
    setTimeout(() => commit("Flatten All Layer Effects", "all"), 0)
  }

  const flattenAllMasks = () => {
    if (!activeDoc) {
      toast.info("Open a document before flattening masks.")
      return
    }
    dispatch({ type: "flatten-all-masks" })
    requestRender()
    setTimeout(() => commit("Flatten All Masks", "all"), 0)
  }

  const deleteAllEmptyLayers = () => {
    if (!activeDoc) {
      toast.info("Open a document before deleting empty layers.")
      return
    }
    dispatch({ type: "delete-empty-layers" })
    requestRender()
    setTimeout(() => commit("Delete All Empty Layers", "all"), 0)
  }

  const rasterizeLayers = (option: "layer" | "type" | "shape" | "smart-object" | "layer-style" | "video" | "3d" | "all") => {
    if (!activeDoc) {
      toast.info("Open a document before rasterizing layers.")
      return
    }
    if (option !== "all" && !selectedLayers.length) {
      toast.info("Select at least one layer before rasterizing.")
      return
    }
    dispatch({ type: "rasterize-layers", option, ids: option === "all" ? undefined : selectedLayers.map((layer) => layer.id) })
    requestRender()
    const label = option === "all"
      ? "Rasterize All Layers"
      : option === "type"
        ? "Rasterize Type"
        : option === "shape"
          ? "Rasterize Shape"
          : option === "smart-object"
            ? "Rasterize Smart Object"
            : option === "layer-style"
              ? "Rasterize Layer Style"
              : option === "video"
                ? "Rasterize Video"
                : option === "3d"
                  ? "Rasterize 3D"
                  : "Rasterize Layer"
    setTimeout(() => commit(label, option === "all" ? "all" : selectedLayers.map((layer) => layer.id)), 0)
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
    dispatch({
      type: "set-smart-object-edit-package",
      id: activeLayer.id,
      editPackage: {
        id: activeLayer.smartSource?.editPackage?.id ?? `pkg_${Math.random().toString(36).slice(2, 9)}`,
        name: activeLayer.smartSource?.name ?? `${activeLayer.name} Contents`,
        version: (activeLayer.smartSource?.editPackage?.version ?? 0) + 1,
        createdAt: activeLayer.smartSource?.editPackage?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        layerCount: 1,
        sourceHash: activeLayer.smartSource?.sourceHash,
      },
    })
    editSmartObject(activeLayer)
  }

  const updateSmartObjectParentFromMenu = () => {
    if (!activeDoc?.smartObjectParent) {
      toast.info("Open a smart object contents document before updating its parent.")
      return
    }
    updateSmartObjectParent()
  }

  const requestReadPermission = async (handle?: ReadableFileHandle): Promise<PermissionState | "unsupported"> => {
    if (!handle?.queryPermission && !handle?.requestPermission) return "unsupported"
    try {
      const current = await handle.queryPermission?.({ mode: "read" })
      if (current === "granted") return current
      return (await handle.requestPermission?.({ mode: "read" })) ?? current ?? "unsupported"
    } catch {
      return "unsupported"
    }
  }

  const pickLocalFile = async (
    accept: string,
    types: Array<{ description: string; accept: Record<string, string[]> }>,
  ): Promise<{ file: File; handle?: ReadableFileHandle; permission: PermissionState | "unsupported" }> => {
    const picker = (window as OpenPickerWindow).showOpenFilePicker
    if (picker) {
      const [handle] = await picker({ multiple: false, types })
      if (!handle) throw new Error("No file selected")
      const permission = await requestReadPermission(handle)
      return { file: await handle.getFile(), handle, permission }
    }

    return new Promise((resolve, reject) => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = accept
      input.onchange = () => {
        const file = input.files?.[0]
        if (file) resolve({ file, permission: "unsupported" })
        else reject(new Error("No file selected"))
      }
      input.addEventListener("cancel", () => reject(new Error("No file selected")), { once: true })
      input.click()
    })
  }

  const fileHash = async (file: File) => {
    if (!crypto?.subtle) return undefined
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
      return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("")
    } catch {
      return undefined
    }
  }

  const canvasFromImageFile = async (file: File) => {
    const { loadRasterCanvasFromFile } = await loadDocumentCommands()
    return (await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })).canvas
  }

  const linkedSmartObjectPollRef = React.useRef({ documents, dispatch, requestRender })
  linkedSmartObjectPollRef.current = { documents, dispatch, requestRender }
  const linkedSmartObjectNoticesRef = React.useRef(new Map<string, string>())

  React.useEffect(() => {
    let cancelled = false

    const pollLinkedSmartObjects = async () => {
      const current = linkedSmartObjectPollRef.current
      for (const doc of current.documents) {
        for (const layer of doc.layers) {
          const source = layer.smartSource
          if ((!layer.smartObject && layer.kind !== "smart-object") || source?.linkType !== "linked") continue
          if (!source.fileHandle && !source.fileHandleName) continue
          const before = smartLinkFingerprint(source)
          const result = await syncLinkedSmartObjectSource(layer, { requestPermission: false })
          if (cancelled) return
          const nextSource = result.layer.smartSource
          const after = smartLinkFingerprint(nextSource)
          if (before === after) continue
          current.dispatch({
            type: "apply-linked-smart-object-sync",
            docId: doc.id,
            id: layer.id,
            source: nextSource ?? { status: result.status },
          })
          current.requestRender({ layerIds: [layer.id], reason: "linked-smart-object-poll" })

          const noticeKey = `${doc.id}:${layer.id}`
          const noticeFingerprint = `${after}:${result.status}`
          if (linkedSmartObjectNoticesRef.current.get(noticeKey) === noticeFingerprint) continue
          linkedSmartObjectNoticesRef.current.set(noticeKey, noticeFingerprint)
          if (result.status === "modified") {
            toast.info(`${layer.name} changed on disk. Use Update Linked Smart Object to refresh it.`)
          } else if (result.status === "missing") {
            const permission = nextSource?.handlePermission
            toast.warning(
              permission === "prompt" || permission === "denied"
                ? `${layer.name} needs file permission. Use Relink to File to reconnect it.`
                : `${layer.name} linked file is unavailable. Use Relink to File to reconnect it.`,
            )
          }
        }
      }
    }

    const startup = window.setTimeout(() => { void pollLinkedSmartObjects() }, 1_500)
    const timer = window.setInterval(() => { void pollLinkedSmartObjects() }, LINKED_SMART_OBJECT_POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(startup)
      window.clearInterval(timer)
    }
  }, [])

  const buildLargeDocumentRecovery = async (
    file: File,
    source: "open" | "place",
    error: unknown,
    picked?: { handle?: ReadableFileHandle; permission?: PermissionState | "unsupported" },
  ) => {
    const { inspectImportFileDimensions, inspectPsdRecoveryFile } = await loadDocumentCommands()
    const dimensions = await inspectImportFileDimensions(file).catch(() => null)
    if (!dimensions) return false
    const parsedPsd = dimensions.kind === "psd" || dimensions.kind === "psb"
      ? await inspectPsdRecoveryFile(file).catch(() => null)
      : null
    const reason = error instanceof Error ? error.message : "The document exceeds browser limits."
    const plan = planLargeDocumentOpen({
      fileName: file.name,
      kind: parsedPsd?.kind ?? dimensions.kind,
      width: parsedPsd?.width ?? dimensions.width,
      height: parsedPsd?.height ?? dimensions.height,
      layerCount: parsedPsd?.parsedStructure.layerCount ?? 1,
      tileable: dimensions.kind === "psb",
      parsedStructure: parsedPsd?.parsedStructure,
    })
    setLargeDocumentRecovery({ file, picked, plan, source, reason })
    toast.info(describeLargeDocumentRecovery(plan))
    return true
  }

  const preflightLargeDocumentImport = async (
    file: File,
    source: "open" | "place",
    picked?: { handle?: ReadableFileHandle; permission?: PermissionState | "unsupported" },
  ) => {
    const { inspectImportFileDimensions, inspectPsdRecoveryFile } = await loadDocumentCommands()
    const dimensions = await inspectImportFileDimensions(file).catch(() => null)
    if (!dimensions) return false
    const parsedPsd = dimensions.kind === "psd" || dimensions.kind === "psb"
      ? await inspectPsdRecoveryFile(file).catch(() => null)
      : null
    const plan = planLargeDocumentOpen({
      fileName: file.name,
      kind: parsedPsd?.kind ?? dimensions.kind,
      width: parsedPsd?.width ?? dimensions.width,
      height: parsedPsd?.height ?? dimensions.height,
      layerCount: parsedPsd?.parsedStructure.layerCount ?? 1,
      tileable: (parsedPsd?.kind ?? dimensions.kind) === "psb",
      parsedStructure: parsedPsd?.parsedStructure,
    })
    if (plan.defaultMode === "full" && plan.fitsBrowserCanvas) return false
    setLargeDocumentRecovery({
      file,
      picked,
      plan,
      source,
      reason: "Advanced import wizard opened from header preflight before heavy decoder work.",
    })
    toast.info("Advanced import wizard opened before decoding the oversized file.")
    return true
  }

  const lifecycleForPickedFile = React.useCallback((
    file: File,
    picked: { handle?: ReadableFileHandle } | undefined,
    fileKind: DocumentLifecycleState["fileKind"],
  ): Partial<DocumentLifecycleState> => ({
    storage: picked?.handle ? "file-system-access" : "opened-file",
    fileKind,
    fileName: picked?.handle?.name ?? file.name,
    fileHandle: picked?.handle,
    lastSaveNote: picked?.handle
      ? "Opened from a reusable browser file handle. Reveal Source can browse from this handle while permission remains available."
      : "Opened from a browser file input. The browser did not provide a reusable local file handle.",
  }), [])

  const openRasterCanvasAsDocument = React.useCallback((
    file: File,
    raster: Awaited<ReturnType<typeof import("./document-io").loadRasterCanvasFromFile>>,
    picked?: { handle?: ReadableFileHandle },
  ) => {
    const doc = makeDocument(file.name, raster.canvas.width, raster.canvas.height)
    doc.layers[0].canvas.getContext("2d")!.drawImage(raster.canvas, 0, 0)
    doc.metadata = {
      ...(doc.metadata ?? {}),
      title: file.name,
      source: file.name,
      createdAt: new Date().toISOString(),
    }
    if (raster.mode === "reduced-scale") {
      doc.name = file.name.replace(/\.[^.]+$/, " (Reduced)")
      doc.metadata = {
        ...(doc.metadata ?? {}),
        title: file.name,
        source: file.name,
        description: `Opened at ${(raster.scale * 100).toFixed(1)}% scale from ${raster.originalWidth} x ${raster.originalHeight}px.`,
      }
    }
    createDocument(doc, raster.mode === "reduced-scale" ? "Open Reduced Image" : "Open", lifecycleForPickedFile(file, picked, "image"))
    rememberDoc(doc, "image")
  }, [createDocument, lifecycleForPickedFile, rememberDoc])

  const placeRasterCanvas = React.useCallback(async (
    file: File,
    sourceCanvas: HTMLCanvasElement,
    label = "Place Embedded",
    picked?: { handle?: ReadableFileHandle; permission?: PermissionState | "unsupported" },
  ) => {
    if (!activeDoc) return
    const canvas = makeCanvas(activeDoc.width, activeDoc.height)
    const ctx = canvas.getContext("2d")!
    const maxW = activeDoc.width * 0.9
    const maxH = activeDoc.height * 0.9
    const scale = Math.min(1, maxW / sourceCanvas.width, maxH / sourceCanvas.height)
    const w = Math.max(1, sourceCanvas.width * scale)
    const h = Math.max(1, sourceCanvas.height * scale)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(sourceCanvas, (activeDoc.width - w) / 2, (activeDoc.height - h) / 2, w, h)
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
      smartSource: createSmartObjectSource(sourceCanvas, {
        name: file.name,
        fileName: file.name,
        linkType: "embedded",
        status: "embedded",
        embedded: true,
        fileHandle: picked?.handle,
        fileHandleName: picked?.handle?.name,
        handlePermission: picked?.permission,
        lastKnownModified: file.lastModified,
        lastKnownSize: file.size,
        sourceHash: await fileHash(file),
      }),
    }
    dispatch({ type: "add-layer", layer })
    setTimeout(() => commit(label, [layer.id]), 0)
  }, [activeDoc, commit, dispatch])

  const pickSmartObjectImage = async (): Promise<{ file: File; handle?: ReadableFileHandle; permission: PermissionState | "unsupported" }> => {
    return pickLocalFile("image/*", [
      { description: "Images", accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"] } },
    ])
  }

  const replaceSmartObjectFromFile = async (linkType: "embedded" | "linked") => {
    const layer = activeLayer
    if (!layer || (!layer.smartObject && layer.kind !== "smart-object")) {
      toast.info("Select a smart object layer first.")
      return
    }
    try {
      const picked = await pickSmartObjectImage()
      if (linkType === "linked" && picked.handle) {
        const relinked = await relinkSmartObjectToFile(layer, picked.handle, {
          hashContents: true,
          readCanvas: canvasFromImageFile,
          relativePath: picked.file.name,
        })
        if (relinked.status !== "current" || !relinked.layer.smartSource?.canvas) {
          dispatch({
            type: "set-layer-smart-link",
            id: layer.id,
            source: relinked.layer.smartSource ?? {
              fileName: picked.file.name,
              fileHandleName: picked.handle.name ?? picked.file.name,
              handlePermission: relinked.permission,
              status: "missing",
            },
          })
          toast.warning("Smart object link needs file permission before contents can be read.")
          return
        }
        dispatch({
          type: "replace-smart-object-contents",
          id: layer.id,
          canvas: relinked.layer.smartSource.canvas,
          source: relinked.layer.smartSource,
        })
        requestRender()
        window.setTimeout(() => commit("Relink Smart Object", [layer.id]), 0)
        return
      }
      const sourceCanvas = await canvasFromImageFile(picked.file)
      dispatch({
        type: "replace-smart-object-contents",
        id: layer.id,
        canvas: sourceCanvas,
        source: {
          ...(layer.smartSource ?? {}),
          fileName: picked.file.name,
          relativePath: picked.file.name,
          linkType,
          embedded: linkType === "embedded",
          status: linkType === "embedded" ? "embedded" : "current",
          fileHandle: picked.handle,
          fileHandleName: picked.handle?.name ?? picked.file.name,
          handlePermission: picked.permission,
          lastKnownModified: picked.file.lastModified,
          lastKnownSize: picked.file.size,
          sourceHash: await fileHash(picked.file),
          relinkedAt: linkType === "linked" ? Date.now() : layer.smartSource?.relinkedAt,
          updatedAt: Date.now(),
        },
      })
      requestRender()
      window.setTimeout(() => commit(linkType === "linked" ? "Relink Smart Object" : "Replace Smart Object Contents", [layer.id]), 0)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      toast.error(err instanceof Error ? err.message : "Could not replace smart object contents")
    }
  }

  const updateLinkedSmartObjectFromMenu = async () => {
    const layer = activeLayer
    const handle = layer?.smartSource?.fileHandle as ReadableFileHandle | undefined
    if (!layer || (!layer.smartObject && layer.kind !== "smart-object")) {
      toast.info("Select a linked smart object layer first.")
      return
    }
    if (!handle?.getFile) {
      await replaceSmartObjectFromFile("linked")
      return
    }
    try {
      const result = await syncLinkedSmartObjectSource(layer, {
        hashContents: true,
        readCanvas: canvasFromImageFile,
        requestPermission: true,
      })
      if (result.status !== "current" || !result.layer.smartSource?.canvas) {
        dispatch({
          type: "set-layer-smart-link",
          id: layer.id,
          source: result.layer.smartSource ?? {
            fileHandleName: layer.smartSource?.fileHandleName,
            handlePermission: layer.smartSource?.handlePermission,
            status: "missing",
          },
        })
        toast.warning("Smart object link needs file permission before it can update.")
        return
      }
      if (!result.changed) {
        dispatch({
          type: "set-layer-smart-link",
          id: layer.id,
          source: result.layer.smartSource,
        })
        toast.info("Linked smart object is already current.")
        return
      }
      dispatch({
        type: "replace-smart-object-contents",
        id: layer.id,
        canvas: result.layer.smartSource.canvas,
        source: result.layer.smartSource,
      })
      requestRender()
      window.setTimeout(() => commit("Update Linked Smart Object", [layer.id]), 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update linked smart object")
    }
  }

  const exportSmartObjectContentsFromMenu = async () => {
    const layer = activeLayer
    if (!layer || (!layer.smartObject && layer.kind !== "smart-object")) {
      toast.info("Select a smart object layer first.")
      return
    }
    const sourceCanvas = layer.smartSource?.canvas ?? layer.canvas
    const blob = await new Promise<Blob | null>((resolve) => sourceCanvas.toBlob(resolve, "image/png"))
    if (!blob) {
      toast.error("Could not export smart object contents")
      return
    }
    const { downloadBlob } = await loadDocumentCommands()
    downloadBlob(blob, `${safeNameFor(layer.smartSource?.fileName ?? layer.smartSource?.name ?? layer.name)}.png`)
    dispatch({
      type: "replace-smart-object-contents",
      id: layer.id,
      canvas: sourceCanvas,
      source: {
        ...(layer.smartSource ?? {}),
        exportedAt: Date.now(),
        status: layer.smartSource?.status ?? (layer.smartSource?.linkType === "embedded" ? "embedded" : "current"),
      },
    })
    window.setTimeout(() => commit("Export Smart Object Contents", [layer.id]), 0)
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

  const flattenTransparency = (alphaMode: "clear" | "preserve", matte: string, label: string) => {
    if (!activeDoc) return
    const targetIds = selectedLayers.length
      ? selectedLayers.map((layer) => layer.id)
      : activeLayer
        ? [activeLayer.id]
        : []
    if (!targetIds.length) return
    dispatch({ type: "flatten-transparency", matte, alphaMode, layerIds: targetIds })
    setTimeout(() => commit(`Flatten Transparency - ${label}`, targetIds), 0)
    requestRender()
  }

  const fillContentAware = async () => {
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
    const { contentAwareFill, selectionToMaskCanvas } = await loadImageCommands()
    const mask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
    if (!mask) return
    const maskData = mask.getContext("2d")!.getImageData(0, 0, activeDoc.width, activeDoc.height)
    contentAwareFill(activeLayer.canvas, activeDoc.selection.bounds, maskData)
    commit("Content-Aware Fill", [activeLayer.id])
  }

  /** Apply a "no-param" filter immediately to all unlocked selected layers. */
  const applyInstant = async (filterId: string) => {
    if (!activeDoc) return
    const { FILTERS } = await import("./filters")
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
    const filter = FILTER_META[filterId]
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

  const revealSourceHandle = React.useCallback(async (handle: SourceFileHandleLike | undefined, unavailableReason?: string) => {
    if (!handle) {
      toast.info(unavailableReason ?? "No browser file handle is attached to this source.")
      setFileInfoOpen(true)
      return
    }

    const result = await revealSourceInBrowser(handle)
    if (result.status === "cancelled") return
    if (result.status === "folder-picker-verified" || result.status === "folder-picker-opened") {
      toast.success(result.message)
      return
    }
    if (result.status === "file-accessible") {
      toast.info(result.message)
      return
    }
    toast.error(result.message)
  }, [])

  const revealDocumentSourceFromMenu = React.useCallback(async () => {
    if (!activeDoc) {
      toast.info("Open a document before revealing its source.")
      return
    }
    setRevealSourceDocId(activeDoc.id)
    setRevealSourceOpen(true)
  }, [activeDoc])

  const openRevealSourceDialog = React.useCallback((docId: string | null) => {
    setRevealSourceDocId(docId)
    setRevealSourceOpen(true)
  }, [])

  const revealSmartObjectSourceFromMenu = React.useCallback(async () => {
    if (!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")) {
      toast.info("Select a smart object layer before revealing its source.")
      return
    }
    const info = sourceInfoForSmartObject(activeLayer)
    await revealSourceHandle(info.fileHandle, info.unavailableReason)
  }, [activeLayer, revealSourceHandle])

  React.useEffect(() => {
    const handler = (detail: { docId?: string } | undefined) => {
      const docId = detail?.docId ?? activeDoc?.id ?? null
      if (!docId) {
        toast.info("Open a document before revealing its source.")
        return
      }
      openRevealSourceDialog(docId)
    }
    return addPhotoshopEventListener("ps-reveal-source", handler)
  }, [openRevealSourceDialog, activeDoc?.id])

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
    if (!doc) return null
    const lifecycle = documentStatuses[doc.id]
    const { createDocumentReport, downloadText, serializeProject } = await loadDocumentCommands()
    const report = createDocumentReport(doc, "Project Export")
    const docWithReport = { ...doc, reports: [report, ...(doc.reports ?? [])].slice(0, 12) }
    const serialized = serializeProject(docWithReport, { pretty: false })
    const savedHistoryIndex = documentHistoryVersions[doc.id] ?? 0
    const fallbackName = `${safeNameFor(lifecycle?.fileName ?? doc.name)}.psprojson`
    let nextLifecycle: Partial<DocumentLifecycleState> = {
      fileKind: "project",
      fileName: fallbackName,
      savedHistoryIndex,
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
      return doc.id
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast.error(err instanceof Error ? err.message : "Could not save project")
      }
      return null
    }
  }, [activeDoc?.id, dispatch, documentHistoryVersions, documentStatuses, documents, markDocumentSaved, refreshRecents])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string; mode?: SaveMode }>).detail
      void saveProjectDocument(detail?.docId, detail?.mode ?? "save").then((savedId) => {
        dispatchPhotoshopEvent("ps-document-saved", { docId: savedId ?? detail?.docId, success: !!savedId })
      })
    }
    return addPhotoshopEventListener("ps-save-document", (_detail, event) => handler(event))
  }, [saveProjectDocument])

  const openImageOrPsd = () => {
    void (async () => {
      let picked: { file: File; handle?: ReadableFileHandle; permission: PermissionState | "unsupported" }
      try {
        picked = await pickLocalFile("image/*,.psd,.psb,image/vnd.adobe.photoshop,application/octet-stream", [
          {
            description: "Images and Photoshop Documents",
            accept: {
              "image/*": [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"],
              "image/vnd.adobe.photoshop": [".psd", ".psb"],
              "application/octet-stream": [".psd", ".psb"],
            },
          },
        ])
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (err instanceof Error && err.message === "No file selected") return
        toast.error(err instanceof Error ? err.message : "Could not open file")
        return
      }

      const file = picked.file
      try {
        const { createDocumentReport, deserializePsdFile, loadRasterCanvasFromFile } = await loadDocumentCommands()
        const photoshopFamily = /\.(?:psd|psb)$/i.test(file.name) || file.type === "image/vnd.adobe.photoshop"
        if (await preflightLargeDocumentImport(file, "open", picked)) return
        if (photoshopFamily) {
          const doc = await deserializePsdFile(file)
          const kind = /\.psb$/i.test(file.name) ? "PSB" : "PSD"
          doc.metadata = { ...(doc.metadata ?? {}), title: doc.metadata?.title ?? file.name, source: file.name }
          createDocument(doc, `Open ${kind}`, lifecycleForPickedFile(file, picked, "psd"))
          dispatch({ type: "add-document-report", report: createDocumentReport(doc, "PSD Import") })
          rememberDoc(doc, "psd")
          return
        }
        const raster = await loadRasterCanvasFromFile(file)
        openRasterCanvasAsDocument(file, raster, picked)
      } catch (err) {
        if (await buildLargeDocumentRecovery(file, "open", err, picked)) return
        toast.error(err instanceof Error ? err.message : "Could not open file")
      }
    })()
  }

  // The home workspace (and anything else without access to the pickers)
  // triggers File > Open through this event. openImageOrPsd is recreated
  // each render, so route through a ref to register the listener once.
  const openImageOrPsdRef = React.useRef(openImageOrPsd)
  openImageOrPsdRef.current = openImageOrPsd
  React.useEffect(() => {
    const handler = () => openImageOrPsdRef.current()
    return addPhotoshopEventListener("ps-open-file", handler)
  }, [])

  const saveProject = () => {
    void saveProjectDocument(activeDoc?.id, "save")
  }

  const _saveProjectAs = () => {
    void saveProjectDocument(activeDoc?.id, "save-as")
  }

  const savePsd = async () => {
    if (!activeDoc) return
    try {
      const { createDocumentReport, downloadBlob, serializePsd } = await loadDocumentCommands()
      const report = createDocumentReport(activeDoc, "PSD Export")
      downloadBlob(await serializePsd(activeDoc), `${safeDocName()}.psd`)
      dispatch({ type: "add-document-report", report })
      rememberDoc(activeDoc, "psd")
      toast.success("PSD exported. Save Project keeps the editable app document clean.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save PSD")
    }
  }

  const savePsb = async () => {
    if (!activeDoc) return
    try {
      const { createDocumentReport, downloadBlob, serializePsb } = await loadDocumentCommands()
      const report = createDocumentReport(activeDoc, "PSD Export")
      downloadBlob(await serializePsb(activeDoc), `${safeDocName()}.psb`)
      dispatch({ type: "add-document-report", report })
      rememberDoc(activeDoc, "psd")
      toast.success("PSB exported. Browser canvas and memory limits still apply to reopen.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save PSB")
    }
  }

  const openProject = () => {
    void (async () => {
      let picked: { file: File; handle?: ReadableFileHandle; permission: PermissionState | "unsupported" }
      try {
        picked = await pickLocalFile(".psprojson,application/json", [
          {
            description: "Photoshop Web Project",
            accept: { "application/json": [".psprojson", ".json"] },
          },
        ])
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (err instanceof Error && err.message === "No file selected") return
        toast.error(err instanceof Error ? err.message : "Could not open project")
        return
      }

      const file = picked.file
      try {
        const { createDocumentReport, deserializeProject } = await loadDocumentCommands()
        assertFileSize(file, MAX_PROJECT_FILE_BYTES, "Project file")
        const doc = await deserializeProject(await file.text())
        doc.metadata = { ...(doc.metadata ?? {}), title: doc.metadata?.title ?? doc.name, source: file.name }
        createDocument(doc, "Open Project", lifecycleForPickedFile(file, picked, "project"))
        dispatch({ type: "add-document-report", report: createDocumentReport(doc, "Project Import") })
        rememberDoc(doc, "project")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not open project")
      }
    })()
  }

  const placeEmbedded = () => {
    if (!activeDoc) return
    void (async () => {
      let picked: { file: File; handle?: ReadableFileHandle; permission: PermissionState | "unsupported" }
      try {
        picked = await pickLocalFile("image/*", [
          { description: "Images", accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"] } },
        ])
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (err instanceof Error && err.message === "No file selected") return
        toast.error(err instanceof Error ? err.message : "Could not place image")
        return
      }

      const file = picked.file
      if (!activeDoc) return
      try {
        const { loadRasterCanvasFromFile } = await loadDocumentCommands()
        if (await preflightLargeDocumentImport(file, "place", picked)) return
        const raster = await loadRasterCanvasFromFile(file)
        await placeRasterCanvas(file, raster.canvas, "Place Embedded", picked)
      } catch (err) {
        if (await buildLargeDocumentRecovery(file, "place", err, picked)) return
        toast.error(err instanceof Error ? err.message : "Could not place image")
      }
    })()
  }

  const closeLargeDocumentRecovery = () => {
    if (largeDocumentRecoveryBusy) return
    setLargeDocumentRecovery(null)
  }

  const openLargeDocumentReduced = async () => {
    const recovery = largeDocumentRecovery
    if (!recovery) return
    setLargeDocumentRecoveryBusy(true)
    try {
      const { createDocumentReport, deserializePsdFile, loadRasterCanvasFromFile } = await loadDocumentCommands()
      if (recovery.source === "place") {
        const raster = await loadRasterCanvasFromFile(recovery.file, { mode: "reduced-scale" })
        await placeRasterCanvas(recovery.file, raster.canvas, "Place Reduced Embedded", recovery.picked)
      } else if (recovery.plan.kind === "psd" || recovery.plan.kind === "psb") {
        const doc = await deserializePsdFile(recovery.file, { psbLargeDocumentMode: "reduced-scale" })
        doc.metadata = { ...(doc.metadata ?? {}), title: doc.metadata?.title ?? recovery.file.name, source: recovery.file.name }
        createDocument(doc, "Open Reduced Photoshop Document", lifecycleForPickedFile(recovery.file, recovery.picked, "psd"))
        dispatch({ type: "add-document-report", report: createDocumentReport(doc, "PSD Import") })
        rememberDoc(doc, "psd")
      } else {
        const raster = await loadRasterCanvasFromFile(recovery.file, { mode: "reduced-scale" })
        openRasterCanvasAsDocument(recovery.file, raster, recovery.picked)
      }
      setLargeDocumentRecovery(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open reduced document")
    } finally {
      setLargeDocumentRecoveryBusy(false)
    }
  }

  const openLargeDocumentTileOnly = async () => {
    const recovery = largeDocumentRecovery
    if (!recovery) return
    if (recovery.plan.kind !== "psb") {
      toast.info("Tile-only import is available for oversized PSB files.")
      return
    }
    setLargeDocumentRecoveryBusy(true)
    try {
      const { createDocumentReport, deserializePsdFile } = await loadDocumentCommands()
      const doc = await deserializePsdFile(recovery.file, { psbLargeDocumentMode: "tile-view" })
      doc.metadata = { ...(doc.metadata ?? {}), title: doc.metadata?.title ?? recovery.file.name, source: recovery.file.name }
      createDocument(doc, "Open Tile-Only PSB", lifecycleForPickedFile(recovery.file, recovery.picked, "psd"))
      dispatch({ type: "add-document-report", report: createDocumentReport(doc, "PSD Import") })
      rememberDoc(doc, "psd")
      setLargeDocumentRecovery(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open tile-only PSB")
    } finally {
      setLargeDocumentRecoveryBusy(false)
    }
  }

  const inspectLargeDocument = async () => {
    const recovery = largeDocumentRecovery
    if (!recovery) return
    const { createDocumentReport } = await loadDocumentCommands()
    const doc = createLargeDocumentInspectionDocument({
      fileName: recovery.file.name,
      kind: recovery.plan.kind,
      width: recovery.plan.width,
      height: recovery.plan.height,
      reason: recovery.reason,
      warnings: recovery.plan.warnings,
      parsedStructure: recovery.plan.parsedStructure,
    })
    doc.metadata = { ...(doc.metadata ?? {}), title: doc.metadata?.title ?? recovery.file.name, source: recovery.file.name }
    createDocument(doc, "Inspect Large Document", lifecycleForPickedFile(recovery.file, recovery.picked, recovery.plan.kind === "raster" ? "image" : "psd"))
    dispatch({ type: "add-document-report", report: createDocumentReport(doc, recovery.plan.kind === "psd" || recovery.plan.kind === "psb" ? "PSD Import" : "Project Import") })
    setLargeDocumentRecovery(null)
  }

  const applyWorkspacePreset = (preset: WorkspacePresetId) => {
    dispatchPhotoshopEvent("ps-apply-workspace-preset", { preset })
  }

  const openPanel = (id: string) => {
    dispatchPhotoshopEvent("ps-open-panel", id)
  }

  const pluginCommandItems = (activeDoc?.plugins ?? []).flatMap((plugin) =>
    (plugin.commands ?? []).map((command) => ({
      plugin,
      command,
      disabledReason: pluginCommandUnavailable(plugin, command),
    })),
  )

  const runPluginCommandFromMenu = (plugin: PluginDescriptor, command: PluginCommandDescriptor) => {
    openAdvancedTab("plugins")
    window.setTimeout(() => {
      dispatchPhotoshopEvent("ps-run-plugin-command", { pluginId: plugin.id, commandId: command.id })
    }, 80)
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

        <FileMenu {...{
          menuClass, onOpenNew, openImageOrPsd, openProject, recentDocuments, openRecent, setRecentManagerOpen, clearRecentDocuments,
          activeDoc, requestCloseDocument, duplicateDocument, closeOtherDocumentsFromMenu, reopenClosedDocumentFromMenu, exportImage,
          saveProject, savePsd, savePsb, placeEmbedded, setContactSheetOpen, setWorkflowPack, openAdvancedTab, setGapWorkflow,
          setPhotomergeOpen, setPdfImportOpen, setCropAndStraightenOpen, dispatch, setBatchProcessingOpen, setImageProcessorOpen,
          setExportAsInitial, setExportAsOpen, setBatchExportInitial, setBatchExportOpen, setFileInfoOpen,
          revealDocumentSourceFromMenu, setPreflightOpen, setDocumentReportOpen,
        }} />

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
              onSelect={() => dispatchPhotoshopEvent("ps-free-transform")}
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
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-flip", "horizontal")} disabled={!activeLayer}>
                  Flip Horizontal
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-flip", "vertical")} disabled={!activeLayer}>
                  Flip Vertical
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-rotate", 90)} disabled={!activeLayer}>
                  Rotate 90° CW
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-rotate", -90)} disabled={!activeLayer}>
                  Rotate 90° CCW
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-transform-rotate", 180)} disabled={!activeLayer}>
                  Rotate 180°
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Purge</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {PURGE_COMMANDS.map((command) => (
                  <DropdownMenuItem key={command.target} onSelect={() => runPurge(command.target)}>
                    {command.menuLabel}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Presets</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => setPresetManagerOpen(true)}>
                  Preset Manager…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "brush")}>
                  Brushes Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "swatches")}>
                  Swatches Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "gradients")}>
                  Gradients Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "patterns")}>
                  Patterns Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "styles")}>
                  Styles Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "shapes")}>
                  Shapes Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "tool-presets")}>
                  Tool Presets Panel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dispatchPhotoshopEvent("ps-open-panel", "assets")}>
                  Assets Panel
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setPreferencesOpen(true)}>
              Preferences
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>Keyboard Shortcuts…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMenuCustomizationOpen(true)}>Menus…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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
                <DropdownMenuItem onSelect={() => setColorModeTarget("Duotone")}>
                  {activeDoc?.colorMode === "Duotone" ? "✓ " : ""}Duotone...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorModeTarget("Indexed")}>
                  {activeDoc?.colorMode === "Indexed" ? "✓ " : ""}Indexed Color...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorMode("Multichannel")}>
                  {activeDoc?.colorMode === "Multichannel" ? "✓ " : ""}Multichannel...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorModeTarget("Bitmap")}>
                  {activeDoc?.colorMode === "Bitmap" ? "✓ " : ""}Bitmap / Halftone...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColorModeTarget("ColorTable")}>
                  Color Table...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>{activeDoc?.bitDepth ?? 8} Bits/Channel</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openColorWorkflow("assign")} disabled={!activeDoc}>
                  Assign Profile...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openColorWorkflow("convert")} disabled={!activeDoc}>
                  Convert to Profile...
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openColorWorkflow("proof")} disabled={!activeDoc}>
                  Color Settings / Proof Setup...
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => setGapWorkflow("apply-image")} disabled={!activeLayer}>
              Apply Image...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGapWorkflow("calculations")} disabled={!activeDoc}>
              Calculations...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGapWorkflow("split-channels")} disabled={!activeDoc}>
              Split Channels...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGapWorkflow("merge-channels")} disabled={!documents.length}>
              Merge Channels...
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
                <DropdownMenuItem onSelect={() => setShadowsHighlightsOpen(true)} disabled={!activeDoc}>
                  Shadows/Highlights…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setHdrToningOpen(true)} disabled={!activeDoc}>
                  HDR Toning…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addAdjustmentLayer("desaturate")}>
                  Desaturate
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMatchColorOpen(true)} disabled={!activeDoc}>
                  Match Color…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setReplaceColorOpen(true)} disabled={!activeDoc}>
                  Replace Color…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    // Photoshop's Equalize either runs immediately (no selection)
                    // or prompts the user when a selection is active. We
                    // reproduce that prompt only when a selection is present;
                    // otherwise we apply directly.
                    if (!activeDoc) return
                    if (activeDoc.selection.bounds || activeDoc.selection.mask) {
                      setEqualizePromptOpen(true)
                    } else {
                      addAdjustmentLayer("equalize")
                    }
                  }}
                  disabled={!activeDoc}
                >
                  Equalize…
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
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setAutoOptions({ algorithm: "per-channel-contrast", label: "Auto Tone" })}
                  disabled={!activeDoc}
                >
                  Auto Tone Options…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setAutoOptions({ algorithm: "monochromatic-contrast", label: "Auto Contrast" })}
                  disabled={!activeDoc}
                >
                  Auto Contrast Options…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setAutoOptions({ algorithm: "dark-light-colors", label: "Auto Color" })}
                  disabled={!activeDoc}
                >
                  Auto Color Options…
                </DropdownMenuItem>
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
            <DropdownMenuItem onSelect={() => setFitImageOpen(true)} disabled={!activeDoc}>
              Fit Image…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Layer</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[calc(100vh-56px)] w-72 overflow-y-auto">
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={flattenAllLayerEffects} disabled={!activeDoc}>
                  Flatten All Layer Effects
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={flattenAllMasks} disabled={!activeDoc}>
                  Flatten All Masks
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Rasterize</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => rasterizeLayers("type")} disabled={!activeLayer || activeLayer.kind !== "text"}>
                  Type
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rasterizeLayers("shape")} disabled={!activeLayer || (activeLayer.kind !== "shape" && !activeLayer.path)}>
                  Shape
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rasterizeLayers("smart-object")} disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}>
                  Smart Object
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rasterizeLayers("layer-style")} disabled={!activeLayer?.style}>
                  Layer Style
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => rasterizeLayers("video")}
                  disabled={!activeLayer || (activeLayer.kind !== "video" && !activeLayer.video)}
                >
                  Video
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => rasterizeLayers("3d")}
                  disabled={!activeLayer || (activeLayer.kind !== "3d" && !activeLayer.threeD)}
                >
                  3D
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => rasterizeLayers("layer")} disabled={!activeLayer}>
                  Layer
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => rasterizeLayers("all")} disabled={!activeDoc}>
                  All Layers
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
              onSelect={() => void replaceSmartObjectFromFile("embedded")}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Replace Contents...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void replaceSmartObjectFromFile("linked")}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Relink to File...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void updateLinkedSmartObjectFromMenu()}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Update Linked Smart Object
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void revealSmartObjectSourceFromMenu()}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Reveal Smart Object Source...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void exportSmartObjectContentsFromMenu()}
              disabled={!activeLayer || (!activeLayer.smartObject && activeLayer.kind !== "smart-object")}
            >
              Export Contents...
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
            <DropdownMenuItem onSelect={deleteAllEmptyLayers} disabled={!activeDoc}>
              Delete All Empty Layers
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
              disabled={!activeDoc}
              onSelect={() => setFlattenTransparencyOpen(true)}
            >
              Flatten Transparency…
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!activeLayer}>
                Flatten Transparency
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => flattenTransparency("clear", background, "Background Color")}>
                  Background Color
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => flattenTransparency("clear", foreground, "Foreground Color")}>
                  Foreground Color
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => flattenTransparency("preserve", background, "Preserve Alpha")}>
                  Preserve Alpha
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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

        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Type</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Type</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={async () => {
                if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
                const { rasterizeText } = await loadImageCommands()
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
              onSelect={async () => {
                if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
                const { convertTextToEditablePath } = await loadTypeCommands()
                const path = convertTextToEditablePath(activeLayer.text)
                dispatch({ type: "set-layer-path", id: activeLayer.id, path })
                dispatch({ type: "set-layer-kind", id: activeLayer.id, kind: "shape" })
                setTimeout(() => commit("Convert Text to Path", [activeLayer.id]), 0)
              }}
            >
              Convert to Shape/Path
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
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
                const { applyTextInsideShape } = await loadTypeCommands()
                const { rasterizeText } = await loadImageCommands()
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
              onSelect={async () => {
                if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
                const { matchFontForLayer } = await loadTypeCommands()
                const { rasterizeText } = await loadImageCommands()
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
              onSelect={async () => {
                if (!activeDoc) return
                const { diagnoseDocumentFonts } = await loadTypeCommands()
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
              onSelect={async () => {
                if (!activeDoc) {
                  toast.info("Open a document before creating 3D text.")
                  return
                }
                if (!activeLayer?.text) {
                  toast.info("Select a text layer before creating 3D text extrusion.")
                  return
                }
                const { createTextExtrusionScene } = await loadTypeCommands()
                const { renderThreeDScene } = await loadAdvancedCommands()
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

        <SelectMenu
          menuClass={menuClass}
          activeDoc={activeDoc}
          activeLayer={activeLayer}
          lastSelection={lastSelectionRef.current}
          dispatch={dispatch}
          commit={commit}
          loadImageCommands={loadImageCommands}
          openSelectionOperation={openSelectionOperation}
          setColorRangeOpen={setColorRangeOpen}
          setRefineEdgeOpen={setRefineEdgeOpen}
          setSelectMaskOpen={setSelectMaskOpen}
          setSaveSelectionOpen={setSaveSelectionOpen}
          setLoadSelectionOpen={setLoadSelectionOpen}
        />
        <FilterMenu
          menuClass={menuClass}
          activeLayer={activeLayer}
          lastFilter={lastFilter}
          applyInstant={applyInstant}
          openFilterDialog={openFilterDialog}
          setCameraRawOpen={setCameraRawOpen}
          setFilterGalleryOpen={setFilterGalleryOpen}
          setLiquifyOpen={setLiquifyOpen}
          setPuppetWarpOpen={setPuppetWarpOpen}
        />
        <ViewMenu
          menuClass={menuClass}
          activeDoc={activeDoc}
          colorSettings={colorSettings}
          dispatch={dispatch}
          onToggleStatusBar={onToggleStatusBar}
          statusBarVisible={statusBarVisible}
          openAdvancedTab={openAdvancedTab}
          updateColorManagement={updateColorManagement}
          toggleProofChannel={toggleProofChannel}
          setGridSettingsOpen={setGridSettingsOpen}
          setNewGuideOpen={setNewGuideOpen}
          setGuideLayoutOpen={setGuideLayoutOpen}
          setGapWorkflow={setGapWorkflow}
          toggleQuickMask={toggleQuickMask}
        />
        <MediaWorkspaceMenus
          menuClass={menuClass}
          activeDoc={activeDoc}
          applyInstant={applyInstant}
          openFilterDialog={openFilterDialog}
          openAdvancedTab={openAdvancedTab}
        />

        <DropdownMenu>
          <DropdownMenuTrigger className={menuClass}>Plugins</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onSelect={() => openAdvancedTab("plugins")} disabled={!activeDoc}>Plugin Manager...</DropdownMenuItem>
            {pluginCommandItems.length ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Installed Commands</DropdownMenuLabel>
                {pluginCommandItems.slice(0, 12).map(({ plugin, command, disabledReason }) => (
                  <DropdownMenuItem
                    key={`${plugin.id}-${command.id}`}
                    disabled={!!disabledReason}
                    onSelect={() => runPluginCommandFromMenu(plugin, command)}
                  >
                    {command.title}
                    <DropdownMenuShortcut className="max-w-32 truncate">{plugin.name}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openAdvancedTab("libraries")} disabled={!activeDoc}>Creative Cloud Libraries...</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openAdvancedTab("libraries")} disabled={!activeDoc}>Adobe Stock / Fonts...</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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
                      dispatchPhotoshopEvent("ps-apply-workspace", { name: workspace.name })
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
            <DropdownMenuItem onSelect={() => openPanel("browser-diagnostics")}>
              Browser Diagnostics
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLayerCompsOpen(true)}>
              Layer Comps...
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setColorLabelsOpen(true)}>
              Color Labels...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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

      <MenuDialogs
        openFilter={openFilter}
        setOpenFilter={setOpenFilter}
        imageSizeOpen={imageSizeOpen}
        setImageSizeOpen={setImageSizeOpen}
        canvasSizeOpen={canvasSizeOpen}
        setCanvasSizeOpen={setCanvasSizeOpen}
        strokeOpen={strokeOpen}
        setStrokeOpen={setStrokeOpen}
        flattenTransparencyOpen={flattenTransparencyOpen}
        setFlattenTransparencyOpen={setFlattenTransparencyOpen}
        colorRangeOpen={colorRangeOpen}
        setColorRangeOpen={setColorRangeOpen}
        refineEdgeOpen={refineEdgeOpen}
        setRefineEdgeOpen={setRefineEdgeOpen}
        liquifyOpen={liquifyOpen}
        setLiquifyOpen={setLiquifyOpen}
        puppetWarpOpen={puppetWarpOpen}
        setPuppetWarpOpen={setPuppetWarpOpen}
        layerStyleOpen={layerStyleOpen}
        setLayerStyleOpen={setLayerStyleOpen}
        warpTextOpen={warpTextOpen}
        setWarpTextOpen={setWarpTextOpen}
        layerCompsOpen={layerCompsOpen}
        setLayerCompsOpen={setLayerCompsOpen}
        colorLabelsOpen={colorLabelsOpen}
        setColorLabelsOpen={setColorLabelsOpen}
        fitImageOpen={fitImageOpen}
        setFitImageOpen={setFitImageOpen}
        exportAsOpen={exportAsOpen}
        setExportAsOpen={setExportAsOpen}
        exportAsInitial={exportAsInitial}
        batchExportOpen={batchExportOpen}
        setBatchExportOpen={setBatchExportOpen}
        batchExportInitial={batchExportInitial}
        batchProcessingOpen={batchProcessingOpen}
        setBatchProcessingOpen={setBatchProcessingOpen}
        imageProcessorOpen={imageProcessorOpen}
        setImageProcessorOpen={setImageProcessorOpen}
        imageProcessorInitial={imageProcessorInitial}
        cropAndStraightenOpen={cropAndStraightenOpen}
        setCropAndStraightenOpen={setCropAndStraightenOpen}
        pdfImportOpen={pdfImportOpen}
        setPdfImportOpen={setPdfImportOpen}
        documentReportOpen={documentReportOpen}
        setDocumentReportOpen={setDocumentReportOpen}
        preflightOpen={preflightOpen}
        setPreflightOpen={setPreflightOpen}
        gridSettingsOpen={gridSettingsOpen}
        setGridSettingsOpen={setGridSettingsOpen}
        newGuideOpen={newGuideOpen}
        setNewGuideOpen={setNewGuideOpen}
        guideLayoutOpen={guideLayoutOpen}
        setGuideLayoutOpen={setGuideLayoutOpen}
        contactSheetOpen={contactSheetOpen}
        setContactSheetOpen={setContactSheetOpen}
        photomergeOpen={photomergeOpen}
        setPhotomergeOpen={setPhotomergeOpen}
        fileInfoOpen={fileInfoOpen}
        setFileInfoOpen={setFileInfoOpen}
        revealSourceOpen={revealSourceOpen}
        setRevealSourceOpen={setRevealSourceOpen}
        revealSourceDocId={revealSourceDocId}
        setRevealSourceDocId={setRevealSourceDocId}
        shadowsHighlightsOpen={shadowsHighlightsOpen}
        setShadowsHighlightsOpen={setShadowsHighlightsOpen}
        hdrToningOpen={hdrToningOpen}
        setHdrToningOpen={setHdrToningOpen}
        matchColorOpen={matchColorOpen}
        setMatchColorOpen={setMatchColorOpen}
        replaceColorOpen={replaceColorOpen}
        setReplaceColorOpen={setReplaceColorOpen}
        equalizePromptOpen={equalizePromptOpen}
        setEqualizePromptOpen={setEqualizePromptOpen}
        autoOptions={autoOptions}
        setAutoOptions={setAutoOptions}
        advancedOpen={advancedOpen}
        setAdvancedOpen={setAdvancedOpen}
        advancedTab={advancedTab}
        advancedColorWorkflow={advancedColorWorkflow}
        algorithmOpen={algorithmOpen}
        setAlgorithmOpen={setAlgorithmOpen}
        gapWorkflow={gapWorkflow}
        setGapWorkflow={setGapWorkflow}
        workflowPack={workflowPack}
        setWorkflowPack={setWorkflowPack}
        colorModeTarget={colorModeTarget}
        setColorModeTarget={setColorModeTarget}
        preferencesOpen={preferencesOpen}
        setPreferencesOpen={setPreferencesOpen}
        shortcutsOpen={shortcutsOpen}
        setShortcutsOpen={setShortcutsOpen}
        menuCustomizationOpen={menuCustomizationOpen}
        setMenuCustomizationOpen={setMenuCustomizationOpen}
        presetManagerOpen={presetManagerOpen}
        setPresetManagerOpen={setPresetManagerOpen}
        aboutOpen={aboutOpen}
        setAboutOpen={setAboutOpen}
        largeDocumentRecovery={largeDocumentRecovery}
        largeDocumentRecoveryBusy={largeDocumentRecoveryBusy}
        closeLargeDocumentRecovery={closeLargeDocumentRecovery}
        openLargeDocumentReduced={openLargeDocumentReduced}
        openLargeDocumentTileOnly={openLargeDocumentTileOnly}
        inspectLargeDocument={inspectLargeDocument}
        filterGalleryOpen={filterGalleryOpen}
        setFilterGalleryOpen={setFilterGalleryOpen}
        cameraRawOpen={cameraRawOpen}
        setCameraRawOpen={setCameraRawOpen}
        selectMaskOpen={selectMaskOpen}
        setSelectMaskOpen={setSelectMaskOpen}
        recentManagerOpen={recentManagerOpen}
        setRecentManagerOpen={setRecentManagerOpen}
        recentDocuments={recentDocuments}
        openRecent={openRecent}
        removeRecent={(id) => {
          removeRecentDocument(id)
          refreshRecents()
        }}
        clearRecentDocuments={clearRecentDocuments}
        workspaceManagerOpen={workspaceManagerOpen}
        setWorkspaceManagerOpen={setWorkspaceManagerOpen}
        savedWorkspaces={savedWorkspaces}
        refreshWorkspaces={refreshWorkspaces}
        selectionOperation={selectionOperation}
        setSelectionOperation={setSelectionOperation}
        pendingPurge={pendingPurge}
        setPendingPurge={setPendingPurge}
        pendingPurgeTitle={pendingPurgeCommand?.label ?? "Purge"}
        executePurge={executePurge}
        saveSelectionOpen={saveSelectionOpen}
        setSaveSelectionOpen={setSaveSelectionOpen}
        loadSelectionOpen={loadSelectionOpen}
        setLoadSelectionOpen={setLoadSelectionOpen}
      />
    </>
  )
}
