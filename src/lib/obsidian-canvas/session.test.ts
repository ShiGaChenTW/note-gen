import { describe, it, expect, vi, afterEach } from 'vitest'
import { CanvasSession } from './session'
const raw = JSON.stringify({ nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 100, text: '原文' }], edges: [] })
function harness() {
  let disk: string | null = raw
  const read = vi.fn(async () => disk)
  const rewrite = vi.fn(async (fn: (text: string) => string) => { disk = fn(disk!) })
  const notify = vi.fn(), conflict = vi.fn()
  const session = new CanvasSession({ read, rewrite }, notify, conflict)
  return { session, read, rewrite, notify, conflict, disk: () => disk, external: (text: string | null) => { disk = text } }
}
function change(session: CanvasSession, text = '修改') { session.edit({ ...session.doc!, nodes: session.doc!.nodes.map(n => ({ ...n, text })) }) }
afterEach(() => vi.useRealTimers())
describe('Canvas 儲存生命週期', () => {
  it('讀入不寫檔，500ms 防抖僅寫最後一次修改', async () => {
    vi.useFakeTimers(); const h = harness(); await h.session.load()
    await h.session.save(); expect(h.rewrite).not.toHaveBeenCalled()
    change(h.session, '第一次'); await vi.advanceTimersByTimeAsync(400)
    change(h.session, '第二次'); await vi.advanceTimersByTimeAsync(499)
    expect(h.rewrite).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.rewrite).toHaveBeenCalledTimes(1)
    expect(JSON.parse(h.disk()!).nodes[0].text).toBe('第二次')
    expect(h.session.dirty).toBe(false)
  })
  it('外部修改時保持未存內容並阻止寫回', async () => {
    const h = harness(); await h.session.load(); change(h.session)
    h.external(raw + ' '); await h.session.load(); await h.session.save()
    expect(h.session.doc!.nodes[0].text).toBe('修改')
    expect(h.conflict).toHaveBeenCalledTimes(1)
    expect(h.rewrite).not.toHaveBeenCalled()
    expect(h.disk()).toBe(raw + ' ')
    h.session.dispose()
  })
  it('未修改時重新讀入外部內容；相同內容不重新通知', async () => {
    const h = harness(); await h.session.load(); h.notify.mockClear()
    await h.session.load(); expect(h.notify).not.toHaveBeenCalled()
    h.external(raw.replace('原文', '外部')); await h.session.load()
    expect(h.session.doc!.nodes[0].text).toBe('外部')
  })
  it('寫入前磁碟檢查與 rewrite callback 都防止覆蓋', async () => {
    const h = harness(); await h.session.load(); change(h.session); h.external(raw + ' ')
    await h.session.save(); expect(h.rewrite).not.toHaveBeenCalled(); expect(h.session.blocked).toBe(true)
    const second = harness(); await second.session.load(); change(second.session)
    second.rewrite.mockImplementationOnce(async fn => { second.external(raw + ' '); fn(second.disk()!) })
    await second.session.save(); expect(second.session.blocked).toBe(true); expect(second.disk()).toBe(raw + ' ')
  })
  it('寫入期間的新編輯不會被舊 snapshot 清除，依序寫完', async () => {
    const h = harness(); await h.session.load(); change(h.session, '第一版')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    h.rewrite.mockImplementationOnce(async fn => { await gate; h.external(fn(h.disk()!)) })
    const first = h.session.save(); await Promise.resolve(); await Promise.resolve()
    change(h.session, '第二版'); release(); await first
    expect(h.session.dirty).toBe(true)
    await h.session.save(); expect(JSON.parse(h.disk()!).nodes[0].text).toBe('第二版')
    expect(h.session.dirty).toBe(false)
  })
  it('關閉分頁完成尚在防抖的修改', async () => {
    const h = harness(); await h.session.load(); change(h.session); h.session.dispose()
    await h.session.save(); expect(JSON.parse(h.disk()!).nodes[0].text).toBe('修改')
  })
  it('讀取期間的新編輯不可被外部內容覆蓋', async () => {
    const h = harness(); await h.session.load()
    let release!: (value: string) => void
    h.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const loading = h.session.load(); await Promise.resolve()
    change(h.session); release(raw + ' '); await loading
    expect(h.session.blocked).toBe(true); expect(h.session.doc!.nodes[0].text).toBe('修改')
    h.session.dispose()
  })
  it('空檔、無效格式與不存在檔案顯示錯誤', async () => {
    const h = harness(); h.external(''); await h.session.load()
    expect(h.session.doc).toBeNull(); expect(h.session.errors.length).toBeGreaterThan(0)
    h.external(null); await h.session.load(); expect(h.session.errors[0]).toContain('File not found')
  })
  it('寫入失敗保留修改並阻止後續自動寫回', async () => {
    const h = harness(); await h.session.load(); change(h.session)
    h.rewrite.mockRejectedValueOnce(new Error('write failed')); await h.session.save()
    expect(h.session.dirty).toBe(true); expect(h.session.errors[0]).toContain('write failed')
    await h.session.save(); expect(h.rewrite).toHaveBeenCalledTimes(1)
  })
})
