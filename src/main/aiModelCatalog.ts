import type { AiProvider, ModelInfo } from '../types/money'

export const DEFAULT_PROVIDER: AiProvider = 'anthropic'

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-terra'
}

/**
 * Used only while a provider is not configured or cannot be reached. Normal
 * operation always discovers models with the provider account's server-side key.
 */
export const FALLBACK_MODELS: Record<AiProvider, ModelInfo[]> = {
  anthropic: [
    { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', provider: 'anthropic' },
    { id: 'claude-opus-5', display_name: 'Claude Opus 5', provider: 'anthropic' },
    { id: 'claude-fable-5', display_name: 'Claude Fable 5', provider: 'anthropic' }
  ],
  openai: [
    { id: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', provider: 'openai' },
    { id: 'gpt-5.6-terra', display_name: 'GPT-5.6 Terra', provider: 'openai' },
    { id: 'gpt-5.6-luna', display_name: 'GPT-5.6 Luna', provider: 'openai' }
  ]
}

const OPENAI_NON_CHAT_MARKERS = [
  'audio',
  'image',
  'realtime',
  'transcribe',
  'tts',
  'embedding',
  'moderation',
  'search-preview',
  'computer-use'
]

export function isAiProvider(value: unknown): value is AiProvider {
  return value === 'anthropic' || value === 'openai'
}

export function isOpenAiChatOrReasoningModel(id: string): boolean {
  const normalized = id.toLowerCase()
  if (OPENAI_NON_CHAT_MARKERS.some((marker) => normalized.includes(marker))) return false
  return /^gpt-|^chatgpt-|^o\d/.test(normalized)
}

export function formatModelDisplayName(id: string): string {
  return id
    .split('-')
    .map((part) => {
      if (/^gpt$/i.test(part)) return 'GPT'
      if (/^o\d+$/i.test(part)) return part.toLowerCase()
      if (/^\d+(\.\d+)*$/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

export function modelsFromAnthropicResponse(
  models: Array<{ id: string; display_name?: string | null }>
): ModelInfo[] {
  return models
    .filter((model) => model.id.startsWith('claude-'))
    .map((model): ModelInfo => ({
      id: model.id,
      display_name: model.display_name || formatModelDisplayName(model.id),
      provider: 'anthropic'
    }))
}

export function modelsFromOpenAiResponse(models: Array<{ id: string; created?: number }>): ModelInfo[] {
  return models
    .filter((model) => isOpenAiChatOrReasoningModel(model.id))
    .sort((left, right) => (right.created ?? 0) - (left.created ?? 0) || left.id.localeCompare(right.id, undefined, { numeric: true }))
    .map((model): ModelInfo => ({
      id: model.id,
      display_name: formatModelDisplayName(model.id),
      provider: 'openai'
    }))
}

export function normalizeCachedModels(provider: AiProvider, value: unknown): ModelInfo[] {
  if (!Array.isArray(value)) return []
  const unique = new Map<string, ModelInfo>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as { id?: unknown; display_name?: unknown; provider?: unknown }
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue
    unique.set(candidate.id, {
      id: candidate.id,
      display_name: typeof candidate.display_name === 'string' ? candidate.display_name : formatModelDisplayName(candidate.id),
      provider
    })
  }
  return [...unique.values()]
}

export function includeSelectedModel(provider: AiProvider, selectedId: string, models: ModelInfo[]): ModelInfo[] {
  if (!selectedId || models.some((model) => model.id === selectedId)) return models
  return [{ id: selectedId, display_name: formatModelDisplayName(selectedId), provider }, ...models]
}
