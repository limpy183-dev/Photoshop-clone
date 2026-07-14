import type { HighBitImage } from "../color-pipeline-conversions"
import { clamp, clamp8 } from "../color-pipeline-conversions"

export function highBitMax(storage: HighBitImage["storage"]) {
  return storage === "uint16" ? 65535 : storage === "uint8" ? 255 : 1
}

export function readHighBitUnit(data: HighBitImage["data"], storage: HighBitImage["storage"], index: number) {
  return Number(data[index]) / highBitMax(storage)
}

export function writeHighBitUnit(data: HighBitImage["data"], storage: HighBitImage["storage"], index: number, value: number) {
  const finite = Number.isFinite(value) ? value : 0
  const v = storage === "float32"
    ? (index % 4 === 3 ? clamp(finite) : Math.max(0, finite))
    : clamp(finite)
  if (storage === "uint16") data[index] = Math.round(v * 65535)
  else if (storage === "uint8") data[index] = clamp8(v * 255)
  else data[index] = v
}

export function highBitParam(params: Record<string, number | string | boolean>, key: string, fallback: number) {
  const value = Number(params[key])
  return Number.isFinite(value) ? value : fallback
}

export function highBitBool(params: Record<string, number | string | boolean>, key: string, fallback = false) {
  const value = params[key]
  return typeof value === "boolean" ? value : fallback
}
