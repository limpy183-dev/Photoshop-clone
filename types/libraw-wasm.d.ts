declare module "libraw-wasm" {
  export default class LibRaw {
    open(data: Uint8Array, settings?: Record<string, unknown>): Promise<unknown>
    metadata(full?: boolean): Promise<Record<string, unknown>>
    imageData(): Promise<Record<string, unknown>>
  }
}

declare module "libraw-wasm/dist/libraw.js" {
  export interface LibRawRuntimeInstance {
    open(data: Uint8Array, settings?: Record<string, unknown>): unknown
    metadata(full?: boolean): Record<string, unknown>
    imageData(): Record<string, unknown>
    delete?: () => void
  }

  export interface LibRawRuntimeModule {
    LibRaw: new () => LibRawRuntimeInstance
  }

  export default function createLibRawRuntime(options?: Record<string, unknown>): Promise<LibRawRuntimeModule>
}
