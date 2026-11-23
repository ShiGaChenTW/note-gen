// Fork（almanac ALMNC-69.1）：身分編號。格式 `類別-YYYYMMDD-HHMMSS-4碼`（UTC），例如 `N-20261110-063015-B3XR`。
// 類別：S 資料源、N 筆記、M MOC、C 章節。時間只代表「進到筆記庫的時間」；4 碼是隨機英數，撞到既有編號就重抽。
// 編號一經產生就不改、刪除後也不回收。規格見 almanac/2026-11-23_proposal_note-type-rules.md 第五節。純函式。

export type IdKind = 'S' | 'N' | 'M' | 'C'
export const ID_KINDS: readonly IdKind[] = ['S', 'N', 'M', 'C']

/** 短碼用的字元：大寫英文字母與數字。 */
export const SHORT_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
export const SHORT_CODE_LENGTH = 4

const ID_PATTERN = /^([SNMC])-(\d{8})-(\d{6})-([A-Z0-9]{4})$/

/** 回傳 [0, 1) 的亂數；測試可以注入固定序列。 */
export type RandomSource = () => number
/** 本機是否已有這個編號（系統索引、或掃描到的檔案）。 */
export type IdExists = (id: string) => boolean | Promise<boolean>

export interface NewIdOptions {
  exists?: IdExists
  random?: RandomSource
  /** 撞號重抽的上限；36^4 ≈ 168 萬種組合，同一秒內撞滿幾乎不可能，超過就丟錯。 */
  maxAttempts?: number
}

function pad(n: number, width = 2) {
  return String(n).padStart(width, '0')
}

/** `YYYYMMDD-HHMMSS`，一律 UTC。 */
export function idStamp(at: Date): string {
  if (Number.isNaN(at.getTime())) throw new Error('編號時間無效')
  const date = `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`
  const time = `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`
  return `${date}-${time}`
}

const cryptoRandom: RandomSource = () => {
  const buffer = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buffer)
  return buffer[0] / 2 ** 32
}

export function shortCode(random: RandomSource = cryptoRandom): string {
  let code = ''
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    const index = Math.min(SHORT_CODE_ALPHABET.length - 1, Math.floor(random() * SHORT_CODE_ALPHABET.length))
    code += SHORT_CODE_ALPHABET[index]
  }
  return code
}

/** 產生新編號；`exists` 回報已存在就重抽短碼（時間部分不變）。 */
export async function newId(kind: IdKind, at: Date, options: NewIdOptions = {}): Promise<string> {
  if (!ID_KINDS.includes(kind)) throw new Error(`未知的編號類別：${kind}`)
  const stamp = idStamp(at)
  const maxAttempts = options.maxAttempts ?? 20
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = `${kind}-${stamp}-${shortCode(options.random)}`
    if (!options.exists || !(await options.exists(id))) return id
  }
  throw new Error(`編號連續撞號 ${maxAttempts} 次，放棄產生`)
}

export function isId(value: unknown, kind?: IdKind): value is string {
  if (typeof value !== 'string') return false
  const match = ID_PATTERN.exec(value)
  return !!match && (!kind || match[1] === kind)
}

export interface ParsedId {
  kind: IdKind
  /** 編號裡的時間（UTC）。 */
  at: Date
  code: string
}

/** 拆開編號；格式不對或日期不存在時回傳 null。 */
export function parseId(value: string): ParsedId | null {
  const match = ID_PATTERN.exec(value)
  if (!match) return null
  const [, kind, date, time, code] = match
  const at = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +time.slice(0, 2), +time.slice(2, 4), +time.slice(4, 6)))
  if (idStamp(at) !== `${date}-${time}`) return null
  return { kind: kind as IdKind, at, code }
}
