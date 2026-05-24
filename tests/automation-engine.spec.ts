import { expect, test } from "@playwright/test"

import {
  parseAutomationDataRows,
  parseAutomationWorkflowImportPayload,
  parseSafeDslCommands,
  renderTemplateName,
} from "../components/photoshop/automation-engine"

test("safe DSL accepts command calls with JSON arguments and rejects arbitrary JavaScript", () => {
  const commands = parseSafeDslCommands('report("ready")\nsetForeground("#ff3366")\nsetLayerOpacity("active", 0.42)')

  expect(commands).toEqual([
    { method: "report", args: ["ready"], lineNumber: 1 },
    { method: "setForeground", args: ["#ff3366"], lineNumber: 2 },
    { method: "setLayerOpacity", args: ["active", 0.42], lineNumber: 3 },
  ])

  expect(() => parseSafeDslCommands('fetch("https://example.com")')).toThrow(/command/i)
  expect(() => parseSafeDslCommands('api.constructor.constructor("alert(1)")()')).toThrow(/command/i)
  expect(() => parseSafeDslCommands('setForeground("#fff")')).toThrow(/#RRGGBB/i)
})

test("automation data rows import CSV and JSON arrays with bounded records", () => {
  expect(parseAutomationDataRows("name,headline\nAda,\"Launch, Today\"", "rows.csv")).toEqual([
    { name: "Ada", headline: "Launch, Today" },
  ])

  expect(parseAutomationDataRows(JSON.stringify([{ name: "Ada", show: true, count: 3 }]), "rows.json")).toEqual([
    { name: "Ada", show: "true", count: "3" },
  ])

  expect(() => parseAutomationDataRows(JSON.stringify({ rows: "bad" }), "rows.json")).toThrow(/array/i)
})

test("workflow imports normalize valid droplets and reject unsafe payloads", () => {
  const imported = parseAutomationWorkflowImportPayload({
    app: "Photoshop Web",
    format: "psworkflow",
    version: 1,
    workflow: {
      id: "x",
      name: "Resize and brand",
      steps: [
        { id: "s1", type: "resize", maxWidth: 800, maxHeight: 600 },
        { id: "s2", type: "script", source: 'renameActiveLayer("Hero")' },
      ],
      output: { format: "png", quality: 0.9, transparent: true, matte: "#ffffff", filenameTemplate: "{{name}}-out" },
    },
  })

  expect(imported.name).toBe("Resize and brand")
  expect(imported.steps).toHaveLength(2)
  expect(imported.output.filenameTemplate).toBe("{{name}}-out")

  expect(() =>
    parseAutomationWorkflowImportPayload({
      workflow: {
        name: "Bad",
        steps: [{ type: "script", source: "x".repeat(5000) }],
      },
    }),
  ).toThrow(/script/i)
})

test("template names replace row tokens and sanitize filesystem-hostile characters", () => {
  expect(renderTemplateName("{{name}}/{{index}}:{{missing}}", { name: "Ada Lovelace" }, 2)).toBe("Ada-Lovelace-03")
})
