'use client'

import { useTranslations } from 'next-intl'
import { Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { deleteBlueprintChapter, type BlueprintProposal } from '@/lib/commander/blueprint'
import { useBlueprintStore } from '@/lib/commander/blueprint-store'
import useSettingStore from '@/stores/setting'
import useWorkbenchStore from '@/stores/workbench'

export function BlueprintFields({ proposal }: { proposal: BlueprintProposal }) {
  const t = useTranslations('workbench.blueprint')
  const workspace = useSettingStore(state => state.workspacePath)
  const put = useBlueprintStore(state => state.put)
  const update = (patch: Partial<BlueprintProposal>) => put(workspace, { ...proposal, ...patch })
  return (
    <div className="space-y-3 text-ui-compact text-ink">
      <p><strong>{t('positioning')}</strong> {proposal.positioning}</p>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-medium">{t('readingOrder')}</legend>
        <ol className="space-y-2">
          {proposal.chapters.map((chapter, index) => (
            <li key={chapter.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-ink">{index + 1}.</span>
                <Input
                  aria-label={t('chapter', { number: index + 1 })}
                  maxLength={250}
                  value={chapter.question}
                  onChange={event => update({ chapters: proposal.chapters.map(item => item.id === chapter.id ? { ...item, question: event.target.value } : item) })}
                />
                <button
                  type="button"
                  className="rounded-(--r) p-2 text-muted-ink hover:bg-hover disabled:opacity-40"
                  disabled={proposal.chapters.length === 1}
                  onClick={() => update({ chapters: deleteBlueprintChapter(proposal.chapters, index) })}
                  aria-label={t('deleteChapter', { number: index + 1 })}
                  title={t('deleteChapter', { number: index + 1 })}
                ><Trash2 className="size-4" aria-hidden /></button>
              </div>
              {chapter.notes.length > 0 && (
                <ul className="space-y-1 pl-6 text-muted-ink">
                  {chapter.notes.map(note => <li key={note.path} title={note.path}>{note.title} · {note.relation}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </fieldset>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={proposal.learningProject ?? false} onChange={event => update({ learningProject: event.target.checked })} />
        {t('learningProject')}
      </label>
    </div>
  )
}

export function DomainExpertOption({ id, name }: { id: string, name: string }) {
  const t = useTranslations('workbench.blueprint')
  const expert = useWorkbenchStore(state => state.pairDomainExperts.includes(id))
  const setExpert = useWorkbenchStore(state => state.setPairDomainExpert)
  return (
    <label className="flex items-center gap-2 text-ui-compact text-ink">
      <input type="checkbox" checked={expert} onChange={event => setExpert(id, event.target.checked)} />
      {t('pairExpert', { name })}
    </label>
  )
}
