import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

import { selectToolSettings } from "../../components/photoshop/editor-selectors"
import {
  createEditorStore,
  createVersionedSelectionCache,
  selectWithVersionedCache,
} from "../../components/photoshop/editor-store"
import { HIGH_FREQUENCY_ACTION_TYPES } from "../../components/photoshop/editor-reducer-model"
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

  it("notifies a selector only when its selected value changes", () => {
    const store = createEditorStore({ count: 0, label: "ready" })
    const selected: number[] = []
    const unsubscribe = store.subscribeSelector(
      (state) => state.count,
      (count) => selected.push(count),
    )

    store.setSnapshot({ count: 0, label: "working" })
    store.setSnapshot({ count: 1, label: "working" })
    store.setSnapshot({ count: 1, label: "done" })

    expect(selected).toEqual([1])
    unsubscribe()
  })

  it("coalesces scheduled notifications into one frame", () => {
    const store = createEditorStore({ count: 0 })
    const frames: Array<() => void> = []
    let calls = 0
    store.subscribe(() => {
      calls += 1
    })

    store.setSnapshot({ count: 1 }, { notify: false })
    store.scheduleNotify((flush) => {
      frames.push(flush)
    })
    store.setSnapshot({ count: 2 }, { notify: false })
    store.scheduleNotify((flush) => {
      frames.push(flush)
    })

    expect(frames).toHaveLength(1)
    frames[0]?.()
    expect(calls).toBe(1)
    expect(store.getSnapshot()).toEqual({ count: 2 })
  })

  it("does not mirror a computed editor context through a second store", () => {
    const source = readFileSync("components/photoshop/editor-context.tsx", "utf8")
    expect(source).not.toContain("createEditorSelectorStore")
    expect(source).not.toContain("EditorSelectorContext.Provider")
    expect(source).not.toMatch(/useLayoutEffect\(\(\) => \{\s*selectorStoreRef/)
  })

  it("recomputes a selection when a prop-capturing selector changes at the same version", () => {
    const cache = createVersionedSelectionCache<string>()
    const documents = { first: "First document", second: "Second document" }
    const firstSelector = (snapshot: typeof documents) => snapshot.first
    const secondSelector = (snapshot: typeof documents) => snapshot.second

    expect(selectWithVersionedCache(cache, 4, firstSelector, Object.is, documents)).toBe("First document")
    expect(selectWithVersionedCache(cache, 4, secondSelector, Object.is, documents)).toBe("Second document")
  })

  it("covers reducer scheduling metadata from the canonical reducer model", () => {
    expect(HIGH_FREQUENCY_ACTION_TYPES).toEqual(new Set(["push-history"]))
  })
})
