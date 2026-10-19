'use client'

// Fork (Phase 2-3b)：Obsidian `.canvas`（JSON Canvas）檔案的檢視。軌道 B 會替換這個佔位元件。
export default function ObsidianCanvasPage({ filePath }: { filePath: string; isActive?: boolean }) {
  return <div className="p-4 text-sm text-muted-foreground">Canvas：{filePath}（尚未實作）</div>
}
