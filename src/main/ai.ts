import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'
import type { ChatMessage, ChatResult, ModelInfo, SetModelIdResult } from '../types/money'
import {
  createIncomeEntry,
  getAllBudgetItems,
  getAllIncomeEntries,
  getAllTransactions
} from './database'

dotenv.config()

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
const MAX_TOOL_ROUNDS = 12

let cachedClient: Anthropic | null = null
let currentModel = DEFAULT_MODEL
let modelPath = ''
let cachedModels: ModelInfo[] | null = null
let modelsLoadPromise: Promise<ModelInfo[]> | null = null

export function initAiPersistence(userDataPath: string): void {
  modelPath = join(userDataPath, 'model.json')
  if (existsSync(modelPath)) {
    try {
      const parsed = JSON.parse(readFileSync(modelPath, 'utf8')) as { model?: string }
      if (parsed.model) currentModel = parsed.model
    } catch {
      currentModel = DEFAULT_MODEL
    }
  }
}

export function getModelId(): string {
  return currentModel
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  if (cachedModels) return cachedModels
  if (modelsLoadPromise) return modelsLoadPromise
  if (!hasConfiguredApiKey()) {
    cachedModels = []
    return cachedModels
  }
  modelsLoadPromise = getClient()
    .models.list({ limit: 100 })
    .then((page) => {
      cachedModels = page.data.map((model) => ({ id: model.id, display_name: model.display_name }))
      if (!cachedModels.some((model) => model.id === currentModel) && cachedModels[0]) {
        currentModel = cachedModels[0].id
        persistModel()
      }
      return cachedModels
    })
    .finally(() => {
      modelsLoadPromise = null
    })
  return modelsLoadPromise
}

export async function setModelId(id: string): Promise<SetModelIdResult> {
  if (!cachedModels) return { success: false, reason: 'models_not_loaded' }
  if (!cachedModels.some((model) => model.id === id)) return { success: false, reason: 'invalid_model_id' }
  currentModel = id
  persistModel()
  return { success: true }
}

export async function chatWithMoney(pageId: string, message: string, history: ChatMessage[]): Promise<ChatResult> {
  const client = getClient()
  const messages = chatMessagesToTurns(history)
  messages.push({ role: 'user', content: message })
  let dataChanged = false

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: currentModel,
      max_tokens: 1400,
      system: buildSystemPrompt(pageId),
      tools: TOOLS,
      messages
    } as Anthropic.MessageCreateParamsNonStreaming)

    messages.push({ role: 'assistant', content: response.content as never })
    const toolBlocks = response.content.filter((block) => block.type === 'tool_use')
    if (toolBlocks.length === 0) {
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      return { text: text || 'Done.', dataChanged }
    }

    const toolResults = toolBlocks.map((block) => {
      const result = executeTool(block.name, block.input)
      if (block.name === 'create_income_entry') dataChanged = true
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result)
      }
    })
    messages.push({ role: 'user', content: toolResults as never })
  }

  throw new Error('AI tool loop reached the maximum number of rounds')
}

function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!hasConfiguredApiKey()) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

function hasConfiguredApiKey(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY
  return Boolean(apiKey && apiKey !== 'your_key_here')
}

function persistModel(): void {
  if (!modelPath) return
  writeFileSync(modelPath, JSON.stringify({ model: currentModel }, null, 2))
}

function chatMessagesToTurns(history: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history
    .filter((item) => !item.pending && !item.error)
    .map((item) => ({ role: item.role, content: item.content }))
}

function buildSystemPrompt(pageId: string): string {
  const context = JSON.stringify(buildSnapshot())
  if (pageId === 'income') {
    return `You are helping log photography income. When the user pastes shoot information, extract: shoot name, company/client name, date, amount, and any notes. Call create_income_entry for each shoot. If multiple shoots are pasted, create multiple entries. Confirm what was created with a brief summary.\n\n<money_data>${context}</money_data>`
  }
  return `You are a personal finance assistant for Scoop Money. You have access to the user's transaction history, budget settings, and income entries. Help them understand their spending, find savings opportunities, and answer questions about their finances. Be concise and specific with dollar amounts.\n\n<money_data>${context}</money_data>`
}

function buildSnapshot(): unknown {
  const transactions = getAllTransactions().slice(0, 250)
  const budget = getAllBudgetItems()
  const income = getAllIncomeEntries().slice(0, 150)
  const totalSpent = transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0)
  const totalIncome = income.reduce((sum, entry) => sum + entry.amount, 0)
  return { totals: { totalSpent, totalIncome }, transactions, budget, income }
}

function executeTool(name: string, input: unknown): unknown {
  const data = input as Record<string, unknown>
  if (name === 'create_income_entry') {
    return createIncomeEntry({
      shoot_name: String(data.shoot_name ?? ''),
      company: String(data.company ?? ''),
      date: normalizeDate(data.date),
      amount: normalizeAmount(data.amount),
      notes: String(data.notes ?? '')
    })
  }
  if (name === 'get_spending_summary') {
    const category = data.category ? String(data.category) : ''
    const txs = getAllTransactions(category ? { category } : {})
    const spent = txs.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0)
    return { period: data.period ?? 'all', category: category || null, spent, count: txs.length }
  }
  if (name === 'get_budget_comparison') {
    const budget = getAllBudgetItems()
    const transactions = getAllTransactions()
    const spentByCategory = new Map<string, number>()
    transactions.forEach((tx) => {
      if (tx.amount > 0) spentByCategory.set(tx.mapped_category, (spentByCategory.get(tx.mapped_category) ?? 0) + tx.amount)
    })
    return budget.map((item) => ({
      category: item.category,
      budget: item.amount_standard,
      spent: spentByCategory.get(item.category) ?? 0
    }))
  }
  return { error: `Unknown tool: ${name}` }
}

function normalizeDate(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  const parsed = Date.parse(String(value ?? ''))
  return Number.isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000)
}

function normalizeAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value > 10000 ? value : value * 100)
  const cleaned = String(value ?? '').replace(/[,$]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

const TOOLS = [
  {
    name: 'create_income_entry',
    description: 'Create a photography income entry.',
    input_schema: {
      type: 'object',
      properties: {
        shoot_name: { type: 'string' },
        company: { type: 'string' },
        date: { type: ['string', 'number'] },
        amount: { type: ['string', 'number'] },
        notes: { type: 'string' }
      },
      required: ['shoot_name', 'date', 'amount']
    }
  },
  {
    name: 'get_spending_summary',
    description: 'Get a compact spending summary.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string' },
        category: { type: 'string' }
      },
      required: ['period']
    }
  },
  {
    name: 'get_budget_comparison',
    description: 'Compare spending against budget categories.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string' }
      }
    }
  }
] as Anthropic.Tool[]
