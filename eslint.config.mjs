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
