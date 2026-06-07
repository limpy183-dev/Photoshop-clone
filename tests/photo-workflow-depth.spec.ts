import { expect, test } from "@playwright/test"

import {
  CAMERA_RAW_CAMERA_PROFILES,
  CAMERA_RAW_LENS_PROFILE_DATABASE,
  CAMERA_RAW_PRESETS,
  CAMERA_RAW_LENS_PROFILES,
  applyCameraRawHighBitImage,
  applyCameraRawBatch,
  applyCameraRawImageData,
  applyCameraRawPreset,
  createCameraRawDevelopRecipe,
  createCameraRawPreset,
  createCameraRawSnapshot,
  deleteCameraRawSnapshot,
  duplicateCameraRawSnapshot,
  matchCameraRawLensProfile,
  normalizeCameraRawPresetLibrary,
  parseCameraRawSidecar,
  reconcileCameraRawSidecarRoundTrip,
  promoteCameraRawSnapshotToPreset,
  renameCameraRawSnapshot,
  serializeCameraRawSidecar,
} from "../components/photoshop/camera-raw-engine"
import { buildSelectAndMaskPreviewModel } from "../components/photoshop/photo-workflow-engine"
import type { HighBitImage } from "../components/photoshop/color-pipeline"
import { getFilter } from "../components/photoshop/filters"
import { applyFilterTiled } from "../components/photoshop/filter-worker"

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

function gradientFixture(width = 5, height = 5) {
  const pixels: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.push(x * 40 + y * 5, y * 42, 180 - x * 20, 255)
    }
  }
  return imageData(width, height, pixels)
}

test("Select and Mask preview model exposes alpha matte edge-only and split preview modes", () => {
  const alpha = buildSelectAndMaskPreviewModel({
    viewMode: "alpha-matte",
    outputTo: "new-layer-mask",
    opacity: 64,
    decontaminateColors: true,
  })
  const edge = buildSelectAndMaskPreviewModel({
    viewMode: "edge-only",
    outputTo: "selection",
  })
  const split = buildSelectAndMaskPreviewModel({
    viewMode: "split",
    outputTo: "new-layer",
  })

  expect(alpha).toMatchObject({
    viewMode: "alpha-matte",
    background: "transparent-grid",
    showsAlphaMatte: true,
    opacity: 64,
    decontaminateColors: true,
  })
  expect(edge).toMatchObject({
    viewMode: "edge-only",
    showsEdgesOnly: true,
    edgeEmphasis: "selection-transition",
  })
  expect(split).toMatchObject({
    viewMode: "split",
    showsBeforeAfterSplit: true,
    showsComposite: true,
  })
  expect(split.description).toContain("before/after")
})

test("Blur Gallery filters exist as named algorithms with spatially varying output", () => {
  const src = gradientFixture()
  const ids = ["field-blur", "iris-blur", "tilt-shift", "path-blur", "spin-blur"]

  for (const id of ids) {
    const filter = getFilter(id)
    expect(filter, id).toBeTruthy()
    const out = filter!.apply(src, {
      blur: 8,
      radius: 35,
      feather: 25,
      angle: 0,
      distance: 8,
      centerX: 50,
      centerY: 50,
    })
    expect(out.width).toBe(src.width)
    expect(Array.from(out.data)).not.toEqual(Array.from(src.data))
  }
})

test("Field Blur pins interpolate blur amount across the canvas", () => {
  const src = gradientFixture(9, 3)
  const filter = getFilter("field-blur")!

  const out = filter.apply(src, {
    blur: 18,
    pins: "0,50,0;100,50,18",
  })

  const left = 1 * 4
  const right = (1 * src.width + 7) * 4
  const leftDelta = Math.abs(out.data[left] - src.data[left])
  const rightDelta = Math.abs(out.data[right] - src.data[right])

  expect(leftDelta).toBeLessThan(rightDelta)
})

test("tiled filter execution reproduces full-frame output for local per-pixel filters", async () => {
  const src = gradientFixture(6, 4)
  const filter = getFilter("brightness-contrast")!
  const params = { brightness: 18, contrast: 22, useLegacy: false }

  const expected = filter.apply(src, params)
  const tiled = await applyFilterTiled("brightness-contrast", src, params, { tileSize: 2, overlap: 0 })

  expect(Array.from(tiled.data)).toEqual(Array.from(expected.data))
})

test("Camera Raw engine applies HSL, optics, masks, snapshots, presets, and batch settings", () => {
  const src = gradientFixture(3, 2)
  const mask = new Uint8ClampedArray([255, 0, 0, 255, 0, 0])
  const settings = {
    ...CAMERA_RAW_PRESETS.landscape.settings,
    exposure: 0.35,
    hsl: { blues: { hue: -10, saturation: 30, luminance: -5 } },
    optics: { distortion: 12, vignette: -20, chromaticAberration: 8 },
    calibration: { redHue: 4, greenHue: -3, blueHue: 2, saturation: 12 },
  }

  const snapshot = createCameraRawSnapshot("Landscape masked", settings)
  const masked = applyCameraRawImageData(src, settings, { maskData: mask, maskWidth: 3, maskHeight: 2 })
  const batch = applyCameraRawBatch([src, src], snapshot.settings)

  expect(snapshot.name).toBe("Landscape masked")
  expect(masked.data[0]).not.toBe(src.data[0])
  expect(Array.from(masked.data.slice(4, 8))).toEqual(Array.from(src.data.slice(4, 8)))
  expect(batch).toHaveLength(2)
  expect(Array.from(batch[0].data)).toEqual(Array.from(applyCameraRawImageData(src, snapshot.settings).data))
})

test("Camera Raw manages user presets, snapshots, and local lens profiles", () => {
  const src = gradientFixture(5, 5)
  const baseSettings = {
    ...CAMERA_RAW_PRESETS.portrait.settings,
    optics: {
      profileId: "phone-wide" as const,
      profileStrength: 80,
      distortion: -8,
      vignette: 14,
      chromaticAberration: 12,
      defringe: 35,
    },
  }

  const preset = createCameraRawPreset("Phone portrait cleanup", baseSettings, "User")
  const library = normalizeCameraRawPresetLibrary([preset])
  const applied = applyCameraRawPreset(CAMERA_RAW_PRESETS.neutral.settings, preset, "replace")
  const snapshot = createCameraRawSnapshot("Before crop", applied)
  const renamed = renameCameraRawSnapshot(snapshot, "Before crop refined")
  const duplicate = duplicateCameraRawSnapshot(renamed, "Before crop copy")
  const promoted = promoteCameraRawSnapshotToPreset(duplicate, "Copied preset")
  const remaining = deleteCameraRawSnapshot([renamed, duplicate], renamed.id)
  const corrected = applyCameraRawImageData(src, applied)

  expect(CAMERA_RAW_LENS_PROFILES["phone-wide"].description).toContain("phone")
  expect(library.user).toHaveLength(1)
  expect(library.builtIn.map((item) => item.id)).toContain("portrait")
  expect(applied.optics?.profileId).toBe("phone-wide")
  expect(renamed.name).toBe("Before crop refined")
  expect(duplicate.id).not.toBe(renamed.id)
  expect(promoted.settings.optics?.profileStrength).toBe(80)
  expect(remaining.map((item) => item.id)).toEqual([duplicate.id])
  expect(Array.from(corrected.data)).not.toEqual(Array.from(src.data))

  const lensFilter = getFilter("lens-correction")!
  expect(lensFilter.params.find((param) => param.key === "profileStrength")).toBeTruthy()
  expect(lensFilter.params.find((param) => param.key === "defringe")).toBeTruthy()
  expect(lensFilter.params.find((param) => param.key === "profile")?.type).toBe("select")
})

test("Camera Raw keeps RAW-backed high-bit recipes, sidecars, camera profiles, and lens database matches", () => {
  const rawSource: HighBitImage = {
    width: 2,
    height: 2,
    channels: 4,
    bitDepth: 32,
    colorMode: "RGB",
    profile: "Camera Linear",
    storage: "float32",
    data: new Float32Array([
      0.08, 0.09, 0.1, 1,
      0.22, 0.18, 0.16, 1,
      0.36, 0.32, 0.28, 1,
      0.74, 0.7, 0.66, 1,
    ]),
    warnings: [],
  }
  const settings = {
    ...CAMERA_RAW_PRESETS.landscape.settings,
    exposure: 0.5,
    cameraProfileId: "adobe-color" as const,
    optics: { profileId: "phone-wide" as const, profileStrength: 75 },
  }
  const matchedLens = matchCameraRawLensProfile({
    cameraMake: "Apple",
    cameraModel: "iPhone",
    lensModel: "Phone Wide",
    focalLengthMm: 26,
  })
  const recipe = createCameraRawDevelopRecipe(rawSource, settings, {
    fileName: "fixture.dng",
    cameraMake: "Apple",
    cameraModel: "iPhone",
    lensModel: "Phone Wide",
    focalLengthMm: 26,
  })
  const sidecar = serializeCameraRawSidecar(recipe)
  const parsed = parseCameraRawSidecar(sidecar)
  const adjusted = applyCameraRawHighBitImage(rawSource, parsed.settings)

  expect(CAMERA_RAW_CAMERA_PROFILES["adobe-color"].toneCurve).toBe("medium-contrast")
  expect(CAMERA_RAW_LENS_PROFILE_DATABASE.some((profile) => profile.profileId === "phone-wide")).toBe(true)
  expect(matchedLens?.profileId).toBe("phone-wide")
  expect(recipe.nonDestructive).toBe(true)
  expect(recipe.source).toBe(rawSource)
  expect(sidecar).toContain("crs:Version")
  expect(parsed.settings.cameraProfileId).toBe("adobe-color")
  expect(parsed.metadata.fileName).toBe("fixture.dng")
  expect(adjusted.storage).toBe("float32")
  expect(adjusted.data).toBeInstanceOf(Float32Array)
  expect((adjusted.data as Float32Array)[0]).toBeGreaterThan((rawSource.data as Float32Array)[0])
  expect(Array.from(rawSource.data as Float32Array)).not.toEqual(Array.from(adjusted.data as Float32Array))
})

test("Camera Raw sidecars round-trip source metadata, settings, snapshots, and source fingerprints", () => {
  const rawSource: HighBitImage = {
    width: 2,
    height: 1,
    channels: 4,
    bitDepth: 16,
    colorMode: "RGB",
    profile: "Camera Linear",
    storage: "uint16",
    data: new Uint16Array([
      0x1000, 0x2000, 0x3000, 0xffff,
      0x8000, 0x7000, 0x6000, 0xffff,
    ]),
    warnings: ["Imported from test DNG"],
  }
  const snapshot = createCameraRawSnapshot("Warm proof", {
    ...CAMERA_RAW_PRESETS.landscape.settings,
    temperature: 12,
    exposure: 0.25,
    optics: { profileId: "standard-prime", profileStrength: 60 },
  })
  const recipe = createCameraRawDevelopRecipe(rawSource, snapshot.settings, {
    fileName: "fixture.dng",
    cameraMake: "Fixture Camera Co",
    cameraModel: "Model 1",
    lensModel: "Standard Prime",
    focalLengthMm: 50,
    aperture: 2.8,
    iso: 400,
  }, { snapshots: [snapshot] })

  const sidecar = serializeCameraRawSidecar(recipe)
  const parsed = parseCameraRawSidecar(sidecar)
  const reconciled = reconcileCameraRawSidecarRoundTrip(rawSource, parsed)

  expect(sidecar).toContain("crs:RawFileName")
  expect(sidecar).toContain("psweb:SourceFingerprint")
  expect(sidecar).toContain("psweb:CameraRawSnapshots")
  expect(parsed.metadata.iso).toBe(400)
  expect(parsed.snapshots).toHaveLength(1)
  expect(parsed.snapshots?.[0].name).toBe("Warm proof")
  expect(parsed.sourceFingerprint).toBe(reconciled.sourceFingerprint)
  expect(reconciled.sourceMatches).toBe(true)
})
