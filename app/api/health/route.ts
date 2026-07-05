import { NextResponse } from "next/server"
import { getAdapterHealth } from "@/lib/adapter-health"

export const runtime = "nodejs"

export function GET() {
  const adapters = getAdapterHealth()
  const healthy = adapters.every((adapter) => adapter.configured)
  return NextResponse.json(
    {
      ok: healthy,
      readiness: healthy,
      adapters,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  )
}
