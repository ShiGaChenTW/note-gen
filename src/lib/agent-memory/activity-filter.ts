// Fork（almanac ALMNC-69.2）：活動紀錄依發起的夥伴篩選（11/22 決定）。
// 接受的提案在角色欄記發起的夥伴（lib/proposals/accepted-activity.ts），所以「誰發起」就是 actorId／actorRole。
// 純函式：從目前載入的紀錄列出出現過的發起者，再照選的發起者篩選。
import type { ActivityActorRole, ActivityEntry } from './activity'

export interface ActivityActor {
  actorId: string
  actorRole: ActivityActorRole
}

/** 紀錄裡出現過的發起者（依第一次出現的順序，也就是最新的在前），同一個 actorId 只列一次。 */
export function activityActors(entries: readonly Pick<ActivityEntry, 'actorId' | 'actorRole'>[]): ActivityActor[] {
  const seen = new Map<string, ActivityActor>()
  for (const entry of entries) {
    if (!seen.has(entry.actorId)) seen.set(entry.actorId, { actorId: entry.actorId, actorRole: entry.actorRole })
  }
  return [...seen.values()]
}

/** 照發起者篩選；actorId 空字串是全部。 */
export function filterActivityByActor<T extends Pick<ActivityEntry, 'actorId'>>(entries: readonly T[], actorId: string): T[] {
  return actorId ? entries.filter(entry => entry.actorId === actorId) : [...entries]
}
