import type { Layer } from "../types"
import {
  escapeRegExp,
  type FindReplaceHighlightGroup,
  type FindReplaceHighlightSegment,
  type FindReplaceOptions,
  type FindReplaceResult,
} from "../typography-engine-types"

export function buildFindReplaceHighlights(
  layers: readonly Layer[],
  matches: FindReplaceResult["matches"],
): FindReplaceHighlightGroup[] {
  const byLayer = new Map<string, FindReplaceResult["matches"]>()
  for (const match of matches) {
    const current = byLayer.get(match.layerId) ?? []
    current.push(match)
    byLayer.set(match.layerId, current)
  }

  const groups: FindReplaceHighlightGroup[] = []
  for (const layer of layers) {
    if (!layer.text) continue
    const layerMatches = (byLayer.get(layer.id) ?? []).slice().sort((a, b) => a.index - b.index || b.length - a.length)
    if (!layerMatches.length) continue
    const segments: FindReplaceHighlightSegment[] = []
    let cursor = 0
    layerMatches.forEach((match, matchIndex) => {
      const start = Math.max(cursor, Math.min(layer.text!.content.length, match.index))
      const end = Math.max(start, Math.min(layer.text!.content.length, match.index + match.length))
      if (start > cursor) {
        segments.push({ text: layer.text!.content.slice(cursor, start), highlight: false })
      }
      if (end > start) {
        segments.push({ text: layer.text!.content.slice(start, end), highlight: true, matchIndex })
      }
      cursor = end
    })
    if (cursor < layer.text.content.length) {
      segments.push({ text: layer.text.content.slice(cursor), highlight: false })
    }
    const matchWord = layerMatches.length === 1 ? "match" : "matches"
    groups.push({
      layerId: layer.id,
      layerName: layer.name,
      content: layer.text.content,
      matches: layerMatches,
      segments,
      matchCountLabel: `${layerMatches.length} ${matchWord}`,
    })
  }
  return groups
}

export function findReplaceTextLayers(layers: readonly Layer[], options: FindReplaceOptions): FindReplaceResult {
  const empty = (error?: string): FindReplaceResult => ({
    layers: [...layers],
    matches: [],
    changedLayerIds: [],
    replacements: 0,
    matchCountLabel: "0 matches",
    highlights: [],
    error,
  })
  if (!options.find) {
    return empty()
  }

  let flags = options.caseSensitive ? "g" : "gi"
  if (options.useRegex && options.regexFlags) {
    if (options.regexFlags.multiline && !flags.includes("m")) flags += "m"
    if (options.regexFlags.dotAll && !flags.includes("s")) flags += "s"
  }
  const source = options.useRegex ? options.find : escapeRegExp(options.find)
  const pattern = options.wholeWord ? `\\b(?:${source})\\b` : source
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid regular expression"
    return empty(message.startsWith("Invalid regular expression") ? message : `Invalid regular expression: ${message}`)
  }
  const matches: FindReplaceResult["matches"] = []
  const changedLayerIds: string[] = []
  let replacements = 0

  // For Replace Next, track whether we've consumed our one allowed replacement.
  let nextReplacementConsumed = false

  const cursor = options.startCursor
  const passesCursor = (layerId: string, index: number) => {
    if (!cursor) return true
    if (layerId !== cursor.layerId) {
      // Cursor lives in a different layer — accept any match in this layer.
      return true
    }
    return index >= cursor.index
  }

  const nextLayers = layers.map((layer) => {
    if (!layer.text) return layer
    const original = layer.text.content
    const layerMatches = [...original.matchAll(regex)]
    if (!layerMatches.length) return layer
    for (const match of layerMatches) {
      matches.push({
        layerId: layer.id,
        layerName: layer.name,
        index: match.index ?? 0,
        length: match[0].length,
        text: match[0],
      })
    }
    if (options.previewOnly) return layer
    if (options.replaceNext) {
      // Replace only the first eligible match (respecting cursor).
      if (nextReplacementConsumed) return layer
      const target = layerMatches.find((match) => passesCursor(layer.id, match.index ?? 0))
      if (!target) return layer
      const start = target.index ?? 0
      const end = start + target[0].length
      const replaced = options.useRegex
        ? target[0].replace(regex, options.replace)
        : options.replace
      const content = `${original.slice(0, start)}${replaced}${original.slice(end)}`
      if (content === original) return layer
      replacements += 1
      nextReplacementConsumed = true
      changedLayerIds.push(layer.id)
      return { ...layer, text: { ...layer.text, content } }
    }
    replacements += layerMatches.length
    const content = options.useRegex
      ? original.replace(regex, options.replace)
      : original.replace(regex, () => options.replace)
    if (content === original) return layer
    changedLayerIds.push(layer.id)
    return { ...layer, text: { ...layer.text, content } }
  })

  const layerCount = new Set(matches.map((match) => match.layerId)).size
  const matchWord = matches.length === 1 ? "match" : "matches"
  const layerWord = layerCount === 1 ? "layer" : "layers"
  const matchCountLabel = matches.length ? `${matches.length} ${matchWord} in ${layerCount} ${layerWord}` : "0 matches"
  return { layers: nextLayers, matches, changedLayerIds, replacements, matchCountLabel, highlights: buildFindReplaceHighlights(layers, matches) }
}
