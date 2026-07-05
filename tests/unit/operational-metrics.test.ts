import { describe, expect, it, vi } from "vitest"
import { recordOperationalMetric } from "../../lib/operational-metrics"

describe("operational metrics", () => {
  it("keeps only bounded operational dimensions", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    recordOperationalMetric("generative-fill.quota", {
      adapter: "remote",
      outcome: "denied",
      prompt: "private prompt",
      pixels: "private image",
      subject: "private account",
      status: 429,
    })

    const payload = info.mock.calls[0]?.[1]
    expect(payload).toEqual({
      adapter: "remote",
      outcome: "denied",
      status: 429,
    })
    expect(JSON.stringify(payload)).not.toContain("private")
    info.mockRestore()
  })
})
