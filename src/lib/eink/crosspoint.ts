// Fork（almanac ALMNC-51）：所有跟 CrossPoint 韌體格式有關的假設都集中在這一個檔案。
// ALMNC-44（X4 Pro 實機驗證）還沒做；實機結論和這裡不同時，只改這個檔案（和 public/eink-plugin/ 的外掛檔）。
//
// 依據（都是 crosspoint-reader/crosspoint-reader，develop 分支 commit ca1a8c1e527c49a519868d8db4fdee97c8ddffd5）：
//   docs/sd-plugins.md            外掛資料夾（/plugins/<名稱>/）、device.json 的 token／config 區段、
//                                 只有 events 沒有 browse.url 也是合法外掛、README 在裝置上以純文字顯示（上限 16KB）
//   docs/plugin-events.md         sleep.enter 事件的 download 處理（url、headers、dest；1MB 上限、dest 要絕對路徑、
//                                 一個事件一個處理；外掛資料夾名稱 ≤ 23 bytes、完整路徑 ≤ 63 bytes；安裝後要重開機）
//   src/util/PluginEvents.cpp     下載先寫到 dest.part，2xx 且回應完整才換掉舊檔（失敗沿用舊的 /sleep.bmp）
//   src/util/PluginHttp.cpp       requestToFile：回應不完整（responseComplete）就刪掉暫存檔
// 實際寫法參考 RockyBalboa360/CrossPoint-SDPlugin-weather-calendar-task-screen（MIT，commit 2dcac5c）的 device.json：
// 只有 config＋events.sleep.enter.download、dest 是 /sleep.bmp。
//
// 已由文件／原始碼確認：上面列的格式與行為。
// 還要 ALMNC-44 實機確認（標 ALMNC-44 的常數）：
//   - 區網明文 http 能不能下載、token 放網址參數或 Bearer 標頭哪個可行（外掛兩個都帶，伺服器兩個都收）
//   - 一次休眠能不能兩個外掛各下載一個檔（今日簡報外掛預設不裝）
//   - download 的 dest 資料夾不存在時會不會自動建立（安裝時先建好 /Books/Almanac）
//   - 中文 README／標題要裝中文字型後才顯示得出來

/** 外掛根目錄（文件列了 /.crosspoint/plugins、/plugins、/.plugins；用電腦看得到的 /plugins）。 */
export const PLUGIN_ROOT = '/plugins'
/** 休眠畫面外掛 */
export const SLEEP_PLUGIN = 'almanac'
/** 今日簡報外掛（變體，預設不裝；ALMNC-44 證實一次休眠能抓兩個檔後才建議打開） */
export const BRIEFING_PLUGIN = 'almanac-briefing'
export const PLUGIN_NAMES = [SLEEP_PLUGIN, BRIEFING_PLUGIN] as const
export type PluginName = typeof PLUGIN_NAMES[number]

/** 跟著外掛走、不需要代入值的檔案（放在 public/eink-plugin/<名稱>/） */
export const PLUGIN_STATIC_FILES = ['device.json', 'README.md'] as const
/** 安裝時才產生：device.json 的 token.file／config.file */
export const PLUGIN_TOKEN_FILE = 'token.json'
export const PLUGIN_TOKEN_PATH = 'token'
export const PLUGIN_CONFIG_FILE = 'config.json'
export const PLUGIN_CONFIG_SERVER_KEY = 'server'

export const SLEEP_EVENT = 'sleep.enter'
/** CUSTOM 休眠模式優先讀這張 */
export const SLEEP_DEST = '/sleep.bmp'
export const BRIEFING_DIR = '/Books/Almanac'
/** 外掛下載的檔名固定（dest 只能用 {cfg.*}／{token}／{event.*}，沒有日期變數），每天覆蓋同一本 */
export const BRIEFING_DEST = `${BRIEFING_DIR}/almanac-today.epub`

export const MAX_EVENT_DOWNLOAD_BYTES = 1024 * 1024
export const MAX_PLUGIN_NAME_BYTES = 23
export const MAX_PLUGIN_PATH_BYTES = 63
export const MAX_README_BYTES = 16 * 1024
export const MAX_MANIFEST_BYTES = 8 * 1024
/** token／config 檔各 2KB */
export const MAX_SMALL_FILE_BYTES = 2 * 1024

export function pluginDir(name: PluginName): string {
  return `${PLUGIN_ROOT}/${name}`
}

export function pluginTokenJson(token: string): string {
  return `${JSON.stringify({ [PLUGIN_TOKEN_PATH]: token })}\n`
}

export function pluginConfigJson(server: string): string {
  return `${JSON.stringify({ [PLUGIN_CONFIG_SERVER_KEY]: server })}\n`
}

// ---------------------------------------------------------------------------
// Fork（almanac ALMNC-52）：File Transfer 模式的 HTTP API（電子紙在 Home > File Transfer 時才回應）
// 依據：crosspoint-reader docs/webserver-endpoints.md（develop@ca1a8c1）；用法參考 ptk862010/obsidian-xteink-sync
// src/device.ts（MIT，commit 58e09e8）。實機沒驗證過（ALMNC-44）。
//   GET  /api/status                         {"version","firmwareFamily","ip","mode","device",...}
//   GET  /api/files?path=<dir>               [{"name","size","isDirectory","isEpub"}]
//   POST /upload?path=<dir>&overwrite=1      multipart 欄位 file；overwrite 時先寫 <name>.part，完整才換掉舊檔
//   POST /mkdir                              form：name、path（父資料夾）
//   POST /delete                             form：path
//   GET  /api/opds                           [{"index","name","url","username","hasPassword"}]
//   POST /api/opds                           JSON {name,url,username,password[,index]}；帶 index 是更新；最多 8 個
// 中文字型：可以把 .ttf／.otf 直接放進 /fonts/（docs/sd-card-fonts.md，需要外接 RAM 的機型；X4 Pro 是 S3）。
// ---------------------------------------------------------------------------

export const DEVICE_API = {
  status: '/api/status',
  files: '/api/files',
  upload: '/upload',
  mkdir: '/mkdir',
  delete: '/delete',
  opds: '/api/opds',
} as const

export const FONT_ROOT = '/fonts'
export const MAX_OPDS_SERVERS = 8
/** 電子紙 OPDS 清單裡的名稱；重新安裝時用名稱或網址找回同一筆來更新，不重複新增 */
export const OPDS_ENTRY_NAME = 'NoteGen Almanac'
/** 上傳中斷時韌體可能留下的暫存檔副檔名 */
export const UPLOAD_PART_SUFFIX = '.part'
/** 立即推送時書庫裡保留幾本 almanac-YYYY-MM-DD.epub */
export const PUSHED_BRIEFINGS_KEEP = 7
