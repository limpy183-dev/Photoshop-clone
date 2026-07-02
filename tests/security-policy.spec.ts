import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

test("static and nonce CSP variants come from one policy module", async () => {
  const policy = await import("../lib/security-policy.mjs") as {
    createContentSecurityPolicy: (options?: {
      nonce?: string
      development?: boolean
    }) => string
  }
  const staticPolicy = policy.createContentSecurityPolicy({ development: false })
  const noncePolicy = policy.createContentSecurityPolicy({
    nonce: "test-nonce",
    development: false,
  })

  expect(staticPolicy).toContain("default-src 'self'")
  expect(staticPolicy).not.toContain("'strict-dynamic'")
  expect(noncePolicy).toContain("'nonce-test-nonce'")
  expect(noncePolicy).toContain("'strict-dynamic'")
  expect(readFileSync("next.config.mjs", "utf8")).toContain("createContentSecurityPolicy")
  expect(readFileSync("proxy.ts", "utf8")).toContain("createContentSecurityPolicy")
})

test("codec loading does not use dynamic evaluation", () => {
  const browserCodec = readFileSync("components/photoshop/raster-codecs.ts", "utf8")
  const nodeCodec = readFileSync("components/photoshop/raster-codecs.node.ts", "utf8")
  expect(browserCodec).not.toContain("new Function")
  expect(browserCodec).not.toContain("node:fs")
  expect(nodeCodec).toContain('import("node:fs/promises")')
})
