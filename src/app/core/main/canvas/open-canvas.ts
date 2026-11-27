// Fork（almanac ALMNC-93）：V3 不經過整理頁的畫布入口（側欄「＋」選單、命令面板）共用。
// 建立或開啟畫布後在編輯區開成分頁，並叫 home-service 收起覆蓋層（今天、工作台、整理⋯⋯），回到編輯區。
import emitter from '@/lib/emitter'
import useArticleStore from '@/stores/article'
import useCanvasStore from '@/stores/canvas'
import type { CanvasProject, CanvasProjectType } from '@/types/canvas'
import { createCanvasTab } from './canvas-tab'

async function showCanvas(project: CanvasProject | null): Promise<CanvasProject | null> {
  if (!project) return null
  await useArticleStore.getState().addTab(createCanvasTab(project))
  emitter.emit('show-editor')
  return project
}

/** 建立一張畫布（預設空白）並直接開啟。 */
export async function createAndOpenCanvas(title: string, canvasType: CanvasProjectType = 'blank'): Promise<CanvasProject | null> {
  return showCanvas(await useCanvasStore.getState().createProject(canvasType, title))
}

/** 開啟既有畫布；已刪除或找不到時回傳 null。 */
export async function openCanvas(id: string): Promise<CanvasProject | null> {
  return showCanvas(await useCanvasStore.getState().openProject(id))
}
