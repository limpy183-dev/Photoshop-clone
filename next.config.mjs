import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createContentSecurityPolicy } from "./lib/security-policy.mjs"

/** @type {import('next').NextConfig} */

// Security response headers applied to every route.
//
// Notes on the CSP, written so future changes don't regress the editor:
//   - script-src
//       'self'                      — bundled Next.js code.
//       https://va.vercel-scripts.com — Vercel Analytics loader (only loaded
//                                       when NODE_ENV === 'production').
//       No 'unsafe-inline' here: scripts either come from bundled/static files
//       or receive the per-request nonce attached by proxy.ts. In
//       development only, React/Next debugging needs 'unsafe-eval'.
//   - style-src 'unsafe-inline'    — Tailwind injects critical inline styles
//                                       and Radix/sonner ship inline style
//                                       attributes; required.
//   - img-src 'self' data: blob:   — canvas.toDataURL/blob exports and PSD
//                                       thumbnails.
//   - worker-src 'self' blob:      — components/photoshop/filter-worker.ts
//                                       creates the filter Web Worker from a
//                                       Blob URL.
//   - connect-src                  — same-origin XHR/fetch + Vercel Analytics
//                                       beacon.
//   - frame-src 'self'             — the plugin runtime renders descriptor
//                                       HTML inside a sandboxed iframe whose
//                                       srcDoc is treated as same-origin.
//   - frame-ancestors 'none'       — the editor must never be framed; this
//                                       is the modern replacement for
//                                       X-Frame-Options.
//   - object-src 'none'            — defense-in-depth; we don't embed Flash
//                                       or other plugins.
//   - base-uri 'self'              — prevents <base> hijacking by a future
//                                       injected node.
//   - form-action 'self'           — POSTing only to our own /api routes.
//
// We intentionally do NOT enable upgrade-insecure-requests so the dev server
// still works over http://localhost.
const csp = createContentSecurityPolicy()

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // COEP is intentionally not enabled: require-corp would break future
  // third-party embeds/assets unless they ship compatible CORP headers.
]

const emptyNodeFs = fileURLToPath(new URL("./components/photoshop/empty-node-fs.ts", import.meta.url))
const outputFileTracingRoot = fileURLToPath(new URL("./", import.meta.url))
const isGithubPages = process.env.GITHUB_PAGES === "true"
const githubPagesBasePath = "/Photoshop-clone"

function webpackModuleName(module, compilation) {
  if (typeof module.nameForCondition === "function") {
    const name = module.nameForCondition()
    if (name) return name
  }
  if (typeof module.identifier === "function") {
    const identifier = module.identifier()
    if (identifier) return identifier
  }
  if (typeof module.readableIdentifier === "function") {
    return module.readableIdentifier(compilation.requestShortener)
  }
  return String(module)
}

function collectWebpackChunkModules(module, compilation, out) {
  out.push({
    identifier: typeof module.identifier === "function" ? module.identifier() : undefined,
    name: webpackModuleName(module, compilation),
    nameForCondition: typeof module.nameForCondition === "function" ? module.nameForCondition() : undefined,
  })
  for (const nested of module.modules ?? []) {
    collectWebpackChunkModules(nested, compilation, out)
  }
}

function addBundleStatsPlugin(config) {
  const statsPath = process.env.BUNDLE_WEBPACK_STATS_PATH?.trim() || "artifacts/webpack-stats.json"
  if (statsPath === "0" || statsPath === "false") return
  const resolvedStatsPath = resolve(outputFileTracingRoot, statsPath)
  config.plugins = config.plugins ?? []
  config.plugins.push({
    apply(compiler) {
      compiler.hooks.done.tap("BundleWebpackStatsPlugin", (stats) => {
        const { compilation } = stats
        const chunks = Array.from(compilation.chunks, (chunk) => {
          const modules = []
          for (const module of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
            collectWebpackChunkModules(module, compilation, modules)
          }
          return {
            id: chunk.id,
            ids: Array.from(chunk.ids ?? []),
            names: Array.from(new Set([chunk.name, ...Array.from(chunk.names ?? [])].filter(Boolean).map(String))),
            files: Array.from(chunk.files ?? []),
            modules,
          }
        })
        const json = { chunks }
        mkdirSync(dirname(resolvedStatsPath), { recursive: true })
        writeFileSync(resolvedStatsPath, JSON.stringify(json, null, 2) + "\n")
      })
    },
  })
}

const nextConfig = {
  outputFileTracingRoot,
  output: isGithubPages ? "export" : undefined,
  basePath: isGithubPages ? githubPagesBasePath : "",
  assetPrefix: isGithubPages ? `${githubPagesBasePath}/` : "",
  trailingSlash: isGithubPages,
  // images.unoptimized bypasses the image loader, so basePath is NOT
  // prepended to <Image src> automatically — client code reads these via
  // lib/base-path.ts to prefix static assets and skip /api calls on export.
  env: {
    NEXT_PUBLIC_BASE_PATH: isGithubPages ? githubPagesBasePath : "",
    NEXT_PUBLIC_STATIC_EXPORT: isGithubPages ? "true" : "false",
  },
  images: {
    unoptimized: true,
  },
  // Tree-shake/optimize the heaviest barrel imports used across the editor.
  // lucide-react alone is imported in 47+ files; this avoids pulling the
  // full icon set into every chunk and dramatically reduces compile cost
  // and client bundle size.
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-menubar",
      "@radix-ui/react-context-menu",
      "@radix-ui/react-navigation-menu",
      "@radix-ui/react-scroll-area",
      // Added during the codebase-review pass — each of these is imported
      // in 5+ files via barrel re-exports, so they benefit from the same
      // tree-shake-on-import treatment as the Radix family above.
      "cmdk",
      "sonner",
    ],
  },
  turbopack: {
    // Pin the workspace root to this project. Without this, Next/Turbopack
    // infers the root by walking up to the outermost lockfile — and a stray
    // package-lock.json in a parent directory (e.g. the home folder) would
    // hijack module resolution, breaking `@import "tailwindcss"` and others.
    root: outputFileTracingRoot,
    resolveAlias: {
      fs: "./components/photoshop/empty-node-fs.ts",
    },
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      addBundleStatsPlugin(config)
      config.resolve = config.resolve ?? {}
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        fs: emptyNodeFs,
      }
      config.optimization = config.optimization ?? {}
      config.optimization.splitChunks = {
        ...(config.optimization.splitChunks ?? {}),
        cacheGroups: {
          ...((config.optimization.splitChunks && config.optimization.splitChunks.cacheGroups) ?? {}),
          rasterDecoders: {
            // Keep libraw-wasm out of this shared chunk. Its Emscripten
            // wrapper creates a module worker and an em-pthread worker; when
            // both worker entries depend on this shared cache group, webpack
            // reports a circular runtime chunk dependency.
            test: /[\\/]node_modules[\\/](@discourse[\\/]heic|parse-exr|utif2|@abasb75[\\/]jpeg2000-decoder|@cornerstonejs[\\/]codec-openjpeg|@jsquash[\\/]jpeg)[\\/]/,
            name: "raster-decoders",
            chunks: "async",
            priority: 40,
            reuseExistingChunk: true,
          },
          documentDecoders: {
            test: /[\\/]node_modules[\\/](pdf-lib|pdfjs-dist|dicom-parser)[\\/]/,
            name: "document-decoders",
            chunks: "async",
            priority: 35,
            reuseExistingChunk: true,
          },
        },
      }
    }
    return config
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
