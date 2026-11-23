#!/usr/bin/env node
// Fork（almanac ALMNC-69.6）：領域資料表遷移成 MOC 檔的終端機入口。用 esbuild 把 src/lib/migration/domain-moc-migration-cli.ts
// 打包成單一檔（含 @/ 路徑別名與 yaml），放在系統暫存資料夾後執行；需要 Node 22.5 以上（node:sqlite）。
// 用法：node scripts/migrate-domains.mjs --help
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'almanac-migrate-domains-'))
const outfile = join(outDir, 'migrate-domains.mjs')
let code = 1
try {
  await build({
    entryPoints: [join(root, 'src/lib/migration/domain-moc-migration-cli.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    tsconfig: join(root, 'tsconfig.json'),
    logLevel: 'warning',
    // yaml 是 CommonJS，打包成 ESM 後要有 require 才能載入 node 內建模組。
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  })
  const { main } = await import(pathToFileURL(outfile).href)
  code = await main(process.argv.slice(2))
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
process.exit(code)
