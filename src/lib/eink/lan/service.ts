// Fork（almanac ALMNC-50）：依電子紙設定開關區網服務，並在開著時負責推送內容。
//   - 「啟用電子紙同步」與「區網服務」都打開才啟動；其他情況一律關閉（預設關閉，重開 app 後照設定決定）。
//   - 埠或 token 變了就重新套用（Rust 只在 IP 或埠變了才重綁；token 換掉後舊的立刻失效）。
//   - 不論新舊介面都照設定跑（classic 只是看不到入口，打開過的服務不能因為切介面就壞掉）。
import { create } from 'zustand'
import useEinkStore from '@/stores/eink'
import {
  LAN_EVENT_DOWNLOADED, LAN_EVENT_REFRESH, configureLan, lanStatus, publishLan, sha256Hex,
  type EinkLanStatus, type LanDownloadedEvent,
} from './bridge'
import { createLanPublisher, loadLanContent, type LanPublisher } from './publisher'

interface LanStatusState {
  status: EinkLanStatus | null
  setStatus: (status: EinkLanStatus | null) => void
  refreshStatus: () => Promise<void>
}

export const useEinkLanStatus = create<LanStatusState>(set => ({
  status: null,
  setStatus: status => set({ status }),
  refreshStatus: async () => {
    try {
      set({ status: await lanStatus() })
    } catch {
      // 不在 Tauri 裡（測試、瀏覽器預覽）就沒有狀態
    }
  },
}))

export interface LanConfig { on: boolean, port: number, token: string }

export function lanConfigFromStore(state: ReturnType<typeof useEinkStore.getState>): LanConfig {
  return { on: state.loaded && state.settings.enabled && state.settings.lanServer && !!state.token, port: state.settings.lanPort, token: state.token }
}

function sameConfig(a: LanConfig | null, b: LanConfig): boolean {
  return !!a && a.on === b.on && (!b.on || (a.port === b.port && a.token === b.token))
}

/** 啟動；回傳取消函式。 */
export function initEinkLanService(): () => void {
  let applied: LanConfig | null = null
  let publisher: LanPublisher | null = null
  let stopped = false
  const unlisten: Array<() => void> = []
  const report = (message: string) => console.warn(`[eink-lan] ${message}`)

  let queue: Promise<void> = Promise.resolve()
  // 依序套用：快速切換開關時，Rust 收到的順序就是設定變更的順序
  function apply(config: LanConfig): Promise<void> {
    queue = queue.then(() => applyNow(config))
    return queue
  }

  async function applyNow(config: LanConfig) {
    if (stopped || sameConfig(applied, config)) return
    applied = config
    try {
      const status = await configureLan(config.on, config.port, config.token)
      useEinkLanStatus.getState().setStatus(status)
    } catch (error) {
      report(`configure failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      return
    }
    if (config.on && !publisher) {
      publisher = createLanPublisher({
        load: loadLanContent,
        publish: publishLan,
        hash: sha256Hex,
        commit: async briefing => {
          const { commitSent } = await import('@/lib/eink/briefing')
          await commitSent(briefing)
        },
        report,
      })
      publisher.start()
    } else if (!config.on && publisher) {
      publisher.stop()
      publisher = null
    }
  }

  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const offRefresh = await listen(LAN_EVENT_REFRESH, () => { void publisher?.refresh() })
      const offDownloaded = await listen<LanDownloadedEvent>(LAN_EVENT_DOWNLOADED, event => { void publisher?.onDownloaded(event.payload) })
      if (stopped) { offRefresh(); offDownloaded(); return }
      unlisten.push(offRefresh, offDownloaded)
    } catch {
      // 不在 Tauri 裡就不聽事件
    }
    await useEinkStore.getState().init()
    await apply(lanConfigFromStore(useEinkStore.getState()))
  })()

  const unsubscribe = useEinkStore.subscribe(state => { void apply(lanConfigFromStore(state)) })

  return () => {
    stopped = true
    unsubscribe()
    unlisten.forEach(off => off())
    publisher?.stop()
    publisher = null
  }
}
