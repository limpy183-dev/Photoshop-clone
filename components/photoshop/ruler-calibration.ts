import type { RulerUnitPreference } from "./preferences-engine"

const NICE_STEPS = [1, 2, 5]

export interface RulerTickMark {
  value: number
  positionPx: number
  major: boolean
  label?: string
}

export function pixelsPerRulerUnit(unit: RulerUnitPreference, documentDpi: number): number {
  const dpi = assertPositiveFinite(documentDpi, "document dpi")
  if (unit === "px") return 1
  if (unit === "in") return dpi
  if (unit === "cm") return dpi / 2.54
  if (unit === "mm") return dpi / 25.4
  if (unit === "pt") return dpi / 72
  return dpi / 6
}

export function formatRulerTickLabel(value: number, unit: RulerUnitPreference): string {
  if (unit === "px" || unit === "pt" || unit === "pc") return String(Math.round(value))
  if (Math.abs(value) >= 10 || Math.abs(value - Math.round(value)) < 0.0001) return String(Math.round(value))
  return value.toFixed(1).replace(/\.0$/, "")
}

export function buildRulerTickMarks({
  lengthPx,
  zoom,
  unit,
  documentDpi,
}: {
  lengthPx: number
  zoom: number
  unit: RulerUnitPreference
  documentDpi: number
}): RulerTickMark[] {
  const safeLength = Math.max(0, lengthPx)
  const safeZoom = Math.max(0.01, zoom)
  const pxPerUnit = pixelsPerRulerUnit(unit, documentDpi)
  const targetMajorScreenPx = unit === "px" ? 90 : 80
  const rawMajorUnits = Math.max(0.0001, targetMajorScreenPx / (pxPerUnit * safeZoom))
  const majorStep = chooseNiceStep(rawMajorUnits)
  const minorStep = majorStep / 5
  const maxUnits = safeLength / pxPerUnit
  const ticks: RulerTickMark[] = []
  const count = Math.ceil(maxUnits / minorStep)

  for (let i = 0; i <= count; i++) {
    const value = roundForTick(i * minorStep)
    const positionPx = value * pxPerUnit * safeZoom
    if (positionPx > safeLength * safeZoom + 0.5) break
    const major = i % 5 === 0
    ticks.push({
      value,
      positionPx,
      major,
      ...(major ? { label: formatRulerTickLabel(value, unit) } : {}),
    })
  }

  if (!ticks.length || ticks[0].value !== 0) {
    ticks.unshift({ value: 0, positionPx: 0, major: true, label: "0" })
  }

  return ticks
}

function chooseNiceStep(raw: number) {
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  for (const step of NICE_STEPS) {
    const candidate = step * magnitude
    if (candidate >= raw) return candidate
  }
  return 10 * magnitude
}

function roundForTick(value: number) {
  return Math.abs(value) < 0.0000001 ? 0 : Number(value.toFixed(6))
}

function assertPositiveFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than 0.`)
  }
  return value
}
