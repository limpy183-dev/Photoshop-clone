import fs from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

test("typography panel source exposes polished grouped controls for dense type workflows", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "components/photoshop/panels/character-paragraph-panels.tsx"),
    "utf8",
  )

  expect(source).toContain('data-testid="typography-character-panel"')
  expect(source).toContain('data-testid="type-variable-font-surface"')
  expect(source).toContain('data-density="compact-polished"')
  expect(source).toContain('aria-label="Variable font controls"')
  expect(source).toContain('data-testid="type-opentype-surface"')
  expect(source).toContain('aria-label="OpenType feature controls"')
  expect(source).toContain('data-testid="type-vertical-surface"')
  expect(source).toContain('aria-label="Vertical type controls"')
  expect(source).toContain('data-testid="typography-paragraph-panel"')
  expect(source).toContain('data-testid="paragraph-alignment-controls"')
  expect(source).toContain('aria-label={j.label}')
  expect(source).toContain('label: "Align left"')
  expect(source).toContain('label: "Justify all"')
  expect(source).toContain("<AlignLeft")
})
