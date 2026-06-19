"use client"

/* File System Access API type augmentation - not yet in TS standard lib */
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string
      types?: Array<{ description?: string; accept: Record<string, string[]> }>
    }) => Promise<FileSystemFileHandle>
  }
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a")
  a.href = dataUrl
  a.download = filename
  a.click()
}

export function downloadText(text: string, filename: string, type = "application/json") {
  const blob = new Blob([text], { type })
  downloadBlob(blob, filename)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  try {
    downloadDataUrl(url, filename)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/* =================== File System Access API helpers =================== */

/**
 * Check if the File System Access API is available (Chrome/Edge 86+).
 * Returns false in Firefox, Safari, and non-secure contexts.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function"
}

/**
 * Show a "Save As" file picker and return a FileSystemFileHandle.
 * Returns null if the user cancels or the API is unsupported.
 */
export async function showSaveProjectPicker(suggestedName = "project.psproj"): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) return null
  try {
    const handle = await window.showSaveFilePicker!({
      suggestedName,
      types: [
        {
          description: "Photoshop Web Project",
          accept: { "application/json": [".psproj"] },
        },
        {
          description: "PSD File",
          accept: { "image/vnd.adobe.photoshop": [".psd", ".psb"] },
        },
      ],
    })
    return handle
  } catch {
    // User cancelled or permission denied
    return null
  }
}

/**
 * Write serialized project data to an existing FileSystemFileHandle.
 * Returns true on success, false on failure.
 */
export async function saveToFileHandle(
  handle: FileSystemFileHandle,
  data: string | Blob,
): Promise<boolean> {
  try {
    const writable = await handle.createWritable()
    await writable.write(typeof data === "string" ? new Blob([data], { type: "application/json" }) : data)
    await writable.close()
    return true
  } catch {
    return false
  }
}

/**
 * Show a "Save As" picker for raster image export.
 * Returns the handle or null if cancelled.
 */
export async function showExportImagePicker(
  suggestedName: string,
  format: "png" | "jpeg" | "webp" | "avif" | "gif" = "png",
): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) return null
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    webp: "image/webp",
    avif: "image/avif",
    gif: "image/gif",
  }
  const extMap: Record<string, string> = {
    png: ".png",
    jpeg: ".jpg",
    webp: ".webp",
    avif: ".avif",
    gif: ".gif",
  }
  try {
    const handle = await window.showSaveFilePicker!({
      suggestedName,
      types: [
        {
          description: `${format.toUpperCase()} Image`,
          accept: { [mimeMap[format] ?? "image/png"]: [extMap[format] ?? ".png"] },
        },
      ],
    })
    return handle
  } catch {
    return null
  }
}
