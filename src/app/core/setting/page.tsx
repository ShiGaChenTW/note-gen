// Fork（almanac ALMNC-83.8）：保留這個空頁。/core/setting 與 /core/setting?anchor=xxx 要有路由，
// core/layout.tsx 才會攔下來改開設定對話框；刪掉會落到根層 not-found，不會經過 core/layout。
export default function Page() {
  return null
}
