import type { AnnotationGeometry, CommentReply, Note, PsDocument, ReviewStatus } from "./types"

type DocumentBounds = {
  width: number
  height: number
  anchor?: { x: number; y: number }
}

type ReviewThreadInput = {
  id: string
  x: number
  y: number
  author: string
  text: string
  color: string
  kind?: Note["kind"]
  tags?: string[]
  geometry?: AnnotationGeometry
  now?: number
}

type ReplyInput = {
  id: string
  author: string
  text: string
  now?: number
}

type ResolveOptions = {
  by?: string
  now?: number
}

export interface ReviewReportOptions {
  generatedAt?: string
}

export interface ReviewSummary {
  total: number
  open: number
  resolved: number
  annotations: number
  replies: number
}

export interface ReviewPacketOptions extends ReviewReportOptions {
  includeDocumentSummary?: boolean
}

export interface ReviewPacketEntry {
  name: string
  data: Uint8Array
}

export interface ReviewPacketManifest {
  app: "Photoshop Web"
  format: "ps-review-packet"
  version: 1
  generatedAt: string
  document: {
    name: string
    width: number
    height: number
  }
  summary: ReviewSummary
  files: string[]
}

const GEOMETRY_KINDS = new Set(["pin", "rect", "ellipse", "arrow", "freehand"])
const textEncoder = new TextEncoder()

export function normalizeReviewTags(tags: unknown, limit = 12): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    if (typeof tag !== "string") continue
    const clean = tag.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
    if (out.length >= limit) break
  }
  return out
}

export function normalizeAnnotationGeometry(value: unknown, bounds: DocumentBounds): AnnotationGeometry {
  const anchor = {
    x: clampPoint(bounds.anchor?.x ?? bounds.width / 2, bounds.width),
    y: clampPoint(bounds.anchor?.y ?? bounds.height / 2, bounds.height),
  }
  if (!isRecord(value)) return { kind: "pin", ...anchor }
  const kind = typeof value.kind === "string" && GEOMETRY_KINDS.has(value.kind) ? value.kind : "pin"
  if (kind === "rect" || kind === "ellipse") {
    const x = clampPoint(value.x, bounds.width)
    const y = clampPoint(value.y, bounds.height)
    const w = Math.max(1, Math.min(bounds.width - x, Math.round(Math.abs(numberOr(value.w, 1)))))
    const h = Math.max(1, Math.min(bounds.height - y, Math.round(Math.abs(numberOr(value.h, 1)))))
    return { kind, x, y, w, h }
  }
  if (kind === "arrow") {
    return {
      kind,
      x1: clampPoint(value.x1, bounds.width),
      y1: clampPoint(value.y1, bounds.height),
      x2: clampPoint(value.x2, bounds.width),
      y2: clampPoint(value.y2, bounds.height),
    }
  }
  if (kind === "freehand") {
    const points = Array.isArray(value.points)
      ? value.points.slice(0, 128).filter(isRecord).map((point) => ({
          x: clampPoint(point.x, bounds.width),
          y: clampPoint(point.y, bounds.height),
        }))
      : []
    return points.length ? { kind, points, closed: value.closed === true } : { kind: "pin", ...anchor }
  }
  return {
    kind: "pin",
    x: clampPoint(value.x, bounds.width, anchor.x),
    y: clampPoint(value.y, bounds.height, anchor.y),
  }
}

export function createReviewThread(input: ReviewThreadInput): Note {
  const now = cleanTimestamp(input.now)
  return {
    id: cleanId(input.id, "comment"),
    x: Math.round(input.x),
    y: Math.round(input.y),
    author: cleanText(input.author, "Reviewer", 80),
    text: cleanText(input.text, "Review comment", 2000),
    color: cleanColor(input.color, "#38bdf8"),
    kind: input.kind ?? "comment",
    status: "open",
    tags: normalizeReviewTags(input.tags),
    geometry: input.geometry,
    replies: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function appendThreadReply(thread: Note, input: ReplyInput): Note {
  const now = cleanTimestamp(input.now)
  const reply: CommentReply = {
    id: cleanId(input.id, "reply"),
    author: cleanText(input.author, "Reviewer", 80),
    text: cleanText(input.text, "Reply", 2000),
    createdAt: now,
  }
  return {
    ...thread,
    kind: thread.kind ?? "comment",
    replies: [...(thread.replies ?? []), reply],
    updatedAt: now,
  }
}

export function setThreadResolved(thread: Note, resolved: boolean, options: ResolveOptions = {}): Note {
  const status: ReviewStatus = resolved ? "resolved" : "open"
  const now = cleanTimestamp(options.now)
  return {
    ...thread,
    status,
    resolvedAt: resolved ? now : undefined,
    resolvedBy: resolved ? cleanText(options.by, thread.author || "Reviewer", 80) : undefined,
    updatedAt: now,
  }
}

export function reviewSummaryForDocument(doc: Pick<PsDocument, "notes">): ReviewSummary {
  const notes = doc.notes ?? []
  return notes.reduce<ReviewSummary>(
    (summary, note) => ({
      total: summary.total + 1,
      open: summary.open + (note.status === "resolved" ? 0 : 1),
      resolved: summary.resolved + (note.status === "resolved" ? 1 : 0),
      annotations: summary.annotations + (note.geometry ? 1 : 0),
      replies: summary.replies + (note.replies?.length ?? 0),
    }),
    { total: 0, open: 0, resolved: 0, annotations: 0, replies: 0 },
  )
}

export function createReviewReport(doc: Pick<PsDocument, "name" | "notes" | "width" | "height">, options: ReviewReportOptions = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const summary = reviewSummaryForDocument(doc)
  const lines = [
    `# Review Report - ${doc.name}`,
    "",
    `Generated: ${generatedAt}`,
    `Canvas: ${doc.width} x ${doc.height}px`,
    `Total: ${summary.total}`,
    `Open: ${summary.open}`,
    `Resolved: ${summary.resolved}`,
    `Annotations: ${summary.annotations}`,
    `Replies: ${summary.replies}`,
    "",
  ]

  const notes = [...(doc.notes ?? [])].sort((a, b) => {
    const aStatus = a.status === "resolved" ? 1 : 0
    const bStatus = b.status === "resolved" ? 1 : 0
    if (aStatus !== bStatus) return aStatus - bStatus
    return (a.createdAt ?? 0) - (b.createdAt ?? 0)
  })

  if (!notes.length) {
    lines.push("No review comments or annotations.")
    return lines.join("\n")
  }

  for (const note of notes) {
    const status = note.status ?? "open"
    lines.push(`## ${status === "resolved" ? "Resolved" : "Open"} - ${note.author}`)
    lines.push(`- Location: ${Math.round(note.x)}, ${Math.round(note.y)}`)
    lines.push(`- Text: ${note.text}`)
    if (note.geometry) lines.push(`- Geometry: ${describeAnnotationGeometry(note.geometry)}`)
    if (note.tags?.length) lines.push(`- Tags: ${note.tags.join(", ")}`)
    if (note.replies?.length) {
      lines.push("- Replies:")
      for (const reply of note.replies) lines.push(`  - ${reply.author}: ${reply.text}`)
    }
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

function safePacketName(value: string) {
  return value.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "document"
}

export function createReviewPacketJson(doc: Pick<PsDocument, "id" | "name" | "notes" | "width" | "height" | "metadata" | "guides" | "slices">, options: ReviewPacketOptions = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  return {
    app: "Photoshop Web",
    format: "ps-review-packet",
    version: 1,
    generatedAt,
    document: {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      metadata: options.includeDocumentSummary === false ? undefined : doc.metadata,
      guides: options.includeDocumentSummary === false ? undefined : doc.guides,
      slices: options.includeDocumentSummary === false ? undefined : doc.slices,
    },
    summary: reviewSummaryForDocument(doc),
    comments: [...(doc.notes ?? [])].map((note) => ({
      id: note.id,
      kind: note.kind ?? "comment",
      status: note.status ?? "open",
      author: note.author,
      text: note.text,
      color: note.color,
      x: note.x,
      y: note.y,
      tags: note.tags ?? [],
      geometry: note.geometry,
      replies: note.replies ?? [],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      resolvedAt: note.resolvedAt,
      resolvedBy: note.resolvedBy,
    })),
  }
}

export function createReviewPacketManifest(doc: Pick<PsDocument, "name" | "notes" | "width" | "height">, files: string[], options: ReviewPacketOptions = {}): ReviewPacketManifest {
  return {
    app: "Photoshop Web",
    format: "ps-review-packet",
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    document: {
      name: doc.name,
      width: doc.width,
      height: doc.height,
    },
    summary: reviewSummaryForDocument(doc),
    files,
  }
}

export function createReviewPacketEntries(doc: Pick<PsDocument, "id" | "name" | "notes" | "width" | "height" | "metadata" | "guides" | "slices">, options: ReviewPacketOptions = {}): ReviewPacketEntry[] {
  const base = safePacketName(doc.name)
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const reportName = "review-report.md"
  const jsonName = "review-packet.json"
  const manifestName = "manifest.json"
  const packet = createReviewPacketJson(doc, { ...options, generatedAt })
  const manifest = createReviewPacketManifest(doc, [manifestName, jsonName, reportName], { ...options, generatedAt })
  return [
    { name: `${base}/${manifestName}`, data: textEncoder.encode(JSON.stringify(manifest, null, 2)) },
    { name: `${base}/${jsonName}`, data: textEncoder.encode(JSON.stringify(packet, null, 2)) },
    { name: `${base}/${reportName}`, data: textEncoder.encode(createReviewReport(doc, { generatedAt })) },
  ]
}

export function describeAnnotationGeometry(geometry: AnnotationGeometry): string {
  switch (geometry.kind) {
    case "rect":
      return `Rectangle ${geometry.x}, ${geometry.y}, ${geometry.w} x ${geometry.h}`
    case "ellipse":
      return `Ellipse ${geometry.x}, ${geometry.y}, ${geometry.w} x ${geometry.h}`
    case "arrow":
      return `Arrow ${geometry.x1}, ${geometry.y1} -> ${geometry.x2}, ${geometry.y2}`
    case "freehand":
      return `Freehand ${geometry.points.length} point${geometry.points.length === 1 ? "" : "s"}${geometry.closed ? ", closed" : ""}`
    case "pin":
    default:
      return `Pin ${geometry.x}, ${geometry.y}`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function numberOr(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clampPoint(value: unknown, max: number, fallback = 0) {
  return Math.max(0, Math.min(Math.round(max), Math.round(numberOr(value, fallback))))
}

function cleanTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : Date.now()
}

function cleanId(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : ""
  return /^[A-Za-z0-9_-]{1,80}$/.test(text) ? text : `${fallback}_${Math.random().toString(36).slice(2, 9)}`
}

function cleanText(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return (text || fallback).slice(0, maxLength)
}

function cleanColor(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback
}
