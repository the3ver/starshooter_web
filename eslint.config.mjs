import js from '@eslint/js';
import globals from 'globals';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

export default [
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  { ignores: ['node_modules/', 'playwright-report/', 'test-results/', '.claude/worktrees/', 'balancing/ergebnisse/'] },
  js.configs.recommended,
  {
    files: ['src/js/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser },
    // Review rule R9 (docs/review.md): values from API, network or storage go into HTML only via escapeHtml.
    // Every other HTML sink carries a disable comment that names where its data comes from.
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      'no-unsanitized/property': ['error', { escape: { methods: ['escapeHtml', 'Utils.escapeHtml'] } }],
      'no-unsanitized/method': ['error', { escape: { methods: ['escapeHtml', 'Utils.escapeHtml'] } }],
    },
  },
  {
    files: ['worker/**/*.{js,mjs}', 'scripts/**/*.mjs', '.claude/hooks/*.mjs', '*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.worker } },
  },
  {
    files: ['tests/**/*.js', 'balancing/**/*.js', '*.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
