// Fork（almanac ALMNC-57.3）：會議逐字稿解析——Zoom／Teams／Google Meet 的 .vtt／.srt／.txt、Otter／Teams .docx 的標頭行、
// 沒有講者的檔案；去掉時間碼、同講者連續句子合併、保留講者名、標題／日期／與會者。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findDate, isSpeakerName, meetingSourceContent, meetingSourceInput, mergeSegments, parseMeetingFile, parseSrt, parseTimestamp, parseTranscriptText, parseVtt,
} from './meeting'

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')
}

const TAIPEI = 8 * 60

describe('Zoom .vtt（「名字: 內容」）', () => {
  const name = 'GMT20261120-020000_Recording.transcript.vtt'
  const meeting = parseVtt(fixture(name), name)

  it('去掉時間碼與編號；同一位講者連續的句子合併成一段；中文不加空白、英文跨行加空白', () => {
    expect(meeting.paragraphs).toEqual([
      { speaker: 'Scott Chen', text: '大家好，我們開始今天的週會。第一件事是第三季的報價。' },
      { speaker: '林小美', text: '報價單我週五前寄給客戶。' },
      { speaker: 'Bob Lee', text: 'OK, I will review the contract by Monday.' },
      { speaker: 'Scott Chen', text: '好，那就這樣決定。' },
    ])
  })

  it('標題用檔名（去掉 .transcript）、日期從 Zoom 檔名來、與會者依發言順序、長度從時間碼算', () => {
    expect(meeting).toMatchObject({
      title: 'GMT20261120-020000_Recording',
      date: '2026-11-20',
      participants: ['Scott Chen', '林小美', 'Bob Lee'],
      durationMs: 18_800,
      fileName: name,
    })
  })
})

describe('Teams .vtt（<v 名字>）', () => {
  const meeting = parseVtt(fixture('teams-weekly-sync.vtt'), 'teams-weekly-sync.vtt', { fallbackDate: Date.UTC(2026, 10, 19, 20), offsetMinutes: TAIPEI })

  it('講者來自 <v> 標記；cue 的 GUID 編號與 NOTE 區塊不會進來；實體解開', () => {
    expect(meeting.paragraphs).toEqual([
      { speaker: 'Scott Chen', text: "Okay, let's get started. First item: the Q3 quote & delivery date." },
      { speaker: 'Amy Lin', text: "I'll send the quote to the customer by Friday." },
      { speaker: 'Scott Chen', text: 'Great. Decision: we ship on December 5th.' },
    ])
    expect(meeting.participants).toEqual(['Scott Chen', 'Amy Lin'])
  })

  it('檔名與內容找不到日期時用檔案修改時間', () => {
    expect(meeting.date).toBe('2026-11-20')
    expect(meeting.durationMs).toBe(62_380)
  })
})

describe('.srt', () => {
  it('Google Meet 字幕：去掉 {\\an8} 與 <i> 標籤、一個 cue 裡的第二行沿用講者', () => {
    const meeting = parseSrt(fixture('meet-captions.srt'), 'meet-captions.srt')
    expect(meeting.paragraphs).toEqual([
      { speaker: 'Scott Chen', text: '早安，今天討論新產品。' },
      { speaker: 'Amy Lin', text: '我負責整理需求，下週二前給大家。' },
      { speaker: 'Scott Chen', text: '謝謝。' },
    ])
  })

  it('沒有講者：捲動字幕重複的行只留一次、合併成段落；只出現一次的「注意：」不當成講者', () => {
    const meeting = parseSrt(fixture('speakerless.srt'), 'speakerless.srt')
    expect(meeting.participants).toEqual([])
    expect(meeting.paragraphs).toEqual([
      { text: '今天的會議主要討論第三季的出貨計畫注意：倉庫在十二月盤點所以出貨要提前。' },
    ])
    expect(meeting.date).toBeUndefined()
  })
})

describe('.txt 與 .docx 轉出的文字', () => {
  it('Google Meet 逐字稿：第一行是標題（去掉 - Transcript）、日期從開頭幾行來、時間行去掉、同講者合併', () => {
    const meeting = parseTranscriptText(fixture('meet-transcript.txt'), 'meet-transcript.txt')
    expect(meeting).toMatchObject({ title: '產品週會', date: '2026-11-20', participants: ['Scott Chen', 'Amy Lin'] })
    expect(meeting.paragraphs).toEqual([
      { speaker: 'Scott Chen', text: '早安，今天討論新產品。' },
      { speaker: 'Amy Lin', text: '我負責整理需求。下週二前給大家。' },
      { speaker: 'Scott Chen', text: '好，就這樣決定。' },
    ])
  })

  it('Otter／Teams .docx 的「名字  0:03」標頭行；開頭的日期與長度不放進逐字稿', () => {
    const meeting = parseTranscriptText(fixture('otter-export.txt'), 'otter-export.txt')
    expect(meeting).toMatchObject({ title: 'Weekly sync-20261120_100000-Meeting Recording', date: '2026-11-20', participants: ['Scott Chen', 'Amy Lin'] })
    expect(meeting.paragraphs).toEqual([
      { speaker: 'Scott Chen', text: "Okay, let's get started. First item is the Q3 quote." },
      { speaker: 'Amy Lin', text: "I'll send it by Friday." },
      { speaker: 'Scott Chen', text: 'Great.' },
    ])
  })

  it('.docx 轉出的 Markdown：去掉粗體與跳脫字元', () => {
    const markdown = '**Scott Chen**  0:03\n\n大家好\\!\n\n**Amy Lin**  0:10\n\n我來報告\\*進度\\*。\n\n**Scott Chen**  0:20\n\n謝謝'
    const meeting = parseMeetingFile('週會.docx', markdown)
    expect(meeting.paragraphs).toEqual([
      { speaker: 'Scott Chen', text: '大家好!' },
      { speaker: 'Amy Lin', text: '我來報告*進度*。' },
      { speaker: 'Scott Chen', text: '謝謝' },
    ])
    expect(meeting.title).toBe('週會')
  })

  it('沒有講者的筆記：第一行當標題、空行換段、「注意：」與看起來像標頭的「…10:30」都留在內文', () => {
    const meeting = parseTranscriptText(`${fixture('notes.txt')}我們約明天 10:30\n`, 'notes.txt')
    expect(meeting.title).toBe('這次只是隨手記的會議筆記，沒有講者。')
    expect(meeting.participants).toEqual([])
    expect(meeting.paragraphs).toEqual([
      { text: '大家同意十二月五日出貨。注意：倉庫在十二月盤點。' },
      { text: '另外要準備新的報價單。我們約明天 10:30' },
    ])
  })

  it('開頭的時間碼「[00:01:02] 名字: 內容」與 Zoom 聊天紀錄', () => {
    const meeting = parseTranscriptText('[00:00:05] Scott: hi\n[00:00:09] Amy: hello\n10:00:15 From Bob Lee to Everyone: 我晚點到', 'chat.txt')
    expect(meeting.paragraphs).toEqual([
      { speaker: 'Scott', text: 'hi' },
      { speaker: 'Amy', text: 'hello' },
      { speaker: 'Bob Lee', text: '我晚點到' },
    ])
  })

  it('.txt 裡其實是字幕（有 --> 時間碼）也當字幕解析', () => {
    const meeting = parseMeetingFile('captions.txt', '1\n00:00:01,000 --> 00:00:02,000\nScott: hi\n\n2\n00:00:02,000 --> 00:00:03,000\nAmy: hello\n')
    expect(meeting.participants).toEqual(['Scott', 'Amy'])
  })
})

describe('小工具', () => {
  it('parseTimestamp', () => {
    expect(parseTimestamp('00:01:02.345')).toBe(62_345)
    expect(parseTimestamp('01:02,5')).toBe(62_500)
    expect(parseTimestamp('1:00:00')).toBe(3_600_000)
    expect(parseTimestamp('abc')).toBeUndefined()
  })

  it('findDate：各種寫法；不合理的月日不算', () => {
    expect(findDate('2026/11/20 會議')).toBe('2026-11-20')
    expect(findDate('2026年11月5日')).toBe('2026-11-05')
    expect(findDate('GMT20261120-020000')).toBe('2026-11-20')
    expect(findDate('November 20, 2026, 2:00AM')).toBe('2026-11-20')
    expect(findDate('20261340')).toBeUndefined()
    expect(findDate('no date')).toBeUndefined()
  })

  it('isSpeakerName：句子、時間、筆記欄位不算講者', () => {
    expect(isSpeakerName('Scott Chen')).toBe(true)
    expect(isSpeakerName('林小美')).toBe(true)
    expect(isSpeakerName('Dr. Smith')).toBe(true)
    expect(isSpeakerName('決議')).toBe(false)
    expect(isSpeakerName('Action items')).toBe(false)
    expect(isSpeakerName('我覺得，這樣')).toBe(false)
    expect(isSpeakerName('10:30')).toBe(false)
    expect(isSpeakerName('https')).toBe(false)
  })

  it('mergeSegments：沒有講者的段落太長就換段', () => {
    const long = '字'.repeat(300)
    expect(mergeSegments([{ text: long }, { text: long }, { text: '尾' }])).toEqual([{ text: long + long }, { text: '尾' }])
  })
})

describe('資料源內容', () => {
  it('第一行標題，接著日期、與會者、長度、檔案，空一行後是「講者：內容」一段一段；id 由檔名＋內容決定', () => {
    const name = 'GMT20261120-020000_Recording.transcript.vtt'
    const meeting = parseVtt(fixture(name), name)
    expect(meetingSourceContent(meeting)).toBe([
      'GMT20261120-020000_Recording',
      '',
      '日期：2026-11-20',
      '與會者：Scott Chen、林小美、Bob Lee',
      '長度：1 分鐘',
      `檔案：${name}`,
      '',
      'Scott Chen：大家好，我們開始今天的週會。第一件事是第三季的報價。',
      '',
      '林小美：報價單我週五前寄給客戶。',
      '',
      'Bob Lee：OK, I will review the contract by Monday.',
      '',
      'Scott Chen：好，那就這樣決定。',
    ].join('\n'))
    const input = meetingSourceInput(meeting)
    expect(input).toMatchObject({ kind: 'meeting', origin: name })
    expect(input.id).toMatch(new RegExp(`^src_meeting:${name.replace(/\./g, '\\.')}#[0-9a-f]{8}$`))
    expect(meetingSourceInput(parseVtt(fixture(name), name)).id).toBe(input.id)
  })

  it('沒有講者時不列與會者', () => {
    const content = meetingSourceContent(parseSrt(fixture('speakerless.srt'), 'speakerless.srt'))
    expect(content).not.toContain('與會者')
    expect(content.split('\n')[0]).toBe('speakerless')
  })
})
