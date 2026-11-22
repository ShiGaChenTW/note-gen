'use client'

import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Fork（almanac ALMNC-56.6，V15）：鍵盤提示一律用 components/ui/kbd.tsx；這裡是可聚焦、帶說明的 Tab 鍵帽（外框、透明底）。
export function KbdHint({ description, className }: { description: string; className?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Kbd
            tabIndex={0}
            className={cn(
              'pointer-events-auto hidden border border-line bg-transparent px-1.5 text-muted-ink @[20rem]:inline-flex v3:bg-transparent v3:px-1.5',
              className,
            )}
          >
            Tab
          </Kbd>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
