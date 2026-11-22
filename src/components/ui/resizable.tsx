"use client"

import * as React from "react"
import * as ResizablePrimitive from "react-resizable-panels"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

const COLLAPSED_HANDLE_HIDE_DELAY = 1_000

/**
 * 收起的面板旁那顆可以點開的把手（藥丸）。Fork（almanac ALMNC-56.7，RPT-2026-009 P08）：
 * 放大與左右滑出改用 transform（scale、translate）做動畫，不再動 width、height、margin，滑過時不會每幀重算版面。
 * 藥丸固定是放大後的 28×80 px，平常縮成 12×40 px（scale 0.43 × 0.5）；水平位置用 translate 推出去。
 */
export function collapsedPillClassName(expandDirection: "left" | "right" | undefined, hintVisible: boolean): string {
  const base =
    "absolute top-1/2 left-1/2 z-10 h-20 w-7 -translate-y-1/2 scale-x-[0.43] scale-y-50 rounded-full border border-background bg-muted-foreground/60 shadow-md transition-[translate,scale,background-color,box-shadow] duration-200 group-hover/resize-handle:scale-100 group-hover/resize-handle:bg-muted-foreground/75 group-hover/resize-handle:shadow-lg group-focus-visible/resize-handle:scale-100 group-focus-visible/resize-handle:bg-muted-foreground/75"
  // 原本的 ml-6／-ml-4（右）與 -ml-6／ml-4（左）改成同樣距離的 translate（class 要寫完整，Tailwind 才掃得到）。
  const position =
    expandDirection === "right"
      ? hintVisible
        ? "translate-x-[calc(-50%_+_1.5rem)]"
        : "translate-x-[calc(-50%_-_1rem)] group-hover/resize-handle:translate-x-[calc(-50%_+_1.5rem)] group-focus-visible/resize-handle:translate-x-[calc(-50%_+_1.5rem)]"
      : expandDirection === "left"
        ? hintVisible
          ? "translate-x-[calc(-50%_-_1.5rem)]"
          : "translate-x-[calc(-50%_+_1rem)] group-hover/resize-handle:translate-x-[calc(-50%_-_1.5rem)] group-focus-visible/resize-handle:translate-x-[calc(-50%_-_1.5rem)]"
        : "-translate-x-1/2"
  return cn(base, position)
}

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  collapsed = false,
  expandDirection,
  collapsedTriggerClassName,
  className,
  onClick,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onPointerUp,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
  collapsed?: boolean
  expandDirection?: "left" | "right"
  collapsedTriggerClassName?: string
}) {
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = React.useRef(false)
  const hideTimerRef = React.useRef<number | null>(null)
  const [collapsedHintVisible, setCollapsedHintVisible] = React.useState(collapsed)
  const ExpandIcon = expandDirection === "left" ? ChevronLeft : ChevronRight

  const clearHideTimer = React.useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHideTimer = React.useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      setCollapsedHintVisible(false)
    }, COLLAPSED_HANDLE_HIDE_DELAY)
  }, [clearHideTimer])

  React.useEffect(() => {
    clearHideTimer()
    if (collapsed) {
      setCollapsedHintVisible(true)
      scheduleHideTimer()
    } else {
      setCollapsedHintVisible(false)
    }

    return clearHideTimer
  }, [clearHideTimer, collapsed, scheduleHideTimer])

  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "group/resize-handle relative z-10 flex w-px touch-none items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        collapsed &&
          expandDirection === "right" &&
          "after:left-0 after:w-8 after:translate-x-0",
        collapsed &&
          expandDirection === "left" &&
          "after:right-0 after:left-auto after:w-8 after:translate-x-0",
        collapsed && "pointer-events-none",
        className
      )}
      onPointerDown={(event) => {
        pointerStartRef.current = { x: event.clientX, y: event.clientY }
        suppressClickRef.current = false
        onPointerDown?.(event)
      }}
      onPointerEnter={(event) => {
        if (collapsed) {
          clearHideTimer()
          setCollapsedHintVisible(true)
        }
        onPointerEnter?.(event)
      }}
      onPointerLeave={(event) => {
        if (collapsed) {
          scheduleHideTimer()
        }
        onPointerLeave?.(event)
      }}
      onPointerUp={(event) => {
        const start = pointerStartRef.current
        if (start) {
          const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
          suppressClickRef.current = distance > 3
        }
        pointerStartRef.current = null
        onPointerUp?.(event)
      }}
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onClick?.(event)
      }}
      {...props}
    >
      {withHandle && collapsed && (
        <div
          className={cn(
            "pointer-events-auto absolute inset-y-0 left-1/2 w-8 -translate-x-1/2",
            collapsedTriggerClassName
          )}
        >
          <div
            data-collapsed="true"
            className={collapsedPillClassName(expandDirection, collapsedHintVisible)}
          >
            {expandDirection ? (
              <ExpandIcon
                aria-hidden="true"
                className="absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 stroke-[2.5] text-background opacity-0 transition-opacity duration-150 group-hover/resize-handle:opacity-100 group-focus-visible/resize-handle:opacity-100"
              />
            ) : null}
          </div>
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
