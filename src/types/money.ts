export type AccountType = 'capital_one' | 'venmo' | 'ebt' | 'chase'
export type TransactionSource = 'csv_import' | 'manual' | 'ai'
export type BudgetType = 'standard' | 'with_aid' | 'with_parents'
export type PageId =
  | 'dashboard'
  | 'expenses-budget'
  | 'expenses-actual'
  | 'expenses-summary'
  | 'income-expected'
  | 'income-actual'
  | 'income-summary'
  | 'settings'
  | 'transactions'
  | 'budget'
  | 'summary'
  | 'income'
export type BudgetSupportScope = 'none' | 'parental' | 'government'
export type IncomeKind = 'w2' | 'self_employment' | 'other'
export type FilingStatus = 'single'
export type AiProvider = 'anthropic' | 'openai'

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
  income_candidate: boolean
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

export interface BudgetLineItem {
  id: number
  source_sheet: string
  source_row: number
  section: string
  label: string
  category: string
  monthly_amount: number
  annual_amount: number
  notes: string
  support_scope: BudgetSupportScope
  /** Whether this line counts as a need vs a want (filters + reporting). */
  is_need: boolean
  created_at: number
  updated_at: number
}

export interface IncomeEntry {
  id: number
  shoot_name: string
  /** Main POC / client name from the shoot title or description. */
  company: string
  income_type: string
  date: number
  amount: number
  notes: string
  created_at: number
  updated_at: number
}

export interface ExpectedIncomeEntry {
  id: number
  name: string
  notes: string
  annual_amount: number
  income_kind: IncomeKind
  created_at: number
  updated_at: number
}

export interface IncomeTaxSettings {
  filing_status: FilingStatus
  retirement_contribution: number
  above_line_deductions: number
  federal_standard_deduction: number
  ca_standard_deduction: number
  ca_bracket_adjustment: number
  social_security_wage_base: number
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

export interface ImportedFilePreview {
  headers: string[]
  rows: string[][]
  rowCount: number
  columnCount: number
}

export interface ImportedFileRecord {
  id: number
  file_name: string
  file_path: string
  file_size: number
  file_type: string
  account_id: number | null
  imported_count: number
  skipped_count: number
  error_count: number
  first_transaction_date: number | null
  last_transaction_date: number | null
  preview: ImportedFilePreview
  created_at: number
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

export interface ChatAttachment {
  kind: 'image' | 'document'
  mediaType: string
  dataBase64: string
  name: string
}

export interface ChatResult {
  text: string
  dataChanged: boolean
}

export interface ModelInfo {
  id: string
  display_name?: string
  provider?: AiProvider
}

export interface SetModelIdResult {
  success: boolean
  reason?: 'models_not_loaded' | 'invalid_model_id'
}

export interface AiProviderState {
  provider: AiProvider
  model: string
  models: ModelInfo[]
  configured: boolean
}

export interface AiPromptSettings {
  general_system_prompt: string
  income_actual_system_prompt: string
  accuracy_instruction: string
}

export interface PeriodGroup {
  key: string
  label: string
  start: number
  end: number
  amount: number
}

export interface MoneyAPI {
  onTextScaleCommand(
    callback: (command: { kind: 'delta'; delta: number } | { kind: 'reset' }) => void
  ): () => void

  getTransactions(filters?: TransactionFilters): Promise<Transaction[]>
  createTransaction(data: Partial<Transaction>): Promise<Transaction>
  updateTransaction(id: number, data: Partial<Transaction>): Promise<Transaction>
  deleteTransaction(id: number): Promise<void>
  deleteTransactions(ids: number[]): Promise<{ deleted: number }>
  deleteAllTransactions(): Promise<{ deleted: number }>
  importTransactions(filePath: string, accountId: number): Promise<ImportResult>
  getImportedFiles(filters?: { start?: number; end?: number }): Promise<ImportedFileRecord[]>
  clearImportedFile(fileId: number): Promise<{ transactions: Transaction[] }>
  clearIncomeCandidateFlags(ids: number[]): Promise<void>
  getPathForFile(file: File): string

  getBudgetItems(budgetType?: BudgetType): Promise<BudgetItem[]>
  getBudgetLineItems(): Promise<BudgetLineItem[]>
  createBudgetItem(data: Partial<BudgetItem>): Promise<BudgetItem>
  updateBudgetItem(id: number, data: Partial<BudgetItem>): Promise<BudgetItem>
  deleteBudgetItem(id: number): Promise<void>
  createBudgetLineItem(data: Partial<BudgetLineItem>): Promise<BudgetLineItem>
  updateBudgetLineItem(id: number, data: Partial<BudgetLineItem>): Promise<BudgetLineItem>
  deleteBudgetLineItem(id: number): Promise<void>

  getAccounts(): Promise<Account[]>
  createAccount(data: Partial<Account>): Promise<Account>
  updateAccount(id: number, data: Partial<Account>): Promise<Account>
  deleteAccount(id: number): Promise<void>

  getIncomeEntries(): Promise<IncomeEntry[]>
  createIncomeEntry(data: Partial<IncomeEntry>): Promise<IncomeEntry>
  updateIncomeEntry(id: number, data: Partial<IncomeEntry>): Promise<IncomeEntry>
  deleteIncomeEntry(id: number): Promise<void>
  getExpectedIncomeEntries(): Promise<ExpectedIncomeEntry[]>
  createExpectedIncomeEntry(data: Partial<ExpectedIncomeEntry>): Promise<ExpectedIncomeEntry>
  updateExpectedIncomeEntry(id: number, data: Partial<ExpectedIncomeEntry>): Promise<ExpectedIncomeEntry>
  deleteExpectedIncomeEntry(id: number): Promise<void>
  getIncomeTaxSettings(): Promise<IncomeTaxSettings>
  updateIncomeTaxSettings(data: Partial<IncomeTaxSettings>): Promise<IncomeTaxSettings>

  getCategoryRules(): Promise<CategoryMappingRule[]>
  createCategoryRule(data: Partial<CategoryMappingRule>): Promise<CategoryMappingRule>
  updateCategoryRule(id: number, data: Partial<CategoryMappingRule>): Promise<CategoryMappingRule>
  deleteCategoryRule(id: number): Promise<void>
  recategorizeAllTransactions(): Promise<{ updated: number }>

  chat(
    pageId: string,
    message: string,
    history: ChatMessage[],
    attachments?: ChatAttachment[]
  ): Promise<ChatResult>
  getModel(): Promise<string>
  getAvailableModels(): Promise<ModelInfo[]>
  setModel(id: string): Promise<SetModelIdResult>
  getAiProvider(): Promise<AiProviderState>
  setAiProvider(provider: AiProvider): Promise<AiProviderState>
  startMacDictation(): Promise<void>
  getAiPromptSettings(): Promise<AiPromptSettings>
  updateAiPromptSettings(data: Partial<AiPromptSettings>): Promise<AiPromptSettings>
  resetAiPromptSettings(): Promise<AiPromptSettings>

  backupNow(): Promise<{ path: string }>
  getBackupList(): Promise<BackupFile[]>
  getBackupRetention(): Promise<number>
  setBackupRetention(maxFiles: number): Promise<number>
  openBackupFolder(): Promise<string>
}
