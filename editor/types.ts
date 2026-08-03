/**
 * Shared editor types. This file is a barrel on purpose: it is the single
 * import site the rest of the codebase uses ("@/editor/types"), while the
 * definitions live in editor/types/* by domain. Add new types to a domain
 * file, not here.
 */
export * from "@/editor/types/core"
export * from "@/editor/types/typography"
export * from "@/editor/types/rendering"
export * from "@/editor/types/tools"
export * from "@/editor/types/layers"
export * from "@/editor/types/selection"
export * from "@/editor/types/annotations"
export * from "@/editor/types/timeline"
export * from "@/editor/types/document"
export * from "@/editor/types/history"
export * from "@/editor/types/globals"
