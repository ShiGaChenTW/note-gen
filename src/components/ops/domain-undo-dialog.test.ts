// @vitest-environment jsdom
// Fork（almanac ALMNC-72）：撤回成立領域提案時的詢問——兩種選擇都走一次（只撤回 MOC／一起撤回專家），再加取消。
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('next-intl', async importOriginal => {
  const intl = await importOriginal<typeof import('next-intl')>()
  return {
    ...intl,
    useTranslations: (namespace?: string) => intl.createTranslator({ locale: 'en', messages: { ops: en.ops }, namespace: (namespace ?? 'ops') as 'ops' }),
  }
})

import { DomainUndoAskHost } from './domain-undo-dialog'
import { askDomainUndo } from '@/lib/ops/domain-undo-ask'
import { runDomainUndo, type ProposalExpert } from '@/lib/ops/domain-undo'

const expert: ProposalExpert = { batchId: 'b1', proposalId: 'domain:investing', agentId: 'agent-ivy', name: 'Ivy', domain: 'Investing', at: 1000 }
const d = en.ops.domainUndo

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(React.createElement(DomainUndoAskHost)))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

function dialog(): HTMLElement | null {
  return document.querySelector('[data-testid="domain-undo-ask"]')
}

async function undoAndChoose(choice: 'moc-only' | 'with-expert' | 'cancel') {
  const undo = vi.fn(async () => true)
  const removeExpert = vi.fn(async () => ({ status: 'removed' as const, expert }))
  let pending!: ReturnType<typeof runDomainUndo<boolean>>
  await act(async () => {
    pending = runDomainUndo({ expert, ask: askDomainUndo, undo, succeeded: done => done, removeExpert })
  })
  const shown = dialog()
  expect(shown?.textContent).toContain(d.title.replace('{domain}', 'Investing'))
  expect(shown?.textContent).toContain(d.description.replace('{name}', 'Ivy'))
  // 回答前什麼都還沒動。
  expect(undo).not.toHaveBeenCalled()
  const button = document.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!
  await act(async () => button.click())
  const outcome = await pending
  expect(dialog()).toBeNull()
  return { outcome, undo, removeExpert }
}

it('「只撤回 MOC」：只跑原本的撤回，專家不動', async () => {
  const { outcome, undo, removeExpert } = await undoAndChoose('moc-only')
  expect(outcome).toEqual({ status: 'done', choice: 'moc-only', result: true })
  expect(undo).toHaveBeenCalledTimes(1)
  expect(removeExpert).not.toHaveBeenCalled()
})

it('「一起撤回專家」：撤回 MOC 後移除這次新建的專家', async () => {
  const { outcome, undo, removeExpert } = await undoAndChoose('with-expert')
  expect(outcome).toEqual({ status: 'done', choice: 'with-expert', result: true, expert: { status: 'removed', expert } })
  expect(undo).toHaveBeenCalledTimes(1)
  expect(removeExpert).toHaveBeenCalledWith(expert)
})

it('取消：什麼都不動', async () => {
  const { outcome, undo, removeExpert } = await undoAndChoose('cancel')
  expect(outcome).toEqual({ status: 'cancelled' })
  expect(undo).not.toHaveBeenCalled()
  expect(removeExpert).not.toHaveBeenCalled()
})
