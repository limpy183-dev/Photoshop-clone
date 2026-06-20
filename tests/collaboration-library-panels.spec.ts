import { expect, test } from "@playwright/test"

import {
  appendThreadReply,
  createReviewPacketEntries,
  createReviewPacketJson,
  createReviewReport,
  createReviewThread,
  normalizeAnnotationGeometry,
  setThreadResolved,
} from "../components/photoshop/collaboration"
import {
  collectAssetTags,
  createAssetLibraryBundle,
  filterAssetLibrary,
} from "../components/photoshop/asset-library-bundles"
import { filterLocalLibraryAssets, parseLibraryTagInput, type LibraryAssetRecord } from "../components/photoshop/libraries-store"
import { searchLearningIndex, buildLearningIndex } from "../components/photoshop/learning-index"
import { LEARNING_PANEL_SOURCES, learningPanelSourceIds } from "../components/photoshop/learning-panel-sources"
import { deserializeProject, serializeProject } from "../components/photoshop/document-io"
import { normalizeImportedAssetLibrary } from "../components/photoshop/panels/assets-panel"
import { __glyphsPanelInternals } from "../components/photoshop/panels/glyphs-panel"
import { __learnPanelInternals } from "../components/photoshop/panels/learn-panel"
import { __notesPanelInternals } from "../components/photoshop/panels/notes-panel"
import type { Note } from "../components/photoshop/types"
import { richFixtureDocument } from "./photoshop-fixtures"

test("project round trip preserves threaded review comments and annotation geometry", async () => {
  const doc = richFixtureDocument()
  const thread = setThreadResolved(
    appendThreadReply(
      createReviewThread({
        id: "comment_logo",
        x: 12,
        y: 16,
        author: "Mira",
        text: "Move the logo clear of the trim.",
        color: "#38bdf8",
        tags: ["Brand", "Print"],
        now: 1_800_000_000_000,
        geometry: normalizeAnnotationGeometry(
          { kind: "rect", x: 8, y: 10, w: 24, h: 18 },
          { width: doc.width, height: doc.height, anchor: { x: 12, y: 16 } },
        ),
      }),
      { id: "reply_1", author: "Dana", text: "Moved in the next comp.", now: 1_800_000_100_000 },
    ),
    true,
    { by: "Mira", now: 1_800_000_200_000 },
  )

  const restored = await deserializeProject(serializeProject({ ...doc, notes: [thread] }))

  expect(restored.notes?.[0]).toMatchObject({
    id: "comment_logo",
    kind: "comment",
    status: "resolved",
    resolvedBy: "Mira",
    tags: ["brand", "print"],
    geometry: { kind: "rect", x: 8, y: 10, w: 24, h: 18 },
    replies: [{ id: "reply_1", author: "Dana", text: "Moved in the next comp." }],
  })
})

test("review report summarizes open resolved threaded and geometric annotations", () => {
  const doc = richFixtureDocument()
  const open = createReviewThread({
    id: "comment_open",
    x: 18,
    y: 20,
    author: "Mira",
    text: "Check contrast on mobile crop.",
    color: "#38bdf8",
    tags: ["Mobile"],
    now: 1_800_000_000_000,
  })
  const resolved = setThreadResolved(
    createReviewThread({
      id: "comment_done",
      x: 4,
      y: 5,
      author: "Noah",
      text: "Replace placeholder copy.",
      color: "#22c55e",
      now: 1_800_000_010_000,
      geometry: { kind: "arrow", x1: 2, y1: 3, x2: 30, y2: 12 },
    }),
    true,
    { by: "Noah", now: 1_800_000_020_000 },
  )

  const report = createReviewReport({ ...doc, notes: [open, resolved] }, { generatedAt: "2026-05-25T10:00:00.000Z" })

  expect(report).toContain("# Review Report - Fixture Document")
  expect(report).toContain("Open: 1")
  expect(report).toContain("Resolved: 1")
  expect(report).toContain("Check contrast on mobile crop.")
  expect(report).toContain("Arrow 2, 3 -> 30, 12")
})

test("review packet export creates portable JSON and ZIP-ready entries", () => {
  const doc = richFixtureDocument()
  const open = createReviewThread({
    id: "comment_open",
    x: 18,
    y: 20,
    author: "Mira",
    text: "Check contrast on mobile crop.",
    color: "#38bdf8",
    tags: ["Mobile"],
    now: 1_800_000_000_000,
    geometry: { kind: "pin", x: 18, y: 20 },
  })
  const packet = createReviewPacketJson({ ...doc, notes: [open] }, { generatedAt: "2026-05-25T10:00:00.000Z" })
  const entries = createReviewPacketEntries({ ...doc, notes: [open] }, { generatedAt: "2026-05-25T10:00:00.000Z" })

  expect(packet).toMatchObject({
    format: "ps-review-packet",
    summary: { total: 1, open: 1, annotations: 1 },
    comments: [expect.objectContaining({ id: "comment_open", geometry: { kind: "pin", x: 18, y: 20 } })],
  })
  expect(entries.map((entry) => entry.name)).toEqual([
    "Fixture Document/manifest.json",
    "Fixture Document/review-packet.json",
    "Fixture Document/review-report.md",
  ])
  expect(new TextDecoder().decode(entries[1].data)).toContain("Check contrast on mobile crop.")
})

test("asset library bundles preserve tags and support search across tags groups and payload", () => {
  const bundle = createAssetLibraryBundle(
    [
      {
        id: "asset_brand",
        name: "Hero Blue",
        kind: "swatch",
        group: "Brand",
        tags: ["Hero", " Mobile ", "hero"],
        payload: { color: "#3366cc" },
        createdAt: 1_800_000_000_000,
      },
      {
        id: "asset_export",
        name: "Retina PNG",
        kind: "export",
        group: "Delivery",
        tags: ["handoff"],
        payload: { dialog: "export-as", format: "png", scale: 200, quality: 92, transparent: true },
        createdAt: 1_800_000_000_000,
      },
    ],
    { name: "Campaign Kit", documentName: "Fixture Document", exportedAt: "2026-05-25T10:00:00.000Z" },
  )

  const imported = normalizeImportedAssetLibrary(bundle, {
    fileSizeBytes: 1024,
    now: 1_800_000_500_000,
    makeId: (prefix, index) => `${prefix}_${index}`,
  })

  expect(bundle).toMatchObject({ format: "ps-local-library", name: "Campaign Kit", documentName: "Fixture Document" })
  expect(imported[0]).toMatchObject({ name: "Hero Blue", tags: ["hero", "mobile"] })
  expect(collectAssetTags(imported)).toEqual([
    { tag: "handoff", count: 1 },
    { tag: "hero", count: 1 },
    { tag: "mobile", count: 1 },
  ])
  expect(filterAssetLibrary(imported, { query: "mobile brand" }).map((asset) => asset.id)).toEqual(["asset_brand"])
  expect(filterAssetLibrary(imported, { tag: "handoff" }).map((asset) => asset.name)).toEqual(["Retina PNG"])
})

test("learning index searches commands docs panels and workflows", () => {
  const items = buildLearningIndex({
    panels: [
      { id: "selection-studio", label: "Selection", category: "Selection", complexity: "standard", keywords: ["mask", "subject"] },
      { id: "comments", label: "Comments", category: "Collaboration and Learning", complexity: "specialized", keywords: ["review", "thread"] },
    ],
    filters: [
      { id: "box-blur", name: "Box Blur", category: "Blur", description: "Simple blur filter" },
    ],
  })

  expect(new Set(items.map((item) => item.type))).toEqual(new Set(["command", "doc", "filter", "panel", "tool", "workflow"]))
  expect(searchLearningIndex(items, "mask selection panel")[0]).toMatchObject({ id: "panel-selection-studio", type: "panel" })
  expect(searchLearningIndex(items, "brush dynamics")[0]).toMatchObject({ id: "tool-brush", type: "tool" })
  expect(searchLearningIndex(items, "export review report")[0]).toMatchObject({ id: "workflow-review-export", type: "workflow" })
  expect(searchLearningIndex(items, "project file docs").some((item) => item.type === "doc")).toBe(true)
})

test("glyphs panel lists glyphs from an embedded OpenType cmap", () => {
  const font = buildMinimalFormat4Font([0x0041, 0x03a9, 0x20ac])

  expect(__glyphsPanelInternals.parseOpenTypeCmap(font)).toEqual([0x0041, 0x03a9, 0x20ac])
  expect(
    __glyphsPanelInternals.glyphCellsFromCodepoints([0x0041, 0x20ac]).map((cell) => ({
      char: cell.char,
      hex: cell.hex,
    })),
  ).toEqual([
    { char: "A", hex: "0041" },
    { char: "€", hex: "20AC" },
  ])
})

test("local library panel filtering matches names groups tags descriptions and parses tag input", () => {
  const records: LibraryAssetRecord[] = [
    {
      id: "lib_hero",
      name: "Hero Button",
      kind: "image",
      group: "Brand",
      description: "Mobile campaign primary call to action",
      tags: ["hero", "mobile"],
      createdAt: 300,
    },
    {
      id: "lib_texture",
      name: "Paper Texture",
      kind: "image",
      group: "Textures",
      description: "Background material",
      tags: ["grain"],
      createdAt: 200,
    },
  ]

  expect(filterLocalLibraryAssets(records, { query: "hero mobile", group: "Brand" }).map((asset) => asset.id)).toEqual(["lib_hero"])
  expect(filterLocalLibraryAssets(records, { query: "background texture", group: "all" }).map((asset) => asset.id)).toEqual(["lib_texture"])
  expect(parseLibraryTagInput("Hero, Mobile\nhero,  Print Ready  ")).toEqual(["hero", "mobile", "print-ready"])
})

test("notes panel filters sticky notes separately from annotation threads", () => {
  const now = 1_800_000_000_000
  const notes: Note[] = [
    noteFixture("old", "Ada", now - 10 * 24 * 60 * 60 * 1000, "note"),
    noteFixture("new", "Ada", now - 1_000, "note"),
    noteFixture("annotation", "Ada", now - 500, "annotation"),
    noteFixture("comment", "Bo", now - 100, "comment"),
  ]

  const visible = __notesPanelInternals.filterAndSortNotes(notes, {
    authorFilter: "Ada",
    dateBucket: "week",
    sortMode: "oldest",
    now,
  })

  expect(visible.map((note) => note.id)).toEqual(["new"])
  expect(__notesPanelInternals.filterAndSortNotes(notes, { authorFilter: "all", dateBucket: "all", sortMode: "newest", now }).map((note) => note.id)).toEqual(["new", "old"])
})

test("learn and discover panels share complete panel sources for requested panel gaps", () => {
  const ids = new Set(learningPanelSourceIds())

  for (const id of ["glyphs", "notes", "libraries", "discover", "learn"]) {
    expect(ids.has(id)).toBe(true)
  }

  const indexed = buildLearningIndex({ panels: LEARNING_PANEL_SOURCES, filters: [] })
  expect(searchLearningIndex(indexed, "unicode glyphs panel")[0]).toMatchObject({ id: "panel-glyphs" })
  expect(searchLearningIndex(indexed, "sticky note timestamps")[0]).toMatchObject({ id: "panel-notes" })
  expect(searchLearningIndex(indexed, "local library gallery")[0]).toMatchObject({ id: "panel-libraries" })
})

test("learn panel exposes step-by-step guide content for panel workflows", () => {
  const guideIds = new Set(__learnPanelInternals.LEARN_GUIDES.map((guide) => guide.id))

  expect(guideIds.has("glyphs-special-characters")).toBe(true)
  expect(guideIds.has("libraries-place-asset")).toBe(true)
  expect(guideIds.has("notes-review-pass")).toBe(true)
  expect(__learnPanelInternals.LEARN_GUIDES.every((guide) => guide.steps.length >= 3)).toBe(true)
})

function noteFixture(id: string, author: string, createdAt: number, kind: Note["kind"]): Note {
  return {
    id,
    x: 12,
    y: 16,
    author,
    text: `${id} text`,
    color: "#facc15",
    kind,
    createdAt,
  }
}

function buildMinimalFormat4Font(codepoints: number[]): Uint8Array {
  const sorted = [...codepoints].sort((a, b) => a - b)
  const segCount = sorted.length + 1
  const format4Length = 16 + segCount * 8
  const cmapOffset = 28
  const subtableOffset = 12
  const cmapLength = subtableOffset + format4Length
  const font = new Uint8Array(cmapOffset + cmapLength)
  const view = new DataView(font.buffer)

  view.setUint32(0, 0x00010000)
  view.setUint16(4, 1)
  writeTag(font, 12, "cmap")
  view.setUint32(20, cmapOffset)
  view.setUint32(24, cmapLength)

  view.setUint16(cmapOffset, 0)
  view.setUint16(cmapOffset + 2, 1)
  view.setUint16(cmapOffset + 4, 3)
  view.setUint16(cmapOffset + 6, 1)
  view.setUint32(cmapOffset + 8, subtableOffset)

  const table = cmapOffset + subtableOffset
  view.setUint16(table, 4)
  view.setUint16(table + 2, format4Length)
  view.setUint16(table + 4, 0)
  view.setUint16(table + 6, segCount * 2)
  view.setUint16(table + 8, 0)
  view.setUint16(table + 10, 0)
  view.setUint16(table + 12, 0)

  let cursor = table + 14
  for (const cp of sorted) {
    view.setUint16(cursor, cp)
    cursor += 2
  }
  view.setUint16(cursor, 0xffff)
  cursor += 2
  view.setUint16(cursor, 0)
  cursor += 2
  for (const cp of sorted) {
    view.setUint16(cursor, cp)
    cursor += 2
  }
  view.setUint16(cursor, 0xffff)
  cursor += 2
  for (const cp of sorted) {
    view.setInt16(cursor, 1 - cp)
    cursor += 2
  }
  view.setInt16(cursor, 1)
  cursor += 2
  for (let i = 0; i < segCount; i++) {
    view.setUint16(cursor, 0)
    cursor += 2
  }

  return font
}

function writeTag(bytes: Uint8Array, offset: number, tag: string) {
  for (let i = 0; i < tag.length; i++) bytes[offset + i] = tag.charCodeAt(i)
}
