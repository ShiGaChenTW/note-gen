import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import { ThemeProvider } from '@/components/theme-provider'
import { applyUiMode, useUiModeStore, type UiMode } from '@/lib/fork-ui'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import zhTW from '../../messages/zh-TW.json'

export type TestLocale = 'zh-TW' | 'en' | 'zh'

const LOCALE_MESSAGES: Record<TestLocale, AbstractIntlMessages> = {
  'zh-TW': zhTW,
  en,
  zh,
}

export interface RenderV3Options extends Omit<RenderOptions, 'wrapper'> {
  mode?: UiMode
  locale?: TestLocale
  theme?: 'light' | 'dark'
  messages?: AbstractIntlMessages
}

export interface RenderV3Result extends RenderResult {
  user: UserEvent
}

export function renderV3(ui: ReactElement, options: RenderV3Options = {}): RenderV3Result {
  const {
    mode = 'v3',
    locale = 'zh-TW',
    theme = 'light',
    messages = LOCALE_MESSAGES[locale],
    ...renderOptions
  } = options

  useUiModeStore.setState({ mode, loaded: true })
  applyUiMode(mode)
  try {
    window.localStorage?.setItem('theme', theme)
  } catch {
    // ignore storage errors in restricted contexts
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} disableTransitionOnChange>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Taipei">
          {children}
        </NextIntlClientProvider>
      </ThemeProvider>
    )
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    user: userEvent.setup(),
  }
}

export * from '@testing-library/react'
