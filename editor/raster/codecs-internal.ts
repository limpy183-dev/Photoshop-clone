export const clamp8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

export function scaleSample(value: number, maxValue: number) {
  if (maxValue <= 0) return 0
  return clamp8((value / maxValue) * 255)
}

export const TGA_DEVELOPER_TAG_METADATA = 65000
export const TGA_DEVELOPER_PREFIX = "PSWEBMETA\0"
export const TGA_SIGNATURE = "TRUEVISION-XFILE.\0"
