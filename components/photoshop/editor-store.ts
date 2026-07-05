export interface EditorStore<T> {
  getSnapshot(): T
  getVersion(): number
  setSnapshot(next: T, options?: { notify?: boolean }): void
  notify(): void
  scheduleNotify(schedule?: (flush: () => void) => void): void
  subscribe(listener: () => void): () => void
  subscribeSelector<S>(
    selector: (snapshot: T) => S,
    listener: (selection: S) => void,
    equality?: (left: S, right: S) => boolean,
  ): () => void
}

export interface VersionedSelectionCache<S> {
  version: number
  hasValue: boolean
  value: S
  selector: unknown
  equality: unknown
}

export function createVersionedSelectionCache<S>(): VersionedSelectionCache<S> {
  return {
    version: -1,
    hasValue: false,
    value: undefined as S,
    selector: null,
    equality: null,
  }
}

export function selectWithVersionedCache<T, S>(
  cache: VersionedSelectionCache<S>,
  version: number,
  selector: (snapshot: T) => S,
  equality: (left: S, right: S) => boolean,
  snapshot: T,
): S {
  if (
    cache.hasValue &&
    cache.version === version &&
    cache.selector === selector &&
    cache.equality === equality
  ) {
    return cache.value
  }

  const selected = selector(snapshot)
  cache.version = version
  cache.selector = selector
  cache.equality = equality
  if (cache.hasValue && equality(cache.value, selected)) return cache.value
  cache.hasValue = true
  cache.value = selected
  return selected
}

export function createEditorStore<T>(initialSnapshot: T): EditorStore<T> {
  let snapshot = initialSnapshot
  let version = 0
  let pendingNotification = false
  let notificationScheduled = false
  const listeners = new Set<() => void>()

  const notify = () => {
    notificationScheduled = false
    if (!pendingNotification) return
    pendingNotification = false
    for (const listener of listeners) listener()
  }

  const store: EditorStore<T> = {
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
    scheduleNotify(schedule = (flush) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush)
      else queueMicrotask(flush)
    }) {
      if (!pendingNotification || notificationScheduled) return
      notificationScheduled = true
      schedule(notify)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeSelector(selector, listener, equality = Object.is) {
      let selected = selector(snapshot)
      return store.subscribe(() => {
        const next = selector(snapshot)
        if (equality(selected, next)) return
        selected = next
        listener(next)
      })
    },
  }
  return store
}
