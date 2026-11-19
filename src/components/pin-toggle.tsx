"use client"

import * as React from "react"
import { Pin, PinOff } from "lucide-react"
import { useTranslations } from 'next-intl'

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import emitter from "@/lib/emitter";

export function PinToggle({ withTooltip = false }: { withTooltip?: boolean }) {
  const t = useTranslations();
  const [isPin, setIsPin] = useState(false)

  useEffect(() => {
    async function loadPinState() {
      const store = await Store.load('store.json')
      const pin = await store.get<boolean>('pin')
      setIsPin(!!pin)
    }

    function handlePinChanged(pin: boolean) {
      setIsPin(pin)
    }

    loadPinState()
    emitter.on('window-pin-changed', handlePinChanged)

    return () => {
      emitter.off('window-pin-changed', handlePinChanged)
    }
  }, [])

  async function togglePin() {
    const store = await Store.load('store.json')
    const newPinState = !isPin
    setIsPin(newPinState)
    const window = getCurrentWindow()
    await window.setAlwaysOnTop(newPinState)
    await store.set('pin', newPinState)
    await store.save()
    emitter.emit('window-pin-changed', newPinState)
  }

  const label = isPin ? t('common.unpin') : t('common.pin')
  const button = (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={togglePin}
      aria-label={withTooltip ? label : undefined}
      title={withTooltip ? undefined : label}
    >
      {isPin ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
    </Button>
  )
  return withTooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  ) : button
}
