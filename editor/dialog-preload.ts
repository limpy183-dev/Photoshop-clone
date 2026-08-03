type LazyModule<T> = Promise<{ default: T }>

export function preloadNewDocumentDialog() {
  return import("@/components/photoshop/new-document-dialog").then((module) => ({ default: module.NewDocumentDialog }))
}

export function preloadImageSizeDialog() {
  return import("@/components/photoshop/image-size-dialog").then((module) => ({ default: module.ImageSizeDialog }))
}

export function preloadCanvasSizeDialog() {
  return import("@/components/photoshop/canvas/size-dialog").then((module) => ({ default: module.CanvasSizeDialog }))
}

export function preloadExportAsDialog(): LazyModule<unknown> {
  return import("@/components/photoshop/export/as-dialog").then((module) => ({ default: module.ExportAsDialog }))
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
