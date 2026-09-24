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
  // Dev-mode blocks cross-origin requests for _next assets/RSC by default.
  // Without this, tunneling `pnpm dev` through ngrok (or similar) serves the
  // SSR HTML fine but the client never hydrates — the page looks normal but
  // nothing is interactive.
  allowedDevOrigins: ['*.ngrok-free.dev'],
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
        // HSTS: after one https visit the browser upgrades http URLs itself,
        // so it never lands on the http origin (separate IndexedDB) again.
        // Browsers ignore this header on http responses; the http → https
        // redirect in src/proxy.ts covers the first visit. No
        // includeSubDomains — atlas.eduskript.org is hosted elsewhere.
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        ],
      },
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
      // Order matters — Next.js merges matching rules and later entries
      // override earlier ones for the same header key. The `/:domain/:path*`
      // rule above also matches `/_next/static/...` (the `:domain` segment
      // captures `_next`), which silently downgraded hashed asset caching to
      // `no-cache, no-store` and forced every visitor to re-download CSS/JS
      // on every page load. These two more-specific rules sit AFTER the
      // broad rule so their `immutable` directive wins for content-addressed
      // assets. The hash in the filename is a sufficient cache-busting key.
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/js/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
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
    // src/proxy.ts runs on /api, so Next buffers every request body through it
    // and SILENTLY TRUNCATES at this limit (default 10MB) — route handlers then
    // fail with "Unterminated string in JSON". Excalidraw saves embed pasted
    // images as base64 three times (JSON + light SVG + dark SVG), so they hit it.
    // Buffered in memory per request.
    proxyClientMaxBodySize: '100mb',
  },
  // Configure server external packages for Prisma
  // These packages contain native bindings and must not be bundled
  // WMF/EMF/drawing rendering (src/lib/script-import/wmf-render.ts,
  // drawing-render.ts) loads KaTeX and DejaVu TTFs from node_modules at
  // runtime; nothing imports them, so the standalone trace would miss them.
  outputFileTracingIncludes: {
    '/api/script-import': [
      './node_modules/katex/dist/fonts/KaTeX_Main-*.ttf',
      './node_modules/katex/dist/fonts/KaTeX_Size1-Regular.ttf',
      './node_modules/katex/dist/fonts/KaTeX_SansSerif-*.ttf',
      './node_modules/katex/dist/fonts/KaTeX_Math-Italic.ttf',
      './node_modules/dejavu-fonts-ttf/ttf/DejaVuSans*.ttf',
      './node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif*.ttf',
    ],
  },
  serverExternalPackages: [
    '@prisma/client',
    'pandoc-wasm', // loads its .wasm via fs relative to the module; don't bundle
    '@napi-rs/canvas', // native .node binary (WMF rendering, src/lib/script-import/wmf-render.ts)
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