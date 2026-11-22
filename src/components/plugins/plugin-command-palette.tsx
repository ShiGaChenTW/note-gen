'use client'

import { getPluginIcon } from './plugin-icon'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { toast } from 'sonner'
import {
  executePluginUserCommand,
  getPluginCommands,
  subscribePluginCommands,
  type RegisteredPluginCommand,
} from '@/lib/plugins/command-registry'
import { useAnywhereStore } from '@/lib/anywhere/store'

export function PluginCommandPalette() {
  const t = useTranslations('settings.plugins.commandPalette')
  const [open, setOpen] = useState(false)
  const [commands, setCommands] = useState<RegisteredPluginCommand[]>(() => getPluginCommands())

  useEffect(() => subscribePluginCommands(() => setCommands(getPluginCommands())), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        // Fork（almanac ALMNC-54.18）：V3 主畫面的命令面板（含外掛指令）接手 ⌘⇧P；classic 與獨立編輯器視窗照舊。
        if (useAnywhereStore.getState().paletteHosted) return
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  const runCommand = async (command: RegisteredPluginCommand) => {
    setOpen(false)
    try {
      await executePluginUserCommand(command.id)
    } catch (error) {
      toast.error(command.title, {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('title')}
      description={t('description')}
    >
      <Command>
      <CommandInput placeholder={t('placeholder')} />
      <CommandList>
        <CommandEmpty>{t('empty')}</CommandEmpty>
        <CommandGroup heading={t('group')}>
          {commands.map((command) => {
            const Icon = getPluginIcon(command.icon)
            return (
              <CommandItem
                key={command.id}
                value={`${command.id} ${command.title} ${command.description ?? ''} ${command.pluginName} ${(command.keywords ?? []).join(' ')}`}
                onSelect={() => void runCommand(command)}
              >
                <Icon aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{command.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{command.pluginName}</div>
                </div>
                {command.suggestedShortcut ? (
                  <CommandShortcut>{command.suggestedShortcut}</CommandShortcut>
                ) : null}
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
