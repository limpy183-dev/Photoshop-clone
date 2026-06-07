import { expect, test } from "@playwright/test"

import {
  PHASE_TWO_WORKFLOW_PACK_IDS,
  WORKFLOW_PACKS,
  exportPresetForWorkflowPack,
  findWorkflowPack,
  imageProcessorPresetForWorkflowPack,
  workflowPackLearningItems,
} from "../components/photoshop/workflow-presets"
import { buildLearningIndex, searchLearningIndex } from "../components/photoshop/learning-index"

test("phase 2 workflow packs cover the roadmap workflows with actionable steps", () => {
  expect(WORKFLOW_PACKS.map((pack) => pack.id)).toEqual(PHASE_TWO_WORKFLOW_PACK_IDS)

  for (const pack of WORKFLOW_PACKS) {
    expect(pack.title).toBeTruthy()
    expect(pack.summary.length).toBeGreaterThan(24)
    expect(pack.steps.length).toBeGreaterThanOrEqual(4)
    expect(pack.steps.every((step) => step.action)).toBe(true)
  }

  const background = findWorkflowPack("background-removal")!
  expect(background.steps.map((step) => step.action?.kind)).toEqual([
    "tool",
    "event",
    "apply-selection-mask",
    "event",
  ])
  expect(background.steps[0].action).toMatchObject({ kind: "tool", tool: "select-subject" })
  expect(background.steps[1].action).toMatchObject({ kind: "event", event: "ps-open-select-and-mask" })

  const portrait = findWorkflowPack("portrait-retouch")!
  expect(portrait.steps.map((step) => step.action)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "tool", tool: "spot-healing" }),
      expect.objectContaining({ kind: "tool", tool: "dodge" }),
      expect.objectContaining({ kind: "tool", tool: "burn" }),
      expect.objectContaining({ kind: "event", event: "ps-open-filter", detail: "smart-sharpen" }),
    ]),
  )

  const printPrep = findWorkflowPack("print-prep")!
  expect(printPrep.steps.map((step) => step.action)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "event", event: "ps-open-image-size" }),
      expect.objectContaining({ kind: "event", event: "ps-open-color-management-workflow", detail: { mode: "proof" } }),
      expect.objectContaining({ kind: "event", event: "ps-open-print-workflow" }),
      expect.objectContaining({ kind: "event", event: "ps-open-preflight" }),
    ]),
  )
})

test("workflow pack presets open export and batch processor with practical defaults", () => {
  expect(exportPresetForWorkflowPack("background-removal")).toMatchObject({
    dialog: "export-as",
    format: "png",
    transparent: true,
    includeMetadata: true,
  })

  expect(exportPresetForWorkflowPack("social-export")).toMatchObject({
    dialog: "export-as",
    format: "webp",
    scale: 100,
    quality: 86,
    transparent: false,
  })

  expect(imageProcessorPresetForWorkflowPack("batch-watermark-resize")).toMatchObject({
    resize: true,
    maxWidth: 1920,
    maxHeight: 1080,
    format: "webp",
    watermark: {
      enabled: true,
      position: "bottom-right",
      shadow: true,
    },
    metadata: {
      copyright: "(c) Copyright",
    },
  })
})

test("workflow packs are indexed as runnable Discover and Learn workflow items", () => {
  const learningItems = workflowPackLearningItems()

  expect(learningItems.map((item) => item.id)).toEqual([
    "workflow-pack-background-removal",
    "workflow-pack-portrait-retouch",
    "workflow-pack-social-export",
    "workflow-pack-print-prep",
    "workflow-pack-batch-watermark-resize",
  ])
  expect(learningItems.every((item) => item.type === "workflow")).toBe(true)
  expect(learningItems.every((item) => item.action?.kind === "event")).toBe(true)
  expect(learningItems[0].action).toMatchObject({
    target: "ps-open-workflow-pack",
    detail: { id: "background-removal" },
  })

  const index = buildLearningIndex()
  expect(searchLearningIndex(index, "background removal")[0]).toMatchObject({
    id: "workflow-pack-background-removal",
    type: "workflow",
  })
  expect(searchLearningIndex(index, "batch watermark resize")[0]).toMatchObject({
    id: "workflow-pack-batch-watermark-resize",
    type: "workflow",
  })
})
