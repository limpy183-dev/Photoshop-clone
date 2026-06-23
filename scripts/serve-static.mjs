#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize, resolve, sep } from "node:path"

const root = resolve(process.argv[2] ?? "out")
const port = Number(process.argv[3] ?? 3001)
const basePath = process.argv[4] ?? "/Photoshop-clone"

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`Static root does not exist: ${root}`)
  process.exit(1)
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
])

function fileForUrl(url) {
  const parsed = new URL(url, `http://127.0.0.1:${port}`)
  const pathName = basePath && parsed.pathname.startsWith(`${basePath}/`)
    ? parsed.pathname.slice(basePath.length)
    : parsed.pathname === basePath
      ? "/"
      : parsed.pathname
  const decoded = decodeURIComponent(pathName)
  const safe = normalize(decoded).replace(/^([/\\])+/, "")
  const candidate = resolve(root, safe)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  const index = join(candidate, "index.html")
  if (existsSync(index) && statSync(index).isFile()) return index
  const html = `${candidate}.html`
  if (existsSync(html) && statSync(html).isFile()) return html
  return null
}

const server = createServer((request, response) => {
  const file = fileForUrl(request.url ?? "/")
  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    response.end("Not found")
    return
  }
  response.writeHead(200, {
    "Content-Type": contentTypes.get(extname(file)) ?? "application/octet-stream",
  })
  createReadStream(file).pipe(response)
})

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}`)
})

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  server.closeIdleConnections?.()
  server.close(() => process.exit(0))
  const timer = setTimeout(() => process.exit(0), 5_000)
  timer.unref?.()
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, shutdown)
}
