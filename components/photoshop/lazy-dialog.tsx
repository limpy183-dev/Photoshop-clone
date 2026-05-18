import * as React from "react"

/**
 * Wraps a dynamic import as a lazy-loaded, lazy-MOUNTED component.
 *
 * Two behaviours combined:
 *
 *  1. The chunk is fetched only when the component first renders something
 *     (React.lazy semantics).
 *  2. The component renders nothing until `isOpen(props)` returns true. This
 *     means the chunk is NOT fetched at parent mount time — only the first
 *     time the user opens the dialog. Subsequent toggles reuse the cached
 *     chunk so reopening is instant.
 *
 * For ~30 dialogs and ~30 panels in this app, this turns hundreds of KB of
 * dialog/panel JS that was eagerly bundled with the workspace shell into
 * code-split chunks that load on demand. Initial load and idle re-renders
 * become much cheaper.
 *
 * The default `isOpen` checks `props.open` (the standard pattern). Provide
 * a custom predicate for dialogs that gate visibility on a different prop
 * (e.g. `filterId !== null`, `workflow !== null`).
 */
export function lazyDialog<P extends Record<string, unknown>>(
  loader: () => Promise<{ default: React.ComponentType<P> }>,
  isOpen: (props: P) => boolean = (p) => Boolean((p as { open?: unknown }).open),
): React.ComponentType<P> {
  const Lazy = React.lazy(loader)
  function LazyMounted(props: P) {
    if (!isOpen(props)) return null
    return (
      <React.Suspense fallback={null}>
        <Lazy {...props} />
      </React.Suspense>
    )
  }
  LazyMounted.displayName = "LazyDialog"
  return LazyMounted
}

/**
 * Same as lazyDialog but for panel components in the right dock. Panels
 * receive no props (they pull state from the editor context), so the wrapper
 * always mounts when called and we just defer the chunk until the panel is
 * actually rendered (which happens only when the panel is visible in the
 * dock).
 */
export function lazyPanel(
  loader: () => Promise<{ default: React.ComponentType<Record<string, never>> }>,
): React.ComponentType<Record<string, never>> {
  const Lazy = React.lazy(loader)
  function LazyPanel() {
    return (
      <React.Suspense fallback={null}>
        <Lazy />
      </React.Suspense>
    )
  }
  LazyPanel.displayName = "LazyPanel"
  return LazyPanel
}
