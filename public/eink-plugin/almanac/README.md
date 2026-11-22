Almanac 休眠畫面（NoteGen）

每次闔上電子紙，這個外掛會向 NoteGen 下載今天的行程圖，存成 /sleep.bmp，這次休眠就顯示。

伺服器：{{server}}

第一次設定
1. 設定 > Connectivity > Plugins 選 Enabled。
2. 設定 > Display > Sleep Screen 選 Custom。
3. 安裝外掛後重新開機一次（外掛只在開機時載入）。
4. 電子紙要記住和 Mac 同一個 Wi-Fi，電量至少 20%。

平常怎麼用
- Mac 要醒著、NoteGen 要開著，而且設定 > 電子紙 的「區網服務」要打開。
- 連不上 Mac（Mac 睡眠、NoteGen 沒開、不在同一個 Wi-Fi）時，電子紙沿用上一張圖，不會卡住休眠。
- 下載不完整時不會蓋掉舊的 /sleep.bmp。

換了 Mac 的 IP、埠或 token
- 在 NoteGen 的 設定 > 電子紙 重新安裝外掛（閱讀器要在 File Transfer 模式）。

這個外掛只下載一個檔案：/sleep.bmp。不執行任何程式，也不會上傳電子紙上的資料。

English: downloads today's schedule image from NoteGen to /sleep.bmp on every sleep. Enable Settings > Connectivity > Plugins, set Display > Sleep Screen to Custom, and restart once after installing.
