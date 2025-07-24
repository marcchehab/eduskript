import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from '@/components/providers'
import { CustomDomainHandler } from '@/components/CustomDomainHandler'

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eduskript - Education Platform",
  description: "Create and manage educational content with ease",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.0/dist/katex.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <Providers>
          <CustomDomainHandler>
            {children}
          </CustomDomainHandler>
        </Providers>
      </body>
    </html>
  );
}
