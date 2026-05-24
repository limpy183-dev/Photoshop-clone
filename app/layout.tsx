import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from '@/components/ui/sonner'
import {
  marketingFontVariables,
  marketingFontVariableClasses,
} from '@/components/marketing/fonts'
import './globals.css'

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html
      lang="en"
      className={`dark bg-background ${marketingFontVariableClasses}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased min-h-screen" suppressHydrationWarning>
        {/*
          Static beforeInteractive script. Lives at
          public/strip-extension-hydration-attributes.js so the CSP can drop
          'unsafe-inline' from script-src and we still ship the
          extension-attribute strip that prevents hydration warnings from
          things like Bitdefender's bis_skin_checked.
        */}
        <script
          id="strip-extension-hydration-attributes"
          nonce={nonce}
          src="/strip-extension-hydration-attributes.js"
          suppressHydrationWarning
        />
        {children}
        <Toaster position="bottom-right" richColors closeButton />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
