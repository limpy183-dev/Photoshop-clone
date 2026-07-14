import type { TextProps } from "../types"

export function glyphAdvance(text: TextProps, char: string) {
  if (char === " ") return text.size * 0.35
  const wide = /[MW@#%]/.test(char)
  const narrow = /[ilI1.,:;'!|]/.test(char)
  const base = wide ? 0.78 : narrow ? 0.32 : 0.58
  return text.size * base + ((text.tracking ?? 0) / 1000) * text.size
}
