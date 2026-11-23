// Fork（almanac ALMNC-71）：掃描補號與斷鏈修復（69.5）的「系統修復」活動紀錄。純函式。
// toast 會消失，所以每次修復另外留一筆可回查的紀錄（actor＝system、動作 repaired、來源 system）：
// - 對象連結：被修的檔案（note:<路徑>）；時鐘提醒沒有檔案時用 id:<編號> 或 system:clock。
// - 修復種類與要翻譯的參數放在來源 ref（id-scan:<種類>?參數），畫面依語言顯示（parseRepairRef）。
// - 備註（最多 60 字）只放不分語言的細節：編號、舊編號 → 新編號、檔名。
// 時鐘與大量補號的提醒每次掃描都會再算出來，用 onceKeys 在同一次開 App 期間只記一次（和 toast 的作法一樣）。
import { charCount, ACTIVITY_NOTE_MAX, SYSTEM_ACTOR_ID, type ActivityEntryInput } from '@/lib/agent-memory/activity'
import { lastNameOf } from './id-index'
import type { ClockReason, ScanAction } from './id-scan'

export const REPAIR_KINDS = ['assign', 'renumber', 'restore', 'rename', 'relink', 'clock', 'held'] as const
export type RepairKind = typeof REPAIR_KINDS[number]

const REF_PREFIX = 'id-scan:'

export interface RepairRef {
  kind: RepairKind
  values: Record<string, string>
}

export function repairRef(kind: RepairKind, values: Record<string, string | number> = {}): string {
  const params = new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]))
  const query = params.toString()
  return `${REF_PREFIX}${kind}${query ? `?${query}` : ''}`
}

/** 來源 ref → 修復種類與參數；不是系統修復的 ref 回傳 null。 */
export function parseRepairRef(ref: string): RepairRef | null {
  if (!ref.startsWith(REF_PREFIX)) return null
  const rest = ref.slice(REF_PREFIX.length)
  const mark = rest.indexOf('?')
  const kind = mark < 0 ? rest : rest.slice(0, mark)
  const query = mark < 0 ? '' : rest.slice(mark + 1)
  if (!REPAIR_KINDS.some(item => item === kind)) return null
  return { kind: kind as RepairKind, values: Object.fromEntries(new URLSearchParams(query)) }
}

function truncate(text: string): string {
  if (charCount(text) <= ACTIVITY_NOTE_MAX) return text
  return `${[...text].slice(0, ACTIVITY_NOTE_MAX - 1).join('')}…`
}

const noteLink = (path: string) => `note:${encodeURI(path)}`

function entry(kind: RepairKind, targetLink: string, note: string, values: Record<string, string | number> = {}): ActivityEntryInput {
  return {
    actorId: SYSTEM_ACTOR_ID,
    actorRole: 'system',
    action: 'repaired',
    targetLink,
    source: { kind: 'system', ref: repairRef(kind, values) },
    note: truncate(note),
  }
}

const withHeading = (id: string, heading?: string) => heading ? `${id} · ${heading}` : id

function clockTarget(action: Extract<ScanAction, { type: 'clock' }>): string {
  if (action.path) return noteLink(action.path)
  if (action.id) return `id:${action.id}`
  return 'system:clock'
}

function clockNote(action: Extract<ScanAction, { type: 'clock' }>): string {
  if (action.reason === 'before-source' && action.id && action.sourceId) return `${action.id} < ${action.sourceId}`
  return action.id ?? ''
}

const clockKey = (action: Extract<ScanAction, { type: 'clock' }>, reason: ClockReason) =>
  `clock:${reason}:${action.id ?? ''}:${action.path ?? ''}:${action.sourceId ?? ''}`

/**
 * 一次掃描真正生效的動作（runIdScan 已拿掉沒寫成的）→ 要寫的系統修復紀錄。
 * seen：這次開 App 已經記過的時鐘／大量補號鍵；回傳的 onceKeys 要加進去。
 */
export function repairActivityEntries(
  actions: readonly ScanAction[],
  seen: ReadonlySet<string> = new Set(),
): { entries: ActivityEntryInput[], onceKeys: string[] } {
  const entries: ActivityEntryInput[] = []
  const onceKeys: string[] = []
  const once = (key: string) => {
    if (seen.has(key) || onceKeys.includes(key)) return false
    onceKeys.push(key)
    return true
  }
  const renamedNames = actions.flatMap(action => action.type === 'rename' ? [lastNameOf(action.to)] : [])
  for (const action of actions) {
    switch (action.type) {
      case 'assign':
        entries.push(entry('assign', noteLink(action.path), withHeading(action.id, action.heading), { kind: action.kind }))
        break
      case 'renumber':
        entries.push(entry('renumber', noteLink(action.path), `${action.oldId} → ${action.id}`, { kept: lastNameOf(action.keptPath) }))
        break
      case 'restore':
        entries.push(entry('restore', noteLink(action.path), withHeading(action.id, action.heading)))
        break
      case 'rename':
        entries.push(entry('rename', noteLink(action.to), action.id, { from: action.from }))
        break
      case 'relink':
        entries.push(entry('relink', noteLink(action.path), renamedNames.map(name => `→ ${name}`).join('、'), { links: action.count }))
        break
      case 'clock':
        if (once(clockKey(action, action.reason))) entries.push(entry('clock', clockTarget(action), clockNote(action), { reason: action.reason }))
        break
      case 'held': {
        const paths = [...action.paths].sort()
        if (paths.length && once(`held:${paths.join('|')}`)) {
          entries.push(entry('held', noteLink(paths[0]), paths.map(lastNameOf).join('、'), { count: paths.length }))
        }
        break
      }
    }
  }
  return { entries, onceKeys }
}
