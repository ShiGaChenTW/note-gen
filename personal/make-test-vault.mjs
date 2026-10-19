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

// ---------- Phase 2-1：雙鏈（L1 wikilink、L2 自動完成、L3 反向連結） ----------
// 來源筆記：各種 [[ ]] 寫法；不改內容直接存檔，git diff 必須是空的
write('60 Notes/雙鏈來源.md', `---
title: 雙鏈來源
related: "[[雙鏈目標]]"
---

# 雙鏈來源

- 一般連結 [[雙鏈目標]]
- 別名 [[雙鏈目標|改個顯示名]]
- 標題 [[雙鏈目標#第二節]]
- 不存在（虛線，點了會在 60 Notes/ 建立）[[還沒有這篇]]
- 同名筆記：\`[[同名]]\` 解析到根層那篇 [[同名]]
- 子資料夾那篇要寫完整路徑（Obsidian「shortest path when possible」）[[60 Notes/子資料夾/同名]]
- 相對路徑 markdown 連結也算反向連結：[目標](雙鏈目標.md)
- 行內 code 不是連結：\`[[雙鏈目標]]\`
- 嵌入（只顯示不轉入）：![[附件.png]]

\`\`\`md
fenced code 裡的 [[雙鏈目標]] 不是連結
\`\`\`
`)

// 表格：上游序列化器會把欄寬補齊、表格前多一個空行（與 2-1 無關，所有含表格的筆記都會），
// 這裡只驗 wikilink 文字本身一字不差，特別是 \| 不能變成 |
write('60 Notes/雙鏈表格.md', `# 雙鏈表格

| 欄位 | 連結 |
|---|---|
| 表格別名 | [[雙鏈目標\\|表格]] |
| 表格一般 | [[同名]] |
`)

write('60 Notes/雙鏈目標.md', `---
aliases: [目標別名, target]
tags: [notegen, phase-2]
---

# 雙鏈目標

## 第一節

被「雙鏈來源」連到；右側欄「反向連結」應列出來源的每一行。

## 第二節

回連 [[雙鏈來源]]。
`)

write('60 Notes/同名.md', '# 同名（根層）\n\n被 [[雙鏈來源]] 用 `[[同名]]` 連到；shortest path 應解析到這篇。\n')
write('60 Notes/子資料夾/同名.md', '# 同名（子資料夾）\n\n只有 `[[子資料夾/同名]]` 會連到這篇。\n')
write('60 Notes/孤兒.md', '# 孤兒\n\n沒有任何筆記連到這篇：反向連結面板應顯示「還沒有筆記連到這篇」。\n')

// ---------- Phase 2-2：知識庫整理（L5 屬性、L7 改名改寫、L6 標籤、L4 未連結提及） ----------
// Obsidian 的屬性型別設定：L5 要優先讀這份
write('.obsidian/types.json', `{
  "types": {
    "due": "date",
    "reviewed": "datetime",
    "rating": "number",
    "done": "checkbox",
    "related": "multitext",
    "tags": "tags",
    "aliases": "aliases"
  }
}
`)

// L5：每種型別各一個；改任一屬性後，git diff 只能有那幾行（註解、引號、空行、順序都不能動）
write('60 Notes/屬性樣本.md', `---
title: "屬性樣本: 有冒號所以加引號"  # 行尾註解要留著
due: 2026-10-25
reviewed: 2026-10-19T09:30
rating: 4
done: false
related:
  - "[[雙鏈目標]]"
  - "[[待改名]]"
tags: [notegen, phase-2]
aliases: [屬性別名]

nested:
  a: 1
  b: 2
---

# 屬性樣本

右側欄「屬性」tab 應列出 9 個屬性；\`nested\` 顯示為不支援、唯讀。
Dataview 行內欄位不是屬性：status:: active
`)

// L6：標籤樹 專案/alpha、專案/beta、閱讀；大小寫視為同一個標籤
write('60 Notes/標籤A.md', `---
tags:
  - 專案/alpha
  - 閱讀
---

# 標籤 A

內文標籤 #專案/alpha 重複不重複計算，#待辦 只在這篇。
`)
write('60 Notes/標籤B.md', '# 標籤 B\n\n#專案/beta 與 #閱讀，還有大寫的 #Reading（與下一篇的 #reading 是同一個）。\n')
write('60 Notes/標籤C.md', '# 標籤 C\n\n#reading 與 #專案（只有父層）。\n\n`#code裡的不算`\n')

// L7：改名「待改名」→ 任何新名字後，下面三篇的連結都要跟著改，且只有連結那幾行有 diff
write('60 Notes/待改名.md', `# 待改名

## 第一節

改名這篇：連入的 [[改名來源一]]、[[改名來源二]]、[[改名來源三]] 都會跳出「更新連結」詢問。
相對 markdown 連結，搬動本篇到別的資料夾後要重算：[雙鏈目標](雙鏈目標.md)
`)
write('60 Notes/改名來源一.md', `---
related: "[[待改名]]"
---

# 改名來源一

- 一般 [[待改名]]
- 別名 [[待改名|顯示名]]
- 標題 [[待改名#第一節]]
- 嵌入 ![[待改名]]
- 行內 code 不改：\`[[待改名]]\`
`)
write('60 Notes/改名來源二.md', `# 改名來源二

| 欄位 | 連結 |
|---|---|
| 表格 | [[待改名\\|表格別名]] |

markdown 相對連結：[待改名](待改名.md)
`, { crlf: true })
write('60 Notes/子資料夾/改名來源三.md', '# 改名來源三\n\n從子資料夾連：[[待改名]] 與 [連結](../待改名.md)\n')

// L4：未連結提及。目標「提及目標」別名「提及別名」
write('60 Notes/提及目標.md', `---
aliases: [提及別名]
---

# 提及目標

反向連結面板「未連結提及」應列出 4 筆（提及來源 2 筆、提及來源二 1 筆、vault 根目錄 README 1 筆），一鍵「連結」後變成 [[提及目標]]。
`)
write('60 Notes/提及來源.md', `# 提及來源

純文字提到提及目標一次，別名提及別名也算一次。
已經是連結的 [[提及目標]] 不算，code 裡的 \`提及目標\` 不算，markdown 連結 [提及目標](提及目標.md) 不算。
英文邊界：Note 不命中 Notes。
`)
write('60 Notes/提及來源二.md', '# 提及來源二\n\n標題裡也算：\n\n## 關於提及目標的筆記\n')

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
| L1 wikilink | 60 Notes/雙鏈來源.md：各種寫法、虛線未建立；不改內容直接存檔，git diff 必須是空的。60 Notes/雙鏈表格.md：存檔後只允許表格欄寬補空白與表前多一個空行（上游序列化器），\`[[雙鏈目標\\|表格]]\` 的 \`\\|\` 必須還在 |
| L2 自動完成 | 任一筆記打 \`[[\`：「雙鏈目標」用別名「目標別名」也找得到；「同名」有兩篇，選子資料夾那篇會寫 \`[[60 Notes/子資料夾/同名]]\` |
| L3 反向連結 | 開 雙鏈目標.md：連結到這篇 6 筆（來源 5 筆含 frontmatter 與 markdown 相對連結、表格 1 筆；code 內的不算）；同名.md 2 筆、子資料夾/同名.md 1 筆、孤兒.md 空狀態 |
| L5 屬性面板 | 60 Notes/屬性樣本.md：9 個屬性各型別（\`.obsidian/types.json\` 指定 due/reviewed/rating/done 型別），\`nested\` 唯讀；改任一值後 git diff 只有那幾行，行尾註解與引號要留著 |
| L6 筆記標籤 | 左側欄「筆記標籤」：專案（3 篇：alpha 1、beta 1、只有父層 1）、閱讀 2、reading 2（大小寫合併）、待辦 1、notegen 等 frontmatter 標籤；code 裡的不算 |
| L7 改名改寫 | 把 60 Notes/待改名.md 改名：跳出詢問「4 篇筆記共 10 個連結」；確認後 改名來源一（5 筆，code 內不改）、改名來源二（表格 \`\\|\` 與 markdown 連結，CRLF 要保留）、子資料夾/改名來源三（含 \`../\` 相對連結）、屬性樣本（related 1 筆）只有連結那幾行有 diff；再把它拖進子資料夾，來源三的 \`[[待改名]]\` 不變、markdown 相對路徑要重算 |
| L4 未連結提及 | 開 60 Notes/提及目標.md：未連結提及 4 筆（提及來源 2 筆：純文字＋別名；提及來源二 標題 1 筆；README 這一列 1 筆）；已連結、code、markdown 連結不算；按「連結」後該筆消失、git diff 只有那一行 |
`)

fs.writeFileSync(path.join(target, MARKER), `created ${now.toISOString()}\n`)

console.log(`已建立測試 vault：${target}`)
console.log(`今天 = ${ymd(now)}，提醒測試時間 = ${SOON}`)
console.log(`共 ${written.length} 個檔案`)
