"use client"

export default function GlobalError() {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-white">
        <main role="alert" className="max-w-md rounded border border-white/15 bg-neutral-900 p-6">
          <h1 className="text-lg font-semibold">The application could not start</h1>
          <p className="mt-2 text-sm text-white/70">Reload to retry. Browser-stored recovery data is retained.</p>
          <button
            type="button"
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  )
}

