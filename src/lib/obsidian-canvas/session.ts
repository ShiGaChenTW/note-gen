import { parseCanvas, serializeCanvas, type CanvasDocument } from './format'
import { guardedCanvasWrite, mayReload } from './flow'
interface IO { read: () => Promise<string | null>; rewrite: (fn: (latest: string) => string) => Promise<unknown> }
export class CanvasSession {
  doc: CanvasDocument | null = null
  original = ''
  errors: string[] = []
  blocked = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<void> = Promise.resolve()
  private loaded = false
  constructor(private io: IO, private notify: () => void, private conflict: () => void) {}
  get dirty() { return this.doc !== null && serializeCanvas(this.doc, this.original) !== this.original }
  async load() {
    await this.pending
    try {
      const latest = await this.io.read()
      if (latest === null) throw new Error('File not found')
      const action = this.loaded ? mayReload(this.original, latest, this.dirty) : 'reload'
      if (action === 'conflict') { this.blocked = true; this.conflict(); this.notify(); return }
      if (action === 'keep') return
      const parsed = parseCanvas(latest)
      this.original = latest; this.doc = parsed.doc; this.errors = parsed.errors
      this.loaded = true; this.blocked = false; this.notify()
    } catch (error) { this.errors = [String(error)]; this.notify() }
  }
  edit(doc: CanvasDocument) {
    this.doc = doc; this.notify()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.save() }, 500)
  }
  save(): Promise<void> {
    clearTimeout(this.timer)
    this.pending = this.pending.then(async () => {
      if (!this.doc || !this.dirty || this.blocked) return
      const doc = this.doc, original = this.original
      try {
        const latest = await this.io.read()
        if (latest !== original) throw new Error('externalChange')
        const output = guardedCanvasWrite(doc, original, latest)
        await this.io.rewrite(current => guardedCanvasWrite(doc, original, current))
        this.original = output; this.errors = []; this.notify()
      } catch (error) {
        this.blocked = true; this.errors = [String(error)]; this.conflict(); this.notify()
      }
    })
    return this.pending
  }
  // 分頁關閉時仍完成已授權的寫入，不丟棄防抖期間的編輯。
  dispose() { clearTimeout(this.timer); void this.save() }
}
