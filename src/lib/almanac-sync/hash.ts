// Fork（almanac ALMNC-85.2 骨架）：V3 同步用的穩定序列化與雜湊。
// 只拿來判斷「這一欄跟基準比改了沒」與「這個檔跟上次同步時一樣嗎」，不是安全用途。
// cyrb53 的 53-bit 結果轉成 hex，碰撞機率對這個用途足夠低。

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

export function hashString(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

export function hashValue(value: unknown): string {
  return hashString(stableStringify(value))
}

export function sameValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}
