"use client"

import * as React from "react"
import { emitRuntimeEvent } from "./runtime-telemetry"

interface FeatureErrorBoundaryProps {
  children: React.ReactNode
  feature: string
  resetKey?: React.Key
}

interface FeatureErrorBoundaryState {
  error: Error | null
}

export class FeatureErrorBoundary extends React.Component<
  FeatureErrorBoundaryProps,
  FeatureErrorBoundaryState
> {
  state: FeatureErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): FeatureErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    emitRuntimeEvent("editor-boundary-error", {
      component: this.props.feature,
      code: error.name,
      recoverable: true,
    })
  }

  componentDidUpdate(previous: FeatureErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section
        role="alert"
        className="m-2 rounded-sm border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] text-amber-100"
      >
        <div>This {this.props.feature} could not be displayed. The editor and canvas remain available.</div>
        <button
          type="button"
          className="mt-2 rounded-sm border border-amber-300/40 px-2 py-1 hover:bg-amber-300/10"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </section>
    )
  }
}
