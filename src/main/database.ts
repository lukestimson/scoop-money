import { mkdirSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import type {
  Account,
  AccountType,
  BudgetItem,
  BudgetType,
  CategoryMappingRule,
  IncomeEntry,
  Transaction,
  TransactionFilters,
  TransactionSource
} from '../types/money'

let database: Database.Database | null = null
let databasePath = ''

const CREATE_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'checking',
  institution TEXT DEFAULT '',
  color TEXT DEFAULT '#a1a1aa',
  created_at INTEGER NOT NULL
)`

const CREATE_TRANSACTIONS = `
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  raw_category TEXT DEFAULT '',
  mapped_category TEXT DEFAULT '',
  account_id INTEGER,
  source TEXT DEFAULT 'manual',
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const CREATE_BUDGET_ITEMS = `
CREATE TABLE IF NOT EXISTS budget_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  is_need INTEGER NOT NULL DEFAULT 1,
  amount_standard INTEGER NOT NULL DEFAULT 0,
  amount_with_aid INTEGER NOT NULL DEFAULT 0,
  amount_with_parents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const CREATE_INCOME_ENTRIES = `
CREATE TABLE IF NOT EXISTS income_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoot_name TEXT NOT NULL DEFAULT '',
  company TEXT DEFAULT '',
  date INTEGER NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const CREATE_CATEGORY_MAPPING_RULES = `
CREATE TABLE IF NOT EXISTS category_mapping_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_category TEXT NOT NULL DEFAULT '',
  description_contains TEXT DEFAULT '',
  mapped_category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`

const DEFAULT_NEEDS = [
  ['Rent', 2800],
  ['Utilities', 150],
  ['Insurance', 200],
  ['Groceries', 400],
  ['Gas', 100],
  ['Phone', 80],
  ['Subscriptions', 50],
  ['Healthcare', 100]
] as const

const DEFAULT_NICE_TO_HAVES = [
  ['Dining Out', 300],
  ['Bars', 150],
  ['Shopping', 200],
  ['Entertainment', 100],
  ['Personal Care', 80],
  ['Business Expenses', 200]
] as const

const DEFAULT_ACCOUNTS: Array<Pick<Account, 'name' | 'type' | 'institution' | 'color'>> = [
  { name: 'Checking', type: 'checking', institution: '', color: '#0ea5e9' },
  { name: 'Savings', type: 'savings', institution: '', color: '#10b981' },
  { name: 'Credit Card', type: 'credit', institution: '', color: '#ef4444' },
  { name: 'Venmo', type: 'venmo', institution: '', color: '#8b5cf6' }
]

const now = (): number => Math.floor(Date.now() / 1000)
const cents = (dollars: number): number => Math.round(dollars * 100)

export function initDatabase(userDataPath: string): void {
  mkdirSync(userDataPath, { recursive: true })
  databasePath = join(userDataPath, 'money.db')
  database = new Database(databasePath)
  database.pragma('journal_mode = WAL')
  database.exec(CREATE_ACCOUNTS)
  database.exec(CREATE_TRANSACTIONS)
  database.exec(CREATE_BUDGET_ITEMS)
  database.exec(CREATE_INCOME_ENTRIES)
  database.exec(CREATE_CATEGORY_MAPPING_RULES)
  seedDefaults()
}

export function getDatabasePath(): string {
  return databasePath
}

export function backupDatabase(destination: string): Promise<void> {
  return getDb().backup(destination).then(() => undefined)
}

function getDb(): Database.Database {
  if (!database) throw new Error('Database has not been initialized')
  return database
}

function seedDefaults(): void {
  const db = getDb()
  const accountCount = db.prepare('SELECT COUNT(*) AS count FROM accounts').get() as { count: number }
  if (accountCount.count === 0) {
    const insert = db.prepare(
      'INSERT INTO accounts (name, type, institution, color, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const stamp = now()
    DEFAULT_ACCOUNTS.forEach((account) =>
      insert.run(account.name, account.type, account.institution, account.color, stamp)
    )
  }

  const budgetCount = db.prepare('SELECT COUNT(*) AS count FROM budget_items').get() as { count: number }
  if (budgetCount.count === 0) {
    const insert = db.prepare(
      `INSERT INTO budget_items
       (category, is_need, amount_standard, amount_with_aid, amount_with_parents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const stamp = now()
    DEFAULT_NEEDS.forEach(([category, amount]) =>
      insert.run(category, 1, cents(amount), cents(amount), cents(amount), stamp, stamp)
    )
    DEFAULT_NICE_TO_HAVES.forEach(([category, amount]) =>
      insert.run(category, 0, cents(amount), cents(amount), cents(amount), stamp, stamp)
    )
  }
}

function parseAccountType(value: unknown): AccountType {
  return value === 'savings' || value === 'credit' || value === 'venmo' ? value : 'checking'
}

function parseSource(value: unknown): TransactionSource {
  return value === 'csv_import' || value === 'ai' ? value : 'manual'
}

function rowToAccount(row: unknown): Account {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    name: String(r.name ?? ''),
    type: parseAccountType(r.type),
    institution: String(r.institution ?? ''),
    color: String(r.color ?? '#a1a1aa'),
    created_at: Number(r.created_at ?? 0)
  }
}

function rowToTransaction(row: unknown): Transaction {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    date: Number(r.date ?? 0),
    description: String(r.description ?? ''),
    amount: Number(r.amount ?? 0),
    raw_category: String(r.raw_category ?? ''),
    mapped_category: String(r.mapped_category ?? ''),
    account_id: r.account_id === null || r.account_id === undefined ? null : Number(r.account_id),
    source: parseSource(r.source),
    notes: String(r.notes ?? ''),
    created_at: Number(r.created_at ?? 0),
    updated_at: Number(r.updated_at ?? 0)
  }
}

function rowToBudgetItem(row: unknown): BudgetItem {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    category: String(r.category ?? ''),
    is_need: Number(r.is_need ?? 1) === 1,
    amount_standard: Number(r.amount_standard ?? 0),
    amount_with_aid: Number(r.amount_with_aid ?? 0),
    amount_with_parents: Number(r.amount_with_parents ?? 0),
    created_at: Number(r.created_at ?? 0),
    updated_at: Number(r.updated_at ?? 0)
  }
}

function rowToIncomeEntry(row: unknown): IncomeEntry {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    shoot_name: String(r.shoot_name ?? ''),
    company: String(r.company ?? ''),
    date: Number(r.date ?? 0),
    amount: Number(r.amount ?? 0),
    notes: String(r.notes ?? ''),
    created_at: Number(r.created_at ?? 0),
    updated_at: Number(r.updated_at ?? 0)
  }
}

function rowToCategoryRule(row: unknown): CategoryMappingRule {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    raw_category: String(r.raw_category ?? ''),
    description_contains: String(r.description_contains ?? ''),
    mapped_category: String(r.mapped_category ?? ''),
    priority: Number(r.priority ?? 0),
    created_at: Number(r.created_at ?? 0)
  }
}

export function getAllTransactions(filters: TransactionFilters = {}): Transaction[] {
  const clauses: string[] = []
  const params: Array<string | number> = []
  if (filters.accountId) {
    clauses.push('account_id = ?')
    params.push(filters.accountId)
  }
  if (filters.category) {
    clauses.push('mapped_category = ?')
    params.push(filters.category)
  }
  if (filters.source) {
    clauses.push('source = ?')
    params.push(filters.source)
  }
  if (filters.start) {
    clauses.push('date >= ?')
    params.push(filters.start)
  }
  if (filters.end) {
    clauses.push('date <= ?')
    params.push(filters.end)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return getDb()
    .prepare(`SELECT * FROM transactions ${where} ORDER BY date DESC, id DESC`)
    .all(...params)
    .map(rowToTransaction)
}

export function getTransactionsByPeriod(start: number, end: number): Transaction[] {
  return getAllTransactions({ start, end })
}

export function transactionExists(date: number, description: string, amount: number): boolean {
  const row = getDb()
    .prepare('SELECT id FROM transactions WHERE date = ? AND description = ? AND amount = ? LIMIT 1')
    .get(date, description, amount)
  return Boolean(row)
}

export function createTransaction(data: Partial<Transaction>): Transaction {
  const stamp = now()
  const date = data.date ?? stamp
  const description = data.description ?? ''
  const amount = Math.round(data.amount ?? 0)
  const raw = data.raw_category ?? ''
  const mapped = data.mapped_category || applyRulesToCategory(raw, description) || raw || 'Uncategorized'
  const result = getDb()
    .prepare(
      `INSERT INTO transactions
       (date, description, amount, raw_category, mapped_category, account_id, source, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(date, description, amount, raw, mapped, data.account_id ?? null, data.source ?? 'manual', data.notes ?? '', stamp, stamp)
  return getTransactionById(Number(result.lastInsertRowid))
}

export function updateTransaction(id: number, data: Partial<Transaction>): Transaction {
  const existing = getTransactionById(id)
  const description = data.description ?? existing.description
  const rawCategory = data.raw_category ?? existing.raw_category
  const mappedCategory =
    data.mapped_category ?? existing.mapped_category ?? applyRulesToCategory(rawCategory, description) ?? ''
  getDb()
    .prepare(
      `UPDATE transactions
       SET date = ?, description = ?, amount = ?, raw_category = ?, mapped_category = ?,
           account_id = ?, source = ?, notes = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      data.date ?? existing.date,
      description,
      Math.round(data.amount ?? existing.amount),
      rawCategory,
      mappedCategory,
      data.account_id === undefined ? existing.account_id : data.account_id,
      data.source ?? existing.source,
      data.notes ?? existing.notes,
      now(),
      id
    )
  return getTransactionById(id)
}

export function deleteTransaction(id: number): void {
  getDb().prepare('DELETE FROM transactions WHERE id = ?').run(id)
}

function getTransactionById(id: number): Transaction {
  const row = getDb().prepare('SELECT * FROM transactions WHERE id = ?').get(id)
  if (!row) throw new Error(`Transaction ${id} not found`)
  return rowToTransaction(row)
}

export function getAllBudgetItems(_budgetType?: BudgetType): BudgetItem[] {
  return getDb()
    .prepare('SELECT * FROM budget_items ORDER BY is_need DESC, category ASC')
    .all()
    .map(rowToBudgetItem)
}

export function createBudgetItem(data: Partial<BudgetItem>): BudgetItem {
  const stamp = now()
  const amount = Math.round(data.amount_standard ?? 0)
  const result = getDb()
    .prepare(
      `INSERT INTO budget_items
       (category, is_need, amount_standard, amount_with_aid, amount_with_parents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.category ?? 'New Category',
      data.is_need === false ? 0 : 1,
      amount,
      Math.round(data.amount_with_aid ?? amount),
      Math.round(data.amount_with_parents ?? amount),
      stamp,
      stamp
    )
  return getBudgetItemById(Number(result.lastInsertRowid))
}

export function updateBudgetItem(id: number, data: Partial<BudgetItem>): BudgetItem {
  const existing = getBudgetItemById(id)
  getDb()
    .prepare(
      `UPDATE budget_items
       SET category = ?, is_need = ?, amount_standard = ?, amount_with_aid = ?,
           amount_with_parents = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      data.category ?? existing.category,
      data.is_need === undefined ? (existing.is_need ? 1 : 0) : data.is_need ? 1 : 0,
      Math.round(data.amount_standard ?? existing.amount_standard),
      Math.round(data.amount_with_aid ?? existing.amount_with_aid),
      Math.round(data.amount_with_parents ?? existing.amount_with_parents),
      now(),
      id
    )
  return getBudgetItemById(id)
}

export function deleteBudgetItem(id: number): void {
  getDb().prepare('DELETE FROM budget_items WHERE id = ?').run(id)
}

function getBudgetItemById(id: number): BudgetItem {
  const row = getDb().prepare('SELECT * FROM budget_items WHERE id = ?').get(id)
  if (!row) throw new Error(`Budget item ${id} not found`)
  return rowToBudgetItem(row)
}

export function getAllAccounts(): Account[] {
  return getDb().prepare('SELECT * FROM accounts ORDER BY id ASC').all().map(rowToAccount)
}

export function createAccount(data: Partial<Account>): Account {
  const stamp = now()
  const result = getDb()
    .prepare('INSERT INTO accounts (name, type, institution, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(data.name ?? 'New Account', data.type ?? 'checking', data.institution ?? '', data.color ?? '#a1a1aa', stamp)
  return getAccountById(Number(result.lastInsertRowid))
}

export function updateAccount(id: number, data: Partial<Account>): Account {
  const existing = getAccountById(id)
  getDb()
    .prepare('UPDATE accounts SET name = ?, type = ?, institution = ?, color = ? WHERE id = ?')
    .run(
      data.name ?? existing.name,
      data.type ?? existing.type,
      data.institution ?? existing.institution,
      data.color ?? existing.color,
      id
    )
  return getAccountById(id)
}

export function deleteAccount(id: number): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
  getDb().prepare('UPDATE transactions SET account_id = NULL WHERE account_id = ?').run(id)
}

function getAccountById(id: number): Account {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!row) throw new Error(`Account ${id} not found`)
  return rowToAccount(row)
}

export function getAllIncomeEntries(): IncomeEntry[] {
  return getDb().prepare('SELECT * FROM income_entries ORDER BY date DESC, id DESC').all().map(rowToIncomeEntry)
}

export function createIncomeEntry(data: Partial<IncomeEntry>): IncomeEntry {
  const stamp = now()
  const result = getDb()
    .prepare(
      `INSERT INTO income_entries (shoot_name, company, date, amount, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(data.shoot_name ?? '', data.company ?? '', data.date ?? stamp, Math.round(data.amount ?? 0), data.notes ?? '', stamp, stamp)
  return getIncomeEntryById(Number(result.lastInsertRowid))
}

export function updateIncomeEntry(id: number, data: Partial<IncomeEntry>): IncomeEntry {
  const existing = getIncomeEntryById(id)
  getDb()
    .prepare('UPDATE income_entries SET shoot_name = ?, company = ?, date = ?, amount = ?, notes = ?, updated_at = ? WHERE id = ?')
    .run(
      data.shoot_name ?? existing.shoot_name,
      data.company ?? existing.company,
      data.date ?? existing.date,
      Math.round(data.amount ?? existing.amount),
      data.notes ?? existing.notes,
      now(),
      id
    )
  return getIncomeEntryById(id)
}

export function deleteIncomeEntry(id: number): void {
  getDb().prepare('DELETE FROM income_entries WHERE id = ?').run(id)
}

function getIncomeEntryById(id: number): IncomeEntry {
  const row = getDb().prepare('SELECT * FROM income_entries WHERE id = ?').get(id)
  if (!row) throw new Error(`Income entry ${id} not found`)
  return rowToIncomeEntry(row)
}

export function getAllCategoryRules(): CategoryMappingRule[] {
  return getDb()
    .prepare('SELECT * FROM category_mapping_rules ORDER BY priority DESC, id ASC')
    .all()
    .map(rowToCategoryRule)
}

export function createCategoryRule(data: Partial<CategoryMappingRule>): CategoryMappingRule {
  const result = getDb()
    .prepare(
      'INSERT INTO category_mapping_rules (raw_category, description_contains, mapped_category, priority, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(data.raw_category ?? '', data.description_contains ?? '', data.mapped_category ?? 'Uncategorized', data.priority ?? 0, now())
  return getCategoryRuleById(Number(result.lastInsertRowid))
}

export function updateCategoryRule(id: number, data: Partial<CategoryMappingRule>): CategoryMappingRule {
  const existing = getCategoryRuleById(id)
  getDb()
    .prepare(
      'UPDATE category_mapping_rules SET raw_category = ?, description_contains = ?, mapped_category = ?, priority = ? WHERE id = ?'
    )
    .run(
      data.raw_category ?? existing.raw_category,
      data.description_contains ?? existing.description_contains,
      data.mapped_category ?? existing.mapped_category,
      data.priority ?? existing.priority,
      id
    )
  return getCategoryRuleById(id)
}

export function deleteCategoryRule(id: number): void {
  getDb().prepare('DELETE FROM category_mapping_rules WHERE id = ?').run(id)
}

function getCategoryRuleById(id: number): CategoryMappingRule {
  const row = getDb().prepare('SELECT * FROM category_mapping_rules WHERE id = ?').get(id)
  if (!row) throw new Error(`Category rule ${id} not found`)
  return rowToCategoryRule(row)
}

export function applyRulesToCategory(rawCategory: string, description: string): string | null {
  const raw = rawCategory.trim().toLowerCase()
  const desc = description.trim().toLowerCase()
  const rules = getAllCategoryRules()
  const keyword = rules.find((rule) => {
    const needle = rule.description_contains.trim().toLowerCase()
    return needle.length > 0 && desc.includes(needle)
  })
  if (keyword) return keyword.mapped_category

  const exact = rules.find((rule) => rule.raw_category.trim().toLowerCase() === raw && raw.length > 0)
  if (exact) return exact.mapped_category

  const fuzzy = rules.find((rule) => {
    const candidate = rule.raw_category.trim().toLowerCase()
    return candidate.length > 0 && raw.length > 0 && (candidate.includes(raw) || raw.includes(candidate))
  })
  return fuzzy?.mapped_category ?? null
}

export function recategorizeAllTransactions(): { updated: number } {
  const txs = getAllTransactions()
  let updated = 0
  txs.forEach((tx) => {
    const mapped = applyRulesToCategory(tx.raw_category, tx.description)
    if (mapped && mapped !== tx.mapped_category) {
      updateTransaction(tx.id, { mapped_category: mapped })
      updated += 1
    }
  })
  return { updated }
}
