import { isMobileDevice } from './check'

type RecordRouter = {
  push: (path: string) => void
}

/**
 * 记录完成后的导航处理
 * 桌面端（Fork #46）：不切換畫面；記錄留在 Inbox，由呼叫端的提示提供「查看」
 * 移动端：跳转到记录页面
 */
export function handleRecordComplete(router?: RecordRouter) {
  const isMobile = isMobileDevice()
  
  if (isMobile) {
    // 移动端：跳转到记录页面
    if (router) {
      router.push('/mobile/record')
    } else if (typeof window !== 'undefined') {
      window.location.href = '/mobile/record'
    }
  } else {
    // 記錄不再放在左側欄，桌面端不切換任何畫面
  }
}
