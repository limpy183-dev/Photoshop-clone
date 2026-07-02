"use client"

import type * as React from "react"
import { toast } from "sonner"
import {
  MenubarCheckboxItem as DropdownMenuCheckboxItem,
  MenubarContent as DropdownMenuContent,
  MenubarItem as DropdownMenuItem,
  MenubarMenu as DropdownMenu,
  MenubarSeparator as DropdownMenuSeparator,
  MenubarShortcut as DropdownMenuShortcut,
  MenubarSub as DropdownMenuSub,
  MenubarSubContent as DropdownMenuSubContent,
  MenubarSubTrigger as DropdownMenuSubTrigger,
  MenubarTrigger as DropdownMenuTrigger,
} from "@/components/ui/menubar"
import { compositeLayer } from "../blend-modes"
import { makeCanvas } from "../canvas-utils"
import { dispatchPhotoshopEvent } from "../events"
import type { Action } from "../editor-context"
import type { PsDocument } from "../types"
import type { AdvancedSubsystemTab, ColorWorkflowMode } from "../advanced-subsystems-dialog"
import type { GapWorkflowKind } from "../gap-workflow-dialog"
import type { RecentDocument } from "../recent-documents"
import { WORKFLOW_PACKS, type WorkflowPackId } from "../workflow-presets"

export {
  LINKED_SMART_OBJECT_POLL_MS,
  MENU_TRIGGER_CLASS,
  cloneLayerStyle,
  pluginCommandUnavailable,
  smartLinkFingerprint,
  type OpenPickerWindow,
  type ReadableFileHandle,
  type SaveMode,
  type SavePickerWindow,
} from "./menu-workflows"

type SetValue<T> = React.Dispatch<React.SetStateAction<T>>

export interface FileMenuProps {
  menuClass: string
  onOpenNew: () => void
  openImageOrPsd: () => void
  openProject: () => void
  recentDocuments: RecentDocument[]
  openRecent: (recent: RecentDocument) => void | Promise<void>
  setRecentManagerOpen: SetValue<boolean>
  clearRecentDocuments: () => void
  activeDoc: PsDocument | null
  requestCloseDocument: (id?: string) => void
  duplicateDocument: (id?: string) => void
  closeOtherDocumentsFromMenu: () => void
  reopenClosedDocumentFromMenu: () => void
  exportImage: (format: "png" | "jpg") => void
  saveProject: () => void
  savePsd: () => void | Promise<void>
  savePsb: () => void | Promise<void>
  placeEmbedded: () => void
  setContactSheetOpen: SetValue<boolean>
  setWorkflowPack: SetValue<WorkflowPackId | null>
  openAdvancedTab: (tab: AdvancedSubsystemTab, colorWorkflow?: ColorWorkflowMode) => void
  setGapWorkflow: SetValue<GapWorkflowKind | null>
  setPhotomergeOpen: SetValue<boolean>
  setPdfImportOpen: SetValue<boolean>
  setCropAndStraightenOpen: SetValue<boolean>
  dispatch: React.Dispatch<Action>
  setBatchProcessingOpen: SetValue<boolean>
  setImageProcessorOpen: SetValue<boolean>
  setExportAsInitial: SetValue<unknown>
  setExportAsOpen: SetValue<boolean>
  setBatchExportInitial: SetValue<unknown>
  setBatchExportOpen: SetValue<boolean>
  setFileInfoOpen: SetValue<boolean>
  revealDocumentSourceFromMenu: () => void | Promise<void>
  setPreflightOpen: SetValue<boolean>
  setDocumentReportOpen: SetValue<boolean>
}

export function FileMenu(props: FileMenuProps) {
  const {
    menuClass, onOpenNew, openImageOrPsd, openProject, recentDocuments, openRecent, setRecentManagerOpen,
    clearRecentDocuments, activeDoc, requestCloseDocument, duplicateDocument, closeOtherDocumentsFromMenu,
    reopenClosedDocumentFromMenu, exportImage, saveProject, savePsd, savePsb, placeEmbedded, setContactSheetOpen,
    setWorkflowPack, openAdvancedTab, setGapWorkflow, setPhotomergeOpen, setPdfImportOpen, setCropAndStraightenOpen,
    dispatch, setBatchProcessingOpen, setImageProcessorOpen, setExportAsInitial, setExportAsOpen, setBatchExportInitial,
    setBatchExportOpen, setFileInfoOpen, revealDocumentSourceFromMenu, setPreflightOpen, setDocumentReportOpen,
  } = props

  return (
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
    <DropdownMenuItem onSelect={savePsb} disabled={!activeDoc}>
    Save As PSB...
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={placeEmbedded} disabled={!activeDoc}>
    Place Embedded…
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setContactSheetOpen(true)}>
    Contact Sheet II…
    </DropdownMenuItem>
    <DropdownMenuSub>
    <DropdownMenuSubTrigger>Workflow Packs</DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
    {WORKFLOW_PACKS.map((pack) => (
    <DropdownMenuItem key={pack.id} onSelect={() => setWorkflowPack(pack.id)}>
    {pack.title}...
    </DropdownMenuItem>
    ))}
    </DropdownMenuSubContent>
    </DropdownMenuSub>
    <DropdownMenuSub>
    <DropdownMenuSubTrigger>Automate</DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
    <DropdownMenuItem onSelect={() => openAdvancedTab("automation")} disabled={!activeDoc}>Automation Manager...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => openAdvancedTab("automation")} disabled={!activeDoc}>Droplets...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => openAdvancedTab("automation")} disabled={!activeDoc}>Script Events Manager...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => openAdvancedTab("automation")} disabled={!activeDoc}>Conditional Actions...</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={() => setGapWorkflow("load-stack")}>Load Files into Stack...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setPhotomergeOpen(true)}>Photomerge...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setGapWorkflow("hdr-merge")}>Merge to HDR Pro...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setGapWorkflow("focus-stack")}>Focus Stack...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setGapWorkflow("stack-statistics")}>Statistics...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setGapWorkflow("pdf-presentation")}>PDF Presentation...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setPdfImportOpen(true)}>Import PDF...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setGapWorkflow("image-assets")}>Generate Image Assets...</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setCropAndStraightenOpen(true)}>Crop and Straighten Photos...</DropdownMenuItem>
    </DropdownMenuSubContent>
    </DropdownMenuSub>
    <DropdownMenuSub>
    <DropdownMenuSubTrigger disabled={!activeDoc}>Generate</DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
    <DropdownMenuCheckboxItem
    checked={activeDoc?.metadata?.imageAssetGenerator?.enabled !== false}
    onCheckedChange={(value) => {
    if (!activeDoc) return
    dispatch({
    type: "set-document-metadata",
    metadata: {
    ...(activeDoc.metadata ?? {}),
    imageAssetGenerator: {
    ...(activeDoc.metadata?.imageAssetGenerator ?? {}),
    enabled: value === true,
    },
    },
    })
    }}
    >
    Image Assets
    </DropdownMenuCheckboxItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem
    disabled={!activeDoc}
    onSelect={() => {
    if (!activeDoc) return
    dispatchPhotoshopEvent("ps-image-assets-generator-run", { docId: activeDoc.id })
    }}
    >
    Run Image Assets Now
    </DropdownMenuItem>
    <DropdownMenuItem
    disabled={!activeDoc}
    onSelect={() => {
    if (!activeDoc) return
    const picker = (window as typeof window & {
    showDirectoryPicker?: () => Promise<{ name?: string }>
    }).showDirectoryPicker
    if (!picker) {
    toast.error("Folder auto-export requires File System Access support.")
    return
    }
    void (async () => {
    try {
    const directoryHandle = await picker()
    dispatchPhotoshopEvent("ps-image-assets-generator-directory", { docId: activeDoc.id, directoryHandle })
    dispatch({
    type: "set-document-metadata",
    metadata: {
    ...(activeDoc.metadata ?? {}),
    imageAssetGenerator: {
    ...(activeDoc.metadata?.imageAssetGenerator ?? {}),
    outputFolderName: directoryHandle.name ?? "Selected folder",
    },
    },
    })
    } catch (err) {
    if (!(err instanceof DOMException && err.name === "AbortError")) {
    toast.error(err instanceof Error ? err.message : "Could not connect folder")
    }
    }
    })()
    }}
    >
    Choose Output Folder…
    {activeDoc?.metadata?.imageAssetGenerator?.outputFolderName ? (
    <DropdownMenuShortcut>{activeDoc.metadata.imageAssetGenerator.outputFolderName}</DropdownMenuShortcut>
    ) : null}
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuCheckboxItem
    checked={activeDoc?.metadata?.imageAssetGenerator?.autoExportOnSave !== false}
    onCheckedChange={(value) => {
    if (!activeDoc) return
    dispatch({
    type: "set-document-metadata",
    metadata: {
    ...(activeDoc.metadata ?? {}),
    imageAssetGenerator: {
    ...(activeDoc.metadata?.imageAssetGenerator ?? {}),
    autoExportOnSave: value === true,
    },
    },
    })
    }}
    >
    Auto-export on save
    </DropdownMenuCheckboxItem>
    <DropdownMenuCheckboxItem
    checked={activeDoc?.metadata?.imageAssetGenerator?.autoExportOnChange === true}
    onCheckedChange={(value) => {
    if (!activeDoc) return
    dispatch({
    type: "set-document-metadata",
    metadata: {
    ...(activeDoc.metadata ?? {}),
    imageAssetGenerator: {
    ...(activeDoc.metadata?.imageAssetGenerator ?? {}),
    autoExportOnChange: value === true,
    },
    },
    })
    }}
    >
    Auto-export on change
    </DropdownMenuCheckboxItem>
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
    <DropdownMenuItem onSelect={() => void revealDocumentSourceFromMenu()} disabled={!activeDoc}>
    Reveal Source…
    </DropdownMenuItem>
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
    const win = window.open("about:blank", "_blank")
    if (!win) return
    try { (win as Window & { opener: Window | null }).opener = null } catch {}
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
  )
}
