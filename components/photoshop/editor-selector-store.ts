"use client"

import * as React from "react"

export interface EditorSelectorStore<T> {
  getSnapshot(): T
  setSnapshot(next: T): void
  subscribe(listener: () => void): () => void
}

export const EditorSelectorContext = React.createContext<EditorSelectorStore<unknown> | null>(null)

export function createEditorSelectorStore<T>(initial: T): EditorSelectorStore<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    setSnapshot: (next) => {
      if (Object.is(snapshot, next)) return
      snapshot = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
