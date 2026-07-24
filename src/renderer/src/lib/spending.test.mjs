import assert from 'node:assert/strict'
import test from 'node:test'
import { netSpendByCategory, netSpendCents } from './spending.ts'

test('net spend counts refunds and reimbursements as offsets', () => {
  const transactions = [
    { amount: -264796, mapped_category: 'Mixed' },
    { amount: 20699, mapped_category: 'Mixed' }
  ]

  assert.equal(netSpendCents(transactions), 244097)
  assert.equal(netSpendByCategory(transactions).get('Mixed'), 244097)
})

test('net spend retains offsets in their original category', () => {
  const transactions = [
    { amount: -5000, mapped_category: 'Business Expenses' },
    { amount: 1240, mapped_category: 'Business Expenses' },
    { amount: -2500, mapped_category: 'Dining' }
  ]

  const totals = netSpendByCategory(transactions)
  assert.equal(totals.get('Business Expenses'), 3760)
  assert.equal(totals.get('Dining'), 2500)
  assert.equal(netSpendCents(transactions), 6260)
})
