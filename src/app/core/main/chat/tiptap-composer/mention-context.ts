// Spike（almanac ALMNC-77）：@ 選單選到的項目 → 膠囊屬性。id 沿用 getMentionedContextKey，
// 送出時用它把膠囊對回 mentionedContexts，buildMentionedContext 的流程不用改。
import { getMentionedContextKey, type MentionedContext } from '../chat-context-strip'
import { normalizeMentionLabel, type ComposerMentionAttrs } from './serialize'

export function getMentionContextLabel(context: MentionedContext) {
  if (context.kind === 'file') {
    return context.file.name.replace(/\.(md|markdown)$/i, '')
  }
  if (context.kind === 'record') return context.record.fileName
  return context.canvas.canvasTitle
}

export function mentionAttrsFromContext(context: MentionedContext): ComposerMentionAttrs {
  const id = getMentionedContextKey(context)
  return {
    id,
    kind: context.kind,
    label: normalizeMentionLabel(getMentionContextLabel(context), id),
  }
}
