import { expect, test } from "@playwright/test"

import {
  applyOcioViewTransformToHighBitImage,
  createOcioViewPipeline,
  planHalfFloatGpuPipeline,
} from "../components/photoshop/webgl-compositor"

test("half-float GPU planner requires renderable float textures and records OCIO stages", () => {
  const plan = planHalfFloatGpuPipeline({
    width: 4096,
    height: 2048,
    bitDepth: 32,
    preferGpu: true,
    webgl2Available: true,
    extensions: ["EXT_color_buffer_float", "OES_texture_float_linear"],
    workingSpace: "scene-linear",
    displaySpace: "Display P3",
    view: "Filmic",
  })
  const fallback = planHalfFloatGpuPipeline({
    width: 4096,
    height: 2048,
    bitDepth: 32,
    preferGpu: true,
    webgl2Available: true,
    extensions: [],
  })

  expect(plan.path).toBe("half-float-webgl2")
  expect(plan.framebufferFormat).toBe("RGBA16F")
  expect(plan.ocioStages).toEqual([
    "input-to-scene-linear",
    "working-space-transform",
    "view-transform",
    "display-transfer",
  ])
  expect(fallback.path).toBe("float32-cpu")
  expect(fallback.reason).toBe("float-render-target-unavailable")
})

test("OCIO-style high-bit view transform applies scene-linear exposure and display gamma", () => {
  const source = {
    width: 2,
    height: 1,
    channels: 4 as const,
    bitDepth: 32 as const,
    colorMode: "RGB" as const,
    storage: "float32" as const,
    data: new Float32Array([
      0.18, 0.18, 0.18, 1,
      1.5, 0.5, 0.05, 1,
    ]),
    warnings: [],
  }
  const pipeline = createOcioViewPipeline({
    inputSpace: "scene-linear",
    workingSpace: "scene-linear",
    displaySpace: "sRGB IEC61966-2.1",
    view: "Filmic",
    exposure: 1,
    gamma: 2.2,
  })

  const preview = applyOcioViewTransformToHighBitImage(source, pipeline)

  expect(preview.data[0]).toBeGreaterThan(120)
  expect(preview.data[0]).toBeLessThan(210)
  expect(preview.data[4]).toBe(255)
  expect(preview.data[5]).toBeGreaterThan(preview.data[6])
  expect(preview.data[7]).toBe(255)
})
