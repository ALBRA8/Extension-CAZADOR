import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Vitest configuration kept separate from vite.config.ts so that the
// production build pipeline (which inlines a Chrome MV3 postbuild plugin)
// is not affected by the test environment (jsdom) or the setup file.
//
// Run with: `npx vitest run` (CI) or `npx vitest` (watch mode).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
})
