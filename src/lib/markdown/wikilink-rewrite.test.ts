import { describe, expect, it } from 'vitest'
import { indexNote } from '@/lib/vault-index/index-note'
import {
  collectLinkRewriteCandidates,
  mapMovedPath,
  resolveLinkTarget,
  rewriteLinksForMoves,
  unmapMovedPath,
  type PathMove,
} from './wikilink-rewrite'

function rewrite(content: string, moves: PathMove[], pathsBefore: string[], source = 'Source.md') {
  const pathsAfter = pathsBefore.map(path => mapMovedPath(path, moves))
  return rewriteLinksForMoves({
    content,
    sourcePathBefore: source,
    sourcePathAfter: mapMovedPath(source, moves),
    moves,
    pathsBefore,
    pathsAfter,
  })
}

/** 除了預期改掉的行，其他行必須一字不差。 */
function expectOtherLinesUntouched(before: string, after: string, changedLines: number[]) {
  const a = before.split('\n')
  const b = after.split('\n')
  expect(b).toHaveLength(a.length)
  a.forEach((line, i) => {
    if (!changedLines.includes(i)) expect(b[i]).toBe(line)
  })
}

describe('mapMovedPath', () => {
  it('換前綴，資料夾以 / 為界，子資料夾的搬動優先', () => {
    const moves = [{ sourcePath: 'a', targetPath: 'b' }, { sourcePath: 'a/x', targetPath: 'c' }]
    expect(mapMovedPath('a/Note.md', moves)).toBe('b/Note.md')
    expect(mapMovedPath('a/x/Note.md', moves)).toBe('c/Note.md')
    expect(mapMovedPath('ab/Note.md', moves)).toBe('ab/Note.md')
    expect(mapMovedPath('a', moves)).toBe('b')
    expect(mapMovedPath('/a/Note.md', moves)).toBe('b/Note.md')
    expect(mapMovedPath('other.md', [])).toBe('other.md')
    expect(unmapMovedPath('b/Note.md', moves)).toBe('a/Note.md')
  })
})

describe('resolveLinkTarget', () => {
  it('先照 2-1 規則，再補「來源資料夾/部分路徑」', () => {
    const paths = ['proj/sub/Note.md', 'proj/Other.md', 'Top.md']
    expect(resolveLinkTarget('Top', paths, 'proj/Other.md')).toBe('Top.md')
    expect(resolveLinkTarget('proj/sub/Note', paths, 'Top.md')).toBe('proj/sub/Note.md')
    expect(resolveLinkTarget('sub/Note', paths, 'proj/Other.md')).toBe('proj/sub/Note.md')
    expect(resolveLinkTarget('sub/Note.md', paths, 'proj/Other.md')).toBe('proj/sub/Note.md')
    expect(resolveLinkTarget('sub/Note', paths, 'Top.md')).toBeNull()
    expect(resolveLinkTarget('Missing', paths, 'Top.md')).toBeNull()
  })
})

describe('rewriteLinksForMoves：單檔改名', () => {
  const paths = ['Source.md', 'Old.md', 'Other.md', 'img.png']
  const moves = [{ sourcePath: 'Old.md', targetPath: 'New.md' }]
  const content = [
    '---',
    'related: "[[Old]]"',
    'other: "[[Other]]"',
    '---',
    '# 標題',
    '',
    '看 [[Old]] 和 [[Old|別名]] 與 [[Old#段落]] 還有 [[Old#^abc]]。',
    '嵌入 ![[Old]] 以及 [[ Old.md ]]',
    '| 表格 | [[Old\\|表格別名]] | [[Other]] |',
    '`[[Old]]` 行內 code 不動',
    '```',
    '[[Old]] fenced 不動',
    '```',
    '[[Other]] 沒搬動，[[old]] 小寫也算指向它。',
  ].join('\n')

  it('別名、標題、block、嵌入、表格與 frontmatter 都改，code 與沒搬動的不動', () => {
    const result = rewrite(content, moves, paths)
    const lines = result.content.split('\n')
    expect(lines[1]).toBe('related: "[[New]]"')
    expect(lines[6]).toBe('看 [[New]] 和 [[New|別名]] 與 [[New#段落]] 還有 [[New#^abc]]。')
    expect(lines[7]).toBe('嵌入 ![[New]] 以及 [[ New ]]')
    expect(lines[8]).toBe('| 表格 | [[New\\|表格別名]] | [[Other]] |')
    expect(lines[13]).toBe('[[Other]] 沒搬動，[[New]] 小寫也算指向它。')
    expectOtherLinesUntouched(content, result.content, [1, 6, 7, 8, 13])
    expect(result.count).toBe(9)
  })

  it('沒連到被搬動檔案的筆記回傳 count 0 且內容相同', () => {
    const untouched = '看 [[Other]]，[文字](Other.md)，[外部](https://x.y/Old.md)，[錨點](#Old)\n'
    const result = rewrite(untouched, moves, paths)
    expect(result.count).toBe(0)
    expect(result.content).toBe(untouched)
    expect(rewriteLinksForMoves({ content, sourcePathBefore: 'Source.md', sourcePathAfter: 'Source.md', moves: [], pathsBefore: paths, pathsAfter: paths }))
      .toEqual({ content, count: 0 })
  })

  it('CRLF 行尾原樣保留', () => {
    const crlf = '前言\r\n看 [[Old]] 這篇\r\n再看 [[Other]]\r\n'
    const result = rewrite(crlf, moves, paths)
    expect(result.content).toBe('前言\r\n看 [[New]] 這篇\r\n再看 [[Other]]\r\n')
    expect(result.count).toBe(1)
  })
})

describe('rewriteLinksForMoves：同名與路徑', () => {
  it('搬成同名後，原文字會改指到別篇（同資料夾優先）的連結改成完整路徑', () => {
    const paths = ['a/Note.md', 'b/Other.md', 'b/Source.md']
    const moves = [{ sourcePath: 'b/Other.md', targetPath: 'b/Note.md' }]
    const content = '[[Note]] 與 [[Other]] 與 [[Other|o]]\n'
    const result = rewrite(content, moves, paths, 'b/Source.md')
    expect(result.content).toBe('[[a/Note]] 與 [[b/Note]] 與 [[b/Note|o]]\n')
    expect(result.count).toBe(3)
  })

  it('同名消失後，仍解析得到同一檔案的完整路徑寫法不動；被改名的那個才改', () => {
    const paths = ['a/Note.md', 'b/Note.md', 'c/Solo.md', 'Source.md']
    const moves = [{ sourcePath: 'b/Note.md', targetPath: 'b/Renamed.md' }]
    const content = '[[a/Note]] [[b/Note#標題]] [[c/Solo]]\n'
    const result = rewrite(content, moves, paths)
    expect(result.content).toBe('[[a/Note]] [[Renamed#標題]] [[c/Solo]]\n')
    expect(result.count).toBe(1)
  })

  it('資料夾改名：前後都不唯一、仍解析到同一檔案的 [[同名]] 一字不動，完整路徑的才改', () => {
    const paths = ['60 Notes/雙鏈來源.md', '60 Notes/同名.md', '60 Notes/子資料夾/同名.md', '60 Notes/雙鏈表格.md']
    const moves = [{ sourcePath: '60 Notes', targetPath: '70 Notes' }]
    const source = '看 [[同名]] 與 [[60 Notes/子資料夾/同名]]\n'
    const result = rewrite(source, moves, paths, '60 Notes/雙鏈來源.md')
    expect(result.content).toBe('看 [[同名]] 與 [[70 Notes/子資料夾/同名]]\n')
    expect(result.count).toBe(1)
    const table = '| [[同名\\|a]] | [[同名#標題]] |\n'
    expect(rewrite(table, moves, paths, '60 Notes/雙鏈表格.md')).toEqual({ content: table, count: 0 })
  })

  it('資料夾改名影響子筆記：檔名寫法不變、完整路徑寫法更新', () => {
    const paths = ['proj/Note.md', 'proj/deep/Inner.md', 'other/Note.md', 'Source.md']
    const moves = [{ sourcePath: 'proj', targetPath: 'projects' }]
    const content = '[[proj/Note]] 與 [[Inner]] 與 [[proj/deep/Inner|深]] 與 [[other/Note]]\n'
    const result = rewrite(content, moves, paths)
    expect(result.content).toBe('[[projects/Note]] 與 [[Inner]] 與 [[Inner|深]] 與 [[other/Note]]\n')
    expect(result.count).toBe(2)
  })

  it('被搬動筆記自己的部分路徑 wikilink 重算', () => {
    const paths = ['proj/Me.md', 'proj/sub/Note.md', 'Top.md']
    const moves = [{ sourcePath: 'proj/Me.md', targetPath: 'archive/Me.md' }]
    const content = '[[sub/Note]] 與 [[Top]]\n'
    const result = rewrite(content, moves, paths, 'proj/Me.md')
    expect(result.content).toBe('[[Note]] 與 [[Top]]\n')
    expect(result.count).toBe(1)
  })
})

describe('rewriteLinksForMoves：markdown 連結', () => {
  it('被搬動筆記自己的相對路徑連結以新位置重算，保留 %20 編碼與 #片段', () => {
    const paths = ['a/b/Me.md', 'a/Target.md', 'a/My Note.md', 'x/Far.md']
    const moves = [{ sourcePath: 'a/b/Me.md', targetPath: 'c/Me.md' }]
    const content = [
      '[t](../Target.md) [u](../My%20Note.md#段落) [v](<../My Note.md>)',
      '[far](../../x/Far.md) ![圖](../img.png) [外](https://a/b.md) [根](/abs.md)',
      '`[t](../Target.md)` 不動',
    ].join('\n')
    const result = rewrite(content, moves, paths, 'a/b/Me.md')
    const lines = result.content.split('\n')
    expect(lines[0]).toBe('[t](../a/Target.md) [u](../a/My%20Note.md#段落) [v](<../a/My Note.md>)')
    expect(lines[1]).toBe('[far](../x/Far.md) ![圖](../img.png) [外](https://a/b.md) [根](/abs.md)')
    expect(lines[2]).toBe('`[t](../Target.md)` 不動')
    expect(result.count).toBe(4)
  })

  it('其他筆記指向被搬動檔案的相對連結更新；沒有編碼時空白改成 %20', () => {
    const paths = ['Source.md', 'notes/Old.md', 'Other.md']
    const moves = [{ sourcePath: 'notes/Old.md', targetPath: 'my notes/New.md' }]
    const content = '看 [舊](notes/Old.md) 與 [別的](Other.md)\r\n'
    const result = rewrite(content, moves, paths)
    expect(result.content).toBe('看 [舊](my%20notes/New.md) 與 [別的](Other.md)\r\n')
    expect(result.count).toBe(1)
  })

  it('從 vault 根目錄寫的 markdown 路徑也認得', () => {
    const paths = ['deep/Source.md', 'notes/Old.md']
    const moves = [{ sourcePath: 'notes/Old.md', targetPath: 'notes/New.md' }]
    const result = rewrite('[舊](notes/Old.md)\n', moves, paths, 'deep/Source.md')
    expect(result.content).toBe('[舊](notes/New.md)\n')
  })
})

describe('collectLinkRewriteCandidates', () => {
  const notes = [
    indexNote('Source.md', '[[Old]] 文字', 1),
    indexNote('Md.md', '[t](notes/Old.md)', 1),
    indexNote('notes/Old.md', '我自己 [[Other]]', 1),
    indexNote('Unrelated.md', '[[Other]]', 1),
    indexNote('Other.md', '', 1),
    indexNote('Twin.md', '[[Other]] 指向沒搬的 Other', 1),
  ]

  it('列出連到被搬動檔案的、被搬動的本身；排除無關的', () => {
    const moves = [{ sourcePath: 'notes/Old.md', targetPath: 'notes/New.md' }]
    expect(collectLinkRewriteCandidates(moves, notes)).toEqual(['Source.md', 'Md.md', 'notes/Old.md'])
  })

  it('改名造成同名時，指向同名筆記的也列入', () => {
    const moves = [{ sourcePath: 'notes/Old.md', targetPath: 'notes/Other.md' }]
    expect(collectLinkRewriteCandidates(moves, notes)).toEqual(['Source.md', 'Md.md', 'notes/Old.md', 'Unrelated.md', 'Twin.md'])
  })

  it('索引已被 watcher 更新成新路徑時，仍回傳搬動前的路徑', () => {
    const moves = [{ sourcePath: 'notes', targetPath: 'archive' }]
    const updated = notes.map(note => indexNote(mapMovedPath(note.path, moves), note.links.length ? '[[Old]]' : '', 1))
    expect(collectLinkRewriteCandidates(moves, updated)).toContain('notes/Old.md')
    expect(collectLinkRewriteCandidates(moves, updated)).not.toContain('archive/Old.md')
    expect(collectLinkRewriteCandidates([], notes)).toEqual([])
  })
})
