import type {
  Account,
  AiProvider,
  AiPromptSettings,
  BackupFile,
  BudgetItem,
  BudgetLineItem,
  CategoryMappingRule,
  ExpectedIncomeEntry,
  ImportedFileRecord,
  IncomeEntry,
  IncomeTaxSettings,
  MoneyAPI,
  Transaction,
  TransactionFilters
} from '../../../types/money'
import { BUDGET_CATEGORY_ORDER, defaultIsNeedForBudgetCategory } from '../../../types/budgetCategories'
import { inferLineIsNeed } from '../../../types/budgetNeedRules'

const now = Math.floor(Date.now() / 1000)
const day = 86400

let nextId = 1000
const id = (): number => {
  nextId += 1
  return nextId
}

const accounts: Account[] = [
  { id: 1, name: 'Capital One', type: 'capital_one', institution: 'Capital One', color: '#ef4444', created_at: now },
  { id: 2, name: 'Venmo', type: 'venmo', institution: 'Venmo', color: '#3b82f6', created_at: now },
  { id: 3, name: 'EBT', type: 'ebt', institution: 'EBT', color: '#10b981', created_at: now },
  { id: 4, name: 'Chase', type: 'chase', institution: 'Chase', color: '#0ea5e9', created_at: now }
]

const MOCK_CATEGORY_STANDARD: Partial<Record<string, number>> = {
  Rent: 132700,
  Utilities: 13500,
  Groceries: 50000,
  Coffee: 8400,
  Transportation: 2500,
  Subscriptions: 15100,
  Dining: 32000,
  'Bar/ Alcohol': 10000,
  Travel: 14200,
  'Business Expenses': 8400,
  Shopping: 9700,
  Entertainment: 4750,
  'AI Fees': 1000,
  Internet: 0,
  Insurance: 2300,
  'Gas/Automotive': 0,
  'Other Services': 1800
}

const budgetItems: BudgetItem[] = BUDGET_CATEGORY_ORDER.map((category) => {
  const standard = MOCK_CATEGORY_STANDARD[category] ?? 0
  const isNeed = defaultIsNeedForBudgetCategory(category)
  const withAid =
    category === 'Groceries' ? 23400 : category === 'Subscriptions' ? 13200 : standard
  const withParents =
    category === 'Subscriptions' ? 13200 : category === 'Groceries' ? 50000 : standard
  return budget(category, isNeed, standard, withAid, withParents)
})

const budgetLineItems: BudgetLineItem[] = [
  line(38, 'Needs', 'Rent or Mortgage', 'Rent', 132700, 'lowest rent for SF 3 person app'),
  line(39, 'Needs', 'Utilities', 'Utilities', 8500, 'Wifi, gas, electric'),
  line(43, 'Needs', 'Food ($212/week)', 'Groceries', 50000, 'Workbook source line'),
  line(53, 'Needs', 'Spotify Subscription', 'Subscriptions', 1200, 'Preview line'),
  line(72, 'Wants', 'Going out (Food)', 'Dining', 32000, 'Meals out'),
  line(75, 'Wants', 'New gadgets/ Camera gear', 'Business Expenses', 8400, 'Gear reserve')
]

let transactions: Transaction[] = [
  tx(now - 2 * day, 'Bi-Rite Market', 6423, 'Groceries', 1),
  tx(now - 3 * day, 'Blue Bottle Coffee', 675, 'Coffee', 2),
  tx(now - 4 * day, 'Adobe Creative Cloud', 3999, 'Subscriptions', 2),
  tx(now - 5 * day, 'Dinner with friends', 4890, 'Dining', 2),
  tx(now - 5 * day, 'Venmo reimbursement - dinner', -2200, 'Dining', 3),
  tx(now - 9 * day, 'MUNI', 250, 'Transportation', 1),
  tx(now - 12 * day, 'Movie night', 1650, 'Entertainment', 2),
  tx(now - 33 * day, 'Whole Foods', 9211, 'Groceries', 2),
  tx(now - 37 * day, 'Rent payment', 132700, 'Rent', 1)
]

let incomeEntries: IncomeEntry[] = [
  income(now - 3 * day, 'Snappr portrait shoot', 'Jordan Lee', 18500, 'Snappr'),
  income(now - 10 * day, 'Corporate headshots', 'Acme Studio', 75000, 'Stimsonphoto'),
  income(now - 18 * day, 'Product retouching', 'Morgan Blake', 32000, 'Upwork')
]

let expectedIncomeEntries: ExpectedIncomeEntry[] = [
  { id: 1, name: 'Bartending', notes: 'Workbook estimate', annual_amount: 4200000, income_kind: 'w2', created_at: now, updated_at: now },
  { id: 2, name: 'Part-time Freelance Photography', notes: 'Snappr and corporate work', annual_amount: 2400000, income_kind: 'self_employment', created_at: now, updated_at: now },
  { id: 3, name: 'Photography Lessons', notes: 'Monthly lesson estimate', annual_amount: 90000, income_kind: 'self_employment', created_at: now, updated_at: now }
]

let rules: CategoryMappingRule[] = [
  { id: 1, raw_category: 'Dining', description_contains: 'restaurant', mapped_category: 'Dining', priority: 10, created_at: now },
  { id: 2, raw_category: 'Merchandise', description_contains: 'adobe', mapped_category: 'Subscriptions', priority: 20, created_at: now }
]

let importedFiles: ImportedFileRecord[] = [
  {
    id: 1,
    file_name: '2026-05-01_capitolOne.csv',
    file_path: '/preview/2026-05-01_capitolOne.csv',
    file_size: 24812,
    file_type: 'CSV',
    account_id: 2,
    imported_count: 18,
    skipped_count: 2,
    error_count: 0,
    first_transaction_date: now - 20 * day,
    last_transaction_date: now - 2 * day,
    preview: {
      headers: ['Transaction Date', 'Posted Date', 'Description', 'Category', 'Debit', 'Credit'],
      rows: [
        ['05/01/2026', '05/02/2026', 'Blue Bottle Coffee', 'Coffee', '6.75', ''],
        ['05/03/2026', '05/04/2026', 'Adobe Creative Cloud', 'Internet', '39.99', '']
      ],
      rowCount: 20,
      columnCount: 6
    },
    created_at: now - day
  }
]

let taxSettings: IncomeTaxSettings = {
  filing_status: 'single',
  retirement_contribution: 100000,
  above_line_deductions: 0,
  federal_standard_deduction: 1575000,
  ca_standard_deduction: 570600,
  ca_bracket_adjustment: 520200,
  social_security_wage_base: 17610000
}

let aiPromptSettings: AiPromptSettings = {
  general_system_prompt: 'Preview general finance prompt. {accuracy_instruction}\n\n<money_data>{money_data}</money_data>',
  income_actual_system_prompt: 'Preview income prompt. {accuracy_instruction}\n\n<money_data>{money_data}</money_data>',
  accuracy_instruction: 'Use integer cents for all math and be concise.'
}

let aiProvider: AiProvider = 'anthropic'
let aiModels = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-5.2'
}
const previewModels = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', provider: 'anthropic' as const },
    { id: 'claude-opus-4-1-20250805', display_name: 'Claude Opus 4.1', provider: 'anthropic' as const },
    { id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4', provider: 'anthropic' as const },
    { id: 'claude-3-7-sonnet-20250219', display_name: 'Claude Sonnet 3.7', provider: 'anthropic' as const },
    { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude Sonnet 3.5', provider: 'anthropic' as const },
    { id: 'claude-3-5-haiku-20241022', display_name: 'Claude Haiku 3.5', provider: 'anthropic' as const },
    { id: 'claude-3-haiku-20240307', display_name: 'Claude Haiku 3', provider: 'anthropic' as const }
  ],
  openai: [
    { id: 'gpt-5.2', display_name: 'GPT-5.2', provider: 'openai' as const },
    { id: 'gpt-5.2-pro', display_name: 'GPT-5.2 pro', provider: 'openai' as const },
    { id: 'gpt-5.1', display_name: 'GPT-5.1', provider: 'openai' as const },
    { id: 'gpt-5', display_name: 'GPT-5', provider: 'openai' as const },
    { id: 'gpt-5-mini', display_name: 'GPT-5 mini', provider: 'openai' as const },
    { id: 'gpt-5-nano', display_name: 'GPT-5 nano', provider: 'openai' as const },
    { id: 'gpt-4.1', display_name: 'GPT-4.1', provider: 'openai' as const }
  ]
}

let backupRetention = 7
let backups: BackupFile[] = [
  { name: 'backup-2026-05-10T12-00-00.db', path: '/preview/backups/backup-2026-05-10T12-00-00.db', createdAt: now - 3600, size: 524288 },
  { name: 'backup-2026-05-09T20-00-00.db', path: '/preview/backups/backup-2026-05-09T20-00-00.db', createdAt: now - 18 * 3600, size: 512000 }
]

function budget(category: string, isNeed: boolean, standard: number, withAid = standard, withParents = standard): BudgetItem {
  return { id: id(), category, is_need: isNeed, amount_standard: standard, amount_with_aid: withAid, amount_with_parents: withParents, created_at: now, updated_at: now }
}

function line(row: number, section: string, label: string, category: string, monthly: number, notes: string): BudgetLineItem {
  const isNeed = !/wants|nice/i.test(section)
  return {
    id: id(),
    source_sheet: 'Living Expenses',
    source_row: row,
    section,
    label,
    category,
    monthly_amount: monthly,
    annual_amount: monthly * 12,
    notes,
    support_scope: 'none',
    is_need: isNeed,
    created_at: now,
    updated_at: now
  }
}

function seedMissingPreviewBudgetLines(): void {
  let nextSourceRow = budgetLineItems.reduce((max, row) => Math.max(max, row.source_row), 0) + 1
  budgetItems.forEach((item) => {
    const existingTotal = budgetLineItems
      .filter((lineItem) => lineItem.category === item.category)
      .reduce((sum, lineItem) => sum + lineItem.monthly_amount, 0)
    const missingAmount = item.amount_standard - existingTotal
    if (missingAmount === 0) return
    budgetLineItems.push(
      line(
        nextSourceRow,
        item.is_need ? 'Needs' : 'Wants',
        existingTotal === 0 ? item.category : `${item.category} adjustment`,
        item.category,
        missingAmount,
        'Preview source line'
      )
    )
    nextSourceRow += 1
  })
}

seedMissingPreviewBudgetLines()

function tx(date: number, description: string, amount: number, category: string, accountId: number): Transaction {
  return { id: id(), date, description, amount, raw_category: category, mapped_category: category, account_id: accountId, source: 'csv_import', notes: '', income_candidate: false, created_at: now, updated_at: now }
}

function income(date: number, shoot: string, company: string, amount: number, incomeType: string): IncomeEntry {
  return { id: id(), date, shoot_name: shoot, company, income_type: incomeType, amount, notes: 'Preview income entry', created_at: now, updated_at: now }
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function applyTransactionFilters(rows: Transaction[], filters?: TransactionFilters): Transaction[] {
  return rows.filter((row) => {
    if (filters?.accountId !== undefined && filters.accountId !== null && row.account_id !== filters.accountId) return false
    if (filters?.category && row.mapped_category !== filters.category) return false
    if (filters?.source && row.source !== filters.source) return false
    if (filters?.start && row.date < filters.start) return false
    if (filters?.end && row.date > filters.end) return false
    return true
  })
}

function upsert<T extends { id: number; updated_at?: number }>(rows: T[], idValue: number, data: Partial<T>): T {
  const index = rows.findIndex((row) => row.id === idValue)
  if (index < 0) throw new Error(`Preview row ${idValue} not found`)
  rows[index] = { ...rows[index], ...data, updated_at: now }
  return copy(rows[index])
}

function syncPreviewBudgetTotals(category: string): void {
  if (!category.trim()) return
  const item = budgetItems.find((row) => row.category === category)
  if (!item) return
  const lines = budgetLineItems.filter((row) => row.category === category)
  item.amount_standard = lines.reduce((sum, line) => sum + line.monthly_amount, 0)
  item.amount_with_parents = lines.reduce((sum, line) => sum + (line.support_scope === 'parental' ? 0 : line.monthly_amount), 0)
  item.amount_with_aid = lines.reduce((sum, line) => sum + (line.support_scope === 'parental' || line.support_scope === 'government' ? 0 : line.monthly_amount), 0)
  item.updated_at = now
}

export function installBrowserMockApi(): void {
  if (typeof window === 'undefined' || window.api) return

  const api: MoneyAPI = {
    onTextScaleCommand: () => () => undefined,

    getTransactions: async (filters) => copy(applyTransactionFilters(transactions, filters)),
    createTransaction: async (data) => {
      const row = tx(data.date ?? now, data.description ?? 'Manual preview transaction', data.amount ?? 0, data.mapped_category ?? data.raw_category ?? 'Uncategorized', data.account_id ?? 1)
      row.source = data.source ?? 'manual'
      transactions = [row, ...transactions]
      return copy(row)
    },
    updateTransaction: async (rowId, data) => upsert(transactions, rowId, data),
    deleteTransaction: async (rowId) => {
      transactions = transactions.filter((row) => row.id !== rowId)
    },
    deleteTransactions: async (ids) => {
      const before = transactions.length
      transactions = transactions.filter((row) => !ids.includes(row.id))
      return { deleted: before - transactions.length }
    },
    deleteAllTransactions: async () => {
      const deleted = transactions.length
      transactions = []
      return { deleted }
    },
    importTransactions: async (filePath, accountId) => {
      const row = tx(now, `Preview import - ${filePath.split('/').pop() || filePath}`, 4200, 'Uncategorized', accountId)
      transactions = [row, ...transactions]
      importedFiles = [{
        id: id(),
        file_name: filePath.split('/').pop() || filePath,
        file_path: filePath,
        file_size: 8192,
        file_type: 'CSV',
        account_id: accountId,
        imported_count: 1,
        skipped_count: 0,
        error_count: 0,
        first_transaction_date: row.date,
        last_transaction_date: row.date,
        preview: { headers: ['Date', 'Description', 'Amount'], rows: [['Preview', row.description, '42.00']], rowCount: 1, columnCount: 3 },
        created_at: now
      }, ...importedFiles]
      return { imported: 1, skipped: 0, errors: [], transactions: [copy(row)] }
    },
    getImportedFiles: async () => copy(importedFiles),
    clearIncomeCandidateFlags: async (ids) => {
      for (const t of transactions) { if (ids.includes(t.id)) t.income_candidate = false }
    },
    clearImportedFile: async (fileId) => {
      const file = importedFiles.find((f) => f.id === fileId)
      if (!file) return { transactions: [] }
      const affected = transactions.filter(
        (t) => t.source === 'csv_import' && t.account_id === file.account_id &&
          file.first_transaction_date && file.last_transaction_date &&
          t.date >= file.first_transaction_date && t.date <= file.last_transaction_date
      )
      transactions = transactions.filter((t) => !affected.some((a) => a.id === t.id))
      importedFiles = importedFiles.filter((f) => f.id !== fileId)
      return { transactions: copy(affected) }
    },
    getPathForFile: (file) => file.name,

    getBudgetItems: async () => copy(budgetItems),
    getBudgetLineItems: async () => copy(budgetLineItems),
    createBudgetItem: async (data) => {
      const row = budget(data.category ?? 'New Category', data.is_need ?? true, data.amount_standard ?? 0, data.amount_with_aid ?? data.amount_standard ?? 0, data.amount_with_parents ?? data.amount_standard ?? 0)
      budgetItems.push(row)
      return copy(row)
    },
    updateBudgetItem: async (rowId, data) => upsert(budgetItems, rowId, data),
    deleteBudgetItem: async (rowId) => {
      const index = budgetItems.findIndex((row) => row.id === rowId)
      if (index >= 0) budgetItems.splice(index, 1)
    },
    createBudgetLineItem: async (data) => {
      const monthly = data.monthly_amount ?? 0
      const maxRow = budgetLineItems.reduce((max, row) => Math.max(max, row.source_row), 0)
      const category = data.category ?? ''
      const lineNeed =
        data.is_need === true ? true : data.is_need === false ? false : inferLineIsNeed(category, data.label ?? '')
      const section =
        data.section && data.section.trim() !== ''
          ? data.section
          : lineNeed
            ? 'Needs'
            : 'Wants'
      const row: BudgetLineItem = {
        id: id(),
        source_sheet: data.source_sheet ?? 'Living Expenses',
        source_row: data.source_row ?? maxRow + 1,
        section,
        label: data.label ?? '',
        category,
        monthly_amount: monthly,
        annual_amount: data.annual_amount ?? monthly * 12,
        notes: data.notes ?? '',
        support_scope: data.support_scope ?? 'none',
        is_need: lineNeed,
        created_at: now,
        updated_at: now
      }
      budgetLineItems.push(row)
      syncPreviewBudgetTotals(row.category)
      return copy(row)
    },
    updateBudgetLineItem: async (rowId, data) => {
      const existing = budgetLineItems.find((row) => row.id === rowId)
      const previousCategory = existing?.category ?? ''
      const updated = upsert(budgetLineItems, rowId, {
        ...data,
        annual_amount: data.monthly_amount === undefined ? data.annual_amount : data.monthly_amount * 12
      })
      syncPreviewBudgetTotals(previousCategory)
      syncPreviewBudgetTotals(updated.category)
      return updated
    },
    deleteBudgetLineItem: async (rowId) => {
      const existing = budgetLineItems.find((row) => row.id === rowId)
      const category = existing?.category ?? ''
      const index = budgetLineItems.findIndex((row) => row.id === rowId)
      if (index >= 0) budgetLineItems.splice(index, 1)
      syncPreviewBudgetTotals(category)
    },

    getAccounts: async () => copy(accounts),
    createAccount: async (data) => {
      const row: Account = { id: id(), name: data.name ?? 'Capital One', type: data.type ?? 'capital_one', institution: data.institution ?? '', color: data.color ?? '#71717a', created_at: now }
      accounts.push(row)
      return copy(row)
    },
    updateAccount: async (rowId, data) => upsert(accounts, rowId, data),
    deleteAccount: async (rowId) => {
      const index = accounts.findIndex((row) => row.id === rowId)
      if (index >= 0) accounts.splice(index, 1)
    },

    getIncomeEntries: async () => copy(incomeEntries),
    createIncomeEntry: async (data) => {
      const row = income(
        data.date ?? now,
        data.shoot_name ?? 'Preview shoot',
        data.company ?? 'Preview client',
        data.amount ?? 0,
        data.income_type ?? 'Stimsonphoto'
      )
      row.notes = data.notes ?? row.notes
      incomeEntries = [row, ...incomeEntries]
      return copy(row)
    },
    updateIncomeEntry: async (rowId, data) => upsert(incomeEntries, rowId, data),
    deleteIncomeEntry: async (rowId) => {
      incomeEntries = incomeEntries.filter((row) => row.id !== rowId)
    },
    getExpectedIncomeEntries: async () => copy(expectedIncomeEntries),
    createExpectedIncomeEntry: async (data) => {
      const row: ExpectedIncomeEntry = { id: id(), name: data.name ?? 'New Source', notes: data.notes ?? '', annual_amount: data.annual_amount ?? 0, income_kind: data.income_kind ?? 'other', created_at: now, updated_at: now }
      expectedIncomeEntries.push(row)
      return copy(row)
    },
    updateExpectedIncomeEntry: async (rowId, data) => upsert(expectedIncomeEntries, rowId, data),
    deleteExpectedIncomeEntry: async (rowId) => {
      expectedIncomeEntries = expectedIncomeEntries.filter((row) => row.id !== rowId)
    },
    getIncomeTaxSettings: async () => copy(taxSettings),
    updateIncomeTaxSettings: async (data) => {
      taxSettings = { ...taxSettings, ...data }
      return copy(taxSettings)
    },

    getCategoryRules: async () => copy(rules),
    createCategoryRule: async (data) => {
      const row: CategoryMappingRule = { id: id(), raw_category: data.raw_category ?? '', description_contains: data.description_contains ?? '', mapped_category: data.mapped_category ?? 'Uncategorized', priority: data.priority ?? 0, created_at: now }
      rules.push(row)
      return copy(row)
    },
    updateCategoryRule: async (rowId, data) => upsert(rules, rowId, data),
    deleteCategoryRule: async (rowId) => {
      rules = rules.filter((row) => row.id !== rowId)
    },
    recategorizeAllTransactions: async () => ({ updated: transactions.length }),

    chat: async (_pageId, message) => ({ text: `Preview ${aiProvider} response: "${message || 'Ask a finance question'}". Real AI runs in Electron.`, dataChanged: false }),
    getModel: async () => aiModels[aiProvider],
    getAvailableModels: async () => copy(previewModels[aiProvider]),
    setModel: async (modelId) => {
      if (!previewModels[aiProvider].some((model) => model.id === modelId)) return { success: false, reason: 'invalid_model_id' }
      aiModels = { ...aiModels, [aiProvider]: modelId }
      return { success: true }
    },
    getAiProvider: async () => ({
      provider: aiProvider,
      model: aiModels[aiProvider],
      models: copy(previewModels[aiProvider]),
      configured: false
    }),
    setAiProvider: async (provider) => {
      aiProvider = provider
      return {
        provider: aiProvider,
        model: aiModels[aiProvider],
        models: copy(previewModels[aiProvider]),
        configured: false
      }
    },
    startMacDictation: async () => undefined,
    getAiPromptSettings: async () => copy(aiPromptSettings),
    updateAiPromptSettings: async (data) => {
      aiPromptSettings = { ...aiPromptSettings, ...data }
      return copy(aiPromptSettings)
    },
    resetAiPromptSettings: async () => copy(aiPromptSettings),

    backupNow: async () => {
      const row = { name: `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`, path: '/preview/backups/latest.db', createdAt: now, size: 540672 }
      backups = [row, ...backups].slice(0, backupRetention)
      return { path: row.path }
    },
    getBackupList: async () => copy(backups),
    getBackupRetention: async () => backupRetention,
    setBackupRetention: async (maxFiles) => {
      backupRetention = Math.min(50, Math.max(1, Math.round(maxFiles) || 7))
      backups = backups.slice(0, backupRetention)
      return backupRetention
    },
    openBackupFolder: async () => {
      window.alert('Preview mode: backup folder opening is only available in Electron.')
      return ''
    }
  }

  window.api = api
}
