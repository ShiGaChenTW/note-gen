// @vitest-environment jsdom
// almanac ALMNC-83.5：設定 > 夥伴（只在 V3）收納夥伴名單、Agent 設定區、調研與回顧、自動整理、自動接受；
// 常規設定改名「一般」、「拓展」改「擴充」；RSS 搬到電子紙頁、和稍後讀放一起。classic 不變。
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'
import {
  fallbackSettingSection, isSettingSectionVisible, isV3OnlySettingSection, settingSections,
} from '@/stores/settings-dialog'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import zhTW from '../../../../../messages/zh-TW.json'

vi.mock('next-intl', async importOriginal => {
  const intl = await importOriginal<typeof import('next-intl')>()
  return {
    ...intl,
    useLocale: () => 'en',
    useTranslations: (namespace?: string) => intl.createTranslator({ locale: 'en', messages: en, namespace: namespace as never }),
  }
})
// 子區塊各自有測試；這裡只驗證分頁收了哪些區塊。
vi.mock('../agents/agent-settings', () => ({ AgentSettings: () => React.createElement('p', null, 'stub:agents') }))
vi.mock('../../main/organize/organize-settings', () => ({ OrganizeSettings: () => React.createElement('p', null, 'stub:organize') }))
vi.mock('../general/auto-accept-settings', () => ({ AutoAcceptSettings: () => React.createElement('p', null, 'stub:auto-accept') }))

import PartnersSettingPage from './page'

const SETTING = join(__dirname, '..')
const source = (path: string) => readFileSync(join(SETTING, path), 'utf8')

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, {
    React, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('夥伴分頁的登記與可見性', () => {
  it('登記成內建分頁、標成 V3 專屬，放在 AI 群組最前面', async () => {
    expect(settingSections).toContain('partners')
    expect(isV3OnlySettingSection('partners')).toBe(true)
    const { default: baseConfig } = await import('../config')
    const index = baseConfig.findIndex(item => 'anchor' in item && item.anchor === 'partners')
    expect(baseConfig[index]).toEqual(expect.objectContaining({ anchor: 'partners', v3Only: true }))
    expect(baseConfig[index - 1]).toEqual({ group: 'ai' })
  })

  it('新介面看得到、classic 看不到；classic 停在夥伴時回一般', () => {
    expect(isSettingSectionVisible('partners', true)).toBe(true)
    expect(isSettingSectionVisible('partners', false)).toBe(false)
    expect(fallbackSettingSection('partners', false)).toBe('general')
    expect(fallbackSettingSection('partners', true)).toBe('partners')
    expect(isSettingSectionVisible('general', true)).toBe(true)
    expect(isSettingSectionVisible('general', false)).toBe(true)
  })

  it('設定對話框、行動版都有夥伴頁面', () => {
    expect(source('components/settings-dialog.tsx')).toMatch(/partners: PartnersSettingPage/)
    expect(existsSync(join(SETTING, '../../mobile/setting/pages/partners/page.tsx'))).toBe(true)
  })

  it('側欄「Agent 設定」直接開夥伴分頁', () => {
    const sidebar = readFileSync(join(SETTING, '../main/sidebar-v3/sidebar-v3.tsx'), 'utf8')
    expect(sidebar).toMatch(/function openAgentSettings\(\) \{[^}]*openSettings\('partners'\)/)
  })
})

describe('分頁內容', () => {
  it('classic 不顯示；V3 依序是夥伴與 Agent 設定區、自動整理、自動接受', async () => {
    useUiModeStore.setState({ mode: 'classic' })
    await act(async () => root.render(React.createElement(PartnersSettingPage)))
    expect(container.textContent).toBe('')

    await act(async () => useUiModeStore.setState({ mode: 'v3' }))
    expect(container.textContent).toContain(en.settings.partners.title)
    const text = container.textContent ?? ''
    expect(text.indexOf('stub:agents')).toBeGreaterThan(-1)
    expect(text.indexOf('stub:agents')).toBeLessThan(text.indexOf('stub:organize'))
    expect(text.indexOf('stub:organize')).toBeLessThan(text.indexOf('stub:auto-accept'))
  })

  it('一般頁不再放夥伴、Agent 設定區、自動整理、自動接受與 RSS', () => {
    const general = source('general/page.tsx')
    for (const name of ['AgentSettings', 'OrganizeSettings', 'AutoAcceptSettings', 'RssSettings']) {
      expect(general).not.toContain(`<${name}`)
    }
    expect(general).toContain('<SystemBehaviorSettings />')
    expect(general).toContain('<InterfaceSettings />')
    expect(general).toContain('<AdvancedSettings />')
  })

  it('RSS 在電子紙頁，緊接在稍後讀後面', () => {
    expect(source('eink/page.tsx')).toMatch(/<ReadLaterSection \/>\s*<RssSettings \/>/)
  })

  it('RSS 只用 V3 token、按鈕同一尺寸', () => {
    const rss = source('rss/rss-settings.tsx')
    expect(rss).not.toMatch(/text-muted-foreground|text-destructive/)
    expect(rss).not.toMatch(/size="sm"/)
    expect(rss).toMatch(/role="alert" className="text-danger"/)
  })
})

describe('文案', () => {
  it('三種語系都有夥伴分頁的標題與說明', () => {
    for (const messages of [en, zh, zhTW]) {
      expect(Object.keys(messages.settings.partners).sort()).toEqual(['desc', 'title'])
    }
    expect(zhTW.settings.partners.title).toBe('夥伴')
    expect(en.settings.partners.title).toBe('The Crew')
  })

  it('繁中：常規設定改「一般」、拓展改「擴充」', () => {
    expect(zhTW.settings.general.title).toBe('一般')
    expect(zhTW.settings.navigationGroups.extensions).toBe('擴充')
  })
})
