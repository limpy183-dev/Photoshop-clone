import { expect, test } from "@playwright/test"

test("initial composite canvas has the expected document size and visible pixels", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll("canvas")).some((node) => {
      const canvas = node as HTMLCanvasElement
      if (canvas.width !== 1200 || canvas.height !== 800) return false
      const ctx = canvas.getContext("2d")
      if (!ctx) return false
      return ctx.getImageData(600, 400, 1, 1).data[3] > 0
    })
  })

  const sample = await page.locator("canvas").evaluateAll((nodes) => {
    const canvases = nodes.filter((node) => {
      const c = node as HTMLCanvasElement
      return c.width === 1200 && c.height === 800
    }) as HTMLCanvasElement[]
    if (!canvases.length) return null
    const pixels = canvases.flatMap((canvas) => {
      const ctx = canvas.getContext("2d")
      if (!ctx) return []
      return [
        Array.from(ctx.getImageData(0, 0, 1, 1).data),
        Array.from(ctx.getImageData(600, 400, 1, 1).data),
        Array.from(ctx.getImageData(1199, 799, 1, 1).data),
      ]
    })
    return {
      width: canvases[0].width,
      height: canvases[0].height,
      pixels,
    }
  })

  expect(sample).not.toBeNull()
  expect(sample?.width).toBe(1200)
  expect(sample?.height).toBe(800)
  expect(sample?.pixels.some((pixel) => pixel[3] > 0)).toBe(true)
})

test("new feature panels are reachable from command search", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  const panels = [
    ["Selection Studio Panel", "Selection"],
    ["Guides Panel", "Guides"],
    ["Adjustments Panel", "Adjustments"],
    ["Asset Library Panel", "Assets"],
    ["Timeline Panel", "Timeline"],
    ["Annotations Panel", "Annotations"],
    ["Slice Manager Panel", "Slices"],
    ["Scripting Console", "Scripting"],
  ] as const

  for (const [query, tab] of panels) {
    await page.locator("body").click({ position: { x: 20, y: 20 } })
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
    await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
    await page.getByPlaceholder("Search tools, filters, panels, and commands").fill(query)
    await page.keyboard.press("Enter")
    await expect(page.getByText("Command Palette")).toBeHidden()
    await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible()
  }
})

test("preflight check opens from command search", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Preflight Check")
  await page.keyboard.press("Enter")

  await expect(page.getByRole("dialog", { name: "Preflight Check" })).toBeVisible()
  await expect(page.getByText("Layer stack")).toBeVisible()
  await expect(page.getByText("Browser pixel pipeline")).toBeVisible()
  await expect(page.getByText("Raster export", { exact: true })).toBeVisible()
  await expect(page.getByText("Quick fixes")).toBeVisible()
})

test("layer comps can capture the current document state", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Layer Comps")
  await page.keyboard.press("Enter")

  await expect(page.getByRole("dialog", { name: "Layer Comps" })).toBeVisible()
  await page.getByRole("button", { name: "New From Current" }).click()
  await expect(page.locator('input[value="Layer Comp 1"]').first()).toBeVisible()
  await expect(page.getByText(/Visible:\s*\d+/)).toBeVisible()
})

test("export as exposes reusable export presets", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Export As")
  await page.keyboard.press("Enter")

  await expect(page.getByRole("dialog", { name: "Export As" })).toBeVisible()
  await expect(page.getByText("Presets")).toBeVisible()
  await expect(page.getByLabel("Export preset name")).toBeVisible()
  await page.getByLabel("Export preset name").fill("Smoke PNG preset")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.locator("select").filter({ hasText: "Smoke PNG preset" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible()
})

test("advanced Photoshop filters open from command search", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Oil Paint")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Oil Paint" })).toBeVisible()
  await expect(page.getByText("Stylization Radius")).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Custom Convolution")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Custom Convolution" })).toBeVisible()
  await expect(page.getByText("Kernel")).toBeVisible()
})

test("management dialogs open from command search", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Recent Documents")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Recent Documents" })).toBeVisible()
  await page.keyboard.press("Escape")

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Workspace Manager")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Workspace Manager" })).toBeVisible()
  await page.getByLabel("Workspace name").fill("Smoke Workspace")
  await page.getByRole("button", { name: "Save Current" }).click()
  await expect(page.getByText("Smoke Workspace")).toBeVisible()
  await page.keyboard.press("Escape")

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Expand Selection")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Expand Selection" })).toBeVisible()
  await expect(page.getByText("Create a selection before applying this command.")).toBeVisible()
})

test("local-only advanced workspaces and filters open from command search", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  const openCommand = async (query: string) => {
    await page.locator("body").click({ position: { x: 20, y: 20 } })
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
    await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
    await page.getByPlaceholder("Search tools, filters, panels, and commands").fill(query)
    await page.keyboard.press("Enter")
  }

  await openCommand("Device Preview")
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByText("Device Preview").last()).toBeVisible()
  await expect(page.getByText(/document 1200 x 800/)).toBeVisible()
  await page.keyboard.press("Escape")

  await openCommand("Droplets")
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByText("Create Local Automation")).toBeVisible()
  await expect(page.getByText("Installed Automations")).toBeVisible()
  await page.keyboard.press("Escape")

  await openCommand("Content Credentials")
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Local Content Credentials" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Credential Chain" })).toBeVisible()
  await page.keyboard.press("Escape")

  for (const filterName of ["Sky Replacement", "Adaptive Wide Angle", "Vanishing Point"]) {
    await openCommand(filterName)
    await expect(page.getByRole("dialog", { name: filterName })).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
  }
})

test("algorithmic operations expose pure code feature groups", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Algorithmic Operations")
  await page.keyboard.press("Enter")

  await expect(page.getByRole("dialog", { name: "Algorithmic Operations" })).toBeVisible()
  await expect(page.getByText("Path & Shape Operations")).toBeVisible()

  for (const [tab, heading] of [
    ["Composite", "Compositing & Alignment"],
    ["Paint", "Painting & Brush Tools"],
    ["Type", "Text / Type Features"],
    ["Animation", "Animation & Video"],
    ["Selection", "Selection Features"],
    ["Analysis", "Measurement & Analysis"],
    ["Print", "Print Features"],
    ["Color", "Color Management & Pixel Operations"],
    ["Automation", "Automation & Scripting"],
    ["Smart", "Smart Objects & 3D"],
    ["Workspace", "Workspace & UI Improvements"],
    ["History", "History Enhancements"],
    ["Texture", "Texture & Pattern Generation"],
  ] as const) {
    await page.getByRole("button", { name: tab, exact: true }).click()
    await expect(page.getByText(heading)).toBeVisible()
  }

  await page.getByRole("button", { name: "Noise Texture" }).click()
  await expect(page.getByText("noise texture")).toBeVisible()
})

test("new document setup exposes production presets and document metadata", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("New Document")
  await page.keyboard.press("Enter")

  await expect(page.getByRole("dialog", { name: "New Document" })).toBeVisible()
  await expect(page.getByText("Presets")).toBeVisible()
  await expect(page.getByRole("button", { name: /App Icon 1024/ })).toBeVisible()
  await expect(page.getByText("Resolution (ppi)")).toBeVisible()
  await expect(page.getByText("Color Mode", { exact: true })).toBeVisible()
  await expect(page.getByText("Bit Depth", { exact: true })).toBeVisible()
  await expect(page.getByText("Create as artboard")).toBeVisible()
  await expect(page.getByText("Final size:")).toBeVisible()
})

test("document tabs support duplicate, close others, and reopen closed", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Duplicate Document")
  await page.keyboard.press("Enter")

  await expect(page.getByText("Untitled-1 copy")).toBeVisible()

  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Close Other Documents")
  await page.keyboard.press("Enter")

  await expect(page.getByText("Reopen")).toBeVisible()

  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Reopen Closed Document")
  await page.keyboard.press("Enter")

  await expect(page.getByText(/Untitled-1 @ 100%/)).toBeVisible()
  await expect(page.getByText(/Untitled-1 copy @ 100%/)).toBeVisible()
})

test("file info edits metadata, color management, and print settings", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("File Info")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "File Info" })).toBeVisible()

  await page.getByRole("button", { name: "Metadata" }).click()
  await page.getByLabel("Metadata author").fill("Smoke Author")
  await page.getByLabel("Metadata keywords").fill("retouch, proof")
  await page.getByRole("button", { name: "Color Management" }).click()
  await page.getByLabel("Assigned color profile").selectOption("Display P3")
  await page.getByLabel("Proof colors").check()
  await page.getByRole("button", { name: "Print & Prepress" }).click()
  await page.getByLabel("Crop marks").check()
  await page.getByLabel("Bleed millimeters").fill("3")
  await page.getByRole("button", { name: "Save File Info" }).click()
  await expect(page.getByRole("dialog", { name: "File Info" })).toBeHidden()
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("File Info")
  await page.keyboard.press("Enter")
  await expect(page.getByText("Display P3")).toBeVisible()
  await page.getByRole("button", { name: "Metadata" }).click()
  await expect(page.getByLabel("Metadata author")).toHaveValue("Smoke Author")
})

test("actions and history panels create named entries without browser prompts", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Actions Panel")
  await page.keyboard.press("Enter")
  await page.getByLabel("New action name").fill("Smoke Action")
  await page.getByLabel("Create action").click()
  await expect(page.getByText("Smoke Action")).toBeVisible()
  await page.getByLabel("Duplicate action").click()
  await expect(page.getByText("Smoke Action Copy")).toBeVisible()

  await page.getByLabel("Import actions file").setInputFiles({
    name: "unsafe.psactions.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        actions: [
          {
            id: "unsafe-action",
            name: "Unsafe Action",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            steps: [
              {
                id: "unsafe-step",
                label: "Unsafe image payload",
                createdAt: Date.now(),
                entry: {
                  id: "unsafe-entry",
                  label: "Unsafe image payload",
                  thumb: "",
                  layers: [
                    {
                      id: "unsafe-layer",
                      name: "Unsafe layer",
                      kind: "raster",
                      visible: true,
                      opacity: 1,
                      blendMode: "normal",
                      locked: false,
                      canvasDataUrl: "javascript:alert(1)",
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ),
  })
  await expect(page.getByText(/unsafe or oversized image payload/i)).toBeVisible()

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("History Panel")
  await page.keyboard.press("Enter")
  await page.getByLabel("Snapshot name").fill("Smoke Snapshot")
  await page.getByLabel("Create snapshot").click()
  await expect(page.getByText("Smoke Snapshot")).toBeVisible()
})

test("timeline panel captures opacity-aware frames and inserts tweens", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Timeline Panel")
  await page.keyboard.press("Enter")
  await page.getByLabel("Capture frame").click()
  await page.getByLabel("Capture frame").click()
  await page.locator('input[value="Frame 1"]').click()
  await page.getByRole("button", { name: "Tween" }).click()
  await expect(page.getByText("5 frames")).toBeVisible()
  await expect(page.locator('input[value="Frame 1 tween 1"]')).toBeVisible()
  await expect(page.getByRole("button", { name: "Sheet" })).toBeVisible()
  await expect(page.getByRole("button", { name: "JSON" })).toBeVisible()
})

test("layer finder focuses search and can select matched layers", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Find Layers")
  await page.keyboard.press("Enter")
  await expect(page.getByLabel("Layer search")).toBeFocused()
  await page.getByLabel("Layer search").fill("Background")
  await expect(page.getByText(/of \d+ visible in list/)).toBeVisible()
  await page.getByLabel("Select matched layers").click()
  await expect(page.getByText(/visible in list .+ selected/)).toBeVisible()
  await page.getByLabel("Clear layer search").click()
  await expect(page.getByLabel("Layer search")).toHaveValue("")
})

test("keyboard shortcut dialog exposes portable shortcut controls", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Keyboard Shortcuts")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Import" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible()
  await expect(page.getByText("No conflicts")).toBeVisible()
  await page.getByLabel("Search shortcuts").fill("Brush")
  await expect(page.getByText("Brush Tool")).toBeVisible()
})

test("scripting console runs command-only scripts without dynamic evaluation", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Scripting Console")
  await page.keyboard.press("Enter")

  await page.locator("textarea").fill('api.report("document metadata")\napi.setForeground("#ff3366")')
  await page.getByRole("button", { name: /Run/ }).click()
  await expect(page.locator("div").filter({ hasText: /^document metadata$/ })).toBeVisible()
  await expect(page.getByText("Done (2 commands)")).toBeVisible()

  await page.locator("textarea").fill('fetch("https://example.com")')
  await page.getByRole("button", { name: /Run/ }).click()
  await expect(page.getByText(/use api\.method/)).toBeVisible()
})

test("autosave follows the saved preference", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("ps-autosave-document-v1")
    localStorage.setItem("ps-preferences", JSON.stringify({ autoSave: false }))
  })
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await page.waitForTimeout(4500)
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ps-autosave-document-v1"))).toBeNull()

  await page.evaluate(() => {
    localStorage.setItem("ps-preferences", JSON.stringify({ autoSave: true }))
    window.dispatchEvent(new CustomEvent("ps-preferences-changed"))
  })
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("ps-autosave-document-v1")
    if (!raw) return false
    try {
      return JSON.parse(raw).kind === "autosave"
    } catch {
      return false
    }
  })
})

test("swatches panel exposes validated import and export controls", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await page.getByRole("button", { name: "Swatches", exact: true }).click()
  await expect(page.getByRole("button", { name: "Export swatches" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Import swatches" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Reset swatches to defaults" })).toBeVisible()
})

test("patterns panel validates stored patterns and exposes library controls", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "ps-patterns",
      JSON.stringify([{ id: "unsafe", name: "Unsafe", dataURL: "javascript:alert(1)", width: 8, height: 8 }]),
    )
  })
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await page.getByRole("button", { name: "Patterns", exact: true }).click()
  await expect(page.getByText("No patterns defined yet.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Import patterns" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Export patterns" })).toBeDisabled()

  await page.getByRole("button", { name: "Define pattern from active layer" }).click()
  await expect(page.getByRole("button", { name: "Fill with pattern Pattern 1" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Export patterns" })).toBeEnabled()

  await page.getByRole("button", { name: "Reset patterns" }).click()
  await expect(page.getByText("No patterns defined yet.")).toBeVisible()
})

test("right dock exposes overflowing panels through named browser and pickers", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await expect(page.getByLabel("Upper panel picker")).toBeVisible()
  await expect(page.getByLabel("Lower panel picker")).toBeVisible()

  await page.getByRole("button", { name: "Paragraph", exact: true }).click()
  await expect(page.getByText("Select a text layer to edit paragraph properties.")).toBeVisible()

  await page.getByRole("button", { name: "Character", exact: true }).click()
  await expect(page.getByText("Select a text layer to edit character properties.")).toBeVisible()

  await page.getByLabel("Maximize Upper panel stack").click()
  await expect(page.getByLabel("Restore Upper panel stack")).toBeVisible()
  await expect(page.getByLabel("Lower panel picker")).toBeHidden()
  await page.getByLabel("Restore Upper panel stack").click()
  await expect(page.getByLabel("Lower panel picker")).toBeVisible()

  await page.getByRole("button", { name: "Timeline", exact: true }).click()
  await expect(page.getByText("Capture layer visibility states as animation frames.")).toBeVisible()

  await page.getByRole("button", { name: "Annotations", exact: true }).click()
  await expect(page.getByText("No notes")).toBeVisible()

  await page.getByLabel("Hide Lower panel browser").click()
  await expect(page.getByText("Show all panels")).toBeVisible()
  await page.getByText("Show all panels").click()
  await expect(page.getByRole("button", { name: "Scripting", exact: true })).toBeVisible()
})
