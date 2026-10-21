import { useEffect, useState } from 'react'
import { supportsKind } from '@/components/service-picker'
import { useCatalog } from './catalog'
import { readPreference, savePreference } from './preferences'
import { useSession } from './session'

export function usePreferredModel(kind: 'chat' | 'image'): [string, (model: string) => void] {
  const catalog = useCatalog()
  const { user } = useSession()
  const key = `${user?.id || 'public'}:${kind}:${catalog.group}:model`
  const choiceKey = `${key}:${catalog.intentKey}`
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [lastChoice, setLastChoice] = useState('')
  const remembered = choices[choiceKey] ?? catalog.requestedModel ?? ''
  const preferred = remembered || lastChoice || readPreference(key)
  const models = catalog.models
    .filter((model) => supportsKind(model, kind))
    .sort((a, b) => a.model_name.localeCompare(b.model_name))
  let model = ''
  if (!catalog.isPending && !catalog.error) {
    model =
      models.find((item) => item.model_name === preferred)?.model_name ||
      models[0]?.model_name ||
      ''
  }
  useEffect(() => {
    if (model) {
      savePreference(key, model)
      setLastChoice(model)
    }
  }, [model, key])
  return [
    model,
    (value: string) => {
      if (!models.some((item) => item.model_name === value)) return
      setChoices((current) => ({ ...current, [choiceKey]: value }))
      setLastChoice(value)
      savePreference(key, value)
    },
  ]
}
