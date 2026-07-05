import { describe, expect, it } from "vitest"
import { requireCanvas2DContext } from "../../components/photoshop/checked-canvas-context"

describe("checked canvas context", () => {
  it("returns a supported 2D context", () => {
    const context = { canvas: {} } as CanvasRenderingContext2D
    const canvas = { getContext: () => context } as unknown as HTMLCanvasElement
    expect(requireCanvas2DContext(canvas, "preview")).toBe(context)
  })

  it("throws a bounded diagnostic when 2D canvas is unavailable", () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement
    expect(() => requireCanvas2DContext(canvas, "preview")).toThrow(
      "Canvas 2D context unavailable for preview.",
    )
  })
})
