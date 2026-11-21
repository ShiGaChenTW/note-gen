// Fork（almanac ALMNC-47）：真的送出後才更新「已送」狀態。
// 只能在區網下載成功（ALMNC-50）或立即推送成功（ALMNC-52）後呼叫；組裝（assembleBriefing／buildBriefing）從不呼叫。
// 一天內重複呼叫沒關係：文章已送就不再動、釘選的第一次送出日只記一次、回顧卡今天出現過仍算今天，重算仍是同一份。
import { persistEink, readEinkKeys } from '@/lib/eink/storage'
import { EINK_BRIEFING_LOG_KEY, applyBriefingSent, normalizeBriefingLog, type BriefingLog } from './state'
import type { Briefing } from './types'

export interface CommitDeps {
  markArticlesSent: (urls: readonly string[], at: number) => Promise<void>
  markPinsSent: (paths: readonly string[], at: number) => Promise<void>
  readLog: () => Promise<BriefingLog>
  writeLog: (log: BriefingLog) => Promise<void>
}

export async function readBriefingLog(): Promise<BriefingLog> {
  try {
    const saved = await readEinkKeys([EINK_BRIEFING_LOG_KEY])
    return normalizeBriefingLog(saved[EINK_BRIEFING_LOG_KEY])
  } catch {
    return normalizeBriefingLog(null)
  }
}

const defaultDeps: CommitDeps = {
  markArticlesSent: async (urls, at) => {
    const { default: useReadLaterStore } = await import('@/stores/read-later')
    await useReadLaterStore.getState().markSent(urls, at)
  },
  markPinsSent: async (paths, at) => {
    const { default: useEinkStore } = await import('@/stores/eink')
    await useEinkStore.getState().markPinsSent(paths, at)
  },
  readLog: readBriefingLog,
  writeLog: log => persistEink(EINK_BRIEFING_LOG_KEY, log),
}

/** 依 briefing.sent 更新：文章移到已送電子紙、釘選記送出日、回顧卡記最後出現時間、記下送出的知識報告期別。 */
export async function commitSent(briefing: Briefing, at: number = Date.now(), deps: CommitDeps = defaultDeps): Promise<void> {
  const { sent } = briefing
  await deps.markArticlesSent(sent.articleUrls, at)
  await deps.markPinsSent(sent.pinPaths, at)
  if (sent.reviewPaths.length > 0 || sent.reportPeriod) {
    await deps.writeLog(applyBriefingSent(await deps.readLog(), sent, at))
  }
}
