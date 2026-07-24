import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeRows,
  parseDate,
  readCapitalOneRows,
  readVenmoRows,
  type NormalizeDeps,
  type NormalizedTransaction,
  type RawRow
} from './importerCore.ts'

const FIXTURES = join(import.meta.dirname, '__fixtures__')

// Deterministic dependencies: isolate the hardcoded default-mapping behavior.
// - applyRules always returns null so mapped_category falls back to raw_category.
// - transactionExists always false so nothing is skipped as a DB duplicate.
// - no import rules so mapCapitalOneCategory uses only its built-in defaults.
const STUB_DEPS: NormalizeDeps = {
  applyRules: () => null,
  transactionExists: () => false,
  capitalOneImportRules: []
}

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

// Golden snapshot: assert deep-equality against a committed expectation file,
// generating it on first run if missing. This is the byte-identical lock.
function assertSnapshot(name: string, actual: NormalizedTransaction[]): void {
  const path = join(FIXTURES, name)
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(actual, null, 2) + '\n', 'utf8')
    throw new Error(`Snapshot ${name} did not exist; wrote it. Inspect and re-run.`)
  }
  const expected = JSON.parse(readFileSync(path, 'utf8')) as NormalizedTransaction[]
  assert.deepEqual(actual, expected)
}

function findByDescriptionIncludes(
  rows: NormalizedTransaction[],
  needle: string
): NormalizedTransaction | undefined {
  return rows.find((row) => row.description.includes(needle))
}

test('Capital One golden snapshot is stable', () => {
  const rows = readCapitalOneRows(readFixture('capitalone-june-2026.csv'))
  const { toCreate } = normalizeRows(rows, STUB_DEPS)
  assertSnapshot('capitalone-june-2026.expected.json', toCreate)
})

test('Venmo golden snapshot is stable', () => {
  const rows = readVenmoRows(readFixture('venmo-june-2026.csv'))
  const { toCreate } = normalizeRows(rows, STUB_DEPS)
  assertSnapshot('venmo-june-2026.expected.json', toCreate)
})

test('Capital One default category mapping (documents current behavior)', () => {
  const rows = readCapitalOneRows(readFixture('capitalone-june-2026.csv'))
  const { toCreate, skipped } = normalizeRows(rows, STUB_DEPS)

  // ADOBE (raw "Merchandise") maps to Shopping.
  const adobe = findByDescriptionIncludes(toCreate, 'ADOBE *ADOBE')
  assert.equal(adobe?.mapped_category, 'Shopping')

  // OPENAI ChatGPT (raw "Merchandise") maps to Shopping — currently NOT Subscriptions.
  const openai = findByDescriptionIncludes(toCreate, 'OPENAI *CHATGPT SUBSCR')
  assert.equal(openai?.mapped_category, 'Shopping')

  // TST*TOSCANO BROTHERS has raw category "Other" -> passthrough "Other".
  const toscano = findByDescriptionIncludes(toCreate, 'TST*TOSCANO BROTHERS')
  assert.equal(toscano?.mapped_category, 'Other')

  // BAYWHEE (raw "Other Travel") maps to Transportation.
  const baywheel = findByDescriptionIncludes(toCreate, 'BAYWHEE')
  assert.equal(baywheel?.mapped_category, 'Transportation')

  // CAPITAL ONE AUTOPAY PYMT rows are dropped (payment/credit).
  assert.equal(
    toCreate.some((row) => row.description.includes('AUTOPAY')),
    false
  )
  // 5 autopay rows in the fixture were skipped.
  assert.ok(skipped >= 5)
})

test('Venmo notes drive categorization and income-candidate flag', () => {
  const rows = readVenmoRows(readFixture('venmo-june-2026.csv'))
  const { toCreate } = normalizeRows(rows, STUB_DEPS)

  // 🍕 payment (negative) -> Dining, and NOT an income candidate (outflow).
  const pizza = toCreate.find((row) => row.description.startsWith('🍕') && row.amount < 0)
  assert.equal(pizza?.mapped_category, 'Dining')
  assert.equal(pizza?.income_candidate, false)

  // "Photo shoot" (+$750) is an income candidate.
  const photoShoot = findByDescriptionIncludes(toCreate, 'Photo shoot')
  assert.equal(photoShoot?.amount, 75000)
  assert.equal(photoShoot?.income_candidate, true)

  // "Film ⛽" (+$33) is NOT an income candidate (no income keyword matches).
  const film = findByDescriptionIncludes(toCreate, 'Film ⛽')
  assert.equal(film?.amount, 3300)
  assert.equal(film?.income_candidate, false)

  // external_id is always null for CSV imports.
  assert.ok(toCreate.every((row) => row.external_id === null))
})

test('Venmo non-Complete rows are dropped', () => {
  const pendingRow: RawRow = {
    __provider: 'venmo',
    ID: '9999999999999999999',
    Datetime: '2026-06-15T10:00:00',
    Type: 'Payment',
    Status: 'Pending',
    Note: 'Coffee ☕',
    From: 'Pat Johnson',
    To: 'Alex Rivera',
    'Amount (total)': '- $5.00',
    'Funding Source': 'Venmo balance'
  }
  const { toCreate, skipped } = normalizeRows([pendingRow], STUB_DEPS)
  assert.equal(toCreate.length, 0)
  assert.equal(skipped, 1)
})

test('cutoverDate skips rows on/after the cutover and keeps earlier rows', () => {
  const rows: RawRow[] = [
    { Date: '2026-06-01', Description: 'Before cutover', Amount: '-10.00', Category: 'Shopping' },
    { Date: '2026-06-15', Description: 'On cutover', Amount: '-20.00', Category: 'Shopping' },
    { Date: '2026-06-30', Description: 'After cutover', Amount: '-30.00', Category: 'Shopping' }
  ]
  const cutoverDate = parseDate('2026-06-15')
  const { toCreate, skipped } = normalizeRows(rows, { ...STUB_DEPS, cutoverDate })

  // >= cutover (06-15 and 06-30) are skipped; only 06-01 survives.
  assert.equal(toCreate.length, 1)
  assert.equal(toCreate[0].description, 'Before cutover')
  assert.equal(skipped, 2)
})

test('cutoverDate null/undefined is a no-op (identical to no cutover)', () => {
  const capitalOneRows = readCapitalOneRows(readFixture('capitalone-june-2026.csv'))
  const baseline = normalizeRows(capitalOneRows, STUB_DEPS)

  const withNull = normalizeRows(capitalOneRows, { ...STUB_DEPS, cutoverDate: null })
  const withUndefined = normalizeRows(capitalOneRows, { ...STUB_DEPS, cutoverDate: undefined })

  assert.deepEqual(withNull.toCreate, baseline.toCreate)
  assert.equal(withNull.skipped, baseline.skipped)
  assert.deepEqual(withUndefined.toCreate, baseline.toCreate)
  assert.equal(withUndefined.skipped, baseline.skipped)
})

test('normalizeRows dedupes identical rows within one batch', () => {
  const row: RawRow = {
    Date: '2026-06-10',
    Description: 'Corner Store',
    Amount: '-12.34',
    Category: 'Shopping'
  }
  const { toCreate, skipped } = normalizeRows([{ ...row }, { ...row }], STUB_DEPS)
  assert.equal(toCreate.length, 1)
  assert.equal(skipped, 1)
})
