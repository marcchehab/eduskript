import nextPlugin from 'eslint-config-next';

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'next-env.d.ts',
      'code-review/**',
      'oldstuff/**',
      'coverage/**',
      // Playwright e2e artifacts (minified report bundles, traces, auth state).
      'playwright-report/**',
      'test-results/**',
      'e2e/.auth/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '.obsidian/**',
      'public/js/**',
      // Locked worktrees from agent runs would otherwise surface stale
      // warnings from pre-existing code, blocking the zero-warnings push gate.
      '.claude/worktrees/**',
    ],
  },
  ...nextPlugin,
];

export default eslintConfig;
