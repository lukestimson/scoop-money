import assert from 'node:assert/strict'
import test from 'node:test'
import {
  includeSelectedModel,
  isOpenAiChatOrReasoningModel,
  modelsFromAnthropicResponse,
  modelsFromOpenAiResponse,
  normalizeCachedModels
} from './aiModelCatalog.ts'

test('keeps OpenAI chat and reasoning models while excluding non-chat APIs', () => {
  const models = modelsFromOpenAiResponse([
    { id: 'gpt-5.6-terra', created: 20 },
    { id: 'o4-mini', created: 10 },
    { id: 'gpt-realtime-2.1' },
    { id: 'gpt-image-2' },
    { id: 'text-embedding-3-large' }
  ])

  assert.deepEqual(models.map((model) => model.id), ['gpt-5.6-terra', 'o4-mini'])
  assert.equal(isOpenAiChatOrReasoningModel('gpt-5.6-sol'), true)
  assert.equal(isOpenAiChatOrReasoningModel('gpt-oss-120b'), true)
  assert.equal(isOpenAiChatOrReasoningModel('gpt-4o-mini-transcribe'), false)
})

test('uses Anthropic display names from the provider response', () => {
  assert.deepEqual(modelsFromAnthropicResponse([
    { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
    { id: 'not-a-claude-model', display_name: 'Ignore me' }
  ]), [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', provider: 'anthropic' }])
})

test('normalizes persisted cache data and preserves a selected model until a successful refresh proves it unavailable', () => {
  const cached = normalizeCachedModels('openai', [
    { id: 'gpt-5.6-terra', display_name: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-terra', display_name: 'Duplicate' },
    { id: 12 },
    null
  ])

  assert.deepEqual(cached, [{ id: 'gpt-5.6-terra', display_name: 'Duplicate', provider: 'openai' }])
  assert.deepEqual(includeSelectedModel('openai', 'gpt-5.6-sol', cached).map((model) => model.id), [
    'gpt-5.6-sol',
    'gpt-5.6-terra'
  ])
})
