'use client'

import { useEffect, useState } from 'react'
import { Plus, RotateCcw, Star, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  DEFAULT_FRONTMATTER_TEMPLATES,
  normalizeFrontmatterTemplates,
  pickDefaultTemplate,
  validateTemplateYaml,
  type FrontmatterTemplate,
} from '@/lib/markdown/frontmatter-template'
import useSettingStore from '@/stores/setting'

function newTemplateId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function TemplateCard({
  template,
  isDefault,
  canDelete,
  onSave,
  onMakeDefault,
  onDelete,
}: {
  template: FrontmatterTemplate
  isDefault: boolean
  canDelete: boolean
  onSave: (template: FrontmatterTemplate) => void
  onMakeDefault: () => void
  onDelete: () => void
}) {
  const t = useTranslations('settings.editor.frontmatter')
  const [name, setName] = useState(template.name)
  const [yaml, setYaml] = useState(template.yaml)
  const [error, setError] = useState('')
  useEffect(() => { setName(template.name); setYaml(template.yaml); setError('') }, [template.name, template.yaml])

  function commit() {
    const message = validateTemplateYaml(yaml)
    setError(message)
    if (message) return
    if (name === template.name && yaml === template.yaml) return
    onSave({ ...template, name: name.trim() || template.name, yaml })
  }

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t('name')}
          value={name}
          onChange={event => setName(event.target.value)}
          onBlur={commit}
        />
        <Button
          type="button"
          variant={isDefault ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={isDefault}
          onClick={onMakeDefault}
        >
          <Star className={isDefault ? 'fill-current' : ''} />
          {isDefault ? t('isDefault') : t('makeDefault')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('delete')}
          disabled={!canDelete}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
      <Textarea
        aria-label={t('yaml')}
        aria-invalid={!!error}
        spellCheck={false}
        value={yaml}
        onChange={event => setYaml(event.target.value)}
        onBlur={commit}
        className="min-h-28 font-mono text-xs"
      />
      {error ? <p role="alert" className="whitespace-pre-wrap break-all text-xs text-destructive">{t('invalid')}：{error}</p> : null}
    </div>
  )
}

export default function FrontmatterTemplates() {
  const t = useTranslations('settings.editor.frontmatter')
  const storedTemplates = useSettingStore(state => state.frontmatterTemplates)
  const defaultId = useSettingStore(state => state.frontmatterDefaultTemplateId)
  const setTemplates = useSettingStore(state => state.setFrontmatterTemplates)
  const setDefaultId = useSettingStore(state => state.setFrontmatterDefaultTemplateId)
  const templates = normalizeFrontmatterTemplates(storedTemplates)
  const activeId = pickDefaultTemplate(templates, defaultId)?.id ?? ''

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{t('help')}</p>
      <p className="text-xs text-muted-foreground">
        <code>{'{{title}}'}</code> {t('vars.title')}　<code>{'{{date}}'}</code> {t('vars.date')}　<code>{'{{datetime}}'}</code> {t('vars.datetime')}
      </p>
      {templates.map(template => (
        <TemplateCard
          key={template.id}
          template={template}
          isDefault={template.id === activeId}
          canDelete={templates.length > 1}
          onSave={next => void setTemplates(templates.map(item => item.id === next.id ? next : item))}
          onMakeDefault={() => void setDefaultId(template.id)}
          onDelete={() => {
            const rest = templates.filter(item => item.id !== template.id)
            void setTemplates(rest)
            if (template.id === activeId) void setDefaultId(rest[0].id)
          }}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const id = newTemplateId()
            void setTemplates([...templates, { id, name: t('newName'), yaml: 'title: {{title}}\n' }])
          }}
        >
          <Plus />{t('add')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const defaults = DEFAULT_FRONTMATTER_TEMPLATES.map(item => ({ ...item }))
            void setTemplates(defaults)
            void setDefaultId(defaults[0].id)
          }}
        >
          <RotateCcw />{t('reset')}
        </Button>
      </div>
    </div>
  )
}
