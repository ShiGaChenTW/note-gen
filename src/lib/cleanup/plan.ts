// Fork（almanac ALMNC-54.12）：指揮官接手專家的觀察，依衝突類型決定處理方式，做成清理提案。
//   過時：只改事實細節 → 修改（原筆記留修改紀錄）；結論改變 → 取代（新筆記＋舊筆記標「已被取代」）
//   矛盾 → 待查證（兩則都標，列進領域的「矛盾與未解問題」）；情境不同 → 補情境（兩則都保留，各補適用條件）
//   重複 → 合併（合成一則，來源全部保留）；已經沒用 → 封存
// 原則：不偷偷覆寫，舊內容一律留下紀錄。同一個領域的觀察打包成一則提案（工作台標「知識」、動詞「整理」）；
// 只有一項時就是單則筆記的提案（標「筆記」、動詞照處理方式）。衝突或錯誤（矛盾、過時）立刻提案，其餘等每週回顧一起送。
// 純函式：讀到的筆記原文由呼叫端給，產出的是提案（寫入要等 Scott 接受，見 apply.ts）。
import { newProposalId } from '@/lib/collect/split'
import type { DomainEdit, NoteEdit, Proposal, ProposalCardHint } from '@/lib/collect/types'
import { createV3Note, noteTitle, parseV3Note, writeV3NoteFields } from '@/lib/v3-model/note'
import type { CleanupAction, ConflictObservation, ConflictType } from './types'

/** 每種衝突類型對應的處理方式（過時看結論有沒有改變）。 */
export function planAction(observation: Pick<ConflictObservation, 'type' | 'conclusionChanged'>): CleanupAction {
  switch (observation.type) {
    case 'outdated': return observation.conclusionChanged ? 'replace' : 'modify'
    case 'contradiction': return 'verify'
    case 'context': return 'supplement'
    case 'duplicate': return 'merge'
    case 'obsolete': return 'archive'
  }
}

/** 處理方式 → 卡片動詞（補情境用「補充」）。 */
export const VERB_OF: Record<CleanupAction, ProposalCardHint['verb']> = {
  modify: 'modify', replace: 'replace', verify: 'verify', supplement: 'supplement', merge: 'merge', archive: 'archive',
}

/** 衝突或錯誤：立刻提案，不等每週彙整（規格第四節「調研與回顧的頻率」）。 */
export const IMMEDIATE_TYPES: ReadonlySet<ConflictType> = new Set(['contradiction', 'outdated'])

export function isImmediate(observation: Pick<ConflictObservation, 'type'>): boolean {
  return IMMEDIATE_TYPES.has(observation.type)
}

export function routeObservations<T extends Pick<ConflictObservation, 'type'>>(observations: readonly T[]): { immediate: T[], deferred: T[] } {
  return {
    immediate: observations.filter(isImmediate),
    deferred: observations.filter(observation => !isImmediate(observation)),
  }
}

export function observationKey(observation: Pick<ConflictObservation, 'type' | 'notePaths'>): string {
  return `${observation.type}|${[...observation.notePaths].sort().join('|')}`
}

/** 寫進筆記與領域總覽的字（筆記庫的內容，不跟介面語系走）。 */
export interface NoteWords {
  revisionLog: string
  contextHeading: string
  mergedFrom: (from: string) => string
  openQuestions: string
  log: Record<CleanupAction | 'mergeKeeper', (input: { evidence: string, other?: string }) => string>
  previousBody: string
  newTitleSuffix: (today: string) => string
}

export const DEFAULT_NOTE_WORDS: NoteWords = {
  revisionLog: '修改紀錄',
  contextHeading: '適用情境',
  mergedFrom: from => `合併自 ${from}`,
  openQuestions: '矛盾與未解問題',
  log: {
    modify: ({ evidence, other }) => `修改：${evidence}${other ? `（依據 ${other}）` : ''}`,
    replace: ({ evidence, other }) => `已被 ${other ?? '新筆記'} 取代：${evidence}`,
    verify: ({ evidence, other }) => `待查證${other ? `（與 ${other} 說法不同）` : ''}：${evidence}`,
    supplement: ({ evidence, other }) => `補情境${other ? `（對照 ${other}）` : ''}：${evidence}`,
    merge: ({ evidence, other }) => `已合併到 ${other ?? '另一則筆記'}：${evidence}`,
    mergeKeeper: ({ evidence, other }) => `合併 ${other ?? '重複的筆記'}，來源全部保留：${evidence}`,
    archive: ({ evidence }) => `封存：${evidence}`,
  },
  previousBody: '修改前',
  newTitleSuffix: today => `（${today} 更新）`,
}

/** 畫面上的字（提案標題、來源）由呼叫端依語系給（messages 的 cleanup 命名空間）。 */
export interface CleanupLabels {
  action: (action: CleanupAction) => string
  bundleTitle: (input: { domain: string, count: number }) => string
  singleTitle: (input: { action: string, title: string }) => string
  item: (input: { action: string, titles: string, evidence: string }) => string
  origin: (input: { agent: string }) => string
  confirmTitle: (input: { title: string }) => string
  confirmBody: (input: { title: string, evidence: string }) => string
}

export interface DomainInfo {
  id: string
  name: string
  overview: string
}

function wiki(path: string): string {
  return `[[${path.replace(/\.md$/i, '')}]]`
}

/** 在指定標題（##）的段落最後加一行；沒有這個段落就加在最後。 */
export function appendToSection(body: string, heading: string, line: string): string {
  const lines = body.replace(/\s+$/, '').split('\n')
  const start = lines.findIndex(entry => new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(entry.trim()))
  if (start < 0) return `${lines.join('\n')}${lines.join('').trim() ? '\n\n' : ''}## ${heading}\n\n${line}\n`
  let end = start + 1
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++
  let insertAt = end
  while (insertAt > start + 1 && !lines[insertAt - 1].trim()) insertAt--
  lines.splice(insertAt, 0, line)
  return `${lines.join('\n')}\n`
}

function replaceBody(raw: string, body: string): string {
  const { body: oldBody } = parseV3Note(raw)
  const head = raw.slice(0, raw.length - oldBody.length)
  return head + body
}

interface Working {
  base: Map<string, string | null>
  current: Map<string, string>
  order: string[]
}

function touch(working: Working, path: string, content: string, base: string | null) {
  if (!working.base.has(path)) {
    working.base.set(path, base)
    working.order.push(path)
  }
  working.current.set(path, content)
}

function read(working: Working, notes: ReadonlyMap<string, string>, path: string): string | undefined {
  return working.current.get(path) ?? notes.get(path)
}

function logLine(today: string, text: string): string {
  return `- ${today}：${text}`
}

function withLog(raw: string, words: NoteWords, today: string, text: string, patch: Parameters<typeof writeV3NoteFields>[1] = {}): string {
  const next = Object.keys(patch).length ? writeV3NoteFields(raw, patch) : raw
  const { body } = parseV3Note(next)
  return replaceBody(next, appendToSection(body, words.revisionLog, logLine(today, text)))
}

/** 保留原文，在修改紀錄與相關筆記標出合併後的位置。 */
export function archiveMergedNote(raw: string, target: string, today: string, evidence: string, words = DEFAULT_NOTE_WORDS): string {
  const { fields } = parseV3Note(raw)
  return withLog(raw, words, today, words.log.merge({ evidence, other: wiki(target) }), {
    status: 'archived', related: [...fields.related, wiki(target)],
  })
}

function quote(text: string): string {
  return text.trim().split('\n').map(line => `> ${line}`).join('\n')
}

function folderOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index + 1) : ''
}

/** 一個觀察做成筆記與領域的變更，回傳實際的處理方式；需要的筆記讀不到就跳過（回傳 undefined）。 */
function applyObservation(
  observation: ConflictObservation,
  action: CleanupAction,
  ctx: { notes: ReadonlyMap<string, string>, domains: ReadonlyMap<string, DomainInfo>, today: string, words: NoteWords },
  working: Working,
  domainWorking: Map<string, { base: string, current: string }>,
): CleanupAction | undefined {
  const { notes, today, words } = ctx
  const [first, second] = observation.notePaths
  const raw = read(working, notes, first)
  if (raw === undefined) return undefined
  const base = (path: string) => (working.base.has(path) ? working.base.get(path)! : notes.get(path) ?? null)
  const evidence = observation.evidence

  if (action === 'modify') {
    let next = raw
    if (observation.revisedBody) {
      const { body } = parseV3Note(raw)
      next = replaceBody(raw, `${observation.revisedBody.trim()}\n`)
      next = withLog(next, words, today, words.log.modify({ evidence, other: second ? wiki(second) : undefined }), { lastConfirmed: today, status: 'valid' })
      const { body: logged } = parseV3Note(next)
      next = replaceBody(next, `${logged.replace(/\s+$/, '')}\n\n${words.previousBody}：\n\n${quote(body)}\n`)
    } else {
      next = withLog(raw, words, today, words.log.modify({ evidence, other: second ? wiki(second) : undefined }), { lastConfirmed: today })
    }
    touch(working, first, next, base(first))
    return 'modify'
  }

  if (action === 'replace') {
    const parsed = parseV3Note(raw)
    let newer = second && read(working, notes, second) !== undefined ? second : undefined
    if (!newer && observation.revisedBody) {
      const title = `${noteTitle(parsed, first)}${words.newTitleSuffix(today)}`
      newer = `${folderOf(first)}${title.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim()}.md`
      const content = createV3Note({
        title, type: parsed.fields.type ?? 'knowledge', summary: parsed.fields.summary, sources: parsed.fields.sources, tags: parsed.fields.tags,
        related: [wiki(first)], domains: parsed.fields.domains, status: 'valid', lastConfirmed: today,
      }, `${observation.revisedBody.trim()}\n`)
      touch(working, newer, content, null)
    }
    if (!newer) {
      // 沒有新的筆記可以取代，也沒有新內文：退回待查證，不偷偷改。
      return applyObservation({ ...observation, type: 'contradiction' }, 'verify', ctx, working, domainWorking)
    }
    const related = Array.from(new Set([...parsed.fields.related, wiki(newer)]))
    touch(working, first, withLog(raw, words, today, words.log.replace({ evidence, other: wiki(newer) }), { status: 'superseded', related }), base(first))
    const newerRaw = read(working, notes, newer)
    if (newerRaw !== undefined && notes.has(newer)) {
      const fields = parseV3Note(newerRaw).fields
      if (!fields.related.includes(wiki(first))) touch(working, newer, writeV3NoteFields(newerRaw, { related: [...fields.related, wiki(first)] }), base(newer))
    }
    return 'replace'
  }

  if (action === 'verify') {
    const paths = observation.notePaths.filter(path => read(working, notes, path) !== undefined)
    for (const path of paths) {
      const others = paths.filter(other => other !== path).map(wiki).join('、')
      touch(working, path, withLog(read(working, notes, path)!, words, today, words.log.verify({ evidence, other: others || undefined }), { status: 'disputed' }), base(path))
    }
    // 列進領域的「矛盾與未解問題」。
    const domainIds = observation.domainId ? [observation.domainId] : Array.from(new Set(paths.flatMap(path => parseV3Note(notes.get(path) ?? '').fields.domains)))
    for (const id of domainIds) {
      const domain = ctx.domains.get(id)
      if (!domain) continue
      const entry = domainWorking.get(id) ?? { base: domain.overview, current: domain.overview }
      entry.current = appendToSection(entry.current, words.openQuestions, `- ${paths.map(wiki).join(' ↔ ')}：${evidence}`)
      domainWorking.set(id, entry)
    }
    return 'verify'
  }

  if (action === 'supplement') {
    const paths = observation.notePaths.filter(path => read(working, notes, path) !== undefined)
    for (const path of paths) {
      const current = read(working, notes, path)!
      const others = paths.filter(other => other !== path).map(wiki).join('、')
      const condition = observation.contexts?.[path] ?? evidence
      const { body } = parseV3Note(current)
      const next = replaceBody(current, appendToSection(body, words.contextHeading, `- ${condition}`))
      touch(working, path, withLog(next, words, today, words.log.supplement({ evidence, other: others || undefined })), base(path))
    }
    return 'supplement'
  }

  if (action === 'merge') {
    const keeper = first
    const others = observation.notePaths.slice(1).filter(path => read(working, notes, path) !== undefined)
    if (!others.length) return undefined
    const keeperParsed = parseV3Note(raw)
    const otherParsed = others.map(path => ({ path, parsed: parseV3Note(read(working, notes, path)!) }))
    const sources = Array.from(new Set([keeperParsed.fields.sources, ...otherParsed.map(entry => entry.parsed.fields.sources)].flat()))
    const tags = Array.from(new Set([keeperParsed.fields.tags, ...otherParsed.map(entry => entry.parsed.fields.tags)].flat()))
    const related = Array.from(new Set([...keeperParsed.fields.related, ...otherParsed.flatMap(entry => entry.parsed.fields.related)]))
      .filter(link => link !== wiki(keeper))
    const domains = Array.from(new Set([keeperParsed.fields.domains, ...otherParsed.map(entry => entry.parsed.fields.domains)].flat()))
    const mergedBody = observation.revisedBody
      ? `${observation.revisedBody.trim()}\n`
      : [keeperParsed.body.replace(/\s+$/, ''), ...otherParsed.map(entry => `## ${words.mergedFrom(wiki(entry.path))}\n\n${entry.parsed.body.trim()}`)].join('\n\n') + '\n'
    let next = replaceBody(raw, mergedBody)
    next = withLog(next, words, today, words.log.mergeKeeper({ evidence, other: others.map(wiki).join('、') }), {
      sources, tags, related, domains, lastConfirmed: today,
    })
    touch(working, keeper, next, base(keeper))
    for (const entry of otherParsed) {
      const current = read(working, notes, entry.path)!
      touch(working, entry.path, archiveMergedNote(current, keeper, today, evidence, words), base(entry.path))
    }
    return 'merge'
  }

  // archive
  touch(working, first, withLog(raw, words, today, words.log.archive({ evidence }), { status: 'archived' }), base(first))
  return 'archive'
}

export interface CleanupContext {
  /** 牽涉的筆記原文（路徑 → 原文）。讀不到的觀察會被跳過。 */
  notes: ReadonlyMap<string, string>
  domains: ReadonlyMap<string, DomainInfo>
  today: string
  labels: CleanupLabels
  words?: NoteWords
  /** 立刻提出（衝突或錯誤）或等每週回顧。 */
  immediate: boolean
}

function domainOf(observation: ConflictObservation, notes: ReadonlyMap<string, string>): string {
  if (observation.domainId) return observation.domainId
  for (const path of observation.notePaths) {
    const raw = notes.get(path)
    if (!raw) continue
    const domain = parseV3Note(raw).fields.domains[0]
    if (domain) return domain
  }
  return ''
}

function titleOfPath(path: string, notes: ReadonlyMap<string, string>): string {
  const raw = notes.get(path)
  return raw ? noteTitle(parseV3Note(raw), path) : (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

/** 依領域分組，每組做成一則清理提案。同一則筆記被好幾個觀察碰到時，變更依序疊在同一份內容上。 */
export function cleanupProposals(observations: readonly ConflictObservation[], ctx: CleanupContext): Proposal[] {
  const words = ctx.words ?? DEFAULT_NOTE_WORDS
  const groups = new Map<string, ConflictObservation[]>()
  const seen = new Set<string>()
  for (const observation of observations) {
    const key = observationKey(observation)
    if (seen.has(key)) continue
    seen.add(key)
    const domain = domainOf(observation, ctx.notes)
    groups.set(domain, [...(groups.get(domain) ?? []), observation])
  }
  const proposals: Proposal[] = []
  for (const [domainId, group] of groups) {
    const working: Working = { base: new Map(), current: new Map(), order: [] }
    const domainWorking = new Map<string, { base: string, current: string }>()
    const done: Array<{ observation: ConflictObservation, action: CleanupAction }> = []
    for (const observation of group) {
      // 取代退回待查證時，卡片照實際的處理方式。
      const action = applyObservation(observation, planAction(observation), { notes: ctx.notes, domains: ctx.domains, today: ctx.today, words }, working, domainWorking)
      if (action) done.push({ observation, action })
    }
    if (!done.length) continue
    const edits: NoteEdit[] = working.order.map(path => ({
      path,
      baseContent: working.base.get(path) ?? null,
      content: working.current.get(path)!,
      summary: titleOfPath(path, ctx.notes),
    }))
    const domainEdits: DomainEdit[] = [...domainWorking].filter(([, entry]) => entry.current !== entry.base)
      .map(([id, entry]) => ({ domainId: id, baseOverview: entry.base, overview: entry.current, summary: ctx.domains.get(id)?.name ?? id }))
    const actions = Array.from(new Set(done.map(entry => entry.action)))
    const single = done.length === 1
    const domainName = ctx.domains.get(domainId)?.name ?? ''
    const firstTitle = titleOfPath(done[0].observation.notePaths[0], ctx.notes)
    const body = done.map(({ observation, action }) => ctx.labels.item({
      action: ctx.labels.action(action),
      titles: observation.notePaths.map(path => wiki(path)).join('、'),
      evidence: observation.evidence,
    })).join('\n')
    const urls = Array.from(new Set(done.flatMap(entry => entry.observation.externalUrls ?? [])))
    proposals.push({
      id: newProposalId(),
      kind: 'note',
      title: single ? ctx.labels.singleTitle({ action: ctx.labels.action(done[0].action), title: firstTitle }) : ctx.labels.bundleTitle({ domain: domainName || firstTitle, count: done.length }),
      body: urls.length ? `${body}\n\n${urls.map(url => `- <${url}>`).join('\n')}` : body,
      due: '',
      time: '',
      tags: [],
      ...(domainId ? { domains: [domainId] } : {}),
      edits,
      ...(domainEdits.length ? { domainEdits } : {}),
      card: single ? { label: 'note', verb: VERB_OF[done[0].action] } : { label: 'knowledge', verb: 'organize' },
      cleanup: { ...(domainId ? { domainId } : {}), actions, immediate: ctx.immediate },
      drafter: { role: 'commander' },
    })
  }
  return proposals
}

/** 重新確認後沒發現問題：提案「仍然有效」（接受後把最後確認日期改成今天）。 */
export function confirmProposal(path: string, raw: string, ctx: { today: string, labels: CleanupLabels, evidence: string }): Proposal {
  const title = noteTitle(parseV3Note(raw), path)
  return {
    id: newProposalId(),
    kind: 'note',
    title: ctx.labels.confirmTitle({ title }),
    body: ctx.labels.confirmBody({ title, evidence: ctx.evidence }),
    due: '',
    time: '',
    tags: [],
    edits: [{ path, baseContent: raw, content: writeV3NoteFields(raw, { lastConfirmed: ctx.today }), summary: title }],
    card: { label: 'note', verb: 'confirm' },
    drafter: { role: 'commander' },
  }
}
