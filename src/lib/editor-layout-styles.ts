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
// Tiptap（visual：wysiwyg、reading）與 CodeMirror（source：markup、live、split）。
export type EditorViewPresentation = 'markup' | 'live' | 'split' | 'reading' | 'wysiwyg'

export const EDITOR_VIEW_PRESENTATIONS: readonly EditorViewPresentation[] = ['markup', 'live', 'split', 'reading', 'wysiwyg']
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
}) {
  if (options.contentInset === false) {
    return ''
  }

  if (options.isMobile) {
    return ''
  }

  return EDITOR_CONTENT_WIDTH_CLASSES[options.contentWidth]
}
