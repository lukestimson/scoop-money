import type Anthropic from '@anthropic-ai/sdk'
import type { AiUsageSummary } from '../types/money'

type TokenRates = {
  inputPerMTok: number
  outputPerMTok: number
}

export type UsageAccumulator = {
  apiCalls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

function tokenRatesForAnthropicModel(modelId: string): TokenRates {
  const id = modelId.toLowerCase()
  if (id.includes('haiku')) return { inputPerMTok: 1, outputPerMTok: 5 }
  if (id.includes('opus')) return { inputPerMTok: 15, outputPerMTok: 75 }
  return { inputPerMTok: 3, outputPerMTok: 15 }
}

function tokenRatesForOpenAiModel(modelId: string): TokenRates {
  const id = modelId.toLowerCase()
  if (id.includes('nano')) return { inputPerMTok: 0.05, outputPerMTok: 0.4 }
  if (id.includes('mini')) return { inputPerMTok: 0.25, outputPerMTok: 2 }
  if (id.includes('gpt-4.1')) return { inputPerMTok: 2, outputPerMTok: 8 }
  if (id.includes('pro')) return { inputPerMTok: 15, outputPerMTok: 60 }
  return { inputPerMTok: 1.25, outputPerMTok: 10 }
}

export function createUsageAccumulator(): UsageAccumulator {
  return { apiCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
}

export function accumulateAnthropicUsage(
  acc: UsageAccumulator,
  modelId: string,
  usage: Anthropic.Usage
): UsageAccumulator {
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const rates = tokenRatesForAnthropicModel(modelId)
  const costUsd = (input * rates.inputPerMTok + output * rates.outputPerMTok) / 1_000_000
  return {
    apiCalls: acc.apiCalls + 1,
    inputTokens: acc.inputTokens + input,
    outputTokens: acc.outputTokens + output,
    costUsd: acc.costUsd + costUsd
  }
}

export function accumulateOpenAiUsage(
  acc: UsageAccumulator,
  modelId: string,
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    input_tokens?: number
    output_tokens?: number
  } | null
): UsageAccumulator {
  const input = usage?.input_tokens ?? usage?.prompt_tokens ?? 0
  const output = usage?.output_tokens ?? usage?.completion_tokens ?? 0
  const rates = tokenRatesForOpenAiModel(modelId)
  const costUsd = (input * rates.inputPerMTok + output * rates.outputPerMTok) / 1_000_000
  return {
    apiCalls: acc.apiCalls + 1,
    inputTokens: acc.inputTokens + input,
    outputTokens: acc.outputTokens + output,
    costUsd: acc.costUsd + costUsd
  }
}

export function toUsageSummary(acc: UsageAccumulator): AiUsageSummary {
  return {
    apiCalls: acc.apiCalls,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    costUsd: acc.costUsd
  }
}
