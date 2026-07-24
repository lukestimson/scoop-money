import Papa from 'papaparse'
import type { ImportedFilePreview, ImportTransactionRule, Transaction } from '../types/money'
import { parseLocalDateToUnix } from '../types/dateParsing.ts'

export type RawRow = Record<string, unknown>
export type ParsedTransaction = Pick<
  Transaction,
  'date' | 'description' | 'amount' | 'raw_category' | 'notes'
>

export const DATE_KEYS = ['Date', 'Trans Date', 'Posted Date', 'Transaction Date']
export const DESCRIPTION_KEYS = ['Description', 'Merchant', 'Payee', 'Name']
export const AMOUNT_KEYS = ['Amount', 'Debit', 'Credit', 'Transaction Amount']
export const CATEGORY_KEYS = ['Category', 'Type', 'Transaction Type']

export interface NormalizeDeps {
  applyRules: (rawCategory: string, description: string) => string | null
  transactionExists: (date: number, description: string, amount: number) => boolean
  capitalOneImportRules: ImportTransactionRule[]
  /**
   * Unix seconds. When set, CSV rows dated on/after this instant are skipped because
   * Plaid now owns transactions from the cutover onward (no overlap window).
   * null/undefined is a no-op.
   */
  cutoverDate?: number | null
}

export interface NormalizedTransaction {
  date: number
  description: string
  amount: number
  raw_category: string
  mapped_category: string
  notes: string
  income_candidate: boolean
  external_id: string | null
}

export interface NormalizeResult {
  toCreate: NormalizedTransaction[]
  skipped: number
  errors: string[]
  parsedDates: number[]
}

export function normalizeRows(rows: RawRow[], deps: NormalizeDeps): NormalizeResult {
  const toCreate: NormalizedTransaction[] = []
  const errors: string[] = []
  const parsedDates: number[] = []
  const seenInFile = new Set<string>()
  let skipped = 0

  rows.forEach((row, index) => {
    try {
      const parsed = parseRow(row, deps.capitalOneImportRules)
      if (!parsed.date || !parsed.description) {
        skipped += 1
        return
      }
      if (deps.cutoverDate != null && parsed.date >= deps.cutoverDate) {
        skipped += 1
        return
      }
      parsedDates.push(parsed.date)
      const duplicateKey = importDuplicateKey(parsed)
      if (
        seenInFile.has(duplicateKey) ||
        deps.transactionExists(parsed.date, parsed.description, parsed.amount)
      ) {
        skipped += 1
        return
      }
      seenInFile.add(duplicateKey)
      const mapped =
        deps.applyRules(parsed.raw_category, parsed.description) ||
        parsed.raw_category ||
        'Uncategorized'
      const provider = pick(row, ['__provider'])
      const isIncomeCandidate =
        provider === 'venmo' && parsed.amount > 0 && isVenmoIncomeCandidate(parsed.description)
      toCreate.push({
        ...parsed,
        mapped_category: mapped,
        income_candidate: isIncomeCandidate,
        external_id: null
      })
    } catch (error) {
      errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  return { toCreate, skipped, errors, parsedDates }
}

export function importDuplicateKey(transaction: ParsedTransaction): string {
  return [
    transaction.date,
    transaction.amount,
    transaction.description
      .trim()
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  ].join('|')
}

export function buildPreview(rows: RawRow[]): ImportedFilePreview {
  const headers = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !key.startsWith('__'))))
  ).slice(0, 8)
  return {
    headers,
    rows: rows.slice(0, 6).map((row) => headers.map((header) => String(row[header] ?? '').slice(0, 80))),
    rowCount: rows.length,
    columnCount: headers.length
  }
}

export function parseRow(row: RawRow, capitalOneImportRules: ImportTransactionRule[]): ParsedTransaction {
  const provider = pick(row, ['__provider'])
  if (provider === 'venmo') return parseVenmoRow(row)
  if (provider === 'capital_one') return parseCapitalOneRow(row, capitalOneImportRules)

  const dateText = pick(row, DATE_KEYS)
  const description = pick(row, DESCRIPTION_KEYS).trim()
  const rawCategory = pick(row, CATEGORY_KEYS).trim()
  const amount = parseAmount(row)
  const date = parseDate(dateText)
  return { date, description, amount, raw_category: rawCategory, notes: '' }
}

export function pick(row: RawRow, keys: string[]): string {
  const normalized = new Map<string, unknown>()
  Object.entries(row).forEach(([key, value]) => normalized.set(key.trim().toLowerCase(), value))
  for (const key of keys) {
    const value = normalized.get(key.toLowerCase())
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value)
  }
  return ''
}

export function parseDate(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const localDate = parseLocalDateToUnix(trimmed)
  if (localDate !== null) return localDate
  const parsed = Date.parse(trimmed)
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000)

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30))
    return Math.floor((excelEpoch.getTime() + numeric * 86400000) / 1000)
  }
  throw new Error(`Could not parse date "${value}"`)
}

export function parseAmount(row: RawRow): number {
  const debit = pick(row, ['Debit'])
  const credit = pick(row, ['Credit'])
  if (debit) return -Math.abs(currencyToCents(debit))
  if (credit) return Math.abs(currencyToCents(credit))

  const raw = pick(row, AMOUNT_KEYS)
  return currencyToCents(raw)
}

export function isCapitalOneStatement(content: string): boolean {
  const firstLine = content.split(/\r?\n/, 1)[0]?.toLowerCase() ?? ''
  return (
    firstLine.includes('transaction date') &&
    firstLine.includes('posted date') &&
    firstLine.includes('card no.') &&
    firstLine.includes('debit') &&
    firstLine.includes('credit')
  )
}

export function readCapitalOneRows(content: string): RawRow[] {
  const parsed = Papa.parse<RawRow>(content, { header: true, skipEmptyLines: true })
  if (parsed.errors.length) {
    const first = parsed.errors[0]
    throw new Error(first.message)
  }
  return parsed.data.map((row) => ({ ...row, __provider: 'capital_one' }))
}

export function parseCapitalOneRow(
  row: RawRow,
  capitalOneImportRules: ImportTransactionRule[]
): ParsedTransaction {
  const dateText = pick(row, ['Transaction Date', 'Posted Date'])
  const description = pick(row, ['Description']).trim()
  const category = pick(row, ['Category']).trim()
  const debit = pick(row, ['Debit'])
  const credit = pick(row, ['Credit'])
  const card = pick(row, ['Card No.']).trim()

  if (!dateText || !description) return { date: 0, description: '', amount: 0, raw_category: '', notes: '' }
  if (isCapitalOnePayment(description, category)) return { date: 0, description: '', amount: 0, raw_category: '', notes: '' }

  const amount = debit ? -Math.abs(currencyToCents(debit)) : credit ? Math.abs(currencyToCents(credit)) : 0
  const rawCategory = mapCapitalOneCategory(category, description, capitalOneImportRules)
  return {
    date: parseDate(dateText),
    description,
    amount,
    raw_category: rawCategory,
    notes: `Capital One${card ? ` card ${card}` : ''}${category ? ` | Raw category: ${category}` : ''}`
  }
}

export function isCapitalOnePayment(description: string, category: string): boolean {
  const text = `${description} ${category}`.toLowerCase()
  return (
    category.toLowerCase() === 'payment/credit' &&
    /\b(autopay|payment|pymt|thank you|online payment)\b/.test(text)
  )
}

export function mapCapitalOneCategory(
  category: string,
  description: string,
  capitalOneImportRules: ImportTransactionRule[]
): string {
  const normalized = category.trim().toLowerCase()
  const text = `${description} ${category}`.toLowerCase()
  const importedRule = capitalOneImportRules.find((rule) => {
    const needle = rule.match_text.trim().toLowerCase()
    return needle.length > 0 && text.includes(needle)
  })
  if (importedRule) return importedRule.mapped_category

  if (normalized === 'dining') return 'Dining'
  if (normalized === 'coffee') return 'Coffee'
  if (normalized === 'bar/ alcohol') return 'Bar/ Alcohol'
  if (normalized === 'entertainment') return 'Entertainment'
  if (normalized === 'internet') {
    if (/\b(fandango|apple cinemas|movie)\b/.test(text)) return 'Entertainment'
    if (/\b(adobe|google one|apple.com|icloud|hostinger|subscription)\b/.test(text)) return 'Subscriptions'
    return 'Internet'
  }
  if (normalized === 'merchandise') {
    if (/\b(trader joe|staterbros|grocery|costco)\b/.test(text)) return 'Groceries'
    if (/\b(polk street market)\b/.test(text)) return 'Dining'
    return 'Shopping'
  }
  if (normalized === 'professional services' || normalized === 'other services') return 'Business Expenses'
  if (normalized === 'other travel' || normalized === 'car rental') return 'Transportation'
  if (normalized === 'gas/automotive') return 'Gas/Automotive'
  if (normalized === 'health care' || normalized === 'healthcare') return 'Healthcare'
  if (normalized === 'grocery') return 'Groceries'
  if (normalized === 'subscriptions') return 'Subscriptions'
  if (normalized === 'insurance') return 'Insurance'
  if (normalized === 'travel') return 'Travel'
  return category || 'Uncategorized'
}

export function isVenmoStatement(content: string): boolean {
  return (
    content.slice(0, 500).toLowerCase().includes('account statement') &&
    content.includes('Datetime,Type,Status,Note,From,To,Amount (total)')
  )
}

export function readVenmoRows(content: string): RawRow[] {
  const parsed = Papa.parse<string[]>(content, { header: false, skipEmptyLines: false })
  if (parsed.errors.length) {
    const first = parsed.errors[0]
    throw new Error(first.message)
  }

  const rows = parsed.data
  const headerIndex = rows.findIndex(
    (row) => row.some((cell) => cell.trim() === 'Datetime') && row.some((cell) => cell.trim() === 'Amount (total)')
  )
  if (headerIndex < 0) return []

  const header = rows[headerIndex]
  const indexes = new Map<string, number>()
  header.forEach((cell, index) => indexes.set(cell.trim().toLowerCase(), index))

  return rows.slice(headerIndex + 1).map((row) => ({
    __provider: 'venmo',
    ID: valueAt(row, indexes, 'id'),
    Datetime: valueAt(row, indexes, 'datetime'),
    Type: valueAt(row, indexes, 'type'),
    Status: valueAt(row, indexes, 'status'),
    Note: valueAt(row, indexes, 'note'),
    From: valueAt(row, indexes, 'from'),
    To: valueAt(row, indexes, 'to'),
    'Amount (total)': valueAt(row, indexes, 'amount (total)'),
    'Amount (fee)': valueAt(row, indexes, 'amount (fee)'),
    'Funding Source': valueAt(row, indexes, 'funding source'),
    Destination: valueAt(row, indexes, 'destination')
  }))
}

export function valueAt(row: string[], indexes: Map<string, number>, key: string): string {
  const index = indexes.get(key)
  return index === undefined ? '' : (row[index] ?? '')
}

export function parseVenmoRow(row: RawRow): ParsedTransaction {
  const id = pick(row, ['ID']).trim()
  const dateText = pick(row, ['Datetime'])
  const type = pick(row, ['Type']).trim()
  const status = pick(row, ['Status']).trim()
  const note = pick(row, ['Note']).trim()
  const from = pick(row, ['From']).trim()
  const to = pick(row, ['To']).trim()
  const amountText = pick(row, ['Amount (total)'])
  const funding = pick(row, ['Funding Source']).trim()
  const destination = pick(row, ['Destination']).trim()

  if (!id || !dateText || !amountText || status.toLowerCase() !== 'complete') {
    return { date: 0, description: '', amount: 0, raw_category: '', notes: '' }
  }

  const amount = currencyToCents(amountText)
  const counterparty = amount < 0 ? to : from
  const rawCategory = mapVenmoCategory(note)
  const direction = amount < 0 ? 'paid' : 'received'

  return {
    date: parseDate(dateText),
    description: note ? `${note}${counterparty ? ` (${counterparty})` : ''}` : `Venmo ${direction}${counterparty ? ` ${counterparty}` : ''}`,
    amount,
    raw_category: rawCategory,
    notes: [
      `Venmo ${type || 'transfer'} ${direction}`,
      from ? `From: ${from}` : '',
      to ? `To: ${to}` : '',
      funding ? `Funding source: ${funding}` : '',
      destination ? `Destination: ${destination}` : '',
      `Venmo ID: ${id}`
    ].filter(Boolean).join(' | ')
  }
}

export function mapVenmoCategory(note: string): string {
  const text = note.toLowerCase()

  // Rent — month names near housing keywords
  if (/\b(rent|april|may|june|july|august|september|october|november|december|january|february|march)\b/.test(text) && /🏠|rent|apartment|house|lease/.test(text)) return 'Rent'
  if (/\b(wifi|eero|mesh|internet|broadband)\b/.test(text)) return 'Internet'
  if (/\b(utility|utilities|electric|electricity|water bill|sewage|trash|pgne|pg&e)\b/.test(text)) return 'Utilities'
  if (/\b(insurance|geico|state farm|allstate|progressive)\b/.test(text)) return 'Insurance'
  if (/\b(doctor|medical|healthcare|health care|covered california|medi-cal|pharmacy|prescription|dental|dentist|therapy|therapist|copay)\b/.test(text)) return 'Healthcare'
  if (/\b(costco|grocery|groceries|grubs|plant|trader joe|safeway|whole foods|sprouts|aldi|walmart|target)\b/.test(text)) return 'Groceries'

  // Bar / Alcohol — drink emojis, bar/pub/brewery terms
  if (/🍺|🍻|🍷|🍸|🍹|🥂|🥃|🍾/.test(text)) return 'Bar/ Alcohol'
  if (/\b(bar|bars|pub|pubs|brewery|breweries|cocktail|cocktails|beer|beers|wine|wines|alcohol|drinks|liquor|club|nightclub|happy hour|margarita|tequila|whiskey|vodka|bourbon|sake|taproom|speakeasy)\b/.test(text)) return 'Bar/ Alcohol'

  // Dining — food-related words, restaurants, cafes
  if (/🍕|🍔|🌮|🍜|🍣|☕|🧋|🥪|🥗|🍱|🍳|🥘|🍝/.test(text)) return 'Dining'
  if (/\b(food|pizza|burger|burgers|sando|sandwich|sandwiches|chipotle|coffee|cafe|restaurant|brunch|dinner|lunch|snack|snacks|meal|meals|breakfast|taco|tacos|sushi|ramen|noodles|thai|chinese|indian|mexican|pho|boba|cookie|cookies|pastry|bakery|donut|donuts|diner|grubhub|doordash|uber eats|postmates|falafel|wings|bbq|barbecue|steak|salad|smoothie|juice|gelato|ice cream|dim sum|dumplings|bagel|croissant|pancakes|waffles|mj movie)\b/.test(text)) return 'Dining'

  // Shopping — stores, retail, apparel
  if (/\b(store|stores|clothes|clothing|apparel|retail|boards|board|shirt|shirts|shoes|flannel|pants|jacket|hat|hoodie|sweater|online|purchase|amazon|target|walmart|etsy|ebay|zara|h&m|uniqlo|nike|adidas|thrift|vintage|mall|outlet|merch|gear|gadget|accessory|accessories|👕|👟|🛒|🛍)\b/.test(text)) return 'Shopping'

  // Entertainment
  if (/\b(movie|movies|concert|concerts|show|shows|event|events|ticket|tickets|sports|games|game|theater|theatre|festival|rugby|olympic|comedy|museum|bowling|arcade|amusement|zoo|aquarium|exhibition|karaoke)\b/.test(text)) return 'Entertainment'

  if (/\b(car rental|rental car)\b/.test(text)) return 'Car Rental'
  if (/\b(gas|gasoline|automotive|tesla|oil change|car wash|mechanic|auto repair)\b/.test(text)) return 'Gas/Automotive'
  if (/\b(uber|lyft|clipper|parking|transit|bus|train|subway|metro|bart|caltrain|amtrak|taxi|cab|scooter|lime|bird)\b/.test(text)) return 'Transportation'
  if (/\b(flight|flights|hotel|hotels|airbnb|hostel|resort|vacation|road trip|travel|luggage|passport|cruise)\b/.test(text)) return 'Travel'
  if (/\b(subscription|spotify|netflix|hulu|disney|youtube|adobe|apple|icloud|patreon|membership|gym)\b/.test(text)) return 'Subscriptions'
  if (/\b(phone|tmobile|t-mobile|verizon|att|at&t|mint mobile|cell|cellular)\b/.test(text)) return 'Phone'
  if (/\b(photo|shoot|print|box|camera|film|editing|edit|studio|lens|tripod|lighting|backdrop|client|invoice)\b/.test(text)) return 'Business Expenses'

  return 'Uncategorized'
}

const VENMO_INCOME_KEYWORDS = /\b(photo|photography|editing|edit|photo class|class|teaching|lesson|lessons|tip|tips|shoot)\b/i

export function isVenmoIncomeCandidate(note: string): boolean {
  return VENMO_INCOME_KEYWORDS.test(note)
}

export function currencyToCents(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const negative = trimmed.startsWith('-') || (trimmed.startsWith('(') && trimmed.endsWith(')'))
  const cleaned = trimmed.replace(/[,$()]/g, '').replace(/[^0-9.-]/g, '')
  const number = Number(cleaned)
  if (!Number.isFinite(number)) throw new Error(`Could not parse amount "${value}"`)
  const cents = Math.round(Math.abs(number) * 100)
  return negative ? -cents : cents
}
