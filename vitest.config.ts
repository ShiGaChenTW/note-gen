import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          include: ['src/**/*.test.tsx', 'tests/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['src/test/setup-ui.ts'],
        },
      },
    ],
  },
})
