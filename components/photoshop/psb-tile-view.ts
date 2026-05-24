import type { LargeDocumentTileViewMetadata, PsDocument } from "./types"
import { TiledBackingStore } from "./tiled-backing-store"

export const PSB_TILE_VIEW_LAYER_ID = "psb-composite"
export const PSB_TILE_VIEW_SOURCE_VERSION = "full-resolution"

const tileStores = new Map<string, TiledBackingStore>()

export function registerPsbTileViewStore(docId: string, store: TiledBackingStore) {
  tileStores.set(docId, store)
}

export function forgetPsbTileViewStore(docId: string) {
  tileStores.delete(docId)
}

export function getPsbTileViewMetadata(doc: PsDocument | null | undefined): LargeDocumentTileViewMetadata | null {
  return doc?.metadata?.largeDocumentTileView ?? null
}

export function hasPsbTileViewStore(docId: string) {
  return tileStores.has(docId)
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

export async function readPsbTileViewCanvas(docId: string, col: number, row: number): Promise<HTMLCanvasElement | null> {
  const store = tileStores.get(docId)
  if (!store) return null
  const blob = await store.readLayerTile({
    layerId: PSB_TILE_VIEW_LAYER_ID,
    layerKind: "raster",
    sourceVersion: PSB_TILE_VIEW_SOURCE_VERSION,
    col,
    row,
  })
  if (!blob) return null
  return blobToCanvas(blob)
}
