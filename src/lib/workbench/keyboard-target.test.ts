// @vitest-environment jsdom
// Fork（almanac ALMNC-56.1，A01）：哪些按鍵該讓給焦點所在的元件。
import { afterEach, describe, expect, it } from 'vitest'
import { globalShortcutFor, keyBelongsToTarget } from './keyboard-target'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

afterEach(() => { document.body.innerHTML = '' })

describe('keyBelongsToTarget', () => {
  it('leaves every key to the workbench when focus is on the page itself', () => {
    const page = mount('<div role="region" tabindex="-1"><p>text</p></div>')
    for (const key of ['Enter', ' ', 'ArrowDown', 'j', 'z']) {
      expect(keyBelongsToTarget(page.querySelector('[role="region"]'), key)).toBe(false)
      expect(keyBelongsToTarget(page.querySelector('p')!.firstChild, key)).toBe(false)
    }
    expect(keyBelongsToTarget(window, 'Enter')).toBe(false)
    expect(keyBelongsToTarget(document.body, 'Enter')).toBe(false)
    expect(keyBelongsToTarget(null, 'Enter')).toBe(false)
  })

  it('gives Enter, Space and arrows to buttons, links, tabs and checkboxes (their own action)', () => {
    const host = mount(`
      <button id="b"><span id="inside">icon</span></button>
      <a id="a" href="#x">link</a>
      <div role="tablist"><button role="tab" id="tab">tab</button></div>
      <button role="checkbox" id="check" aria-checked="false"></button>
      <div role="separator" tabindex="0" id="sep"></div>`)
    for (const id of ['b', 'inside', 'a', 'tab', 'check', 'sep']) {
      const element = host.querySelector(`#${id}`)
      expect(keyBelongsToTarget(element, 'Enter')).toBe(true)
      expect(keyBelongsToTarget(element, ' ')).toBe(true)
      expect(keyBelongsToTarget(element, 'ArrowDown')).toBe(true)
      // 其他單鍵（j、k、z…）照常給工作台
      expect(keyBelongsToTarget(element, 'j')).toBe(false)
    }
  })

  it('gives every key (arrows and type-ahead letters) to open menus and foreign listboxes', () => {
    const host = mount(`
      <div role="menu"><div role="menuitem" id="item" tabindex="-1">One</div><div id="plain">x</div></div>
      <div role="listbox" id="select"><div role="option" id="opt">A</div></div>
      <div role="combobox" id="combo"></div>`)
    for (const id of ['item', 'plain', 'opt', 'combo']) {
      for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'n', 't', 'j']) {
        expect(keyBelongsToTarget(host.querySelector(`#${id}`), key)).toBe(true)
      }
    }
  })

  it('treats items of the workbench lists as the list: single keys stay with the workbench', () => {
    const host = mount(`
      <div role="list">
        <div role="listitem" id="row"><button role="checkbox" id="pick"></button><button data-workbench-item id="select"><span id="title">title</span></button></div>
        <div role="listitem"><button data-workbench-item id="toggle">card</button><button id="action">Accept</button></div>
      </div>`)
    for (const key of ['Enter', ' ', 'ArrowDown', 'j', 'k', 'z']) {
      expect(keyBelongsToTarget(host.querySelector('#row'), key)).toBe(false)
      expect(keyBelongsToTarget(host.querySelector('#select'), key)).toBe(false)
      expect(keyBelongsToTarget(host.querySelector('#title'), key)).toBe(false)
      expect(keyBelongsToTarget(host.querySelector('#toggle'), key)).toBe(false)
    }
    // 清單項目裡另外的按鈕（勾選框、卡片動作）仍是自己的按鈕
    expect(keyBelongsToTarget(host.querySelector('#pick'), ' ')).toBe(true)
    expect(keyBelongsToTarget(host.querySelector('#action'), 'Enter')).toBe(true)
  })
})

describe('globalShortcutFor (ALMNC-56.4 A02)', () => {
  const on = { enabled: true, workbenchOpen: true, deskOpen: false }

  it('maps N and T only while the workbench is open', () => {
    expect(globalShortcutFor('n', on)).toBe('addSource')
    expect(globalShortcutFor('T', on)).toBe('newConversation')
    expect(globalShortcutFor('j', on)).toBeNull()
    expect(globalShortcutFor('n', { ...on, workbenchOpen: false })).toBeNull()
    expect(globalShortcutFor('t', { ...on, workbenchOpen: false })).toBeNull()
  })

  it('does nothing when turned off in settings or on the desk', () => {
    expect(globalShortcutFor('n', { ...on, enabled: false })).toBeNull()
    expect(globalShortcutFor('t', { ...on, deskOpen: true })).toBeNull()
  })
})
