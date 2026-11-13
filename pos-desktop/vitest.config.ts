import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@main': path.resolve(__dirname, 'src/main') } },
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
