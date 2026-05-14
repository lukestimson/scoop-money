import { existsSync, readFileSync, writeFileSync } from 'fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import dotenv from 'dotenv'
import type { ChatCompletionContentPart, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { AiPromptSettings, AiProvider, AiProviderState, ChatAttachment, ChatMessage, ChatResult, ModelInfo, SetModelIdResult } from '../types/money'
import { parseLocalDateToUnix } from '../types/dateParsing'
import {
  createBudgetLineItem,
  createIncomeEntry,
  createTransaction,
  deleteAppMetaValues,
  deleteBudgetLineItem,
  getAppMetaValue,
  getAllAccounts,
  getAllBudgetItems,
  getAllBudgetLineItems,
  getAllIncomeEntries,
  getAllTransactions,
  setAppMetaValue,
  updateBudgetLineItem,
  updateTransaction
} from './database'

dotenv.config()

const DEFAULT_PROVIDER: AiProvider = 'anthropic'
const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-5.2'
}
const FALLBACK_MODELS: Record<AiProvider, ModelInfo[]> = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', provider: 'anthropic' },
    { id: 'claude-opus-4-1-20250805', display_name: 'Claude Opus 4.1', provider: 'anthropic' },
    { id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4', provider: 'anthropic' },
    { id: 'claude-3-7-sonnet-20250219', display_name: 'Claude Sonnet 3.7', provider: 'anthropic' },
    { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude Sonnet 3.5', provider: 'anthropic' },
    { id: 'claude-3-5-haiku-20241022', display_name: 'Claude Haiku 3.5', provider: 'anthropic' },
    { id: 'claude-3-haiku-20240307', display_name: 'Claude Haiku 3', provider: 'anthropic' }
  ],
  openai: [
    { id: 'gpt-5.2', display_name: 'GPT-5.2', provider: 'openai' },
    { id: 'gpt-5.2-pro', display_name: 'GPT-5.2 pro', provider: 'openai' },
    { id: 'gpt-5.1', display_name: 'GPT-5.1', provider: 'openai' },
    { id: 'gpt-5', display_name: 'GPT-5', provider: 'openai' },
    { id: 'gpt-5-mini', display_name: 'GPT-5 mini', provider: 'openai' },
    { id: 'gpt-5-nano', display_name: 'GPT-5 nano', provider: 'openai' },
    { id: 'gpt-4.1', display_name: 'GPT-4.1', provider: 'openai' }
  ]
}
const MAX_TOOL_ROUNDS = 12
const execFileAsync = promisify(execFile)
const AI_PROMPT_META_PREFIX = 'ai_prompt.'

const DEFAULT_AI_PROMPT_SETTINGS: AiPromptSettings = {
  general_system_prompt:
    'You are a personal finance assistant for Scoop Money. You have access to the user\'s transaction history, budget settings, income entries, and precomputed monthly/category summaries. Help them understand spending, budget variance, income trends, month-over-month changes, and net cash flow. {accuracy_instruction}\n\n<money_data>{money_data}</money_data>',
  income_actual_system_prompt:
    'You are helping log photography income. When the user pastes shoot information, extract: shoot name, the main POC or client name from the shoot title or description, income type/platform when mentioned (for example Snappr, Thumbtack, Upwork, or Stimsonphoto), date, amount, and any notes. Put the POC/client name in company and the platform or channel in income_type. For notes, store plain text only: one line per bullet, with no leading *, •, -, or other bullet markers because the app renders bullets in the UI. Call create_income_entry for each shoot. If multiple shoots are pasted, create multiple entries. Confirm what was created with a brief summary. {accuracy_instruction}\n\n<money_data>{money_data}</money_data>',
  accuracy_instruction:
    'Use as few tokens as practical while preserving numeric accuracy. Money values in tool/data payloads are integer cents; compute from cents, then present dollars. For financial analysis, state the period and assumptions used, do not invent missing data, and prefer compact tables or bullets over long prose.'
}

let cachedAnthropicClient: Anthropic | null = null
let cachedOpenAiClient: OpenAI | null = null
let currentProvider: AiProvider = DEFAULT_PROVIDER
let currentModels: Record<AiProvider, string> = { ...DEFAULT_MODELS }
let modelPath = ''
const cachedModels: Partial<Record<AiProvider, ModelInfo[]>> = {}
const modelsLoadPromise: Partial<Record<AiProvider, Promise<ModelInfo[]>>> = {}

export function initAiPersistence(userDataPath: string): void {
  modelPath = join(userDataPath, 'model.json')
  if (existsSync(modelPath)) {
    try {
      const parsed = JSON.parse(readFileSync(modelPath, 'utf8')) as {
        provider?: AiProvider
        model?: string
        models?: Partial<Record<AiProvider, string>>
      }
      if (parsed.provider === 'anthropic' || parsed.provider === 'openai') currentProvider = parsed.provider
      if (parsed.models) currentModels = { ...currentModels, ...parsed.models }
      if (parsed.model && !parsed.models?.anthropic) currentModels.anthropic = parsed.model
    } catch {
      currentProvider = DEFAULT_PROVIDER
      currentModels = { ...DEFAULT_MODELS }
    }
  }
}

export function getModelId(): string {
  return currentModels[currentProvider]
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  return getAvailableModelsForProvider(currentProvider)
}

export async function getAiProviderState(): Promise<AiProviderState> {
  const models = await getAvailableModelsForProvider(currentProvider)
  return {
    provider: currentProvider,
    model: currentModels[currentProvider],
    models,
    configured: hasConfiguredApiKey(currentProvider)
  }
}

export async function setAiProvider(provider: AiProvider): Promise<AiProviderState> {
  if (provider !== 'anthropic' && provider !== 'openai') throw new Error(`Unsupported AI provider: ${provider}`)
  currentProvider = provider
  const models = await getAvailableModelsForProvider(provider)
  if (!models.some((model) => model.id === currentModels[provider])) {
    currentModels[provider] = models[0]?.id ?? DEFAULT_MODELS[provider]
  }
  persistModel()
  return { provider, model: currentModels[provider], models, configured: hasConfiguredApiKey(provider) }
}

export async function setModelId(id: string): Promise<SetModelIdResult> {
  const models = await getAvailableModelsForProvider(currentProvider)
  if (!models) return { success: false, reason: 'models_not_loaded' }
  if (!models.some((model) => model.id === id)) return { success: false, reason: 'invalid_model_id' }
  currentModels[currentProvider] = id
  persistModel()
  return { success: true }
}

async function getAvailableModelsForProvider(provider: AiProvider): Promise<ModelInfo[]> {
  if (cachedModels[provider]) return cachedModels[provider]
  if (modelsLoadPromise[provider]) return modelsLoadPromise[provider]
  if (!hasConfiguredApiKey(provider)) {
    cachedModels[provider] = ensureCurrentModelInList(provider, FALLBACK_MODELS[provider])
    return cachedModels[provider]
  }

  modelsLoadPromise[provider] = loadProviderModels(provider)
    .then((models) => {
      cachedModels[provider] = ensureCurrentModelInList(provider, models.length > 0 ? models : FALLBACK_MODELS[provider])
      if (!cachedModels[provider]?.some((model) => model.id === currentModels[provider]) && cachedModels[provider]?.[0]) {
        currentModels[provider] = cachedModels[provider][0].id
        persistModel()
      }
      return cachedModels[provider] ?? []
    })
    .catch(() => {
      cachedModels[provider] = ensureCurrentModelInList(provider, FALLBACK_MODELS[provider])
      return cachedModels[provider] ?? []
    })
    .finally(() => {
      modelsLoadPromise[provider] = undefined
    })
  return modelsLoadPromise[provider]
}

async function loadProviderModels(provider: AiProvider): Promise<ModelInfo[]> {
  if (provider === 'anthropic') {
    const page = await getAnthropicClient().models.list({ limit: 100 })
    const remoteNames = new Map(page.data.map((model) => [model.id, model.display_name]))
    return FALLBACK_MODELS.anthropic.map((model) => ({
      ...model,
      display_name: remoteNames.get(model.id) ?? model.display_name
    }))
  }

  const page = await getOpenAiClient().models.list()
  const remoteIds = new Set(page.data.map((model) => model.id))
  return FALLBACK_MODELS.openai.filter((model) => remoteIds.has(model.id) || !hasConfiguredApiKey('openai'))
}

function ensureCurrentModelInList(provider: AiProvider, models: ModelInfo[]): ModelInfo[] {
  const current = currentModels[provider]
  if (models.some((model) => model.id === current)) return models
  currentModels[provider] = models[0]?.id ?? DEFAULT_MODELS[provider]
  return models
}

export function getAiPromptSettings(): AiPromptSettings {
  return {
    general_system_prompt: getPromptValue('general_system_prompt'),
    income_actual_system_prompt: getPromptValue('income_actual_system_prompt'),
    accuracy_instruction: getPromptValue('accuracy_instruction')
  }
}

export function updateAiPromptSettings(data: Partial<AiPromptSettings>): AiPromptSettings {
  ;(['general_system_prompt', 'income_actual_system_prompt', 'accuracy_instruction'] as const).forEach((key) => {
    const value = data[key]
    if (value === undefined) return
    const normalized = value.replace(/\r\n/g, '\n').trim()
    if (normalized.length < 20) throw new Error('Prompt sections must be at least 20 characters.')
    setAppMetaValue(`${AI_PROMPT_META_PREFIX}${key}`, normalized)
  })
  return getAiPromptSettings()
}

export function resetAiPromptSettings(): AiPromptSettings {
  deleteAppMetaValues(
    (['general_system_prompt', 'income_actual_system_prompt', 'accuracy_instruction'] as const).map(
      (key) => `${AI_PROMPT_META_PREFIX}${key}`
    )
  )
  return getAiPromptSettings()
}

export async function chatWithMoney(
  pageId: string,
  message: string,
  history: ChatMessage[],
  attachments: ChatAttachment[] = []
): Promise<ChatResult> {
  if (currentProvider === 'openai') return chatWithOpenAi(pageId, message, history, attachments)
  return chatWithAnthropic(pageId, message, history, attachments)
}

async function chatWithAnthropic(
  pageId: string,
  message: string,
  history: ChatMessage[],
  attachments: ChatAttachment[] = []
): Promise<ChatResult> {
  const client = getAnthropicClient()
  const messages: Anthropic.MessageParam[] = chatMessagesToTurns(history)
  messages.push({ role: 'user', content: buildUserContent(message, attachments) })
  let dataChanged = false

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: currentModels.anthropic,
      max_tokens: 1400,
      system: buildSystemPrompt(pageId),
      tools: ANTHROPIC_TOOLS,
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
      if (
        block.name === 'create_income_entry' ||
        block.name === 'create_transaction' ||
        block.name === 'update_transaction' ||
        block.name === 'create_budget_line_item' ||
        block.name === 'update_budget_line_item' ||
        block.name === 'delete_budget_line_item'
      ) {
        dataChanged = true
      }
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

async function chatWithOpenAi(
  pageId: string,
  message: string,
  history: ChatMessage[],
  attachments: ChatAttachment[] = []
): Promise<ChatResult> {
  const client = getOpenAiClient()
  const messages: ChatCompletionMessageParam[] = [
    { role: 'developer', content: buildSystemPrompt(pageId) },
    ...openAiMessagesToTurns(history),
    { role: 'user', content: buildOpenAiUserContent(message, attachments) }
  ]
  let dataChanged = false

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.chat.completions.create({
      model: currentModels.openai,
      max_completion_tokens: 1400,
      tools: OPENAI_TOOLS,
      tool_choice: 'auto',
      messages
    })
    const choice = response.choices[0]?.message
    if (!choice) return { text: 'No response returned.', dataChanged }
    messages.push({
      role: 'assistant',
      content: choice.content ?? null,
      tool_calls: choice.tool_calls
    })
    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      return { text: choice.content || 'Done.', dataChanged }
    }

    for (const call of choice.tool_calls) {
      if (call.type !== 'function') continue
      const result = executeTool(call.function.name, parseToolArguments(call.function.arguments))
      if (
        call.function.name === 'create_income_entry' ||
        call.function.name === 'create_transaction' ||
        call.function.name === 'update_transaction' ||
        call.function.name === 'create_budget_line_item' ||
        call.function.name === 'update_budget_line_item' ||
        call.function.name === 'delete_budget_line_item'
      ) {
        dataChanged = true
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      })
    }
  }

  throw new Error('AI tool loop reached the maximum number of rounds')
}

function getAnthropicClient(): Anthropic {
  if (cachedAnthropicClient) return cachedAnthropicClient
  tryLoadDotEnv()
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!hasConfiguredApiKey('anthropic')) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to /Users/lukestimson/Documents/scoop-money/.env and restart the app.')
  }
  cachedAnthropicClient = new Anthropic({ apiKey })
  return cachedAnthropicClient
}

function getOpenAiClient(): OpenAI {
  if (cachedOpenAiClient) return cachedOpenAiClient
  tryLoadDotEnv()
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!hasConfiguredApiKey('openai')) {
    throw new Error('OPENAI_API_KEY is not set. Add it to /Users/lukestimson/Documents/scoop-money/.env and restart the app.')
  }
  cachedOpenAiClient = new OpenAI({ apiKey })
  return cachedOpenAiClient
}

function hasConfiguredApiKey(provider: AiProvider): boolean {
  tryLoadDotEnv()
  const key = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
  return Boolean(key && key.trim() && !key.includes('your_') && key !== 'your_key_here')
}

function tryLoadDotEnv(): void {
  if (process.env.ANTHROPIC_API_KEY?.trim() && process.env.OPENAI_API_KEY?.trim()) return
  for (const dir of [process.cwd(), join(process.cwd(), '..')]) {
    const path = join(dir, '.env')
    if (!existsSync(path)) continue
    dotenv.config({ path, override: false })
    if (process.env.ANTHROPIC_API_KEY?.trim() && process.env.OPENAI_API_KEY?.trim()) return
  }
}

function persistModel(): void {
  if (!modelPath) return
  writeFileSync(modelPath, JSON.stringify({ provider: currentProvider, model: currentModels[currentProvider], models: currentModels }, null, 2))
}

function chatMessagesToTurns(history: ChatMessage[]): Anthropic.MessageParam[] {
  return history
    .filter((item) => !item.pending && !item.error)
    .map((item) => ({ role: item.role, content: item.content }))
}

function openAiMessagesToTurns(history: ChatMessage[]): ChatCompletionMessageParam[] {
  return history
    .filter((item) => !item.pending && !item.error)
    .map((item) => ({ role: item.role, content: item.content }))
}

function buildUserContent(message: string, attachments: ChatAttachment[]): string | Anthropic.ContentBlockParam[] {
  const text = message.trim() || '(attachments only)'
  if (attachments.length === 0) return text

  const blocks: Anthropic.ContentBlockParam[] = [{ type: 'text', text }]
  for (const attachment of attachments) {
    blocks.push({ type: 'text', text: `Attached file: ${attachment.name}` })
    if (attachment.kind === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: attachment.dataBase64
        }
      })
    } else {
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: attachment.dataBase64
        }
      })
    }
  }
  return blocks
}

function buildOpenAiUserContent(message: string, attachments: ChatAttachment[]): string | ChatCompletionContentPart[] {
  const text = message.trim() || '(attachments only)'
  if (attachments.length === 0) return text

  const parts: ChatCompletionContentPart[] = [{ type: 'text', text }]
  for (const attachment of attachments) {
    parts.push({ type: 'text', text: `Attached file: ${attachment.name}` })
    if (attachment.kind === 'image') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${attachment.mediaType};base64,${attachment.dataBase64}`
        }
      })
    } else {
      parts.push({
        type: 'text',
        text: `PDF attachments are available in the Anthropic provider. For OpenAI, ask the user to paste the relevant PDF text if needed.`
      })
    }
  }
  return parts
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function buildSystemPrompt(pageId: string): string {
  const context = JSON.stringify(buildSnapshot())
  const settings = getAiPromptSettings()
  const template = pageId === 'income' || pageId === 'income-actual'
    ? settings.income_actual_system_prompt
    : settings.general_system_prompt
  let rendered = renderPrompt(template, settings.accuracy_instruction, context, pageId)
  if (pageId === 'expenses-budget') {
    rendered +=
      '\n\nYou are on the Budget page. money_data includes budgetLineItems (id, category, label, monthly_cents, is_need). To edit lines, use create_budget_line_item, update_budget_line_item, or delete_budget_line_item. category must match a canonical name from budget[].category. Pass monthly amounts in dollars unless the value is clearly integer cents.'
  }
  if (pageId === 'expenses-actual' || pageId === 'transactions') {
    rendered +=
      '\n\nYou are on the Transactions page. You can create and update expense transactions with create_transaction and update_transaction. Sign convention: expenses/outflows/spending are negative integer cents; reimbursements, refunds, statement credits, and offsets are positive integer cents because they reduce spending. Pass amount as dollars (-64.84 for spending, 64.84 for an offset) or pass amount_cents as integer cents (-6484 for spending, 6484 for an offset); never pass integer cents in amount. If the user provides positive dollar values while describing expenses, use kind=expense so the tool stores them as negative spending. Pass plain calendar dates exactly as the user provided them; date-only values are stored as local calendar dates, not UTC. Use the account name when known (Capital One, Venmo, EBT, Chase), category should match budget categories when possible, and source should usually be manual for AI-created transactions.'
  }
  return rendered
}

function getPromptValue(key: keyof AiPromptSettings): string {
  const saved = getAppMetaValue(`${AI_PROMPT_META_PREFIX}${key}`)
  return saved && saved.trim().length > 0 ? saved : DEFAULT_AI_PROMPT_SETTINGS[key]
}

function renderPrompt(template: string, accuracyInstruction: string, moneyData: string, pageId: string): string {
  let rendered = template
    .replaceAll('{accuracy_instruction}', accuracyInstruction)
    .replaceAll('{money_data}', moneyData)
    .replaceAll('{page_id}', pageId)
  if (!rendered.includes('<money_data>') && !rendered.includes(moneyData)) {
    rendered += `\n\n<money_data>${moneyData}</money_data>`
  }
  return rendered
}

function buildSnapshot(): unknown {
  const transactions = getAllTransactions()
  const budget = getAllBudgetItems()
  const income = getAllIncomeEntries()
  const recentTransactions = transactions.slice(0, 180).map((tx) => ({
    date: tx.date,
    description: tx.description,
    amount: tx.amount,
    category: tx.mapped_category,
    source: tx.source
  }))
  const recentIncome = income.slice(0, 120).map((entry) => ({
    date: entry.date,
    shoot: entry.shoot_name,
    company: entry.company,
    income_type: entry.income_type,
    amount: entry.amount
  }))
  const totalExpenseNet = transactions.reduce((sum, tx) => sum - tx.amount, 0)
  const totalExpenseOutflows = transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  const totalExpenseOffsets = transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0)
  const totalIncome = income.reduce((sum, entry) => sum + entry.amount, 0)
  const budgetLines = getAllBudgetLineItems().slice(0, 160).map((line) => ({
    id: line.id,
    category: line.category,
    label: line.label,
    monthly_cents: line.monthly_amount,
    is_need: line.is_need,
    support_scope: line.support_scope,
    section: line.section
  }))
  return {
    units: 'integer cents',
    transactionSignConvention: 'negative amounts are spending/outflows; positive amounts are reimbursements/refunds/credits/offsets that reduce spending',
    totals: { totalExpenseNet, totalExpenseOutflows, totalExpenseOffsets, totalIncome, netAfterExpenses: totalIncome - totalExpenseNet },
    monthly: buildMonthlySummary(transactions, income),
    budget: budget.map((item) => ({
      category: item.category,
      isNeed: item.is_need,
      standard: item.amount_standard,
      withParents: item.amount_with_parents,
      withAid: item.amount_with_aid
    })),
    budgetLineItems: budgetLines,
    accounts: getAllAccounts().map((account) => ({ id: account.id, name: account.name, type: account.type })),
    recentTransactions,
    recentIncome
  }
}

function buildMonthlySummary(transactions: ReturnType<typeof getAllTransactions>, income: ReturnType<typeof getAllIncomeEntries>): unknown[] {
  const months = new Map<
    string,
    {
      month: string
      expenseNet: number
      expenseOutflows: number
      expenseOffsets: number
      income: number
      netAfterExpenses: number
      categories: Map<string, number>
    }
  >()
  const ensure = (key: string) => {
    let row = months.get(key)
    if (!row) {
      row = {
        month: key,
        expenseNet: 0,
        expenseOutflows: 0,
        expenseOffsets: 0,
        income: 0,
        netAfterExpenses: 0,
        categories: new Map<string, number>()
      }
      months.set(key, row)
    }
    return row
  }

  transactions.forEach((tx) => {
    const row = ensure(monthKey(tx.date))
    row.expenseNet -= tx.amount
    if (tx.amount < 0) row.expenseOutflows += Math.abs(tx.amount)
    if (tx.amount > 0) row.expenseOffsets += tx.amount
    row.categories.set(tx.mapped_category, (row.categories.get(tx.mapped_category) ?? 0) - tx.amount)
  })
  income.forEach((entry) => {
    const row = ensure(monthKey(entry.date))
    row.income += entry.amount
  })

  return Array.from(months.values())
    .map((row) => ({
      month: row.month,
      expenseNet: row.expenseNet,
      expenseOutflows: row.expenseOutflows,
      expenseOffsets: row.expenseOffsets,
      income: row.income,
      netAfterExpenses: row.income - row.expenseNet,
      categories: Array.from(row.categories.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, amount]) => ({ category, amount }))
    }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 18)
}

function monthKey(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function executeTool(name: string, input: unknown): unknown {
  const data = input as Record<string, unknown>
  if (name === 'create_income_entry') {
    return createIncomeEntry({
      shoot_name: String(data.shoot_name ?? ''),
      company: String(data.company ?? ''),
      income_type: String(data.income_type ?? ''),
      date: normalizeDate(data.date),
      amount: normalizeAmount(data.amount),
      notes: String(data.notes ?? '')
    })
  }
  if (name === 'get_spending_summary') {
    const category = data.category ? String(data.category) : ''
    const txs = getAllTransactions(category ? { category } : {})
    const spent = txs.reduce((sum, tx) => sum - tx.amount, 0)
    return { period: data.period ?? 'all', category: category || null, spent, count: txs.length }
  }
  if (name === 'get_budget_comparison') {
    const budget = getAllBudgetItems()
    const transactions = getAllTransactions()
    const spentByCategory = new Map<string, number>()
    transactions.forEach((tx) => {
      spentByCategory.set(tx.mapped_category, (spentByCategory.get(tx.mapped_category) ?? 0) - tx.amount)
    })
    return budget.map((item) => ({
      category: item.category,
      budget: item.amount_standard,
      spent: spentByCategory.get(item.category) ?? 0
    }))
  }
  if (name === 'create_transaction') {
    if (data.amount === undefined && data.amount_cents === undefined) return { error: 'amount or amount_cents is required' }
    const category = String(data.category ?? data.mapped_category ?? data.raw_category ?? 'Uncategorized')
    const accountId = resolveAccountId(data.account_id, data.account_name)
    const amount = normalizeTransactionAmount(data.amount_cents ?? data.amount, data.kind ?? 'expense', data.amount_cents !== undefined)
    const row = createTransaction({
      date: normalizeDate(data.date),
      description: String(data.description ?? ''),
      amount,
      raw_category: String(data.raw_category ?? category),
      mapped_category: category,
      account_id: accountId,
      source: 'manual',
      notes: String(data.notes ?? '')
    })
    return {
      success: true,
      id: row.id,
      date: row.date,
      description: row.description,
      category: row.mapped_category,
      account_id: row.account_id,
      amount_cents: row.amount
    }
  }
  if (name === 'update_transaction') {
    const id = Number(data.id)
    if (!Number.isFinite(id)) return { error: 'id must be a number' }
    const patch: Parameters<typeof updateTransaction>[1] = {}
    if (data.date !== undefined) patch.date = normalizeDate(data.date)
    if (data.description !== undefined) patch.description = String(data.description)
    if (data.amount !== undefined || data.amount_cents !== undefined) {
      patch.amount = normalizeTransactionAmount(data.amount_cents ?? data.amount, data.kind, data.amount_cents !== undefined)
    }
    if (data.category !== undefined || data.mapped_category !== undefined) patch.mapped_category = String(data.category ?? data.mapped_category)
    if (data.raw_category !== undefined) patch.raw_category = String(data.raw_category)
    if (data.account_id !== undefined || data.account_name !== undefined) patch.account_id = resolveAccountId(data.account_id, data.account_name)
    if (data.notes !== undefined) patch.notes = String(data.notes)
    const row = updateTransaction(id, patch)
    return { success: true, id: row.id, description: row.description, category: row.mapped_category, amount_cents: row.amount }
  }
  if (name === 'create_budget_line_item') {
    const row = createBudgetLineItem({
      category: String(data.category ?? ''),
      label: String(data.label ?? ''),
      monthly_amount: normalizeAmount(data.monthly_amount),
      is_need: data.is_need === false ? false : data.is_need === true ? true : undefined,
      section: ''
    })
    return { success: true, id: row.id, category: row.category, label: row.label, monthly_cents: row.monthly_amount }
  }
  if (name === 'update_budget_line_item') {
    const id = Number(data.id)
    if (!Number.isFinite(id)) return { error: 'id must be a number' }
    const patch: Parameters<typeof updateBudgetLineItem>[1] = {}
    if (data.label !== undefined) patch.label = String(data.label)
    if (data.monthly_amount !== undefined) patch.monthly_amount = normalizeAmount(data.monthly_amount)
    if (data.is_need === true || data.is_need === false) {
      patch.is_need = Boolean(data.is_need)
      patch.section = patch.is_need ? 'Needs' : 'Wants'
    }
    if (data.category !== undefined) patch.category = String(data.category)
    const row = updateBudgetLineItem(id, patch)
    return { success: true, id: row.id, category: row.category, label: row.label, monthly_cents: row.monthly_amount, is_need: row.is_need }
  }
  if (name === 'delete_budget_line_item') {
    const id = Number(data.id)
    if (!Number.isFinite(id)) return { error: 'id must be a number' }
    deleteBudgetLineItem(id)
    return { success: true, id }
  }
  return { error: `Unknown tool: ${name}` }
}

function normalizeDate(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value > 100000000000 ? value / 1000 : value)
  const text = String(value ?? '')
  const localDate = parseLocalDateToUnix(text)
  if (localDate !== null) return localDate
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000)
}

function normalizeAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value > 10000 ? value : value * 100)
  const cleaned = String(value ?? '').replace(/[,$]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

function normalizeTransactionAmount(value: unknown, kind: unknown, isCents = false): number {
  const parsedCents = Number(value)
  const cents = isCents && Number.isFinite(parsedCents) ? Math.round(parsedCents) : normalizeAmount(value)
  const normalizedKind = String(kind ?? '').trim().toLowerCase()
  if (['reimbursement', 'refund', 'credit', 'offset', 'inflow', 'income'].includes(normalizedKind)) {
    return Math.abs(cents)
  }
  if (['expense', 'outflow', 'debit', 'spend', 'payment'].includes(normalizedKind)) {
    return -Math.abs(cents)
  }
  return cents
}

function resolveAccountId(accountIdInput: unknown, accountNameInput: unknown): number | null {
  const accountId = Number(accountIdInput)
  if (Number.isFinite(accountId) && accountId > 0) return Math.round(accountId)

  const requestedName = String(accountNameInput ?? '').trim().toLowerCase()
  if (!requestedName) return null

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const requestedSlug = normalize(requestedName)
  const accounts = getAllAccounts()
  const exact = accounts.find((account) => account.name.toLowerCase() === requestedName)
  if (exact) return exact.id

  const loose = accounts.find((account) => {
    const accountSlug = normalize(account.name)
    return accountSlug === requestedSlug || accountSlug.includes(requestedSlug) || requestedSlug.includes(accountSlug)
  })
  return loose?.id ?? null
}

const APP_TOOLS = [
  {
    name: 'create_income_entry',
    description: 'Create a photography income entry.',
    input_schema: {
      type: 'object',
      properties: {
        shoot_name: { type: 'string' },
        company: { type: 'string', description: 'Main POC or client name from the shoot title or description' },
        income_type: { type: 'string', description: 'Income platform or channel, for example Snappr, Thumbtack, Upwork, or Stimsonphoto' },
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
  },
  {
    name: 'create_transaction',
    description:
      'Create an expense, reimbursement, refund, credit, or offset transaction. Expenses/outflows are negative cents in Scoop Money; reimbursements/refunds/credits/offsets are positive cents because they reduce spending.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: ['string', 'number'], description: 'Transaction date, for example 2026-03-01' },
        description: { type: 'string' },
        amount: {
          type: ['string', 'number'],
          description: 'Dollar amount. Negative means spending; positive means offset/refund/credit. Use amount_cents instead when the value is already integer cents.'
        },
        amount_cents: { type: 'number', description: 'Integer cents. Negative means spending; positive means offset/refund/credit. Use this instead of amount when the value is already stored as cents.' },
        category: { type: 'string', description: 'Mapped budget category, for example Rent or Groceries' },
        raw_category: { type: 'string', description: 'Original category text, if different from category' },
        account_name: { type: 'string', description: 'Known account name: Capital One, Venmo, EBT, or Chase' },
        account_id: { type: 'number', description: 'Known account id from money_data.accounts' },
        kind: {
          type: 'string',
          enum: ['expense', 'outflow', 'debit', 'spend', 'payment', 'reimbursement', 'refund', 'credit', 'offset', 'inflow'],
          description: 'Use expense/outflow/debit/spend/payment for spending; use reimbursement/refund/credit/offset/inflow for positive offsets.'
        },
        notes: { type: 'string' }
      },
      required: ['date', 'description', 'category']
    }
  },
  {
    name: 'update_transaction',
    description: 'Update an existing transaction by id. Use ids from the app UI or money_data when available.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        date: { type: ['string', 'number'] },
        description: { type: 'string' },
        amount: { type: ['string', 'number'] },
        amount_cents: { type: 'number', description: 'Integer cents. Negative means spending; positive means offset/refund/credit. Use this instead of amount when the value is already stored as cents.' },
        category: { type: 'string' },
        mapped_category: { type: 'string' },
        raw_category: { type: 'string' },
        account_name: { type: 'string' },
        account_id: { type: 'number' },
        kind: {
          type: 'string',
          enum: ['expense', 'outflow', 'debit', 'spend', 'payment', 'reimbursement', 'refund', 'credit', 'offset', 'inflow']
        },
        notes: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'create_budget_line_item',
    description: 'Create a budget line item in a category. Amounts are dollars unless clearly large integer cents.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Canonical budget category name' },
        label: { type: 'string' },
        monthly_amount: { type: ['string', 'number'], description: 'Monthly budget in dollars (e.g. 120.50) or cents if > 1000' },
        is_need: { type: 'boolean', description: 'true for needs, false for wants' }
      },
      required: ['category', 'monthly_amount']
    }
  },
  {
    name: 'update_budget_line_item',
    description: 'Update an existing budget line by id (see budgetLineItems in snapshot).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        label: { type: 'string' },
        monthly_amount: { type: ['string', 'number'] },
        is_need: { type: 'boolean' },
        category: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'delete_budget_line_item',
    description: 'Delete a budget line item by id.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number' }
      },
      required: ['id']
    }
  }
] as const

const ANTHROPIC_TOOLS = APP_TOOLS as unknown as Anthropic.Tool[]
const OPENAI_TOOLS: ChatCompletionTool[] = APP_TOOLS.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema
  }
}))

export async function startMacDictation(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Mac Dictation is only available on macOS.')
  }

  const script = `
    tell application "System Events"
      tell (first application process whose frontmost is true)
        set editMenu to menu 1 of menu bar item "Edit" of menu bar 1
        set dictItem to first menu item of editMenu whose name starts with "Start Dictation"
        click dictItem
      end tell
    end tell
  `.trim()

  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 4000 })
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    if (raw.includes('-1743') || raw.toLowerCase().includes('not authorized')) {
      throw new Error('Grant Automation access: System Settings > Privacy & Security > Automation > Scoop Money > System Events.')
    }
    if (raw.includes('Can’t get menu') || raw.includes("Can't get menu") || raw.includes('-1728')) {
      throw new Error('Start Dictation not found in the Edit menu. Enable it in System Settings > Keyboard > Dictation.')
    }
    throw new Error('Could not start Mac Dictation. Press Fn Fn manually.')
  }
}
