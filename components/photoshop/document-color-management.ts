import type { DocumentModeSettings, PsDocument } from "./types"
import {
  applyIccTransformToImageData,
  buildGamutWarningMaskImageData,
  convertImageDataForExport,
  softProofImageData,
  transformRgbColor,
} from "./color-pipeline"
import {
  buildColorSeparationModel,
  composeSeparationProofView,
  type SeparationProcess,
} from "./color-channel-ops"
import { convertImageDataToDocumentMode } from "./color-mode-conversion"

function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value))
}

function createColorManagementCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function luminance(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function applyTrapToImageData(image: ImageData, width: number, strength: number) {
  if (width <= 0 || strength <= 0) return
  const source = new Uint8ClampedArray(image.data)
  for (let pass = 0; pass < Math.min(4, width); pass++) {
    for (let y = 1; y < image.height - 1; y++) {
      for (let x = 1; x < image.width - 1; x++) {
        const i = (y * image.width + x) * 4
        const lum = luminance(source[i], source[i + 1], source[i + 2])
        const right = i + 4
        const down = i + image.width * 4
        const edge = Math.max(
          Math.abs(lum - luminance(source[right], source[right + 1], source[right + 2])),
          Math.abs(lum - luminance(source[down], source[down + 1], source[down + 2])),
        )
        if (edge < 35) continue
        for (let k = 0; k < 3; k++) {
          image.data[i + k] = clamp(
            image.data[i + k] * (1 - strength) +
              Math.min(source[right + k], source[down + k], source[i + k]) * strength,
          )
        }
      }
    }
  }
}

export function applyModeAndColorManagement(
  source: HTMLCanvasElement,
  doc: Pick<PsDocument, "colorMode" | "modeSettings" | "colorManagement">,
  options: { purpose?: "preview" | "export" } = {},
) {
  const modeSettings = doc.modeSettings ?? { mode: doc.colorMode }
  const color = doc.colorManagement
  const purpose = options.purpose ?? "preview"
  const active =
    doc.colorMode !== "RGB" ||
    modeSettings.mode !== "RGB" ||
    color?.proofColors ||
    color?.gamutWarning ||
    !!color?.proofChannels?.length ||
    color?.assignedProfile !== "sRGB IEC61966-2.1" ||
    (purpose === "export" && color?.assignedProfile !== color?.workingSpace)
  if (!active) return source

  const canvas = createColorManagementCanvas(source.width, source.height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const trap = modeSettings.trap?.enabled
    ? { width: modeSettings.trap.widthPx, strength: modeSettings.trap.strength }
    : null
  if (
    modeSettings.mode === "Grayscale" ||
    modeSettings.mode === "Duotone" ||
    modeSettings.mode === "Indexed" ||
    modeSettings.mode === "Bitmap"
  ) {
    image.data.set(convertImageDataToDocumentMode(image, modeSettings).data)
  }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      if (image.data[i + 3] === 0) continue
      let r = image.data[i]
      let g = image.data[i + 1]
      let b = image.data[i + 2]
      const mode = modeSettings.mode
      if (mode === "Multichannel") {
        const channels = modeSettings.multichannel?.channels
        r = channels?.r === false ? 0 : r
        g = channels?.g === false ? 0 : g
        b = channels?.b === false ? 0 : b
      } else if (mode === "CMYK") {
        const targetProfile = color?.workingSpace?.includes("CMYK")
          ? color.workingSpace
          : "Working CMYK"
        const cmyk = transformRgbColor(
          { r, g, b },
          {
            sourceProfile: color?.assignedProfile ?? "sRGB IEC61966-2.1",
            targetProfile,
            renderingIntent: color?.renderingIntent,
            blackPointCompensation: color?.blackPointCompensation,
          },
        )
        r = cmyk.rgb.r
        g = cmyk.rgb.g
        b = cmyk.rgb.b
      }
      image.data[i] = clamp(r)
      image.data[i + 1] = clamp(g)
      image.data[i + 2] = clamp(b)
    }
  }
  if (trap) applyTrapToImageData(image, Math.round(trap.width), trap.strength)
  let managed = image
  if (color) {
    if (purpose === "export") {
      managed = convertImageDataForExport(image, color).imageData
    } else if (color.proofColors && color.proofProfile !== "None") {
      managed = softProofImageData(image, color)
    } else if (color.assignedProfile && color.assignedProfile !== "sRGB IEC61966-2.1") {
      managed = applyIccTransformToImageData(image, {
        sourceProfile: color.assignedProfile,
        targetProfile: "sRGB IEC61966-2.1",
        renderingIntent: color.renderingIntent,
        blackPointCompensation: color.blackPointCompensation,
      })
    }

    if (purpose === "preview" && color.gamutWarning) {
      const mask = buildGamutWarningMaskImageData(image, color)
      for (let i = 0; i < managed.data.length; i += 4) {
        const alpha = mask.data[i + 3] / 255
        if (alpha <= 0) continue
        managed.data[i] = clamp(managed.data[i] * (1 - alpha) + mask.data[i] * alpha)
        managed.data[i + 1] = clamp(
          managed.data[i + 1] * (1 - alpha) + mask.data[i + 1] * alpha,
        )
        managed.data[i + 2] = clamp(
          managed.data[i + 2] * (1 - alpha) + mask.data[i + 2] * alpha,
        )
      }
    }
    if (purpose === "preview" && color.proofChannels?.length) {
      const colorMode = String(doc.colorMode)
      const mode: SeparationProcess =
        colorMode === "CMYK"
          ? "CMYK"
          : colorMode === "Grayscale"
            ? "Grayscale"
            : colorMode === "Lab"
              ? "Lab"
              : "RGB"
      const visiblePlateIds = color.proofChannels.map((channel) => {
        if (channel === "cyan") return "process_c"
        if (channel === "magenta") return "process_m"
        if (channel === "yellow") return "process_y"
        if (channel === "black") return "process_k"
        if (channel === "gray") return "process_gray"
        return `process_${channel[0]}`
      })
      const model = buildColorSeparationModel(managed, {
        mode,
        processProfile:
          color.proofProfile !== "None" ? color.proofProfile : color.workingSpace,
      })
      managed = composeSeparationProofView(model, {
        visiblePlateIds,
        viewMode: color.proofPlateView ?? "composite",
      })
    }
  }
  ctx.putImageData(managed, 0, 0)
  return canvas
}

export function convertCanvasToDocumentMode(
  source: HTMLCanvasElement,
  settings: DocumentModeSettings,
) {
  return applyModeAndColorManagement(source, {
    colorMode: settings.mode,
    modeSettings: settings,
    colorManagement: undefined,
  })
}
