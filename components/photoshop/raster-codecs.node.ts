type MozJpegEncoderModule = {
  default: (data: ImageData, options?: Record<string, unknown>) => Promise<ArrayBuffer>
}

let encoderReady: Promise<MozJpegEncoderModule> | null = null

export function loadNodeMozJpegEncoder(): Promise<MozJpegEncoderModule> {
  encoderReady ??= (async () => {
    const mod = await import("@jsquash/jpeg/encode.js")
    const fs = await import("node:fs/promises")
    const wasmPath = [
      process.cwd(),
      "node_modules",
      "@jsquash",
      "jpeg",
      "codec",
      "enc",
      "mozjpeg_enc.wasm",
    ].join("/")
    const wasm = await WebAssembly.compile(await fs.readFile(wasmPath))
    await mod.init(wasm)
    return { default: mod.default }
  })()
  return encoderReady
}
