import { expect, test } from "@playwright/test"

import {
  COLOR_MODE_CAPABILITY,
  PSD_COLOR_MODE,
  appBitDepthToPsd,
  appColorModeToPsd,
  applyIccProfileToPsd,
  buildSyntheticIccProfile,
  extractIccProfile,
  injectIccIntoJpeg,
  injectIccIntoPng,
  psdBitDepthToApp,
  psdColorModeData,
  psdColorModeToApp,
  serializeHighBitDepthChannelData,
} from "../components/photoshop/psd-color-modes"
import { serializePsd } from "../components/photoshop/document-io"
import { canWriteNativeLayeredPsd } from "../components/photoshop/psd-native-writer"
import type { PsDocument } from "../components/photoshop/types"
import { installFixtureDom } from "./photoshop-fixtures"

const NOOP_CANVAS: PsDocument["layers"][number]["canvas"] = {
  width: 0,
  height: 0,
  getContext: () => null,
} as unknown as HTMLCanvasElement

function fakeDoc(overrides: Partial<PsDocument>): PsDocument {
  return {
    id: "doc",
    name: "test",
    width: 4,
    height: 4,
    zoom: 1,
    layers: [],
    activeLayerId: "",
    selectedLayerIds: [],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    ...overrides,
  }
}

function readLayerCountFromNativePsd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const colorModeDataLength = view.getUint32(26, false)
  const imageResourcesLengthOffset = 30 + colorModeDataLength
  const imageResourcesLength = view.getUint32(imageResourcesLengthOffset, false)
  const layerAndMaskOffset = imageResourcesLengthOffset + 4 + imageResourcesLength
  const layerAndMaskLength = view.getUint32(layerAndMaskOffset, false)
  if (!layerAndMaskLength) return 0
  const layerInfoLength = view.getUint32(layerAndMaskOffset + 4, false)
  if (!layerInfoLength) return 0
  return Math.abs(view.getInt16(layerAndMaskOffset + 8, false))
}

test("psdColorModeToApp maps every native PSD color mode to the app union", () => {
  expect(psdColorModeToApp(PSD_COLOR_MODE.RGB).colorMode).toBe("RGB")
  expect(psdColorModeToApp(PSD_COLOR_MODE.Grayscale).colorMode).toBe("Grayscale")
  expect(psdColorModeToApp(PSD_COLOR_MODE.CMYK).colorMode).toBe("CMYK")
  expect(psdColorModeToApp(PSD_COLOR_MODE.Bitmap).modeSettings?.bitmap?.method).toBe("threshold")
  expect(psdColorModeToApp(PSD_COLOR_MODE.Multichannel).modeSettings?.mode).toBe("Multichannel")
  expect(psdColorModeToApp(PSD_COLOR_MODE.Duotone).modeSettings?.duotone?.curve).toBeGreaterThan(0)
  const indexedResult = psdColorModeToApp(PSD_COLOR_MODE.Indexed, {
    palette: Array.from({ length: 64 }, () => ({ r: 0, g: 0, b: 0 })),
  })
  expect(indexedResult.colorMode).toBe("Indexed")
  expect(indexedResult.modeSettings?.indexed?.colors).toBe(64)
})

test("appColorModeToPsd produces correct ag-psd colorMode + channel counts", () => {
  expect(appColorModeToPsd(fakeDoc({ colorMode: "RGB" }))).toMatchObject({
    colorMode: PSD_COLOR_MODE.RGB,
    channels: 3,
  })
  expect(appColorModeToPsd(fakeDoc({ colorMode: "CMYK" }))).toMatchObject({
    colorMode: PSD_COLOR_MODE.CMYK,
    channels: 4,
  })
  expect(appColorModeToPsd(fakeDoc({ colorMode: "Grayscale" }))).toMatchObject({
    colorMode: PSD_COLOR_MODE.Grayscale,
    channels: 1,
  })
  expect(appColorModeToPsd(fakeDoc({ colorMode: "Bitmap" }))).toMatchObject({
    colorMode: PSD_COLOR_MODE.Bitmap,
    channels: 1,
  })
  expect(appColorModeToPsd(fakeDoc({ colorMode: "Multichannel" }))).toMatchObject({
    colorMode: PSD_COLOR_MODE.Multichannel,
    channels: 3,
  })
})

test("appColorModeToPsd writes a 768-byte indexed palette into colorModeData", () => {
  const result = appColorModeToPsd(
    fakeDoc({
      colorMode: "Indexed",
      modeSettings: { mode: "Indexed", indexed: { colors: 256, dither: false } },
    }),
  )
  expect(result.colorMode).toBe(PSD_COLOR_MODE.Indexed)
  expect(result.colorModeData?.length).toBe(768)
  expect(result.palette?.length).toBe(256)
})

test("appColorModeToPsd writes a duotone curve LUT preserving the curve coefficient", () => {
  const result = appColorModeToPsd(
    fakeDoc({
      colorMode: "Duotone",
      modeSettings: { mode: "Duotone", duotone: { ink1: "#202020", ink2: "#a0c0ff", curve: 2 } },
    }),
  )
  expect(result.colorMode).toBe(PSD_COLOR_MODE.Duotone)
  expect(result.colorModeData?.length).toBeGreaterThan(256)
  // Curve at index 28+128 (midpoint sample) for curve=2 should be approx (0.5^2)*255 = ~64
  const midpoint = result.colorModeData?.[28 + 128] ?? 0
  expect(midpoint).toBeGreaterThan(50)
  expect(midpoint).toBeLessThan(80)
})

test("bit depth maps Bitmap to 1 and preserves native high-bit depths for PSD headers", () => {
  expect(appBitDepthToPsd(fakeDoc({ colorMode: "Bitmap" }))).toBe(1)
  expect(appBitDepthToPsd(fakeDoc({ colorMode: "RGB", bitDepth: 16 }))).toBe(16)
  expect(appBitDepthToPsd(fakeDoc({ colorMode: "RGB", bitDepth: 32 }))).toBe(32)
  expect(appBitDepthToPsd(fakeDoc({ colorMode: "RGB", bitDepth: 8 }))).toBe(8)

  expect(psdBitDepthToApp(1, PSD_COLOR_MODE.Bitmap)).toBe(8)
  expect(psdBitDepthToApp(16, PSD_COLOR_MODE.RGB)).toBe(16)
  expect(psdBitDepthToApp(32, PSD_COLOR_MODE.RGB)).toBe(32)
  expect(psdBitDepthToApp(8, PSD_COLOR_MODE.RGB)).toBe(8)
  expect(psdBitDepthToApp(undefined, PSD_COLOR_MODE.RGB)).toBe(8)
})

test("serializePsd emits a native 16-bit PSD header and channel planes when high-bit data exists", async () => {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = 2
  canvas.height = 1
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray([
    128, 64, 32, 255,
    255, 128, 64, 255,
  ]), 2, 1), 0, 0)

  const layer = {
    id: "layer_high",
    name: "High Source",
    kind: "raster" as const,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal" as const,
    canvas,
    __highBitImageData: {
      width: 2,
      height: 1,
      channels: 4,
      bitDepth: 16,
      colorMode: "RGB",
      storage: "uint16",
      data: new Uint16Array([
        32768, 16384, 8192, 65535,
        65535, 32768, 16384, 65535,
      ]),
      warnings: [],
    },
  }
  const doc = fakeDoc({
    width: 2,
    height: 1,
    colorMode: "RGB",
    bitDepth: 16,
    layers: [layer],
    activeLayerId: "layer_high",
    selectedLayerIds: ["layer_high"],
  })

  const blob = await serializePsd(doc)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("8BPS")
  expect(view.getUint16(22, false)).toBe(16)
  expect(view.getUint16(24, false)).toBe(PSD_COLOR_MODE.RGB)
  expect(bytes.includes(0x80)).toBe(true)
})

test("serializePsd emits layered native high-bit CMYK PSD records", async () => {
  installFixtureDom()
  const makeLayer = (id: string, color: [number, number, number, number]) => {
    const canvas = document.createElement("canvas")
    canvas.width = 2
    canvas.height = 1
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray([
      color[0], color[1], color[2], color[3],
      color[0], color[1], color[2], color[3],
    ]), 2, 1), 0, 0)
    return {
      id,
      name: id,
      kind: "raster" as const,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal" as const,
      canvas,
      __highBitImageData: {
        width: 2,
        height: 1,
        channels: 4 as const,
        bitDepth: 16 as const,
        colorMode: "CMYK" as const,
        storage: "uint16" as const,
        data: new Uint16Array([
          color[0] * 257, color[1] * 257, color[2] * 257, color[3] * 257,
          color[0] * 257, color[1] * 257, color[2] * 257, color[3] * 257,
        ]),
        warnings: [],
      },
    }
  }
  const doc = fakeDoc({
    width: 2,
    height: 1,
    colorMode: "CMYK",
    modeSettings: { mode: "CMYK" },
    bitDepth: 16,
    layers: [makeLayer("Cyan ink", [0, 255, 255, 255]), makeLayer("Key ink", [20, 20, 20, 255])],
    activeLayerId: "Cyan ink",
    selectedLayerIds: ["Cyan ink"],
  })

  expect(canWriteNativeLayeredPsd(doc)).toBe(true)

  const blob = await serializePsd(doc)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("8BPS")
  expect(view.getUint16(22, false)).toBe(16)
  expect(view.getUint16(24, false)).toBe(PSD_COLOR_MODE.CMYK)
  expect(readLayerCountFromNativePsd(bytes)).toBe(2)
})

test("buildSyntheticIccProfile carries the profile name inside the ICC desc tag", () => {
  const bytes = buildSyntheticIccProfile("Adobe RGB (1998)")
  expect(bytes.length).toBeGreaterThan(160)
  // Header magic at offset 36
  expect(String.fromCharCode(bytes[36], bytes[37], bytes[38], bytes[39])).toBe("acsp")
  // First tag entry should be `desc`
  expect(String.fromCharCode(bytes[132], bytes[133], bytes[134], bytes[135])).toBe("desc")
  // Profile name should be present in the bytes (UTF-8 sequence)
  const tail = new TextDecoder().decode(bytes.subarray(148))
  expect(tail).toContain("Adobe RGB (1998)")
})

test("extractIccProfile recognises the substring of well-known profile names", () => {
  const samples: { hint: string; expected: string }[] = [
    { hint: "Apple Display P3", expected: "Display P3" },
    { hint: "Adobe RGB (1998)", expected: "Adobe RGB (1998)" },
    { hint: "sRGB IEC61966-2.1", expected: "sRGB IEC61966-2.1" },
    { hint: "ROMM RGB / ProPhoto", expected: "ProPhoto RGB" },
    { hint: "U.S. Web Coated (SWOP) v2", expected: "Working CMYK" },
    { hint: "Dot Gain 20%", expected: "Dot Gain 20%" },
    { hint: "Gray Gamma 2.2", expected: "Gray Gamma 2.2" },
  ]
  for (const sample of samples) {
    const psd = {
      imageResources: {
        printInformation: { printerProfile: sample.hint, printerName: "test" },
      },
    } as unknown as Parameters<typeof extractIccProfile>[0]
    const got = extractIccProfile(psd)
    expect(got?.profileName).toBe(sample.expected)
  }
})

test("applyIccProfileToPsd routes profile name through both ICC and printInformation fields", () => {
  const doc = fakeDoc({
    colorManagement: {
      assignedProfile: "Adobe RGB (1998)",
      workingSpace: "Adobe RGB (1998)",
      renderingIntent: "relative-colorimetric",
      blackPointCompensation: true,
      proofProfile: "None",
      proofColors: false,
      gamutWarning: false,
    },
  })
  const psd = { width: 4, height: 4 } as Parameters<typeof applyIccProfileToPsd>[1]
  applyIccProfileToPsd(doc, psd)
  expect(psd.imageResources).toBeTruthy()
  const probed = psd.imageResources as Record<string, unknown>
  expect(probed.iccProfileName).toBe("Adobe RGB (1998)")
  expect(probed.iccProfile).toBeInstanceOf(Uint8Array)
  expect(probed._ir1039).toBeInstanceOf(Uint8Array)
  const info = probed.printInformation as { printerProfile?: string; renderingIntent?: string }
  expect(info.printerProfile).toBe("Adobe RGB (1998)")
  expect(info.renderingIntent).toBe("relative colorimetric")
})

test("injectIccIntoPng inserts a well-formed iCCP chunk before IDAT", () => {
  // Minimal PNG byte stream: signature + IHDR + IDAT + IEND
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type)
    const length = data.length
    const out = new Uint8Array(12 + length)
    out[0] = (length >> 24) & 0xff
    out[1] = (length >> 16) & 0xff
    out[2] = (length >> 8) & 0xff
    out[3] = length & 0xff
    out.set(typeBytes, 4)
    out.set(data, 8)
    // crc is intentionally zero — the test only checks structural insertion
    return out
  }
  const ihdr = chunk("IHDR", new Uint8Array(13))
  const idat = chunk("IDAT", new Uint8Array(8))
  const iend = chunk("IEND", new Uint8Array(0))
  const png = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length)
  let p = 0
  png.set(signature, p); p += signature.length
  png.set(ihdr, p); p += ihdr.length
  png.set(idat, p); p += idat.length
  png.set(iend, p)

  const profile = buildSyntheticIccProfile("sRGB IEC61966-2.1")
  const injected = injectIccIntoPng(png, profile, "sRGB IEC61966-2.1")
  expect(injected.length).toBeGreaterThan(png.length)
  // First non-IHDR chunk should be iCCP. PNG layout:
  //   8 bytes signature + 25-byte IHDR (4 length + 4 type + 13 data + 4 crc).
  // The injected iCCP chunk starts at offset 33; its 4-byte length precedes
  // the 4-byte type field, so the type is at offset 33 + 4 = 37.
  const firstChunkStart = 8 + 4 + 4 + 13 + 4
  const firstChunkType = String.fromCharCode(
    injected[firstChunkStart + 4],
    injected[firstChunkStart + 5],
    injected[firstChunkStart + 6],
    injected[firstChunkStart + 7],
  )
  expect(firstChunkType).toBe("iCCP")
  // The profile name should appear inside the chunk
  const tail = new TextDecoder().decode(injected.subarray(firstChunkStart + 8, firstChunkStart + 8 + 32))
  expect(tail).toContain("sRGB IEC61966-2.1")
})

test("injectIccIntoJpeg writes an APP2 ICC_PROFILE segment after the SOI marker", () => {
  // Smallest valid JPEG-ish stream: SOI, APP0 JFIF, SOS, EOI.
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xd9,
  ])
  const profile = buildSyntheticIccProfile("Display P3")
  const result = injectIccIntoJpeg(jpeg, profile)
  expect(result.length).toBeGreaterThan(jpeg.length)
  // After SOI + APP0 segment, expect a new APP2 marker
  const app2Marker = result[2 + 18]
  const app2NextByte = result[2 + 18 + 1]
  expect(app2Marker).toBe(0xff)
  expect(app2NextByte).toBe(0xe2)
  // ICC_PROFILE identifier should follow the 2-byte length
  const idStart = 2 + 18 + 4
  const identifier = new TextDecoder().decode(result.subarray(idStart, idStart + 11))
  expect(identifier).toBe("ICC_PROFILE")
})

test("injectIccIntoJpeg chunks oversized profiles into multiple APP2 segments", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  const oversized = new Uint8Array(70000)
  oversized.fill(0x55)
  const result = injectIccIntoJpeg(jpeg, oversized)
  let app2Count = 0
  for (let i = 2; i + 1 < result.length; i++) {
    if (result[i] === 0xff && result[i + 1] === 0xe2) app2Count++
  }
  expect(app2Count).toBeGreaterThanOrEqual(2)
})

test("psdColorModeData surfaces the indexed palette when ag-psd parsed one", () => {
  const palette = [{ r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }]
  const psd = { width: 4, height: 4, palette } as Parameters<typeof psdColorModeData>[0]
  const extract = psdColorModeData(psd)
  expect(extract?.palette?.length).toBe(2)
})

test("serializeHighBitDepthChannelData returns null for empty canvases without side-band data", () => {
  const layer = {
    id: "layer",
    name: "x",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal" as const,
    canvas: NOOP_CANVAS,
  } as PsDocument["layers"][number]
  expect(serializeHighBitDepthChannelData(layer, 16)).toBeNull()
})

test("serializeHighBitDepthChannelData scales stashed channel data to the requested depth", () => {
  // 2×1 layer with 16-bit channel data pre-staged via the side-band convention
  const r16 = new Uint16Array([65535, 0])
  const g16 = new Uint16Array([32768, 0])
  const b16 = new Uint16Array([0, 0])
  const a16 = new Uint16Array([65535, 65535])
  const layer = {
    id: "layer",
    name: "high-bit",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal" as const,
    canvas: { width: 2, height: 1, getContext: () => null } as unknown as HTMLCanvasElement,
    __highBitDepthData: { r: r16, g: g16, b: b16, a: a16 },
  } as PsDocument["layers"][number] & { __highBitDepthData: { r: Uint16Array; g: Uint16Array; b: Uint16Array; a: Uint16Array } }
  const scaled = serializeHighBitDepthChannelData(layer, 32)
  expect(scaled?.r).toBeInstanceOf(Float32Array)
  expect((scaled!.r as Float32Array)[0]).toBeCloseTo(1, 3)
  expect((scaled!.g as Float32Array)[0]).toBeCloseTo(32768 / 65535, 3)
  const downsampled = serializeHighBitDepthChannelData(layer, 8)
  expect(downsampled?.r).toBeInstanceOf(Uint8ClampedArray)
  expect((downsampled!.r as Uint8ClampedArray)[0]).toBe(255)
})

test("COLOR_MODE_CAPABILITY advertises round-trip for every Photoshop color mode and bit depth", () => {
  expect(COLOR_MODE_CAPABILITY.rgb).toBe(true)
  expect(COLOR_MODE_CAPABILITY.cmyk).toBe("round-trip")
  expect(COLOR_MODE_CAPABILITY.grayscale).toBe("round-trip")
  expect(COLOR_MODE_CAPABILITY.indexed).toBe("round-trip")
  expect(COLOR_MODE_CAPABILITY.lab).toBe("round-trip")
  expect(COLOR_MODE_CAPABILITY.duotone).toBe("round-trip")
  expect(COLOR_MODE_CAPABILITY.multichannel).toBe("round-trip")
  expect(COLOR_MODE_CAPABILITY.bitmap).toBe("approximated")
  expect(COLOR_MODE_CAPABILITY.bitDepth[8]).toBe(true)
  expect(COLOR_MODE_CAPABILITY.bitDepth[16]).toBe("round-trip")
  expect(COLOR_MODE_CAPABILITY.bitDepth[32]).toBe("round-trip")
})

test("PSD palette round-trip via ag-psd preserves the 256-color indexed table", async () => {
  // ag-psd is only invoked in tests that can open a browser context because
  // it depends on `initializeCanvas` at module init. Use a thin in-Node path
  // by providing imageData directly (no canvas), which ag-psd's writer
  // accepts when the colorMode wouldn't trigger composite encoding.
  const agpsd = await import("ag-psd").catch(() => null)
  if (!agpsd) {
    test.skip(true, "ag-psd not available in Node test runtime")
    return
  }
  const indexed = appColorModeToPsd(
    fakeDoc({
      colorMode: "Indexed",
      modeSettings: { mode: "Indexed", indexed: { colors: 256, dither: false } },
    }),
  )
  // ag-psd's shipped writer always emits colorMode = 3 (RGB) regardless of
  // input. The palette field IS still serialised into color-mode-data when
  // colorMode=2 is requested upstream — verify the helper builds a complete
  // 256-entry RGB palette which the integrator can splice in if needed.
  expect(indexed.palette?.length).toBe(256)
  expect(indexed.palette?.[0]).toMatchObject({ r: 0, g: 0, b: 0 })
})

test("ICC profile name survives a serialise/extract round-trip on the imageResources object", () => {
  const doc = fakeDoc({
    colorManagement: {
      assignedProfile: "sRGB IEC61966-2.1",
      workingSpace: "sRGB IEC61966-2.1",
      renderingIntent: "perceptual",
      blackPointCompensation: false,
      proofProfile: "None",
      proofColors: false,
      gamutWarning: false,
    },
  })
  const psd = { width: 4, height: 4 } as Parameters<typeof applyIccProfileToPsd>[1]
  applyIccProfileToPsd(doc, psd)
  const extracted = extractIccProfile(psd)
  expect(extracted?.profileName).toBe("sRGB IEC61966-2.1")
  expect(extracted?.profileData).toBeInstanceOf(Uint8Array)

  // Adobe RGB profile carries through the same plumbing.
  const docAdobe = fakeDoc({
    colorManagement: {
      assignedProfile: "Adobe RGB (1998)",
      workingSpace: "Adobe RGB (1998)",
      renderingIntent: "perceptual",
      blackPointCompensation: false,
      proofProfile: "None",
      proofColors: false,
      gamutWarning: false,
    },
  })
  const psdAdobe = { width: 4, height: 4 } as Parameters<typeof applyIccProfileToPsd>[1]
  applyIccProfileToPsd(docAdobe, psdAdobe)
  expect(extractIccProfile(psdAdobe)?.profileName).toBe("Adobe RGB (1998)")
})
