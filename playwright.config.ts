import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3456',
    locale: 'zh-TW',
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm plugin-runtime:build && pnpm markdown-lexer:build && pnpm exec next dev --turbopack -p 3456 -H localhost',
    url: 'http://localhost:3456/core/main',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
