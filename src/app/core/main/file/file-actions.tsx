"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus, FolderPlus, Plus, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import useArticleStore from "@/stores/article"
import { debounce } from "lodash-es"
import { FileMoreMenu } from './file-more-menu'
import { useMarkdownImport } from './use-markdown-import'
import { DocumentToMarkdownDialog } from './document-to-markdown-dialog'
import { cn } from "@/lib/utils"

/**
 * persistentNew（Fork almanac ALMNC-79.3，V3 側欄）：「新增筆記」用「＋」常駐，其他動作滑過區段或鍵盤進來時才出現。
 * 不給時維持原本四顆並排。
 */
export function FileActions({ persistentNew = false }: { persistentNew?: boolean } = {}) {
  const { newFolder, newFile, loadFileTree, loadRemoteSyncFiles, fileTreeLoading } = useArticleStore()
  const t = useTranslations('article.file.toolbar')
  const { isImporting, importMarkdown, importNotionZip, convertDocumentsToMarkdown } = useMarkdownImport()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [convertDialogOpen, setConvertDialogOpen] = useState(false)

  const debounceNewFile = debounce(newFile, 200)
  const debounceNewFolder = debounce(newFolder, 200)

  async function handleRefresh() {
    if (isRefreshing) return

    setIsRefreshing(true)
    try {
      await loadFileTree({ skipRemoteSync: true })
      await loadRemoteSyncFiles()
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <>
      <div className={cn('flex items-center gap-1', persistentNew && 'flex-row-reverse')}>
        <TooltipButton
          icon={persistentNew ? <Plus className="h-4 w-4" /> : <FilePlus className="h-4 w-4" />}
          tooltipText={t('newArticle')}
          onClick={debounceNewFile}
          side="bottom"
        />
        <div className={cn('flex items-center gap-1', persistentNew && 'opacity-0 transition-opacity duration-100 group-hover/section:opacity-100 focus-within:opacity-100')}>
        <TooltipButton
          icon={<FolderPlus className="h-4 w-4" />}
          tooltipText={t('newFolder')}
          onClick={debounceNewFolder}
          side="bottom"
        />
        <TooltipButton
          icon={<RefreshCw className={`h-4 w-4 ${fileTreeLoading || isRefreshing ? 'animate-spin' : ''}`} />}
          tooltipText={t('refresh')}
          onClick={() => void handleRefresh()}
          disabled={fileTreeLoading || isRefreshing}
          side="bottom"
        />
        <FileMoreMenu
          isImporting={isImporting}
          onImportMarkdown={() => void importMarkdown()}
          onConvertDocuments={() => setConvertDialogOpen(true)}
          onImportNotion={() => void importNotionZip()}
        />
        </div>
      </div>
      <DocumentToMarkdownDialog
        open={convertDialogOpen}
        importing={isImporting}
        onOpenChange={setConvertDialogOpen}
        onSelect={() => void convertDocumentsToMarkdown()}
      />
    </>
  )
}
