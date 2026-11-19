import { Chat } from "@/db/chats"
import { GlobeIcon, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { fetchAiTranslate } from "@/lib/ai/translate"
import { ResponsiveActionMenu } from "@/components/responsive-action-menu"
import { scrollToBottom } from '@/lib/utils'
import { TooltipButton } from "@/components/tooltip-button"

interface TranslateControlProps {
  chat: Chat
  onTranslatedContent: (content: string) => void
}

export function TranslateControl({ chat, onTranslatedContent }: TranslateControlProps) {
  const translateT = useTranslations('record.chat.input.translate')
  const [isTranslating, setIsTranslating] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState<string>('')
  
  const languageOptions = [
    { id: 'en', target: 'English' },
    { id: 'zh', target: '中文' },
    { id: 'ja', target: '日本語' },
    { id: 'ko', target: '한국어' },
    { id: 'fr', target: 'Français' },
    { id: 'de', target: 'Deutsch' },
    { id: 'es', target: 'Español' },
    { id: 'ru', target: 'Русский' },
  ] as const

  // 处理翻译
  async function handleTranslate(language: string) {
    if (!chat.content || isTranslating) return
    
    setIsTranslating(true)
    setSelectedLanguage(language)
    
    try {
      const translatedText = await fetchAiTranslate(chat.content, language)
      onTranslatedContent(translatedText)
    } catch (error) {
      console.error('Translation error:', error)
    } finally {
      setIsTranslating(false)
      setTimeout(() => {
        scrollToBottom()
      }, 100);
    }
  }
  
  // 重置翻译
  function resetTranslation() {
    setSelectedLanguage('')
    onTranslatedContent('')
  }

  if (!chat.content || chat.type !== 'chat') {
    return null
  }

  const items = selectedLanguage
    ? [{
        key: 'original',
        label: translateT('showOriginal'),
        onSelect: resetTranslation,
      }]
    : languageOptions.map(language => ({
        key: language.id,
        label: translateT(`languages.${language.id}`),
        onSelect: () => handleTranslate(language.target),
      }))

  return (
    <ResponsiveActionMenu
      title={translateT('tooltip')}
      desktopAlign="start"
      items={items}
      trigger={
        <div className="inline-flex">
          <TooltipButton
            icon={isTranslating ? <Loader2 className="animate-spin" /> : <GlobeIcon />}
            tooltipText={translateT('tooltip')}
            disabled={isTranslating}
            variant="ghost"
            size="icon-xs" buttonClassName="[&_svg:not([class*='size-'])]:size-3.5"
          />
        </div>
      }
    />
  )
}
