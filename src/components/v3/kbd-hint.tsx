'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function KbdHint({ description, className }: { description: string; className?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <kbd
            tabIndex={0}
            className={cn(
              'hidden h-[18px] shrink-0 items-center rounded-sm border border-line bg-transparent px-1.5 font-mono text-[11px] leading-none text-muted-ink @[20rem]:inline-flex',
              className,
            )}
          >
            Tab
          </kbd>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
