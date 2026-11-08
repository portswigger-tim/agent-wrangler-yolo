import js from '@eslint/js';
import globals from 'globals';

// Correctness lint only: house style lives in review, not in rules.
export default [
  { ignores: ['**/node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // The browser half runs in the board page.
  { files: ['public/**/*.js'], ignores: ['public/**/*.test.js'], languageOptions: { globals: { ...globals.browser } } },
];
