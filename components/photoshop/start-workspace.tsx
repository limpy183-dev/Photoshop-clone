"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  BookOpen,
  Clock3,
  ExternalLink,
  FileImage,
  FolderOpen,
  Grid2X2,
  Home,
  ImagePlus,
  PanelTop,
  Pin,
  PinOff,
  Sparkles,
} from "lucide-react"
import { buildLearningIndex, type LearningIndexItem } from "./learning-index"
import {
  estimateDocumentMemoryMb,
  NEW_DOCUMENT_PRESET_GROUPS,
  NEW_DOCUMENT_PRESETS,
  type NewDocumentPreset,
} from "./new-document-presets"
import { readRecentDocuments, type RecentDocument } from "./recent-documents"
import { STARTUP_IMAGE_IMPORT_PARAM, writeStartupImageImport } from "./startup-file-handoff"

const PINNED_DOCUMENTS_KEY = "ps-pinned-documents-v1"

const FEATURED_PRESET_NAMES = new Set([
  "Default Canvas",
  "Photo 6 x 4 in",
  "A4",
  "HD 1920 x 1080",
  "Phone Portrait",
  "Square Social",
  "4K UHD",
])

const LEARNING_LINK_IDS = [
  "workflow-selection-mask",
  "command-export-as",
  "workflow-review-export",
  "doc-browser-limits",
]

function presetHref(name: string) {
  const params = new URLSearchParams({ preset: name })
  return `/editor?${params.toString()}`
}

function learnHref(id: string) {
  const params = new URLSearchParams({ learn: id })
  return `/editor?${params.toString()}`
}

function formatDate(value: number) {
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(value)
  } catch {
    return "Recent"
  }
}

function readPinnedDocumentIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_DOCUMENTS_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

function writePinnedDocumentIds(ids: string[]) {
  localStorage.setItem(PINNED_DOCUMENTS_KEY, JSON.stringify([...new Set(ids)]))
}

function useStartDocuments() {
  const [recents, setRecents] = React.useState<RecentDocument[]>([])
  const [pinnedIds, setPinnedIds] = React.useState<string[]>([])

  const refresh = React.useCallback(() => {
    setRecents(readRecentDocuments())
    setPinnedIds(readPinnedDocumentIds())
  }, [])

  React.useEffect(() => {
    refresh()
    const handleStorage = () => refresh()
    window.addEventListener("ps-recents-changed", handleStorage)
    window.addEventListener("storage", handleStorage)
    return () => {
      window.removeEventListener("ps-recents-changed", handleStorage)
      window.removeEventListener("storage", handleStorage)
    }
  }, [refresh])

  const togglePin = React.useCallback((id: string) => {
    setPinnedIds((current) => {
      const next = current.includes(id) ? current.filter((candidate) => candidate !== id) : [id, ...current]
      writePinnedDocumentIds(next)
      return next
    })
  }, [])

  return { recents, pinnedIds, togglePin }
}

export function StartWorkspace() {
  const router = useRouter()
  const { recents, pinnedIds, togglePin } = useStartDocuments()
  const imageInputRef = React.useRef<HTMLInputElement>(null)
  const pinnedSet = React.useMemo(() => new Set(pinnedIds), [pinnedIds])
  const pinned = React.useMemo(
    () => pinnedIds.map((id) => recents.find((recent) => recent.id === id)).filter((recent): recent is RecentDocument => !!recent),
    [pinnedIds, recents],
  )
  const learningLinks = React.useMemo(() => {
    const index = buildLearningIndex()
    return LEARNING_LINK_IDS.map((id) => index.find((item) => item.id === id)).filter((item): item is LearningIndexItem => !!item)
  }, [])

  const openRecent = React.useCallback((recent: RecentDocument) => {
    const params = new URLSearchParams({ recent: recent.id })
    router.push(`/editor?${params.toString()}`)
  }, [router])

  const openImagePicker = React.useCallback(() => {
    imageInputRef.current?.click()
  }, [])

  const importImageFile = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return
    try {
      const importId = await writeStartupImageImport(file)
      const params = new URLSearchParams({ [STARTUP_IMAGE_IMPORT_PARAM]: importId })
      router.push(`/editor?${params.toString()}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open image")
    }
  }, [router])

  return (
    <main className="min-h-screen bg-[var(--ps-chrome)] text-[var(--ps-text)]">
      <div className="grid min-h-screen grid-cols-[72px_minmax(0,1fr)]">
        <aside className="border-r border-[var(--ps-divider)] bg-[#181818]">
          <div className="flex h-16 items-center justify-center border-b border-[var(--ps-divider)]">
            <img
              src="/photoshop-web-logo.svg"
              alt="Photoshop web logo"
              className="h-9 w-9 rounded-sm"
              draggable={false}
            />
          </div>
          <nav aria-label="Start workspace" className="flex flex-col gap-1 p-2">
            <a className="flex h-11 items-center justify-center rounded-sm bg-[var(--ps-tool-active)] text-white" href="#home" aria-label="Home">
              <Home className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={openImagePicker}
              className="flex h-11 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
              aria-label="Open image"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <Link className="flex h-11 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]" href="/documentation" aria-label="Documentation">
              <BookOpen className="h-4 w-4" />
            </Link>
            <input
              ref={imageInputRef}
              data-testid="start-open-image-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void importImageFile(event)}
            />
          </nav>
        </aside>

        <section id="home" className="flex min-h-screen flex-col">
          <header className="flex min-h-16 items-center justify-between border-b border-[var(--ps-divider)] bg-[var(--ps-panel)] px-5">
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold leading-tight text-white">Home</h1>
              <div className="mt-0.5 text-[11px] text-[var(--ps-text-dim)]">Start a document, reopen recent work, or jump into a focused workflow.</div>
            </div>
            <Link
              href="/editor"
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 text-[12px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
            >
              <PanelTop className="h-4 w-4" />
              Open editor
            </Link>
          </header>

          <div className="grid flex-1 grid-cols-[minmax(0,1fr)_340px] gap-0 max-lg:grid-cols-1">
            <div className="min-w-0 border-r border-[var(--ps-divider)] max-lg:border-r-0">
              <section id="new-document" className="border-b border-[var(--ps-divider)] px-5 py-5">
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--ps-accent-2)]">
                      <Grid2X2 className="h-3.5 w-3.5" />
                      First-run workspace
                    </div>
                    <h2 className="text-[17px] font-semibold text-white">New document</h2>
                  </div>
                  <Link href={presetHref("Default Canvas")} className="inline-flex h-8 items-center gap-2 rounded-sm bg-[var(--ps-accent)] px-3 text-[12px] text-white hover:bg-[var(--ps-accent-2)]">
                    <ImagePlus className="h-4 w-4" />
                    New file
                  </Link>
                </div>

                <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-4 max-md:grid-cols-1">
                  <div className="space-y-1">
                    {NEW_DOCUMENT_PRESET_GROUPS.map((group) => (
                      <a
                        key={group}
                        href={`#preset-${group}`}
                        className="flex h-8 items-center justify-between rounded-sm px-2 text-[11px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
                      >
                        <span>{group}</span>
                        <span className="text-[10px]">{NEW_DOCUMENT_PRESETS.filter((preset) => preset.group === group).length}</span>
                      </a>
                    ))}
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
                    {NEW_DOCUMENT_PRESETS.filter((preset) => FEATURED_PRESET_NAMES.has(preset.name)).map((preset) => (
                      <PresetTile key={preset.name} preset={preset} />
                    ))}
                  </div>
                </div>
              </section>

              <section className="px-5 py-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[17px] font-semibold text-white">Recent files</h2>
                    <div className="mt-1 text-[11px] text-[var(--ps-text-dim)]">{recents.length ? `${recents.length} available in this browser` : "No recent files yet"}</div>
                  </div>
                </div>
                <div data-testid="start-recent-grid" className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                  {recents.length ? (
                    recents.map((recent) => (
                      <RecentTile
                        key={recent.id}
                        recent={recent}
                        pinned={pinnedSet.has(recent.id)}
                        onOpen={() => openRecent(recent)}
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
                  <h2 className="text-[15px] font-semibold text-white">Pinned files</h2>
                </div>
                <div data-testid="start-pinned-files" className="space-y-2">
                  {pinned.length ? (
                    pinned.map((recent) => (
                      <PinnedFile
                        key={recent.id}
                        recent={recent}
                        onOpen={() => openRecent(recent)}
                        onTogglePin={() => togglePin(recent.id)}
                      />
                    ))
                  ) : (
                    <div data-testid="start-pinned-empty" className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-3 py-6 text-center text-[11px] text-[var(--ps-text-dim)]">
                      Pin a recent file to keep it at the top of Home.
                    </div>
                  )}
                </div>
              </section>

              <section id="learn">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#f5c451]" />
                  <h2 className="text-[15px] font-semibold text-white">Learn</h2>
                </div>
                <div className="space-y-2">
                  {learningLinks.map((item) => (
                    <Link
                      key={item.id}
                      href={learnHref(item.id)}
                      className="group block rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-3 py-3 hover:border-[var(--ps-accent)] hover:bg-[var(--ps-panel-2)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium text-white">{item.title}</div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--ps-text-dim)]">{item.description}</div>
                        </div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ps-text-dim)] group-hover:text-[var(--ps-accent-2)]" />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </section>
      </div>
    </main>
  )
}

function PresetTile({ preset }: { preset: NewDocumentPreset }) {
  return (
    <Link
      id={`preset-${preset.group}`}
      href={presetHref(preset.name)}
      aria-label={`Create ${preset.name}`}
      className="group flex min-h-52 flex-col justify-between rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-4 hover:border-[var(--ps-accent)] hover:bg-[var(--ps-panel-2)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold text-white">{preset.name}</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--ps-text-dim)]">{preset.group}</div>
        </div>
        <ImagePlus className="h-5 w-5 shrink-0 text-[var(--ps-text-dim)] group-hover:text-[var(--ps-accent-2)]" />
      </div>
      <div>
        <PresetPreview preset={preset} />
        <div className="mt-3 flex items-center justify-between text-[12px] text-[var(--ps-text-dim)]">
          <span>{preset.w} x {preset.h}</span>
          <span>{estimateDocumentMemoryMb(preset.w, preset.h, preset.bitDepth).toFixed(0)} MB</span>
        </div>
      </div>
    </Link>
  )
}

function PresetPreview({ preset }: { preset: NewDocumentPreset }) {
  const ratio = Math.max(0.45, Math.min(1.65, preset.w / preset.h))
  return (
    <div className="flex h-32 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[#121212]">
      <div
        className="border border-[var(--ps-divider)] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
        style={{
          width: `${Math.min(170, 90 * ratio)}px`,
          height: `${Math.min(112, 104 / ratio)}px`,
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
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${recent.name}`}
        className="block w-full text-left"
      >
        <DocumentThumbnail recent={recent} large />
        <div className="px-3 pb-3 pt-2">
          <div className="truncate text-[12px] font-medium text-white">{recent.name}</div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--ps-text-dim)]">
            <span className="uppercase">{recent.kind}</span>
            <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDate(recent.updatedAt)}</span>
          </div>
        </div>
      </button>
      <div className="border-t border-[var(--ps-divider)] px-2 py-1.5">
        <button
          type="button"
          onClick={onTogglePin}
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
