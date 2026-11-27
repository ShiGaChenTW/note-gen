import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const baseUrl = 'http://127.0.0.1:3456'
const isWindows = platform() === 'win32'

// Next.js reports Ready before compiling routes. Open the Tauri window only
// after its initial navigation and saved page can answer a full request.

export function startupPages(savedPage) {
  const pages = ['/', '/core/main']
  const legacyPages = ['/core/article', '/core/record', '/core/search']
  if (typeof savedPage === 'string' &&
      /^\/core\/[a-z0-9/_-]+$/i.test(savedPage) &&
      !savedPage.startsWith('/core/knowledge') &&
      !legacyPages.includes(savedPage)) {
    if (!pages.includes(savedPage)) pages.push(savedPage)
  }
  return pages
}

export async function warmPages(url, pages, { retryDelayMs = 500, timeoutMs = 600_000, isServerRunning = () => true } = {}) {
  for (const page of pages) {
    console.log(`[tauri:dev] Preparing ${page} ...`)
    const deadline = Date.now() + timeoutMs
    let ready = false
    while (Date.now() < deadline) {
      if (!isServerRunning()) throw new Error('Next.js exited before the page was ready')
      try {
        const response = await fetch(new URL(page, url), {
          signal: AbortSignal.timeout(Math.min(180_000, Math.max(1, deadline - Date.now()))),
        })
        await response.arrayBuffer()
        if (response.ok) { ready = true; break }
        if (response.status !== 503) throw new Error(`${page} returned HTTP ${response.status}`)
      } catch (error) {
        if (error.message?.includes('returned HTTP')) throw error
        if (Date.now() >= deadline) throw new Error(`Timed out preparing ${page}: ${error.message}`)
      }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
    }
    if (!ready) throw new Error(`Timed out preparing ${page}`)
    console.log(`[tauri:dev] ${page} is ready`)
  }
}

function savedPage() {
  const appDir = platform() === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : isWindows
      ? process.env.APPDATA
      : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  if (!appDir) return undefined
  const store = join(appDir, 'tw.scottchen.NoteGen.dev', 'store.json')
  if (!existsSync(store)) return undefined
  try {
    return JSON.parse(readFileSync(store, 'utf8')).currentPage
  } catch {
    return undefined
  }
}

function portIsInUse() {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port: 3456 })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false) })
  })
}

function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (isWindows) child.kill('SIGTERM')
    else process.kill(-child.pid, 'SIGTERM')
  } catch { /* Already stopped. */ }
}

async function main() {
  if (await portIsInUse()) throw new Error('Port 3456 is already in use; stop the other dev server first')

  const childOptions = { cwd: root, stdio: 'inherit', detached: !isWindows, shell: isWindows }
  const next = spawn('pnpm', ['dev'], childOptions)
  let tauri
  const cleanup = () => { stop(tauri); stop(next) }
  process.once('SIGINT', () => { cleanup(); process.exit(130) })
  process.once('SIGTERM', () => { cleanup(); process.exit(143) })
  process.once('exit', cleanup)

  try {
    await warmPages(baseUrl, startupPages(savedPage()), {
      isServerRunning: () => next.exitCode === null && next.signalCode === null,
    })
    tauri = spawn('pnpm', [
      'exec', 'tauri', 'dev',
      '--config', 'src-tauri/tauri.dev.conf.json',
      '--config', 'src-tauri/tauri.dev.prewarmed.conf.json',
      '--no-dev-server-wait',
    ], childOptions)
    const code = await new Promise((resolve, reject) => {
      tauri.once('error', reject)
      tauri.once('exit', (exitCode, signal) => resolve(signal ? 1 : exitCode ?? 1))
    })
    process.exitCode = code
  } finally {
    cleanup()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(`[tauri:dev] ${error.message}`)
    process.exitCode = 1
  })
}
