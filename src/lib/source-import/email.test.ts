// Fork（almanac ALMNC-57.1）：Email 解析——純文字、HTML、多段 MIME、編碼（UTF-8／Big5、RFC 2047／2231）、引用舊信、.mbox 去重與上限。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  emailSourceContent, emailSourceId, emailSourceInputs, isMboxFile, MBOX_LIMIT, parseEml, parseEmailFiles, parseMbox, selectEmails,
  splitMbox, stripQuotedReply,
} from './email'
import { decodeEncodedWords, parseParamHeader } from './mime'
import { htmlToText } from './text'

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(__dirname, '__fixtures__', name)))
}

const TAIPEI = 8 * 60

describe('parseEml', () => {
  it('純文字信：主旨（多段 RFC 2047）、寄件者、收件者（折行）、副本、日期、Message-ID，去掉結尾引用的舊信', () => {
    const email = parseEml(fixture('plain.eml'))
    expect(email.messageId).toBe('plain-001@example.com')
    expect(email.subject).toBe('週會議程：下週三改到下午三點')
    expect(email.from).toBe('林小美 <amy@example.com>')
    expect(email.to).toBe('Scott Chen <scott@example.com>, Lee, Bob <bob@example.com>')
    expect(email.cc).toBe('team@example.com')
    expect(email.date).toBe(Date.UTC(2026, 10, 19, 1, 30))
    expect(email.text).toBe('Scott 你好，\n\n下週三的週會改到下午三點，地點不變。\n請先看一下附上的議程。\n\n小美')
    expect(email.text).not.toContain('wrote')
    expect(email.attachments).toEqual([])
  })

  it('HTML 信：轉成純文字（清單、<br>、實體），丟掉 style／script，去掉 Gmail 引用的舊信', () => {
    const email = parseEml(fixture('html.eml'))
    expect(email.subject).toBe('Re: quote & delivery')
    expect(email.date).toBe(Date.UTC(2026, 10, 18, 13, 15))
    expect(email.text).toBe('Hi Scott,\n\n三件事：\n\n- 報價單&合約\n- 交期 12/5\n\nThanks,\nBob')
    expect(email.text).not.toMatch(/舊信|alert|color:red|ignore/)
  })

  it('多段 MIME：Big5 base64 純文字優先、內嵌圖片不算附件、附件檔名（RFC 2231／RFC 2047）', () => {
    const email = parseEml(fixture('multipart.eml'))
    expect(email.subject).toBe('第三季報價')
    expect(email.from).toBe('陳志明 <chen@example.com.tw>')
    expect(email.to).toBe('王經理 <wang@example.com.tw>')
    expect(email.text).toBe('王經理您好：\n\n附件是第三季的報價，請過目。\n\n陳志明')
    expect(email.attachments).toEqual(['報價單.pdf', '合約草稿.docx'])
  })

  it('Outlook 的「From:／Sent:」區塊以下是舊信，去掉；沒編碼的 UTF-8 標頭照樣讀得出來', () => {
    const email = parseEml(fixture('outlook.eml'))
    expect(email.subject).toBe('RE: 交期確認')
    expect(email.text).toBe('已確認，12/5 出貨。\n\nCarol')
  })

  it('只有 HTML 的 multipart/alternative 用 HTML；轉寄的信（message/rfc822）列成附件', () => {
    const raw = [
      'Message-ID: <alt@x>', 'Subject: alt', 'From: a@x', 'Content-Type: multipart/mixed; boundary=b1', '',
      '--b1', 'Content-Type: multipart/alternative; boundary=b2', '',
      '--b2', 'Content-Type: text/plain; charset=utf-8', '', '', '--b2', 'Content-Type: text/html; charset=utf-8', '', '<p>只有 HTML</p>', '--b2--',
      '--b1', 'Content-Type: message/rfc822', '', 'Subject: =?UTF-8?B?6IiK5L+h?=', 'From: b@x', '', 'old', '--b1--', '',
    ].join('\r\n')
    const email = parseEml(raw)
    expect(email.text).toBe('只有 HTML')
    expect(email.attachments).toEqual(['舊信.eml'])
  })
})

describe('編碼', () => {
  it('RFC 2047：Q 編碼底線是空白、B 編碼、相鄰編碼字之間的空白去掉、多位元組字元跨編碼字', () => {
    expect(decodeEncodedWords('=?ISO-8859-1?Q?Caf=E9_au_lait?=')).toBe('Café au lait')
    expect(decodeEncodedWords('=?UTF-8?B?5Lit?= =?UTF-8?B?5paH?= ok')).toBe('中文 ok')
    // 「中」的 UTF-8 三個位元組切在兩個編碼字裡。
    expect(decodeEncodedWords('=?UTF-8?Q?=E4=B8?= =?UTF-8?Q?=AD?=')).toBe('中')
    expect(decodeEncodedWords('=?big5?B?pKSk5Q==?=')).toBe('中文')
  })

  it('RFC 2231 分段參數', () => {
    const header = parseParamHeader("attachment; filename*0*=utf-8''%E6%9C%83%E8%AD%B0; filename*1*=%E7%B4%80%E9%8C%84.txt")
    expect(header.type).toBe('attachment')
    expect(header.params.filename).toBe('會議紀錄.txt')
  })
})

describe('stripQuotedReply', () => {
  it('中間穿插回覆的引用不動，只去掉結尾的引用與署名', () => {
    const text = '> 第一個問題\n回答一\n\n> 第二個問題\n回答二\n\n於 2026年11月18日 週三 下午3:00 Scott <s@x> 寫道：\n> 舊信'
    expect(stripQuotedReply(text)).toBe('> 第一個問題\n回答一\n\n> 第二個問題\n回答二')
  })

  it('-----Original Message----- 以下去掉；整封都是引用時保留原文', () => {
    expect(stripQuotedReply('好的\n\n-----Original Message-----\nFrom: a\n舊信')).toBe('好的')
    expect(stripQuotedReply('> 全部都是引用\n> 第二行')).toBe('> 全部都是引用\n> 第二行')
  })

  it('轉寄的內容是信的本體，不去掉', () => {
    const text = '請看下面\n\n---------- Forwarded message ---------\nFrom: Amy <a@x>\nDate: Mon\nSubject: 報價\n\n報價內容'
    expect(stripQuotedReply(text)).toBe(text)
  })
})

describe('htmlToText', () => {
  it('blockquote 裡的行加「> 」，巢狀加兩層', () => {
    expect(htmlToText('<p>新</p><blockquote>舊<blockquote>更舊</blockquote></blockquote>')).toBe('新\n\n> 舊\n>\n> > 更舊')
  })
})

describe('.mbox', () => {
  it('拆信、還原 >From、認不出是信的略過', () => {
    const raw = fixture('inbox.mbox')
    expect(splitMbox(raw)).toHaveLength(4)
    const emails = parseMbox(raw)
    expect(emails.map(email => email.subject)).toEqual(['First', 'Second', 'First', 'No id'])
    expect(emails[0].text).toBe('First body.\nFrom the archive: this line was escaped.')
  })

  it('用 Message-ID 去重，由新到舊排好；沒有 Message-ID 的信用內容雜湊當鍵', () => {
    const batch = parseEmailFiles([{ name: 'inbox.mbox', bytes: fixture('inbox.mbox') }])
    expect(batch).toMatchObject({ total: 4, duplicates: 1, dropped: 0 })
    expect(batch.emails.map(email => email.subject)).toEqual(['Second', 'First', 'No id'])
    expect(batch.emails.map(emailSourceId)).toEqual(['src_email:m2@example.com', 'src_email:m1@example.com', expect.stringMatching(/^src_email:sha:[0-9a-f]{8}$/)])
    expect(batch.emails.every(email => email.fileName === 'inbox.mbox')).toBe(true)
  })

  it(`超過 ${MBOX_LIMIT} 封只收最新的 ${MBOX_LIMIT} 封，並回報沒收的數量`, () => {
    const parts: string[] = []
    for (let index = 0; index < 205; index++) {
      const day = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toUTCString()
      parts.push(`From x@example.com Thu Jan 1 00:00:00 2026\nMessage-ID: <n${index}@x>\nDate: ${day}\nFrom: x@example.com\nSubject: mail ${index}\n\nbody ${index}\n`)
    }
    const batch = parseEmailFiles([{ name: 'big.mbox', bytes: new TextEncoder().encode(parts.join('\n')) }])
    expect(batch).toMatchObject({ total: 205, duplicates: 0, dropped: 5 })
    expect(batch.emails).toHaveLength(MBOX_LIMIT)
    expect(batch.emails[0].subject).toBe('mail 204')
    expect(batch.emails.at(-1)?.subject).toBe('mail 5')
  })

  it('沒有日期的信依檔案裡的順序（越後面越新）', () => {
    const emails = ['a', 'b', 'c'].map(subject => ({ subject, from: 'x', to: '', cc: '', text: subject, attachments: [], messageId: subject }))
    expect(selectEmails(emails, 2).emails.map(email => email.subject)).toEqual(['c', 'b'])
  })

  it('判斷是不是 .mbox：副檔名、Mail.app 匯出資料夾裡的 mbox 檔、內容以 From 開頭', () => {
    expect(isMboxFile('Inbox.mbox', '')).toBe(true)
    expect(isMboxFile('/Users/me/Inbox.mbox/mbox', 'From x')).toBe(true)
    expect(isMboxFile('note.eml', 'From x')).toBe(false)
    expect(isMboxFile('export', 'From someone@x Mon')).toBe(true)
    expect(isMboxFile('mail.txt', 'Subject: hi')).toBe(false)
  })

  it('不是信的檔案不會被匯入', () => {
    const batch = parseEmailFiles([{ name: 'random.bin', bytes: new Uint8Array([0, 1, 2, 3]) }])
    expect(batch.total).toBe(0)
  })
})

describe('資料源內容', () => {
  it('第一行主旨，接著寄件者、收件者、副本、日期、附件，空一行後內文；來處是檔名', () => {
    const email = { ...parseEml(fixture('multipart.eml')), fileName: 'q3.eml' }
    expect(emailSourceContent(email, TAIPEI)).toBe([
      '第三季報價',
      '',
      '寄件者：陳志明 <chen@example.com.tw>',
      '收件者：王經理 <wang@example.com.tw>',
      '日期：2026-11-16 14:05',
      '附件：報價單.pdf、合約草稿.docx',
      '',
      '王經理您好：\n\n附件是第三季的報價，請過目。\n\n陳志明',
    ].join('\n'))
    expect(emailSourceInputs({ emails: [email] }, TAIPEI)[0]).toMatchObject({ id: 'src_email:multi-003@example.com.tw', kind: 'email', origin: 'q3.eml' })
  })

  it('沒有主旨時用「（沒有主旨）」', () => {
    expect(emailSourceContent({ subject: '', from: 'a@x', to: '', cc: '', text: '', attachments: [] }).split('\n')[0]).toBe('（沒有主旨）')
  })
})
