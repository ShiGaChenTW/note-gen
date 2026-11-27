// Runs `pnpm build` before the static E2E suite unless out/ is already newer than every input.
//
// Freshness: the build time is the mtime of out/core/main.html (rewritten by every export). It is
// compared with the newest mtime among the files that feed the build. Test files and the two
// worker bundles that the build itself regenerates into public/ are ignored, so editing a test or
// running the dev server does not force a rebuild.
//
// E2E_SKIP_BUILD=1 skips the check and uses out/ as is (static-server.mjs still refuses to start
// when out/core/main.html does not exist).
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const builtMarker = path.join(projectRoot, 'out', 'core', 'main.html')

const INPUT_DIRS = ['src', 'messages', 'public', 'config']
const INPUT_FILES = [
  'next.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'postcss.config.mjs',
  'components.json',
]
const GENERATED = new Set([
  path.join(projectRoot, 'public', 'plugin-runtime.js'),
  path.join(projectRoot, 'public', 'markdown-lexer.js'),
])
const IGNORED_NAME = /(\.test\.[cm]?[jt]sx?$)|(^\.DS_Store$)/

function mtimeOf(filePath) {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

function newestIn(dir) {
  let newest = { time: 0, file: '' }
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return newest
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      const inner = newestIn(full)
      if (inner.time > newest.time) newest = inner
    } else if (entry.isFile() && !IGNORED_NAME.test(entry.name) && !GENERATED.has(full)) {
      const time = mtimeOf(full)
      if (time > newest.time) newest = { time, file: full }
    }
  }
  return newest
}

function newestInput() {
  let newest = { time: 0, file: '' }
  for (const dir of INPUT_DIRS) {
    const inner = newestIn(path.join(projectRoot, dir))
    if (inner.time > newest.time) newest = inner
  }
  for (const file of INPUT_FILES) {
    const full = path.join(projectRoot, file)
    const time = mtimeOf(full)
    if (time > newest.time) newest = { time, file: full }
  }
  return newest
}

if (process.env.E2E_SKIP_BUILD === '1') {
  console.log('[e2e build] E2E_SKIP_BUILD=1, using out/ as is')
  process.exit(0)
}

const builtAt = mtimeOf(builtMarker)
const input = newestInput()
if (builtAt > 0 && builtAt >= input.time) {
  console.log('[e2e build] out/ is newer than the sources, skipping build')
  process.exit(0)
}

console.log(
  builtAt === 0
    ? '[e2e build] out/ not found, running pnpm build'
    : `[e2e build] ${path.relative(projectRoot, input.file)} changed after the last build, running pnpm build`,
)
const started = Date.now()
const result = spawnSync('pnpm', ['build'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, pnpm_config_verify_deps_before_run: 'false', NODE_ENV: 'production' },
  shell: process.platform === 'win32',
})
if (result.status !== 0) {
  console.error('[e2e build] pnpm build failed')
  process.exit(result.status ?? 1)
}
console.log(`[e2e build] built in ${Math.round((Date.now() - started) / 1000)}s`)
