import type { Metadata } from 'next'
import Script from 'next/script'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const stripExtensionHydrationAttributes = `
(() => {
  const ATTRIBUTES = ["bis_skin_checked"];
  const strip = (root) => {
    if (!root || root.nodeType !== 1) return;
    for (const attr of ATTRIBUTES) {
      if (root.hasAttribute?.(attr)) root.removeAttribute(attr);
    }
    root.querySelectorAll?.(ATTRIBUTES.map((attr) => "[" + attr + "]").join(",")).forEach((node) => {
      for (const attr of ATTRIBUTES) node.removeAttribute(attr);
    });
  };
  strip(document.documentElement);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        strip(mutation.target);
      } else {
        mutation.addedNodes.forEach(strip);
      }
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ATTRIBUTES,
    childList: true,
    subtree: true,
  });
  window.addEventListener("load", () => window.setTimeout(() => observer.disconnect(), 5000), { once: true });
})();
`

export const metadata: Metadata = {
  title: 'Photoshop Web — Image Editor',
  description: 'A browser-based Photoshop-style image editor with layers, tools, and panels.',
  generator: 'v0.app',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark bg-background" suppressHydrationWarning>
      <body className="font-sans antialiased overflow-hidden" suppressHydrationWarning>
        <Script
          id="strip-extension-hydration-attributes"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: stripExtensionHydrationAttributes }}
        />
        {children}
        <Toaster position="bottom-right" richColors closeButton />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
