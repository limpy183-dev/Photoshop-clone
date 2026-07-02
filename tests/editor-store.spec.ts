import { expect, test } from "@playwright/test"
import { createEditorStore } from "../components/photoshop/editor-store"
import { selectToolSettings } from "../components/photoshop/editor-selectors"
import type { EditorState } from "../components/photoshop/editor-context"

test("editor store publishes canonical snapshots synchronously", () => {
  const store = createEditorStore({ count: 0 })
  const versions: number[] = []
  store.subscribe(() => versions.push(store.getVersion()))

  store.setSnapshot({ count: 1 })

  expect(store.getSnapshot()).toEqual({ count: 1 })
  expect(store.getVersion()).toBe(1)
  expect(versions).toEqual([1])
})

test("editor store can stage a snapshot before a deferred notification", () => {
  const store = createEditorStore({ count: 0 })
  const snapshots: number[] = []
  store.subscribe(() => snapshots.push(store.getSnapshot().count))

  store.setSnapshot({ count: 2 }, { notify: false })
  expect(store.getSnapshot().count).toBe(2)
  expect(snapshots).toEqual([])

  store.notify()
  expect(snapshots).toEqual([2])
})

test("editor store ignores referentially identical snapshots", () => {
  const snapshot = { count: 0 }
  const store = createEditorStore(snapshot)
  let calls = 0
  store.subscribe(() => calls++)

  store.setSnapshot(snapshot)

  expect(calls).toBe(0)
  expect(store.getVersion()).toBe(0)
})

test("domain selectors preserve identity for unrelated state changes", () => {
  const state = {
    tool: "brush",
    brush: { size: 20 },
    gradient: { type: "linear" },
    eraser: { tolerance: 10 },
    foreground: "#000000",
  } as unknown as EditorState

  const before = selectToolSettings(state)
  const after = selectToolSettings({ ...state, foreground: "#ffffff" })

  expect(after).toBe(before)
})

test("command-only snapshots stay stable across state transitions", () => {
  const commands = { dispatch: () => undefined }
  const commandStore = createEditorStore(commands)
  const stateStore = createEditorStore({ zoom: 1 })
  let commandNotifications = 0
  commandStore.subscribe(() => commandNotifications++)

  stateStore.setSnapshot({ zoom: 2 })

  expect(commandStore.getSnapshot()).toBe(commands)
  expect(commandNotifications).toBe(0)
})
