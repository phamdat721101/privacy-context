import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vitest config for packages/frontend.
 *
 * New addition (2026-07-25) — the frontend previously had zero test
 * infrastructure. Added scoped to this package only, matching the
 * `@/*` -> `./src/*` alias already declared in tsconfig.json so tests
 * can import the same way app code does.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
