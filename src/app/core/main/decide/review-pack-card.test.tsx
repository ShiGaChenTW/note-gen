// Fork（almanac ALMNC-88）：專家回顧產生的「建議你親手整理」卡——列出那群筆記、攤到檯面、整理好了（真實 ReviewCard + useCardActions）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, within } from '@testing-library/react'
import { renderV3, screen } from '@/test/render-v3'
import { buildReviewCards, reviewPackHand, type WorkbenchCard } from '@/lib/workbench/cards'
import useWorkbenchStore from '@/stores/workbench'
import { ReviewCard } from './review-card'
import { useCardActions } from './use-card-actions'

const mocks = vi.hoisted(() => ({
  resolveReviewPack: vi.fn<(id: string) => Promise<undefined>>(async () => undefined),
  resolveLegacyPack: vi.fn<(id: string) => Promise<undefined>>(async () => undefined),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/lib/workbench/actions', () => ({
  acceptBatchCard: vi.fn(), acceptCard: vi.fn(), completeTask: vi.fn(), confirmStillValid: vi.fn(), removeDomainChoice: vi.fn(),
  confirmToCommander: vi.fn(), deleteFailedSource: vi.fn(), dropCard: vi.fn(), pauseLegacy: vi.fn(), processSource: vi.fn(),
  rejectSource: vi.fn(), retryCapture: vi.fn(), scheduleCardTask: vi.fn(), startLegacy: vi.fn(),
  resolveLegacyPack: mocks.resolveLegacyPack,
  resolveReviewPack: mocks.resolveReviewPack,
}))
vi.mock('@/lib/workbench/use-workbench', () => ({ currentUnmarkedLegacy: () => [] }))
vi.mock('sonner', () => ({ toast: mocks.toast }))

const NOW = Date.parse('2026-11-27T10:00:00')
const PATHS = ['時間管理/時段 A.md', '時間管理/時段 B.md', '時間管理/時段 C.md', '時間管理/時段 D.md', '時間管理/時段 E.md']

function reviewCard(): WorkbenchCard {
  const hand = reviewPackHand({
    id: 'rp1', domainId: 'M-1', domainName: '時間管理', topic: '時段切法', reason: '五則都只有一兩句、彼此重複',
    paths: PATHS, by: 'Leo', createdAt: NOW - 3_600_000,
  }, 'Leo 回顧「時間管理」：5 則零散片段，建議你親手整理')
  return buildReviewCards({ now: NOW, proposals: [], hand: [hand] })[0]!
}

function Harness({ card }: { card: WorkbenchCard }) {
  const { run, putAside } = useCardActions({ visible: [card], commanderName: 'Mia' })
  const desk = useWorkbenchStore(state => state.desk)
  return (
    <div role="list">
      <ReviewCard
        card={card} now={NOW} current expanded leaving={false} onDesk={desk.open && desk.cardKey === card.key} commanderName="Mia"
        onToggle={() => undefined} onAction={(action, payload) => run(card, action, payload)} onPutAside={until => putAside(card, until)}
      />
    </div>
  )
}

describe('專家回顧的「建議你親手整理」卡', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkbenchStore.getState().closeDesk()
  })

  it('卡片列出主題、提出的專家、專家理由與那群筆記', () => {
    renderV3(<Harness card={reviewCard()} />)
    const toggle = screen.getByRole('button', { expanded: true })
    expect(within(toggle).getByText('時段切法')).toBeInTheDocument()
    expect(within(toggle).getByText('等 4 則')).toBeInTheDocument()
    expect(within(toggle).getByText('Leo 回顧「時間管理」：5 則零散片段，建議你親手整理')).toBeInTheDocument()
    expect(within(toggle).getByText('Leo')).toBeInTheDocument()
    expect(screen.getByText('五則都只有一兩句、彼此重複')).toBeInTheDocument()
    const notes = screen.getByRole('list', { name: '這群筆記' })
    expect(within(notes).getAllByRole('listitem').map(item => item.textContent)).toEqual(['時段 A', '時段 B', '時段 C', '時段 D', '時段 E'])
  })

  it('攤到檯面：沿用親手整理卡的行為，把那群筆記攤成素材，卡片標「檯面上」', async () => {
    const card = reviewCard()
    const { user } = renderV3(<Harness card={card} />)
    await user.click(screen.getByRole('button', { name: /攤到檯面/ }))
    const desk = useWorkbenchStore.getState().desk
    expect(desk.open).toBe(true)
    expect(desk.cardKey).toBe(card.key)
    expect(desk.materials.map(material => material.path)).toEqual(PATHS)
    expect(desk.materials.every(material => material.kind === 'note')).toBe(true)
    expect(await screen.findByText('檯面上')).toBeInTheDocument()
  })

  it('整理好了：記下這一包已整理（走專家回顧的包，不是舊筆記的包）', async () => {
    const { user } = renderV3(<Harness card={reviewCard()} />)
    await user.click(screen.getByRole('button', { name: /整理好了/ }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)) })
    expect(mocks.resolveReviewPack).toHaveBeenCalledWith('rp1')
    expect(mocks.resolveLegacyPack).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('已整理好「時段切法」', expect.anything())
  })
})
