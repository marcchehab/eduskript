import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
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
    return []
  },
  images: {
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
    ],
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