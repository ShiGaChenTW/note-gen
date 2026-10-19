import { describe, expect, it } from 'vitest'
import type { IndexedNote } from './index-note'
import { buildTagTree, collectNotesForTag, filterTagTree, normalizeTag, sortTagTree } from './tags'
import useVaultIndexStore, { selectTagTree } from '@/stores/vault-index'

function note(path: string, tags: string[]): IndexedNote {
  return { path, mtime: 1, frontmatter: null, tasks: [], links: [], aliases: [], tags, headings: [], blockIds: [] }
}

describe('normalizeTag', () => {
  it('strips hashes, trims, lowercases and drops empty segments', () => {
    expect(normalizeTag('  #Hello/World ')).toBe('hello/world')
    expect(normalizeTag('##Tag')).toBe('tag')
    expect(normalizeTag('#')).toBe('')
    expect(normalizeTag('#/A//B/')).toBe('a/b')
    expect(normalizeTag('A / B')).toBe('a/b')
    expect(normalizeTag('   ')).toBe('')
  })
})

describe('buildTagTree', () => {
  it('nests tags, dedupes a note that has both parent and child, and implies missing parents', () => {
    const tree = buildTagTree([
      note('a.md', ['#work', '#work/project', '#Work/Project']),
      note('b.md', ['#work/other']),
      note('c.md', ['#other']),
      note('d.md', ['', '#', '#/']),
    ])
    expect(tree).toEqual([
      {
        name: 'other',
        fullPath: 'other',
        count: 1,
        children: [],
      },
      {
        name: 'work',
        fullPath: 'work',
        count: 2,
        children: [
          { name: 'other', fullPath: 'work/other', count: 1, children: [] },
          { name: 'project', fullPath: 'work/project', count: 1, children: [] },
        ],
      },
    ])
  })

  it('keeps the first spelling it sees and does not let a later casing replace it', () => {
    const tree = buildTagTree([
      note('b.md', ['#project/Beta']),
      note('a.md', ['#Project', '#PROJECT/beta/Gamma']),
    ])
    expect(tree).toEqual([
      {
        name: 'project',
        fullPath: 'project',
        count: 2,
        children: [
          {
            name: 'Beta',
            fullPath: 'project/beta',
            count: 2,
            children: [
              { name: 'Gamma', fullPath: 'project/beta/gamma', count: 1, children: [] },
            ],
          },
        ],
      },
    ])
  })

  it('returns an empty tree when nothing has a tag', () => {
    expect(buildTagTree([note('a.md', []), note('b.md', ['#'])])).toEqual([])
  })
})

describe('collectNotesForTag', () => {
  const notes = [
    note('z/b.md', ['#topic']),
    note('a.md', ['#Topic']),
    note('m/c.md', ['#topic/sub']),
    note('B/a.md', ['#topical']),
    note('b/a.md', ['#topic']),
  ]

  it('sorts paths and includes nested tags unless asked not to', () => {
    expect(collectNotesForTag('Topic', notes)).toEqual(['a.md', 'b/a.md', 'm/c.md', 'z/b.md'])
    expect(collectNotesForTag('topic/sub', notes, { includeNested: false })).toEqual(['m/c.md'])
    expect(collectNotesForTag('topic', notes, { includeNested: false })).toEqual(['a.md', 'b/a.md', 'z/b.md'])
    expect(collectNotesForTag('#', notes)).toEqual([])
    expect(collectNotesForTag('topic', [note('a.md', ['#t']), note('a.md', ['#topic'])])).toEqual(['a.md'])
  })
})

describe('filterTagTree', () => {
  const tree = buildTagTree([
    note('a.md', ['#cat']),
    note('b.md', ['#cat/dog']),
    note('c.md', ['#cat/mouse']),
    note('d.md', ['#personal']),
  ])

  it('keeps matches and ancestors, drops other siblings, and leaves the input untouched', () => {
    const snapshot = JSON.stringify(tree)
    const filtered = filterTagTree(tree, '  #DOG ')
    expect(filtered).toEqual([
      {
        name: 'cat',
        fullPath: 'cat',
        count: 3,
        children: [
          { name: 'dog', fullPath: 'cat/dog', count: 1, children: [] },
        ],
      },
    ])
    expect(filtered[0]).not.toBe(tree[0])
    expect(filtered[0].children[0]).toBe(tree[0].children[0])
    expect(filterTagTree(tree, 'cat').map(node => node.fullPath)).toEqual(['cat'])
    expect(filterTagTree(tree, 'cat')[0].children).toHaveLength(2)
    expect(filterTagTree(tree, 'missing')).toEqual([])
    expect(filterTagTree(tree, '')).toBe(tree)
    expect(filterTagTree(tree, '   ')).toBe(tree)
    expect(filterTagTree(tree, '#')).toBe(tree)
    expect(filterTagTree(tree, '#/')).toBe(tree)
    sortTagTree(tree, 'count')
    expect(JSON.stringify(tree)).toBe(snapshot)
  })
})

describe('sortTagTree', () => {
  it('sorts by name or descending count without mutating, and sorts children too', () => {
    const tree = buildTagTree([
      note('a.md', ['#work', '#work/project']),
      note('b.md', ['#work/project']),
      note('c.md', ['#work/other']),
      note('d.md', ['#other']),
    ])
    expect(tree.map(node => node.name)).toEqual(['other', 'work'])
    expect(tree[1].children.map(node => node.name)).toEqual(['other', 'project'])
    const byCount = sortTagTree(tree, 'count')
    expect(byCount.map(node => [node.name, node.count])).toEqual([['work', 3], ['other', 1]])
    expect(byCount[0].children.map(node => [node.name, node.count])).toEqual([['project', 2], ['other', 1]])
    expect(sortTagTree(tree, 'name')).toEqual(tree)
    expect(sortTagTree(tree, 'name')).not.toBe(tree)
    expect(tree.map(node => node.name)).toEqual(['other', 'work'])
  })
})

describe('selectTagTree', () => {
  it('memoizes by revision and rebuilds after edits, removals and workspace resets', () => {
    const store = useVaultIndexStore
    store.getState().reset('tags')
    store.getState().replaceAll(new Map([['a.md', note('a.md', ['#A/B'])]]))
    const first = store.getState()
    const tree = selectTagTree(first)
    expect(tree[0].name).toBe('A')
    expect(tree[0].children[0].name).toBe('B')
    expect(tree[0].count).toBe(1)
    expect(selectTagTree(first)).toBe(tree)
    store.getState().setStatus('ready')
    expect(selectTagTree(store.getState())).toBe(tree)
    store.getState().upsert([note('b.md', ['#A'])])
    const next = selectTagTree(store.getState())
    expect(next).not.toBe(tree)
    expect(next[0].count).toBe(2)
    expect(next[0].name).toBe('A')
    store.getState().remove(['a.md'])
    const remaining = selectTagTree(store.getState())
    expect(remaining[0].count).toBe(1)
    expect(remaining[0].children).toEqual([])
    expect(selectTagTree(store.getState())).toBe(remaining)
    store.getState().reset('other')
    expect(selectTagTree(store.getState())).toEqual([])
  })
})
