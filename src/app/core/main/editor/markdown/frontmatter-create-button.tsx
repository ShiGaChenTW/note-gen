'use client'

// Fork：沒有 frontmatter 的筆記，在編輯器頂端提供「一鍵建立」。
// 預設套用設定裡的預設範本，右邊的箭頭可改選其他範本；title 預填檔名。
// 只在可編輯、Markdown 檔、沒有 frontmatter 節點時出現。
import { useEditorState, type Editor } from '@tiptap/react'
import { ChevronDown, FilePlus2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  normalizeFrontmatterTemplates,
  pickDefaultTemplate,
  renderFrontmatterBlock,
  titleFromPath,
  type FrontmatterTemplate,
} from '@/lib/markdown/frontmatter-template'
import useSettingStore from '@/stores/setting'

export function FrontmatterCreateButton({ editor, path }: { editor: Editor; path: string }) {
  const t = useTranslations('properties')
  const hasFrontmatter = useEditorState({ editor, selector: ctx => ctx.editor.state.doc.firstChild?.type.name === 'frontmatter' })
  const storedTemplates = useSettingStore(state => state.frontmatterTemplates)
  const defaultId = useSettingStore(state => state.frontmatterDefaultTemplateId)
  if (hasFrontmatter || !/\.md$/i.test(path)) return null
  const templates = normalizeFrontmatterTemplates(storedTemplates)
  const fallback = pickDefaultTemplate(templates, defaultId)

  function create(template: FrontmatterTemplate | undefined) {
    if (!template) return
    const raw = renderFrontmatterBlock(template, { title: titleFromPath(path) })
    if (!raw) return
    editor.chain().insertContentAt(0, { type: 'frontmatter', attrs: { raw } }).run()
    toast.success(t('templateCreated', { name: template.name }))
  }

  return (
    <div className="mb-1 flex items-center gap-0.5 text-muted-foreground" data-testid="frontmatter-create">
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => create(fallback)}>
        <FilePlus2 className="size-3.5" />{t('createTemplate')}
      </Button>
      {templates.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('chooseTemplate')}><ChevronDown className="size-3.5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {templates.map(template => <DropdownMenuItem key={template.id} onSelect={() => create(template)}>{template.name}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
