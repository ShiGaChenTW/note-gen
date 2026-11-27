// Fork（almanac ALMNC-90）：「送給指揮官萃取」的 I/O——先把編輯器還在等的修改存進檔案，再讀筆記庫裡的檔案送去萃取。
// 和「送給指揮官」同一套存檔步驟（editor-note-toolbar 的 sendNoteToCommander）；存不進去就不送，讓按鈕顯示失敗。
import type { RecordExtractOutcome } from '@/lib/workbench/record-extract'

export async function extractRecordNote(path: string, saveFailed: string): Promise<RecordExtractOutcome> {
  const [{ default: useArticleStore }, { prepareActiveEditorDeactivationDurably }, { readNote }, { sendRecordForExtraction }] = await Promise.all([
    import('@/stores/article'),
    import('@/lib/editor-deactivation'),
    import('@/lib/daily/note-io'),
    import('@/lib/workbench/actions'),
  ])
  if (useArticleStore.getState().activeFilePath === path && !await prepareActiveEditorDeactivationDurably(path)) throw new Error(saveFailed)
  await useArticleStore.getState().flushPendingArticleSavesForPaths([path])
  return sendRecordForExtraction({ path, content: (await readNote(path)) ?? '' })
}
