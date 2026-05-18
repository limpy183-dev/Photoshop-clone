"use client"

import * as React from "react"

/**
 * Returns `false` during the first server render AND the first client render,
 * then flips to `true` after the first effect commit on the client.
 *
 * Use this to gate UI that depends on values which only exist on the client
 * (e.g. localStorage-derived state, `window.matchMedia`, viewport size).
 * Render server-safe defaults while `mounted` is false; switch to the
 * real value once it flips. This keeps SSR and the first client render
 * deterministic and matching, then asynchronously updates without
 * triggering a hydration mismatch.
 *
 * If you only need to suppress a small leaf-level mismatch on a `<span>`
 * or styled `<div>` (e.g. a number that displays differently after
 * persisted state loads), prefer `suppressHydrationWarning` directly on
 * that element — it costs nothing and is the React-recommended escape
 * hatch for known content/attribute differences. Reach for `useMounted`
 * when the mismatch crosses multiple nodes (e.g. a Radix Slider whose
 * internal SliderRange position depends on the value), where
 * `suppressHydrationWarning` won't propagate.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    setMounted(true)
  }, [])
  return mounted
}
