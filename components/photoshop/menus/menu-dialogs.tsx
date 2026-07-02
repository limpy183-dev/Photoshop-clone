"use client"

import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { lazyDialog } from "../lazy-dialog"
import type { AdvancedSubsystemTab, ColorWorkflowMode } from "../advanced-subsystems-dialog"
import type { ColorModeDialogTarget } from "../color-mode-dialog"
import type { GapWorkflowKind } from "../gap-workflow-dialog"
import type { LargeDocumentOpenPlan } from "../large-document"
import type { SelectionOperation } from "../management-dialogs"
import type { PurgeTarget } from "../purge-commands"
import type { RecentDocument } from "../recent-documents"
import type { WorkflowPackId } from "../workflow-presets"
import { preloadCanvasSizeDialog, preloadExportAsDialog, preloadImageSizeDialog } from "../dialog-preload"

// All dialogs below are lazy-mounted: the JS chunk is fetched only the first
// time the user opens the dialog, and the component returns null until then.
// This keeps dialog source out of the workspace's eager bundle and out of the
// React tree on idle re-renders.
const FilterDialog = lazyDialog<{ filterId: string | null; onClose: () => void }>(
  () => import("../filter-dialog").then((m) => ({ default: m.FilterDialog })),
  (p) => p.filterId != null,
)
const ImageSizeDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  preloadImageSizeDialog,
)
const CanvasSizeDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  preloadCanvasSizeDialog,
)
const StrokeDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../stroke-dialog").then((m) => ({ default: m.StrokeDialog })),
)
const FlattenTransparencyDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../flatten-transparency-dialog").then((m) => ({ default: m.FlattenTransparencyDialog })),
)
const ColorRangeDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../color-range-dialog").then((m) => ({ default: m.ColorRangeDialog })),
)
const RefineEdgeDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../refine-edge-dialog").then((m) => ({ default: m.RefineEdgeDialog })),
)
const LiquifyDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../liquify-dialog").then((m) => ({ default: m.LiquifyDialog })),
)
const PuppetWarpDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../puppet-warp-dialog").then((m) => ({ default: m.PuppetWarpDialog })),
)
const LayerStyleDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../layer-style-dialog").then((m) => ({ default: m.LayerStyleDialog })),
)
const WarpTextDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../warp-text-dialog").then((m) => ({ default: m.WarpTextDialog })),
)
const LayerCompsDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../layer-comps-dialog").then((m) => ({ default: m.LayerCompsDialog })),
)
const ColorLabelsDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../color-labels-dialog").then((m) => ({ default: m.ColorLabelsDialog })),
)
const FitImageDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../fit-image-dialog").then((m) => ({ default: m.FitImageDialog })),
)
const ExportAsDialog = lazyDialog<{
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: unknown
}>(
  () => preloadExportAsDialog().then((m) => ({ default: m.default as unknown as React.ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    initial?: unknown
  }> })),
)
const BatchExportDialog = lazyDialog<{
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: unknown
}>(
  () => import("../batch-export-dialog").then((m) => ({ default: m.BatchExportDialog as unknown as React.ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    initial?: unknown
  }> })),
)
const BatchProcessingDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../processing-dialogs").then((m) => ({ default: m.BatchProcessingDialog })),
)
const ImageProcessorDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void; initial?: unknown }>(
  () => import("../processing-dialogs").then((m) => ({ default: m.ImageProcessorDialog as unknown as React.ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    initial?: unknown
  }> })),
)
const CropAndStraightenDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../processing-dialogs").then((m) => ({ default: m.CropAndStraightenDialog })),
)
const PdfImportDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../pdf-import-dialog").then((m) => ({ default: m.PdfImportDialog })),
)
const DocumentReportDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../document-report-dialog").then((m) => ({ default: m.DocumentReportDialog })),
)
const PreflightDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../preflight-dialog").then((m) => ({ default: m.PreflightDialog })),
)
const FilterGalleryDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../filter-gallery").then((m) => ({ default: m.FilterGalleryDialog })),
)
const CameraRawDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../camera-raw-dialog").then((m) => ({ default: m.CameraRawDialog })),
)
const SelectAndMaskDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../select-and-mask").then((m) => ({ default: m.SelectAndMaskDialog })),
)
const FileInfoDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../file-info-dialog").then((m) => ({ default: m.FileInfoDialog })),
)
const RevealSourceDialog = lazyDialog<{
  open: boolean
  onOpenChange: (open: boolean) => void
  docId?: string | null
}>(
  () => import("../reveal-source-dialog").then((m) => ({ default: m.RevealSourceDialog })),
)
const AdvancedSubsystemsDialog = lazyDialog<{
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: AdvancedSubsystemTab
  initialColorWorkflow?: ColorWorkflowMode
}>(
  () => import("../advanced-subsystems-dialog").then((m) => ({ default: m.AdvancedSubsystemsDialog as unknown as React.ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    initialTab?: AdvancedSubsystemTab
    initialColorWorkflow?: ColorWorkflowMode
  }> })),
)
const AlgorithmicOperationsDialog = lazyDialog<{
  open: boolean
  onOpenChange: (open: boolean) => void
}>(
  () => import("../algorithmic-operations-dialog").then((m) => ({ default: m.AlgorithmicOperationsDialog })),
)
const GapWorkflowDialog = lazyDialog<{
  workflow: GapWorkflowKind | null
  onOpenChange: (open: boolean) => void
}>(
  () => import("../gap-workflow-dialog").then((m) => ({ default: m.GapWorkflowDialog as unknown as React.ComponentType<{
    workflow: GapWorkflowKind | null
    onOpenChange: (open: boolean) => void
  }> })),
  (p) => p.workflow != null,
)
const WorkflowPackDialog = lazyDialog<{
  workflowId: WorkflowPackId | null
  onOpenChange: (open: boolean) => void
}>(
  () => import("../workflow-pack-dialog").then((m) => ({ default: m.WorkflowPackDialog as unknown as React.ComponentType<{
    workflowId: WorkflowPackId | null
    onOpenChange: (open: boolean) => void
  }> })),
  (p) => p.workflowId != null,
)
const ColorModeDialog = lazyDialog<{
  target: ColorModeDialogTarget | null
  onOpenChange: (open: boolean) => void
}>(
  () => import("../color-mode-dialog").then((m) => ({ default: m.ColorModeDialog as unknown as React.ComponentType<{
    target: ColorModeDialogTarget | null
    onOpenChange: (open: boolean) => void
  }> })),
  (p) => p.target != null,
)
const PreferencesDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../preferences-dialog").then((m) => ({ default: m.PreferencesDialog })),
)
const KeyboardShortcutsDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../keyboard-shortcuts-dialog").then((m) => ({ default: m.KeyboardShortcutsDialog })),
)
const MenuCustomizationDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../menu-customization-dialog").then((m) => ({ default: m.MenuCustomizationDialog })),
)
const PresetManagerDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../preset-manager-dialog").then((m) => ({ default: m.PresetManagerDialog })),
)
const AboutDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../about-dialog").then((m) => ({ default: m.AboutDialog })),
)
const RecentDocumentsDialog = lazyDialog<{
  open: boolean
  onOpenChange: (open: boolean) => void
  recents: RecentDocument[]
  onOpenRecent: (recent: RecentDocument) => void | Promise<void>
  onRemoveRecent: (id: string) => void
  onClearRecents: () => void
}>(
  () => import("../management-dialogs").then((m) => ({ default: m.RecentDocumentsDialog as unknown as React.ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    recents: RecentDocument[]
    onOpenRecent: (recent: RecentDocument) => void | Promise<void>
    onRemoveRecent: (id: string) => void
    onClearRecents: () => void
  }> })),
)
const SelectionOperationDialog = lazyDialog<{
  operation: SelectionOperation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}>(
  () => import("../management-dialogs").then((m) => ({ default: m.SelectionOperationDialog as unknown as React.ComponentType<{
    operation: SelectionOperation | null
    open: boolean
    onOpenChange: (open: boolean) => void
  }> })),
)
const SaveSelectionDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../management-dialogs").then((m) => ({ default: m.SaveSelectionDialog })),
)
const LoadSelectionDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../management-dialogs").then((m) => ({ default: m.LoadSelectionDialog })),
)
const WorkspaceManagerDialog = lazyDialog<{
  open: boolean
  onOpenChange: (open: boolean) => void
  savedWorkspaces: { name: string; savedAt?: number }[]
  onRefresh: () => void
}>(
  () => import("../management-dialogs").then((m) => ({ default: m.WorkspaceManagerDialog as unknown as React.ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    savedWorkspaces: { name: string; savedAt?: number }[]
    onRefresh: () => void
  }> })),
)
const ContactSheetDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../contact-sheet-dialog").then((m) => ({ default: m.ContactSheetDialog })),
)
const PhotomergeDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../photomerge-dialog").then((m) => ({ default: m.PhotomergeDialog })),
)
const LargeDocumentRecoveryDialog = lazyDialog<{
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: LargeDocumentOpenPlan | null
  busy?: boolean
  onOpenReduced: () => void
  onOpenTileOnly: () => void
  onInspect: () => void
}>(
  () => import("../large-document-recovery-dialog").then((m) => ({ default: m.LargeDocumentRecoveryDialog })),
)
const GridSettingsDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../workspace-dialogs").then((m) => ({ default: m.GridSettingsDialog })),
)
const GuideLayoutDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../workspace-dialogs").then((m) => ({ default: m.GuideLayoutDialog })),
)
const NewGuideDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../workspace-dialogs").then((m) => ({ default: m.NewGuideDialog })),
)
// Task 27 - Adjustment workflows. Each of these adjustments has UI that does
// not fit the generic FilterDialog renderer, so they ship as purpose-built
// dialogs lazily mounted only when their menu entry is used.
const ShadowsHighlightsDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../adjustment-dialogs").then((m) => ({ default: m.ShadowsHighlightsDialog })),
)
const HdrToningDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../adjustment-dialogs").then((m) => ({ default: m.HdrToningDialog })),
)
const MatchColorDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../adjustment-dialogs").then((m) => ({ default: m.MatchColorDialog })),
)
const ReplaceColorDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../adjustment-dialogs").then((m) => ({ default: m.ReplaceColorDialog })),
)
const EqualizePromptDialog = lazyDialog<{ open: boolean; onOpenChange: (open: boolean) => void }>(
  () => import("../adjustment-dialogs").then((m) => ({ default: m.EqualizePromptDialog })),
)

export type AutoAlgorithmId =
  | "monochromatic-contrast"
  | "per-channel-contrast"
  | "dark-light-colors"
  | "brightness-contrast"

const AutoOptionsDialog = lazyDialog<{
  open: boolean
  onOpenChange: (open: boolean) => void
  initialAlgorithm?: AutoAlgorithmId
  label?: string
}>(
  () => import("../adjustment-dialogs").then((m) => ({ default: m.AutoOptionsDialog })),
)

interface MenuDialogsProps {
  openFilter: string | null
  setOpenFilter: (filterId: string | null) => void
  imageSizeOpen: boolean
  setImageSizeOpen: (open: boolean) => void
  canvasSizeOpen: boolean
  setCanvasSizeOpen: (open: boolean) => void
  strokeOpen: boolean
  setStrokeOpen: (open: boolean) => void
  flattenTransparencyOpen: boolean
  setFlattenTransparencyOpen: (open: boolean) => void
  colorRangeOpen: boolean
  setColorRangeOpen: (open: boolean) => void
  refineEdgeOpen: boolean
  setRefineEdgeOpen: (open: boolean) => void
  liquifyOpen: boolean
  setLiquifyOpen: (open: boolean) => void
  puppetWarpOpen: boolean
  setPuppetWarpOpen: (open: boolean) => void
  layerStyleOpen: boolean
  setLayerStyleOpen: (open: boolean) => void
  warpTextOpen: boolean
  setWarpTextOpen: (open: boolean) => void
  layerCompsOpen: boolean
  setLayerCompsOpen: (open: boolean) => void
  colorLabelsOpen: boolean
  setColorLabelsOpen: (open: boolean) => void
  fitImageOpen: boolean
  setFitImageOpen: (open: boolean) => void
  exportAsOpen: boolean
  setExportAsOpen: (open: boolean) => void
  exportAsInitial: unknown
  batchExportOpen: boolean
  setBatchExportOpen: (open: boolean) => void
  batchExportInitial: unknown
  batchProcessingOpen: boolean
  setBatchProcessingOpen: (open: boolean) => void
  imageProcessorOpen: boolean
  setImageProcessorOpen: (open: boolean) => void
  imageProcessorInitial: unknown
  cropAndStraightenOpen: boolean
  setCropAndStraightenOpen: (open: boolean) => void
  pdfImportOpen: boolean
  setPdfImportOpen: (open: boolean) => void
  documentReportOpen: boolean
  setDocumentReportOpen: (open: boolean) => void
  preflightOpen: boolean
  setPreflightOpen: (open: boolean) => void
  gridSettingsOpen: boolean
  setGridSettingsOpen: (open: boolean) => void
  newGuideOpen: boolean
  setNewGuideOpen: (open: boolean) => void
  guideLayoutOpen: boolean
  setGuideLayoutOpen: (open: boolean) => void
  contactSheetOpen: boolean
  setContactSheetOpen: (open: boolean) => void
  photomergeOpen: boolean
  setPhotomergeOpen: (open: boolean) => void
  fileInfoOpen: boolean
  setFileInfoOpen: (open: boolean) => void
  revealSourceOpen: boolean
  setRevealSourceOpen: (open: boolean) => void
  revealSourceDocId: string | null
  setRevealSourceDocId: (docId: string | null) => void
  shadowsHighlightsOpen: boolean
  setShadowsHighlightsOpen: (open: boolean) => void
  hdrToningOpen: boolean
  setHdrToningOpen: (open: boolean) => void
  matchColorOpen: boolean
  setMatchColorOpen: (open: boolean) => void
  replaceColorOpen: boolean
  setReplaceColorOpen: (open: boolean) => void
  equalizePromptOpen: boolean
  setEqualizePromptOpen: (open: boolean) => void
  autoOptions: { algorithm: AutoAlgorithmId; label: string } | null
  setAutoOptions: (options: { algorithm: AutoAlgorithmId; label: string } | null) => void
  advancedOpen: boolean
  setAdvancedOpen: (open: boolean) => void
  advancedTab: AdvancedSubsystemTab
  advancedColorWorkflow: ColorWorkflowMode
  algorithmOpen: boolean
  setAlgorithmOpen: (open: boolean) => void
  gapWorkflow: GapWorkflowKind | null
  setGapWorkflow: (workflow: GapWorkflowKind | null) => void
  workflowPack: WorkflowPackId | null
  setWorkflowPack: (workflowId: WorkflowPackId | null) => void
  colorModeTarget: ColorModeDialogTarget | null
  setColorModeTarget: (target: ColorModeDialogTarget | null) => void
  preferencesOpen: boolean
  setPreferencesOpen: (open: boolean) => void
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  menuCustomizationOpen: boolean
  setMenuCustomizationOpen: (open: boolean) => void
  presetManagerOpen: boolean
  setPresetManagerOpen: (open: boolean) => void
  aboutOpen: boolean
  setAboutOpen: (open: boolean) => void
  largeDocumentRecovery: { plan: LargeDocumentOpenPlan } | null
  largeDocumentRecoveryBusy: boolean
  closeLargeDocumentRecovery: () => void
  openLargeDocumentReduced: () => void | Promise<void>
  openLargeDocumentTileOnly: () => void | Promise<void>
  inspectLargeDocument: () => void
  filterGalleryOpen: boolean
  setFilterGalleryOpen: (open: boolean) => void
  cameraRawOpen: boolean
  setCameraRawOpen: (open: boolean) => void
  selectMaskOpen: boolean
  setSelectMaskOpen: (open: boolean) => void
  recentManagerOpen: boolean
  setRecentManagerOpen: (open: boolean) => void
  recentDocuments: RecentDocument[]
  openRecent: (recent: RecentDocument) => void | Promise<void>
  removeRecent: (id: string) => void
  clearRecentDocuments: () => void
  workspaceManagerOpen: boolean
  setWorkspaceManagerOpen: (open: boolean) => void
  savedWorkspaces: { name: string; savedAt?: number }[]
  refreshWorkspaces: () => void
  selectionOperation: SelectionOperation | null
  setSelectionOperation: (operation: SelectionOperation | null) => void
  pendingPurge: PurgeTarget | null
  setPendingPurge: (target: PurgeTarget | null) => void
  pendingPurgeTitle: string
  executePurge: (target: PurgeTarget) => void
  saveSelectionOpen: boolean
  setSaveSelectionOpen: (open: boolean) => void
  loadSelectionOpen: boolean
  setLoadSelectionOpen: (open: boolean) => void
}

export function MenuDialogs({
  openFilter,
  setOpenFilter,
  imageSizeOpen,
  setImageSizeOpen,
  canvasSizeOpen,
  setCanvasSizeOpen,
  strokeOpen,
  setStrokeOpen,
  flattenTransparencyOpen,
  setFlattenTransparencyOpen,
  colorRangeOpen,
  setColorRangeOpen,
  refineEdgeOpen,
  setRefineEdgeOpen,
  liquifyOpen,
  setLiquifyOpen,
  puppetWarpOpen,
  setPuppetWarpOpen,
  layerStyleOpen,
  setLayerStyleOpen,
  warpTextOpen,
  setWarpTextOpen,
  layerCompsOpen,
  setLayerCompsOpen,
  colorLabelsOpen,
  setColorLabelsOpen,
  fitImageOpen,
  setFitImageOpen,
  exportAsOpen,
  setExportAsOpen,
  exportAsInitial,
  batchExportOpen,
  setBatchExportOpen,
  batchExportInitial,
  batchProcessingOpen,
  setBatchProcessingOpen,
  imageProcessorOpen,
  setImageProcessorOpen,
  imageProcessorInitial,
  cropAndStraightenOpen,
  setCropAndStraightenOpen,
  pdfImportOpen,
  setPdfImportOpen,
  documentReportOpen,
  setDocumentReportOpen,
  preflightOpen,
  setPreflightOpen,
  gridSettingsOpen,
  setGridSettingsOpen,
  newGuideOpen,
  setNewGuideOpen,
  guideLayoutOpen,
  setGuideLayoutOpen,
  contactSheetOpen,
  setContactSheetOpen,
  photomergeOpen,
  setPhotomergeOpen,
  fileInfoOpen,
  setFileInfoOpen,
  revealSourceOpen,
  setRevealSourceOpen,
  revealSourceDocId,
  setRevealSourceDocId,
  shadowsHighlightsOpen,
  setShadowsHighlightsOpen,
  hdrToningOpen,
  setHdrToningOpen,
  matchColorOpen,
  setMatchColorOpen,
  replaceColorOpen,
  setReplaceColorOpen,
  equalizePromptOpen,
  setEqualizePromptOpen,
  autoOptions,
  setAutoOptions,
  advancedOpen,
  setAdvancedOpen,
  advancedTab,
  advancedColorWorkflow,
  algorithmOpen,
  setAlgorithmOpen,
  gapWorkflow,
  setGapWorkflow,
  workflowPack,
  setWorkflowPack,
  colorModeTarget,
  setColorModeTarget,
  preferencesOpen,
  setPreferencesOpen,
  shortcutsOpen,
  setShortcutsOpen,
  menuCustomizationOpen,
  setMenuCustomizationOpen,
  presetManagerOpen,
  setPresetManagerOpen,
  aboutOpen,
  setAboutOpen,
  largeDocumentRecovery,
  largeDocumentRecoveryBusy,
  closeLargeDocumentRecovery,
  openLargeDocumentReduced,
  openLargeDocumentTileOnly,
  inspectLargeDocument,
  filterGalleryOpen,
  setFilterGalleryOpen,
  cameraRawOpen,
  setCameraRawOpen,
  selectMaskOpen,
  setSelectMaskOpen,
  recentManagerOpen,
  setRecentManagerOpen,
  recentDocuments,
  openRecent,
  removeRecent,
  clearRecentDocuments,
  workspaceManagerOpen,
  setWorkspaceManagerOpen,
  savedWorkspaces,
  refreshWorkspaces,
  selectionOperation,
  setSelectionOperation,
  pendingPurge,
  setPendingPurge,
  pendingPurgeTitle,
  executePurge,
  saveSelectionOpen,
  setSaveSelectionOpen,
  loadSelectionOpen,
  setLoadSelectionOpen,
}: MenuDialogsProps) {
  return (
    <>
      <FilterDialog filterId={openFilter} onClose={() => setOpenFilter(null)} />
      <ImageSizeDialog open={imageSizeOpen} onOpenChange={setImageSizeOpen} />
      <CanvasSizeDialog open={canvasSizeOpen} onOpenChange={setCanvasSizeOpen} />
      <StrokeDialog open={strokeOpen} onOpenChange={setStrokeOpen} />
      <FlattenTransparencyDialog
        open={flattenTransparencyOpen}
        onOpenChange={setFlattenTransparencyOpen}
      />
      <ColorRangeDialog open={colorRangeOpen} onOpenChange={setColorRangeOpen} />
      <RefineEdgeDialog open={refineEdgeOpen} onOpenChange={setRefineEdgeOpen} />
      <LiquifyDialog open={liquifyOpen} onOpenChange={setLiquifyOpen} />
      <PuppetWarpDialog open={puppetWarpOpen} onOpenChange={setPuppetWarpOpen} />
      <LayerStyleDialog open={layerStyleOpen} onOpenChange={setLayerStyleOpen} />
      <WarpTextDialog open={warpTextOpen} onOpenChange={setWarpTextOpen} />
      <LayerCompsDialog open={layerCompsOpen} onOpenChange={setLayerCompsOpen} />
      <ColorLabelsDialog open={colorLabelsOpen} onOpenChange={setColorLabelsOpen} />
      <FitImageDialog open={fitImageOpen} onOpenChange={setFitImageOpen} />
      <ExportAsDialog open={exportAsOpen} onOpenChange={setExportAsOpen} initial={exportAsInitial} />
      <BatchExportDialog open={batchExportOpen} onOpenChange={setBatchExportOpen} initial={batchExportInitial} />
      <BatchProcessingDialog open={batchProcessingOpen} onOpenChange={setBatchProcessingOpen} />
      <ImageProcessorDialog open={imageProcessorOpen} onOpenChange={setImageProcessorOpen} initial={imageProcessorInitial} />
      <CropAndStraightenDialog open={cropAndStraightenOpen} onOpenChange={setCropAndStraightenOpen} />
      <PdfImportDialog open={pdfImportOpen} onOpenChange={setPdfImportOpen} />
      <DocumentReportDialog open={documentReportOpen} onOpenChange={setDocumentReportOpen} />
      <PreflightDialog open={preflightOpen} onOpenChange={setPreflightOpen} />
      <GridSettingsDialog open={gridSettingsOpen} onOpenChange={setGridSettingsOpen} />
      <NewGuideDialog open={newGuideOpen} onOpenChange={setNewGuideOpen} />
      <GuideLayoutDialog open={guideLayoutOpen} onOpenChange={setGuideLayoutOpen} />
      <ContactSheetDialog open={contactSheetOpen} onOpenChange={setContactSheetOpen} />
      <PhotomergeDialog open={photomergeOpen} onOpenChange={setPhotomergeOpen} />
      <FileInfoDialog open={fileInfoOpen} onOpenChange={setFileInfoOpen} />
      <RevealSourceDialog
        open={revealSourceOpen}
        onOpenChange={(value) => {
          setRevealSourceOpen(value)
          if (!value) setRevealSourceDocId(null)
        }}
        docId={revealSourceDocId}
      />
      <ShadowsHighlightsDialog open={shadowsHighlightsOpen} onOpenChange={setShadowsHighlightsOpen} />
      <HdrToningDialog open={hdrToningOpen} onOpenChange={setHdrToningOpen} />
      <MatchColorDialog open={matchColorOpen} onOpenChange={setMatchColorOpen} />
      <ReplaceColorDialog open={replaceColorOpen} onOpenChange={setReplaceColorOpen} />
      <EqualizePromptDialog open={equalizePromptOpen} onOpenChange={setEqualizePromptOpen} />
      <AutoOptionsDialog
        open={autoOptions !== null}
        onOpenChange={(v) => { if (!v) setAutoOptions(null) }}
        initialAlgorithm={autoOptions?.algorithm}
        label={autoOptions?.label}
      />
      <AdvancedSubsystemsDialog
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        initialTab={advancedTab}
        initialColorWorkflow={advancedColorWorkflow}
      />
      <AlgorithmicOperationsDialog open={algorithmOpen} onOpenChange={setAlgorithmOpen} />
      <GapWorkflowDialog workflow={gapWorkflow} onOpenChange={(open) => !open && setGapWorkflow(null)} />
      <WorkflowPackDialog workflowId={workflowPack} onOpenChange={(open) => !open && setWorkflowPack(null)} />
      <ColorModeDialog target={colorModeTarget} onOpenChange={(open) => !open && setColorModeTarget(null)} />
      <PreferencesDialog open={preferencesOpen} onOpenChange={setPreferencesOpen} />
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <MenuCustomizationDialog open={menuCustomizationOpen} onOpenChange={setMenuCustomizationOpen} />
      <PresetManagerDialog open={presetManagerOpen} onOpenChange={setPresetManagerOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <LargeDocumentRecoveryDialog
        open={!!largeDocumentRecovery}
        onOpenChange={(open) => {
          if (!open) closeLargeDocumentRecovery()
        }}
        plan={largeDocumentRecovery?.plan ?? null}
        busy={largeDocumentRecoveryBusy}
        onOpenReduced={() => void openLargeDocumentReduced()}
        onOpenTileOnly={() => void openLargeDocumentTileOnly()}
        onInspect={inspectLargeDocument}
      />
      <FilterGalleryDialog open={filterGalleryOpen} onOpenChange={setFilterGalleryOpen} />
      <CameraRawDialog open={cameraRawOpen} onOpenChange={setCameraRawOpen} />
      <SelectAndMaskDialog open={selectMaskOpen} onOpenChange={setSelectMaskOpen} />
      <RecentDocumentsDialog
        open={recentManagerOpen}
        onOpenChange={setRecentManagerOpen}
        recents={recentDocuments}
        onOpenRecent={openRecent}
        onRemoveRecent={removeRecent}
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
      <AlertDialog
        open={pendingPurge !== null}
        onOpenChange={(open) => { if (!open) setPendingPurge(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingPurgeTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingPurge
                setPendingPurge(null)
                if (target) executePurge(target)
              }}
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SaveSelectionDialog open={saveSelectionOpen} onOpenChange={setSaveSelectionOpen} />
      <LoadSelectionDialog open={loadSelectionOpen} onOpenChange={setLoadSelectionOpen} />
    </>
  )
}
