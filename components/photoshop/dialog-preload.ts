type LazyModule<T> = Promise<{ default: T }>

export function preloadNewDocumentDialog() {
  return import("./new-document-dialog").then((module) => ({ default: module.NewDocumentDialog }))
}

export function preloadImageSizeDialog() {
  return import("./image-size-dialog").then((module) => ({ default: module.ImageSizeDialog }))
}

export function preloadCanvasSizeDialog() {
  return import("./canvas-size-dialog").then((module) => ({ default: module.CanvasSizeDialog }))
}

export function preloadExportAsDialog(): LazyModule<unknown> {
  return import("./export-as-dialog").then((module) => ({ default: module.ExportAsDialog }))
}

export function preloadDialogForCommand(commandId: string) {
  switch (commandId) {
    case "file-new":
      return preloadNewDocumentDialog()
    case "file-export-as":
      return preloadExportAsDialog()
    case "image-size":
      return preloadImageSizeDialog()
    case "canvas-size":
      return preloadCanvasSizeDialog()
    default:
      return Promise.resolve(null)
  }
}
