/** Guides, notes, slices, counters and samplers placed on a document. */

export interface Guide {
  id: string
  orientation: "horizontal" | "vertical"
  position: number
  color?: string
  name?: string
  locked?: boolean
  visible?: boolean
}

export interface LayerNote {
  id: string
  text: string
  author?: string
  color?: string
  createdAt: number
  updatedAt?: number
}

export type ReviewStatus = "open" | "resolved"

export interface CommentReply {
  id: string
  author: string
  text: string
  createdAt: number
  updatedAt?: number
}

export type AnnotationGeometry =
  | { kind: "pin"; x: number; y: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "freehand"; points: { x: number; y: number }[]; closed?: boolean }

export interface Note {
  id: string
  x: number
  y: number
  author: string
  text: string
  color: string
  kind?: "note" | "comment" | "annotation"
  status?: ReviewStatus
  replies?: CommentReply[]
  tags?: string[]
  geometry?: AnnotationGeometry
  createdAt?: number
  updatedAt?: number
  resolvedAt?: number
  resolvedBy?: string
}

export interface Slice {
  id: string
  x: number
  y: number
  w: number
  h: number
  name: string
  url?: string
  target?: string
  altText?: string
  format?: "png" | "jpeg" | "webp" | "gif" | "avif"
  quality?: number
  compression?: number
  filename?: string
  scale?: number
  locked?: boolean
  visible?: boolean
}

export interface LayerMetadata {
  title?: string
  description?: string
  tags?: string[]
  custom?: Record<string, string | number | boolean>
  createdAt?: number
  modifiedAt?: number
}

export interface CountMarker {
  id: string
  x: number
  y: number
  group: string
  /** Index within group. */
  number: number
}

export interface ColorSampler {
  id: string
  x: number
  y: number
  label: string
  rgba: [number, number, number, number]
}
