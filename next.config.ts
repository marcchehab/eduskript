import type { NextConfig } from 'next'

// Expose NEXTAUTH_URL hostname to client so auth-button can distinguish
// the app's own domain from custom domains (e.g. when running via ngrok)
const appHostname = (() => {
  try {
    return new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000').hostname
  } catch {
    return 'localhost'
  }
})()

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_HOSTNAME: appHostname,
  },
  output: 'standalone',
  // Enable source maps in production for easier debugging
  productionBrowserSourceMaps: true,
  // Prevent aggressive caching in development (especially Safari)
  async headers() {
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/:path*',
          headers: [
            { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          ],
        },
      ]
    }
    return [
      {
        // Public content pages: no browser cache, allow CDN caching with revalidation
        source: '/:domain/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        // Dashboard pages: never cache
        source: '/dashboard/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
    ]
  },
  images: {
    // Disable server-side image optimization to prevent OOM on small instances.
    // Broken/missing images cause the optimizer to leak memory and crash.
    // S3 serves images directly — no optimization needed.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 's3.fr-par.scw.cloud',
        pathname: '/eduskript-teacher-files/**',
      },
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
        pathname: '/vi/**',
      },
      {
        protocol: 'https',
        hostname: 'eduskript.org',
      },
    ],
  },
  // RFC 8414 + RFC 9728 metadata documents must be served from the literal
  // /.well-known/... path AT THE ROOT (so the issuer URL stays as the bare
  // host and matches the metadata URL — claude.ai rejects the doc otherwise).
  // Next.js routes folders prefixed with a dot as private, so we rewrite the
  // canonical paths onto routes without the dot.
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/well-known/oauth-authorization-server',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/well-known/oauth-protected-resource',
      },
    ]
  },
  // Allow larger body sizes for import API (default is 10MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  // Configure server external packages for Prisma
  // These packages contain native bindings and must not be bundled
  serverExternalPackages: [
    '@prisma/client',
    'sql.js', // SQL.js uses Node.js 'fs' module which should not be bundled for server
  ],
  // Empty turbopack config to silence warnings about webpack config in Next.js 16
  turbopack: {},
  webpack(config, { isServer }) {
    // sql.js shouldn't be bundled on the server
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'sql.js': false,
      };
    } else {
      // Client-side: disable Node.js modules that sql.js tries to use
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }

    // Prevent webpack from trying to parse sql.js internals
    config.module = config.module || {};
    config.module.noParse = config.module.noParse || [];
    if (Array.isArray(config.module.noParse)) {
      config.module.noParse.push(/sql\.js/);
    }

    return config;
  },
}

export default nextConfig