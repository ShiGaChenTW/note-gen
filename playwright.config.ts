import { defineConfig } from '@playwright/test'

// 預設跑打包好的靜態版（out/），避免 Turbopack dev server 的 HMR／即時編譯造成偶發失敗：
//   1. tests/e2e/build-if-stale.mjs：out/ 比原始碼舊才跑 `pnpm build`（E2E_SKIP_BUILD=1 直接沿用 out/）
//   2. tests/e2e/static-server.mjs：在 E2E_PORT（預設 3456）提供 out/
// E2E_DEV=1 改用 `next dev --turbopack`（本機快速迭代用），並先跑 global-setup.ts 暖機。
// E2E_PORT 可換埠（預設 3456），讓多個 worktree 同時跑 E2E 時不會互搶、或誤用別人的伺服器。
const useDevServer = process.env.E2E_DEV === '1'
const port = Number(process.env.E2E_PORT || 3456)
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // Dev mode only: compiles the main surfaces once before the first test (see global-setup.ts).
  globalSetup: useDevServer ? './tests/e2e/global-setup.ts' : undefined,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'zh-TW',
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
  webServer: useDevServer
    ? {
        // PORT 讓 next.config.ts 的 dev assetPrefix 跟著埠走。
        command: `pnpm plugin-runtime:build && pnpm markdown-lexer:build && PORT=${port} pnpm exec next dev --turbopack -p ${port} -H localhost`,
        url: `${baseURL}/core/main`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : {
        command: `node tests/e2e/build-if-stale.mjs && node tests/e2e/static-server.mjs --port ${port}`,
        url: `${baseURL}/core/main`,
        // 不沿用已在這個埠的伺服器：那多半是 `pnpm dev` 或別的 worktree，沿用就等於又跑回 dev 版。
        reuseExistingServer: false,
        stdout: 'pipe',
        // 包含可能的 `pnpm build`。
        timeout: 600_000,
      },
})
