import type { Transaction } from '../../../types/money'

/**
 * Positive transactions are refunds, reimbursements, statement credits, or
 * offsets. Spend is therefore the signed total of all transaction amounts
 * reversed: negative outflows increase it and positive offsets reduce it.
 */
export function netSpendCents(transactions: Iterable<Pick<Transaction, 'amount'>>): number {
  let total = 0
  for (const transaction of transactions) total -= transaction.amount
  return total
}

export function netSpendByCategory(
  transactions: Iterable<Pick<Transaction, 'amount' | 'mapped_category'>>
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const transaction of transactions) {
    const category = transaction.mapped_category?.trim() || 'Uncategorized'
    totals.set(category, (totals.get(category) ?? 0) - transaction.amount)
  }
  return totals
}
