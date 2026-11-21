// Fork（almanac ALMNC-48）：今日簡報的圖片處理（只在 Tauri webview／瀏覽器跑，需要 canvas）。
// 縮到 480 寬、轉灰階、輸出 baseline JPEG。
// 參考 ptk862010/obsidian-xteink-sync 的 src/image.ts（MIT License）：
//   canvas 的 JPEG 輸出是 baseline（CrossPoint 不顯示 progressive JPEG），所以 JPEG 也一律重新編碼；
//   透明背景先鋪白；只有 viewBox 的 SVG 要自己讀尺寸（svgSize）。
// 跟參考實作不同：一律轉灰階（電子紙只有 4 階灰，彩色資料只是浪費大小）、PNG 也轉 JPEG、限制最大高度。
import { EPUB_IMAGE_MAX_HEIGHT, EPUB_IMAGE_MAX_WIDTH, EPUB_JPEG_QUALITY } from './params'

export interface RawImage {
  bytes: Uint8Array
  mediaType: string
}

export interface ShrinkOptions {
  maxWidth: number
  maxHeight: number
  quality: number
}

export const DEFAULT_SHRINK: ShrinkOptions = { maxWidth: EPUB_IMAGE_MAX_WIDTH, maxHeight: EPUB_IMAGE_MAX_HEIGHT, quality: EPUB_JPEG_QUALITY }

/** 等比縮放後的尺寸：不放大，寬不超過 maxWidth、高不超過 maxHeight。 */
export function fitSize(width: number, height: number, maxWidth: number, maxHeight: number): { width: number, height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** SVG 宣告的尺寸（width/height 或 viewBox）。出自 obsidian-xteink-sync 的 svgSize（MIT）。 */
export function svgSize(text: string): { w: number, h: number } | null {
  const tag = text.match(/<svg\b[^>]*>/i)?.[0]
  if (!tag) return null
  const num = (name: string) => {
    const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px)?\\s*["']`, 'i'))
    return m ? Number(m[1]) : NaN
  }
  const w = num('width')
  const h = num('height')
  if (w > 0 && h > 0) return { w, h }
  const vb = tag.match(/\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i)
  if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) return { w: Number(vb[1]), h: Number(vb[2]) }
  return null
}

/** RGBA 像素就地轉灰階（ITU-R BT.601 亮度）。 */
export function toGrayscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const y = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) >> 8
    data[i] = data[i + 1] = data[i + 2] = y
  }
}

function loadElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image could not be decoded')) }
    img.src = url
  })
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function canvasToJpeg(canvas: AnyCanvas, quality: number): Promise<Uint8Array> {
  const blob = 'convertToBlob' in canvas
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
    : await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality))
  return new Uint8Array(await blob.arrayBuffer())
}

/** 縮圖＋灰階＋baseline JPEG。讀不了（格式不支援、壞檔）回 null，簡報裡改顯示文字。 */
export async function shrinkImageForEink(bytes: Uint8Array, mediaType: string, options: ShrinkOptions = DEFAULT_SHRINK): Promise<RawImage | null> {
  const type = mediaType.split(';')[0].trim().toLowerCase()
  let img: HTMLImageElement
  try {
    img = await loadElement(new Blob([bytes.slice().buffer], { type }))
  } catch {
    return null
  }
  let w = img.naturalWidth
  let h = img.naturalHeight
  if (!w || !h) {
    const declared = type === 'image/svg+xml' ? svgSize(new TextDecoder().decode(bytes.slice(0, 4096))) : null
    if (!declared) return null
    w = options.maxWidth
    h = Math.round((declared.h / declared.w) * options.maxWidth)
  }
  const size = fitSize(w, h, options.maxWidth, options.maxHeight)
  const canvas = createCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return null
  try {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.drawImage(img, 0, 0, size.width, size.height)
    const pixels = ctx.getImageData(0, 0, size.width, size.height)
    toGrayscale(pixels.data)
    ctx.putImageData(pixels, 0, 0)
    return { bytes: await canvasToJpeg(canvas, options.quality), mediaType: 'image/jpeg' }
  } catch {
    return null
  } finally {
    canvas.width = canvas.height = 0
  }
}

/** app 內的圖片下載：用 Tauri 的 http plugin（沒有 CORS 限制）。失敗回 null。 */
export async function fetchImageWithTauri(url: string): Promise<RawImage | null> {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const { fetch } = await import('@tauri-apps/plugin-http')
    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) return null
    const mediaType = response.headers.get('content-type') ?? 'application/octet-stream'
    if (!/^image\//i.test(mediaType)) return null
    return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType }
  } catch {
    return null
  }
}
