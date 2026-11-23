// Fork（almanac ALMNC-69.9）：操作與批次的編號（系統內部用，不是身分編號）。
let counter = 0
export function newOpId(now = Date.now()): string {
  counter = (counter + 1) % 1296
  return `op-${now.toString(36)}-${counter.toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`
}

export function newBatchId(now = Date.now()): string {
  return newOpId(now).replace(/^op-/, 'batch-')
}

