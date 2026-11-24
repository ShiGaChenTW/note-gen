import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * App 內顯示的 Almanac 圖示。依介面明暗切換淺色款與深色款（標誌規則：深色底用深色款、淺色底用淺色款），
 * 不再用 dark:invert 反相。圖檔是滿版方形，圓角由 CSS 決定。
 */
export function AppLogo({ size, className, priority }: { size: number; className?: string; priority?: boolean }) {
  const shared = cn('shrink-0 rounded-[22%]', className)
  return (
    <>
      <Image src="/app-icon-light.png" alt="Almanac Notes" width={size} height={size} priority={priority}
        className={cn(shared, 'dark:hidden')} style={{ width: size, height: size }} />
      <Image src="/app-icon.png" alt="Almanac Notes" width={size} height={size} priority={priority}
        className={cn(shared, 'hidden dark:block')} style={{ width: size, height: size }} />
    </>
  )
}
