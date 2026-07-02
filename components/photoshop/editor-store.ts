export interface EditorStore<T> {
  getSnapshot(): T
  getVersion(): number
  setSnapshot(next: T, options?: { notify?: boolean }): void
  notify(): void
  subscribe(listener: () => void): () => void
}

export function createEditorStore<T>(initialSnapshot: T): EditorStore<T> {
  let snapshot = initialSnapshot
  let version = 0
  let pendingNotification = false
  const listeners = new Set<() => void>()

  const notify = () => {
    if (!pendingNotification) return
    pendingNotification = false
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    getVersion: () => version,
    setSnapshot(next, options = {}) {
      if (Object.is(snapshot, next)) return
      snapshot = next
      version += 1
      pendingNotification = true
      if (options.notify !== false) notify()
    },
    notify,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

