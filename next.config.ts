import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
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