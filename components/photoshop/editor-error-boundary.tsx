"use client"

import * as React from "react"
import { emitRuntimeEvent } from "./runtime-telemetry"

interface EditorErrorBoundaryState {
  error: Error | null
  recovery: {
    available: boolean
    lastSuccessfulAutosaveAt: number | null
  } | null
}

export class EditorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  EditorErrorBoundaryState
> {
  state: EditorErrorBoundaryState = { error: null, recovery: null }

  static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
    return { error, recovery: null }
  }

  componentDidCatch(error: Error) {
    emitRuntimeEvent("editor-boundary-error", {
      component: "editor-shell",
      code: error.name,
      recoverable: true,
    })
    void import("./recent-documents")
      .then(({ readAutosavesAsync }) => readAutosavesAsync())
      .then((autosaves) => {
        const lastSuccessfulAutosaveAt = autosaves.reduce(
          (latest, autosave) => Math.max(latest, autosave.updatedAt),
          0,
        )
        this.setState({
          recovery: {
            available: autosaves.length > 0,
            lastSuccessfulAutosaveAt: lastSuccessfulAutosaveAt || null,
          },
        })
      })
      .catch(() => {
        this.setState({
          recovery: { available: false, lastSuccessfulAutosaveAt: null },
        })
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
            {this.state.recovery === null
              ? "Checking browser storage for recovery data."
              : this.state.recovery.available
                ? `Recovery data is available${this.state.recovery.lastSuccessfulAutosaveAt ? ` from ${new Date(this.state.recovery.lastSuccessfulAutosaveAt).toLocaleString()}` : ""}. Reload the editor to restore it.`
                : "No autosave recovery was found. Reloading will restart the editor without a recovered document."}
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
