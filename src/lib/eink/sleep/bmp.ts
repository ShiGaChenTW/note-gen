// Fork（almanac ALMNC-49、ALMNC-58）：灰階像素 → 8-bit 灰階 BMP。
// 格式：BITMAPINFOHEADER、未壓縮、256 色調色盤（第 v 格是 v,v,v 的灰）、像素存 0–255 的灰階值、
// 由下往上存列、每列補到 4 bytes 的倍數；CrossPoint 直接畫這個格式。
// 實機（X4 Pro、CrossPoint 2.0.6，ALMNC-44／58）：2-bit 灰階太粗；24-bit 細緻但 1.15 MB 超過外掛下載上限；
// 8-bit 約 385 KB，細緻度與 24-bit 相同。
import { MAX_EVENT_DOWNLOAD_BYTES } from '@/lib/eink/crosspoint'
import { SLEEP_BMP_BIT_DEPTH, SLEEP_BMP_PALETTE_SIZE } from './params'

const FILE_HEADER = 14
const INFO_HEADER = 40
const PALETTE_BYTES = SLEEP_BMP_PALETTE_SIZE * 4
const DATA_OFFSET = FILE_HEADER + INFO_HEADER + PALETTE_BYTES

/** 外掛下載上限（1 MB）；超過的話外掛會讓整次休眠的下載都失敗，所以編碼時就擋下來。 */
export const SLEEP_BMP_MAX_BYTES = MAX_EVENT_DOWNLOAD_BYTES

/** 每列的位元組數（每像素 1 byte，補到 4 的倍數）。 */
export function bmpRowBytes(width: number): number {
  return Math.ceil(width / 4) * 4
}

/** 檔案大小：480×800 = 14 + 40 + 1,024 + 480×800 = 385,078 bytes（約 376 KB）。 */
export function bmpFileSize(width: number, height: number): number {
  return DATA_OFFSET + bmpRowBytes(width) * height
}

/** gray：每個像素一個 0–255 的灰階（0 黑、255 白），由上往下、由左往右。 */
export function encodeBmp(gray: Uint8Array, width: number, height: number): Uint8Array {
  if (gray.length !== width * height) throw new Error(`expected ${width * height} pixels, got ${gray.length}`)
  const size = bmpFileSize(width, height)
  if (size >= SLEEP_BMP_MAX_BYTES) throw new Error(`sleep BMP is ${size} bytes, must be under ${SLEEP_BMP_MAX_BYTES}`)
  const rowBytes = bmpRowBytes(width)
  const dataSize = rowBytes * height
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, 0x42) // B
  view.setUint8(1, 0x4D) // M
  view.setUint32(2, size, true)
  view.setUint32(10, DATA_OFFSET, true)
  view.setUint32(14, INFO_HEADER, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true) // 正數：由下往上
  view.setUint16(26, 1, true)
  view.setUint16(28, SLEEP_BMP_BIT_DEPTH, true)
  view.setUint32(30, 0, true) // BI_RGB，不壓縮
  view.setUint32(34, dataSize, true)
  view.setInt32(38, 2835, true) // 72 dpi
  view.setInt32(42, 2835, true)
  view.setUint32(46, SLEEP_BMP_PALETTE_SIZE, true)
  view.setUint32(50, 0, true)
  for (let v = 0; v < SLEEP_BMP_PALETTE_SIZE; v++) bytes.set([v, v, v, 0], FILE_HEADER + INFO_HEADER + v * 4) // BGRA
  for (let y = 0; y < height; y++) {
    const row = DATA_OFFSET + (height - 1 - y) * rowBytes
    bytes.set(gray.subarray(y * width, (y + 1) * width), row)
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
  imageSize: number
  colors: number
  palette: number[]
}

/** 讀 BMP 檔頭（測試與預覽用）。palette 只列每格的藍色值（灰階調色盤三色相同）。 */
export function readBmpHeader(bytes: Uint8Array): BmpHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const colors = view.getUint32(46, true)
  const palette: number[] = []
  for (let i = 0; i < colors; i++) palette.push(view.getUint8(FILE_HEADER + INFO_HEADER + i * 4))
  return {
    signature: String.fromCharCode(bytes[0], bytes[1]),
    fileSize: view.getUint32(2, true),
    dataOffset: view.getUint32(10, true),
    width: view.getInt32(18, true),
    height: view.getInt32(22, true),
    bitDepth: view.getUint16(28, true),
    compression: view.getUint32(30, true),
    imageSize: view.getUint32(34, true),
    colors,
    palette,
  }
}

/** 解回每個像素的灰階值（只支援這裡產生的 8-bit；測試用）。 */
export function decodeBmpGray(bytes: Uint8Array): Uint8Array {
  const { width, height, dataOffset } = readBmpHeader(bytes)
  const rowBytes = bmpRowBytes(width)
  const gray = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = dataOffset + (height - 1 - y) * rowBytes
    gray.set(bytes.subarray(row, row + width), y * width)
  }
  return gray
}
