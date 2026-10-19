'use client'

// Fork (Phase 2-3b)：`.base` 檔案的整頁檢視。軌道 A 會替換這個佔位元件。
export default function BasesPage({ filePath }: { filePath: string; isActive?: boolean }) {
  return <div className="p-4 text-sm text-muted-foreground">Bases：{filePath}（尚未實作）</div>
}
