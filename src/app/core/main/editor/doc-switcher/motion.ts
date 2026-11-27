// Fork（almanac ALMNC-97.3）：文件切換動畫的共用設定。
/** 切換動畫長度（ms），標籤滑動、浮起落下、內容淡入都用這個。 */
export const SWITCH_MS = 300

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}
