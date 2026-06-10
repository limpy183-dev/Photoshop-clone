import { expect, test } from "@playwright/test"

import { addPhotoshopEventListener } from "../components/photoshop/events"
import {
  SCREEN_MODE_CYCLE,
  applyScreenMode,
  cycleScreenMode,
  enterBrowserFullscreen,
  exitBrowserFullscreen,
  getScreenModeKeyboardShortcut,
  isCurrentlyFullscreen,
  isFullscreenApiAvailable,
  resolveScreenModeState,
  screenModeLabel,
} from "../components/photoshop/screen-modes"
import { requestCanvasZoom, requestPrintSizeView } from "../components/photoshop/zoom-events"

type FullscreenDocumentStub = {
  documentElement: Record<string, unknown>
  fullscreenElement?: unknown
  webkitFullscreenElement?: unknown
  msFullscreenElement?: unknown
  exitFullscreen?: () => Promise<void>
  webkitExitFullscreen?: () => Promise<void>
  msExitFullscreen?: () => Promise<void>
}

function installDocument(stub: FullscreenDocumentStub) {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: stub,
  })
  return stub
}

test.beforeEach(() => {
  Reflect.deleteProperty(globalThis, "window")
  Reflect.deleteProperty(globalThis, "document")
})

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "window")
  Reflect.deleteProperty(globalThis, "document")
})

test("screen mode resolution returns the full visibility contract for every mode", () => {
  expect(resolveScreenModeState("standard")).toEqual({
    mode: "standard",
    isFullscreenApiActive: false,
    hideMenuBar: false,
    hidePanels: false,
    hideStatusBar: false,
    hideToolPalette: false,
    backgroundColor: "var(--ps-canvas-bg, #535353)",
  })
  expect(resolveScreenModeState("full-screen-with-menu")).toEqual({
    mode: "full-screen-with-menu",
    isFullscreenApiActive: true,
    hideMenuBar: false,
    hidePanels: true,
    hideStatusBar: true,
    hideToolPalette: false,
    backgroundColor: "#333333",
  })
  expect(resolveScreenModeState("full-screen")).toEqual({
    mode: "full-screen",
    isFullscreenApiActive: true,
    hideMenuBar: true,
    hidePanels: true,
    hideStatusBar: true,
    hideToolPalette: true,
    backgroundColor: "#000000",
  })
})

test("screen modes cycle in documented order and expose labels and shortcut", () => {
  expect(SCREEN_MODE_CYCLE).toEqual(["standard", "full-screen-with-menu", "full-screen"])
  expect(cycleScreenMode("standard")).toBe("full-screen-with-menu")
  expect(cycleScreenMode("full-screen-with-menu")).toBe("full-screen")
  expect(cycleScreenMode("full-screen")).toBe("standard")
  expect(screenModeLabel("standard")).toBe("Standard Screen Mode")
  expect(screenModeLabel("full-screen-with-menu")).toBe("Full Screen Mode with Menu Bar")
  expect(screenModeLabel("full-screen")).toBe("Full Screen Mode")
  expect(getScreenModeKeyboardShortcut()).toBe("F")
})

test("fullscreen detection reports unavailable during SSR and recognizes standard and prefixed APIs", () => {
  expect(isFullscreenApiAvailable()).toBe(false)
  expect(isCurrentlyFullscreen()).toBe(false)

  installDocument({ documentElement: { requestFullscreen: async () => undefined } })
  expect(isFullscreenApiAvailable()).toBe(true)

  installDocument({
    documentElement: { webkitRequestFullscreen: async () => undefined },
    webkitFullscreenElement: {},
  })
  expect(isFullscreenApiAvailable()).toBe(true)
  expect(isCurrentlyFullscreen()).toBe(true)

  installDocument({
    documentElement: { msRequestFullscreen: async () => undefined },
    msFullscreenElement: {},
  })
  expect(isFullscreenApiAvailable()).toBe(true)
  expect(isCurrentlyFullscreen()).toBe(true)
})

test("enter fullscreen supports standard and prefixed methods and reports denied requests", async () => {
  const calls: string[] = []
  const standard = installDocument({
    documentElement: {
      requestFullscreen: async () => { calls.push("standard") },
    },
  })
  expect(await enterBrowserFullscreen()).toBe(true)

  standard.documentElement = {
    webkitRequestFullscreen: async () => { calls.push("webkit") },
  }
  expect(await enterBrowserFullscreen()).toBe(true)

  standard.documentElement = {
    msRequestFullscreen: async () => { calls.push("ms") },
  }
  expect(await enterBrowserFullscreen()).toBe(true)

  standard.documentElement = {
    requestFullscreen: async () => { throw new Error("denied") },
  }
  expect(await enterBrowserFullscreen()).toBe(false)
  expect(calls).toEqual(["standard", "webkit", "ms"])
})

test("exit fullscreen is idempotent and supports standard and prefixed methods", async () => {
  const stub = installDocument({ documentElement: {} })
  expect(await exitBrowserFullscreen()).toBe(true)

  const calls: string[] = []
  stub.fullscreenElement = {}
  stub.exitFullscreen = async () => {
    calls.push("standard")
    stub.fullscreenElement = undefined
  }
  expect(await exitBrowserFullscreen()).toBe(true)

  stub.exitFullscreen = undefined
  stub.webkitFullscreenElement = {}
  stub.webkitExitFullscreen = async () => {
    calls.push("webkit")
    stub.webkitFullscreenElement = undefined
  }
  expect(await exitBrowserFullscreen()).toBe(true)

  stub.webkitExitFullscreen = undefined
  stub.msFullscreenElement = {}
  stub.msExitFullscreen = async () => {
    calls.push("ms")
    stub.msFullscreenElement = undefined
  }
  expect(await exitBrowserFullscreen()).toBe(true)
  expect(calls).toEqual(["standard", "webkit", "ms"])
})

test("apply screen mode enters and exits fullscreen while reporting the observed browser state", async () => {
  const stub = installDocument({ documentElement: {} })
  stub.documentElement.requestFullscreen = async () => {
    stub.fullscreenElement = stub.documentElement
  }
  stub.exitFullscreen = async () => {
    stub.fullscreenElement = undefined
  }

  const entered = await applyScreenMode("full-screen")
  expect(entered).toMatchObject({
    mode: "full-screen",
    isFullscreenApiActive: true,
    hideMenuBar: true,
    hidePanels: true,
  })

  const exited = await applyScreenMode("standard")
  expect(exited).toMatchObject({
    mode: "standard",
    isFullscreenApiActive: false,
    hideMenuBar: false,
    hidePanels: false,
  })
})

test("zoom helpers dispatch typed zoom and print-size events through the shared event target", () => {
  const zooms: unknown[] = []
  let printSizeRequests = 0
  const removeZoom = addPhotoshopEventListener("ps-request-zoom", (detail) => zooms.push(detail))
  const removePrint = addPhotoshopEventListener("ps-request-print-size-view", () => printSizeRequests++)

  requestCanvasZoom({ zoom: 2 })
  requestCanvasZoom({ factor: 0.5 })
  requestPrintSizeView()
  removeZoom()
  removePrint()
  requestCanvasZoom({ zoom: 3 })
  requestPrintSizeView()

  expect(zooms).toEqual([{ zoom: 2 }, { factor: 0.5 }])
  expect(printSizeRequests).toBe(1)
})
