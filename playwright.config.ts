import { defineConfig } from '@playwright/test'

// 預設跑打包好的靜態版（out/），避免 Turbopack dev server 的 HMR／即時編譯造成偶發失敗：
//   1. tests/e2e/build-if-stale.mjs：out/ 比原始碼舊才跑 `pnpm build`（E2E_SKIP_BUILD=1 直接沿用 out/）
//   2. tests/e2e/static-server.mjs：在 E2E_PORT（預設 3456）提供 out/
// E2E_DEV=1 改用 `next dev --turbopack`（本機快速迭代用），並先跑 global-setup.ts 暖機。
// E2E_PORT 可換埠（預設 3456），讓多個 worktree 同時跑 E2E 時不會互搶、或誤用別人的伺服器。
const useDevServer = process.env.E2E_DEV === '1'
const port = Number(process.env.E2E_PORT || 3456)
const baseURL = `http://localhost:${port}`

// 截圖比對（ALMNC-94.5）：tests/e2e/visual/*.visual.ts，獨立成 `visual` project，用 `pnpm test:visual` 跑；
// `pnpm test:e2e` 只跑 `e2e` project，功能 E2E 不會因像素差異失敗。
// V3 同步雙裝置（ALMNC-95.3）：tests/e2e/v3-sync.spec.ts，獨立成 `sync` project，用 `pnpm test:e2e:sync` 跑。
// 基準檔放 tests/e2e/visual/__screenshots__/<平台>/，以 macOS（darwin）產生；其他平台沒有基準，不會拿 macOS 的圖誤判。
export default defineConfig({
  testDir: './tests/e2e',
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
  projects: [
    {
      name: 'e2e',
      testMatch: '**/*.spec.ts',
      // 雙裝置同步另成 `sync` project（`pnpm test:e2e:sync`），不拖慢 `pnpm test:e2e`。
      testIgnore: '**/v3-sync.spec.ts',
    },
    {
      // ALMNC-95.3：V3 同步雙裝置 E2E。兩個 browser context 指到同一個暫存「雲端資料夾」來回同步，一支測試要跑完幾輪同步，給較長的時限。
      name: 'sync',
      testMatch: '**/v3-sync.spec.ts',
      timeout: 180_000,
    },
    {
      name: 'visual',
      testMatch: 'visual/**/*.visual.ts',
      snapshotPathTemplate: '{testDir}/visual/__screenshots__/{platform}/{arg}{ext}',
      use: {
        timezoneId: 'Asia/Taipei',
        deviceScaleFactor: 1,
      },
      expect: {
        toHaveScreenshot: {
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
        },
      },
    },
  ],
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
