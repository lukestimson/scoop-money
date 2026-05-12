import { existsSync, readFileSync, writeFileSync } from 'fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'
import type { AiPromptSettings, ChatAttachment, ChatMessage, ChatResult, ModelInfo, SetModelIdResult } from '../types/money'
import {
  createBudgetLineItem,
  createIncomeEntry,
  deleteAppMetaValues,
  deleteBudgetLineItem,
  getAppMetaValue,
  getAllBudgetItems,
  getAllBudgetLineItems,
  getAllIncomeEntries,
  getAllTransactions,
  setAppMetaValue,
  updateBudgetLineItem
} from './database'

dotenv.config()

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
const MAX_TOOL_ROUNDS = 12
const execFileAsync = promisify(execFile)
const AI_PROMPT_META_PREFIX = 'ai_prompt.'

const DEFAULT_AI_PROMPT_SETTINGS: AiPromptSettings = {
  general_system_prompt:
    'You are a personal finance assistant for Scoop Money. You have access to the user\'s transaction history, budget settings, income entries, and precomputed monthly/category summaries. Help them understand spending, budget variance, income trends, month-over-month changes, and net cash flow. {accuracy_instruction}\n\n<money_data>{money_data}</money_data>',
  income_actual_system_prompt:
    'You are helping log photography income. When the user pastes shoot information, extract: shoot name, company/client name, date, amount, and any notes. Call create_income_entry for each shoot. If multiple shoots are pasted, create multiple entries. Confirm what was created with a brief summary. {accuracy_instruction}\n\n<money_data>{money_data}</money_data>',
  accuracy_instruction:
    'Use as few tokens as practical while preserving numeric accuracy. Money values in tool/data payloads are integer cents; compute from cents, then present dollars. For financial analysis, state the period and assumptions used, do not invent missing data, and prefer compact tables or bullets over long prose.'
}

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
  const client = getClient()
  const messages: Anthropic.MessageParam[] = chatMessagesToTurns(history)
  messages.push({ role: 'user', content: buildUserContent(message, attachments) })
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
      if (
        block.name === 'create_income_entry' ||
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

function getClient(): Anthropic {
  if (cachedClient) return cachedClient
  tryLoadDotEnv()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!hasConfiguredApiKey()) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to /Users/lukestimson/Documents/scoop-money/.env and restart the app.')
  }
  cachedClient = new Anthropic({ apiKey })
  return cachedClient
}

function hasConfiguredApiKey(): boolean {
  tryLoadDotEnv()
  const apiKey = process.env.ANTHROPIC_API_KEY
  return Boolean(apiKey && apiKey !== 'your_key_here')
}

function tryLoadDotEnv(): void {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return
  for (const dir of [process.cwd(), join(process.cwd(), '..')]) {
    const path = join(dir, '.env')
    if (!existsSync(path)) continue
    dotenv.config({ path, override: false })
    if (process.env.ANTHROPIC_API_KEY?.trim()) return
  }
}

function persistModel(): void {
  if (!modelPath) return
  writeFileSync(modelPath, JSON.stringify({ model: currentModel }, null, 2))
}

function chatMessagesToTurns(history: ChatMessage[]): Anthropic.MessageParam[] {
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
    amount: entry.amount
  }))
  const totalExpenseNet = transactions.reduce((sum, tx) => sum + tx.amount, 0)
  const totalExpenseOutflows = transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0)
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
    totals: { totalExpenseNet, totalExpenseOutflows, totalIncome, netAfterExpenses: totalIncome - totalExpenseNet },
    monthly: buildMonthlySummary(transactions, income),
    budget: budget.map((item) => ({
      category: item.category,
      isNeed: item.is_need,
      standard: item.amount_standard,
      withParents: item.amount_with_parents,
      withAid: item.amount_with_aid
    })),
    budgetLineItems: budgetLines,
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
      reimbursements: number
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
        reimbursements: 0,
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
    row.expenseNet += tx.amount
    if (tx.amount > 0) row.expenseOutflows += tx.amount
    if (tx.amount < 0) row.reimbursements += Math.abs(tx.amount)
    row.categories.set(tx.mapped_category, (row.categories.get(tx.mapped_category) ?? 0) + tx.amount)
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
      reimbursements: row.reimbursements,
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
] as Anthropic.Tool[]

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
