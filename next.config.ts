import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.cellar-c2.services.clever-cloud.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cellar-c2.services.clever-cloud.com',
        port: '',
        pathname: '/**',
      }
    ],
  },
  env: {
    // Construct DATABASE_URL from CleverCloud's POSTGRESQL_ADDON_URI if available
    DATABASE_URL: process.env.DATABASE_URL || 
      (process.env.POSTGRESQL_ADDON_URI ? 
        `${process.env.POSTGRESQL_ADDON_URI}?connection_limit=1&pool_timeout=20` : 
        undefined),
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  },
  webpack(config, { isServer }) {
    // disabling fs and path to avoid the tears
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        path: false,
      };
    }
    return config;
  }
}

export default nextConfig