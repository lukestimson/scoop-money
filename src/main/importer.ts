import { extname } from 'path'
import { readFileSync } from 'fs'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { ImportResult, Transaction } from '../types/money'
import {
  applyRulesToCategory,
  createTransaction,
  transactionExists
} from './database'

type RawRow = Record<string, unknown>

const DATE_KEYS = ['Date', 'Trans Date', 'Posted Date', 'Transaction Date']
const DESCRIPTION_KEYS = ['Description', 'Merchant', 'Payee', 'Name']
const AMOUNT_KEYS = ['Amount', 'Debit', 'Credit', 'Transaction Amount']
const CATEGORY_KEYS = ['Category', 'Type', 'Transaction Type']

export async function importTransactionsFromFile(filePath: string, accountId: number): Promise<ImportResult> {
  const rows = readRows(filePath)
  const transactions: Transaction[] = []
  const errors: string[] = []
  let skipped = 0

  rows.forEach((row, index) => {
    try {
      const parsed = parseRow(row)
      if (!parsed.date || !parsed.description) {
        skipped += 1
        return
      }
      if (transactionExists(parsed.date, parsed.description, parsed.amount)) {
        skipped += 1
        return
      }
      const mapped = applyRulesToCategory(parsed.raw_category, parsed.description) || parsed.raw_category || 'Uncategorized'
      const transaction = createTransaction({
        ...parsed,
        account_id: accountId,
        mapped_category: mapped,
        source: 'csv_import'
      })
      transactions.push(transaction)
    } catch (error) {
      errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  return { imported: transactions.length, skipped, errors, transactions }
}

function readRows(filePath: string): RawRow[] {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.csv') {
    const content = readFileSync(filePath, 'utf8')
    const parsed = Papa.parse<RawRow>(content, { header: true, skipEmptyLines: true })
    if (parsed.errors.length) {
      const first = parsed.errors[0]
      throw new Error(first.message)
    }
    return parsed.data
  }
  if (extension === '.xlsx' || extension === '.xls') {
    const workbook = XLSX.readFile(filePath)
    const firstSheet = workbook.SheetNames[0]
    if (!firstSheet) return []
    return XLSX.utils.sheet_to_json<RawRow>(workbook.Sheets[firstSheet], { defval: '' })
  }
  throw new Error('Only CSV and Excel files are supported')
}

function parseRow(row: RawRow): Pick<Transaction, 'date' | 'description' | 'amount' | 'raw_category'> {
  const dateText = pick(row, DATE_KEYS)
  const description = pick(row, DESCRIPTION_KEYS).trim()
  const rawCategory = pick(row, CATEGORY_KEYS).trim()
  const amount = parseAmount(row)
  const date = parseDate(dateText)
  return { date, description, amount, raw_category: rawCategory }
}

function pick(row: RawRow, keys: string[]): string {
  const normalized = new Map<string, unknown>()
  Object.entries(row).forEach(([key, value]) => normalized.set(key.trim().toLowerCase(), value))
  for (const key of keys) {
    const value = normalized.get(key.toLowerCase())
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value)
  }
  return ''
}

function parseDate(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const parsed = Date.parse(trimmed)
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000)

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30))
    return Math.floor((excelEpoch.getTime() + numeric * 86400000) / 1000)
  }
  throw new Error(`Could not parse date "${value}"`)
}

function parseAmount(row: RawRow): number {
  const debit = pick(row, ['Debit'])
  const credit = pick(row, ['Credit'])
  if (debit) return Math.abs(currencyToCents(debit))
  if (credit) return -Math.abs(currencyToCents(credit))

  const raw = pick(row, AMOUNT_KEYS)
  return currencyToCents(raw)
}

function currencyToCents(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const negative = trimmed.startsWith('-') || (trimmed.startsWith('(') && trimmed.endsWith(')'))
  const cleaned = trimmed.replace(/[,$()]/g, '').replace(/[^0-9.-]/g, '')
  const number = Number(cleaned)
  if (!Number.isFinite(number)) throw new Error(`Could not parse amount "${value}"`)
  const cents = Math.round(Math.abs(number) * 100)
  return negative ? -cents : cents
}
