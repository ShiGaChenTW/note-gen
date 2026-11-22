// Fork（almanac ALMNC-57）：資料入口的薄薄一層 I/O——選檔（plugin-dialog）、讀檔（plugin-fs）、寫進資料源表。
// 解析都在純函式（email.ts／meeting.ts），這裡只負責把檔案讀進來、把結果交給 addImportedSources。
import { emailSourceInputs, MBOX_LIMIT, parseEmailFiles } from './email'

export interface ImportFile {
  name: string
  bytes: Uint8Array
  /** 本機路徑（選檔才有；拖進來的檔案沒有）。 */
  path?: string
  /** 檔案修改時間（毫秒）。 */
  modifiedAt?: number
}

export interface ImportSummary {
  /** 認得出來的項目數（去重前）。 */
  total: number
  added: number
  /** 之前匯入過、這次跳過的。 */
  skipped: number
  /** 同一批裡重複的。 */
  duplicates: number
  /** 超過上限沒收的。 */
  dropped: number
  /** 第一則新增的清單列 id（src:<id>），給工作台選取。 */
  firstRowId?: string
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function extensionOf(name: string): string {
  const base = fileNameOf(name).toLowerCase()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : ''
}

/** 打開系統的選檔視窗，讀進選到的檔案；取消就回傳空陣列。extensions 沒給就不限制副檔名。 */
export async function pickImportFiles(options: { filterName?: string, extensions?: string[] } = {}): Promise<ImportFile[]> {
  const [{ open }, fs] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
  const picked = await open({
    multiple: true,
    directory: false,
    ...(options.extensions?.length ? { filters: [{ name: options.filterName ?? '', extensions: options.extensions }] } : {}),
  })
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked]
  const files: ImportFile[] = []
  for (const path of paths) {
    const bytes = await fs.readFile(path)
    const info = await fs.stat(path).catch(() => undefined)
    const modifiedAt = info?.mtime ? new Date(info.mtime).getTime() : undefined
    files.push({ name: fileNameOf(path), bytes, path, ...(modifiedAt ? { modifiedAt } : {}) })
  }
  return files
}

/** 拖進對話框的檔案（瀏覽器 File）→ ImportFile。 */
export async function readDroppedFiles(files: readonly File[]): Promise<ImportFile[]> {
  return Promise.all(files.map(async file => ({
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    ...(file.lastModified ? { modifiedAt: file.lastModified } : {}),
  })))
}

/** Email 匯入（ALMNC-57.1）：.eml／.mbox → 一封信一則資料源；Message-ID 去重；一次最多最新 200 封。 */
export async function importEmailFiles(files: readonly ImportFile[]): Promise<ImportSummary> {
  const batch = parseEmailFiles(files, MBOX_LIMIT)
  const { addImportedSources } = await import('@/lib/workbench/actions')
  const result = await addImportedSources(emailSourceInputs(batch))
  return {
    total: batch.total,
    added: result.added.length,
    skipped: result.skipped,
    duplicates: batch.duplicates,
    dropped: batch.dropped,
    ...(result.added[0] ? { firstRowId: `src:${result.added[0].id}` } : {}),
  }
}
