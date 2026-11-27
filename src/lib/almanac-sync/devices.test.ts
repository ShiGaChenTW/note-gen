// Fork（almanac ALMNC-85.5 #3）：devices.json 記版本，設定頁據此提示「另一台版本太舊、不認得 V3 資料」。
import { describe, expect, it } from 'vitest'
import { checkDeviceVersions, compareAppVersions, emptyDevicesDoc, mergeDevicesDoc, parseDevicesDoc, serializeDevicesDoc, type AlmanacDeviceInfo } from './devices'

const doc = (devices: Record<string, AlmanacDeviceInfo>) => ({ ...emptyDevicesDoc(), primaryDeviceId: 'dev-a', devices })

describe('compareAppVersions', () => {
  it('逐段比數字，忽略 v 前綴與 -beta 後綴；看不懂的回 null', () => {
    expect(compareAppVersions('0.27.3', '0.27.10')).toBe(-1)
    expect(compareAppVersions('v1.2', '1.2.0')).toBe(0)
    expect(compareAppVersions('1.3.0-beta.1', '1.2.9')).toBe(1)
    expect(compareAppVersions('dev', '1.0.0')).toBeNull()
  })
})

describe('devices.json 記版本', () => {
  it('每台寫入自己的 App 版本與同步格式版本；格式版本變了也會重寫', () => {
    const first = mergeDevicesDoc({ remote: emptyDevicesDoc(), self: { deviceId: 'dev-a', name: 'Mac', appVersion: '1.0.0', syncVersion: 1 }, now: 10 })
    expect(first.devices['dev-a']).toEqual({ name: 'Mac', lastSeenAt: 10, appVersion: '1.0.0', syncVersion: 1 })
    const roundTrip = parseDevicesDoc(serializeDevicesDoc(first))
    expect(roundTrip.devices['dev-a'].syncVersion).toBe(1)
    const bumped = mergeDevicesDoc({ remote: roundTrip, self: { deviceId: 'dev-a', name: 'Mac', appVersion: '1.0.0', syncVersion: 2 }, now: 20 })
    expect(bumped.devices['dev-a']).toMatchObject({ syncVersion: 2, lastSeenAt: 20 })
  })
})

describe('checkDeviceVersions：舊版裝置提示', () => {
  const self = { deviceId: 'dev-a', appVersion: '1.4.0', syncVersion: 2 }

  it('別台的同步格式版本比這台低 → 列為舊版（沒寫格式版本的當成 1）', () => {
    const result = checkDeviceVersions(doc({
      'dev-a': { name: 'MacBook', lastSeenAt: 1, appVersion: '1.4.0', syncVersion: 2 },
      'dev-b': { name: 'iPhone', lastSeenAt: 1, appVersion: '1.4.0' },
    }), self)
    expect(result).toEqual({ outdated: [{ deviceId: 'dev-b', name: 'iPhone', appVersion: '1.4.0' }], selfOutdated: false })
  })

  it('格式版本一樣、App 版本比這台舊 → 也列為舊版；一樣新的不列', () => {
    const result = checkDeviceVersions(doc({
      'dev-b': { name: 'Mac mini', lastSeenAt: 1, appVersion: '1.3.2', syncVersion: 2 },
      'dev-c': { name: 'iPad', lastSeenAt: 1, appVersion: '1.4.0', syncVersion: 2 },
    }), self)
    expect(result.outdated.map(device => device.name)).toEqual(['Mac mini'])
    expect(result.selfOutdated).toBe(false)
  })

  it('別台比這台新 → 這台要升級；App 版本看不懂或沒寫時不拿來判斷', () => {
    expect(checkDeviceVersions(doc({ 'dev-b': { name: 'Mac mini', lastSeenAt: 1, appVersion: '1.5.0', syncVersion: 2 } }), self).selfOutdated).toBe(true)
    expect(checkDeviceVersions(doc({ 'dev-b': { name: 'Mac mini', lastSeenAt: 1, appVersion: '1.4.0', syncVersion: 3 } }), self).selfOutdated).toBe(true)
    expect(checkDeviceVersions(doc({ 'dev-b': { name: 'Mac mini', lastSeenAt: 1, appVersion: 'dev', syncVersion: 2 } }), self))
      .toEqual({ outdated: [], selfOutdated: false })
    expect(checkDeviceVersions(null, self)).toEqual({ outdated: [], selfOutdated: false })
  })
})
