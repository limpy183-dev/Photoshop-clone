/** @type {import('next').NextConfig} */

// Security response headers applied to every route.
//
// Notes on the CSP, written so future changes don't regress the editor:
//   - script-src
//       'self'                      — bundled Next.js code.
//       https://va.vercel-scripts.com — Vercel Analytics loader (only loaded
//                                       when NODE_ENV === 'production').
//       'unsafe-inline'             — required by the strip-extension
//                                       hydration fix in app/layout.tsx,
//                                       which has to run beforeInteractive
//                                       and predates React hydration. Move
//                                       that script to a static file under
//                                       public/ and switch this to a per-
//                                       request nonce when convenient.
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
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Strict-Transport-Security is set by the hosting platform (Vercel) so we
  // don't double up here; if you self-host behind plain HTTP this is fine.
]

const nextConfig = {
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
      "recharts",
      "date-fns",
      // Added during the codebase-review pass — each of these is imported
      // in 5+ files via barrel re-exports, so they benefit from the same
      // tree-shake-on-import treatment as the Radix family above.
      "cmdk",
      "sonner",
      "vaul",
      "react-day-picker",
    ],
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
