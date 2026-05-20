"use client"

import * as React from "react"

/**
 * Locks document scroll while the editor is mounted so the fixed-viewport
 * editor experience is preserved. Restores previous overflow on unmount.
 */
export function EditorBodyLock() {
  React.useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const previousHtml = html.style.overflow
    const previousBody = body.style.overflow
    html.style.overflow = "hidden"
    body.style.overflow = "hidden"
    body.dataset.editor = "true"
    return () => {
      html.style.overflow = previousHtml
      body.style.overflow = previousBody
      delete body.dataset.editor
    }
  }, [])
  return null
}
