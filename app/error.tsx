"use client"

import * as React from "react"
import { emitRuntimeEvent } from "@/components/photoshop/runtime-telemetry"

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    emitRuntimeEvent("hydration-runtime-error", {
      component: "app-route",
      code: error.name,
      recoverable: true,
    })
  }, [error])

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-white">
      <div role="alert" className="max-w-md rounded border border-white/15 bg-neutral-900 p-6">
        <h1 className="text-lg font-semibold">This page could not continue</h1>
        <p className="mt-2 text-sm text-white/70">Retry the route. Existing editor recovery data is unaffected.</p>
        <button type="button" onClick={reset} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm">
          Try again
        </button>
      </div>
    </main>
  )
}

