#!/usr/bin/env node
// ---
// filename: make-test-vault.mjs
// created: 2026-10-19 (Asia/Taipei)
// source_llm: Claude (Opus 5.5, Claude Code session)
// ---
// 產生 NoteGen fork 的測試用 vault：日期一律以「執行當下」為準，所以隔天重跑就會是新的「今天」。
// 涵蓋 F1 frontmatter、D1 模板、D2 今日頁、D3 導航、D4/D5/D6/D7/D8 時間管理要看的情境。
//
//   node personal/make-test-vault.mjs [目標資料夾] [--force]
//
// 預設寫到 ~/Documents/NoteGen-Test-Vault。資料夾已存在時要加 --force，
// 而且只會刪除本腳本建立的 vault（根目錄有 .notegen-test-vault 標記檔）。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const force = args.includes('--force')
const target = path.resolve(args.find(a => !a.startsWith('--')) ?? path.join(os.homedir(), 'Documents', 'NoteGen-Test-Vault'))
const MARKER = '.notegen-test-vault'

if (fs.existsSync(target)) {
  if (!fs.existsSync(path.join(target, MARKER))) {
    console.error(`拒絕覆寫：${target} 不是本腳本建立的 vault（沒有 ${MARKER}）。`)
    process.exit(1)
  }
  if (!force) {
    console.error(`${target} 已存在。加 --force 重建（會刪掉裡面的內容）。`)
    process.exit(1)
  }
  fs.rmSync(target, { recursive: true })
}

// ---------- 日期 ----------
const now = new Date()
const pad = n => String(n).padStart(2, '0')
const day = offset => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const compact = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const D = offset => ymd(day(offset))
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
const soon = new Date(now.getTime() + 5 * 60_000)
const SOON = `${pad(soon.getHours())}:${pad(soon.getMinutes())}`

// ---------- 寫檔 ----------
const written = []
function write(rel, content, { mtimeDaysAgo, crlf } = {}) {
  const file = path.join(target, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, crlf ? content.replace(/\n/g, '\r\n') : content)
  if (mtimeDaysAgo !== undefined) {
    const t = new Date(now.getTime() - mtimeDaysAgo * 86_400_000)
    fs.utimesSync(file, t, t)
  }
  written.push(rel)
}

const DAILY = '20 Journal/21 Daily'

function dailyNote(offset, { tone, one, mits = [], anchors = [], capture = [], reflection = '', extra = '' } = {}) {
  const d = day(offset)
  return `---
date: ${ymd(d)}
tags: [daily]
---

# ${ymd(d)} 週${WEEKDAY[d.getDay()]}

> 一句話定調 → ${tone ?? ''}

## 🎯 唯一要務
- ${one ?? ''}

## 三件 MIT
${mits.length ? mits.join('\n') : '- '}

## ⏰ 錨點時段
${anchors.length ? anchors.join('\n') : '- '}

## 📥 捕捉軌
${capture.join('\n')}

## 🌙 沉澱
- **今天真正完成**：${reflection}
- **明天要記得**：
${extra}`
}

// ---------- 今天 ----------
write(`${DAILY}/${compact(day(0))}.md`, dailyNote(0, {
  tone: '先做決定，再寫程式。',
  one: '驗收 Phase 1 時間管理功能',
  mits: [
    '- [x] 🔴 跑一次 D3 日記導航',
    '- [ ] 🟡 D7 提醒實測',
    '- [ ] 🟢 D8 時間軸拖放',
  ],
  anchors: [
    '- 08:00 早晨啟動',
    '- 09:00-11:00 深工作：驗收',
    '- 14:00-15:00 會議',
    '- 21:30 整日復盤',
  ],
  capture: [
    '- 想到：今日頁可以顯示天氣 #閃',
    '- 《原子習慣》第 3 章 #讀',
    `- [ ] 回電給房東 📅 ${D(0)} ⏰ 16:30`,
    `- [ ] 提醒測試 📅 ${D(0)} ⏰ ${SOON}`,
  ],
}))

// 昨天：3 項未完成，給 D6「帶入今天」
write(`${DAILY}/${compact(day(-1))}.md`, dailyNote(-1, {
  tone: '把剩下的收尾。',
  one: '整理 D2 測試步驟',
  mits: ['- [x] 🔴 寫測試步驟', '- [x] 🟡 補截圖'],
  anchors: ['- 09:00 早晨啟動', '- 21:30 整日復盤'],
  capture: [
    '- [ ] 補今日頁截圖',
    '- [ ] 回覆 issue 留言',
    '- [x] 合併軌道 B',
    '- [ ] 買咖啡豆 #家',
  ],
  reflection: '測試步驟寫完了',
}))

// 中間故意空幾天，給 D3「跳過沒有日記的日子」
write(`${DAILY}/${compact(day(-3))}.md`, dailyNote(-3, { tone: '慢慢來。', one: 'F3 索引', reflection: '索引完成' }))
write(`${DAILY}/${compact(day(-6))}.md`, dailyNote(-6, { tone: '開工。', one: '規劃 Phase 1' }))
write(`${DAILY}/${compact(day(-14))}.md`, dailyNote(-14, { tone: '兩週前。', one: '第一篇' }))
// 未來的日記：從今天往後按 › 會跳到這篇
write(`${DAILY}/${compact(day(7))}.md`, dailyNote(7, { tone: '下週的計畫。', one: '準備 Phase 2' }))

// ---------- 專案任務 ----------
write('30 Projects/Acme.md', `---
client: Acme
status: active
---

# Acme 專案

- [ ] 寄報價單給 Acme ⏫ 📅 ${D(-3)}
- [ ] 確認合約條款 📅 ${D(1)} ⏰ 10:00
- [ ] 下個月的追蹤 📅 ${D(10)}
- [ ] 沒有日期的待辦（不該出現在今日頁）
- [x] 開案會議 📅 ${D(-5)} ✅ ${D(-5)}
`)

write('30 Projects/NoteGen/CSS.md', `# NoteGen CSS

- [ ] 整理 color token 對照表 🔼 📅 ${D(-2)}
- [ ] 檢查深色模式對比 📅 ${D(2)}
`)

write('30 Projects/HelmDeck.md', `# HelmDeck

- [ ] 回覆 HelmDeck issue #12 📅 ${D(-1)}
- [ ] 發佈 v0.3 🔽 📅 ${D(0)}
- [x] 修好登入錯誤 📅 ${D(0)} ✅ ${D(0)}
`)

write('40 Areas/Work.md', `# 工作

- [ ] 週報 📅 ${D(0)}
- [ ] 一對一會議準備 📅 ${D(0)} ⏰ 11:30
- [ ] 預算表初稿 [due:: ${D(1)}] [priority:: high]
- [ ] 讀書會選書 📅 ${D(-8)}
`)

// D5：重複任務
write('40 Areas/Routines.md', `# 例行

- [ ] 澆花 🔁 every week 📅 ${D(0)}
- [ ] 記帳 🔁 every day 📅 ${D(0)} ⏰ 21:00
- [ ] 檢查備份 🔁 every weekday when done 📅 ${D(-1)}
- [ ] 繳信用卡費 🔁 every month 📅 ${D(2)}
`)

// F1：各種 frontmatter 寫法，存檔後要逐字不變
write('50 Resources/frontmatter-測試.md', `---
title: "Frontmatter 測試"
aliases: [fm-test, 前置資料]
tags:
  - test
  - notegen
created: ${D(-30)}
nested:
  key: value
  list: [1, 2, 3]
---

# Frontmatter 測試

在編輯器改這段文字後存檔，用 git diff 或文字編輯器確認上面的 YAML 一個字都沒變。
`)
write('50 Resources/frontmatter-CRLF.md', `---
title: CRLF 換行
tags: [test]
---

# CRLF

這個檔案用 Windows 換行（CRLF），存檔後應該維持 CRLF。
`, { crlf: true })
write('50 Resources/沒有 frontmatter.md', `# 沒有 frontmatter

---

上面那條是分隔線，不是 frontmatter，存檔後也要保留。
`)

// Inbox：兩個超過 3 天沒動（積壓），一個新的；Inbox 裡的任務不進任務索引
write('10 Inbox/舊想法 A.md', '# 舊想法 A\n\n- [ ] Inbox 裡的任務（不該出現在今日頁）\n', { mtimeDaysAgo: 5 })
write('10 Inbox/舊想法 B.md', '# 舊想法 B\n\n還沒整理。\n', { mtimeDaysAgo: 9 })
write('10 Inbox/今天的想法.md', '# 今天的想法\n\n剛記下來。\n')

// D1：日記模板（到設定 → 日記 → 預設模板 填 `00 System/05 templates/Daily`）
write('00 System/05 templates/Daily.md', `---
date: "{{date}}"
tags: [daily]
---

# {{date}} {{weekday}}

> 一句話定調 →

## 🎯 唯一要務
-

## 三件 MIT
- [ ] 🔴
- [ ] 🟡
- [ ] 🟢

## ⏰ 錨點時段
- 08:00 早晨啟動
- 21:30 整日復盤

## 📥 捕捉軌

## 🌙 沉澱
- **今天真正完成**：
- **明天要記得**：
`)

write('README.md', `# NoteGen 測試 vault

由 \`personal/make-test-vault.mjs\` 在 ${ymd(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} 產生，日期都以那天為「今天」。
隔天要測試請重跑：\`node personal/make-test-vault.mjs --force\`。

| 要測的 | 看哪裡 |
|---|---|
| D2 今日頁 | 逾期 5 項（讀書會 8 天、Acme 3 天、CSS 2 天、HelmDeck 1 天、檢查備份 1 天）、今天 7 項、明天 2 項、後天 2 項、今天完成 1 項 |
| D3 導航 | ${DAILY}：今天、昨天、3 天前、6 天前、14 天前、7 天後；中間空的日子會被跳過 |
| D4 快速新增 | 寫進今天日記的「📥 捕捉軌」最後 |
| D5 重複任務 | 40 Areas/Routines.md |
| D6 帶入今天 | 昨天的日記有 3 項未完成 |
| D7 提醒 | 今天日記裡「提醒測試」在 ${SOON} 通知（App 要開著；過了這個時間就重跑腳本）；記帳 21:00、回電 16:30 |
| D8 時間軸 | 今天的錨點時段＋有 ⏰ 的任務 |
| F1 frontmatter | 50 Resources/ 三個檔案 |
| Inbox 積壓 | 10 Inbox/ 兩個超過 3 天 |
`)

fs.writeFileSync(path.join(target, MARKER), `created ${now.toISOString()}\n`)

console.log(`已建立測試 vault：${target}`)
console.log(`今天 = ${ymd(now)}，提醒測試時間 = ${SOON}`)
console.log(`共 ${written.length} 個檔案`)
