// Serves the static export in out/ for the Playwright E2E suite (see playwright.config.ts).
//
// No dependencies: node:http + node:fs only. Path resolution follows what `next build` with
// `output: "export"` (trailingSlash off) actually writes:
//   /core/main            -> out/core/main.html
//   /core/main.txt?_rsc=  -> out/core/main.txt   (RSC payload for client-side navigation)
//   /                     -> out/index.html
//   /some/dir/            -> out/some/dir/index.html (only if a build ever writes one)
// Every route is pre-rendered to its own HTML file and there are no dynamic segments, so there is
// no SPA fallback: an unknown path gets out/404.html with status 404, like a real static host.
//
// Usage: node tests/e2e/static-server.mjs [--port 3456] [--dir out]
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const port = Number(readArg('port', process.env.E2E_PORT || '3456'))
const host = readArg('host', 'localhost')
const root = path.resolve(projectRoot, readArg('dir', 'out'))

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  // Next's export-mode router accepts RSC payloads served as text/plain.
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

/** Maps a URL pathname to a file inside root, or null. Never escapes root. */
async function resolveFile(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const base = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`)
  if (base !== root && !base.startsWith(root + path.sep)) return null

  const candidates = decoded.endsWith('/')
    ? [path.join(base, 'index.html')]
    : [base, `${base}.html`, path.join(base, 'index.html')]
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate
  }
  return null
}

function send(res, req, status, filePath) {
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(status, {
    'Content-Type': type,
    // Each test run may follow a rebuild; never let the browser reuse a stale chunk.
    'Cache-Control': 'no-store',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath)
    .on('error', () => res.destroy())
    .pipe(res)
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  const filePath = await resolveFile(pathname)
  if (filePath) {
    send(res, req, 200, filePath)
    return
  }
  const notFound = path.join(root, '404.html')
  if (await isFile(notFound)) {
    send(res, req, 404, notFound)
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
})

if (!(await isFile(path.join(root, 'core', 'main.html')))) {
  console.error(`[e2e static] ${root}/core/main.html is missing; run \`pnpm build\` first.`)
  process.exit(1)
}

server.listen(port, host, () => {
  console.log(`[e2e static] serving ${path.relative(projectRoot, root) || '.'} at http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
