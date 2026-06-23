"use client"

// Session-persistent store for command macros + droplets. Each macro
// is a saved DSL script; each droplet is a saved chain that can run an
// existing recorded Action plus an optional pre/post DSL script.
//
// We use localStorage rather than the document's history because these
// records belong to the user, not any one document, and should outlive
// document close/reopen. Storage is bounded and we sanitise on read so a
// tampered string can't expand into arbitrary editor state.

import * as React from "react"
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson, type ClientStorageKey } from "./client-storage"
import { validateDsl } from "./command-dsl"
import { dispatchPhotoshopEvent } from "./events"
import type { AutomationWorkflow } from "./automation-engine"

const MAX_MACROS = 64
const MAX_DROPLETS = 64
const MAX_NAME_LENGTH = 80
const MAX_SCRIPT_LENGTH = 8_000

export interface CommandMacro {
  id: string
  name: string
  source: string
  createdAt: number
  updatedAt: number
}

export interface Droplet {
  id: string
  name: string
  actionId?: string
  preScript?: string
  postScript?: string
  condition?: "always" | "has-selection" | "has-active-layer" | "multi-layer" | "rgb" | "print-ready" | "document-open"
  event?: string
  manualOnly?: boolean
  workflow?: AutomationWorkflow
  exportFormat?: "none" | "png" | "jpeg" | "webp" | "gif" | "avif"
  exportName?: string
  createdAt: number
  updatedAt: number
}

function safeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

function cleanName(value: unknown, fallback: string, max = MAX_NAME_LENGTH) {
  if (typeof value !== "string") return fallback
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
  return cleaned || fallback
}

function cleanScript(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.length > MAX_SCRIPT_LENGTH ? value.slice(0, MAX_SCRIPT_LENGTH) : value
}

function cleanCondition(value: unknown): Droplet["condition"] {
  if (typeof value !== "string") return "always"
  return (["always", "has-selection", "has-active-layer", "multi-layer", "rgb", "print-ready", "document-open"] as const).includes(
    value as Droplet["condition"] & string,
  )
    ? (value as Droplet["condition"])
    : "always"
}

function cleanEvent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return cleanName(value, "", 80) || undefined
}

function cleanExportFormat(value: unknown): Droplet["exportFormat"] {
  if (typeof value !== "string") return "png"
  return (["none", "png", "jpeg", "webp", "gif", "avif"] as const).includes(value as Droplet["exportFormat"] & string)
    ? (value as Droplet["exportFormat"])
    : "png"
}

function cleanFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function sanitizeMacro(value: unknown): CommandMacro | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const source = cleanScript(record.source)
  if (!source) return null
  const id = typeof record.id === "string" && record.id ? record.id.slice(0, 64) : safeId("macro")
  const createdAt = cleanFiniteNumber(record.createdAt, Date.now())
  const updatedAt = cleanFiniteNumber(record.updatedAt, createdAt)
  return {
    id,
    name: cleanName(record.name, "Macro"),
    source,
    createdAt,
    updatedAt,
  }
}

function sanitizeDroplet(value: unknown): Droplet | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === "string" && record.id ? record.id.slice(0, 64) : safeId("droplet")
  const createdAt = cleanFiniteNumber(record.createdAt, Date.now())
  const updatedAt = cleanFiniteNumber(record.updatedAt, createdAt)
  return {
    id,
    name: cleanName(record.name, "Droplet"),
    actionId: typeof record.actionId === "string" && record.actionId ? record.actionId.slice(0, 64) : undefined,
    preScript: cleanScript(record.preScript) || undefined,
    postScript: cleanScript(record.postScript) || undefined,
    condition: cleanCondition(record.condition),
    event: cleanEvent(record.event),
    manualOnly: typeof record.manualOnly === "boolean" ? record.manualOnly : true,
    workflow: record.workflow && typeof record.workflow === "object" ? record.workflow as AutomationWorkflow : undefined,
    exportFormat: cleanExportFormat(record.exportFormat),
    exportName: typeof record.exportName === "string" ? cleanName(record.exportName, "", 120) || undefined : undefined,
    createdAt,
    updatedAt,
  }
}

function readStore<T>(descriptor: ClientStorageKey<unknown[]>, sanitize: (value: unknown) => T | null, max: number): T[] {
  const parsed = readClientStorageJson(descriptor)
  const out: T[] = []
  for (const entry of parsed.slice(0, max)) {
    const cleaned = sanitize(entry)
    if (cleaned) out.push(cleaned)
  }
  return out
}

function writeStore<T>(descriptor: ClientStorageKey<unknown[]>, values: T[]) {
  writeClientStorageJson(descriptor, values)
}

export function loadMacros(): CommandMacro[] {
  return readStore(CLIENT_STORAGE_KEYS.legacyCommandMacros, sanitizeMacro, MAX_MACROS)
}

export function loadDroplets(): Droplet[] {
  return readStore(CLIENT_STORAGE_KEYS.droplets, sanitizeDroplet, MAX_DROPLETS)
}

export function saveMacros(macros: CommandMacro[]) {
  writeStore(CLIENT_STORAGE_KEYS.legacyCommandMacros, macros.slice(0, MAX_MACROS))
}

export function saveDroplets(droplets: Droplet[]) {
  writeStore(CLIENT_STORAGE_KEYS.droplets, droplets.slice(0, MAX_DROPLETS))
}

const MACRO_EVENT = "ps-command-macros-changed"
const DROPLET_EVENT = "ps-droplets-changed"
type AutomationStoreEvent = typeof MACRO_EVENT | typeof DROPLET_EVENT

function notify(event: AutomationStoreEvent) {
  if (typeof window === "undefined") return
  dispatchPhotoshopEvent(event)
}

export interface CommandMacrosApi {
  macros: CommandMacro[]
  createMacro: (name: string, source: string) => CommandMacro | null
  updateMacro: (id: string, patch: Partial<Pick<CommandMacro, "name" | "source">>) => void
  deleteMacro: (id: string) => void
  importMacros: (entries: unknown[]) => number
}

export function useCommandMacros(): CommandMacrosApi {
  const [macros, setMacros] = React.useState<CommandMacro[]>(() => loadMacros())

  React.useEffect(() => {
    const handler = () => setMacros(loadMacros())
    const storageHandler = (event: StorageEvent) => {
      if (event.key === CLIENT_STORAGE_KEYS.legacyCommandMacros.key) handler()
    }
    window.addEventListener(MACRO_EVENT, handler)
    window.addEventListener("storage", storageHandler)
    return () => {
      window.removeEventListener(MACRO_EVENT, handler)
      window.removeEventListener("storage", storageHandler)
    }
  }, [])

  const persist = React.useCallback((next: CommandMacro[]) => {
    setMacros(next)
    saveMacros(next)
    notify(MACRO_EVENT)
  }, [])

  const createMacro = React.useCallback(
    (name: string, source: string): CommandMacro | null => {
      const cleanedSource = cleanScript(source)
      const validation = validateDsl(cleanedSource)
      if (!validation.ok) return null
      const now = Date.now()
      const macro: CommandMacro = {
        id: safeId("macro"),
        name: cleanName(name, `Macro ${now}`),
        source: cleanedSource,
        createdAt: now,
        updatedAt: now,
      }
      persist([macro, ...macros].slice(0, MAX_MACROS))
      return macro
    },
    [macros, persist],
  )

  const updateMacro = React.useCallback(
    (id: string, patch: Partial<Pick<CommandMacro, "name" | "source">>) => {
      const now = Date.now()
      const next = macros.map((macro) =>
        macro.id === id
          ? {
              ...macro,
              ...(patch.name !== undefined ? { name: cleanName(patch.name, macro.name) } : {}),
              ...(patch.source !== undefined ? { source: cleanScript(patch.source) } : {}),
              updatedAt: now,
            }
          : macro,
      )
      persist(next)
    },
    [macros, persist],
  )

  const deleteMacro = React.useCallback(
    (id: string) => persist(macros.filter((macro) => macro.id !== id)),
    [macros, persist],
  )

  const importMacros = React.useCallback(
    (entries: unknown[]): number => {
      const cleaned = entries
        .map(sanitizeMacro)
        .filter((macro): macro is CommandMacro => Boolean(macro))
        .map((macro) => ({ ...macro, id: safeId("macro"), name: `${macro.name} (imported)` }))
      if (!cleaned.length) return 0
      persist([...cleaned, ...macros].slice(0, MAX_MACROS))
      return cleaned.length
    },
    [macros, persist],
  )

  return { macros, createMacro, updateMacro, deleteMacro, importMacros }
}

export interface DropletsApi {
  droplets: Droplet[]
  createDroplet: (input: Omit<Droplet, "id" | "createdAt" | "updatedAt">) => Droplet
  updateDroplet: (id: string, patch: Partial<Omit<Droplet, "id" | "createdAt">>) => void
  deleteDroplet: (id: string) => void
  importDroplets: (entries: unknown[]) => number
}

export function useDroplets(): DropletsApi {
  const [droplets, setDroplets] = React.useState<Droplet[]>(() => loadDroplets())

  React.useEffect(() => {
    const handler = () => setDroplets(loadDroplets())
    const storageHandler = (event: StorageEvent) => {
      if (event.key === CLIENT_STORAGE_KEYS.droplets.key) handler()
    }
    window.addEventListener(DROPLET_EVENT, handler)
    window.addEventListener("storage", storageHandler)
    return () => {
      window.removeEventListener(DROPLET_EVENT, handler)
      window.removeEventListener("storage", storageHandler)
    }
  }, [])

  const persist = React.useCallback((next: Droplet[]) => {
    setDroplets(next)
    saveDroplets(next)
    notify(DROPLET_EVENT)
  }, [])

  const createDroplet = React.useCallback(
    (input: Omit<Droplet, "id" | "createdAt" | "updatedAt">) => {
      const now = Date.now()
      const droplet: Droplet = {
        id: safeId("droplet"),
        createdAt: now,
        updatedAt: now,
        name: cleanName(input.name, "Droplet"),
        actionId: input.actionId,
        preScript: input.preScript ? cleanScript(input.preScript) : undefined,
        postScript: input.postScript ? cleanScript(input.postScript) : undefined,
        condition: cleanCondition(input.condition),
        event: cleanEvent(input.event),
        manualOnly: input.manualOnly ?? true,
        workflow: input.workflow,
        exportFormat: cleanExportFormat(input.exportFormat),
        exportName: input.exportName ? cleanName(input.exportName, "", 120) : undefined,
      }
      persist([droplet, ...droplets].slice(0, MAX_DROPLETS))
      return droplet
    },
    [droplets, persist],
  )

  const updateDroplet = React.useCallback(
    (id: string, patch: Partial<Omit<Droplet, "id" | "createdAt">>) => {
      const now = Date.now()
      const next = droplets.map((droplet) =>
        droplet.id === id
          ? {
              ...droplet,
              ...(patch.name !== undefined ? { name: cleanName(patch.name, droplet.name) } : {}),
              ...(patch.actionId !== undefined ? { actionId: patch.actionId || undefined } : {}),
              ...(patch.preScript !== undefined ? { preScript: patch.preScript ? cleanScript(patch.preScript) : undefined } : {}),
              ...(patch.postScript !== undefined ? { postScript: patch.postScript ? cleanScript(patch.postScript) : undefined } : {}),
              ...(patch.condition !== undefined ? { condition: cleanCondition(patch.condition) } : {}),
              ...(patch.event !== undefined ? { event: cleanEvent(patch.event) } : {}),
              ...(patch.manualOnly !== undefined ? { manualOnly: patch.manualOnly } : {}),
              ...(patch.workflow !== undefined ? { workflow: patch.workflow } : {}),
              ...(patch.exportFormat !== undefined ? { exportFormat: cleanExportFormat(patch.exportFormat) } : {}),
              ...(patch.exportName !== undefined ? { exportName: patch.exportName ? cleanName(patch.exportName, "", 120) : undefined } : {}),
              updatedAt: now,
            }
          : droplet,
      )
      persist(next)
    },
    [droplets, persist],
  )

  const deleteDroplet = React.useCallback(
    (id: string) => persist(droplets.filter((droplet) => droplet.id !== id)),
    [droplets, persist],
  )

  const importDroplets = React.useCallback(
    (entries: unknown[]): number => {
      const cleaned = entries
        .map(sanitizeDroplet)
        .filter((droplet): droplet is Droplet => Boolean(droplet))
        .map((droplet) => ({ ...droplet, id: safeId("droplet"), name: `${droplet.name} (imported)` }))
      if (!cleaned.length) return 0
      persist([...cleaned, ...droplets].slice(0, MAX_DROPLETS))
      return cleaned.length
    },
    [droplets, persist],
  )

  return { droplets, createDroplet, updateDroplet, deleteDroplet, importDroplets }
}
