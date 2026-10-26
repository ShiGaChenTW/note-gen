// Fork（#46）：Inbox 頁的動作。記錄的寫入沿用 db/marks；「已整理」在 db/record-processed。
import { toast } from 'sonner'
import { EmitterRecordEvents } from '@/config/emitters'
import { deleteMarks, restoreMarks, updateRecordTags, type Mark } from '@/db/marks'
import { markRecordsProcessed, unmarkRecordsProcessed } from '@/db/record-processed'
import { noteExists, writeNote } from '@/lib/daily/note-io'
import emitter from '@/lib/emitter'
import { captureFileName, capturePath } from '@/lib/home/capture'
import { recordTagIds } from '@/lib/record-tags'
import useArticleStore from '@/stores/article'
import useInboxStore from '@/stores/inbox'
import { recordNoteContent } from './record-to-note'

function afterRecordsChanged() {
  emitter.emit(EmitterRecordEvents.refreshMarks)
  return useInboxStore.getState().refresh()
}

/** 打開 Inbox 頁並展開某筆記錄；已整理的會順便切到「顯示已整理」。 */
export async function openRecordInInbox(markId: number) {
  const store = useInboxStore.getState()
  if (!store.loaded || !store.records.some(record => record.id === markId)) await store.refresh()
  const processed = useInboxStore.getState().processed.has(markId)
  useInboxStore.getState().show({ focusMarkId: markId, showProcessed: processed })
}

/** 快速記錄存好後的提示；不切換畫面，按「查看」才打開 Inbox 頁並展開最新一筆。 */
export function notifyRecordSaved(messages: { saved: string, view: string }) {
  void useInboxStore.getState().refresh()
  toast(messages.saved, {
    action: {
      label: messages.view,
      onClick: () => {
        void useInboxStore.getState().refresh().then(() => {
          const latest = useInboxStore.getState().records[0]
          useInboxStore.getState().show(latest ? { focusMarkId: latest.id } : undefined)
        })
      },
    },
  })
}

/** 每筆記錄各建一則筆記，放在 Inbox 資料夾；回傳建好的路徑。 */
export async function convertRecordsToNotes(records: Mark[], folder: string): Promise<string[]> {
  const paths: string[] = []
  for (const record of records) {
    const content = recordNoteContent(record)
    const name = captureFileName(content, new Date(record.createdAt || Date.now()))
    let path: string | null = null
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = capturePath(folder, name, attempt)
      if (await noteExists(candidate)) continue
      path = candidate
      break
    }
    if (!path) throw new Error('too many notes with the same name')
    await writeNote(path, content)
    await markRecordsProcessed([record.id], path)
    paths.push(path)
  }
  await useArticleStore.getState().loadFileTree()
  await afterRecordsChanged()
  return paths
}

export async function setRecordsProcessed(ids: number[], notePath: string | null) {
  await markRecordsProcessed(ids, notePath)
  await afterRecordsChanged()
}

export async function setRecordsUnprocessed(ids: number[]) {
  await unmarkRecordsProcessed(ids)
  await afterRecordsChanged()
}

export async function addTagToRecords(records: Mark[], tagId: number) {
  for (const record of records) {
    const current = recordTagIds(record)
    if (current.includes(tagId)) continue
    await updateRecordTags(record.id, [...current, tagId])
  }
  await afterRecordsChanged()
}

export async function trashRecords(ids: number[]) {
  await deleteMarks(ids)
  await afterRecordsChanged()
}

export async function restoreRecords(ids: number[]) {
  await restoreMarks(ids)
  await afterRecordsChanged()
}
