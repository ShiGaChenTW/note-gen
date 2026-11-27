import * as React from "react"
import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import { displayPromptTitle } from "@/lib/prompt-title"
import { isPromptLibraryEnabled, resolveEffectivePrompt } from "@/lib/prompt-library/effective"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { ChatToolItem } from "./chat-tool-item"

interface PromptSelectProps {
  display?: 'icon' | 'status' | 'panel'
  disabled?: boolean
}

export function PromptSelect({ display = 'icon', disabled = false }: PromptSelectProps) {
  const { promptList, currentPrompt, initPromptData, setCurrentPrompt } = usePromptStore()
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input.promptSelect')
  const tTools = useTranslations('record.chat.input.toolsMenu')
  const titleOf = (prompt: Parameters<typeof displayPromptTitle>[0]) => displayPromptTitle(prompt, t('defaultTitle'))
  // ALMNC-86：提示詞功能關閉時一律顯示並使用預設角色，選單停用；已選的角色仍留在 store，開關打開後恢復
  const libraryEnabled = isPromptLibraryEnabled()
  const effectivePrompt = resolveEffectivePrompt(promptList, currentPrompt)
  const selectDisabled = disabled || !libraryEnabled
  const currentTitle = titleOf(effectivePrompt)

  // 初始化prompt列表
  useEffect(() => {
    initPromptData()
  }, [])

  // 选择 Prompt
  async function promptSelectChangeHandler(id: string) {
    const selectedPrompt = promptList.find(item => item.id === id)
    if (!selectedPrompt) return
    await setCurrentPrompt(selectedPrompt)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {display === 'status' ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={selectDisabled}
            className="h-5 min-w-0 max-w-36 gap-1 px-1 text-xs v3:text-ui-compact font-normal text-muted-foreground"
            aria-label={t('tooltip')}
          >
            <Drama data-icon="inline-start" />
            <span className="truncate">{currentTitle || '-'}</span>
          </Button>
        ) : display === 'panel' ? (
          <ChatToolItem
            icon={Drama}
            title={tTools('prompt.title')}
            description={tTools('prompt.description')}
            disabled={selectDisabled}
            value={<span title={currentTitle}>{currentTitle || '-'}</span>}
          />
        ) : (
          <div className="hidden md:block">
            <TooltipButton
              icon={<Drama />}
              tooltipText={t('tooltip')}
              size="icon"
            />
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={display === 'icon' ? 'center' : display === 'status' ? 'end' : 'start'}
        side={display === 'panel' ? 'right' : undefined}
        className="w-[220px] p-0"
      >
        <Command>
          <CommandInput placeholder={t('tooltip')} className="h-9" />
          <CommandList>
            <CommandGroup>
              {promptList?.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  data-checked={effectivePrompt?.id === item.id}
                  onSelect={(currentValue) => {
                    promptSelectChangeHandler(currentValue)
                    setOpen(false)
                  }}
                >
                  {titleOf(item)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
