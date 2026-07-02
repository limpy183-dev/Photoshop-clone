"use client"

import * as React from "react"
import { emitRuntimeEvent } from "./runtime-telemetry"

interface EditorErrorBoundaryState {
  error: Error | null
}

export class EditorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  EditorErrorBoundaryState
> {
  state: EditorErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    emitRuntimeEvent("editor-boundary-error", {
      component: "editor-shell",
      code: error.name,
      recoverable: true,
    })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#191919] p-6 text-[#f2f2f2]">
        <section
          role="alert"
          className="max-w-lg rounded-md border border-white/15 bg-[#252525] p-6 shadow-2xl"
        >
          <h1 className="text-lg font-semibold">The editor hit a runtime error</h1>
          <p className="mt-2 text-sm text-white/70">
            Recovery data remains in browser storage. Reload the editor to restore the latest autosave.
          </p>
          <button
            type="button"
            className="mt-5 rounded bg-[#1473e6] px-4 py-2 text-sm font-medium text-white"
            onClick={() => window.location.reload()}
          >
            Reload editor
          </button>
        </section>
      </main>
    )
  }
}

