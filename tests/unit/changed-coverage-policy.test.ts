import { describe, expect, it } from "vitest"
import { findMissingCoverageFiles } from "../../scripts/changed-coverage-policy.mjs"

describe("changed coverage policy", () => {
  it("rejects changed critical files missing from the coverage report", () => {
    expect(findMissingCoverageFiles(
      [
        "components/photoshop/editor-reducer.ts",
        "components/photoshop/status-bar.tsx",
        "components/photoshop/project-sanitizer.ts",
      ],
      new Set(["components/photoshop/project-sanitizer.ts"]),
      ["reducer", "sanitizer", "serializer", "algorithms?", "filters?/"],
    )).toEqual(["components/photoshop/editor-reducer.ts"])
  })

  it("does not classify React dialog coordinators as pure algorithm modules", () => {
    expect(findMissingCoverageFiles(
      ["components/photoshop/algorithmic-operations-dialog.tsx"],
      new Set(),
      ["(?:^|[/.-])algorithms?(?:[/.-]|$)"],
    )).toEqual([])
  })
})
