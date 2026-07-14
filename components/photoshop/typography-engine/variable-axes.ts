import type { TextProps, TypographyAxisDefinition, TypographyNamedInstance } from "../types"
import {
  clamp,
  compareAxisOrder,
  DEFAULT_VARIABLE_AXIS_DEFINITIONS,
  formatAxisValue,
} from "../typography-engine-types"

export function axisDefinitionsFor(values: Record<string, number> | undefined, definitions?: TypographyAxisDefinition[]) {
  if (definitions?.length) return definitions
  const tags = Object.keys(values ?? {})
  if (!tags.length) return []
  const known = DEFAULT_VARIABLE_AXIS_DEFINITIONS.filter((axis) => tags.includes(axis.tag))
  const custom = tags
    .filter((tag) => !known.some((axis) => axis.tag === tag))
    .map((tag) => ({ tag, name: tag.toUpperCase(), min: -1000, max: 1000, defaultValue: values?.[tag] ?? 0 }))
  return [...known, ...custom]
}

export function normalizeVariableAxes(
  values: Record<string, number> | undefined,
  definitions: TypographyAxisDefinition[] = DEFAULT_VARIABLE_AXIS_DEFINITIONS,
) {
  const normalized: Record<string, number> = {}
  const seen = new Set<string>()
  const includeUnknownAxes = arguments.length < 2
  for (const axis of definitions) {
    if (!axis.tag.trim()) continue
    const requested = Number(values?.[axis.tag])
    normalized[axis.tag] = clamp(Number.isFinite(requested) ? requested : axis.defaultValue, axis.min, axis.max)
    seen.add(axis.tag)
  }
  if (includeUnknownAxes) {
    for (const [tag, value] of Object.entries(values ?? {})) {
      if (seen.has(tag) || !Number.isFinite(value)) continue
      normalized[tag] = value
    }
  }
  return normalized
}

export function serializeVariableAxes(values: Record<string, number> | undefined, definitions?: TypographyAxisDefinition[]) {
  const normalized = normalizeVariableAxes(values, axisDefinitionsFor(values, definitions))
  return Object.keys(normalized)
    .sort(compareAxisOrder)
    .map((tag) => `"${tag}" ${formatAxisValue(normalized[tag])}`)
    .join(", ")
}

export function applyVariableFontNamedInstance(
  text: TextProps,
  instance: TypographyNamedInstance,
  axisDefinitions = text.variableAxisDefinitions,
): TextProps {
  return {
    ...text,
    variableAxes: normalizeVariableAxes(instance.coordinates, axisDefinitionsFor(instance.coordinates, axisDefinitions)),
    variableAxisDefinitions: axisDefinitions,
    variableNamedInstance: instance.name,
  }
}
