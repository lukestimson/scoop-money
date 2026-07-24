import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import Database from 'better-sqlite3'
import type {
  Account,
  AccountType,
  BudgetItem,
  BudgetLineItem,
  BudgetSupportScope,
  BudgetType,
  CategoryMappingRule,
  ExpectedIncomeEntry,
  FilingStatus,
  ImportRuleProvider,
  ImportTransactionRule,
  ImportedFilePreview,
  ImportedFileRecord,
  IncomeEntry,
  IncomeKind,
  IncomeTaxSettings,
  LivingExpensesSettings,
  Transaction,
  TransactionFilters,
  TransactionSource
} from '../types/money'
import { BUDGET_CATEGORY_ORDER, defaultIsNeedForBudgetCategory } from '../types/budgetCategories'
import { inferLineIsNeed } from '../types/budgetNeedRules'

let database: Database.Database | null = null
let databasePath = ''

function cents(dollars: number): number {
  return Math.round(dollars * 100)
}

const CREATE_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'chase',
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

const CREATE_TRANSACTION_DEDUPE_INDEX = `
CREATE INDEX IF NOT EXISTS transactions_import_dedupe_idx
ON transactions (date, amount, description)`

// Partial unique index: a provider transaction id is unique within an account.
// Rows without an external_id (all CSV/manual/ai rows) are exempt (WHERE clause).
const CREATE_TRANSACTION_EXTERNAL_ID_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS transactions_external_id_idx
ON transactions (account_id, external_id)
WHERE external_id IS NOT NULL`

// Plaid groundwork tables. No FK REFERENCES clauses (matches this codebase's convention);
// relationships are documented in src/types/money.ts.
const CREATE_PLAID_ITEMS = `
CREATE TABLE IF NOT EXISTS plaid_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL UNIQUE,
  institution_id TEXT,
  institution_name TEXT,
  access_token_ref TEXT NOT NULL DEFAULT '',
  cursor TEXT,
  status TEXT NOT NULL DEFAULT '',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const CREATE_PLAID_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS plaid_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plaid_account_id TEXT NOT NULL UNIQUE,
  item_id TEXT NOT NULL DEFAULT '',
  account_id INTEGER NOT NULL,
  mask TEXT,
  name TEXT,
  subtype TEXT,
  created_at INTEGER NOT NULL
)`

const CREATE_PLAID_TRANSACTION_LINKS = `
CREATE TABLE IF NOT EXISTS plaid_transaction_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plaid_transaction_id TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL,
  pending INTEGER NOT NULL DEFAULT 0,
  pending_transaction_id TEXT,
  last_provider_update INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const CREATE_IMPORTED_FILES = `
CREATE TABLE IF NOT EXISTS imported_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  file_type TEXT NOT NULL DEFAULT '',
  account_id INTEGER,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  first_transaction_date INTEGER,
  last_transaction_date INTEGER,
  preview_json TEXT NOT NULL DEFAULT '{"headers":[],"rows":[],"rowCount":0,"columnCount":0}',
  created_at INTEGER NOT NULL
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

const CREATE_BUDGET_LINE_ITEMS = `
CREATE TABLE IF NOT EXISTS budget_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_sheet TEXT NOT NULL DEFAULT 'Living Expenses',
  source_row INTEGER NOT NULL DEFAULT 0,
  section TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  monthly_amount INTEGER NOT NULL DEFAULT 0,
  annual_amount INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  support_scope TEXT NOT NULL DEFAULT 'none',
  is_need INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source_sheet, source_row)
)`

const CREATE_INCOME_ENTRIES = `
CREATE TABLE IF NOT EXISTS income_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoot_name TEXT NOT NULL DEFAULT '',
  company TEXT DEFAULT '',
  income_type TEXT NOT NULL DEFAULT '',
  date INTEGER NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  tip INTEGER,
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const CREATE_EXPECTED_INCOME_ENTRIES = `
CREATE TABLE IF NOT EXISTS expected_income_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  notes TEXT DEFAULT '',
  annual_amount INTEGER NOT NULL DEFAULT 0,
  income_kind TEXT NOT NULL DEFAULT 'other',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

const CREATE_INCOME_TAX_SETTINGS = `
CREATE TABLE IF NOT EXISTS income_tax_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`

const CREATE_LIVING_EXPENSES_SETTINGS = `
CREATE TABLE IF NOT EXISTS living_expenses_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`

const CREATE_APP_META = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`

const DEFAULT_LIVING_EXPENSES_SETTINGS: LivingExpensesSettings = {
  // Stored as x100 multiplier so ratio stays integer-only in persistence.
  rent_ratio_target_x100: 300,
  reserve_target_months: 6
}

const CREATE_CATEGORY_MAPPING_RULES = `
CREATE TABLE IF NOT EXISTS category_mapping_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_category TEXT NOT NULL DEFAULT '',
  description_contains TEXT DEFAULT '',
  mapped_category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`

const CREATE_IMPORT_TRANSACTION_RULES = `
CREATE TABLE IF NOT EXISTS import_transaction_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'capital_one',
  match_text TEXT NOT NULL DEFAULT '',
  mapped_category TEXT NOT NULL DEFAULT 'Uncategorized',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`

const DEFAULT_CAPITAL_ONE_IMPORT_RULES: ReadonlyArray<
  Pick<ImportTransactionRule, 'provider' | 'match_text' | 'mapped_category' | 'priority'>
> = [
  {
    provider: 'capital_one',
    match_text: 'ADOBE',
    mapped_category: 'Subscriptions',
    priority: 220
  },
  {
    provider: 'capital_one',
    match_text: 'OPENAI',
    mapped_category: 'AI Fees',
    priority: 230
  },
  {
    provider: 'capital_one',
    match_text: 'CHATGPT',
    mapped_category: 'AI Fees',
    priority: 225
  },
  {
    provider: 'capital_one',
    match_text: 'ANTHROPIC',
    mapped_category: 'AI Fees',
    priority: 220
  },
  {
    provider: 'capital_one',
    match_text: 'REPLICATE',
    mapped_category: 'AI Fees',
    priority: 220
  },
  {
    provider: 'capital_one',
    match_text: 'CLOUDFLARE',
    mapped_category: 'Business Expenses',
    priority: 210
  },
  {
    provider: 'capital_one',
    match_text: 'LNDRY',
    mapped_category: 'Other Services',
    priority: 205
  },
  {
    provider: 'capital_one',
    match_text: 'LAUNDRY',
    mapped_category: 'Other Services',
    priority: 205
  },
  {
    provider: 'capital_one',
    match_text: '220 MONTGOMERY',
    mapped_category: 'Coffee',
    priority: 215
  },
  {
    provider: 'capital_one',
    match_text: 'CAFE',
    mapped_category: 'Coffee',
    priority: 160
  },
  {
    provider: 'capital_one',
    match_text: 'ZOHO-WORKPLACE',
    mapped_category: 'Subscriptions',
    priority: 215
  },
  {
    provider: 'capital_one',
    match_text: 'ZOHO',
    mapped_category: 'Subscriptions',
    priority: 180
  },
  {
    provider: 'capital_one',
    match_text: 'LEBEAU NOB HILL MARKET',
    mapped_category: 'Groceries',
    priority: 210
  },
  {
    provider: 'capital_one',
    match_text: 'APPLE.COM/BILL',
    mapped_category: 'Subscriptions',
    priority: 210
  },
  {
    provider: 'capital_one',
    match_text: 'GOOGLE ONE',
    mapped_category: 'Subscriptions',
    priority: 210
  },
  {
    provider: 'capital_one',
    match_text: '7-ELEVEN',
    mapped_category: 'Shopping',
    priority: 175
  },
  {
    provider: 'capital_one',
    match_text: 'SHELL',
    mapped_category: 'Shopping',
    priority: 150
  },
  {
    provider: 'capital_one',
    match_text: 'CHEVRON',
    mapped_category: 'Shopping',
    priority: 150
  },
  {
    provider: 'capital_one',
    match_text: 'EXXON',
    mapped_category: 'Shopping',
    priority: 150
  },
  {
    provider: 'capital_one',
    match_text: 'MOBIL',
    mapped_category: 'Shopping',
    priority: 150
  },
  {
    provider: 'capital_one',
    match_text: 'TEXACO',
    mapped_category: 'Shopping',
    priority: 150
  },
  {
    provider: 'capital_one',
    match_text: 'ARCO',
    mapped_category: 'Shopping',
    priority: 150
  },
  {
    provider: 'capital_one',
    match_text: 'CIRCLE K',
    mapped_category: 'Shopping',
    priority: 150
  },
  {
    provider: 'capital_one',
    match_text: 'VALERO',
    mapped_category: 'Shopping',
    priority: 150
  }
] as const

const WORKBOOK_BUDGET_DEFAULTS = [
  {
    category: 'Rent',
    isNeed: true,
    standard: 1327,
    withParents: 1327,
    withAid: 1327
  },
  {
    category: 'Utilities',
    isNeed: true,
    standard: 135,
    withParents: 135,
    withAid: 135
  },
  {
    category: 'Groceries',
    isNeed: true,
    standard: 500,
    withParents: 500,
    withAid: 234
  },
  {
    category: 'Coffee',
    isNeed: true,
    standard: 84,
    withParents: 84,
    withAid: 84
  },
  {
    category: 'Internet',
    isNeed: true,
    standard: 0,
    withParents: 0,
    withAid: 0
  },
  {
    category: 'Gas/Automotive',
    isNeed: true,
    standard: 0,
    withParents: 0,
    withAid: 0
  },
  {
    category: 'Transportation',
    isNeed: true,
    standard: 25,
    withParents: 25,
    withAid: 25
  },
  {
    category: 'Subscriptions',
    isNeed: true,
    standard: 151,
    withParents: 132,
    withAid: 132
  },
  {
    category: 'Insurance',
    isNeed: true,
    standard: 23,
    withParents: 23,
    withAid: 23
  },
  {
    category: 'Other Services',
    isNeed: true,
    standard: 18,
    withParents: 18,
    withAid: 18
  },
  {
    category: 'Dining',
    isNeed: false,
    standard: 320,
    withParents: 320,
    withAid: 320
  },
  {
    category: 'Bar/ Alcohol',
    isNeed: false,
    standard: 100,
    withParents: 100,
    withAid: 100
  },
  {
    category: 'Travel',
    isNeed: false,
    standard: 142,
    withParents: 142,
    withAid: 142
  },
  {
    category: 'Business Expenses',
    isNeed: false,
    standard: 84,
    withParents: 84,
    withAid: 84
  },
  {
    category: 'Shopping',
    isNeed: false,
    standard: 97,
    withParents: 97,
    withAid: 97
  },
  {
    category: 'Entertainment',
    isNeed: false,
    standard: 47.5,
    withParents: 47.5,
    withAid: 47.5
  },
  {
    category: 'AI Fees',
    isNeed: false,
    standard: 10,
    withParents: 10,
    withAid: 10
  }
] as const

const DEFAULT_NEEDS = WORKBOOK_BUDGET_DEFAULTS.filter((item) => item.isNeed)
const DEFAULT_NICE_TO_HAVES = WORKBOOK_BUDGET_DEFAULTS.filter((item) => !item.isNeed)

const WORKBOOK_BUDGET_LINES: ReadonlyArray<
  Pick<
    BudgetLineItem,
    'source_sheet' | 'source_row' | 'section' | 'label' | 'category' | 'notes' | 'support_scope'
  > & {
    monthly: number
  }
> = [
  {
    source_sheet: 'Living Expenses',
    source_row: 38,
    section: 'Needs',
    label: 'Rent or Mortgage',
    category: 'Rent',
    monthly: 1327,
    notes: 'lowest rent for SF 3 person app ~ $1.4k',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 39,
    section: 'Needs',
    label: 'Utilities',
    category: 'Utilities',
    monthly: 85,
    notes: 'Wifi: $25, Gas & Electric: 30-60 (Dont pay water + garbage)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 40,
    section: 'Needs',
    label: 'Monthly cleaning',
    category: 'Utilities',
    monthly: 50,
    notes: '$200 cleaning monthly',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 41,
    section: 'Needs',
    label: 'Renters Insurance',
    category: 'Rent',
    monthly: 0,
    notes:
      "(Based on GPT estimate of $20-30/mo) ($300/yr) - Dont think we're paying this at Russian hill",
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 43,
    section: 'Needs',
    label: 'Food ($212/week)',
    category: 'Groceries',
    monthly: 500,
    notes: "based off of dad's weekly + $150 - Adjusted to be more accurate 4/14/26",
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 44,
    section: 'Needs',
    label: 'Coffee/ Yerbs',
    category: 'Coffee',
    monthly: 84,
    notes: '(coffee every other day at $6)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 45,
    section: 'Needs',
    label: 'Phone Bill',
    category: 'Utilities',
    monthly: 55,
    notes: '($70 if I go individual, $55 if I stay on family plan)',
    support_scope: 'parental'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 46,
    section: 'Needs',
    label: 'Healthcare',
    category: 'Insurance',
    monthly: 350,
    notes: 'Covered California Estimate on Bronze Plan',
    support_scope: 'government'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 47,
    section: 'Needs',
    label: 'Haircuts',
    category: 'Other Services',
    monthly: 18,
    notes: '(Haircuts every 3months at $55)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 48,
    section: 'Needs',
    label: 'Cleaning Supplies, Cooking Supplies, household stuff',
    category: 'Shopping',
    monthly: 9,
    notes: '(Estimated $100/yr)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 49,
    section: 'Needs',
    label: 'Toiletries, Deodorant, tooth paste, razors, shaving creme, moisterizer',
    category: 'Shopping',
    monthly: 6,
    notes: '(Estimated $70/yr)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 50,
    section: 'Needs',
    label: 'Transportation',
    category: 'Transportation',
    monthly: 25,
    notes: '(Estimated $25/mo)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 53,
    section: 'Subscriptions',
    label: 'Spotify Subscription',
    category: 'Subscriptions',
    monthly: 12,
    notes: '($144/yr)',
    support_scope: 'parental'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 54,
    section: 'Subscriptions',
    label: 'Netflix subscription',
    category: 'Subscriptions',
    monthly: 7,
    notes: '($84/yr)',
    support_scope: 'parental'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 56,
    section: 'Subscriptions',
    label: "Credit Card's (Venture X) (Annual: 350)",
    category: 'Subscriptions',
    monthly: 30,
    notes: '($350/yr)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 57,
    section: 'Subscriptions',
    label: 'Amazon prime',
    category: 'Subscriptions',
    monthly: 0,
    notes: '($144/yr) (Canceled Summer of 2025)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 58,
    section: 'Subscriptions',
    label: 'Phootography Website',
    category: 'Subscriptions',
    monthly: 29,
    notes: '($348/yr) (Downgraded plan 2/3/25 from $442/yr)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 59,
    section: 'Subscriptions',
    label: 'Photography Insurance (Full Frame)',
    category: 'Insurance',
    monthly: 23,
    notes: '$271/yr) (*** Charged $366 in 2025)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 60,
    section: 'Subscriptions',
    label: 'Stimsonphoto.com domain ($31/yr)',
    category: 'Subscriptions',
    monthly: 2.6,
    notes: '($26/yr) (was 52 now 62.50 for 2 years as of may 2026)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 61,
    section: 'Subscriptions',
    label: 'Adobe Subscription',
    category: 'Subscriptions',
    monthly: 40,
    notes: 'Now $480/yr (before August 2025 it was $240/yr)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 62,
    section: 'Subscriptions',
    label: 'Storage (G photos: $10 + G photos: $2 + icloud: $3)',
    category: 'Subscriptions',
    monthly: 15,
    notes: '($180/yr)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 63,
    section: 'Subscriptions',
    label: 'Apple Care+ 14in Macbook pro',
    category: 'Subscriptions',
    monthly: 8.4,
    notes: '($100 per year)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 64,
    section: 'Subscriptions',
    label: 'DJI Care Refresh - MA2PRO',
    category: 'Subscriptions',
    monthly: 7,
    notes: '($170 per 2 years)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 65,
    section: 'Subscriptions',
    label: 'Canceled: Headspace (Was $6), Audible (Was $16)',
    category: 'Subscriptions',
    monthly: 0,
    notes: '',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 72,
    section: 'Wants',
    label: 'Going out (Food)',
    category: 'Dining',
    monthly: 320,
    notes: '(Go out to eat 5x per week at $16/meal',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 73,
    section: 'Wants',
    label: 'Going out (Drinks)',
    category: 'Bar/ Alcohol',
    monthly: 100,
    notes: '($35 every week) - reduced to $100 4/14/26',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 74,
    section: 'Wants',
    label: 'Travel',
    category: 'Travel',
    monthly: 142,
    notes: 'Spend 2k on travel annually? (- $300 travel credit)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 75,
    section: 'Wants',
    label: 'New gadgets/ Camera gear',
    category: 'Business Expenses',
    monthly: 84,
    notes: '$1k a year on new gear?',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 76,
    section: 'Wants',
    label: 'Film Photography (Film+ Developing+new gear)',
    category: 'Shopping',
    monthly: 42,
    notes:
      '220 Film Photos personal use (Jan-May 2024) -> $1 per image = 660 film images per year -> $660 per year ($350/year on new gear) (reduced by 50%)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 77,
    section: 'Wants',
    label: 'Zyns',
    category: 'Shopping',
    monthly: 17,
    notes: '2 packs per month',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 78,
    section: 'Wants',
    label: 'New Clothing',
    category: 'Shopping',
    monthly: 23,
    notes: '(Estimated $275/yr)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 79,
    section: 'Wants',
    label: 'Weekly Movies (Tuesday Deals)',
    category: 'Entertainment',
    monthly: 30,
    notes: '($7.5/week)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 80,
    section: 'Wants',
    label: 'Concerts',
    category: 'Entertainment',
    monthly: 17.5,
    notes: '(6 concerts a year at $35 average ticket price)',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 81,
    section: 'Wants',
    label: 'AI Fees',
    category: 'AI Fees',
    monthly: 10,
    notes: '',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 82,
    section: 'Wants',
    label: 'Miscillaneous purchases',
    category: 'Other Services',
    monthly: 30,
    notes: '',
    support_scope: 'none'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 87,
    section: 'Parental & Gov Help',
    label: 'Spotify',
    category: 'Subscriptions',
    monthly: 12,
    notes: '($144/yr)',
    support_scope: 'parental'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 88,
    section: 'Parental & Gov Help',
    label: 'Netflix',
    category: 'Subscriptions',
    monthly: 7,
    notes: '($84/yr)',
    support_scope: 'parental'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 89,
    section: 'Parental & Gov Help',
    label: 'Phone Bill',
    category: 'Utilities',
    monthly: 55,
    notes: '($70 if I go individual, $55 if I stay on family plan)',
    support_scope: 'parental'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 92,
    section: 'Parental & Gov Help',
    label: 'EBT Snap Food Plan (as of Jan 2026)',
    category: 'Groceries',
    monthly: 266,
    notes: '(Will go down in 2026 when I declare my new income)',
    support_scope: 'government'
  },
  {
    source_sheet: 'Living Expenses',
    source_row: 93,
    section: 'Parental & Gov Help',
    label: 'Medical (free as of Jan 2026)',
    category: 'Insurance',
    monthly: 350,
    notes: '',
    support_scope: 'government'
  }
] as const

const WORKBOOK_CATEGORY_RENAMES = [
  ['Dining Out', 'Dining'],
  ['Bars', 'Bar/ Alcohol'],
  ['Gas', 'Transportation'],
  ['Personal Care', 'Other Services'],
  ['Phone', 'Phone Bill']
] as const

const DEFAULT_EXPECTED_INCOME: ReadonlyArray<
  Pick<ExpectedIncomeEntry, 'name' | 'notes' | 'annual_amount' | 'income_kind'>
> = [
  {
    name: 'Bartending',
    notes: 'Workbook estimate: $35/hr, 25hr weeks, 48wk years.',
    annual_amount: cents(42000),
    income_kind: 'w2'
  },
  {
    name: 'Part-time Freelance Photography',
    notes: 'Snappr and corporate event shoots estimated at $2k per month.',
    annual_amount: cents(24000),
    income_kind: 'self_employment'
  },
  {
    name: 'Photography Lessons',
    notes: 'Assuming 1 lesson per month at $75 each.',
    annual_amount: cents(900),
    income_kind: 'self_employment'
  },
  {
    name: 'Baja Montecito',
    notes: 'Workbook placeholder.',
    annual_amount: 0,
    income_kind: 'other'
  }
]

const DEFAULT_TAX_SETTINGS: IncomeTaxSettings = {
  filing_status: 'single',
  retirement_contribution: cents(1000),
  above_line_deductions: 0,
  federal_standard_deduction: cents(15750),
  ca_standard_deduction: cents(5706),
  ca_bracket_adjustment: cents(5202),
  social_security_wage_base: cents(176100)
}

const DEFAULT_ACCOUNTS: Array<Pick<Account, 'name' | 'type' | 'institution' | 'color'>> = [
  {
    name: 'Capital One',
    type: 'capital_one',
    institution: 'Capital One',
    color: '#ef4444'
  },
  { name: 'Venmo', type: 'venmo', institution: 'Venmo', color: '#3b82f6' },
  { name: 'EBT', type: 'ebt', institution: 'EBT', color: '#10b981' },
  { name: 'Chase', type: 'chase', institution: 'Chase', color: '#0ea5e9' }
]

const now = (): number => Math.floor(Date.now() / 1000)

export function initDatabase(userDataPath: string): void {
  mkdirSync(userDataPath, { recursive: true })
  databasePath = join(userDataPath, 'money.db')
  database = new Database(databasePath)
  database.pragma('journal_mode = WAL')
  database.exec(CREATE_ACCOUNTS)
  database.exec(CREATE_TRANSACTIONS)
  database.exec(CREATE_TRANSACTION_DEDUPE_INDEX)
  database.exec(CREATE_IMPORTED_FILES)
  database.exec(CREATE_BUDGET_ITEMS)
  database.exec(CREATE_BUDGET_LINE_ITEMS)
  database.exec(CREATE_INCOME_ENTRIES)
  database.exec(CREATE_EXPECTED_INCOME_ENTRIES)
  database.exec(CREATE_INCOME_TAX_SETTINGS)
  database.exec(CREATE_LIVING_EXPENSES_SETTINGS)
  database.exec(CREATE_APP_META)
  database.exec(CREATE_CATEGORY_MAPPING_RULES)
  database.exec(CREATE_IMPORT_TRANSACTION_RULES)
  database.exec(CREATE_PLAID_ITEMS)
  database.exec(CREATE_PLAID_ACCOUNTS)
  database.exec(CREATE_PLAID_TRANSACTION_LINKS)
  ensureBudgetLineItemsHasIsNeedColumn()
  ensureTransactionsHasIncomeCandidateColumn()
  ensureIncomeEntriesHasIncomeTypeColumn()
  ensureIncomeEntriesHasTipColumn()
  ensureTransactionsHasExternalIdColumn()
  ensureAccountsHasPlaidCutoverColumn()
  database.exec(CREATE_TRANSACTION_EXTERNAL_ID_INDEX)
  seedDefaults()
  ensureCoreAccounts()
  runDateOnlyUtcMigration()
  runMoneyBudgetAllowlistMigration()
  runBudgetLineNeedWorkbookMigration()
  runBudgetSectionNeedsWantsLabelsMigration()
}

export function getDatabasePath(): string {
  return databasePath
}

export function backupDatabase(destination: string): Promise<void> {
  return getDb()
    .backup(destination)
    .then(() => undefined)
}

/** Restore a SQLite backup made by backupDatabase, reopening the shared connection afterwards. */
export function restoreDatabase(source: string): void {
  if (!databasePath) throw new Error('Database has not been initialized')
  if (!existsSync(source)) throw new Error(`Backup file does not exist: ${source}`)
  database?.close()
  database = null
  // A WAL from the replaced database must not be replayed into the restored file.
  for (const suffix of ['-wal', '-shm']) {
    try {
      unlinkSync(`${databasePath}${suffix}`)
    } catch {
      // The sidecar is absent for rollback-journal databases and clean shutdowns.
    }
  }
  copyFileSync(source, databasePath)
  initDatabase(dirname(databasePath))
}

function getDb(): Database.Database {
  if (!database) throw new Error('Database has not been initialized')
  return database
}

function seedDefaults(): void {
  const db = getDb()
  const accountCount = db.prepare('SELECT COUNT(*) AS count FROM accounts').get() as {
    count: number
  }
  if (accountCount.count === 0) {
    const insert = db.prepare(
      'INSERT INTO accounts (name, type, institution, color, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const stamp = now()
    DEFAULT_ACCOUNTS.forEach((account) =>
      insert.run(account.name, account.type, account.institution, account.color, stamp)
    )
  }

  const budgetCount = db.prepare('SELECT COUNT(*) AS count FROM budget_items').get() as {
    count: number
  }
  if (budgetCount.count === 0) {
    const insert = db.prepare(
      `INSERT INTO budget_items
       (category, is_need, amount_standard, amount_with_aid, amount_with_parents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const stamp = now()
    DEFAULT_NEEDS.forEach((item) =>
      insert.run(
        item.category,
        1,
        cents(item.standard),
        cents(item.withAid),
        cents(item.withParents),
        stamp,
        stamp
      )
    )
    DEFAULT_NICE_TO_HAVES.forEach((item) =>
      insert.run(
        item.category,
        0,
        cents(item.standard),
        cents(item.withAid),
        cents(item.withParents),
        stamp,
        stamp
      )
    )
  }
  runWorkbookBudgetMigration()

  const expectedIncomeCount = db
    .prepare('SELECT COUNT(*) AS count FROM expected_income_entries')
    .get() as { count: number }
  if (expectedIncomeCount.count === 0) {
    const insert = db.prepare(
      `INSERT INTO expected_income_entries
       (name, notes, annual_amount, income_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    const stamp = now()
    DEFAULT_EXPECTED_INCOME.forEach((entry) =>
      insert.run(entry.name, entry.notes, entry.annual_amount, entry.income_kind, stamp, stamp)
    )
  }

  const taxSettingCount = db.prepare('SELECT COUNT(*) AS count FROM income_tax_settings').get() as {
    count: number
  }
  if (taxSettingCount.count === 0) {
    const insert = db.prepare('INSERT INTO income_tax_settings (key, value) VALUES (?, ?)')
    Object.entries(DEFAULT_TAX_SETTINGS).forEach(([key, value]) => insert.run(key, String(value)))
  }

  const livingExpensesSettingsCount = db
    .prepare('SELECT COUNT(*) AS count FROM living_expenses_settings')
    .get() as {
    count: number
  }
  if (livingExpensesSettingsCount.count === 0) {
    const insert = db.prepare('INSERT INTO living_expenses_settings (key, value) VALUES (?, ?)')
    Object.entries(DEFAULT_LIVING_EXPENSES_SETTINGS).forEach(([key, value]) =>
      insert.run(key, String(value))
    )
  }

  const importRuleCount = db
    .prepare('SELECT COUNT(*) AS count FROM import_transaction_rules')
    .get() as { count: number }
  if (importRuleCount.count === 0) {
    const insert = db.prepare(
      `INSERT INTO import_transaction_rules (provider, match_text, mapped_category, priority, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    const stamp = now()
    DEFAULT_CAPITAL_ONE_IMPORT_RULES.forEach((rule) =>
      insert.run(rule.provider, rule.match_text, rule.mapped_category, rule.priority, stamp)
    )
  }
}

function ensureCoreAccounts(): void {
  const db = getDb()
  const stamp = now()
  const accounts = () =>
    db.prepare('SELECT * FROM accounts ORDER BY id ASC').all().map(rowToAccount)
  const takenIds = new Set<number>()

  DEFAULT_ACCOUNTS.forEach((core) => {
    const current = accounts()
    const exact = current.find((account) => account.name.toLowerCase() === core.name.toLowerCase())
    if (exact) {
      takenIds.add(exact.id)
      db.prepare('UPDATE accounts SET type = ?, institution = ?, color = ? WHERE id = ?').run(
        core.type,
        core.institution,
        exact.color || core.color,
        exact.id
      )
      return
    }

    const legacy = current.find(
      (account) => !takenIds.has(account.id) && inferCoreAccountType(account) === core.type
    )
    if (legacy) {
      takenIds.add(legacy.id)
      db.prepare(
        'UPDATE accounts SET name = ?, type = ?, institution = ?, color = ? WHERE id = ?'
      ).run(core.name, core.type, core.institution, legacy.color || core.color, legacy.id)
      return
    }

    db.prepare(
      'INSERT INTO accounts (name, type, institution, color, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(core.name, core.type, core.institution, core.color, stamp)
  })

  const coreByType = new Map(
    accounts()
      .filter((account) => isCoreAccount(account))
      .map((account) => [account.type, account])
  )
  accounts()
    .filter((account) => !isCoreAccount(account))
    .forEach((account) => {
      const targetType = inferCoreAccountType(account)
      const target = coreByType.get(targetType) ?? coreByType.get('chase')
      if (target) {
        db.prepare('UPDATE transactions SET account_id = ? WHERE account_id = ?').run(
          target.id,
          account.id
        )
        db.prepare('UPDATE imported_files SET account_id = ? WHERE account_id = ?').run(
          target.id,
          account.id
        )
      }
      db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id)
    })
}

function isCoreAccount(account: Account): boolean {
  return DEFAULT_ACCOUNTS.some((core) => core.name === account.name && core.type === account.type)
}

function inferCoreAccountType(account: Account): AccountType {
  const name = account.name.toLowerCase()
  const rawType = String(account.type)
  if (
    name.includes('capital') ||
    name.includes('credit') ||
    rawType === 'credit' ||
    rawType === 'capital_one'
  )
    return 'capital_one'
  if (name.includes('venmo') || rawType === 'venmo') return 'venmo'
  if (name.includes('ebt') || rawType === 'ebt') return 'ebt'
  if (
    name.includes('chase') ||
    name.includes('checking') ||
    rawType === 'checking' ||
    rawType === 'savings' ||
    rawType === 'chase'
  )
    return 'chase'
  return 'chase'
}

function runDateOnlyUtcMigration(): void {
  const db = getDb()
  const flag = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('money_local_date_only_noon_v1')
  if (flag) return
  shiftUtcMidnightDates('transactions', 'date')
  shiftUtcMidnightDates('income_entries', 'date')
  shiftUtcMidnightDates('imported_files', 'first_transaction_date')
  shiftUtcMidnightDates('imported_files', 'last_transaction_date')
  const stamp = now()
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run('money_local_date_only_noon_v1', String(stamp))
}

function shiftUtcMidnightDates(table: string, column: string): void {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} > 0`
    )
    .all() as Array<{ id: number; value: number }>
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`)
  rows.forEach((row) => {
    if (row.value % 86400 !== 0) return
    update.run(localNoonForUtcCalendarDate(row.value), row.id)
  })
}

function localNoonForUtcCalendarDate(unix: number): number {
  const date = new Date(unix * 1000)
  return Math.floor(
    new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0, 0).getTime() /
      1000
  )
}

function runWorkbookBudgetMigration(): void {
  const db = getDb()
  const flag = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('workbook_budget_reconciliation_v2')
  if (flag) return

  WORKBOOK_CATEGORY_RENAMES.forEach(([from, to]) => {
    const target = db.prepare('SELECT id FROM budget_items WHERE category = ? LIMIT 1').get(to) as
      | { id: number }
      | undefined
    const source = db
      .prepare('SELECT id FROM budget_items WHERE category = ? LIMIT 1')
      .get(from) as { id: number } | undefined
    if (source && !target) {
      db.prepare('UPDATE budget_items SET category = ?, updated_at = ? WHERE id = ?').run(
        to,
        now(),
        source.id
      )
    } else if (source && target) {
      db.prepare('DELETE FROM budget_items WHERE id = ?').run(source.id)
    }
    db.prepare('UPDATE transactions SET mapped_category = ? WHERE mapped_category = ?').run(
      to,
      from
    )
    db.prepare('UPDATE transactions SET raw_category = ? WHERE raw_category = ?').run(to, from)
    db.prepare(
      'UPDATE category_mapping_rules SET mapped_category = ? WHERE mapped_category = ?'
    ).run(to, from)
  })

  const existing = db.prepare('SELECT id FROM budget_items WHERE category = ? LIMIT 1')
  const insert = db.prepare(
    `INSERT INTO budget_items
     (category, is_need, amount_standard, amount_with_aid, amount_with_parents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const update = db.prepare(
    `UPDATE budget_items
     SET is_need = ?, amount_standard = ?, amount_with_aid = ?, amount_with_parents = ?, updated_at = ?
     WHERE id = ?`
  )
  const upsertLine = db.prepare(
    `INSERT INTO budget_line_items
     (source_sheet, source_row, section, label, category, monthly_amount, annual_amount, notes, support_scope, is_need, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_sheet, source_row) DO UPDATE SET
       section = excluded.section,
       label = excluded.label,
       category = excluded.category,
       monthly_amount = excluded.monthly_amount,
       annual_amount = excluded.annual_amount,
       notes = excluded.notes,
       support_scope = excluded.support_scope,
       is_need = excluded.is_need,
       updated_at = excluded.updated_at`
  )
  const stamp = now()
  WORKBOOK_BUDGET_DEFAULTS.forEach((item) => {
    const row = existing.get(item.category) as { id: number } | undefined
    if (row) {
      update.run(
        item.isNeed ? 1 : 0,
        cents(item.standard),
        cents(item.withAid),
        cents(item.withParents),
        stamp,
        row.id
      )
    } else {
      insert.run(
        item.category,
        item.isNeed ? 1 : 0,
        cents(item.standard),
        cents(item.withAid),
        cents(item.withParents),
        stamp,
        stamp
      )
    }
  })
  WORKBOOK_BUDGET_LINES.forEach((item) => {
    const monthly = cents(item.monthly)
    const sec = item.section.toLowerCase()
    const lineIsNeed = sec.includes('wants') || sec.includes('nice') ? 0 : 1
    upsertLine.run(
      item.source_sheet,
      item.source_row,
      item.section,
      item.label,
      item.category,
      monthly,
      monthly * 12,
      item.notes,
      item.support_scope,
      lineIsNeed,
      stamp,
      stamp
    )
  })
  db.prepare(
    `INSERT INTO app_meta (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run('workbook_budget_reconciliation_v2', String(stamp))
}

function budgetLineItemsHasIsNeedColumn(db: Database.Database): boolean {
  const rows = db.prepare('PRAGMA table_info(budget_line_items)').all() as {
    name: string
  }[]
  return rows.some((row) => row.name === 'is_need')
}

function ensureTransactionsHasIncomeCandidateColumn(): void {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(transactions)').all() as {
    name: string
  }[]
  if (cols.some((c) => c.name === 'income_candidate')) return
  db.exec('ALTER TABLE transactions ADD COLUMN income_candidate INTEGER NOT NULL DEFAULT 0')
}

function ensureTransactionsHasExternalIdColumn(): void {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(transactions)').all() as {
    name: string
  }[]
  if (cols.some((c) => c.name === 'external_id')) return
  db.exec('ALTER TABLE transactions ADD COLUMN external_id TEXT')
}

function ensureAccountsHasPlaidCutoverColumn(): void {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(accounts)').all() as {
    name: string
  }[]
  if (cols.some((c) => c.name === 'plaid_cutover_date')) return
  db.exec('ALTER TABLE accounts ADD COLUMN plaid_cutover_date INTEGER')
}

function inferIncomeTypeFromText(company: string, shootName: string, notes: string): string {
  const haystack = `${company} ${shootName} ${notes}`.toLowerCase()
  if (haystack.includes('snappr')) return 'Snappr'
  if (haystack.includes('thumbtack')) return 'Thumbtack'
  if (haystack.includes('upwork')) return 'Upwork'
  return 'Stimsonphoto'
}

function ensureIncomeEntriesHasIncomeTypeColumn(): void {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(income_entries)').all() as {
    name: string
  }[]
  if (!cols.some((c) => c.name === 'income_type')) {
    db.exec("ALTER TABLE income_entries ADD COLUMN income_type TEXT NOT NULL DEFAULT ''")
  }
  const rows = db
    .prepare('SELECT id, company, shoot_name, notes, income_type FROM income_entries')
    .all() as {
    id: number
    company: string
    shoot_name: string
    notes: string
    income_type: string
  }[]
  const update = db.prepare('UPDATE income_entries SET income_type = ? WHERE id = ?')
  for (const row of rows) {
    if (String(row.income_type ?? '').trim()) continue
    update.run(
      inferIncomeTypeFromText(
        String(row.company ?? ''),
        String(row.shoot_name ?? ''),
        String(row.notes ?? '')
      ),
      row.id
    )
  }
}

function ensureIncomeEntriesHasTipColumn(): void {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(income_entries)').all() as {
    name: string
  }[]
  if (!cols.some((c) => c.name === 'tip')) {
    db.exec('ALTER TABLE income_entries ADD COLUMN tip INTEGER')
  }
}

function ensureBudgetLineItemsHasIsNeedColumn(): void {
  const db = getDb()
  if (budgetLineItemsHasIsNeedColumn(db)) return
  db.exec('ALTER TABLE budget_line_items ADD COLUMN is_need INTEGER NOT NULL DEFAULT 1')
  db.prepare(
    `UPDATE budget_line_items SET is_need = 0 WHERE lower(section) LIKE '%wants%' OR lower(section) LIKE '%nice%'`
  ).run()
  db.prepare(
    `UPDATE budget_line_items SET is_need = (
       SELECT CASE WHEN bi.is_need THEN 1 ELSE 0 END FROM budget_items bi WHERE bi.category = budget_line_items.category LIMIT 1
     ) WHERE EXISTS (SELECT 1 FROM budget_items bi WHERE bi.category = budget_line_items.category)`
  ).run()
}

function runMoneyBudgetAllowlistMigration(): void {
  const db = getDb()
  ensureBudgetLineItemsHasIsNeedColumn()
  const flag = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('money_budget_allowlist_v3')
  if (flag) return

  db.prepare(
    `UPDATE budget_line_items SET category = 'Utilities' WHERE category = 'Phone Bill'`
  ).run()
  db.prepare(
    `UPDATE budget_line_items SET category = 'Insurance' WHERE category IN ('Healthcare', 'Medical')`
  ).run()
  db.prepare(`UPDATE budget_line_items SET category = 'Travel' WHERE category = 'Car Rental'`).run()
  db.prepare(
    `UPDATE budget_line_items SET category = 'Other Services' WHERE category = 'Misc'`
  ).run()

  const placeholders = BUDGET_CATEGORY_ORDER.map(() => '?').join(',')
  db.prepare(
    `DELETE FROM budget_line_items WHERE trim(category) = '' OR category NOT IN (${placeholders})`
  ).run(...BUDGET_CATEGORY_ORDER)
  db.prepare(`DELETE FROM budget_items WHERE category NOT IN (${placeholders})`).run(
    ...BUDGET_CATEGORY_ORDER
  )

  const stamp = now()
  const insertItem = db.prepare(
    `INSERT INTO budget_items (category, is_need, amount_standard, amount_with_aid, amount_with_parents, created_at, updated_at)
     VALUES (?, ?, 0, 0, 0, ?, ?)`
  )
  for (const category of BUDGET_CATEGORY_ORDER) {
    const exists = db.prepare('SELECT 1 FROM budget_items WHERE category = ? LIMIT 1').get(category)
    if (!exists) {
      const need = defaultIsNeedForBudgetCategory(category)
      insertItem.run(category, need ? 1 : 0, stamp, stamp)
    }
  }

  for (const category of BUDGET_CATEGORY_ORDER) {
    syncBudgetItemTotalsForCategory(category)
  }

  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run('money_budget_allowlist_v3', String(stamp))
}

function runBudgetLineNeedWorkbookMigration(): void {
  const db = getDb()
  const flag = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('money_budget_line_need_workbook_v1')
  if (flag) return

  const rows = db.prepare('SELECT id, category, label, section FROM budget_line_items').all() as {
    id: number
    category: string
    label: string
    section: string
  }[]
  const stamp = now()
  const update = db.prepare(`UPDATE budget_line_items SET is_need = ?, updated_at = ? WHERE id = ?`)
  for (const row of rows) {
    if (row.section === 'Parental & Gov Help') continue
    const nextNeed = inferLineIsNeed(row.category, row.label)
    update.run(nextNeed ? 1 : 0, stamp, row.id)
  }

  for (const category of BUDGET_CATEGORY_ORDER) {
    syncBudgetItemTotalsForCategory(category)
  }

  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run('money_budget_line_need_workbook_v1', String(stamp))
}

function runBudgetSectionNeedsWantsLabelsMigration(): void {
  const db = getDb()
  const flag = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('money_budget_section_needs_wants_v1')
  if (flag) return
  db.prepare(
    `UPDATE budget_line_items SET section = 'Wants' WHERE lower(section) LIKE '%nice%'`
  ).run()
  db.prepare(
    `UPDATE budget_line_items SET section = 'Needs' WHERE lower(section) LIKE '%must-have%' OR section = 'Must-Have Expenses'`
  ).run()
  const stamp = now()
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run('money_budget_section_needs_wants_v1', String(stamp))
}

function parseAccountType(value: unknown): AccountType {
  if (value === 'capital_one' || value === 'venmo' || value === 'ebt' || value === 'chase')
    return value
  if (value === 'credit') return 'capital_one'
  if (value === 'checking' || value === 'savings') return 'chase'
  return 'chase'
}

function parseSource(value: unknown): TransactionSource {
  return value === 'csv_import' || value === 'ai' ? value : 'manual'
}

function parseIncomeKind(value: unknown): IncomeKind {
  return value === 'w2' || value === 'self_employment' ? value : 'other'
}

function parseFilingStatus(value: unknown): FilingStatus {
  return value === 'single' ? value : 'single'
}

function parseBudgetSupportScope(value: unknown): BudgetSupportScope {
  return value === 'parental' || value === 'government' ? value : 'none'
}

function rowToAccount(row: unknown): Account {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    name: String(r.name ?? ''),
    type: parseAccountType(r.type),
    institution: String(r.institution ?? ''),
    color: String(r.color ?? '#a1a1aa'),
    plaid_cutover_date:
      r.plaid_cutover_date === null || r.plaid_cutover_date === undefined
        ? null
        : Number(r.plaid_cutover_date),
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
    income_candidate: Boolean(r.income_candidate),
    external_id: (r.external_id as string | null) ?? null,
    created_at: Number(r.created_at ?? 0),
    updated_at: Number(r.updated_at ?? 0)
  }
}

function parseImportedFilePreview(value: unknown): ImportedFilePreview {
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as Partial<ImportedFilePreview>
    return {
      headers: Array.isArray(parsed.headers) ? parsed.headers.map(String) : [],
      rows: Array.isArray(parsed.rows)
        ? parsed.rows.map((row) => (Array.isArray(row) ? row.map(String) : []))
        : [],
      rowCount: Number(parsed.rowCount ?? 0),
      columnCount: Number(parsed.columnCount ?? 0)
    }
  } catch {
    return { headers: [], rows: [], rowCount: 0, columnCount: 0 }
  }
}

function rowToImportedFile(row: unknown): ImportedFileRecord {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    file_name: String(r.file_name ?? ''),
    file_path: String(r.file_path ?? ''),
    file_size: Number(r.file_size ?? 0),
    file_type: String(r.file_type ?? ''),
    account_id: r.account_id === null || r.account_id === undefined ? null : Number(r.account_id),
    imported_count: Number(r.imported_count ?? 0),
    skipped_count: Number(r.skipped_count ?? 0),
    error_count: Number(r.error_count ?? 0),
    first_transaction_date:
      r.first_transaction_date === null || r.first_transaction_date === undefined
        ? null
        : Number(r.first_transaction_date),
    last_transaction_date:
      r.last_transaction_date === null || r.last_transaction_date === undefined
        ? null
        : Number(r.last_transaction_date),
    preview: parseImportedFilePreview(r.preview_json),
    created_at: Number(r.created_at ?? 0)
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

function rowToBudgetLineItem(row: unknown): BudgetLineItem {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    source_sheet: String(r.source_sheet ?? ''),
    source_row: Number(r.source_row ?? 0),
    section: String(r.section ?? ''),
    label: String(r.label ?? ''),
    category: String(r.category ?? ''),
    monthly_amount: Number(r.monthly_amount ?? 0),
    annual_amount: Number(r.annual_amount ?? 0),
    notes: String(r.notes ?? ''),
    support_scope: parseBudgetSupportScope(r.support_scope),
    is_need: Number(r.is_need ?? 1) === 1,
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
    income_type: String(r.income_type ?? ''),
    date: Number(r.date ?? 0),
    amount: Number(r.amount ?? 0),
    tip: r.tip === null || r.tip === undefined ? null : Number(r.tip),
    notes: String(r.notes ?? ''),
    created_at: Number(r.created_at ?? 0),
    updated_at: Number(r.updated_at ?? 0)
  }
}

function rowToExpectedIncomeEntry(row: unknown): ExpectedIncomeEntry {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    name: String(r.name ?? ''),
    notes: String(r.notes ?? ''),
    annual_amount: Number(r.annual_amount ?? 0),
    income_kind: parseIncomeKind(r.income_kind),
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

function parseImportRuleProvider(value: unknown): ImportRuleProvider {
  return value === 'capital_one' ? 'capital_one' : 'capital_one'
}

function rowToImportTransactionRule(row: unknown): ImportTransactionRule {
  const r = row as Record<string, unknown>
  return {
    id: Number(r.id),
    provider: parseImportRuleProvider(r.provider),
    match_text: String(r.match_text ?? ''),
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

function normalizeDuplicateDescription(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function getImportedFiles(
  filters: { start?: number; end?: number } = {}
): ImportedFileRecord[] {
  const clauses: string[] = []
  const params: number[] = []
  if (filters.start !== undefined && filters.end !== undefined) {
    clauses.push(
      `(
        (first_transaction_date IS NOT NULL AND last_transaction_date IS NOT NULL AND first_transaction_date <= ? AND last_transaction_date >= ?)
        OR (first_transaction_date IS NULL AND created_at >= ? AND created_at <= ?)
      )`
    )
    params.push(filters.end, filters.start, filters.start, filters.end)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return getDb()
    .prepare(`SELECT * FROM imported_files ${where} ORDER BY created_at DESC, id DESC`)
    .all(...params)
    .map(rowToImportedFile)
}

export function recordImportedFile(data: {
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
}): ImportedFileRecord {
  const result = getDb()
    .prepare(
      `INSERT INTO imported_files
       (file_name, file_path, file_size, file_type, account_id, imported_count, skipped_count, error_count,
        first_transaction_date, last_transaction_date, preview_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.file_name,
      data.file_path,
      data.file_size,
      data.file_type,
      data.account_id,
      data.imported_count,
      data.skipped_count,
      data.error_count,
      data.first_transaction_date,
      data.last_transaction_date,
      JSON.stringify(data.preview),
      now()
    )
  const row = getDb()
    .prepare('SELECT * FROM imported_files WHERE id = ?')
    .get(Number(result.lastInsertRowid))
  return rowToImportedFile(row)
}

export function clearImportedFile(fileId: number): Transaction[] {
  const fileRow = getDb().prepare('SELECT * FROM imported_files WHERE id = ?').get(fileId)
  if (!fileRow) return []
  const file = rowToImportedFile(fileRow)
  let affected: Transaction[] = []
  if (file.first_transaction_date && file.last_transaction_date && file.account_id) {
    affected = getDb()
      .prepare(
        `SELECT * FROM transactions WHERE source = 'csv_import' AND account_id = ? AND date >= ? AND date <= ?`
      )
      .all(file.account_id, file.first_transaction_date, file.last_transaction_date)
      .map(rowToTransaction)
    getDb()
      .prepare(
        `DELETE FROM transactions WHERE source = 'csv_import' AND account_id = ? AND date >= ? AND date <= ?`
      )
      .run(file.account_id, file.first_transaction_date, file.last_transaction_date)
  }
  getDb().prepare('DELETE FROM imported_files WHERE id = ?').run(fileId)
  return affected
}

export function clearIncomeCandidateFlags(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  getDb()
    .prepare(`UPDATE transactions SET income_candidate = 0 WHERE id IN (${placeholders})`)
    .run(...ids)
}

export function transactionExists(date: number, description: string, amount: number): boolean {
  const rows = getDb()
    .prepare('SELECT description FROM transactions WHERE date = ? AND amount = ?')
    .all(date, amount) as Array<{ description: string }>
  const normalized = normalizeDuplicateDescription(description)
  return rows.some((row) => normalizeDuplicateDescription(row.description) === normalized)
}

export function createTransaction(data: Partial<Transaction>): Transaction {
  const stamp = now()
  const date = data.date ?? stamp
  const description = data.description ?? ''
  const amount = Math.round(data.amount ?? 0)
  const raw = data.raw_category ?? ''
  const mapped =
    data.mapped_category || applyRulesToCategory(raw, description) || raw || 'Uncategorized'
  const result = getDb()
    .prepare(
      `INSERT INTO transactions
       (date, description, amount, raw_category, mapped_category, account_id, source, notes, income_candidate, external_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      date,
      description,
      amount,
      raw,
      mapped,
      data.account_id ?? null,
      data.source ?? 'manual',
      data.notes ?? '',
      data.income_candidate ? 1 : 0,
      data.external_id ?? null,
      stamp,
      stamp
    )
  return getTransactionById(Number(result.lastInsertRowid))
}

export function updateTransaction(id: number, data: Partial<Transaction>): Transaction {
  const existing = getTransactionById(id)
  const description = data.description ?? existing.description
  const rawCategory = data.raw_category ?? existing.raw_category
  const mappedCategory =
    data.mapped_category ??
    existing.mapped_category ??
    applyRulesToCategory(rawCategory, description) ??
    ''
  getDb()
    .prepare(
      `UPDATE transactions
       SET date = ?, description = ?, amount = ?, raw_category = ?, mapped_category = ?,
           account_id = ?, source = ?, notes = ?, income_candidate = ?, external_id = ?, updated_at = ?
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
      data.income_candidate === undefined
        ? existing.income_candidate
          ? 1
          : 0
        : data.income_candidate
          ? 1
          : 0,
      data.external_id === undefined ? existing.external_id : data.external_id,
      now(),
      id
    )
  return getTransactionById(id)
}

export function deleteTransaction(id: number): void {
  getDb().prepare('DELETE FROM transactions WHERE id = ?').run(id)
}

export function deleteTransactions(ids: number[]): { deleted: number } {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)))
  if (uniqueIds.length === 0) return { deleted: 0 }
  const remove = getDb().prepare('DELETE FROM transactions WHERE id = ?')
  const run = getDb().transaction((nextIds: number[]) => {
    let deleted = 0
    nextIds.forEach((id) => {
      deleted += remove.run(id).changes
    })
    return deleted
  })
  return { deleted: run(uniqueIds) }
}

export function deleteAllTransactions(): { deleted: number } {
  const result = getDb().prepare('DELETE FROM transactions').run()
  return { deleted: result.changes }
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

export function getAllBudgetLineItems(): BudgetLineItem[] {
  return getDb()
    .prepare('SELECT * FROM budget_line_items ORDER BY source_row ASC')
    .all()
    .map(rowToBudgetLineItem)
}

export function createBudgetLineItem(data: Partial<BudgetLineItem>): BudgetLineItem {
  const stamp = now()
  const monthly = Math.round(data.monthly_amount ?? 0)
  const sourceSheet = data.source_sheet ?? 'Living Expenses'
  const sourceRow = data.source_row ?? nextBudgetLineSourceRow(sourceSheet)
  const category = data.category ?? ''
  const lineIsNeed =
    data.is_need === true
      ? 1
      : data.is_need === false
        ? 0
        : inferLineIsNeed(category, data.label ?? '')
          ? 1
          : 0
  const section =
    data.section && String(data.section).trim() !== ''
      ? data.section
      : lineIsNeed
        ? 'Needs'
        : 'Wants'
  const result = getDb()
    .prepare(
      `INSERT INTO budget_line_items
       (source_sheet, source_row, section, label, category, monthly_amount, annual_amount, notes, support_scope, is_need, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sourceSheet,
      sourceRow,
      section,
      data.label ?? '',
      category,
      monthly,
      Math.round(data.annual_amount ?? monthly * 12),
      data.notes ?? '',
      parseBudgetSupportScope(data.support_scope),
      lineIsNeed,
      stamp,
      stamp
    )
  const created = getBudgetLineItemById(Number(result.lastInsertRowid))
  syncBudgetItemTotalsForCategory(created.category)
  return created
}

export function updateBudgetLineItem(id: number, data: Partial<BudgetLineItem>): BudgetLineItem {
  const existing = getBudgetLineItemById(id)
  const monthly = Math.round(data.monthly_amount ?? existing.monthly_amount)
  const nextIsNeed = data.is_need === undefined ? (existing.is_need ? 1 : 0) : data.is_need ? 1 : 0
  getDb()
    .prepare(
      `UPDATE budget_line_items
       SET source_sheet = ?, source_row = ?, section = ?, label = ?, category = ?,
           monthly_amount = ?, annual_amount = ?, notes = ?, support_scope = ?, is_need = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      data.source_sheet ?? existing.source_sheet,
      data.source_row ?? existing.source_row,
      data.section ?? existing.section,
      data.label ?? existing.label,
      data.category ?? existing.category,
      monthly,
      Math.round(data.annual_amount ?? monthly * 12),
      data.notes ?? existing.notes,
      parseBudgetSupportScope(data.support_scope ?? existing.support_scope),
      nextIsNeed,
      now(),
      id
    )
  const updated = getBudgetLineItemById(id)
  syncBudgetItemTotalsForCategory(existing.category)
  if (updated.category !== existing.category) syncBudgetItemTotalsForCategory(updated.category)
  return updated
}

export function deleteBudgetLineItem(id: number): void {
  const existing = getBudgetLineItemById(id)
  getDb().prepare('DELETE FROM budget_line_items WHERE id = ?').run(id)
  syncBudgetItemTotalsForCategory(existing.category)
}

function getBudgetLineItemById(id: number): BudgetLineItem {
  const row = getDb().prepare('SELECT * FROM budget_line_items WHERE id = ?').get(id)
  if (!row) throw new Error(`Budget line item ${id} not found`)
  return rowToBudgetLineItem(row)
}

function nextBudgetLineSourceRow(sourceSheet: string): number {
  const row = getDb()
    .prepare('SELECT MAX(source_row) AS maxRow FROM budget_line_items WHERE source_sheet = ?')
    .get(sourceSheet) as { maxRow?: number | null } | undefined
  return Math.max(1, Number(row?.maxRow ?? 0) + 1)
}

function syncBudgetItemTotalsForCategory(category: string): void {
  if (!category.trim()) return
  const lines = getDb()
    .prepare(
      "SELECT monthly_amount, support_scope FROM budget_line_items WHERE category = ? AND section <> 'Parental & Gov Help'"
    )
    .all(category)
    .map(rowToBudgetLineItem)
  const standard = lines.reduce((sum, line) => sum + line.monthly_amount, 0)
  const withParents = lines.reduce(
    (sum, line) => sum + (line.support_scope === 'parental' ? 0 : line.monthly_amount),
    0
  )
  const withAid = lines.reduce(
    (sum, line) =>
      sum +
      (line.support_scope === 'parental' || line.support_scope === 'government'
        ? 0
        : line.monthly_amount),
    0
  )
  getDb()
    .prepare(
      `UPDATE budget_items
       SET amount_standard = ?, amount_with_aid = ?, amount_with_parents = ?, updated_at = ?
       WHERE category = ?`
    )
    .run(standard, withAid, withParents, now(), category)
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

export function getOrCreateAccountByName(name: string, type: Account['type'] = 'chase'): Account {
  const row = getDb().prepare('SELECT * FROM accounts WHERE LOWER(name) = LOWER(?)').get(name)
  if (row) return rowToAccount(row)
  return createAccount({ name, type })
}

export function createAccount(data: Partial<Account>): Account {
  const stamp = now()
  const result = getDb()
    .prepare(
      'INSERT INTO accounts (name, type, institution, color, plaid_cutover_date, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      data.name ?? 'Chase',
      data.type ?? 'chase',
      data.institution ?? '',
      data.color ?? '#a1a1aa',
      data.plaid_cutover_date ?? null,
      stamp
    )
  return getAccountById(Number(result.lastInsertRowid))
}

export function updateAccount(id: number, data: Partial<Account>): Account {
  const existing = getAccountById(id)
  getDb()
    .prepare(
      'UPDATE accounts SET name = ?, type = ?, institution = ?, color = ?, plaid_cutover_date = ? WHERE id = ?'
    )
    .run(
      data.name ?? existing.name,
      data.type ?? existing.type,
      data.institution ?? existing.institution,
      data.color ?? existing.color,
      data.plaid_cutover_date === undefined
        ? existing.plaid_cutover_date
        : data.plaid_cutover_date,
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
  return getDb()
    .prepare('SELECT * FROM income_entries ORDER BY date DESC, id DESC')
    .all()
    .map(rowToIncomeEntry)
}

export function createIncomeEntry(data: Partial<IncomeEntry>): IncomeEntry {
  const stamp = now()
  const company = data.company ?? ''
  const shootName = data.shoot_name ?? ''
  const notes = data.notes ?? ''
  const incomeType =
    String(data.income_type ?? '').trim() || inferIncomeTypeFromText(company, shootName, notes)
  const result = getDb()
    .prepare(
      `INSERT INTO income_entries (shoot_name, company, income_type, date, amount, tip, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      shootName,
      company,
      incomeType,
      data.date ?? stamp,
      Math.round(data.amount ?? 0),
      data.tip !== undefined && data.tip !== null ? Math.round(data.tip) : null,
      notes,
      stamp,
      stamp
    )
  return getIncomeEntryById(Number(result.lastInsertRowid))
}

export function updateIncomeEntry(id: number, data: Partial<IncomeEntry>): IncomeEntry {
  const existing = getIncomeEntryById(id)
  const tipVal =
    data.tip === null ? null : data.tip !== undefined ? Math.round(data.tip) : existing.tip
  getDb()
    .prepare(
      'UPDATE income_entries SET shoot_name = ?, company = ?, income_type = ?, date = ?, amount = ?, tip = ?, notes = ?, updated_at = ? WHERE id = ?'
    )
    .run(
      data.shoot_name ?? existing.shoot_name,
      data.company ?? existing.company,
      data.income_type ?? existing.income_type,
      data.date ?? existing.date,
      Math.round(data.amount ?? existing.amount),
      tipVal,
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

export function getAllExpectedIncomeEntries(): ExpectedIncomeEntry[] {
  return getDb()
    .prepare('SELECT * FROM expected_income_entries ORDER BY id ASC')
    .all()
    .map(rowToExpectedIncomeEntry)
}

export function createExpectedIncomeEntry(data: Partial<ExpectedIncomeEntry>): ExpectedIncomeEntry {
  const stamp = now()
  const result = getDb()
    .prepare(
      `INSERT INTO expected_income_entries
       (name, notes, annual_amount, income_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.name ?? 'New Income Source',
      data.notes ?? '',
      Math.round(data.annual_amount ?? 0),
      data.income_kind ?? 'other',
      stamp,
      stamp
    )
  return getExpectedIncomeEntryById(Number(result.lastInsertRowid))
}

export function updateExpectedIncomeEntry(
  id: number,
  data: Partial<ExpectedIncomeEntry>
): ExpectedIncomeEntry {
  const existing = getExpectedIncomeEntryById(id)
  getDb()
    .prepare(
      `UPDATE expected_income_entries
       SET name = ?, notes = ?, annual_amount = ?, income_kind = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      data.name ?? existing.name,
      data.notes ?? existing.notes,
      Math.round(data.annual_amount ?? existing.annual_amount),
      data.income_kind ?? existing.income_kind,
      now(),
      id
    )
  return getExpectedIncomeEntryById(id)
}

export function deleteExpectedIncomeEntry(id: number): void {
  getDb().prepare('DELETE FROM expected_income_entries WHERE id = ?').run(id)
}

function getExpectedIncomeEntryById(id: number): ExpectedIncomeEntry {
  const row = getDb().prepare('SELECT * FROM expected_income_entries WHERE id = ?').get(id)
  if (!row) throw new Error(`Expected income entry ${id} not found`)
  return rowToExpectedIncomeEntry(row)
}

export function getIncomeTaxSettings(): IncomeTaxSettings {
  const rows = getDb().prepare('SELECT key, value FROM income_tax_settings').all() as Array<{
    key: string
    value: string
  }>
  const values = new Map(rows.map((row) => [row.key, row.value]))
  return {
    filing_status: parseFilingStatus(values.get('filing_status')),
    retirement_contribution: numberSetting(values, 'retirement_contribution'),
    above_line_deductions: numberSetting(values, 'above_line_deductions'),
    federal_standard_deduction: numberSetting(values, 'federal_standard_deduction'),
    ca_standard_deduction: numberSetting(values, 'ca_standard_deduction'),
    ca_bracket_adjustment: numberSetting(values, 'ca_bracket_adjustment'),
    social_security_wage_base: numberSetting(values, 'social_security_wage_base')
  }
}

export function updateIncomeTaxSettings(data: Partial<IncomeTaxSettings>): IncomeTaxSettings {
  const upsert = getDb().prepare(
    `INSERT INTO income_tax_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) upsert.run(key, String(value))
  })
  return getIncomeTaxSettings()
}

export function getLivingExpensesSettings(): LivingExpensesSettings {
  const rows = getDb().prepare('SELECT key, value FROM living_expenses_settings').all() as Array<{
    key: string
    value: string
  }>
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const rentRatioParsed = Number(values.get('rent_ratio_target_x100'))
  const reserveMonthsParsed = Number(values.get('reserve_target_months'))
  return {
    rent_ratio_target_x100: Number.isFinite(rentRatioParsed)
      ? Math.max(50, Math.round(rentRatioParsed))
      : DEFAULT_LIVING_EXPENSES_SETTINGS.rent_ratio_target_x100,
    reserve_target_months: Number.isFinite(reserveMonthsParsed)
      ? Math.max(1, Math.round(reserveMonthsParsed))
      : DEFAULT_LIVING_EXPENSES_SETTINGS.reserve_target_months
  }
}

export function updateLivingExpensesSettings(
  data: Partial<LivingExpensesSettings>
): LivingExpensesSettings {
  const upsert = getDb().prepare(
    `INSERT INTO living_expenses_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  if (data.rent_ratio_target_x100 !== undefined) {
    upsert.run(
      'rent_ratio_target_x100',
      String(Math.max(50, Math.round(data.rent_ratio_target_x100)))
    )
  }
  if (data.reserve_target_months !== undefined) {
    upsert.run('reserve_target_months', String(Math.max(1, Math.round(data.reserve_target_months))))
  }
  return getLivingExpensesSettings()
}

export function getAppMetaValue(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return typeof row?.value === 'string' ? row.value : null
}

export function setAppMetaValue(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_meta (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
}

export function deleteAppMetaValues(keys: string[]): void {
  if (keys.length === 0) return
  const remove = getDb().prepare('DELETE FROM app_meta WHERE key = ?')
  const run = getDb().transaction((nextKeys: string[]) => {
    nextKeys.forEach((key) => remove.run(key))
  })
  run(keys)
}

function numberSetting(values: Map<string, string>, key: keyof IncomeTaxSettings): number {
  const fallback = DEFAULT_TAX_SETTINGS[key]
  const parsed = Number(values.get(key))
  return Number.isFinite(parsed) ? parsed : typeof fallback === 'number' ? fallback : 0
}

export function getAllCategoryRules(): CategoryMappingRule[] {
  return getDb()
    .prepare('SELECT * FROM category_mapping_rules ORDER BY priority DESC, id ASC')
    .all()
    .map(rowToCategoryRule)
}

export function getImportTransactionRules(provider?: ImportRuleProvider): ImportTransactionRule[] {
  const db = getDb()
  if (provider) {
    return db
      .prepare(
        'SELECT * FROM import_transaction_rules WHERE provider = ? ORDER BY priority DESC, id ASC'
      )
      .all(provider)
      .map(rowToImportTransactionRule)
  }
  return db
    .prepare('SELECT * FROM import_transaction_rules ORDER BY provider ASC, priority DESC, id ASC')
    .all()
    .map(rowToImportTransactionRule)
}

export function createImportTransactionRule(
  data: Partial<ImportTransactionRule>
): ImportTransactionRule {
  const result = getDb()
    .prepare(
      `INSERT INTO import_transaction_rules (provider, match_text, mapped_category, priority, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      data.provider ?? 'capital_one',
      data.match_text ?? '',
      data.mapped_category ?? 'Uncategorized',
      data.priority ?? 0,
      now()
    )
  return getImportTransactionRuleById(Number(result.lastInsertRowid))
}

export function updateImportTransactionRule(
  id: number,
  data: Partial<ImportTransactionRule>
): ImportTransactionRule {
  const existing = getImportTransactionRuleById(id)
  getDb()
    .prepare(
      `UPDATE import_transaction_rules
       SET provider = ?, match_text = ?, mapped_category = ?, priority = ?
       WHERE id = ?`
    )
    .run(
      data.provider ?? existing.provider,
      data.match_text ?? existing.match_text,
      data.mapped_category ?? existing.mapped_category,
      data.priority ?? existing.priority,
      id
    )
  return getImportTransactionRuleById(id)
}

export function deleteImportTransactionRule(id: number): void {
  getDb().prepare('DELETE FROM import_transaction_rules WHERE id = ?').run(id)
}

function getImportTransactionRuleById(id: number): ImportTransactionRule {
  const row = getDb().prepare('SELECT * FROM import_transaction_rules WHERE id = ?').get(id)
  if (!row) throw new Error(`Import transaction rule ${id} not found`)
  return rowToImportTransactionRule(row)
}

export function createCategoryRule(data: Partial<CategoryMappingRule>): CategoryMappingRule {
  const result = getDb()
    .prepare(
      'INSERT INTO category_mapping_rules (raw_category, description_contains, mapped_category, priority, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      data.raw_category ?? '',
      data.description_contains ?? '',
      data.mapped_category ?? 'Uncategorized',
      data.priority ?? 0,
      now()
    )
  return getCategoryRuleById(Number(result.lastInsertRowid))
}

export function updateCategoryRule(
  id: number,
  data: Partial<CategoryMappingRule>
): CategoryMappingRule {
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

  const exact = rules.find(
    (rule) => rule.raw_category.trim().toLowerCase() === raw && raw.length > 0
  )
  if (exact) return exact.mapped_category

  const fuzzy = rules.find((rule) => {
    const candidate = rule.raw_category.trim().toLowerCase()
    return (
      candidate.length > 0 && raw.length > 0 && (candidate.includes(raw) || raw.includes(candidate))
    )
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
