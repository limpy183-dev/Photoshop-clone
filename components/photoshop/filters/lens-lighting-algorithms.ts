import {
  bilinearSample,
} from "./distortion-algorithms"
import {
  clamp01,
  clamp8,
  luma,
} from "./pixel-helpers"

export interface LensProfilePreset {
  k1: number
  k2: number
  k3: number
  p1: number
  p2: number
  vignette: number
  chromatic: number
  defringe: number
  description: string
}

export const LENS_DEFAULT_VIGNETTE_MIDPOINT = 68
export const LENS_MANUAL_DISTORTION_DIVISOR = 115
export const LENS_MANUAL_HIGHER_ORDER_DISTORTION_SCALE = 0.55
export const LENS_CHROMATIC_SHIFT_SCALE = 1.5

export const LENS_PROFILE_PRESETS: Record<string, LensProfilePreset> = {
  custom:        { k1: 0,     k2: 0,    k3: 0,    p1: 0,    p2: 0,    vignette: 0,    chromatic: 0,    defringe: 0,    description: "Manual" },
  smartphone:    { k1: 0.16,  k2: 0.04, k3: 0,    p1: 0,    p2: 0,    vignette: 0.18, chromatic: 0.08, defringe: 0.16, description: "Generic phone wide" },
  "compact-wide": { k1: 0.22, k2: 0.06, k3: 0.01, p1: 0,    p2: 0,    vignette: 0.20, chromatic: 0.12, defringe: 0.16, description: "Compact camera wide" },
  "wide-angle":  { k1: 0.34,  k2: 0.10, k3: 0.02, p1: 0,    p2: 0,    vignette: 0.32, chromatic: 0.18, defringe: 0.20, description: "24mm wide" },
  fisheye:       { k1: 0.62,  k2: 0.30, k3: 0.10, p1: 0,    p2: 0,    vignette: 0.45, chromatic: 0.22, defringe: 0.24, description: "Fisheye 8-15mm" },
  "standard-50": { k1: 0.04,  k2: 0.01, k3: 0,    p1: 0,    p2: 0,    vignette: 0.08, chromatic: 0.04, defringe: 0.08, description: "Standard 50mm" },
  telephoto:     { k1: -0.10, k2: -0.02, k3: 0,   p1: 0,    p2: 0,    vignette: 0.10, chromatic: 0.05, defringe: 0.10, description: "85-200mm tele" },
  "macro-100":   { k1: -0.03, k2: -0.01, k3: 0,   p1: 0,    p2: 0,    vignette: 0.05, chromatic: 0.03, defringe: 0.12, description: "100mm macro flat-field" },
  "super-tele":  { k1: -0.22, k2: -0.06, k3: -0.01, p1: 0,  p2: 0,    vignette: 0.06, chromatic: 0.03, defringe: 0.08, description: "300mm+ super tele" },
  "drone-fpv":   { k1: 0.45,  k2: 0.18, k3: 0.05, p1: 0.01, p2: 0.01, vignette: 0.36, chromatic: 0.20, defringe: 0.22, description: "Drone/action cam" },
  "architecture-shift": { k1: 0.08, k2: 0.02, k3: 0, p1: -0.01, p2: 0.01, vignette: 0.14, chromatic: 0.06, defringe: 0.14, description: "Shift lens / architecture" },
}

export interface LensCorrectionExtras {
  perspectiveV?: number
  perspectiveH?: number
  vignetteMidpoint?: number
  fringeR?: number
  fringeG?: number
  fringeB?: number
  scalePct?: number
}

export function lensCorrection(
  src: ImageData,
  distortion: number,
  vignette: number,
  chromatic: number,
  k2Strength: number = 0,
  k3Strength: number = 0,
  tangentialX: number = 0,
  tangentialY: number = 0,
  profile: string = "custom",
  autoScale: boolean = false,
  edgeMode: string = "clamp",
  profileStrength: number = 100,
  defringe: number = 0,
  extras: LensCorrectionExtras = {},
): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const cx = (w - 1) / 2, cy = (h - 1) / 2
  const maxR = Math.max(1, Math.hypot(cx, cy))
  const preset = LENS_PROFILE_PRESETS[profile] ?? LENS_PROFILE_PRESETS.custom
  const strength = Math.max(0, Math.min(150, profileStrength)) / 100
  const k1 = preset.k1 * strength + distortion / LENS_MANUAL_DISTORTION_DIVISOR
  const k2 = preset.k2 * strength + (k2Strength + distortion * LENS_MANUAL_HIGHER_ORDER_DISTORTION_SCALE) / 420
  const k3 = preset.k3 * strength + k3Strength / 900
  const p1 = preset.p1 * strength + tangentialX / 1200
  const p2 = preset.p2 * strength + tangentialY / 1200
  const ca = (chromatic + preset.chromatic * 100 * strength) / 100
  const vig = (vignette + preset.vignette * 100 * strength) / 100
  const fringeClean = Math.max(0, Math.min(100, defringe + preset.defringe * 100 * strength)) / 100
  const fringeR = (extras.fringeR ?? 0) / 100
  const fringeG = (extras.fringeG ?? 0) / 100
  const fringeB = (extras.fringeB ?? 0) / 100
  const perspV = (extras.perspectiveV ?? 0) / 200
  const perspH = (extras.perspectiveH ?? 0) / 200
  const vigMid = Math.max(0, Math.min(100, extras.vignetteMidpoint ?? LENS_DEFAULT_VIGNETTE_MIDPOINT)) / 100
  const extraScale = Math.max(0.05, (extras.scalePct ?? 100) / 100)
  // Compute an auto-scale factor so the corrected image fills the frame
  // without exposing the resampled edge — sample the 4 image corners and
  // scale by the smallest displacement factor.
  let outScale = 1 / extraScale
  if (autoScale) {
    const corners: Array<[number, number]> = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    ]
    let minFactor = Infinity
    for (const [px, py] of corners) {
      const dx = px - cx, dy = py - cy
      const nx2 = dx / maxR, ny2 = dy / maxR
      const r2c = nx2 * nx2 + ny2 * ny2
      const f = 1 + k1 * r2c + k2 * r2c * r2c + k3 * r2c * r2c * r2c
      if (f > 0 && f < minFactor) minFactor = f
    }
    if (isFinite(minFactor) && minFactor > 0) outScale = minFactor / extraScale
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) * outScale, dy = (y - cy) * outScale
      const nx = dx / maxR, ny = dy / maxR
      const r2 = nx * nx + ny * ny
      const r4 = r2 * r2, r6 = r4 * r2
      const factor = 1 + k1 * r2 + k2 * r4 + k3 * r6
      // Brown-Conrady tangential distortion (off-axis lens tilt)
      const tx = 2 * p1 * nx * ny + p2 * (r2 + 2 * nx * nx)
      const ty = p1 * (r2 + 2 * ny * ny) + 2 * p2 * nx * ny
      // Vertical / horizontal perspective: keystone correction
      const ny01 = (y / Math.max(1, h - 1)) - 0.5
      const nx01 = (x / Math.max(1, w - 1)) - 0.5
      const perspXScale = 1 + perspV * (2 * ny01)
      const perspYScale = 1 + perspH * (2 * nx01)
      const sx = cx + dx * factor * perspXScale + tx * maxR
      const sy = cy + dy * factor * perspYScale + ty * maxR
      const chromaShift = ca * (0.3 + r2) * LENS_CHROMATIC_SHIFT_SCALE
      const red = bilinearSample(src.data, w, h, sx + nx * (chromaShift + fringeR * 8), sy + ny * (chromaShift + fringeR * 8))
      const mid = bilinearSample(src.data, w, h, sx + nx * fringeG * 4, sy + ny * fringeG * 4)
      const blue = bilinearSample(src.data, w, h, sx - nx * (chromaShift + fringeB * 8), sy - ny * (chromaShift + fringeB * 8))
      const radial = Math.pow(clamp01(Math.sqrt(r2)), 1.7)
      const radialShaped = Math.pow(radial, 0.3 + (1 - vigMid) * 2.2)
      const shade = vig >= 0 ? clamp01(1 - vig * radialShaped * 0.85) : 1 + Math.abs(vig) * radialShaped * 0.55
      const i = (y * w + x) * 4
      const outOfBounds = sx < 0 || sx > w - 1 || sy < 0 || sy > h - 1
      if (outOfBounds && edgeMode === "transparent") {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0
      } else if (outOfBounds && edgeMode === "black") {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = mid[3]
      } else if (outOfBounds && edgeMode === "white") {
        out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = mid[3]
      } else {
        let rr = red[0]
        let gg = mid[1]
        let bb = blue[2]
        if (fringeClean > 0) {
          const rb = (rr + bb) / 2
          const clean = fringeClean * radial
          gg = gg * (1 - clean) + rb * clean
          rr = rr * (1 - clean * 0.3) + rb * clean * 0.3
          bb = bb * (1 - clean * 0.3) + rb * clean * 0.3
        }
        out[i] = clamp8(rr * shade)
        out[i + 1] = clamp8(gg * shade)
        out[i + 2] = clamp8(bb * shade)
        out[i + 3] = mid[3]
      }
    }
  }
  return new ImageData(out, w, h)
}

export interface LightConfig {
  type?: "spot" | "point" | "directional" | "omni"
  x?: number
  y?: number
  z?: number
  intensity?: number
  color?: [number, number, number]
  radius?: number
  focus?: number
  angleX?: number
  angleY?: number
}

export interface MaterialConfig {
  gloss?: number
  shine?: number
  ambientColor?: [number, number, number]
  exposure?: number
}

export function defaultLightsForStyle(style: string, intensityPercent: number): LightConfig[] {
  const intensity = Math.max(0, intensityPercent) / 100
  if (style === "directional") {
    return [{ type: "directional", angleX: -0.5, angleY: -0.7, z: 0.7, intensity, color: [255, 240, 215] }]
  }
  if (style === "omni" || style === "point") {
    return [{ type: "point", x: 0.5, y: 0.5, z: 0.45, intensity, color: [255, 245, 230], radius: 0.7 }]
  }
  if (style === "three-point") {
    return [
      { type: "spot", x: 0.32, y: 0.3, z: 0.55, intensity, color: [255, 235, 200], radius: 0.55, focus: 0.45 },
      { type: "spot", x: 0.72, y: 0.4, z: 0.4, intensity: intensity * 0.55, color: [200, 220, 255], radius: 0.5, focus: 0.35 },
      { type: "point", x: 0.5, y: 0.85, z: 0.3, intensity: intensity * 0.35, color: [255, 215, 180], radius: 0.65 },
    ]
  }
  if (style === "rgb-trio") {
    return [
      { type: "spot", x: 0.25, y: 0.35, z: 0.5, intensity, color: [255, 60, 60], radius: 0.55, focus: 0.4 },
      { type: "spot", x: 0.55, y: 0.3, z: 0.5, intensity, color: [60, 255, 80], radius: 0.55, focus: 0.4 },
      { type: "spot", x: 0.75, y: 0.5, z: 0.5, intensity, color: [60, 80, 255], radius: 0.55, focus: 0.4 },
    ]
  }
  return [{ type: "spot", x: 0.45, y: 0.35, z: 0.6, intensity, color: [255, 240, 215], radius: 0.6, focus: 0.4 }]
}

export function parseLightsConfig(raw: unknown): LightConfig[] | null {
  if (!raw) return null
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!Array.isArray(value)) return null
    return value.filter((entry) => entry && typeof entry === "object") as LightConfig[]
  } catch {
    return null
  }
}

export function usesDefaultLightingMaterial(material: MaterialConfig) {
  return (
    (material.gloss ?? 0.5) === 0.5 &&
    (material.shine ?? 0.6) === 0.6 &&
    (material.exposure ?? 0) === 0 &&
    material.ambientColor === undefined
  )
}

export function lightingEffectsDefault(src: ImageData, style: string, intensity: number, ambient: number, height: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const light = Math.max(0, intensity) / 100
  const amb = Math.max(0, ambient) / 100
  const heightScale = Math.max(0, Math.min(100, height)) / 100
  const lx = style === "directional" ? -0.5 : 0.35
  const ly = style === "directional" ? -0.7 : -0.45
  const lz = style === "omni" ? 0.95 : 0.7
  const len = Math.hypot(lx, ly, lz)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const xl = Math.max(0, x - 1)
      const xr = Math.min(w - 1, x + 1)
      const yu = Math.max(0, y - 1)
      const yd = Math.min(h - 1, y + 1)
      const right = (y * w + xr) * 4
      const left = (y * w + xl) * 4
      const down = (yd * w + x) * 4
      const up = (yu * w + x) * 4
      const lumX = luma(src.data[right], src.data[right + 1], src.data[right + 2]) - luma(src.data[left], src.data[left + 1], src.data[left + 2])
      const lumY = luma(src.data[down], src.data[down + 1], src.data[down + 2]) - luma(src.data[up], src.data[up + 1], src.data[up + 2])
      const nx = (-lumX / 255) * heightScale
      const ny = (-lumY / 255) * heightScale
      const nz = 1
      const nLen = Math.hypot(nx, ny, nz)
      let spot = 1
      if (style === "spot") {
        const dx = (x - w * 0.45) / w
        const dy = (y - h * 0.35) / h
        spot = Math.max(0, 1 - Math.hypot(dx, dy) * 2.2)
      } else if (style === "omni") {
        const dx = (x - w * 0.5) / w
        const dy = (y - h * 0.5) / h
        spot = Math.max(0, 1 - Math.hypot(dx, dy) * 1.8)
      }
      const diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz) / (nLen * len))
      const highlight = Math.pow(diffuse, 18) * light * (0.35 + heightScale)
      const falloff = style === "directional" ? 1 : spot
      const amount = amb + diffuse * light * falloff
      out[i] = clamp8(src.data[i] * amount + (12 + 70 * highlight) * falloff)
      out[i + 1] = clamp8(src.data[i + 1] * amount + (16 + 62 * highlight) * falloff)
      out[i + 2] = clamp8(src.data[i + 2] * amount + (24 + 48 * highlight) * falloff)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

export function lightingEffects(
  src: ImageData,
  style: string,
  intensity: number,
  ambient: number,
  height: number,
  lightsRaw?: unknown,
  materialRaw?: unknown,
  bumpSource?: ImageData | null,
  bumpChannel?: "luminance" | "red" | "green" | "blue" | "alpha",
): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const amb = Math.max(0, ambient) / 100
  const heightScale = Math.max(0, Math.min(100, height)) / 100
  const customLights = parseLightsConfig(lightsRaw)
  const material: MaterialConfig = (() => {
    if (!materialRaw) return {}
    try {
      return typeof materialRaw === "string" ? JSON.parse(materialRaw) : (materialRaw as MaterialConfig)
    } catch {
      return {}
    }
  })()
  if (!customLights && !bumpSource && (bumpChannel ?? "luminance") === "luminance" && usesDefaultLightingMaterial(material)) {
    return lightingEffectsDefault(src, style, intensity, ambient, height)
  }
  const lights = customLights ?? defaultLightsForStyle(style, intensity)
  const gloss = Math.max(0, Math.min(1, material.gloss ?? 0.5))
  const shine = Math.max(0, Math.min(1, material.shine ?? 0.6))
  const exposure = Math.pow(2, Math.max(-2, Math.min(2, material.exposure ?? 0)))
  const ambColor = material.ambientColor ?? [255, 255, 255]
  const specExp = 4 + gloss * 96

  // Compute a per-pixel scalar height value from the source or the supplied
  // bump-source image (using the requested channel). The normals are derived
  // from finite differences over the height field.
  const bw = bumpSource?.width ?? w
  const bh = bumpSource?.height ?? h
  const bumpData = bumpSource?.data ?? src.data
  const channel = bumpChannel ?? "luminance"
  const sampleHeight = (px: number, py: number): number => {
    // Scale source-space coords into bump-source space.
    const sx = bumpSource ? Math.min(bw - 1, Math.max(0, Math.round((px / Math.max(1, w - 1)) * (bw - 1)))) : px
    const sy = bumpSource ? Math.min(bh - 1, Math.max(0, Math.round((py / Math.max(1, h - 1)) * (bh - 1)))) : py
    const i = (sy * bw + sx) * 4
    const r = bumpData[i], g = bumpData[i + 1], b = bumpData[i + 2], a = bumpData[i + 3]
    switch (channel) {
      case "red":   return r
      case "green": return g
      case "blue":  return b
      case "alpha": return a
      default:      return luma(r, g, b)
    }
  }

  const nxBuf = new Float32Array(w * h)
  const nyBuf = new Float32Array(w * h)
  const nzBuf = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x
      const xr = x < w - 1 ? x + 1 : x
      const yu = y > 0 ? y - 1 : y
      const yd = y < h - 1 ? y + 1 : y
      const lx = (sampleHeight(xr, y) - sampleHeight(xl, y)) / 255
      const ly = (sampleHeight(x, yd) - sampleHeight(x, yu)) / 255
      const vx = -lx * heightScale * 3
      const vy = -ly * heightScale * 3
      const vz = 1
      const n = Math.hypot(vx, vy, vz) || 1
      const idx = y * w + x
      nxBuf[idx] = vx / n
      nyBuf[idx] = vy / n
      nzBuf[idx] = vz / n
    }
  }

  const diag = Math.hypot(w, h)
  const prep = lights.map((light) => {
    const t = light.type ?? "spot"
    const lc = light.color ?? [255, 255, 255]
    const intensityN = Math.max(0, light.intensity ?? 0.8)
    if (t === "directional") {
      const dx = light.angleX ?? -0.4
      const dy = light.angleY ?? -0.5
      const dz = light.z ?? 0.75
      const n = Math.hypot(dx, dy, dz) || 1
      return { kind: "dir" as const, dx: dx / n, dy: dy / n, dz: dz / n, intensity: intensityN, color: lc }
    }
    return {
      kind: (t === "point" || t === "omni") ? ("point" as const) : ("spot" as const),
      cx: (light.x ?? 0.5) * w,
      cy: (light.y ?? 0.5) * h,
      cz: Math.max(0.05, light.z ?? 0.4) * diag,
      radius: Math.max(0.01, light.radius ?? 0.6) * diag,
      focus: Math.max(0.01, light.focus ?? 0.4),
      intensity: intensityN,
      color: lc,
    }
  })

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const idx = y * w + x
      const nX = nxBuf[idx], nY = nyBuf[idx], nZ = nzBuf[idx]

      let rLight = ambColor[0] * amb
      let gLight = ambColor[1] * amb
      let bLight = ambColor[2] * amb

      for (const light of prep) {
        let lx = 0, ly = 0, lz = 0
        let attenuation = 1
        let cone = 1
        if (light.kind === "dir") {
          lx = light.dx; ly = light.dy; lz = light.dz
        } else {
          const dx = light.cx - x
          const dy = light.cy - y
          const dz = light.cz
          const len = Math.hypot(dx, dy, dz) || 1
          lx = dx / len; ly = dy / len; lz = dz / len
          const planar = Math.hypot(dx, dy)
          attenuation = Math.max(0, 1 - planar / light.radius)
          attenuation *= attenuation
          if (light.kind === "spot") {
            const coneAngle = Math.max(0, lz)
            cone = Math.pow(coneAngle, 1 + light.focus * 10)
          }
        }
        const dotN = Math.max(0, nX * lx + nY * ly + nZ * lz)
        const diffuse = dotN * attenuation * cone * light.intensity
        const hx = lx, hy = ly, hz = lz + 1
        const hLen = Math.hypot(hx, hy, hz) || 1
        const specDot = Math.max(0, (nX * hx + nY * hy + nZ * hz) / hLen)
        const specular = Math.pow(specDot, specExp) * shine * attenuation * cone * light.intensity

        rLight += light.color[0] * diffuse + 255 * specular
        gLight += light.color[1] * diffuse + 255 * specular
        bLight += light.color[2] * diffuse + 255 * specular
      }

      out[i] = clamp8((src.data[i] * rLight / 255) * exposure)
      out[i + 1] = clamp8((src.data[i + 1] * gLight / 255) * exposure)
      out[i + 2] = clamp8((src.data[i + 2] * bLight / 255) * exposure)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, w, h)
}

