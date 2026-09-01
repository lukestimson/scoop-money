import type { IncomeEntry, Transaction } from '../types/money'

/** Maps fields that exist in both transaction and income records without changing their values. */
export function incomeDataFromPositiveTransaction(transaction: Transaction): Partial<IncomeEntry> {
  if (transaction.amount <= 0) {
    throw new Error('Only positive transactions can be moved to income.')
  }

  return {
    date: transaction.date,
    shoot_name: transaction.description,
    amount: transaction.amount,
    notes: transaction.notes
  }
}
