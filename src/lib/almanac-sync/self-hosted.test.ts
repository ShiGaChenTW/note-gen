// Fork（almanac ALMNC-85.2 骨架）：自架同步 V3 物件的 payload 契約。
import { describe, expect, it } from 'vitest'
import {
  ALMANAC_SELF_HOSTED_KIND, almanacSelfHostedObjectId, decodeAlmanacSelfHostedPayload,
  encodeAlmanacSelfHostedPayload, selfHostedWorkspaceTypeFor,
} from './self-hosted'

describe('almanac self-hosted payload', () => {
  it('外層用既有的 setting 種類，payload.domain 區分', () => {
    expect(ALMANAC_SELF_HOSTED_KIND).toBe('setting')
    const payload = encodeAlmanacSelfHostedPayload({ objectType: 'almanac-source', table: 'sources', syncKey: 'src_rss:x', row: { v: { content: 'x' }, u: 1, d: 'dev-a' } })
    expect(payload.domain).toBe('almanac')
    expect(decodeAlmanacSelfHostedPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload)
  })

  it('墓碑也能編解碼；不是 almanac 的 payload 回 null', () => {
    const payload = encodeAlmanacSelfHostedPayload({ objectType: 'almanac-feed', table: 'feeds', syncKey: 'rss_1', deleted: { deletedAt: 5, deviceId: 'dev-b' } })
    expect(decodeAlmanacSelfHostedPayload({ ...payload })?.deleted).toEqual({ deletedAt: 5, deviceId: 'dev-b' })
    expect(decodeAlmanacSelfHostedPayload({ domain: 'setting', value: {} })).toBeNull()
    expect(decodeAlmanacSelfHostedPayload({ domain: 'almanac', table: 'x', syncKey: 'y', objectType: 'z' })).toBeNull()
  })

  it('物件 id 與工作區由表、同步鍵、層決定', () => {
    expect(almanacSelfHostedObjectId('sources', 'src_rss:x')).toBe('almanac:sources:src_rss:x')
    expect(selfHostedWorkspaceTypeFor('account')).toBe('account-data')
    expect(selfHostedWorkspaceTypeFor('library')).toBe('library')
  })
})
