"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import emitter from "@/lib/emitter"
import useMemoriesStore from "@/stores/memories"
import { memorySettingSection, useSettingsDialogStore } from "@/stores/settings-dialog"
import { isUiV3 } from "@/lib/fork-ui"

export function MemoryAutoNotifications() {
  const t = useTranslations("settings.memories")
  const { loadMemories, loadStats, undoMemoryChange } = useMemoriesStore()
  const openSettings = useSettingsDialogStore(state => state.openSettings)

  useEffect(() => {
    const handleCreated = (event: {
      created: Array<{ id: string; content: string; status: "active" | "pending" }>
    }) => {
      void Promise.all([loadMemories(), loadStats()])
      const pending = event.created.find(item => item.status === "pending")
      if (pending) {
        toast.warning(t("pendingConfirmation"), {
          description: pending.content,
          action: {
            label: t("actions.review"),
            // Fork（almanac ALMNC-83.2）：新介面的記憶在夥伴分頁的 Agent 設定區
            onClick: () => openSettings(memorySettingSection(isUiV3())),
          },
        })
        return
      }
      const active = event.created.find(item => item.status === "active")
      toast.success(t("autoCreated", { count: event.created.length }), active
        ? {
            description: active.content,
            action: {
              label: t("actions.undo"),
              onClick: () => void undoMemoryChange(active.id),
            },
          }
        : undefined)
    }
    emitter.on("memory-auto-created", handleCreated)
    return () => emitter.off("memory-auto-created", handleCreated)
  }, [loadMemories, loadStats, openSettings, t, undoMemoryChange])

  return null
}
