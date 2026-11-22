// Fork（almanac ALMNC-49）：灰階像素 → BMP。
// 2-bit 版本照 aendom/crosspoint-calendar 的 bmp2（MIT License）：未壓縮、4 色調色盤（索引 0 黑 … 3 白）、
// 由下往上存列、每列補到 4 bytes 的倍數；CrossPoint 直接畫這個格式。
// 24-bit 是 ALMNC-44 驗證前保留的備案（params.ts 的 SLEEP_BMP_BIT_DEPTH）。
import { GRAY_LEVELS, type BmpBitDepth } from './params'

const FILE_HEADER = 14
const INFO_HEADER = 40

/** 每列的位元組數（補到 4 的倍數）。 */
export function bmpRowBytes(width: number, bitDepth: BmpBitDepth): number {
  return Math.ceil((width * bitDepth) / 32) * 4
}

/** 檔案大小：2-bit 480×800 = 70 + 120×800 = 96,070 bytes（約 94 KB）。 */
export function bmpFileSize(width: number, height: number, bitDepth: BmpBitDepth): number {
  const palette = bitDepth === 2 ? 4 * 4 : 0
  return FILE_HEADER + INFO_HEADER + palette + bmpRowBytes(width, bitDepth) * height
}

/** levels：每個像素一個 0–3 的灰階（0 黑、3 白），由上往下、由左往右。 */
export function encodeBmp(levels: Uint8Array, width: number, height: number, bitDepth: BmpBitDepth = 2): Uint8Array {
  if (levels.length !== width * height) throw new Error(`expected ${width * height} pixels, got ${levels.length}`)
  const rowBytes = bmpRowBytes(width, bitDepth)
  const offset = FILE_HEADER + INFO_HEADER + (bitDepth === 2 ? 16 : 0)
  const dataSize = rowBytes * height
  const bytes = new Uint8Array(offset + dataSize)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, 0x42) // B
  view.setUint8(1, 0x4D) // M
  view.setUint32(2, offset + dataSize, true)
  view.setUint32(10, offset, true)
  view.setUint32(14, INFO_HEADER, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true) // 正數：由下往上
  view.setUint16(26, 1, true)
  view.setUint16(28, bitDepth, true)
  view.setUint32(30, 0, true) // BI_RGB，不壓縮
  view.setUint32(34, dataSize, true)
  view.setInt32(38, 2835, true) // 72 dpi
  view.setInt32(42, 2835, true)
  view.setUint32(46, bitDepth === 2 ? 4 : 0, true)
  view.setUint32(50, 0, true)
  if (bitDepth === 2) {
    GRAY_LEVELS.forEach((gray, i) => bytes.set([gray, gray, gray, 0], FILE_HEADER + INFO_HEADER + i * 4))
    for (let y = 0; y < height; y++) {
      const row = offset + (height - 1 - y) * rowBytes
      for (let x = 0; x < width; x++) bytes[row + (x >> 2)] |= (levels[y * width + x] & 3) << (6 - (x & 3) * 2)
    }
  } else {
    for (let y = 0; y < height; y++) {
      const row = offset + (height - 1 - y) * rowBytes
      for (let x = 0; x < width; x++) {
        const gray = GRAY_LEVELS[levels[y * width + x] & 3]
        bytes.set([gray, gray, gray], row + x * 3)
      }
    }
  }
  return bytes
}

export interface BmpHeader {
  signature: string
  fileSize: number
  dataOffset: number
  width: number
  height: number
  bitDepth: number
  compression: number
  colors: number
  palette: number[]
}

/** 讀 BMP 檔頭（測試與預覽用）。 */
export function readBmpHeader(bytes: Uint8Array): BmpHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bitDepth = view.getUint16(28, true)
  const colors = view.getUint32(46, true)
  const palette: number[] = []
  for (let i = 0; i < colors; i++) palette.push(view.getUint8(FILE_HEADER + INFO_HEADER + i * 4))
  return {
    signature: String.fromCharCode(bytes[0], bytes[1]),
    fileSize: view.getUint32(2, true),
    dataOffset: view.getUint32(10, true),
    width: view.getInt32(18, true),
    height: view.getInt32(22, true),
    bitDepth,
    compression: view.getUint32(30, true),
    colors,
    palette,
  }
}

/** 解回每個像素的灰階索引（只支援這裡產生的 2-bit 與 24-bit；測試用）。 */
export function decodeBmpLevels(bytes: Uint8Array): Uint8Array {
  const header = readBmpHeader(bytes)
  const { width, height, bitDepth, dataOffset } = header
  const rowBytes = bmpRowBytes(width, bitDepth as BmpBitDepth)
  const levels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = dataOffset + (height - 1 - y) * rowBytes
    for (let x = 0; x < width; x++) {
      levels[y * width + x] = bitDepth === 2
        ? (bytes[row + (x >> 2)] >> (6 - (x & 3) * 2)) & 3
        : GRAY_LEVELS.indexOf(bytes[row + x * 3] as typeof GRAY_LEVELS[number])
    }
  }
  return levels
}
