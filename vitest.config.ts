import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '.next/',
        'dist/',
        '**/*.config.*',
        '**/*.d.ts',
        '**/types/**',
        'prisma/**',
      ],
    },
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'dist/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Next.js virtual module — provide an empty stub so vitest can resolve
      // imports of `server-only` from server-tagged source files.
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
})
