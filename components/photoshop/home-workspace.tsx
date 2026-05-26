"use client"

import * as React from "react"
import {
  BookOpen,
  Clock3,
  ExternalLink,
  FileImage,
  FilePlus2,
  FolderOpen,
  Grid2X2,
  Home,
  ImagePlus,
  Pin,
  PinOff,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { makeHistoryEntry, useEditor } from "./editor-context"
import { deserializeProject } from "./document-io"
import { buildLearningIndex, runLearningIndexItem, type LearningIndexItem } from "./learning-index"
import {
  estimateDocumentMemoryMb,
  NEW_DOCUMENT_PRESET_GROUPS,
  NEW_DOCUMENT_PRESETS,
  type NewDocumentPreset,
} from "./new-document-presets"
import {
  loadPreferencesFromStorage,
  togglePinnedFile,
} from "./preferences-engine"
import {
  readRecentDocuments,
  rememberRecentDocument,
  type RecentDocument,
} from "./recent-documents"
import { createDocumentFromPreset } from "./startup-documents"
import type { DocumentFileKind, DocumentStorageKind } from "./editor-context"

// Featured-preset names surfaced as large tiles on the Home grid. Picked to
// give one anchor per preset group so first-run users see the full breadth
// of available canvas sizes without scrolling through the full list.
const FEATURED_PRESET_NAMES = new Set([
  "Default Canvas",
  "Photo 6 x 4 in",
  "A4",
  "HD 1920 x 1080",
  "Phone Portrait",
  "Square Social",
  "4K UHD",
])

// Curated learning-index IDs tied to the existing Learn/Discover panel data.
// Kept in sync with start-workspace.tsx so the editor-side Home surface and
// the marketing-route start screen point users at the same first-look set.
const LEARNING_LINK_IDS = [
  "workflow-selection-mask",
  "command-export-as",
  "workflow-review-export",
  "doc-browser-limits",
]

// Photoshop-style preset categories the gap report calls out (Photo, Print,
// Art & Illustration, Web, Mobile, Film & Video). Mapped onto the existing
// new-document preset groups so the gallery uses the same data source as the
// New Document dialog and the marketing Start screen.
type HomeCategory = {
  id: string
  label: string
  groups: ReadonlyArray<NewDocumentPreset["group"]>
}

const HOME_CATEGORIES: HomeCategory[] = [
  { id: "photo", label: "Photo", groups: ["Photo"] },
  { id: "print", label: "Print", groups: ["Print"] },
  { id: "art", label: "Art & Illustration", groups: ["Recent", "Icon"] },
  { id: "web", label: "Web", groups: ["Web"] },
  { id: "mobile", label: "Mobile", groups: ["Mobile", "Social"] },
  { id: "film", label: "Film & Video", groups: ["Film"] },
]

function formatDate(value: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(value)
  } catch {
    return "Recent"
  }
}

function presetsForCategory(category: HomeCategory): NewDocumentPreset[] {
  const groups = new Set<NewDocumentPreset["group"]>(category.groups)
  return NEW_DOCUMENT_PRESETS.filter((preset) => groups.has(preset.group))
}

function useHomeData() {
  const [recents, setRecents] = React.useState<RecentDocument[]>([])
  const [pinnedIds, setPinnedIds] = React.useState<string[]>([])

  const refresh = React.useCallback(() => {
    setRecents(readRecentDocuments())
    setPinnedIds(loadPreferencesFromStorage().pinnedFiles)
  }, [])

  React.useEffect(() => {
    refresh()
    const handleRecents = () => setRecents(readRecentDocuments())
    const handlePrefs = () => setPinnedIds(loadPreferencesFromStorage().pinnedFiles)
    window.addEventListener("ps-recents-changed", handleRecents)
    window.addEventListener("ps-preferences-changed", handlePrefs)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener("ps-recents-changed", handleRecents)
      window.removeEventListener("ps-preferences-changed", handlePrefs)
      window.removeEventListener("storage", refresh)
    }
  }, [refresh])

  const togglePin = React.useCallback((id: string) => {
    setPinnedIds(togglePinnedFile(id))
  }, [])

  return { recents, pinnedIds, togglePin }
}

export interface HomeWorkspaceProps {
  onOpenNew: () => void
  onClose?: () => void
  onOpenFile?: () => void
}

/**
 * Photoshop-style Home / Start workspace.
 *
 * Mounted inside the editor when no documents are open or when the user
 * toggles the Home view from Window ▸ Home. Reuses the existing
 * new-document presets, recent-documents store, and learning index so the
 * Home surface stays in sync with the rest of the app's data sources.
 */
export function HomeWorkspace({ onOpenNew, onClose, onOpenFile }: HomeWorkspaceProps) {
  const { dispatch, requestRender } = useEditor()
  const { recents, pinnedIds, togglePin } = useHomeData()
  const [category, setCategory] = React.useState<HomeCategory>(HOME_CATEGORIES[0])

  const pinnedSet = React.useMemo(() => new Set(pinnedIds), [pinnedIds])
  const pinned = React.useMemo(
    () =>
      pinnedIds
        .map((id) => recents.find((recent) => recent.id === id))
        .filter((recent): recent is RecentDocument => !!recent),
    [pinnedIds, recents],
  )

  const learningLinks = React.useMemo(() => {
    const index = buildLearningIndex()
    return LEARNING_LINK_IDS.map((id) => index.find((item) => item.id === id)).filter(
      (item): item is LearningIndexItem => !!item,
    )
  }, [])

  const openPreset = React.useCallback(
    (preset: NewDocumentPreset) => {
      const doc = createDocumentFromPreset(preset)
      dispatch({
        type: "replace-startup-document",
        doc,
        entry: makeHistoryEntry(doc, `New ${preset.name}`),
        lifecycle: { storage: "new" },
      })
      requestRender()
      onClose?.()
    },
    [dispatch, requestRender, onClose],
  )

  const openRecent = React.useCallback(
    async (recent: RecentDocument) => {
      try {
        const doc = await deserializeProject(recent.serialized)
        const fileKind: DocumentFileKind =
          recent.kind === "psd" ? "psd" : recent.kind === "image" ? "image" : "project"
        const storage: DocumentStorageKind = recent.storage ?? "snapshot"
        dispatch({
          type: "replace-startup-document",
          doc,
          entry: makeHistoryEntry(doc, "Open Recent"),
          lifecycle: {
            fileName: recent.fileName ?? recent.name,
            fileKind,
            storage,
          },
        })
        rememberRecentDocument({ ...recent, updatedAt: Date.now() })
        requestRender()
        onClose?.()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not open recent document")
      }
    },
    [dispatch, requestRender, onClose],
  )

  const runLearningItem = React.useCallback(
    (item: LearningIndexItem) => {
      runLearningIndexItem(item)
      onClose?.()
    },
    [onClose],
  )

  const handleOpenFile = React.useCallback(() => {
    if (onOpenFile) {
      onOpenFile()
      return
    }
    // The menu-bar owns the File-System-Access pickers. Dispatching a
    // window event lets Home trigger the same flow without duplicating the
    // PSD/raster/project detection logic.
    window.dispatchEvent(new CustomEvent("ps-open-file"))
  }, [onOpenFile])

  const categoryPresets = React.useMemo(() => presetsForCategory(category), [category])

  return (
    <div
      data-home-workspace
      role="region"
      aria-label="Home workspace"
      className="flex min-h-0 flex-1 flex-col overflow-auto bg-[var(--ps-chrome)] text-[var(--ps-text)]"
    >
      <header className="flex min-h-14 items-center justify-between border-b border-[var(--ps-divider)] bg-[var(--ps-panel)] px-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-[var(--ps-accent)] text-white">
            <Home className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold leading-tight text-white">Home</h1>
            <div className="mt-0.5 text-[11px] text-[var(--ps-text-dim)]">
              Start a new document, reopen recent work, or jump into a learning workflow.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenFile}
            className="inline-flex h-8 items-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 text-[12px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
          >
            <FolderOpen className="h-4 w-4" />
            Open File
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenNew()
              onClose?.()
            }}
            className="inline-flex h-8 items-center gap-2 rounded-sm bg-[var(--ps-accent)] px-3 text-[12px] text-white hover:bg-[var(--ps-accent-2)]"
          >
            <FilePlus2 className="h-4 w-4" />
            Create New
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_320px] gap-0 max-lg:grid-cols-1">
        <div className="min-w-0 border-r border-[var(--ps-divider)] max-lg:border-r-0">
          <section className="border-b border-[var(--ps-divider)] px-5 py-5">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--ps-accent-2)]">
                  <Grid2X2 className="h-3.5 w-3.5" />
                  New document presets
                </div>
                <h2 className="text-[15px] font-semibold text-white">{category.label}</h2>
              </div>
              <div className="text-[10px] text-[var(--ps-text-dim)]">
                {NEW_DOCUMENT_PRESET_GROUPS.length} preset groups available
              </div>
            </div>

            <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-4 max-md:grid-cols-1">
              <nav aria-label="Preset categories" className="space-y-1">
                {HOME_CATEGORIES.map((entry) => {
                  const presetCount = presetsForCategory(entry).length
                  const active = entry.id === category.id
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setCategory(entry)}
                      aria-pressed={active}
                      className={
                        "flex h-8 w-full items-center justify-between rounded-sm px-2 text-[11px] " +
                        (active
                          ? "bg-[var(--ps-tool-active)] text-white"
                          : "text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]")
                      }
                    >
                      <span>{entry.label}</span>
                      <span className="text-[10px]">{presetCount}</span>
                    </button>
                  )
                })}
              </nav>
              <div
                data-testid="home-preset-grid"
                className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3"
              >
                {categoryPresets.length ? (
                  categoryPresets.map((preset) => (
                    <PresetTile
                      key={preset.name}
                      preset={preset}
                      featured={FEATURED_PRESET_NAMES.has(preset.name)}
                      onSelect={() => openPreset(preset)}
                    />
                  ))
                ) : (
                  <div className="col-span-full flex min-h-24 items-center justify-center rounded-sm border border-dashed border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[11px] text-[var(--ps-text-dim)]">
                    No presets in this category.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="px-5 py-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-white">Recent files</h2>
                <div className="mt-1 text-[11px] text-[var(--ps-text-dim)]">
                  {recents.length ? `${recents.length} available in this browser` : "No recent files yet"}
                </div>
              </div>
            </div>
            <div
              data-testid="home-recent-grid"
              className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3"
            >
              {recents.length ? (
                recents.map((recent) => (
                  <RecentTile
                    key={recent.id}
                    recent={recent}
                    pinned={pinnedSet.has(recent.id)}
                    onOpen={() => void openRecent(recent)}
                    onTogglePin={() => togglePin(recent.id)}
                  />
                ))
              ) : (
                <div className="col-span-full flex min-h-36 items-center justify-center rounded-sm border border-dashed border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[11px] text-[var(--ps-text-dim)]">
                  Recent document thumbnails appear here after saving or opening files.
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-5 bg-[#1d1d1d] px-4 py-5">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Pin className="h-4 w-4 text-[var(--ps-accent-2)]" />
              <h2 className="text-[13px] font-semibold text-white">Pinned files</h2>
            </div>
            <div data-testid="home-pinned-files" className="space-y-2">
              {pinned.length ? (
                pinned.map((recent) => (
                  <PinnedFile
                    key={recent.id}
                    recent={recent}
                    onOpen={() => void openRecent(recent)}
                    onTogglePin={() => togglePin(recent.id)}
                  />
                ))
              ) : (
                <div
                  data-testid="home-pinned-empty"
                  className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-3 py-5 text-center text-[11px] text-[var(--ps-text-dim)]"
                >
                  Pin a recent file to keep it at the top of Home. Pinned files persist with your preferences.
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#f5c451]" />
              <h2 className="text-[13px] font-semibold text-white">Learn</h2>
            </div>
            <div className="space-y-2">
              {learningLinks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => runLearningItem(item)}
                  className="group block w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-3 py-3 text-left hover:border-[var(--ps-accent)] hover:bg-[var(--ps-panel-2)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-white">{item.title}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--ps-text-dim)]">
                        {item.description}
                      </div>
                    </div>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ps-text-dim)] group-hover:text-[var(--ps-accent-2)]" />
                  </div>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "discover" }))
                  onClose?.()
                }}
                className="flex h-8 w-full items-center justify-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[11px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Open Discover panel
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function PresetTile({
  preset,
  featured,
  onSelect,
}: {
  preset: NewDocumentPreset
  featured: boolean
  onSelect: () => void
}) {
  const memoryMb = estimateDocumentMemoryMb(preset.w, preset.h, preset.bitDepth)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Create ${preset.name}`}
      className={
        "group flex min-h-32 flex-col justify-between rounded-sm border bg-[var(--ps-panel)] p-3 text-left hover:border-[var(--ps-accent)] hover:bg-[var(--ps-panel-2)] " +
        (featured ? "border-[var(--ps-accent-2)]" : "border-[var(--ps-divider)]")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-white">{preset.name}</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--ps-text-dim)]">
            {preset.group}
          </div>
        </div>
        <ImagePlus className="h-4 w-4 shrink-0 text-[var(--ps-text-dim)] group-hover:text-[var(--ps-accent-2)]" />
      </div>
      <div>
        <PresetPreview preset={preset} />
        <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--ps-text-dim)]">
          <span>
            {preset.w} x {preset.h}
          </span>
          <span>{memoryMb.toFixed(0)} MB</span>
        </div>
      </div>
    </button>
  )
}

function PresetPreview({ preset }: { preset: NewDocumentPreset }) {
  const ratio = Math.max(0.45, Math.min(1.65, preset.w / preset.h))
  return (
    <div className="flex h-12 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[#121212]">
      <div
        className="border border-[var(--ps-divider)] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
        style={{
          width: `${Math.min(62, 32 * ratio)}px`,
          height: `${Math.min(42, 38 / ratio)}px`,
        }}
      />
    </div>
  )
}

function RecentTile({
  recent,
  pinned,
  onOpen,
  onTogglePin,
}: {
  recent: RecentDocument
  pinned: boolean
  onOpen: () => void
  onTogglePin: () => void
}) {
  return (
    <div className="group rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] hover:border-[var(--ps-accent)]">
      <button type="button" onClick={onOpen} aria-label={`Open ${recent.name}`} className="block w-full text-left">
        <DocumentThumbnail recent={recent} large />
        <div className="px-3 pb-3 pt-2">
          <div className="truncate text-[12px] font-medium text-white">{recent.name}</div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--ps-text-dim)]">
            <span className="uppercase">{recent.kind}</span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3 w-3" />
              {formatDate(recent.updatedAt)}
            </span>
          </div>
        </div>
      </button>
      <div className="border-t border-[var(--ps-divider)] px-2 py-1.5">
        <button
          type="button"
          onClick={onTogglePin}
          aria-pressed={pinned}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${recent.name}`}
          className="inline-flex h-7 items-center gap-2 rounded-sm px-2 text-[11px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
        >
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          {pinned ? "Unpin" : "Pin"}
        </button>
      </div>
    </div>
  )
}

function PinnedFile({
  recent,
  onOpen,
  onTogglePin,
}: {
  recent: RecentDocument
  onOpen: () => void
  onTogglePin: () => void
}) {
  return (
    <div className="grid grid-cols-[54px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2">
      <DocumentThumbnail recent={recent} />
      <button type="button" onClick={onOpen} aria-label={`Open ${recent.name}`} className="min-w-0 text-left">
        <div className="truncate text-[12px] font-medium text-white">{recent.name}</div>
        <div className="mt-0.5 text-[10px] uppercase text-[var(--ps-text-dim)]">{recent.kind}</div>
      </button>
      <button
        type="button"
        onClick={onTogglePin}
        aria-label={`Unpin ${recent.name}`}
        className="flex h-8 w-8 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
      >
        <PinOff className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function DocumentThumbnail({ recent, large = false }: { recent: RecentDocument; large?: boolean }) {
  const className = large
    ? "flex aspect-[16/10] w-full items-center justify-center border-b border-[var(--ps-divider)] bg-[#111]"
    : "flex h-11 w-[54px] items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[#111]"

  if (recent.thumbnail) {
    return (
      <div className={className}>
        <img
          src={recent.thumbnail}
          alt={`${recent.name} thumbnail`}
          className={large ? "h-full w-full object-cover" : "h-full w-full rounded-sm object-cover"}
        />
      </div>
    )
  }

  return (
    <div className={className}>
      {recent.kind === "image" ? (
        <FileImage className="h-5 w-5 text-[var(--ps-text-dim)]" />
      ) : (
        <FolderOpen className="h-5 w-5 text-[var(--ps-text-dim)]" />
      )}
    </div>
  )
}
