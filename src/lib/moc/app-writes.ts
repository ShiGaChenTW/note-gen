// Fork（almanac ALMNC-69.10）：記下 App 自己寫 MOC 檔的事件，讓 Obsidian 手動編輯的比對（reconcile-runtime）分得出
// 「App 寫的」和「Scott 在 App 外改的」。由 lib/daily 的 writeNote／commitNoteWrites 在寫完後呼叫；這裡只做便宜的判斷、
// 不 import 任何重的模組（避免 lib/daily 拉進 MOC 流程），事件由 reconcile-runtime 在下一次比對時取走。
import type { AppWriteEvent } from './reconcile'

const events: AppWriteEvent[] = []
const MAX_EVENTS = 500

/** frontmatter 有 `kind: domain`（MOC）。 */
export function looksLikeMoc(content: string): boolean {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  return Boolean(match && /^kind:\s*["']?domain["']?\s*(?:#.*)?$/im.test(match[1]))
}

/** App 寫完一個檔案：是 MOC（寫入前或寫入後）就記下。before＝null 是新建，undefined 是不知道原文的覆寫。 */
export function noteAppWrite(path: string, before: string | null | undefined, after: string): void {
  if (!looksLikeMoc(after) && !(typeof before === 'string' && looksLikeMoc(before))) return
  events.push({ path, before, after })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

/** 取走目前累積的事件（依發生順序）。 */
export function takeAppWrites(): AppWriteEvent[] {
  return events.splice(0, events.length)
}
