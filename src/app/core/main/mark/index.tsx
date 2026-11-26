'use client'

import React from "react"
import { TagManage } from './tag-manage'

export function NoteSidebar() {
  return (
    <div id="record-sidebar" className="flex h-full min-h-0 w-full flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <TagManage />
      </div>
    </div>
  )
}
