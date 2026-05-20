import type { Metadata } from 'next'
import Script from 'next/script'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from '@/components/ui/sonner'
import {
  marketingFontVariables,
  marketingFontVariableClasses,
} from '@/components/marketing/fonts'
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
  title: 'Photoshop Web — A Real Image Editor In A Tab',
  description:
    'Photoshop Web is a browser-native, layer-honest image editor with the panels, tools, and workflows you already know — built on Canvas, workers, and a stubborn refusal to lie about what a browser can do.',
  generator: 'Photoshop Web',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
}

void marketingFontVariables

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`dark bg-background ${marketingFontVariableClasses}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased min-h-screen" suppressHydrationWarning>
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
