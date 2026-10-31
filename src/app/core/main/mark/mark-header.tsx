"use client"
import { useTranslations } from 'next-intl'
import * as React from "react"
import { initMarksDb } from "@/db/marks"
import { UnifiedRecordButton } from './unified-record-dialog'
import useMarkStore from "@/stores/mark"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Menu, Trash2, XCircle } from 'lucide-react'

export function MarkHeader() {
  const t = useTranslations('record.mark');
  const { trashState, setTrashState, fetchAllTrashMarks, fetchMarks } = useMarkStore()

  React.useEffect(() => {
    initMarksDb()
  }, [])

  React.useEffect(() => {
    if (trashState) {
      fetchAllTrashMarks()
    } else {
      fetchMarks()
    }
  }, [trashState])

  return (
    <div className="flex justify-between items-center h-12 border-b px-2">
      <div className="flex"><UnifiedRecordButton /></div>

      {/* 菜单按钮 */}
      <div className="flex items-center gap-1">
        {trashState ? (
          <Button variant="ghost" size="icon" onClick={() => setTrashState(false)}>
            <XCircle />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTrashState(true)}>
                <Trash2 />{t('toolbar.trash')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
