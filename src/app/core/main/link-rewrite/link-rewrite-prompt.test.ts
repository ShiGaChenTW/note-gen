// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '../../../../../messages/zh-TW.json'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'

const { planLinkRewrite, applyLinkRewrite, toast } = vi.hoisted(() => ({
  planLinkRewrite: vi.fn(), applyLinkRewrite: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/lib/wikilink-rename', () => ({ planLinkRewrite, applyLinkRewrite }))
vi.mock('@/hooks/use-toast', () => ({ toast }))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: keyof typeof messages.linkRewrite, values?: Record<string, number>) =>
    messages.linkRewrite[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(values?.[name] ?? `{${name}}`)),
}))

const { LinkRewritePrompt } = await import('./link-rewrite-prompt')
const { requestLinkRewrite, useLinkRewriteStore } = await import('./link-rewrite-store')
const t = messages.linkRewrite
const moves = [{ sourcePath: 'Old.md', targetPath: 'New.md' }]
const plan = { files: [{ path: 'a.md', count: 2 }, { path: 'b/c.md', count: 1 }], totalLinks: 3, moves, pathsBefore: [], pathsAfter: [] }
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  planLinkRewrite.mockReset().mockResolvedValue(plan)
  applyLinkRewrite.mockReset().mockResolvedValue([{ path: 'a.md' }, { path: 'b/c.md' }])
  toast.mockReset()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useLinkRewriteStore.setState({ request: null, promptMounted: false })
})

async function mount() {
  await act(async () => root.render(React.createElement(LinkRewritePrompt)))
}
function dialog(): HTMLElement | null {
  return document.querySelector('[role="alertdialog"]')
}
function button(label: string): HTMLButtonElement {
  return [...document.querySelectorAll('button')].find(b => b.textContent === label) as HTMLButtonElement
}
/** 發出請求並等到對話框顯示出來；回傳 request 的 promise 與是否已結束。 */
async function request() {
  let settled = false
  const promise = requestLinkRewrite(moves).then(() => { settled = true })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return { promise, isSettled: () => settled }
}

describe('link rewrite i18n', () => {
  it('六個語系都有 linkRewrite 七個 key，插在 today 之後、backlinks 之前', () => {
    for (const locale of [messages, en, zh]) {
      expect(Object.keys(locale.linkRewrite)).toEqual(['title', 'description', 'obsidianHint', 'confirm', 'skip', 'done', 'failed'])
      expect(locale.linkRewrite.description).toContain('{files}')
      expect(locale.linkRewrite.description).toContain('{links}')
      expect(locale.linkRewrite.done).toContain('{files}')
      const namespaces = Object.keys(locale)
      expect(namespaces[namespaces.indexOf('today') + 1]).toBe('linkRewrite')
      expect(namespaces[namespaces.indexOf('linkRewrite') + 1]).toBe('backlinks')
    }
  })
})

describe('requestLinkRewrite + LinkRewritePrompt', () => {
  it('0 筆時靜默結束、不顯示對話框；計畫失敗也不丟錯', async () => {
    await mount()
    planLinkRewrite.mockResolvedValueOnce({ ...plan, files: [], totalLinks: 0 })
    await requestLinkRewrite(moves)
    expect(dialog()).toBeNull()
    planLinkRewrite.mockRejectedValueOnce(new Error('index broken'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(requestLinkRewrite(moves)).resolves.toBeUndefined()
    error.mockRestore()
  })

  it('沒有掛載詢問元件時靜默略過', async () => {
    await requestLinkRewrite(moves)
    expect(applyLinkRewrite).not.toHaveBeenCalled()
  })

  it('顯示篇數與連結數、檔案清單；「不改寫」關閉且不寫檔', async () => {
    await mount()
    const { promise, isSettled } = await request()
    expect(dialog()).not.toBeNull()
    expect(dialog()?.textContent).toContain(t.description.replace('{files}', '2').replace('{links}', '3'))
    expect(dialog()?.textContent).toContain(t.obsidianHint)
    expect(dialog()?.textContent).toContain('b/c.md')
    expect(isSettled()).toBe(false)
    await act(async () => button(t.skip).click())
    await promise
    expect(applyLinkRewrite).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it('「改寫」套用計畫，成功 toast 已更新 N 篇，之後 resolve', async () => {
    await mount()
    const { promise } = await request()
    await act(async () => button(t.confirm).click())
    await promise
    expect(applyLinkRewrite).toHaveBeenCalledWith(plan)
    expect(toast).toHaveBeenCalledWith({ title: t.done.replace('{files}', '2') })
    expect(dialog()).toBeNull()
  })

  it('改寫失敗時 toast 失敗訊息、仍 resolve 不丟錯', async () => {
    await mount()
    applyLinkRewrite.mockRejectedValueOnce(new Error('conflict'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { promise } = await request()
    await act(async () => button(t.confirm).click())
    await expect(promise).resolves.toBeUndefined()
    expect(toast).toHaveBeenCalledWith({ title: t.failed, variant: 'destructive' })
    error.mockRestore()
  })

  it('同時多個請求依序詢問', async () => {
    await mount()
    const first = await request()
    const second = await request()
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1)
    await act(async () => button(t.skip).click())
    await first.promise
    expect(second.isSettled()).toBe(false)
    expect(dialog()).not.toBeNull()
    await act(async () => button(t.skip).click())
    await second.promise
    expect(dialog()).toBeNull()
  })
})
