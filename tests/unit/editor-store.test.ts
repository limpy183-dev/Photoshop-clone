import { describe, expect, it, vi } from "vitest"

import { selectToolSettings } from "../../components/photoshop/editor-selectors"
import { createEditorStore } from "../../components/photoshop/editor-store"
import type { EditorState } from "../../components/photoshop/editor-context"

describe("canonical editor store", () => {
  it("publishes transitions synchronously and ignores identical snapshots", () => {
    const initial = { zoom: 1 }
    const store = createEditorStore(initial)
    const listener = vi.fn()
    store.subscribe(listener)

    store.setSnapshot({ zoom: 2 })
    expect(store.getSnapshot()).toEqual({ zoom: 2 })
    expect(store.getVersion()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)

    const current = store.getSnapshot()
    store.setSnapshot(current)
    expect(store.getVersion()).toBe(1)
  })

  it("preserves tool-domain selector identity for unrelated changes", () => {
    const state = {
      tool: "brush",
      brush: { size: 20 },
      gradient: { type: "linear" },
      eraser: { tolerance: 10 },
      foreground: "#000000",
    } as unknown as EditorState

    expect(selectToolSettings({ ...state, foreground: "#ffffff" })).toBe(selectToolSettings(state))
  })
})
