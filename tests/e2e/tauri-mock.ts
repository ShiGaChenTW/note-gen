import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { expect, type Page } from '@playwright/test'

export interface AiRequestInput {
  config: unknown
  path: string
  method?: string
  body?: unknown
}

export type AiRequestHandler = (req: AiRequestInput) => unknown | Promise<unknown>

interface PendingMcpResolver {
  resolve: (value: { ok: boolean; result?: unknown; error?: unknown }) => void
}

interface SqlTransactionStatement {
  sql: string
  values?: unknown[]
  expectedRows?: number
}

interface SerializedWritePayload {
  path: string
  options?: { baseDir?: number; dir?: number; append?: boolean; create?: boolean; createNew?: boolean }
  bytesBase64: string
}

export interface TauriMockController {
  readonly tempRoot: string
  readonly appDataDir: string
  readonly vaultDir: string
  setAiHandler: (handler: AiRequestHandler) => void
  resetAiHandler: () => void
  querySql: <T extends Record<string, unknown>>(sql: string, values?: unknown[], dbName?: string) => T[]
  execSql: (sql: string, values?: unknown[], dbName?: string) => { changes: number; lastInsertRowid: number }
  fileExists: (relPath: string, base?: 'vault' | 'appData') => boolean
  readVaultFile: (relPath: string) => string
  writeVaultFile: (relPath: string, content: string) => void
  listVaultDir: (relPath?: string) => string[]
  listVaultFiles: (options?: { includeHidden?: boolean }) => string[]
  setStoreKey: (key: string, value: unknown, storePath?: string) => void
  getStoreKey: <T = unknown>(key: string, storePath?: string) => T | undefined
  setClockOffsetMs: (page: Page, offsetMs: number) => Promise<void>
  advanceDays: (page: Page, days: number) => Promise<void>
  emitEvent: (page: Page, event: string, payload?: unknown) => Promise<void>
  callLocalMcpTool: (
    page: Page,
    toolName: string,
    args: Record<string, unknown>,
    connection?: { id?: string; name?: string }
  ) => Promise<{ ok: boolean; result?: unknown; error?: unknown }>
  isLocalMcpReady: () => boolean
  getUnhandledCommands: () => string[]
  dispose: () => void
}

const BASE_DIRECTORY_SUBDIR: Record<number, string> = {
  1: 'audio',
  2: 'cache',
  3: 'config',
  4: 'data',
  5: 'localData',
  6: 'document',
  7: 'download',
  8: 'picture',
  9: 'public',
  10: 'video',
  11: 'resource',
  12: 'temp',
  13: 'appConfig',
  14: 'appData',
  15: 'appLocalData',
  16: 'appCache',
  17: 'appLog',
  18: 'desktop',
  19: 'executable',
  20: 'font',
  21: 'home',
  22: 'runtime',
  23: 'template',
}

function normalizeSqlValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value
  if (value instanceof Uint8Array) return value
  return JSON.stringify(value)
}

function stripQuotedStrings(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:""|[^"])*"/g, '""')
}

function bindAndRun(
  db: DatabaseSync,
  mode: 'execute' | 'select',
  sql: string,
  values: unknown[] = []
): unknown {
  const stripped = stripQuotedStrings(sql).trim()
  const hasMultipleStatements = stripped.replace(/;+$/, '').includes(';')
  if (mode === 'execute' && values.length === 0 && hasMultipleStatements) {
    db.exec(sql)
    return [0, 0]
  }

  const stmt = db.prepare(sql)
  const indexedMatches = [...stripped.matchAll(/\$(\d+)/g)]
  if (indexedMatches.length > 0) {
    const namedParams: Record<string, SQLInputValue> = {}
    for (const match of indexedMatches) {
      const idx = Number(match[1])
      namedParams[`$${idx}`] = normalizeSqlValue(values[idx - 1])
    }
    if (mode === 'select') {
      return (stmt.all(namedParams) as Record<string, unknown>[]).map(row => ({ ...row }))
    }
    const res = stmt.run(namedParams)
    return [Number(res.changes), Number(res.lastInsertRowid)]
  }

  const positional = values.map(normalizeSqlValue)
  if (mode === 'select') {
    return (stmt.all(...positional) as Record<string, unknown>[]).map(row => ({ ...row }))
  }
  const res = stmt.run(...positional)
  return [Number(res.changes), Number(res.lastInsertRowid)]
}

function extractChatPrompt(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const messages = (body as { messages?: unknown[] }).messages
  if (!Array.isArray(messages)) return ''
  return messages
    .map(message => {
      if (!message || typeof message !== 'object') return ''
      const content = (message as { content?: unknown }).content
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content
          .map(part => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
          .join('\n')
      }
      return ''
    })
    .join('\n')
}

function makeCompletion(content: string) {
  return {
    id: `chatcmpl-e2e-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'e2e-chat',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }
}

/**
 * ai_chat_completion_stream（右側 AI 對話、agent runtime 用的串流請求）回傳給 Channel 的事件。
 * AI handler 回傳一般的 chat.completion 就切成一個串流 chunk（內容＋tool_calls＋finish_reason）；
 * 回傳陣列就當作已經切好的 chunk 依序送出。handler 丟錯就送 error 事件。
 */
function toStreamEvents(result: unknown): unknown[] {
  if (Array.isArray(result)) return [...result.map(data => ({ type: 'chunk', data })), { type: 'done' }]
  const completion = result as {
    id?: string
    model?: string
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }> }; finish_reason?: string | null }>
  } | undefined
  const choice = completion?.choices?.[0]
  const message = choice?.message
  const delta: Record<string, unknown> = { role: 'assistant' }
  if (typeof message?.content === 'string' && message.content) delta.content = message.content
  if (message?.tool_calls?.length) {
    delta.tool_calls = message.tool_calls.map((call, index) => ({
      index,
      id: call.id,
      type: 'function',
      function: { name: call.function.name, arguments: call.function.arguments },
    }))
  }
  const chunk = {
    id: completion?.id ?? `chatcmpl-e2e-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: completion?.model ?? 'e2e-chat',
    choices: [{ index: 0, delta, finish_reason: choice?.finish_reason ?? 'stop' }],
  }
  return [{ type: 'chunk', data: chunk }, { type: 'done' }]
}

function createDefaultAiHandler(): AiRequestHandler {
  return (req: AiRequestInput) => {
    if (req.path === '/models') {
      return { object: 'list', data: [{ id: 'e2e-chat', object: 'model', created: 0, owned_by: 'e2e' }] }
    }
    const prompt = extractChatPrompt(req.body)

    if (prompt.includes('Revise this pending proposal')) {
      return makeCompletion(JSON.stringify({ title: '修訂後的 E2E 提案標題' }))
    }

    if (prompt.includes('{"drafts"')) {
      const titleMatch = /title:\s*(.+)/.exec(prompt)
      const title = titleMatch?.[1]?.trim() || 'E2E 知識筆記提案'
      return makeCompletion(JSON.stringify({
        drafts: [
          {
            index: 0,
            title,
            body: `# ${title}\n\n這是由 E2E 自動分析整理產生的知識筆記。`,
            date: '',
            time: '',
          },
        ],
      }))
    }

    if (prompt.includes('"fragments"') || prompt.includes('只判斷、不撰寫')) {
      const marker = prompt.includes('--- 資料源 ---\n') ? '--- 資料源 ---\n' : '資料源：\n'
      const markerIdx = prompt.lastIndexOf(marker)
      const sourceText = (markerIdx >= 0 ? prompt.slice(markerIdx + marker.length) : prompt).trim()
      const firstLine = sourceText.split('\n').map(l => l.trim()).find(Boolean) || 'E2E 知識筆記提案'
      const title = Array.from(firstLine).slice(0, 32).join('')
      if (prompt.includes('類型｜建議')) {
        return makeCompletion('知識筆記｜存成知識筆記')
      }
      return makeCompletion(JSON.stringify({
        journal: { verdict: false, confidence: 'low', reason: '' },
        fragments: [
          {
            kind: 'note',
            noteType: 'knowledge',
            title,
            body: sourceText || '這是一則由 E2E 建立的資料源內容。',
            date: '',
            time: '',
            people: [],
            project: '',
            domainHint: '',
            tags: [],
            reason: '包含可留存的知識內容',
            confidence: 'high',
          },
        ],
      }))
    }

    return makeCompletion('OK')
  }
}

function createStoreSeed(): Record<string, unknown> {
  return {
    almanacUiMode: 'v3',
    currentPage: '/core/main',
    workspacePath: '',
    aiModelList: [
      {
        key: 'e2e-mock',
        title: 'E2E Mock',
        baseURL: 'http://e2e.invalid/v1',
        apiKey: 'e2e-key',
        models: [
          {
            id: 'e2e-chat',
            model: 'e2e-chat',
            modelType: 'chat',
            temperature: 0.2,
            topP: 1,
            enableStream: false,
          },
        ],
      },
    ],
    primaryModel: 'e2e-chat',
    editorModel: 'e2e-chat',
    trashRetentionDays: 30,
    managedBackupSchedule: 'disabled',
  }
}

function initBaselineNoteTables(db: DatabaseSync) {
  db.exec(`
    create table if not exists tags (
      id integer primary key autoincrement,
      name text not null,
      isLocked boolean DEFAULT false,
      isPin boolean DEFAULT false,
      sortOrder integer DEFAULT 0
    );
    create table if not exists canvases (
      id text primary key,
      title text not null,
      canvasType text not null,
      schemaVersion integer not null default 1,
      content text not null,
      undoStack text not null default '[]',
      redoStack text not null default '[]',
      thumbnailPath text default null,
      createdAt integer not null,
      updatedAt integer not null,
      pinnedAt integer default null,
      deletedAt integer default null
    );
    create table if not exists vector_documents (
      id integer primary key autoincrement,
      filename text not null,
      chunk_id integer not null,
      content text not null,
      embedding text not null,
      updated_at integer not null,
      unique(filename, chunk_id)
    );
    create table if not exists activity_events (
      id integer primary key autoincrement,
      source text not null,
      title text not null,
      description text default null,
      path text default null,
      tagId integer default null,
      dedupeKey text default null,
      createdAt integer not null
    );
  `)
}

function toFileInfo(stats: fs.Stats) {
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymlink: stats.isSymbolicLink(),
    size: stats.size,
    mtime: Math.floor(stats.mtimeMs),
    atime: Math.floor(stats.atimeMs),
    birthtime: Math.floor(stats.birthtimeMs),
    readonly: false,
    fileAttributes: 0,
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    nlink: stats.nlink,
    uid: stats.uid,
    gid: stats.gid,
    rdev: stats.rdev,
    blksize: stats.blksize,
    blocks: stats.blocks,
  }
}

/**
 * 等主視窗啟動落定：側欄出現，且啟動時自動打開的今天日記（daily-note-auto-open.tsx）已經開好。
 * 自動打開日記會收起「整理」等覆蓋層；不等它，測試剛點開的覆蓋層可能隨即被收掉。
 * dev server 載入慢剛好掩蓋了這個時序，靜態版載入快就會撞到，所以每支測試 goto 之後都先呼叫這個。
 */
export async function waitForMainBoot(page: Page) {
  await expect(page.getByRole('navigation', { name: '主要導覽' })).toBeVisible()
  await expect(page.getByRole('button', { name: '新增', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: '標題', exact: true })).not.toHaveValue('')
}

export interface TauriMockOptions {
  /**
   * 模擬 Tauri 檔案監看（plugin:fs|watch）：App 經 fs plugin 寫入、刪除、搬移、建立資料夾時，送事件給監看那個路徑的 watcher，
   * 讓筆記庫索引（vault-index）像正式版一樣跟著更新。預設關閉，既有測試的時序不變；要驗證「寫入後索引畫面跟著變」的測試才打開。
   */
  fsWatch?: boolean
}

export async function setupTauriMock(page: Page, options: TauriMockOptions = {}): Promise<TauriMockController> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-e2e-'))
  const appDataDir = path.join(tempRoot, 'appData')
  const vaultDir = path.join(appDataDir, 'article')
  fs.mkdirSync(vaultDir, { recursive: true })
  for (const subdir of Object.values(BASE_DIRECTORY_SUBDIR)) {
    fs.mkdirSync(path.join(tempRoot, subdir), { recursive: true })
  }

  const dbs = new Map<string, DatabaseSync>()
  const storeData = new Map<string, Map<string, unknown>>()
  const storePathToRid = new Map<string, number>()
  const storeRidToPath = new Map<number, string>()
  let nextStoreRid = 100
  let nextWatcherRid = 5000
  let clockOffsetMs = 0
  let localMcpReady = false
  let aiHandler: AiRequestHandler = createDefaultAiHandler()
  const unhandledCommands = new Set<string>()
  const pendingMcpRequests = new Map<string, PendingMcpResolver>()

  const getStoreMap = (storePath = 'store.json') => {
    let map = storeData.get(storePath)
    if (!map) {
      map = new Map<string, unknown>()
      if (storePath === 'store.json') {
        for (const [k, v] of Object.entries(createStoreSeed())) {
          map.set(k, structuredClone(v))
        }
      } else {
        const storeFile = path.join(appDataDir, storePath)
        if (fs.existsSync(storeFile)) {
          const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8')) as Record<string, unknown>
          for (const [k, v] of Object.entries(parsed)) map.set(k, v)
        }
      }
      storeData.set(storePath, map)
    }
    return map
  }

  const persistStore = (storePath: string) => {
    const map = getStoreMap(storePath)
    const obj = Object.fromEntries(map.entries())
    const full = path.join(appDataDir, storePath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, JSON.stringify(obj, null, 2), 'utf8')
  }

  // Initialize default store on disk immediately
  getStoreMap('store.json')
  persistStore('store.json')

  const getDb = (dbName = 'sqlite:note.db') => {
    let db = dbs.get(dbName)
    if (!db) {
      db = new DatabaseSync(':memory:')
      db.exec('PRAGMA foreign_keys = ON;')
      if (dbName === 'sqlite:note.db') {
        initBaselineNoteTables(db)
      }
      dbs.set(dbName, db)
    }
    return db
  }

  const resolveBaseDirRoot = (baseDir?: number): string => {
    if (typeof baseDir === 'number' && BASE_DIRECTORY_SUBDIR[baseDir]) {
      const target = path.join(tempRoot, BASE_DIRECTORY_SUBDIR[baseDir])
      fs.mkdirSync(target, { recursive: true })
      return target
    }
    return appDataDir
  }

  const resolveFsPath = (rawPath: string, baseDir?: number): string => {
    const normalizedInput = rawPath.replace(/\\/g, '/')
    if (typeof baseDir === 'number') {
      const baseRoot = resolveBaseDirRoot(baseDir)
      if (path.isAbsolute(normalizedInput) && path.resolve(normalizedInput).startsWith(tempRoot)) {
        return path.resolve(normalizedInput)
      }
      const relativePart = normalizedInput.replace(/^\/+/, '')
      const target = path.resolve(baseRoot, relativePart)
      if (target !== baseRoot && !target.startsWith(baseRoot + path.sep)) {
        throw new Error(`Path escapes baseDir: ${rawPath}`)
      }
      return target
    }
    const resolved = path.isAbsolute(normalizedInput)
      ? path.resolve(normalizedInput)
      : path.resolve(appDataDir, normalizedInput)
    if (resolved !== tempRoot && !resolved.startsWith(tempRoot + path.sep)) {
      throw new Error(`Path escapes tempRoot: ${rawPath}`)
    }
    return resolved
  }

  /** 檔案監看事件（notify 的 EventKind 形狀）；fsWatch 關閉時不送。 */
  const notifyFsChange = (paths: string[], type: unknown) => {
    if (!options.fsWatch) return
    void page.evaluate(
      ({ changed, kind }: { changed: string[]; kind: unknown }) => {
        const emit = (window as unknown as { __E2E_FS_WATCH_EMIT__?: (paths: string[], type: unknown) => void }).__E2E_FS_WATCH_EMIT__
        emit?.(changed, kind)
      },
      { changed: paths, kind: type }
    ).catch(() => undefined)
  }

  const handleTauriInvoke = async (cmd: string, args: unknown): Promise<unknown> => {
    const payload = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>

    // SQL plugin
    if (cmd === 'plugin:sql|load') {
      const dbName = String(payload.db || 'sqlite:note.db')
      getDb(dbName)
      return dbName
    }
    if (cmd === 'plugin:sql|execute') {
      const db = getDb(String(payload.db || 'sqlite:note.db'))
      return bindAndRun(db, 'execute', String(payload.query || ''), (payload.values as unknown[]) || [])
    }
    if (cmd === 'plugin:sql|select') {
      const db = getDb(String(payload.db || 'sqlite:note.db'))
      return bindAndRun(db, 'select', String(payload.query || ''), (payload.values as unknown[]) || [])
    }
    if (cmd === 'plugin:sql|close') {
      return true
    }
    if (cmd === 'execute_record_transaction') {
      const db = getDb('sqlite:note.db')
      const statements = (payload.statements as SqlTransactionStatement[]) || []
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const item of statements) {
          const [changes] = bindAndRun(db, 'execute', item.sql, item.values || []) as [number, number]
          if (typeof item.expectedRows === 'number' && changes !== item.expectedRows) {
            throw new Error(`Expected ${item.expectedRows} rows for ${item.sql}, got ${changes}`)
          }
        }
        db.exec('COMMIT')
        return null
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }

    // Store plugin
    if (cmd === 'plugin:store|load') {
      const storePath = String(payload.path || 'store.json')
      getStoreMap(storePath)
      let rid = storePathToRid.get(storePath)
      if (!rid) {
        rid = ++nextStoreRid
        storePathToRid.set(storePath, rid)
        storeRidToPath.set(rid, storePath)
      }
      return rid
    }
    if (cmd === 'plugin:store|get_store') {
      const storePath = String(payload.path || 'store.json')
      return storePathToRid.get(storePath) ?? null
    }
    if (cmd === 'plugin:store|get') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      if (!storePath) return [null, false]
      const map = getStoreMap(storePath)
      const key = String(payload.key)
      if (!map.has(key)) return [null, false]
      return [structuredClone(map.get(key)), true]
    }
    if (cmd === 'plugin:store|set') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      if (!storePath) return null
      getStoreMap(storePath).set(String(payload.key), structuredClone(payload.value))
      return null
    }
    if (cmd === 'plugin:store|has') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      return storePath ? getStoreMap(storePath).has(String(payload.key)) : false
    }
    if (cmd === 'plugin:store|delete') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      return storePath ? getStoreMap(storePath).delete(String(payload.key)) : false
    }
    if (cmd === 'plugin:store|clear' || cmd === 'plugin:store|reset') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      if (storePath) getStoreMap(storePath).clear()
      return null
    }
    if (cmd === 'plugin:store|keys') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      return storePath ? [...getStoreMap(storePath).keys()] : []
    }
    if (cmd === 'plugin:store|values') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      return storePath ? [...getStoreMap(storePath).values()] : []
    }
    if (cmd === 'plugin:store|entries') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      return storePath ? [...getStoreMap(storePath).entries()] : []
    }
    if (cmd === 'plugin:store|length') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      return storePath ? getStoreMap(storePath).size : 0
    }
    if (cmd === 'plugin:store|save' || cmd === 'plugin:store|reload') {
      const storePath = storeRidToPath.get(Number(payload.rid))
      if (storePath && cmd === 'plugin:store|save') persistStore(storePath)
      return null
    }

    // FS plugin
    if (cmd === 'plugin:fs|exists') {
      const options = payload.options as { baseDir?: number; dir?: number } | undefined
      const target = resolveFsPath(String(payload.path || ''), options?.baseDir ?? options?.dir)
      return fs.existsSync(target)
    }
    if (cmd === 'plugin:fs|mkdir') {
      const options = payload.options as { baseDir?: number; dir?: number; recursive?: boolean } | undefined
      const target = resolveFsPath(String(payload.path || ''), options?.baseDir ?? options?.dir)
      const existed = fs.existsSync(target)
      fs.mkdirSync(target, { recursive: Boolean(options?.recursive) })
      if (!existed) notifyFsChange([target], { create: { kind: 'folder' } })
      return null
    }
    if (cmd === 'plugin:fs|read_dir') {
      const options = payload.options as { baseDir?: number; dir?: number } | undefined
      const target = resolveFsPath(String(payload.path || ''), options?.baseDir ?? options?.dir)
      const entries = fs.readdirSync(target, { withFileTypes: true })
      return entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymlink: entry.isSymbolicLink(),
      }))
    }
    if (cmd === 'plugin:fs|read_file' || cmd === 'plugin:fs|read_text_file') {
      const options = payload.options as { baseDir?: number; dir?: number } | undefined
      const target = resolveFsPath(String(payload.path || ''), options?.baseDir ?? options?.dir)
      const buf = fs.readFileSync(target)
      return Array.from(buf)
    }
    if (cmd === 'plugin:fs|write_file' || cmd === 'plugin:fs|write_text_file') {
      const writePayload = payload as unknown as SerializedWritePayload
      const target = resolveFsPath(
        writePayload.path,
        writePayload.options?.baseDir ?? writePayload.options?.dir
      )
      const buf = Buffer.from(writePayload.bytesBase64 || '', 'base64')
      const existed = fs.existsSync(target)
      if (writePayload.options?.append) {
        fs.appendFileSync(target, buf)
      } else if (writePayload.options?.createNew) {
        fs.writeFileSync(target, buf, { flag: 'wx' })
      } else {
        fs.writeFileSync(target, buf)
      }
      notifyFsChange([target], existed ? { modify: { kind: 'data', mode: 'content' } } : { create: { kind: 'file' } })
      return null
    }
    if (cmd === 'plugin:fs|remove') {
      const options = payload.options as { baseDir?: number; dir?: number; recursive?: boolean } | undefined
      const target = resolveFsPath(String(payload.path || ''), options?.baseDir ?? options?.dir)
      fs.rmSync(target, { recursive: Boolean(options?.recursive), force: false })
      notifyFsChange([target], { remove: { kind: 'any' } })
      return null
    }
    if (cmd === 'plugin:fs|rename') {
      const options = payload.options as {
        oldPathBaseDir?: number
        newPathBaseDir?: number
        baseDir?: number
      } | undefined
      const oldTarget = resolveFsPath(String(payload.oldPath || ''), options?.oldPathBaseDir ?? options?.baseDir)
      const newTarget = resolveFsPath(String(payload.newPath || ''), options?.newPathBaseDir ?? options?.baseDir)
      fs.mkdirSync(path.dirname(newTarget), { recursive: true })
      fs.renameSync(oldTarget, newTarget)
      notifyFsChange([oldTarget, newTarget], { modify: { kind: 'rename', mode: 'both' } })
      return null
    }
    if (cmd === 'plugin:fs|copy_file') {
      const options = payload.options as {
        fromPathBaseDir?: number
        toPathBaseDir?: number
      } | undefined
      const fromTarget = resolveFsPath(String(payload.fromPath || ''), options?.fromPathBaseDir)
      const toTarget = resolveFsPath(String(payload.toPath || ''), options?.toPathBaseDir)
      fs.mkdirSync(path.dirname(toTarget), { recursive: true })
      const existed = fs.existsSync(toTarget)
      fs.copyFileSync(fromTarget, toTarget)
      notifyFsChange([toTarget], existed ? { modify: { kind: 'data', mode: 'content' } } : { create: { kind: 'file' } })
      return null
    }
    if (cmd === 'plugin:fs|stat' || cmd === 'plugin:fs|lstat') {
      const options = payload.options as { baseDir?: number; dir?: number } | undefined
      const target = resolveFsPath(String(payload.path || ''), options?.baseDir ?? options?.dir)
      const stats = cmd === 'plugin:fs|lstat' ? fs.lstatSync(target) : fs.statSync(target)
      return toFileInfo(stats)
    }
    if (cmd === 'plugin:fs|truncate') {
      const options = payload.options as { baseDir?: number; dir?: number } | undefined
      const target = resolveFsPath(String(payload.path || ''), options?.baseDir ?? options?.dir)
      fs.truncateSync(target, Number(payload.len || 0))
      notifyFsChange([target], { modify: { kind: 'data', mode: 'content' } })
      return null
    }
    if (cmd === 'plugin:fs|size') {
      const target = resolveFsPath(String(payload.path || ''))
      return fs.statSync(target).size
    }
    if (cmd === 'plugin:fs|watch' || cmd === 'plugin:fs|unwatch') {
      return ++nextWatcherRid
    }

    // Path plugin
    if (cmd === 'plugin:path|resolve_directory') {
      return resolveBaseDirRoot(Number(payload.directory))
    }
    if (cmd === 'plugin:path|join') {
      const parts = (payload.paths as string[]) || []
      return path.posix.join(...parts.map(p => p.replace(/\\/g, '/')))
    }
    if (cmd === 'plugin:path|resolve') {
      const parts = (payload.paths as string[]) || []
      return path.posix.resolve(appDataDir, ...parts)
    }
    if (cmd === 'plugin:path|normalize') {
      return path.posix.normalize(String(payload.path || ''))
    }
    if (cmd === 'plugin:path|dirname') {
      return path.posix.dirname(String(payload.path || ''))
    }
    if (cmd === 'plugin:path|extname') {
      return path.posix.extname(String(payload.path || '')).replace(/^\./, '')
    }
    if (cmd === 'plugin:path|basename') {
      return path.posix.basename(String(payload.path || ''), payload.ext ? String(payload.ext) : undefined)
    }
    if (cmd === 'plugin:path|is_absolute') {
      return path.posix.isAbsolute(String(payload.path || ''))
    }

    // AI commands
    if (cmd === 'ai_json_request') {
      const req = payload.request as AiRequestInput
      return await aiHandler(req)
    }
    if (cmd === 'ai_chat_completion_stream') {
      // 瀏覽器端（init script）把 Channel 換掉，只送 request 過來；這裡回傳整串事件，由瀏覽器端依序送進 Channel。
      const request = (payload.request || {}) as { config?: unknown; body?: unknown }
      try {
        return toStreamEvents(await aiHandler({ config: request.config, path: '/chat/completions', method: 'POST', body: request.body }))
      } catch (error) {
        return [{ type: 'error', data: error instanceof Error ? error.message : String(error) }]
      }
    }
    if (cmd === 'cancel_ai_request') {
      return null
    }

    // Local MCP bridge resolution
    if (cmd === 'resolve_local_mcp_request') {
      const body = (payload.body || {}) as { requestId?: string; result?: unknown; error?: unknown }
      if (body.requestId) {
        const pending = pendingMcpRequests.get(body.requestId)
        if (pending) {
          pendingMcpRequests.delete(body.requestId)
          pending.resolve(body.error ? { ok: false, error: body.error } : { ok: true, result: body.result })
        }
      }
      return null
    }
    if (cmd === 'set_local_mcp_ready') {
      localMcpReady = Boolean(payload.ready)
      return null
    }
    if (cmd === 'get_local_mcp_status') {
      return { enabled: true, running: true, port: 43210, ready: true, host: '127.0.0.1' }
    }
    if (cmd === 'get_or_create_local_mcp_connection') {
      return { url: 'http://127.0.0.1:43210/mcp', token: 'e2e-mcp-token', port: 43210 }
    }

    // Boot & platform stubs
    if (
      cmd === 'drain_pending_open_files' ||
      cmd === 'drain_pending_plugin_install_requests' ||
      cmd === 'drain_desktop_screenshot_results' ||
      cmd === 'list_system_fonts' ||
      cmd === 'list_ocr_providers' ||
      cmd === 'list_managed_backups' ||
      cmd === 'plugin:window|get_all_windows' ||
      cmd === 'plugin:window|available_monitors' ||
      cmd === 'plugin:webview|get_all_webviews'
    ) {
      return []
    }
    if (cmd === 'plugin:app|version') return '0.1.0'
    if (cmd === 'plugin:app|name') return 'Almanac Notes'
    if (cmd === 'plugin:app|identifier') return 'com.almanac.notes'
    if (cmd === 'plugin:app|tauri_version') return '2.0.0'
    if (cmd === 'plugin:os|locale') return 'zh-TW'
    if (cmd === 'plugin:os|hostname') return 'e2e-mac'
    if (cmd === 'get_app_storefront_country_code') return 'TW'
    if (cmd === 'calendar_events' || cmd === 'calendar_request_access' || cmd === 'calendar_week') {
      return { access: 'unavailable', events: [] }
    }
    if (cmd === 'create_managed_backup') {
      return { id: 'e2e-backup', path: '', createdAt: Date.now(), size: 0 }
    }
    if (cmd === 'get_web_clipper_status') return { enabled: false, running: false, port: 0 }
    if (cmd === 'get_system_media_permissions') return { screenCapture: 'granted', microphone: 'granted' }
    if (cmd === 'git_version_detect' || cmd === 'git_version_status') {
      return { available: false, enabled: false, clean: true, dirtyFiles: [], head: null }
    }
    if (cmd === 'fuzzy_search') return []
    if (cmd === 'is_developer_tools_open') return false
    if (cmd === 'plugin:window|theme') return 'light'
    if (cmd === 'plugin:window|scale_factor') return 2
    if (cmd === 'plugin:window|is_focused' || cmd === 'plugin:window|is_visible') return true
    if (
      cmd === 'plugin:window|is_maximized' ||
      cmd === 'plugin:window|is_minimized' ||
      cmd === 'plugin:window|is_fullscreen' ||
      cmd === 'plugin:window|is_always_on_top' ||
      cmd === 'plugin:global-shortcut|is_registered'
    ) {
      return false
    }
    if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true
    if (cmd === 'plugin:updater|check') return null
    if (cmd === 'plugin:http|fetch') {
      throw new Error('Network disabled in E2E mock')
    }
    if (
      cmd === 'update_tray_record_toolbar_config' ||
      cmd === 'set_web_clipper_ready' ||
      cmd === 'track_analytics_event' ||
      cmd === 'cleanup_screenshot_cache' ||
      cmd === 'git_version_set_auto_snapshot_context' ||
      cmd === 'eink_lan_configure' ||
      cmd.startsWith('plugin:window|set_') ||
      cmd.startsWith('plugin:global-shortcut|') ||
      cmd.startsWith('plugin:resources|') ||
      cmd.startsWith('plugin:app|')
    ) {
      return null
    }

    unhandledCommands.add(cmd)
    return null
  }

  await page.exposeFunction('__e2eTauriInvoke', async (cmd: string, args: unknown) => {
    return await handleTauriInvoke(cmd, args)
  })

  await page.addInitScript(({ initialOffsetMs }: { initialOffsetMs: number }) => {
    try {
      if (!window.localStorage.getItem('app-language')) {
        window.localStorage.setItem('app-language', 'zh-TW')
      }
      if (!window.localStorage.getItem('almanacUiMode')) {
        window.localStorage.setItem('almanacUiMode', 'v3')
      }
      if (window.localStorage.getItem('__e2e_clock_offset_ms') === null) {
        window.localStorage.setItem('__e2e_clock_offset_ms', String(initialOffsetMs))
      }
    } catch {
      // ignore storage errors
    }

    const OriginalDate = window.Date
    const readClockOffset = () => {
      try {
        const raw = window.localStorage.getItem('__e2e_clock_offset_ms')
        const num = raw ? Number(raw) : 0
        return Number.isFinite(num) ? num : 0
      } catch {
        return 0
      }
    }

    function PatchedDate(...args: unknown[]) {
      if (!new.target) {
        return new OriginalDate(OriginalDate.now() + readClockOffset()).toString()
      }
      if (args.length === 0) {
        return new OriginalDate(OriginalDate.now() + readClockOffset())
      }
      return new (OriginalDate as unknown as new (...a: unknown[]) => Date)(...args)
    }
    PatchedDate.prototype = OriginalDate.prototype
    Object.setPrototypeOf(PatchedDate, OriginalDate)
    PatchedDate.now = () => OriginalDate.now() + readClockOffset()
    PatchedDate.UTC = OriginalDate.UTC
    PatchedDate.parse = OriginalDate.parse
    window.Date = PatchedDate as unknown as DateConstructor

    const callbacks = new Map<number, (data: unknown) => void>()
    const listeners = new Map<string, Set<number>>()
    let nextCbId = 1

    const uint8ToBase64 = (bytes: Uint8Array): string => {
      let binary = ''
      const chunkSize = 0x8000
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize)
        binary += String.fromCharCode(...chunk)
      }
      return window.btoa(binary)
    }

    const runCallback = (id: number, data: unknown) => {
      const cb = callbacks.get(id)
      if (cb) cb(data)
    }

    const registerCallback = (cb?: (data: unknown) => void, once = false): number => {
      const id = nextCbId++
      callbacks.set(id, (data: unknown) => {
        if (once) callbacks.delete(id)
        cb?.(data)
      })
      return id
    }

    const unregisterCallback = (id: number) => {
      callbacks.delete(id)
    }

    const watchers = new Map<number, { channelId: number; paths: string[]; nextIndex: number }>()
    const emitFsWatch = (paths: string[], type: unknown) => {
      for (const watcher of watchers.values()) {
        const watched = paths.filter(changed => watcher.paths.some(root => changed === root || changed.startsWith(`${root.replace(/\/+$/, '')}/`)))
        if (watched.length === 0) continue
        runCallback(watcher.channelId, { index: watcher.nextIndex++, message: { type, paths: watched, attrs: {} } })
      }
    }

    const dispatchEvent = (eventName: string, payload?: unknown) => {
      const set = listeners.get(eventName)
      if (!set) return
      for (const handlerId of [...set]) {
        runCallback(handlerId, { event: eventName, id: handlerId, payload })
      }
    }

    const invokeFn = (window as unknown as {
      __e2eTauriInvoke: (cmd: string, args: unknown) => Promise<unknown>
    }).__e2eTauriInvoke

    const internals: Record<string, unknown> = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
      plugins: {
        path: { sep: '/', delimiter: ':' },
      },
      transformCallback: registerCallback,
      unregisterCallback,
      runCallback,
      callbacks,
      convertFileSrc: (filePath: string, protocol = 'asset') =>
        `${protocol}://localhost/${encodeURIComponent(filePath)}`,
      invoke: async (cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
        if (cmd === 'plugin:event|listen') {
          const eventArgs = (args || {}) as { event: string; handler: number }
          let set = listeners.get(eventArgs.event)
          if (!set) {
            set = new Set<number>()
            listeners.set(eventArgs.event, set)
          }
          set.add(eventArgs.handler)
          return eventArgs.handler
        }
        if (cmd === 'plugin:event|unlisten') {
          const eventArgs = (args || {}) as { event: string; eventId?: number; id?: number }
          const id = eventArgs.eventId ?? eventArgs.id
          const set = listeners.get(eventArgs.event)
          if (set && typeof id === 'number') set.delete(id)
          if (typeof id === 'number') unregisterCallback(id)
          return null
        }
        if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
          const eventArgs = (args || {}) as { event: string; payload?: unknown }
          dispatchEvent(eventArgs.event, eventArgs.payload)
          return null
        }

        if (cmd === 'plugin:fs|watch') {
          // 記下 watcher 的 Channel 與監看路徑；Node 端（fsWatch 開啟時）寫入檔案後呼叫 __E2E_FS_WATCH_EMIT__ 送事件。
          const watchArgs = (args || {}) as { paths?: string[]; onEvent?: { id?: number } }
          const rid = (await invokeFn(cmd, { paths: watchArgs.paths })) as number
          if (typeof watchArgs.onEvent?.id === 'number') {
            watchers.set(rid, { channelId: watchArgs.onEvent.id, paths: watchArgs.paths ?? [], nextIndex: 0 })
          }
          return rid
        }
        if (cmd === 'plugin:fs|unwatch') {
          const unwatchArgs = (args || {}) as { rid?: number }
          if (typeof unwatchArgs.rid === 'number') watchers.delete(unwatchArgs.rid)
          return null
        }

        if (cmd === 'ai_chat_completion_stream') {
          // Channel 物件不能直接傳到 Node 端：先取出 callback id，拿到整串事件後照 Tauri Channel 的格式（index／end）逐一送回。
          const streamArgs = (args || {}) as { request?: unknown; onEvent?: { id?: number } }
          const channelId = streamArgs.onEvent?.id
          const events = (await invokeFn(cmd, { request: streamArgs.request })) as unknown[]
          if (typeof channelId === 'number') {
            events.forEach((message, index) => runCallback(channelId, { index, message }))
            runCallback(channelId, { index: events.length, end: true })
          }
          return null
        }

        if (cmd === 'plugin:fs|write_file' || cmd === 'plugin:fs|write_text_file') {
          const headers = options?.headers || {}
          const decodedPath = decodeURIComponent(headers.path || '')
          const parsedOptions = headers.options ? JSON.parse(headers.options) : undefined
          const bytes =
            args instanceof Uint8Array
              ? args
              : args instanceof ArrayBuffer
                ? new Uint8Array(args)
                : Array.isArray(args)
                  ? Uint8Array.from(args)
                  : new Uint8Array(0)
          return await invokeFn(cmd, {
            path: decodedPath,
            options: parsedOptions,
            bytesBase64: uint8ToBase64(bytes),
          })
        }

        return await invokeFn(cmd, args ?? {})
      },
    }

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: internals,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
      value: {
        unregisterListener: (event: string, id: number) => {
          listeners.get(event)?.delete(id)
          unregisterCallback(id)
        },
      },
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, '__TAURI_OS_PLUGIN_INTERNALS__', {
      value: {
        eol: '\n',
        platform: 'macos',
        version: '15.0.0',
        family: 'unix',
        os_type: 'macos',
        arch: 'aarch64',
        exe_extension: '',
      },
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, '__E2E_FS_WATCH_EMIT__', {
      value: emitFsWatch,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, '__E2E_TAURI_DISPATCH_EVENT__', {
      value: dispatchEvent,
      configurable: true,
      writable: true,
    })
  }, { initialOffsetMs: clockOffsetMs })

  return {
    tempRoot,
    appDataDir,
    vaultDir,
    setAiHandler(handler: AiRequestHandler) {
      aiHandler = handler
    },
    resetAiHandler() {
      aiHandler = createDefaultAiHandler()
    },
    querySql<T extends Record<string, unknown>>(sql: string, values: unknown[] = [], dbName = 'sqlite:note.db'): T[] {
      return bindAndRun(getDb(dbName), 'select', sql, values) as T[]
    },
    execSql(sql: string, values: unknown[] = [], dbName = 'sqlite:note.db') {
      const [changes, lastInsertRowid] = bindAndRun(getDb(dbName), 'execute', sql, values) as [number, number]
      return { changes, lastInsertRowid }
    },
    fileExists(relPath: string, base: 'vault' | 'appData' = 'vault'): boolean {
      const root = base === 'vault' ? vaultDir : appDataDir
      return fs.existsSync(path.resolve(root, relPath))
    },
    readVaultFile(relPath: string): string {
      return fs.readFileSync(path.resolve(vaultDir, relPath), 'utf8')
    },
    writeVaultFile(relPath: string, content: string): void {
      const full = path.resolve(vaultDir, relPath)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content, 'utf8')
    },
    listVaultDir(relPath = ''): string[] {
      const full = path.resolve(vaultDir, relPath)
      if (!fs.existsSync(full)) return []
      return fs.readdirSync(full)
    },
    listVaultFiles(options: { includeHidden?: boolean } = {}): string[] {
      const results: string[] = []
      const walk = (dir: string, prefix: string) => {
        if (!fs.existsSync(dir)) return
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!options.includeHidden && entry.name.startsWith('.')) continue
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
          else if (entry.isFile()) results.push(rel)
        }
      }
      walk(vaultDir, '')
      return results
    },
    setStoreKey(key: string, value: unknown, storePath = 'store.json') {
      getStoreMap(storePath).set(key, structuredClone(value))
      persistStore(storePath)
    },
    getStoreKey<T = unknown>(key: string, storePath = 'store.json'): T | undefined {
      return getStoreMap(storePath).get(key) as T | undefined
    },
    async setClockOffsetMs(targetPage: Page, offsetMs: number) {
      clockOffsetMs = offsetMs
      await targetPage.evaluate((ms: number) => {
        window.localStorage.setItem('__e2e_clock_offset_ms', String(ms))
      }, offsetMs)
    },
    async advanceDays(targetPage: Page, days: number) {
      const nextOffset = clockOffsetMs + days * 24 * 60 * 60 * 1000
      await this.setClockOffsetMs(targetPage, nextOffset)
    },
    async emitEvent(targetPage: Page, event: string, payload?: unknown) {
      await targetPage.evaluate(
        ({ eventName, eventPayload }: { eventName: string; eventPayload: unknown }) => {
          const dispatch = (window as unknown as {
            __E2E_TAURI_DISPATCH_EVENT__?: (name: string, payload?: unknown) => void
          }).__E2E_TAURI_DISPATCH_EVENT__
          dispatch?.(eventName, eventPayload)
        },
        { eventName: event, eventPayload: payload }
      )
    },
    async callLocalMcpTool(
      targetPage: Page,
      toolName: string,
      args: Record<string, unknown>,
      connection: { id?: string; name?: string } = { id: 'e2e-client', name: 'Claude Desktop' }
    ) {
      const requestId = `mcp-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const waitForResult = new Promise<{ ok: boolean; result?: unknown; error?: unknown }>(resolve => {
        pendingMcpRequests.set(requestId, { resolve })
      })
      await this.emitEvent(targetPage, 'local-mcp://request', {
        requestId,
        toolName,
        arguments: args,
        connection,
      })
      return await waitForResult
    },
    isLocalMcpReady() {
      return localMcpReady
    },
    getUnhandledCommands() {
      return [...unhandledCommands]
    },
    dispose() {
      for (const db of dbs.values()) {
        try {
          db.close()
        } catch {
          // ignore close errors
        }
      }
      dbs.clear()
      fs.rmSync(tempRoot, { recursive: true, force: true })
    },
  }
}
