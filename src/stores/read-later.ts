// Fork（almanac ALMNC-46）：稍後讀清單的保存與背景擷取。存在 store.json 的 einkReadLater（只在這台 Mac，不跟著設定同步）。
// 清單邏輯與狀態流轉在 src/lib/eink/read-later.ts（純函式、有單元測試）；擷取在 read-later-extract.ts。
import { create } from 'zustand'
import {
  EINK_READ_LATER_KEY, addReadLater, extractPending, markReadLaterSent, needsExtraction, normalizeReadLater, removeReadLater, requeueReadLater,
  retryReadLater, type AddResult, type ExtractionOutcome, type ReadLaterItem,
} from '@/lib/eink/read-later'
import { persistEink, readEinkKeys } from '@/lib/eink/storage'

export type ReadLaterExtractor = (url: string) => Promise<ExtractionOutcome>

async function defaultExtractor(url: string): Promise<ExtractionOutcome> {
  const { captureReadLaterArticle } = await import('@/lib/eink/read-later-extract')
  return captureReadLaterArticle(url)
}

let extractor: ReadLaterExtractor = defaultExtractor
/** 測試用：換掉擷取函式（不連外網）；傳 null 回到預設。 */
export function configureReadLaterExtractor(next: ReadLaterExtractor | null): void {
  extractor = next ?? defaultExtractor
}

interface ReadLaterState {
  loaded: boolean
  items: ReadLaterItem[]
  extracting: boolean
  init: () => Promise<void>
  add: (url: string) => Promise<AddResult['result']>
  remove: (url: string) => Promise<void>
  requeue: (url: string) => Promise<void>
  retry: (url: string) => Promise<void>
  /** Fork（almanac ALMNC-47）：真的送到電子紙後移到「已送電子紙」（只由今日簡報的 commitSent 呼叫）。 */
  markSent: (urls: readonly string[], at: number) => Promise<void>
  /** 擷取所有待擷取的文章；已經在跑就不重複開（結束時會再檢查一次有沒有新加入的）。 */
  extract: () => Promise<void>
}

let loading: Promise<void> | null = null
let running: Promise<void> | null = null

const useReadLaterStore = create<ReadLaterState>((set, get) => {
  async function ready() {
    if (!get().loaded) await get().init()
  }

  async function save(items: ReadLaterItem[]) {
    set({ items })
    await persistEink(EINK_READ_LATER_KEY, items)
  }

  return {
    loaded: false,
    items: [],
    extracting: false,

    init: async () => {
      if (get().loaded) return
      loading ??= (async () => {
        try {
          const saved = await readEinkKeys([EINK_READ_LATER_KEY])
          set({ loaded: true, items: normalizeReadLater(saved[EINK_READ_LATER_KEY]) })
        } catch {
          set({ loaded: true })
        }
      })().finally(() => { loading = null })
      await loading
    },

    add: async url => {
      await ready()
      const added = addReadLater(get().items, url, Date.now())
      if (added.result === 'added') {
        await save(added.items)
        void get().extract()
      }
      return added.result
    },
    remove: async url => {
      await ready()
      await save(removeReadLater(get().items, url))
    },
    requeue: async url => {
      await ready()
      await save(requeueReadLater(get().items, url))
    },
    retry: async url => {
      await ready()
      await save(retryReadLater(get().items, url))
      void get().extract()
    },

    markSent: async (urls, at) => {
      await ready()
      if (urls.length === 0) return
      await save(markReadLaterSent(get().items, urls, at))
    },

    extract: async () => {
      await ready()
      if (running) return running
      running = (async () => {
        set({ extracting: true })
        try {
          do {
            await extractPending(() => get().items, url => extractor(url), save)
          } while (get().items.some(needsExtraction))
        } finally {
          set({ extracting: false })
          running = null
        }
      })()
      return running
    },
  }
})

/** 測試用：回到還沒讀檔的狀態。 */
export function resetReadLaterStoreForTest(): void {
  loading = null
  running = null
  useReadLaterStore.setState({ loaded: false, items: [], extracting: false })
}

/**
 * 把一個連結加進稍後讀清單，並在背景擷取正文。回傳 added／duplicate（同一網址不重複）／invalid。
 * Q17（文章怎麼放進清單）還沒定案：目前唯一的入口是清單管理頁的「加入連結」；
 * 之後定案的入口（資料源、分享選單、瀏覽器擴充…）都呼叫這個函式即可。
 */
export async function addToReadLater(url: string): Promise<AddResult['result']> {
  return useReadLaterStore.getState().add(url)
}

export default useReadLaterStore
