// @vitest-environment jsdom
// Fork（almanac ALMNC-54.20，AC#3）：錄音的逐字稿分流——現場錄音標成 live（語音速記，自動交給指揮官），
// 從檔案選進來的音訊標成 file（外部資料源，走初步判斷）。分流規則本身在 lib/workbench（source-routing.test.ts）。
import React, { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../../messages/zh-TW.json'
import { TooltipProvider } from '@/components/ui/tooltip'
import emitter from '@/lib/emitter'

const fake = vi.hoisted(() => ({
  register: vi.fn<(memo: { from: 'live' | 'file', markId: number, transcript: string, audioPath?: string }) => Promise<undefined>>(async () => undefined),
  nextId: 40,
}))

vi.mock('@/db/marks', () => ({ insertMark: async () => ({ lastInsertId: ++fake.nextId }) }))
vi.mock('@/lib/audio', () => ({ transcribeRecording: async () => '逐字稿內容' }))
vi.mock('@/lib/audio-converter', () => ({ convertToWav: async (blob: Blob) => new Blob([blob], { type: 'audio/wav' }) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => '/Users/x/meeting.mp3' }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: async () => new Uint8Array([1, 2, 3]),
  writeFile: async () => undefined,
  exists: async () => true,
  mkdir: async () => undefined,
  BaseDirectory: { AppData: 1 },
}))
vi.mock('@/lib/check', () => ({ isMobileDevice: () => false }))
vi.mock('@/lib/record-save-target', () => ({ getDefaultRecordSaveTagId: async () => 1 }))
vi.mock('./use-record-completion', () => ({ useRecordCompletion: () => async () => undefined }))
vi.mock('@/lib/workbench/actions', () => ({ registerTranscribedAudio: fake.register }))
vi.mock('@/stores/setting', () => ({ default: () => ({ sttModel: '' }) }))
vi.mock('@/stores/mark', () => ({ default: () => ({ addQueue: () => undefined, removeQueue: () => undefined }) }))
vi.mock('@/stores/recording', () => {
  const state = {
    isRecording: true,
    recordingDuration: 3,
    startRecording: async () => undefined,
    stopRecording: async () => new Blob([new Uint8Array([9])], { type: 'audio/webm' }),
    cancelRecording: () => undefined,
  }
  const useRecordingStore = Object.assign(() => state, { getState: () => state })
  return { default: useRecordingStore }
})

const { ControlRecording } = await import('./control-recording')

let host: HTMLDivElement
let root: Root

async function settle() {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fake.register.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const intl = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children: createElement(TooltipProvider, null, createElement(ControlRecording)) }
  act(() => root.render(createElement(NextIntlClientProvider, intl)))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

it('a live recording is registered as a voice memo (from: live)', async () => {
  act(() => { emitter.emit('toolbar-shortcut-recording') })
  await settle()
  expect(fake.register).toHaveBeenCalledTimes(1)
  expect(fake.register.mock.calls[0][0]).toMatchObject({ from: 'live', transcript: '逐字稿內容' })
  expect(fake.register.mock.calls[0][0].audioPath).toMatch(/^recordings\/recording_\d+\.wav$/)
})

it('audio picked from a file is registered as external (from: file)', async () => {
  act(() => { emitter.emit('toolbar-shortcut-recording-file') })
  await settle()
  expect(fake.register).toHaveBeenCalledTimes(1)
  expect(fake.register.mock.calls[0][0]).toMatchObject({ from: 'file', transcript: '逐字稿內容' })
})
