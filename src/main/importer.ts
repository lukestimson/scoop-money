import { basename, extname } from 'path'
import { readFileSync, statSync } from 'fs'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { ImportResult, Transaction } from '../types/money'
import {
  createTransaction,
  getAllAccounts,
  getOrCreateAccountByName,
  getImportTransactionRules,
  recordImportedFile,
  transactionExists,
  applyRulesToCategory
} from './database'
import {
  buildPreview,
  isCapitalOneStatement,
  isVenmoStatement,
  normalizeRows,
  readCapitalOneRows,
  readVenmoRows,
  type RawRow
} from './importerCore'

function detectAccountId(filePath: string): number | null {
  const fileName = basename(filePath).toLowerCase()
  const content = readFileSync(filePath, 'utf8')
  if (fileName.includes('venmo') || isVenmoStatement(content)) {
    return getOrCreateAccountByName('Venmo', 'venmo').id
  }
  if (fileName.includes('transaction_download') || isCapitalOneStatement(content)) {
    return getOrCreateAccountByName('Capital One', 'capital_one').id
  }
  if (fileName.includes('chase')) {
    return getOrCreateAccountByName('Chase', 'chase').id
  }
  if (fileName.includes('ebt')) {
    return getOrCreateAccountByName('EBT', 'ebt').id
  }
  return null
}

export async function importTransactionsFromFile(filePath: string, accountId: number): Promise<ImportResult> {
  const rows = readRows(filePath)
  const resolvedAccountId = detectAccountId(filePath) ?? accountId

  // If the resolved account has a Plaid cutover, skip CSV rows Plaid now owns (on/after the cutover).
  const cutoverDate =
    getAllAccounts().find((account) => account.id === resolvedAccountId)?.plaid_cutover_date ?? null

  const { toCreate, skipped, errors, parsedDates } = normalizeRows(rows, {
    applyRules: applyRulesToCategory,
    transactionExists,
    capitalOneImportRules: getImportTransactionRules('capital_one'),
    cutoverDate
  })

  const transactions: Transaction[] = toCreate.map((record) =>
    createTransaction({
      date: record.date,
      description: record.description,
      amount: record.amount,
      raw_category: record.raw_category,
      mapped_category: record.mapped_category,
      notes: record.notes,
      income_candidate: record.income_candidate,
      account_id: resolvedAccountId,
      source: 'csv_import'
    })
  )

  const importedDates = transactions.map((transaction) => transaction.date)
  const dates = importedDates.length > 0 ? importedDates : parsedDates
  recordImportedFile({
    file_name: basename(filePath),
    file_path: filePath,
    file_size: fileSize(filePath),
    file_type: extname(filePath).replace('.', '').toUpperCase() || 'FILE',
    account_id: resolvedAccountId,
    imported_count: transactions.length,
    skipped_count: skipped,
    error_count: errors.length,
    first_transaction_date: dates.length > 0 ? Math.min(...dates) : null,
    last_transaction_date: dates.length > 0 ? Math.max(...dates) : null,
    preview: buildPreview(rows)
  })

  return { imported: transactions.length, skipped, errors, transactions }
}

function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}

function readRows(filePath: string): RawRow[] {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.csv') {
    const content = readFileSync(filePath, 'utf8')
    if (isVenmoStatement(content)) return readVenmoRows(content)
    if (isCapitalOneStatement(content)) return readCapitalOneRows(content)
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
