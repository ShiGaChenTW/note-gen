"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import { isPromptLibraryEnabled, resolveEffectivePrompt } from "@/lib/prompt-library/effective"
import { displayPromptTitle } from "@/lib/prompt-title"
import { ChatToolItem } from "@/app/core/main/chat/chat-tool-item"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from "@/lib/utils"

function PromptListContent({
  promptList,
  currentPromptId,
  onSelect,
}: {
  promptList: { id: string; title: string }[]
  currentPromptId?: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="space-y-1">
      {promptList.map((item) => {
        const isSelected = currentPromptId === item.id

        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={cn(
              "w-full flex items-center justify-between gap-3 px-3 py-3 rounded-lg text-left transition-colors",
              isSelected ? "bg-accent" : "hover:bg-muted/50"
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate">{item.title}</div>
            </div>
            <div
              className={cn(
                "flex items-center justify-center w-5 h-5 rounded border transition-colors shrink-0",
                isSelected
                  ? "bg-active border-line text-ink"
                  : "border-muted-foreground/30"
              )}
            >
              {isSelected && <Check className="size-3.5" />}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function PromptSelector() {
  const { promptList, currentPrompt, initPromptData, setCurrentPrompt } = usePromptStore()
  const [open, setOpen] = useState(false)
  const t = useTranslations('record.chat.input.promptSelect')
  const tTools = useTranslations('record.chat.input.toolsMenu')
  // ALMNC-86：提示詞功能關閉時一律顯示並使用預設角色，不能切換；已選的角色仍留在 store
  const libraryEnabled = isPromptLibraryEnabled()
  const effectivePrompt = resolveEffectivePrompt(promptList, currentPrompt)
  const currentTitle = displayPromptTitle(effectivePrompt, t('defaultTitle'))

  useEffect(() => {
    initPromptData()
  }, [])

  async function promptSelectChangeHandler(id: string) {
    const selectedPrompt = promptList.find(item => item.id === id)
    if (!selectedPrompt) return
    await setCurrentPrompt(selectedPrompt)
  }

  return (
    <>
      <ChatToolItem
        icon={Drama}
        title={tTools('prompt.title')}
        description={tTools('prompt.description')}
        value={<span title={currentTitle}>{currentTitle || '-'}</span>}
        disabled={!libraryEnabled}
        onClick={() => setOpen(true)}
      />

      <Drawer open={libraryEnabled && open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[70vh]">
          <DrawerHeader>
            <DrawerTitle>{t('tooltip')}</DrawerTitle>
          </DrawerHeader>
          <div className="p-4">
            <PromptListContent
              promptList={promptList.map(prompt => ({ id: prompt.id, title: displayPromptTitle(prompt, t('defaultTitle')) }))}
              currentPromptId={effectivePrompt?.id}
              onSelect={async (id) => {
                await promptSelectChangeHandler(id)
                setOpen(false)
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
