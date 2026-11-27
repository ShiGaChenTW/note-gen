// Fork（almanac ALMNC-90）：紀錄筆記開著時，編輯器工具列的「送給指揮官萃取」——只出現在紀錄類筆記（日誌筆記），不出現在知識、專案筆記。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderV3, screen, waitFor } from '@/test/render-v3'

const { send, toast } = vi.hoisted(() => ({
  /** I/O 邊界：存檔、讀檔、寫資料庫與叫指揮官（record-extract-io）。 */
  send: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('./record-extract-io', () => ({ extractRecordNote: send }))
vi.mock('sonner', () => ({ toast }))

const { RecordExtractButton } = await import('./record-extract-button')

const PATH = '30 日誌/2026-11-10 週會.md'
const LOG = '---\ntype: log\ntitle: 11/10 週會\n---\n'
const LEGACY_RECORD = '---\ntype: record\n---\n'
const KNOWLEDGE = '---\ntype: knowledge\ntitle: 切換工作的代價比想像中高\n---\n'
const PROJECT = '---\ntype: project\ntitle: 電子紙\n---\n'
const BUTTON = '送給指揮官萃取'

beforeEach(() => {
  send.mockReset()
  toast.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
})

describe('筆記工具列：送給指揮官萃取', () => {
  it('紀錄類筆記（type: log，或舊值 record）才有這顆按鈕', () => {
    const { unmount } = renderV3(<RecordExtractButton notePath={PATH} raw={LOG} />)
    expect(screen.getByRole('button', { name: BUTTON })).toBeTruthy()
    unmount()
    renderV3(<RecordExtractButton notePath="old.md" raw={LEGACY_RECORD} />)
    expect(screen.getByRole('button', { name: BUTTON })).toBeTruthy()
  })

  it('知識筆記、專案筆記、沒有 frontmatter 的筆記都沒有這顆按鈕', () => {
    for (const raw of [KNOWLEDGE, PROJECT, null, '---\ntitle: 隨手記\n---\n']) {
      const { unmount } = renderV3(<RecordExtractButton notePath="a.md" raw={raw} />)
      expect(screen.queryByRole('button', { name: BUTTON })).toBeNull()
      unmount()
    }
  })

  it('按下去把這篇送去萃取，告訴 Scott 提案會出現在工作台', async () => {
    send.mockResolvedValue('added')
    const { user } = renderV3(<RecordExtractButton notePath={PATH} raw={LOG} />)
    await user.click(screen.getByRole('button', { name: BUTTON }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已送給指揮官萃取，知識筆記提案會出現在工作台'))
    expect(send).toHaveBeenCalledWith(PATH, '還沒存進檔案的修改存不進去，所以沒有送出')
  })

  it('重複送出被擋下時說明原因：已有未處理提案、萃取中、內容沒變', async () => {
    const { user } = renderV3(<RecordExtractButton notePath={PATH} raw={LOG} />)
    const button = screen.getByRole('button', { name: BUTTON })

    send.mockResolvedValueOnce('pending')
    await user.click(button)
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith('這篇還有萃取提案沒處理，先到工作台處理完再送'))

    send.mockResolvedValueOnce('inProgress')
    await user.click(button)
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith('指揮官正在萃取這篇，稍後到工作台看提案'))

    send.mockResolvedValueOnce('unchanged')
    await user.click(button)
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith('這篇已經送過萃取了，內容沒有變'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('內容改過再送：接新版', async () => {
    send.mockResolvedValue('versioned')
    const { user } = renderV3(<RecordExtractButton notePath={PATH} raw={LOG} />)
    await user.click(screen.getByRole('button', { name: BUTTON }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('內容有更新，已把新版本送給指揮官萃取'))
  })

  it('送出失敗顯示錯誤，按鈕恢復可以再按', async () => {
    send.mockRejectedValueOnce(new Error('disk full'))
    const { user } = renderV3(<RecordExtractButton notePath={PATH} raw={LOG} />)
    const button = screen.getByRole('button', { name: BUTTON })
    await user.click(button)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('送給指揮官萃取失敗', { description: 'disk full' }))
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})
