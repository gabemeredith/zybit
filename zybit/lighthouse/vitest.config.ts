/**
 * Lighthouse-specific vitest config. Zybit's vitest.config.ts is scoped
 * to src/** and we intentionally don't modify it. Run with:
 *
 *   npx vitest run --config lighthouse/vitest.config.ts
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['lighthouse/**/*.test.ts'],
  },
});
