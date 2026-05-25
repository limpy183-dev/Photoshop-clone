import { expect, test } from "@playwright/test"

import {
  appendThreadReply,
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
import { searchLearningIndex, buildLearningIndex } from "../components/photoshop/learning-index"
import { deserializeProject, serializeProject } from "../components/photoshop/document-io"
import { normalizeImportedAssetLibrary } from "../components/photoshop/panels/assets-panel"
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
