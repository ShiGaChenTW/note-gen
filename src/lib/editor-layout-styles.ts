export type EditorContentWidth = 'narrow' | 'standard' | 'wide' | 'full'
export type EditorLineHeight = 'compact' | 'comfortable' | 'relaxed'
export type EditorViewMode = 'visual' | 'source'

export const DEFAULT_EDITOR_CONTENT_WIDTH: EditorContentWidth = 'full'
export const DEFAULT_EDITOR_LINE_HEIGHT: EditorLineHeight = 'comfortable'
export const DEFAULT_EDITOR_VIEW_MODE: EditorViewMode = 'visual'

export const EDITOR_LINE_HEIGHT_VALUES: Record<EditorLineHeight, number> = {
  compact: 1.5,
  comfortable: 1.7,
  relaxed: 1.9,
}

const EDITOR_CONTENT_WIDTH_CLASSES: Record<EditorContentWidth, string> = {
  narrow: 'max-w-2xl mx-auto px-4',
  standard: 'max-w-3xl mx-auto px-4',
  wide: 'max-w-5xl mx-auto px-4',
  full: 'px-10',
}

export function normalizeEditorContentWidth(value: unknown): EditorContentWidth {
  return value === 'narrow' || value === 'standard' || value === 'wide' || value === 'full'
    ? value
    : DEFAULT_EDITOR_CONTENT_WIDTH
}

export function normalizeEditorLineHeight(value: unknown): EditorLineHeight {
  return value === 'compact' || value === 'comfortable' || value === 'relaxed'
    ? value
    : DEFAULT_EDITOR_LINE_HEIGHT
}

export function normalizeEditorViewMode(value: unknown): EditorViewMode {
  return value === 'visual' || value === 'source'
    ? value
    : DEFAULT_EDITOR_VIEW_MODE
}

// Fork（almanac ALMNC-63）：使用者看到的五種檢視。底層仍只有兩個引擎：
// Tiptap（visual：wysiwyg、reading）與 CodeMirror（source：markup、live）。
// 並排預覽（split）已拿掉：舊設定讀到 'split' 時改成 Live Preview。選單順序：預設的 WYSIWYG 在最前面。
export type EditorViewPresentation = 'markup' | 'live' | 'reading' | 'wysiwyg'

export const EDITOR_VIEW_PRESENTATIONS: readonly EditorViewPresentation[] = ['wysiwyg', 'reading', 'live', 'markup']
/** classic 介面只有原本的兩種。 */
export const CLASSIC_EDITOR_VIEW_PRESENTATIONS: readonly EditorViewPresentation[] = ['markup', 'wysiwyg']

export function isEditorViewPresentation(value: unknown): value is EditorViewPresentation {
  return typeof value === 'string' && (EDITOR_VIEW_PRESENTATIONS as readonly string[]).includes(value)
}

export function engineOfPresentation(presentation: EditorViewPresentation): EditorViewMode {
  return presentation === 'wysiwyg' || presentation === 'reading' ? 'visual' : 'source'
}

export function presentationForEngine(mode: EditorViewMode): EditorViewPresentation {
  return mode === 'source' ? 'markup' : 'wysiwyg'
}

/** 沒存過檢視時，從舊的 editorViewMode 推出來。 */
export function normalizeEditorViewPresentation(value: unknown, legacyMode?: unknown): EditorViewPresentation {
  if (isEditorViewPresentation(value)) return value
  if (value === 'split') return 'live'
  return presentationForEngine(normalizeEditorViewMode(legacyMode))
}

/**
 * 實際要顯示的檢視：classic 收斂成兩種；引擎被迫改變（解析失敗、大檔案退回原始碼）時跟著引擎走。
 */
export function resolveEditorViewPresentation(options: {
  preferred: EditorViewPresentation
  effectiveMode: EditorViewMode
  allowExtended: boolean
}): EditorViewPresentation {
  const { preferred, effectiveMode, allowExtended } = options
  const allowed = allowExtended ? preferred : presentationForEngine(engineOfPresentation(preferred))
  return engineOfPresentation(allowed) === effectiveMode ? allowed : presentationForEngine(effectiveMode)
}

export function getEditorContentContainerClass(options: {
  contentWidth: EditorContentWidth
  isMobile: boolean
  outlineOpen?: boolean
  outlinePosition?: 'left' | 'right'
  contentInset?: boolean
  /** Fork（almanac）：V3 的「最寬」兩邊只留 20px（classic 維持 px-10） */
  v3?: boolean
}) {
  if (options.contentInset === false) {
    return ''
  }

  if (options.isMobile) {
    return ''
  }

  if (options.v3 && options.contentWidth === 'full') {
    return 'px-5'
  }

  return EDITOR_CONTENT_WIDTH_CLASSES[options.contentWidth]
}

/** Fork（almanac）：V3 筆記工具列給的三種寬度（設定頁仍有四種，standard 只在那裡選得到）。 */
export const V3_EDITOR_CONTENT_WIDTHS: readonly EditorContentWidth[] = ['narrow', 'wide', 'full']
