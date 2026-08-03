export type GenerativeFillMode = "fill" | "remove" | "expand"
export type GenerativeFillProviderPreference = "auto" | "local" | "model"
export type GenerativeFillProviderStrategy = "local-prompt-inpaint" | "model-endpoint" | "model-endpoint-unconfigured"

export interface GenerativeFillProviderInput {
  endpoint?: string
  apiKeyPresent?: boolean
  provider?: GenerativeFillProviderPreference
}

export interface GenerativeFillProviderPlan {
  strategy: GenerativeFillProviderStrategy
  modelBacked: boolean
  endpoint?: string
  reason: string
}

export interface GenerativeFillOptions extends GenerativeFillProviderInput {
  prompt?: string
  negativePrompt?: string
  mode?: GenerativeFillMode
  seed?: number
  outputTarget?: "current-layer" | "new-layer"
  strength?: number
}

export interface GenerativeFillPlan {
  mode: GenerativeFillMode
  prompt: string
  promptTokens: string[]
  negativePrompt: string
  maskBounds: { x: number; y: number; w: number; h: number } | null
  maskCoverage: number
  provider: GenerativeFillProviderPlan
  outputTarget: "current-layer" | "new-layer"
  strength: number
  seed: number
}

export interface GenerativeFillResult {
  image: ImageData
  provenance: {
    provider: GenerativeFillProviderStrategy
    modelBacked: boolean
    promptHash: string
    mode: GenerativeFillMode
    generatedAt: string
  }
}

export interface ModelBackedGenerativeFillRequestInput {
  capabilityToken?: string
  sourcePng: string
  maskPng: string
  prompt: string
  negativePrompt?: string
  mode?: GenerativeFillMode
  endpoint: string
  seed?: number
  strength?: number
}

export interface ModelBackedGenerativeFillRequest {
  endpoint: string
  method: "POST"
  headers: Record<string, string>
  body: {
    sourcePng: string
    maskPng: string
    prompt: string
    negativePrompt: string
    mode: GenerativeFillMode
    seed: number
    strength: number
  }
}

const PROMPT_WORD_RE = /[a-z0-9-]+/gi

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function clamp8(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function normalizePrompt(value: string | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, 700)
}

function promptTokens(prompt: string) {
  return (prompt.match(PROMPT_WORD_RE) ?? []).map((token) => token.toLowerCase()).slice(0, 80)
}

function maskAlpha(mask: ImageData | Uint8Array | Uint8ClampedArray, width: number, p: number) {
  if (mask instanceof Uint8Array || mask instanceof Uint8ClampedArray) return mask[p] ?? 0
  const x = p % width
  const y = Math.floor(p / width)
  if (x >= mask.width || y >= mask.height) return 0
  return mask.data[(y * mask.width + x) * 4 + 3] ?? 0
}

function computeMaskBounds(mask: ImageData | Uint8Array | Uint8ClampedArray, width: number, height: number) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (maskAlpha(mask, width, p) <= 8) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      count++
    }
  }
  return {
    bounds: count ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    count,
  }
}

export function classifyGenerativeFillProvider(input: GenerativeFillProviderInput = {}): GenerativeFillProviderPlan {
  const endpoint = input.endpoint?.trim()
  const wantsModel = input.provider === "model"
  if (endpoint && input.apiKeyPresent !== false) {
    return {
      strategy: "model-endpoint",
      modelBacked: true,
      endpoint,
      reason: "A configured image-edit endpoint can provide model-backed inpainting.",
    }
  }
  if (wantsModel) {
    return {
      strategy: "model-endpoint-unconfigured",
      modelBacked: false,
      endpoint,
      reason: "Model-backed fill was requested, but no configured endpoint/API key is available.",
    }
  }
  return {
    strategy: "local-prompt-inpaint",
    modelBacked: false,
    reason: "Using deterministic local prompt-guided inpainting fallback.",
  }
}

export function buildGenerativeFillPlan(
  source: ImageData,
  mask: ImageData | Uint8Array | Uint8ClampedArray,
  options: GenerativeFillOptions = {},
): GenerativeFillPlan {
  const prompt = normalizePrompt(options.prompt)
  const negativePrompt = normalizePrompt(options.negativePrompt)
  const { bounds, count } = computeMaskBounds(mask, source.width, source.height)
  return {
    mode: options.mode ?? (prompt ? "fill" : "remove"),
    prompt,
    promptTokens: promptTokens(prompt),
    negativePrompt,
    maskBounds: bounds,
    maskCoverage: count / Math.max(1, source.width * source.height),
    provider: classifyGenerativeFillProvider(options),
    outputTarget: options.outputTarget ?? "new-layer",
    strength: clamp(options.strength ?? 0.72, 0, 1),
    seed: Math.max(0, Math.round(options.seed ?? stableHash(`${prompt}:${negativePrompt}`))),
  }
}

function stableHash(value: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function promptTargetColor(tokens: string[]) {
  const has = (...words: string[]) => words.some((word) => tokens.includes(word))
  if (has("sky", "cloud", "blue")) return { r: 88, g: 162, b: 230 }
  if (has("grass", "leaf", "green", "forest")) return { r: 68, g: 142, b: 74 }
  if (has("water", "ocean", "sea")) return { r: 45, g: 128, b: 184 }
  if (has("sand", "beach")) return { r: 210, g: 184, b: 126 }
  if (has("skin", "portrait")) return { r: 196, g: 142, b: 112 }
  if (has("white", "snow")) return { r: 230, g: 232, b: 228 }
  if (has("black", "night")) return { r: 26, g: 29, b: 36 }
  return null
}

function averageUnmaskedAround(
  data: Uint8ClampedArray,
  mask: ImageData | Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
) {
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let count = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = x + dx
      const sy = y + dy
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
      const p = sy * width + sx
      if (maskAlpha(mask, width, p) > 8) continue
      const i = p * 4
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      a += data[i + 3]
      count++
    }
  }
  if (!count) return { r: 0, g: 0, b: 0, a: 255 }
  return { r: r / count, g: g / count, b: b / count, a: a / count }
}

function deterministicNoise(seed: number, p: number) {
  let n = Math.imul(seed ^ p, 0x45d9f3b)
  n ^= n >>> 16
  n = Math.imul(n, 0x45d9f3b)
  n ^= n >>> 16
  return (n & 0xffff) / 0xffff - 0.5
}

export function applyPromptInpaintImageData(
  source: ImageData,
  mask: ImageData | Uint8Array | Uint8ClampedArray,
  plan: GenerativeFillPlan,
): GenerativeFillResult {
  const out = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
  const target = promptTargetColor(plan.promptTokens)
  const promptMix = plan.mode === "remove" || !target ? 0 : plan.strength * 0.58
  const radius = Math.max(2, Math.round(Math.min(source.width, source.height) * 0.12))

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const p = y * source.width + x
      const alpha = maskAlpha(mask, source.width, p) / 255
      if (alpha <= 0) continue
      const avg = averageUnmaskedAround(source.data, mask, source.width, source.height, x, y, radius)
      const noise = deterministicNoise(plan.seed, p) * 10
      const i = p * 4
      const tr = target ? avg.r * (1 - promptMix) + target.r * promptMix : avg.r
      const tg = target ? avg.g * (1 - promptMix) + target.g * promptMix : avg.g
      const tb = target ? avg.b * (1 - promptMix) + target.b * promptMix : avg.b
      const blend = clamp(alpha * Math.max(0.2, plan.strength), 0, 1)
      out.data[i] = clamp8(source.data[i] * (1 - blend) + (tr + noise) * blend)
      out.data[i + 1] = clamp8(source.data[i + 1] * (1 - blend) + (tg + noise * 0.6) * blend)
      out.data[i + 2] = clamp8(source.data[i + 2] * (1 - blend) + (tb + noise * 0.35) * blend)
      out.data[i + 3] = clamp8(source.data[i + 3] * (1 - blend) + avg.a * blend)
    }
  }

  return {
    image: out,
    provenance: {
      provider: plan.provider.strategy,
      modelBacked: plan.provider.modelBacked,
      promptHash: `gf_${stableHash(`${plan.mode}:${plan.prompt}:${plan.negativePrompt}`).toString(36)}`,
      mode: plan.mode,
      generatedAt: new Date(0).toISOString(),
    },
  }
}

export function createModelBackedGenerativeFillRequest(
  input: ModelBackedGenerativeFillRequestInput,
): ModelBackedGenerativeFillRequest {
  return {
    endpoint: input.endpoint,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.capabilityToken
        ? { authorization: `Bearer ${input.capabilityToken}` }
        : {}),
    },
    body: {
      sourcePng: input.sourcePng,
      maskPng: input.maskPng,
      prompt: normalizePrompt(input.prompt),
      negativePrompt: normalizePrompt(input.negativePrompt),
      mode: input.mode ?? (input.prompt.trim() ? "fill" : "remove"),
      seed: Math.max(0, Math.round(input.seed ?? stableHash(input.prompt))),
      strength: clamp(input.strength ?? 0.72, 0, 1),
    },
  }
}
