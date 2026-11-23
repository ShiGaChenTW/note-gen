// Fork（almanac ALMNC-69.1）：系統索引的列驗證。
import { describe, expect, it } from 'vitest'
import { idIndexEntryFromRow, idIndexValues, lastNameOf, movedIndexPaths } from './id-index'

describe('id_index 列', () => {
  it('記下路徑與上次檔名', () => {
    expect(idIndexValues({ id: 'N-20261110-063015-B3XR', kind: 'N', path: '10 Inbox/定價想法.md' }, 5)).toEqual({
      id: 'N-20261110-063015-B3XR', kind: 'N', path: '10 Inbox/定價想法.md', lastName: '定價想法', name: undefined, createdAt: 5, updatedAt: 5,
    })
  })

  it('MOC 記名稱 ↔ M 編號', () => {
    expect(idIndexValues({ id: 'M-20261110-063015-B3XR', kind: 'M', name: ' 工業工程 ' }, 1).name).toBe('工業工程')
  })

  it('編號與類別不符、或非 MOC 帶名稱時丟錯', () => {
    expect(() => idIndexValues({ id: 'N-20261110-063015-B3XR', kind: 'M' }, 1)).toThrow('編號與類別不符')
    expect(() => idIndexValues({ id: 'src_1', kind: 'S' }, 1)).toThrow('編號與類別不符')
    expect(() => idIndexValues({ id: 'N-20261110-063015-B3XR', kind: 'N', name: 'x' }, 1)).toThrow('只有 MOC')
    expect(idIndexValues({ id: 'C-20261110-063015-B3XR', kind: 'C', path: 'moc.md', name: '章節' }, 1).name).toBe('章節')
  })

  it('lastNameOf 去掉資料夾與副檔名；資料列 null 轉成 undefined', () => {
    expect(lastNameOf('a/b/c.MD')).toBe('c')
    expect(lastNameOf('c')).toBe('c')
    expect(idIndexEntryFromRow({ id: 'C-20261110-063015-B3XR', kind: 'C', path: null, lastName: null, name: null, createdAt: 1, updatedAt: 2 }))
      .toEqual({ id: 'C-20261110-063015-B3XR', kind: 'C', path: undefined, lastName: undefined, name: undefined, createdAt: 1, updatedAt: 2 })
  })

  it('movedIndexPaths：檔案與資料夾搬動都換路徑，不相干的不動', () => {
    expect(movedIndexPaths(['a.md', 'f/b.md', 'f/g/c.md', 'fx/d.md', 'e.md'], [
      { sourcePath: 'a.md', targetPath: 'z/a2.md' },
      { sourcePath: 'f', targetPath: 'h' },
    ])).toEqual([['a.md', 'z/a2.md'], ['f/b.md', 'h/b.md'], ['f/g/c.md', 'h/g/c.md']])
  })
})
