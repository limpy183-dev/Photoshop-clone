declare module "libraw-wasm" {
  export default class LibRaw {
    open(data: Uint8Array, settings?: Record<string, unknown>): Promise<unknown>
    metadata(full?: boolean): Promise<Record<string, unknown>>
    imageData(): Promise<Record<string, unknown>>
  }
}
