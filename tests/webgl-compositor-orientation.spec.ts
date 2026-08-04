import { expect, test } from "@playwright/test"

import { WebGL2DCompositor } from "@/editor/webgl-compositor/webgl-runtime"

/**
 * The composite is built by rendering each layer into a framebuffer texture and
 * ping-ponging, then blitting the last texture to the canvas.
 *
 * A framebuffer attachment stores its first row at the *bottom* of the viewport,
 * while a texture uploaded from a canvas has the image's first row at v=0 — the
 * orientation the final blit assumes. So each framebuffer pass inverts the image
 * unless the geometry is flipped for it, which left the whole composite mirrored
 * on an odd layer count and blended every layer against a mirrored backdrop on
 * an even one. Adding a shape layer visibly turned the canvas over.
 *
 * Verified against a real GPU during the fix; this guards the contract without
 * needing one, since a headless run may never take the WebGL path at all.
 */

type DrawRecord = { boundFramebuffer: unknown; flipY: number | null }

/** Minimal recording WebGL stub: enough for the compositor to run to the end. */
function fakeGl() {
  const draws: DrawRecord[] = []
  let boundFramebuffer: unknown = null
  let flipY: number | null = null
  const flipYLocation = { name: "u_flipY" }

  const gl = {
    TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, FRAMEBUFFER: 4, COLOR_ATTACHMENT0: 5,
    COLOR_BUFFER_BIT: 6, TRIANGLES: 7, ARRAY_BUFFER: 8, STATIC_DRAW: 9, FLOAT: 10,
    TEXTURE0: 100, VERTEX_SHADER: 11, FRAGMENT_SHADER: 12,
    COMPILE_STATUS: 13, LINK_STATUS: 14,
    TEXTURE_WRAP_S: 15, TEXTURE_WRAP_T: 16, TEXTURE_MIN_FILTER: 17, TEXTURE_MAG_FILTER: 18,
    CLAMP_TO_EDGE: 19, LINEAR: 20, BLEND: 21,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 22,

    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    useProgram: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    getUniformLocation: (_program: unknown, name: string) => (name === "u_flipY" ? flipYLocation : { name }),
    uniform1i: () => {},
    uniform2f: () => {},
    uniform3f: () => {},
    uniform4f: () => {},
    uniform1f: (location: unknown, value: number) => {
      if (location === flipYLocation) flipY = value
    },
    createTexture: () => ({}),
    bindTexture: () => {},
    activeTexture: () => {},
    texParameteri: () => {},
    texImage2D: () => {},
    pixelStorei: () => {},
    createFramebuffer: () => ({ id: "fb" }),
    bindFramebuffer: (_target: unknown, framebuffer: unknown) => { boundFramebuffer = framebuffer },
    framebufferTexture2D: () => {},
    deleteFramebuffer: () => {},
    deleteTexture: () => {},
    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
    disable: () => {},
    isContextLost: () => false,
    drawArrays: () => { draws.push({ boundFramebuffer, flipY }) },
  }
  return { gl, draws }
}

function fakeCanvas(gl: unknown): HTMLCanvasElement {
  return { width: 8, height: 8, getContext: () => gl } as unknown as HTMLCanvasElement
}

function layerInput() {
  return { source: { width: 8, height: 8 } as unknown as TexImageSource, opacity: 1, blendMode: "normal" as const }
}

test("layer passes render flipped into the framebuffer and upright to the canvas", () => {
  const { gl, draws } = fakeGl()
  const result = new WebGL2DCompositor(fakeCanvas(gl)).composite([layerInput(), layerInput(), layerInput()])

  expect(result.completed).toBe(true)
  expect(draws).toHaveLength(4) // three layer passes plus the final blit

  const layerPasses = draws.slice(0, 3)
  const finalBlit = draws[3]

  for (const pass of layerPasses) {
    expect(pass.boundFramebuffer, "layer passes target a framebuffer").not.toBeNull()
    expect(pass.flipY, "and flip, because framebuffer rows run bottom-up").toBe(-1)
  }
  expect(finalBlit.boundFramebuffer, "the last pass targets the canvas").toBeNull()
  expect(finalBlit.flipY, "which needs no flip").toBe(1)
})
