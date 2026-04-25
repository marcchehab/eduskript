import type { Metadata } from "next";
import { Inter, Roboto_Slab, EB_Garamond, Barlow_Condensed } from "next/font/google";
import "./globals.css";
import { Providers } from '@/components/providers'
import { GitInfo } from '@/components/GitInfo'
import { DevConsole } from '@/components/dev/dev-console'
import { getCurrentTenant } from '@/lib/tenant'

const inter = Inter({
  subsets: ["latin"],
});

// Modern typography (informatikgarten style)
const modernBody = Roboto_Slab({
  subsets: ['latin'],
  weight: '300',
  variable: '--font-modern-body',
  preload: false, // Only used when user selects "modern" typography
});

// Classic typography (luz style)
const classicBody = EB_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-classic-body',
  preload: false, // Only used when user selects "classic" typography
});

// Shared heading font for both styles
const headingFont = Barlow_Condensed({
  subsets: ['latin'],
  weight: '700',
  variable: '--font-heading',
});

export const metadata: Metadata = {
  title: "Eduskript - Education Platform",
  description: "Create and manage educational content with ease",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-tenant <html lang>: informatikgarten.ch is German, eduskript.org is
  // English. Both are served by this same app; the lang must match the
  // request host or Google will treat the site as mistranslated.
  const tenant = await getCurrentTenant()

  return (
    <html lang={tenant.lang} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${inter.className} ${modernBody.variable} ${classicBody.variable} ${headingFont.variable} antialiased`} suppressHydrationWarning>
        <Providers>
          {children}
          <GitInfo />
          <DevConsole />
        </Providers>
      </body>
    </html>
  );
}
