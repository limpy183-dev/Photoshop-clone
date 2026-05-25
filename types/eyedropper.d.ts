// The EyeDropper API ships in Chromium-based browsers but is still missing
// from TypeScript's lib.dom defaults. Declare the minimum surface we use so
// the color picker can call it without `any` casts.
//
// https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper_API

interface EyeDropperResult {
  sRGBHex: string
}

interface EyeDropperOpenOptions {
  signal?: AbortSignal
}

interface EyeDropper {
  open(options?: EyeDropperOpenOptions): Promise<EyeDropperResult>
}

interface EyeDropperConstructor {
  new (): EyeDropper
  prototype: EyeDropper
}

declare const EyeDropper: EyeDropperConstructor | undefined

interface Window {
  EyeDropper?: EyeDropperConstructor
}
