Almanac 今日簡報（NoteGen，實驗）

每次闔上電子紙，這個外掛會向 NoteGen 下載今天的今日簡報，存成 /Books/Almanac/almanac-today.epub，下次打開書庫就看得到。

伺服器：{{server}}

注意
- 這是實驗功能：要等實機驗證（一次休眠能不能下載兩個檔、1 MB 上限的實際行為）確認可行才建議打開。
- 和「Almanac 休眠畫面」外掛分開，因為一個事件只能有一個處理。
- 每次休眠都會多下載一個檔案（最多 1 MB），會多用一點電。
- 連不上 Mac 或下載不完整時，不會蓋掉舊的簡報。
- 也可以不裝這個外掛，改用 OPDS 書目手動下載今日簡報。

第一次設定
1. 設定 > Connectivity > Plugins 選 Enabled。
2. 安裝外掛後重新開機一次（外掛只在開機時載入）。

English (experimental): downloads today's briefing EPUB from NoteGen to /Books/Almanac/almanac-today.epub on every sleep.
