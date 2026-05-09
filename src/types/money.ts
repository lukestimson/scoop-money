export type AccountType = 'checking' | 'savings' | 'credit' | 'venmo'
export type TransactionSource = 'csv_import' | 'manual' | 'ai'
export type BudgetType = 'standard' | 'with_aid' | 'with_parents'
export type PageId = 'dashboard' | 'transactions' | 'budget' | 'summary' | 'income'

export interface Account {
  id: number
  name: string
  type: AccountType
  institution: string
  color: string
  created_at: number
}

export interface Transaction {
  id: number
  date: number
  description: string
  amount: number
  raw_category: string
  mapped_category: string
  account_id: number | null
  source: TransactionSource
  notes: string
  created_at: number
  updated_at: number
}

export interface BudgetItem {
  id: number
  category: string
  is_need: boolean
  amount_standard: number
  amount_with_aid: number
  amount_with_parents: number
  created_at: number
  updated_at: number
}

export interface IncomeEntry {
  id: number
  shoot_name: string
  company: string
  date: number
  amount: number
  notes: string
  created_at: number
  updated_at: number
}

export interface CategoryMappingRule {
  id: number
  raw_category: string
  description_contains: string
  mapped_category: string
  priority: number
  created_at: number
}

export interface TransactionFilters {
  accountId?: number | null
  category?: string
  source?: TransactionSource | ''
  start?: number
  end?: number
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
  transactions: Transaction[]
}

export interface BackupFile {
  name: string
  path: string
  createdAt: number
  size: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  pending?: boolean
  error?: boolean
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  text: string
  dataChanged: boolean
}

export interface ModelInfo {
  id: string
  display_name?: string
}

export interface SetModelIdResult {
  success: boolean
  reason?: 'models_not_loaded' | 'invalid_model_id'
}

export interface PeriodGroup {
  key: string
  label: string
  start: number
  end: number
  amount: number
}

export interface MoneyAPI {
  getTransactions(filters?: TransactionFilters): Promise<Transaction[]>
  createTransaction(data: Partial<Transaction>): Promise<Transaction>
  updateTransaction(id: number, data: Partial<Transaction>): Promise<Transaction>
  deleteTransaction(id: number): Promise<void>
  importTransactions(filePath: string, accountId: number): Promise<ImportResult>

  getBudgetItems(budgetType?: BudgetType): Promise<BudgetItem[]>
  createBudgetItem(data: Partial<BudgetItem>): Promise<BudgetItem>
  updateBudgetItem(id: number, data: Partial<BudgetItem>): Promise<BudgetItem>
  deleteBudgetItem(id: number): Promise<void>

  getAccounts(): Promise<Account[]>
  createAccount(data: Partial<Account>): Promise<Account>
  updateAccount(id: number, data: Partial<Account>): Promise<Account>
  deleteAccount(id: number): Promise<void>

  getIncomeEntries(): Promise<IncomeEntry[]>
  createIncomeEntry(data: Partial<IncomeEntry>): Promise<IncomeEntry>
  updateIncomeEntry(id: number, data: Partial<IncomeEntry>): Promise<IncomeEntry>
  deleteIncomeEntry(id: number): Promise<void>

  getCategoryRules(): Promise<CategoryMappingRule[]>
  createCategoryRule(data: Partial<CategoryMappingRule>): Promise<CategoryMappingRule>
  updateCategoryRule(id: number, data: Partial<CategoryMappingRule>): Promise<CategoryMappingRule>
  deleteCategoryRule(id: number): Promise<void>
  recategorizeAllTransactions(): Promise<{ updated: number }>

  chat(pageId: string, message: string, history: ChatMessage[]): Promise<ChatResult>
  getModel(): Promise<string>
  getAvailableModels(): Promise<ModelInfo[]>
  setModel(id: string): Promise<SetModelIdResult>

  backupNow(): Promise<{ path: string }>
  getBackupList(): Promise<BackupFile[]>
}
