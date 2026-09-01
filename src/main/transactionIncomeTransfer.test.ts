import assert from 'node:assert/strict'
import test from 'node:test'
import type { Transaction } from '../types/money'
import { incomeDataFromPositiveTransaction } from './transactionIncomeTransfer.ts'

const positiveTransaction: Transaction = {
  id: 7,
  date: 1_788_345_600,
  description: 'Portrait session deposit',
  amount: 25000,
  raw_category: 'Transfer',
  mapped_category: 'Income',
  account_id: 3,
  source: 'manual',
  notes: 'Paid via Zelle',
  income_candidate: true,
  external_id: null,
  created_at: 1_788_345_600,
  updated_at: 1_788_345_600
}

test('maps a positive transaction to income without changing shared values', () => {
  assert.deepEqual(incomeDataFromPositiveTransaction(positiveTransaction), {
    date: 1_788_345_600,
    shoot_name: 'Portrait session deposit',
    company: '',
    amount: 25000,
    notes: 'Paid via Zelle'
  })
})

test('moves a trailing parenthesized person name into the income name field', () => {
  assert.deepEqual(
    incomeDataFromPositiveTransaction({
      ...positiveTransaction,
      description: 'bartending tip 🎁 (Greg Sherrell)'
    }),
    {
      date: 1_788_345_600,
      shoot_name: 'bartending tip 🎁',
      company: 'Greg Sherrell',
      amount: 25000,
      notes: 'Paid via Zelle'
    }
  )
})

test('moves a positive transaction to income as a tip', () => {
  assert.deepEqual(
    incomeDataFromPositiveTransaction(
      { ...positiveTransaction, description: 'bartending (Greg Sherrell)' },
      { isTip: true }
    ),
    {
      date: 1_788_345_600,
      shoot_name: 'bartending tip',
      company: 'Greg Sherrell',
      amount: 25000,
      tip: 25000,
      notes: 'Paid via Zelle'
    }
  )
})

test('does not duplicate tip in a tip income subject', () => {
  assert.deepEqual(
    incomeDataFromPositiveTransaction(
      { ...positiveTransaction, description: 'bartending tip (Greg Sherrell)' },
      { isTip: true }
    ),
    {
      date: 1_788_345_600,
      shoot_name: 'bartending tip',
      company: 'Greg Sherrell',
      amount: 25000,
      tip: 25000,
      notes: 'Paid via Zelle'
    }
  )
})

test('ignores trailing parentheses when the content does not look like a person name', () => {
  assert.deepEqual(
    incomeDataFromPositiveTransaction({
      ...positiveTransaction,
      description: 'bartending tip 🎁 (sent at 11:30 PM)'
    }),
    {
      date: 1_788_345_600,
      shoot_name: 'bartending tip 🎁 (sent at 11:30 PM)',
      company: '',
      amount: 25000,
      notes: 'Paid via Zelle'
    }
  )
})

test('ignores non-trailing or malformed parentheses', () => {
  assert.deepEqual(
    incomeDataFromPositiveTransaction({
      ...positiveTransaction,
      description: 'bartending tip 🎁 (Greg Sherrell) extra'
    }),
    {
      date: 1_788_345_600,
      shoot_name: 'bartending tip 🎁 (Greg Sherrell) extra',
      company: '',
      amount: 25000,
      notes: 'Paid via Zelle'
    }
  )
})

test('rejects zero and negative transactions', () => {
  assert.throws(() => incomeDataFromPositiveTransaction({ ...positiveTransaction, amount: 0 }), /positive transactions/)
  assert.throws(() => incomeDataFromPositiveTransaction({ ...positiveTransaction, amount: -25000 }), /positive transactions/)
})
