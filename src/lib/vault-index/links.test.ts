import { describe, expect, it } from 'vitest'
import { indexNote } from './index-note'
import { collectBacklinks, collectOutgoingLinks, resolveIndexedLink } from './links'
import useVaultIndexStore, { selectBacklinks, selectOutgoingLinks } from '@/stores/vault-index'

const note = (path: string, content = '') => indexNote(path, content, 1)

describe('indexed link queries', () => {
  it('resolves duplicate names by full path, same folder then shortest path', () => {
    const paths = ['long/Note.md', 'x/Note.md', 'here/Note.md']
    const link = note('here/a.md', '[[Note]]').links[0]
    expect(resolveIndexedLink(link, paths, 'here/a.md')).toBe('here/Note.md')
    expect(resolveIndexedLink(link, paths, 'else/a.md')).toBe('x/Note.md')
    expect(resolveIndexedLink({ ...link, target: 'LONG/note' }, paths, 'here/a.md')).toBe('long/Note.md')
  })

  it('collects aliases, embeds and relative markdown links sorted by source and line, excluding self links', () => {
    const notes = [note('z.md', '[[Target|別名]]'), note('Target.md', '[[Target]] [[#標題]]'),
      note('a/source.md', 'text\n![[Target#段落]]\n[文字](../target.md)'), note('missing.md', '[[未知]]')]
    const refs = collectBacklinks('Target.md', notes.values())
    expect(refs.map(ref => [ref.sourcePath, ref.line, ref.alias, ref.embed])).toEqual([
      ['a/source.md', 1, '', true], ['a/source.md', 2, '文字', false], ['z.md', 0, '別名', false],
    ])
    expect(collectOutgoingLinks('a/source.md', notes).map(link => link.resolved)).toEqual(['Target.md', 'Target.md'])
    expect(collectOutgoingLinks('missing.md', notes)[0].resolved).toBeNull()
    expect(collectOutgoingLinks('absent.md', notes)).toEqual([])
  })
})

describe('link selectors', () => {
  it('caches separately per path and invalidates on edits, removals and workspace resets', () => {
    const store = useVaultIndexStore
    store.getState().reset('one')
    store.getState().replaceAll(new Map([['a.md', note('a.md', '[[b]]')], ['b.md', note('b.md')]]))
    const first = store.getState()
    const backlinks = selectBacklinks(first, 'b.md')
    const outgoing = selectOutgoingLinks(first, 'a.md')
    expect(selectBacklinks(first, 'a.md')).toEqual([])
    expect(selectBacklinks(first, 'b.md')).toBe(backlinks)
    expect(selectOutgoingLinks(first, 'b.md')).toEqual([])
    expect(selectOutgoingLinks(first, 'a.md')).toBe(outgoing)
    store.getState().setStatus('ready')
    expect(selectBacklinks(store.getState(), 'b.md')).toBe(backlinks)
    store.getState().upsert([note('a.md', '[[missing]]')])
    expect(selectBacklinks(store.getState(), 'b.md')).toEqual([])
    expect(selectOutgoingLinks(store.getState(), 'a.md')[0].resolved).toBeNull()
    store.getState().remove(['a.md'])
    expect(selectOutgoingLinks(store.getState(), 'a.md')).toEqual([])
    store.getState().reset('two')
    expect(selectBacklinks(store.getState(), 'b.md')).toEqual([])
  })
})
