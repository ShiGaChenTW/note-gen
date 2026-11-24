// Fork（almanac ALMNC-63）：專注模式的視窗。macOS 由原生指令 focus_window_animate 用動畫把視窗平順放大到整個螢幕
// （隱藏選單列、Dock 與紅綠燈），退出時平順縮回原本的位置與大小；不開新的桌面空間。
// 其他桌面平台退而用 setFullscreen（沒有動畫）。瀏覽器與測試環境直接略過。
import { checkIsTauri, isMobileDevice } from '@/lib/check'

let entered = false
let usedFullscreenFallback = false
let unlistenClose: (() => void) | null = null
// 換篇筆記時編輯器會短暫卸載再掛上：這種退出延後一下，期間又進入就取消，視窗不會一縮一放
const DEFERRED_EXIT_MS = 200
let pendingExit: ReturnType<typeof setTimeout> | null = null
// 進入與退出依序執行，快速切換時不會交錯
let queue: Promise<unknown> = Promise.resolve()

function enqueue(task: () => Promise<unknown>) {
  queue = queue.then(task).catch(error => console.error('[focus-window]', error))
  return queue
}

function supported() {
  return checkIsTauri() && !isMobileDevice()
}

function cancelPendingExit() {
  if (pendingExit) {
    clearTimeout(pendingExit)
    pendingExit = null
  }
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function animateNative(enable: boolean, durationMs: number): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<boolean>('focus_window_animate', { enable, duration: durationMs / 1000 })
}

async function leave(durationMs: number): Promise<boolean> {
  if (!entered) return false
  entered = false
  unlistenClose?.()
  unlistenClose = null
  if (usedFullscreenFallback) {
    usedFullscreenFallback = false
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setFullscreen(false)
    return true
  }
  await animateNative(false, durationMs)
  await wait(durationMs)
  return true
}

/** 放大到整個螢幕；回傳時動畫已經播完。回傳 true 表示視窗大小真的變了。 */
export async function enterFocusWindow(durationMs: number): Promise<boolean> {
  if (!supported()) return false
  cancelPendingExit()
  let changed = false
  await enqueue(async () => {
    if (entered) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    if (await win.isFullscreen()) return
    entered = true
    changed = true
    // 專注中直接關掉視窗：先立刻縮回原本大小，視窗狀態外掛才不會把全螢幕的大小記下來
    unlistenClose = await win.onCloseRequested(async () => { await leave(0) })
    if (await animateNative(true, durationMs)) {
      await wait(durationMs)
    } else {
      usedFullscreenFallback = true
      await win.setFullscreen(true)
    }
  })
  return changed
}

/**
 * 縮回進入前的大小與位置。deferred：編輯器只是暫時卸載（換篇筆記），延後執行、期間重新進入就取消。
 * 回傳時動畫已經播完（deferred 時立即回傳 false）。
 */
export async function exitFocusWindow(durationMs: number, options: { deferred?: boolean } = {}): Promise<boolean> {
  if (!supported()) return false
  cancelPendingExit()
  if (options.deferred) {
    pendingExit = setTimeout(() => {
      pendingExit = null
      void enqueue(() => leave(durationMs))
    }, DEFERRED_EXIT_MS)
    return false
  }
  let changed = false
  await enqueue(async () => { changed = await leave(durationMs) })
  return changed
}

/** 測試用 */
export function __resetFocusWindowForTest() {
  entered = false
  usedFullscreenFallback = false
  queue = Promise.resolve()
  cancelPendingExit()
}
