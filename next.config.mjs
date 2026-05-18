/** @type {import('next').NextConfig} */
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
}

export default nextConfig
