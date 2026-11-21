// Fork（almanac ALMNC-49）：把排版指令畫到 canvas，再量化成 4 階灰。
// 在 Tauri webview（OffscreenCanvas，沒有就用 <canvas>）跑；vitest 的 node 環境沒有 canvas，
// 所以測試只驗排版指令（layout.ts）與 BMP 編碼（bmp.ts），這裡的繪圖由 drawSleepLayout 接受任何 2D context，
// 測試用假的 context 記錄呼叫。
import type { DrawOp, FontSpec, SleepLayout } from './layout'
import { FONT_STACKS, GRAY_LEVELS, SLEEP_QUANTIZE_BIAS } from './params'

/** drawSleepLayout 用到的 2D context 子集（CanvasRenderingContext2D 與 OffscreenCanvasRenderingContext2D 都符合）。 */
export interface Context2D {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  fillRect: (x: number, y: number, w: number, h: number) => void
  strokeRect: (x: number, y: number, w: number, h: number) => void
  fillText: (text: string, x: number, y: number, maxWidth?: number) => void
  beginPath: () => void
  arc: (x: number, y: number, r: number, start: number, end: number) => void
  fill: () => void
  stroke: () => void
}

export function cssFont(font: FontSpec): string {
  return `${font.weight} ${font.size}px ${FONT_STACKS[font.family]}`
}

function color(gray: number): string {
  const v = GRAY_LEVELS[gray].toString(16).padStart(2, '0')
  return `#${v}${v}${v}`
}

function drawOp(ctx: Context2D, op: DrawOp): void {
  switch (op.op) {
    case 'rect':
      ctx.fillStyle = color(op.gray)
      ctx.fillRect(op.x, op.y, op.w, op.h)
      break
    case 'frame':
      ctx.strokeStyle = color(op.gray)
      ctx.lineWidth = op.line
      ctx.strokeRect(op.x + op.line / 2, op.y + op.line / 2, op.w - op.line, op.h - op.line)
      break
    case 'dot':
      ctx.beginPath()
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.strokeStyle = color(op.gray)
      ctx.lineWidth = op.line
      ctx.stroke()
      break
    case 'text':
      ctx.font = cssFont(op.font)
      ctx.fillStyle = color(op.gray)
      ctx.textAlign = op.align ?? 'left'
      ctx.textBaseline = 'alphabetic'
      // maxWidth：實際字型比估算寬時壓窄，不會超出版面
      ctx.fillText(op.text, op.x, op.y, op.maxWidth)
      break
  }
}

export function drawSleepLayout(ctx: Context2D, layout: SleepLayout): void {
  for (const op of layout.ops) drawOp(ctx, op)
}

/** RGBA → 每像素一個 0–3 的灰階索引（取最近的一階，bias 見 params.ts）。 */
export function quantizeToLevels(rgba: Uint8ClampedArray | Uint8Array, bias = SLEEP_QUANTIZE_BIAS): Uint8Array {
  const levels = new Uint8Array(rgba.length / 4)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const lum = (77 * rgba[i] + 150 * rgba[i + 1] + 29 * rgba[i + 2]) >> 8
    levels[j] = Math.max(0, Math.min(3, Math.floor((lum * 3 + 127 + bias) / 255)))
  }
  return levels
}

/** 灰階索引 → RGBA（預覽與 PNG 用）。 */
export function levelsToRgba(levels: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(levels.length * 4)
  for (let i = 0; i < levels.length; i++) {
    const v = GRAY_LEVELS[levels[i] & 3]
    rgba.set([v, v, v, 255], i * 4)
  }
  return rgba
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** 畫好並量化（webview 內用）。中文字型要先載入：等 document.fonts.ready（有的話）。 */
export async function rasterizeSleepLayout(layout: SleepLayout): Promise<Uint8Array> {
  if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready
  const canvas = createCanvas(layout.width, layout.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('2D canvas is not available')
  drawSleepLayout(ctx as unknown as Context2D, layout)
  const pixels = ctx.getImageData(0, 0, layout.width, layout.height).data
  canvas.width = canvas.height = 0
  return quantizeToLevels(pixels)
}
