import type { PluginDescriptor } from "./types"
import { clamp, createSubsystemCanvas } from "./advanced-subsystems-shared"

export function applyPluginFilterToCanvas(canvas: HTMLCanvasElement, plugin: PluginDescriptor) {
  if (plugin.kind !== "8bf-filter" || !Array.isArray(plugin.filterKernel) || plugin.filterKernel.length !== 9) return canvas
  // Reject kernels with non-finite or non-numeric elements; otherwise NaN
  // propagates through the convolution and produces an all-transparent
  // output. We also bound the absolute value so a malicious descriptor
  // cannot ship enormous coefficients that overflow the canvas pipeline.
  const kernel = plugin.filterKernel
  for (const coefficient of kernel) {
    if (typeof coefficient !== "number" || !Number.isFinite(coefficient)) return canvas
    if (Math.abs(coefficient) > 128) return canvas
  }
  const out = createSubsystemCanvas(canvas.width, canvas.height)
  const ctx = out.getContext("2d")!
  ctx.drawImage(canvas, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const source = new Uint8ClampedArray(image.data)
  const explicitDivisor =
    typeof plugin.filterDivisor === "number" && Number.isFinite(plugin.filterDivisor) && plugin.filterDivisor !== 0
      ? plugin.filterDivisor
      : null
  const kernelSum = kernel.reduce((sum, n) => sum + n, 0)
  const divisor = explicitDivisor ?? (kernelSum !== 0 ? kernelSum : 1)
  const bias = typeof plugin.filterBias === "number" && Number.isFinite(plugin.filterBias) ? plugin.filterBias : 0
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const i = (y * image.width + x) * 4
      for (let c = 0; c < 3; c++) {
        let sum = 0
        let k = 0
        for (let yy = -1; yy <= 1; yy++) {
          for (let xx = -1; xx <= 1; xx++) {
            sum += source[((y + yy) * image.width + (x + xx)) * 4 + c] * kernel[k++]
          }
        }
        image.data[i + c] = clamp(sum / divisor + bias)
      }
    }
  }
  ctx.putImageData(image, 0, 0)
  return out
}
