import { describe, expect, it } from 'vitest'
import {
  buildCreateInsertion,
  buildWikilinkInsertion,
  findWikilinkInputContext,
  isExactNoteName,
  rankBlockSuggestions,
  rankHeadingSuggestions,
  rankWikilinkSuggestions,
  type WikilinkSuggestNote,
} from './wikilink-suggest-model'

const notes: WikilinkSuggestNote[] = [
  { path: 'Cat.md', aliases: [], mtime: 10 },
  { path: 'Dog.md', aliases: ['Camel', 'Scale'], mtime: 10 },
  { path: 'Scatter.md', aliases: [], mtime: 10 },
  { path: 'Bird.md', aliases: ['Scale'], mtime: 10 },
  { path: 'catalog/emu.md', aliases: [], mtime: 10 },
  { path: 'readme.txt', aliases: ['Cat'], mtime: 99 },
  { path: '目前.md', aliases: [], mtime: 99 },
]

describe('findWikilinkInputContext', () => {
  it('空的 [[ 回傳空 query 與起點', () => {
    expect(findWikilinkInputContext('看 [[')).toEqual({ query: '', from: 2, mode: 'note', noteQuery: '' })
    expect(findWikilinkInputContext('[[')).toEqual({ query: '', from: 0, mode: 'note', noteQuery: '' })
  })

  it('回傳 [[ 之後的 query', () => {
    expect(findWikilinkInputContext('see [[會議')).toEqual({ query: '會議', from: 4, mode: 'note', noteQuery: '' })
  })

  it('![[ 也算，from 指在 [[', () => {
    expect(findWikilinkInputContext('![[圖')).toEqual({ query: '圖', from: 1, mode: 'note', noteQuery: '' })
  })

  it('前面是反斜線的最後一個 [[ 不算', () => {
    expect(findWikilinkInputContext('\\[[yes')).toBeNull()
    expect(findWikilinkInputContext('[[yes \\[[')).toBeNull()
  })

  it('跳脫在前面時仍用最後一個未跳脫的 [[', () => {
    expect(findWikilinkInputContext('\\[[no [[yes')).toEqual({ query: 'yes', from: 6, mode: 'note', noteQuery: '' })
  })

  it('到游標之間有 ]]、換行、[ 或 ] 就不是未完成的連結', () => {
    expect(findWikilinkInputContext('[[Note]]')).toBeNull()
    expect(findWikilinkInputContext('[[Note]] 之後')).toBeNull()
    expect(findWikilinkInputContext('[[ab\ncd')).toBeNull()
    expect(findWikilinkInputContext('[[ab[cd')).toBeNull()
    expect(findWikilinkInputContext('[[ab]cd')).toBeNull()
  })

  it('已關閉的連結後面還有未完成的 [[', () => {
    expect(findWikilinkInputContext('[[Done]] 然後 [[next')).toEqual({ query: 'next', from: 12, mode: 'note', noteQuery: '' })
  })

  it('沒有 [[ 時回 null', () => {
    expect(findWikilinkInputContext('沒有連結')).toBeNull()
    expect(findWikilinkInputContext('')).toBeNull()
  })

  it('第一個 # 進入標題模式，query 是 # 之後', () => {
    expect(findWikilinkInputContext('看 [[筆記#標題')).toEqual({
      query: '標題', from: 2, mode: 'heading', noteQuery: '筆記',
    })
    expect(findWikilinkInputContext('[[Note#')).toEqual({
      query: '', from: 0, mode: 'heading', noteQuery: 'Note',
    })
    expect(findWikilinkInputContext('[[#標題')).toEqual({
      query: '標題', from: 0, mode: 'heading', noteQuery: '',
    })
    expect(findWikilinkInputContext('[[folder/Note#H')).toEqual({
      query: 'H', from: 0, mode: 'heading', noteQuery: 'folder/Note',
    })
  })

  it('#^ 進入區塊模式，本篇與其他筆記都算', () => {
    expect(findWikilinkInputContext('[[Note#^')).toEqual({
      query: '', from: 0, mode: 'block', noteQuery: 'Note',
    })
    expect(findWikilinkInputContext('[[Note#^abc')).toEqual({
      query: 'abc', from: 0, mode: 'block', noteQuery: 'Note',
    })
    expect(findWikilinkInputContext('![[#^id')).toEqual({
      query: 'id', from: 1, mode: 'block', noteQuery: '',
    })
    expect(findWikilinkInputContext('[[Note|別名#頭')).toEqual({
      query: '頭', from: 0, mode: 'heading', noteQuery: 'Note|別名',
    })
  })

  it('標題或區塊寫到一半若已有 ]]、換行或括號，仍然不是未完成的連結', () => {
    expect(findWikilinkInputContext('[[Note#標題]]')).toBeNull()
    expect(findWikilinkInputContext('[[Note#^id]]')).toBeNull()
    expect(findWikilinkInputContext('[[#\n標題')).toBeNull()
  })
})

describe('rankWikilinkSuggestions', () => {
  it('名稱前綴 > 別名前綴 > 名稱子序列 > 別名子序列 > 路徑子序列', () => {
    const ranked = rankWikilinkSuggestions({
      query: 'ca',
      notes,
      currentPath: '目前.md',
    })
    expect(ranked.map(item => [item.path, item.matchedAlias])).toEqual([
      ['Cat.md', null],
      ['Dog.md', 'Camel'],
      ['Scatter.md', null],
      ['Bird.md', 'Scale'],
      ['catalog/emu.md', null],
    ])
    const scores = ranked.map(item => item.score)
    expect([...scores].sort((left, right) => right - left)).toEqual(scores)
    expect(new Set(scores).size).toBe(scores.length)
  })

  it('用 toLowerCase 比對，不區分大小寫', () => {
    const ranked = rankWikilinkSuggestions({
      query: 'CAT',
      notes,
      currentPath: '',
    })
    expect(ranked[0]).toMatchObject({ path: 'Cat.md', label: 'Cat', matchedAlias: null })
  })

  it('中文名稱前綴與子序列', () => {
    const zh: WikilinkSuggestNote[] = [
      { path: '筆記系統.md', aliases: ['備忘'] },
      { path: '其他.md', aliases: ['筆與紙'] },
    ]
    expect(rankWikilinkSuggestions({ query: '筆記', notes: zh, currentPath: '' }).map(item => item.path))
      .toEqual(['筆記系統.md'])
    expect(rankWikilinkSuggestions({ query: '筆系', notes: zh, currentPath: '' }).map(item => [item.path, item.matchedAlias]))
      .toEqual([['筆記系統.md', null]])
    expect(rankWikilinkSuggestions({ query: '筆與', notes: zh, currentPath: '' })[0])
      .toMatchObject({ path: '其他.md', matchedAlias: '筆與紙' })
  })

  it('只收 .md，並排除目前筆記', () => {
    const ranked = rankWikilinkSuggestions({
      query: 'cat',
      notes: [
        ...notes,
        { path: 'cat.png', aliases: ['cat'] },
      ],
      currentPath: 'Cat.md',
    })
    expect(ranked.map(item => item.path)).not.toContain('Cat.md')
    expect(ranked.map(item => item.path)).not.toContain('cat.png')
    expect(ranked.map(item => item.path)).not.toContain('readme.txt')
  })

  it('帶資料夾時 label 是檔名、folder 是目錄', () => {
    const ranked = rankWikilinkSuggestions({
      query: 'emu',
      notes,
      currentPath: '',
    })
    expect(ranked[0]).toMatchObject({ path: 'catalog/emu.md', label: 'emu', folder: 'catalog', matchedAlias: null })
  })

  it('同分時最近修改優先，修改時間相同則較短路徑優先', () => {
    const tied: WikilinkSuggestNote[] = [
      { path: 'dir/Alpine.md', aliases: [], mtime: 50 },
      { path: 'Alp.md', aliases: [], mtime: 50 },
      { path: 'Alpha.md', aliases: [], mtime: 10 },
    ]
    expect(rankWikilinkSuggestions({ query: 'alp', notes: tied, currentPath: '' }).map(item => item.path))
      .toEqual(['Alp.md', 'dir/Alpine.md', 'Alpha.md'])
  })

  it('空 query 依 recentPaths 順序，不含目前筆記與其他筆記', () => {
    const ranked = rankWikilinkSuggestions({
      query: '',
      notes,
      currentPath: '目前.md',
      recentPaths: ['目前.md', 'Bird.md', 'Cat.md', '不存在.md'],
    })
    expect(ranked.map(item => item.path)).toEqual(['Bird.md', 'Cat.md'])
    expect(ranked.every(item => item.matchedAlias === null)).toBe(true)
  })

  it('空 query 的 recentPaths 都對不到時，改依修改時間', () => {
    const ranked = rankWikilinkSuggestions({
      query: '',
      notes: [
        { path: '舊.md', aliases: [], mtime: 1 },
        { path: '新.md', aliases: [], mtime: 20 },
        { path: '目前.md', aliases: [], mtime: 99 },
      ],
      currentPath: '目前.md',
      recentPaths: ['目前.md'],
    })
    expect(ranked.map(item => item.path)).toEqual(['新.md', '舊.md'])
  })

  it('空 query 沒有 recentPaths 時依修改時間，其次較短路徑', () => {
    const ranked = rankWikilinkSuggestions({
      query: '',
      notes: [
        { path: 'folder/same.md', aliases: [], mtime: 5 },
        { path: 'same.md', aliases: [], mtime: 5 },
        { path: 'newer.md', aliases: [], mtime: 8 },
      ],
      currentPath: '',
    })
    expect(ranked.map(item => item.path)).toEqual(['newer.md', 'same.md', 'folder/same.md'])
  })

  it('預設最多 8 筆，可改 limit', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      path: `N${index}.md`,
      aliases: [] as string[],
      mtime: index,
    }))
    expect(rankWikilinkSuggestions({ query: 'n', notes: many, currentPath: '' })).toHaveLength(8)
    expect(rankWikilinkSuggestions({ query: 'n', notes: many, currentPath: '', limit: 3 })).toHaveLength(3)
    expect(rankWikilinkSuggestions({ query: '', notes: many, currentPath: '' })).toHaveLength(8)
  })

  it('多個別名時完全相符優先', () => {
    const ranked = rankWikilinkSuggestions({
      query: 'cat',
      notes: [{ path: 'Pet.md', aliases: ['Catch', 'Cat', 'Catalog'] }],
      currentPath: '',
    })
    expect(ranked[0]?.matchedAlias).toBe('Cat')
  })
})

describe('buildWikilinkInsertion', () => {
  const allPaths = ['Cat.md', 'folder/Cat.md', 'other/Cat.md', 'Dog.md']

  it('檔名唯一時只寫檔名，並補上 ]]', () => {
    expect(buildWikilinkInsertion({
      suggestion: { path: 'Dog.md', matchedAlias: null },
      allPaths,
      hasClosingBrackets: false,
    })).toBe('[[Dog]]')
  })

  it('同名時寫完整路徑且不含 .md', () => {
    expect(buildWikilinkInsertion({
      suggestion: { path: 'folder/Cat.md', matchedAlias: null },
      allPaths,
      hasClosingBrackets: false,
    })).toBe('[[folder/Cat]]')
  })

  it('用別名選到時輸出 [[目標|別名]]', () => {
    expect(buildWikilinkInsertion({
      suggestion: { path: 'Dog.md', matchedAlias: '駱駝' },
      allPaths,
      hasClosingBrackets: false,
    })).toBe('[[Dog|駱駝]]')
  })

  it('游標後已有 ]] 時不重複補上', () => {
    expect(buildWikilinkInsertion({
      suggestion: { path: 'Dog.md', matchedAlias: '駱駝' },
      allPaths,
      hasClosingBrackets: true,
    })).toBe('[[Dog|駱駝')
    expect(buildWikilinkInsertion({
      suggestion: { path: 'Dog.md', matchedAlias: null },
      allPaths,
      hasClosingBrackets: true,
    })).toBe('[[Dog')
  })

  it('標題與區塊：其他筆記寫名稱，本篇留空，已有 ]] 不重複補', () => {
    expect(buildWikilinkInsertion({
      suggestion: { path: 'Dog.md', matchedAlias: null },
      allPaths,
      hasClosingBrackets: false,
      heading: '標題',
    })).toBe('[[Dog#標題]]')
    expect(buildWikilinkInsertion({
      suggestion: { path: 'folder/Cat.md', matchedAlias: null },
      allPaths,
      hasClosingBrackets: false,
      heading: 'H',
    })).toBe('[[folder/Cat#H]]')
    expect(buildWikilinkInsertion({
      suggestion: { path: 'Dog.md', matchedAlias: null },
      allPaths,
      hasClosingBrackets: false,
      blockId: 'abc',
    })).toBe('[[Dog#^abc]]')
    expect(buildWikilinkInsertion({
      suggestion: { path: '目前.md', matchedAlias: null },
      allPaths,
      hasClosingBrackets: false,
      heading: '標題',
      self: true,
    })).toBe('[[#標題]]')
    expect(buildWikilinkInsertion({
      suggestion: { path: '目前.md', matchedAlias: null },
      allPaths,
      hasClosingBrackets: true,
      blockId: 'abc',
      self: true,
    })).toBe('[[#^abc')
    expect(buildWikilinkInsertion({
      suggestion: { path: 'Dog.md', matchedAlias: '別名' },
      allPaths,
      hasClosingBrackets: false,
      heading: '甲|乙',
    })).toBe('[[Dog#甲\\|乙|別名]]')
  })
})

describe('buildCreateInsertion', () => {
  it('輸出 [[query]]', () => {
    expect(buildCreateInsertion('新筆記')).toBe('[[新筆記]]')
    expect(buildCreateInsertion('')).toBe('[[]]')
  })
})

const anchorNotes: WikilinkSuggestNote[] = [
  {
    path: '目前.md',
    aliases: [],
    mtime: 1,
    headings: [
      { level: 1, text: '開頭', line: 0 },
      { level: 2, text: '細節', line: 4 },
      { level: 2, text: '設計專案', line: 8 },
      { level: 3, text: '', line: 9 },
    ],
    blockIds: [
      { id: 'intro', line: 2, context: '第一段' },
      { id: 'detail', line: 6, context: '細節那一行的前段' },
    ],
  },
  {
    path: 'Alpha.md',
    aliases: ['甲'],
    headings: [
      { level: 1, text: 'Alpha 標題', line: 1 },
      { level: 2, text: '其他', line: 3 },
    ],
    blockIds: [{ id: 'a-id', line: 5, context: '甲的段落，這行很長但不拿來比對' }],
  },
  {
    path: 'Alpine.md',
    aliases: [],
    headings: [{ level: 1, text: '山', line: 0 }],
    blockIds: [{ id: 'alp', line: 1, context: '山的區塊' }],
  },
  {
    path: 'folder/Note.md',
    aliases: [],
    headings: [{ level: 1, text: '資料夾', line: 0 }],
    blockIds: [],
  },
  {
    path: 'other/Note.md',
    aliases: [],
    headings: [{ level: 1, text: '另一份', line: 0 }],
    blockIds: [],
  },
]

describe('rankHeadingSuggestions', () => {
  it('本篇 [[# 列出目前筆記的標題，略過空白標題，target 為空', () => {
    const result = rankHeadingSuggestions({
      noteQuery: '',
      query: '',
      notes: anchorNotes,
      currentPath: '目前.md',
    })
    expect(result.notePath).toBe('目前.md')
    expect(result.total).toBe(3)
    expect(result.suggestions.map(item => [item.text, item.level, item.target, item.line])).toEqual([
      ['開頭', 1, '', 0],
      ['細節', 2, '', 4],
      ['設計專案', 2, '', 8],
    ])
  })

  it('前綴高於子序列，大小寫不拘，層級照原樣', () => {
    const result = rankHeadingSuggestions({
      noteQuery: '目前',
      query: '專案',
      notes: anchorNotes,
      currentPath: '其他.md',
    })
    expect(result.suggestions.map(item => [item.text, item.score])).toEqual([
      ['設計專案', 300],
    ])
    const prefix = rankHeadingSuggestions({
      noteQuery: 'alpha',
      query: 'alpha',
      notes: anchorNotes,
      currentPath: '',
    })
    expect(prefix.notePath).toBe('Alpha.md')
    expect(prefix.suggestions.map(item => item.text)).toEqual(['Alpha 標題'])
    expect(prefix.suggestions[0].score).toBeGreaterThan(
      rankHeadingSuggestions({
        noteQuery: 'Alpha',
        query: '標題',
        notes: anchorNotes,
        currentPath: '',
      }).suggestions[0]?.score ?? 0,
    )
  })

  it('完全同名時即使另一篇有相同前綴，仍用那一篇；打了筆記名就不算本篇空目標', () => {
    const result = rankHeadingSuggestions({
      noteQuery: 'Alpha',
      query: '',
      notes: anchorNotes,
      currentPath: 'Alpha.md',
    })
    expect(result.notePath).toBe('Alpha.md')
    expect(result.suggestions.map(item => item.target)).toEqual(['Alpha', 'Alpha'])
  })

  it('別名會從 noteQuery 拿掉再對筆記', () => {
    const result = rankHeadingSuggestions({
      noteQuery: 'Alpha|別名',
      query: '',
      notes: anchorNotes,
      currentPath: '',
    })
    expect(result.notePath).toBe('Alpha.md')
    expect(result.suggestions.map(item => item.text)).toEqual(['Alpha 標題', '其他'])
  })

  it('前綴打平、或同名有兩篇時，不列標題', () => {
    expect(rankHeadingSuggestions({
      noteQuery: 'Alp',
      query: '',
      notes: anchorNotes,
      currentPath: '',
    })).toEqual({ notePath: null, total: 0, suggestions: [] })
    expect(rankHeadingSuggestions({
      noteQuery: 'Note',
      query: '',
      notes: anchorNotes,
      currentPath: '目前.md',
    }).notePath).toBeNull()
    expect(rankHeadingSuggestions({
      noteQuery: 'folder/Note',
      query: '',
      notes: anchorNotes,
      currentPath: '',
    }).suggestions.map(item => item.text)).toEqual(['資料夾'])
  })

  it('沒有這篇、或這篇沒有符合的標題', () => {
    expect(rankHeadingSuggestions({
      noteQuery: '',
      query: '',
      notes: anchorNotes,
      currentPath: '',
    }).notePath).toBeNull()
    const missed = rankHeadingSuggestions({
      noteQuery: '',
      query: '沒有',
      notes: anchorNotes,
      currentPath: '目前.md',
    })
    expect(missed.notePath).toBe('目前.md')
    expect(missed.total).toBe(3)
    expect(missed.suggestions).toEqual([])
  })
})

describe('rankBlockSuggestions', () => {
  it('本篇列出區塊 id 與那一行的上下文', () => {
    const result = rankBlockSuggestions({
      noteQuery: '',
      query: '',
      notes: anchorNotes,
      currentPath: '目前.md',
    })
    expect(result.suggestions.map(item => [item.id, item.context, item.target])).toEqual([
      ['intro', '第一段', ''],
      ['detail', '細節那一行的前段', ''],
    ])
  })

  it('用 id 的前綴與子序列排序，不拿上下文來比', () => {
    const result = rankBlockSuggestions({
      noteQuery: '甲',
      query: 'id',
      notes: anchorNotes,
      currentPath: '',
    })
    expect(result.notePath).toBe('Alpha.md')
    expect(result.suggestions.map(item => item.id)).toEqual(['a-id'])
    expect(rankBlockSuggestions({
      noteQuery: 'Alpha',
      query: '段落',
      notes: anchorNotes,
      currentPath: '',
    }).suggestions).toEqual([])
  })

  it('這篇沒有區塊時 total 為 0', () => {
    const result = rankBlockSuggestions({
      noteQuery: 'folder/Note',
      query: '',
      notes: anchorNotes,
      currentPath: '',
    })
    expect(result).toEqual({ notePath: 'folder/Note.md', total: 0, suggestions: [] })
  })
})

describe('isExactNoteName', () => {
  it('比對筆記名稱或完整路徑，忽略 .md 與大小寫', () => {
    expect(isExactNoteName('cat', 'folder/Cat.md')).toBe(true)
    expect(isExactNoteName('Cat.md', 'folder/Cat.md')).toBe(true)
    expect(isExactNoteName('folder/cat', 'folder/Cat.md')).toBe(true)
    expect(isExactNoteName('folder/Cat.md', 'folder/Cat.md')).toBe(true)
    expect(isExactNoteName('other/Cat', 'folder/Cat.md')).toBe(false)
    expect(isExactNoteName('dog', 'folder/Cat.md')).toBe(false)
    expect(isExactNoteName('', 'Cat.md')).toBe(false)
  })
})
