import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    sequence: { shuffle: true },
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 95, branches: 80 },
    },
  },
});
