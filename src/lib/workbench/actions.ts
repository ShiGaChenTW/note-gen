// Fork（almanac ALMNC-54.8）：工作台的寫入動作。每個動作都回頭改來源（提案、筆記庫任務、資料源表、筆記），
// 清單由投影自然更新；能復原的回傳 undo（給審核分頁的 Z）。需要 Tauri 的模組一律動態載入，測試時可以 mock。
import { acceptDecision, rejectDecision } from '@/lib/decide/actions'
import type { DecideItem } from '@/lib/decide/project'
import { LEGACY_NOTE_KIND, latestVersions, type Source } from '@/lib/v3-model/source'
import { legacyProgress, type LegacyRunSummary } from '@/lib/migration/legacy'
import useCollectStore from '@/stores/collect'
import useWorkbenchStore from '@/stores/workbench'
import type { WorkbenchCard, TaskLike } from './cards'
import { applyStructuralOp, handwrittenNote, noteFileName, type DeskMaterial, type NoteIo, type StructuralOp } from './desk'
import { bridgeInput, planHandToCommander, type SourceListRow } from './sources-tab'
import { ingestSource, judgeSource, newSourceType, type SourceJudgement } from './judgement'
import { dailyEntrySource, recordTextSource, routeAutoSource, voiceMemoSource, type AutoRouteResult, type AutoSourceInput } from './auto-route'

export type Undo = (() => Promise<unknown>) | undefined

/** 叫指揮官的分析佇列跑一輪（R2：自己寫的、系統產生的；R1：Scott 選「處理」後）。 */
export async function kickCommander(): Promise<void> {
  try {
    const { commanderQueue } = await import('@/lib/commander/default-deps')
    void (await commanderQueue()).kick().catch(error => console.error('[workbench] commander queue failed:', error))
  } catch (error) {
    console.warn('[workbench] commander queue unavailable:', error)
  }
}

/** 是不是在桌面 App 裡（有 Tauri）；瀏覽器預覽讀不到資料庫是正常的，不算讀取失敗。 */
async function inDesktopApp(): Promise<boolean> {
  try {
    return (await import('@tauri-apps/api/core')).isTauri()
  } catch {
    return false
  }
}

/**
 * 重讀資料源表（只留每條版本鏈最新一版）與產出數；沒有 Tauri 時維持原樣。
 * Fork（almanac ALMNC-56.7，A06）：桌面 App 裡讀失敗時記下 sourcesError，資料源分頁顯示錯誤狀態與「重試」。
 */
export async function refreshSources(): Promise<void> {
  try {
    const db = await import('@/db/v3-sources')
    // Fork（almanac ALMNC-54.14）：舊筆記不進資料源清單（另外合成批次卡），見 refreshLegacy。
    // Fork（almanac ALMNC-54.1，AC#6）：封存的不採用資料源仍留在清單裡（「不採用」篩選），所以一起讀。
    const [all, counts] = await Promise.all([db.listSources({ limit: 500, excludeKind: LEGACY_NOTE_KIND, includeArchived: true }), db.countOutputsBySource()])
    useWorkbenchStore.getState().setSources(latestVersions(all), counts)
  } catch (error) {
    if (await inDesktopApp()) {
      console.error('[workbench] sources failed to load:', error)
      useWorkbenchStore.getState().setSourcesError(true)
    } else {
      console.debug('[workbench] sources unavailable:', error)
    }
  }
  await refreshLegacy()
  // Fork（almanac ALMNC-54.10）：初步判斷另外讀；讀不到卡片照樣出現（AC#4）。
  try {
    const { listSourceJudgements } = await import('@/db/v3-source-judgements')
    useWorkbenchStore.getState().setJudgements(await listSourceJudgements())
  } catch (error) {
    console.debug('[workbench] judgements unavailable:', error)
  }
}

/** Fork（almanac ALMNC-54.14）：重讀舊筆記批次的現況（已標記幾則、處理了幾則、還沒整理好的包、是不是正在跑）。 */
export async function refreshLegacy(): Promise<void> {
  try {
    const [db, packsDb, runtime] = await Promise.all([import('@/db/v3-sources'), import('@/db/v3-legacy-packs'), import('@/lib/migration/runtime')])
    const [legacy, packs] = await Promise.all([db.listLegacyNoteSources(), packsDb.listOpenLegacyPacks()])
    const { total, processed } = legacyProgress(legacy)
    useWorkbenchStore.getState().setLegacy({
      markedIds: new Set(legacy.map(source => source.id)),
      total,
      processed,
      firstMarkedAt: legacy.length ? Math.min(...legacy.map(source => source.createdAt)) : undefined,
      packs,
      ...runtime.legacyRunning(),
    })
  } catch (error) {
    console.debug('[workbench] legacy notes unavailable:', error)
  }
}

/** Fork（almanac ALMNC-54.14）：批次卡「開始處理／繼續處理」——標記還沒標的舊筆記，再分批交給指揮官；跑的時候每批做完就重讀。 */
export async function startLegacy(unmarked: ReadonlyArray<{ path: string, mtime?: number }>): Promise<LegacyRunSummary> {
  const runtime = await import('@/lib/migration/runtime')
  const stop = runtime.onLegacyProgress(() => void refreshLegacy())
  try {
    return await runtime.startLegacyMigration(unmarked)
  } finally {
    stop()
    await refreshSources()
  }
}

/** Fork（almanac ALMNC-54.14）：批次卡「暫停」：這一則做完就停。 */
export async function pauseLegacy(): Promise<void> {
  const runtime = await import('@/lib/migration/runtime')
  runtime.pauseLegacyMigration()
  await refreshLegacy()
}

/** Fork（almanac ALMNC-54.14）：那一包「整理好了」：記下已整理（不刪、不動筆記檔），下一包才會出現；可以復原。 */
export async function resolveLegacyPack(packId: string): Promise<Undo> {
  const packsDb = await import('@/db/v3-legacy-packs')
  await packsDb.setLegacyPackResolved(packId, true)
  await refreshLegacy()
  return async () => {
    await packsDb.setLegacyPackResolved(packId, false)
    await refreshLegacy()
  }
}

/**
 * Fork（almanac ALMNC-54.10）：替一則等你決定的資料源做初步判斷（R1），存進 source_judgements 後重讀清單。
 * 本機模型（ollama）沒開、抓不到網頁都不會丟錯：沒有判斷、或標成擷取失敗。
 */
export async function requestJudgement(source: Pick<Source, 'id' | 'kind' | 'content' | 'origin'>, options: { refresh?: boolean } = {}): Promise<SourceJudgement> {
  const [judgements, { defaultLocalModel }] = await Promise.all([import('@/db/v3-source-judgements'), import('@/lib/local-model/default')])
  const model = await defaultLocalModel().catch(() => undefined)
  const previous = await judgements.getSourceJudgement(source.id).catch(() => undefined)
  const result = await judgeSource(source, {
    model,
    previous,
    fetchPage: async url => {
      const { capturePublicWebPage } = await import('@/lib/web-capture/service')
      const page = await capturePublicWebPage(url)
      if (page.status === 'failed' || page.status === 'blocked') throw new Error(page.errorMessage || page.errorCode || page.status)
      return [page.title, page.contentMarkdown || page.plainText].filter(Boolean).join('\n\n')
    },
    save: judgements.saveSourceJudgement,
  })
  if (options.refresh !== false) await refreshSources()
  return result
}

// —— 審核：卡片動作 ——

export async function acceptCard(card: WorkbenchCard): Promise<Undo> {
  if (card.decide) {
    const outcome = await acceptDecision(card.decide)
    return outcome.undo
  }
  if (card.kind === 'domain' && card.domainProposalId) {
    const { acceptDomainCard } = await import('./domain-cards')
    await acceptDomainCard(card.domainProposalId)
    return undefined
  }
  return undefined
}

function collectRefs(item: DecideItem): Array<{ itemId: string, proposalId: string }> {
  return [item.ref, ...item.duplicates].flatMap(ref => ref.source === 'collect' ? [{ itemId: ref.itemId, proposalId: ref.proposalId }] : [])
}

/** 放棄。收集來的提案可以復原（改回等你決定）；背景任務草稿、工作結果放棄後就不能復原。 */
export async function dropCard(card: WorkbenchCard): Promise<Undo> {
  if (card.decide) {
    const item = card.decide
    await rejectDecision(item)
    const refs = collectRefs(item)
    if (refs.length !== 1 + item.duplicates.length) return undefined
    return async () => {
      for (const ref of refs) useCollectStore.getState().restore(ref.itemId, ref.proposalId)
    }
  }
  if (card.kind === 'domain' && card.domainProposalId) {
    const id = card.domainProposalId
    useWorkbenchStore.getState().dismiss(id)
    return async () => useWorkbenchStore.getState().undismiss(id)
  }
  return undefined
}

async function todayActions() {
  return import('@/lib/today/today-actions')
}

export async function completeTask(task: TaskLike): Promise<Undo> {
  const { setTaskChecked, undoWrites } = await todayActions()
  const record = await setTaskChecked(task, true)
  return record.writes.length ? async () => undoWrites(record) : undefined
}

/** 排時間：排進今天的某個時間（同今天頁的 scheduleTask）。 */
export async function scheduleCardTask(task: TaskLike, time: string): Promise<Undo> {
  const { scheduleTask, undoWrites } = await todayActions()
  const record = await scheduleTask(task, time)
  return record.writes.length ? async () => undoWrites(record) : undefined
}

/** 確認類卡片「仍然有效」：把 lastConfirmed 改成今天。 */
export async function confirmStillValid(path: string, today: string): Promise<Undo> {
  const [{ readNote, writeNote }, { writeV3NoteFields }] = await Promise.all([import('@/lib/daily/note-io'), import('@/lib/v3-model/note')])
  const raw = await readNote(path)
  if (raw === null) throw new Error(`note not found: ${path}`)
  await writeNote(path, writeV3NoteFields(raw, { lastConfirmed: today }))
  return async () => writeNote(path, raw)
}

/**
 * 確認類卡片「交給指揮官」：指揮官重新確認（比對同領域的筆記，查得到外部資料就一起看），結果一律變成提案——
 * 有問題就是清理提案，沒問題就是「仍然有效」。Fork（almanac ALMNC-54.12）：原本建一則系統資料源，改成直接重新確認。
 */
export async function confirmToCommander(path: string): Promise<Undo> {
  const { recheckFromCard } = await import('@/lib/cleanup/runtime')
  void recheckFromCard(path).catch(error => console.error('[workbench] recheck failed:', error))
  return undefined
}

// —— 資料源 ——

/**
 * 照建議處理／處理（R1）：等你決定 → 待分析，交給指揮官。已送出就不能復原。
 * Fork（almanac ALMNC-54.10）：followSuggestion 時（照建議處理）先記下來，指揮官分析時會拿到初步判斷當提示；「處理」不帶提示。
 */
export async function processSource(sourceId: string, options: { followSuggestion?: boolean } = {}): Promise<void> {
  const db = await import('@/db/v3-sources')
  try {
    const { setFollowSuggestion } = await import('@/db/v3-source-judgements')
    await setFollowSuggestion(sourceId, Boolean(options.followSuggestion))
  } catch (error) {
    console.debug('[workbench] judgement flag skipped:', error)
  }
  await db.setSourceStatus(sourceId, 'pending_analysis')
  await refreshSources()
  await kickCommander()
}

/** Fork（almanac ALMNC-54.10）：擷取失敗的卡片「重試」：再抓一次、再判斷一次。 */
export async function retryCapture(sourceId: string): Promise<SourceJudgement | undefined> {
  const db = await import('@/db/v3-sources')
  const source = await db.getSource(sourceId)
  if (!source || source.status !== 'awaiting_decision') return undefined
  return requestJudgement(source)
}

/** Fork（almanac ALMNC-54.10）：擷取失敗的卡片「刪除」：只刪還沒送出、沒有產出的外部擷取（連同判斷）。 */
export async function deleteFailedSource(sourceId: string): Promise<void> {
  const [db, judgements] = await Promise.all([import('@/db/v3-sources'), import('@/db/v3-source-judgements')])
  await db.deleteUnsentSource(sourceId)
  await judgements.deleteSourceJudgement(sourceId).catch(() => undefined)
  await refreshSources()
}

/** 不採用；可以改回等你決定（只限還沒送出的）。 */
export async function rejectSource(sourceId: string): Promise<Undo> {
  const db = await import('@/db/v3-sources')
  const source = await db.setSourceStatus(sourceId, 'rejected')
  await refreshSources()
  return source.lockedAt === undefined ? async () => restoreSource(sourceId) : undefined
}

export async function restoreSource(sourceId: string): Promise<void> {
  const db = await import('@/db/v3-sources')
  await db.setSourceStatus(sourceId, 'awaiting_decision')
  await refreshSources()
}

async function bridge(row: SourceListRow, content?: string): Promise<Source> {
  const db = await import('@/db/v3-sources')
  const input = bridgeInput(row, content)
  const existing = await db.getSource(input.id)
  if (existing) return existing
  return db.addSource({ ...input, collector: 'scott' })
}

/** 「交給 Mia 整理」：勾選的資料源一起交給指揮官；回傳交出幾則、其中幾則是重新整理。 */
export async function handToCommander(rows: readonly SourceListRow[]): Promise<{ count: number, reorganise: number }> {
  const db = await import('@/db/v3-sources')
  const { steps, reorganise } = planHandToCommander(rows)
  let count = 0
  for (const step of steps) {
    try {
      if (step.op === 'submit') await db.setSourceStatus(step.sourceId, 'pending_analysis')
      else if (step.op === 'reanalyze') await db.editSource(step.sourceId, step.content)
      else if (step.op === 'bridge') {
        const source = await bridge(step.row)
        if (source.status === 'awaiting_decision') await db.setSourceStatus(source.id, 'pending_analysis')
      }
      if (step.op === 'kick' || step.op === 'submit') useWorkbenchStore.getState().markEdited(step.sourceId, false)
      count++
    } catch (error) {
      console.error('[workbench] hand to commander failed:', error)
    }
  }
  await refreshSources()
  if (count) await kickCommander()
  return { count, reorganise }
}

/**
 * 編輯器存檔。V3 資料源：還沒送出的原地改，已送出的另存新版本（舊版保留）；
 * 舊記錄、舊收集項目：建立一則固定 id 的資料源（舊資料原封不動）。改過的先不送，等 Scott 按「送給 Mia 更新」。
 */
export async function saveSourceEdit(row: SourceListRow, content: string): Promise<{ rowId: string, version: number, versioned: boolean }> {
  const db = await import('@/db/v3-sources')
  const store = useWorkbenchStore.getState()
  if (row.origin === 'source' && row.sourceId) {
    const result = await db.editSource(row.sourceId, content)
    await refreshSources()
    if (result.kind === 'versioned') {
      store.markEdited(row.sourceId, false)
      store.markEdited(result.source.id, true)
      return { rowId: `src:${result.source.id}`, version: result.source.version, versioned: true }
    }
    return { rowId: row.id, version: result.source.version, versioned: false }
  }
  const source = await db.getSource(bridgeInput(row).id)
  if (source) {
    const result = await db.editSource(source.id, content)
    if (result.source.status === 'pending_analysis') store.markEdited(result.source.id, true)
    await refreshSources()
    return { rowId: `src:${result.source.id}`, version: result.source.version, versioned: result.kind === 'versioned' }
  }
  const created = await bridge(row, content)
  if (created.status === 'pending_analysis') store.markEdited(created.id, true)
  await refreshSources()
  return { rowId: `src:${created.id}`, version: created.version, versioned: true }
}

/** 「送給 Mia 更新」／「送給 Mia 分析」：叫佇列跑。 */
export async function sendToCommander(sourceId: string): Promise<void> {
  useWorkbenchStore.getState().markEdited(sourceId, false)
  await kickCommander()
  await refreshSources()
}

// —— 新增資料源（側欄 N → 記錄對話框） ——

export interface NewSourceRequest {
  type: 'text' | 'link' | 'todo' | 'prompt-draft'
  content: string
  origin?: string
  /** Fork（almanac ALMNC-54.10）：對話框裡貼上的字數；大部分是貼上的文字算外部擷取。 */
  pastedChars?: number
}

/**
 * 連結、貼上的內容是外部擷取（等你決定，背景做初步判斷，R1）；自己打的字、待辦、Prompt 素材是自己寫的（直接交給指揮官，R2）。
 * 回傳清單列 id。
 */
export async function addNewSource(request: NewSourceRequest): Promise<string> {
  const db = await import('@/db/v3-sources')
  const sourceType = newSourceType(request)
  const kind = request.type === 'prompt-draft' ? 'prompt' : request.type
  const source = await ingestSource({
    sourceType,
    kind,
    content: request.content,
    origin: request.origin || (request.type === 'link' ? request.content : undefined),
    collector: 'scott',
  }, {
    add: input => db.addSource(input),
    kick: kickCommander,
    judge: requestJudgement,
  })
  await refreshSources()
  return `src:${source.id}`
}

/**
 * Fork（almanac ALMNC-54.10，R2）：自己寫的、系統產生的資料源登錄後自動交給指揮官（不經過「等你決定」）。
 * 已經登錄過同一個 id 就什麼都不做（不重複叫佇列）。
 */
export async function submitAutoSource(input: AutoSourceInput): Promise<AutoRouteResult> {
  const db = await import('@/db/v3-sources')
  const result = await routeAutoSource(input, {
    addIfAbsent: ({ sourceType, ...rest }) => db.addSourceIfAbsent({ ...rest, sourceType }),
    kick: kickCommander,
  })
  if (result.source) await refreshSources()
  return result
}

/** 這些登錄只在 V3、而且是附帶動作：失敗只記一筆，不影響原本的存檔。 */
async function autoRegister(input: AutoSourceInput | undefined): Promise<void> {
  if (!input) return
  const { isUiV3 } = await import('@/lib/fork-ui')
  if (!isUiV3()) return
  try {
    await submitAutoSource(input)
  } catch (error) {
    console.warn('[workbench] auto source failed:', error)
  }
}

/** 語音速記存好後（錄音或選音訊檔轉出逐字稿）自動交給指揮官。 */
export function registerVoiceMemo(memo: { markId: number, transcript: string, audioPath?: string }): Promise<void> {
  return autoRegister(voiceMemoSource(memo))
}

/** 今天頁快速新增寫進每日筆記的一行（每日筆記條目）自動交給指揮官。 */
export function registerDailyEntry(entry: { path: string, text: string, at?: number }): Promise<void> {
  return autoRegister(dailyEntrySource({ ...entry, at: entry.at ?? Date.now() }))
}

/** 「記錄」對話框（V3）存成記錄的隨手記／待辦／Prompt 素材：自己打的自動交給指揮官，貼上的不收（R1）。 */
export function registerRecordText(record: Parameters<typeof recordTextSource>[0]): Promise<void> {
  return autoRegister(recordTextSource(record))
}

/** Fork（almanac ALMNC-57）：匯入的一則資料源。id 由原始識別決定（src_email:<Message-ID>、src_rss:<guid>…），重複匯入會跳過。 */
export interface ImportedSourceInput {
  id: string
  kind: 'email' | 'rss' | 'meeting'
  content: string
  origin?: string
}

export interface ImportedSourcesResult {
  /** 這次新增的資料源（照傳進來的順序）。 */
  added: Source[]
  /** 已經匯入過、這次跳過的數量。 */
  skipped: number
}

/**
 * Fork（almanac ALMNC-57）：Email、RSS、會議逐字稿匯入的資料源都是外部擷取（R1）：存成等你決定，背景做初步判斷。
 * 一次可能好幾百則，所以初步判斷一則一則排隊做（不同時叫本機模型好幾百次），全部判斷完再重讀一次清單。
 * 傳進來的順序就是清單上的順序（第一則最上面）：收集時間依序差 1 毫秒。
 */
export async function addImportedSources(inputs: readonly ImportedSourceInput[], now = Date.now()): Promise<ImportedSourcesResult> {
  const db = await import('@/db/v3-sources')
  const added: Source[] = []
  let skipped = 0
  for (const [index, input] of inputs.entries()) {
    const source = await db.addSourceIfAbsent({
      id: input.id,
      sourceType: 'external',
      kind: input.kind,
      content: input.content,
      origin: input.origin,
      collector: 'scott',
      collectedAt: now - index,
    }, now)
    if (source) added.push(source)
    else skipped++
  }
  await refreshSources()
  if (added.length) {
    void (async () => {
      for (const source of added) {
        await requestJudgement(source, { refresh: false }).catch(error => console.warn('[judgement] failed:', error))
      }
      await refreshSources()
    })()
  }
  return { added, skipped }
}

// —— 檯面 ——

/** 開一段標成「處理」的對話（指揮官參與），給檯面的協助欄。 */
export async function startProcessConversation(): Promise<number> {
  const [{ default: useChatStore }, { default: useThreadsStore }] = await Promise.all([import('@/stores/chat'), import('@/stores/threads')])
  const id = await useChatStore.getState().createConversation()
  const created = useChatStore.getState().conversations.find(entry => entry.id === id) ?? { id, syncId: '' }
  await useThreadsStore.getState().setTag(created, 'process')
  return id
}

export async function defaultNoteIo(): Promise<NoteIo> {
  const [{ readNote, writeNote }, { moveFileTool }, sources] = await Promise.all([
    import('@/lib/daily/note-io'),
    import('@/lib/agent/tools/note-tools'),
    import('@/db/v3-sources'),
  ])
  return {
    read: readNote,
    write: writeNote,
    move: async (path, folder) => {
      const result = await moveFileTool.execute({ filePath: path, targetFolderPath: folder })
      if (!result.success) throw new Error(result.error || 'move failed')
      const to = (result.data as { newPath?: string } | undefined)?.newPath ?? (folder ? `${folder}/${path.split('/').pop()}` : path.split('/').pop()!)
      await sources.renameNoteOutputs(path, to).catch(() => undefined)
      return to
    },
  }
}

export async function runDeskOp(op: StructuralOp): Promise<{ path?: string, undo?: () => Promise<void> }> {
  return applyStructuralOp(op, await defaultNoteIo())
}

/** 工作稿存成筆記（直接生效，標上「親手寫的」），存到收件資料夾；資料源連到這則筆記。回傳路徑。 */
export async function saveDeskNote(draft: { title: string, body: string }, materials: readonly DeskMaterial[], handTag: string, fallbackName: string): Promise<string> {
  const [{ writeNote, noteExists }, { default: useDailySettingsStore }, sources] = await Promise.all([
    import('@/lib/daily/note-io'),
    import('@/stores/daily-settings'),
    import('@/db/v3-sources'),
  ])
  await useDailySettingsStore.getState().initSettings()
  const folder = useDailySettingsStore.getState().inboxFolder.replace(/^\/+|\/+$/g, '')
  const name = noteFileName(draft.title, fallbackName)
  let path = folder ? `${folder}/${name}` : name
  for (let n = 2; await noteExists(path); n++) path = path.replace(/( \d+)?\.md$/, ` ${n}.md`)
  await writeNote(path, handwrittenNote(draft, materials, handTag))
  for (const material of materials) {
    if (material.sourceId) await sources.addSourceOutput(material.sourceId, 'note', path).catch(() => undefined)
  }
  // Fork（almanac ALMNC-54.12）：親手寫的筆記存檔後也比對衝突（發現時機 2）；背景執行，不擋存檔。
  void import('@/lib/cleanup/runtime').then(module => module.checkAfterWrite(path, 'handwritten')).catch(() => undefined)
  return path
}
