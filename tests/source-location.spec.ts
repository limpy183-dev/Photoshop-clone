import { expect, test } from "@playwright/test"

import {
  revealSourceInBrowser,
  sourceInfoForDocument,
  sourceInfoForSmartObject,
} from "../components/photoshop/source-location"
import { richFixtureDocument } from "./photoshop-fixtures"

function fileHandle(name: string, patch: Partial<FileSystemFileHandle> = {}) {
  return {
    kind: "file",
    name,
    createWritable: async () => ({
      write: async () => {},
      close: async () => {},
    }),
    getFile: async () => new File(["fixture"], name, { lastModified: 1_800_000_000_000 }),
    queryPermission: async () => "granted" as PermissionState,
    requestPermission: async () => "granted" as PermissionState,
    isSameEntry: async (other: FileSystemHandle) => other.name === name,
    ...patch,
  } as unknown as FileSystemFileHandle
}

test("document source info labels file handles without inventing absolute paths", () => {
  const doc = richFixtureDocument()
  doc.name = "portrait.psprojson"

  const info = sourceInfoForDocument(doc, {
    dirty: false,
    savedHistoryIndex: 0,
    fileName: "portrait.psprojson",
    fileKind: "project",
    storage: "file-system-access",
    fileHandle: fileHandle("portrait.psprojson"),
    lastSaveNote: "Saved to the existing browser file handle.",
  })

  expect(info.primaryName).toBe("portrait.psprojson")
  expect(info.storageLabel).toBe("File System Access handle")
  expect(info.handleLabel).toBe("portrait.psprojson")
  expect(info.pathLabel).toBe("Absolute path not exposed by browser")
  expect(info.canReveal).toBe(true)
  expect(info.rows).toContainEqual(["File Kind", "Project"])
})

test("smart object source info surfaces linked handle metadata", () => {
  const doc = richFixtureDocument()
  const layer = doc.layers.find((item) => item.id === "layer_smart")!
  layer.smartSource = {
    ...layer.smartSource!,
    linkType: "linked",
    fileName: "hero.png",
    relativePath: "assets/hero.png",
    status: "current",
    fileHandle: fileHandle("hero.png"),
    fileHandleName: "hero.png",
    handlePermission: "granted",
    lastKnownModified: 1_800_000_000_000,
    lastKnownSize: 4096,
  }

  const info = sourceInfoForSmartObject(layer)

  expect(info.title).toBe("Linked Smart Object Source")
  expect(info.primaryName).toBe("hero.png")
  expect(info.storageLabel).toBe("Linked file handle")
  expect(info.canReveal).toBe(true)
  expect(info.rows).toContainEqual(["Relative Path", "assets/hero.png"])
  expect(info.rows).toContainEqual(["Permission", "granted"])
  expect(info.rows).toContainEqual(["Last Known Size", "4.0 KB"])
})

test("reveal source asks the browser for a directory picker starting near the file handle", async () => {
  const handle = fileHandle("hero.png")
  let pickerOptions: unknown
  const directory = {
    kind: "directory",
    name: "assets",
    getFileHandle: async (name: string) => {
      if (name !== "hero.png") throw new DOMException("Not found", "NotFoundError")
      return handle
    },
  } as unknown as FileSystemDirectoryHandle

  const result = await revealSourceInBrowser(handle, {
    showDirectoryPicker: async (options) => {
      pickerOptions = options.startIn
      return directory
    },
  })

  expect(pickerOptions).toBe(handle)
  expect(result.status).toBe("folder-picker-verified")
  expect(result.verified).toBe(true)
})

test("reveal source reports browser fallback when folders cannot be opened", async () => {
  const result = await revealSourceInBrowser(fileHandle("fallback.png"), {})

  expect(result.status).toBe("file-accessible")
  expect(result.message).toContain("cannot reveal")
})
