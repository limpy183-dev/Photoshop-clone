import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { resolve } from "node:path"

import { chromium } from "playwright"

export const BUNDLE_ROUTES = ["/", "/editor", "/marketing", "/documentation"]
const ROUTE_ENTRY_MARKS = {
  "/editor": "photoshop-editor-entry-loaded",
}
const DECODER_RE = /decoder|raster|raw|heic|j2k|openjpeg|exr|tiff|pdfjs|dicom|wasm/i
const REPORT_ORIGIN = "http://bundle.local"

async function reservePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

async function waitForServer(baseUrl, child, logs) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`Production server exited early.\n${logs.slice(-20).join("")}`)
    }
    try {
      const response = await fetch(baseUrl, { redirect: "manual" })
      if (response.status > 0) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error(`Timed out waiting for production server at ${baseUrl}.`)
}

export function normalizeBundleReportUrl(value) {
  try {
    const url = new URL(value)
    return `${REPORT_ORIGIN}${url.pathname}${url.search}`
  } catch {
    return String(value)
  }
}

export function sortBundleResources(resources) {
  return [...resources].sort((a, b) =>
    normalizeBundleReportUrl(a.name).localeCompare(normalizeBundleReportUrl(b.name)) ||
    a.initiatorType.localeCompare(b.initiatorType) ||
    a.decodedBodySize - b.decodedBodySize,
  )
}

export function selectInitialRouteResources(resources, routeEntryCutoff) {
  if (!Number.isFinite(routeEntryCutoff)) return resources
  return resources.filter((entry) => entry.responseEnd <= routeEntryCutoff)
}

function normalizeResource(entry) {
  return {
    ...entry,
    name: normalizeBundleReportUrl(entry.name),
  }
}

function resourceSummary(resources) {
  const scripts = sortBundleResources(resources).filter((entry) =>
    entry.initiatorType === "script" || /\.js(?:\?|$)/i.test(entry.name),
  ).map(normalizeResource)
  const decoderResources = scripts.filter((entry) => DECODER_RE.test(entry.name))
  const startupResources = scripts.filter((entry) => !DECODER_RE.test(entry.name))
  const largestStartupChunk = startupResources.reduce(
    (largest, entry) => entry.decodedBodySize > (largest?.decodedBodyBytes ?? -1)
      ? {
          decodedBodyBytes: entry.decodedBodySize,
          encodedBodyBytes: entry.encodedBodySize,
          transferBytes: entry.transferSize,
          url: normalizeBundleReportUrl(entry.name),
        }
      : largest,
    null,
  )
  return {
    encodedBodyBytes: startupResources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
    decodedBodyBytes: startupResources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    transferBytes: startupResources.reduce((sum, entry) => sum + entry.transferSize, 0),
    requestCount: startupResources.length,
    largestStartupChunk,
    resources: startupResources,
    decoderResources: {
      encodedBodyBytes: decoderResources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      decodedBodyBytes: decoderResources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      requestCount: decoderResources.length,
      resources: decoderResources,
    },
  }
}

export async function measureRouteBundles({ root = process.cwd(), baseUrl: suppliedBaseUrl } = {}) {
  let child
  const logs = []
  let baseUrl = suppliedBaseUrl || process.env.BUNDLE_BASE_URL
  if (!baseUrl) {
    const port = await reservePort()
    baseUrl = `http://127.0.0.1:${port}`
    child = spawn(
      process.execPath,
      [resolve(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: root,
        env: { ...process.env, NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    )
    child.stdout?.on("data", (chunk) => logs.push(String(chunk)))
    child.stderr?.on("data", (chunk) => logs.push(String(chunk)))
  }

  try {
    await waitForServer(baseUrl, child, logs)
    const browser = await chromium.launch({ headless: true })
    try {
      const routeMetrics = {}
      for (const route of BUNDLE_ROUTES) {
        const context = await browser.newContext()
        const page = await context.newPage()
        await page.goto(new URL(route, baseUrl).href, { waitUntil: "networkidle" })
        const measurement = await page.evaluate((routeEntryMark) => ({
          routeEntryCutoff: routeEntryMark
            ? performance.getEntriesByName(routeEntryMark, "mark").at(-1)?.startTime
            : undefined,
          resources: performance.getEntriesByType("resource").map((raw) => {
            const entry = raw
            return {
              decodedBodySize: entry.decodedBodySize,
              encodedBodySize: entry.encodedBodySize,
              initiatorType: entry.initiatorType,
              name: entry.name,
              responseEnd: entry.responseEnd,
              transferSize: entry.transferSize,
            }
          }),
        }), ROUTE_ENTRY_MARKS[route])
        routeMetrics[route] = resourceSummary(
          selectInitialRouteResources(measurement.resources, measurement.routeEntryCutoff),
        )
        await context.close()
      }
      return routeMetrics
    } finally {
      await browser.close()
    }
  } finally {
    if (child && child.exitCode === null) child.kill()
  }
}
