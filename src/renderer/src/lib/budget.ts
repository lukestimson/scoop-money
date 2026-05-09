import type { BudgetItem, BudgetType } from '../../../types/money'

export const BUDGET_TYPE_KEY = 'scoop_money_budget_type'

export function getStoredBudgetType(): BudgetType {
  const value = localStorage.getItem(BUDGET_TYPE_KEY)
  return value === 'with_aid' || value === 'with_parents' ? value : 'standard'
}

export function getBudgetAmount(item: BudgetItem, budgetType: BudgetType): number {
  if (budgetType === 'with_aid') return item.amount_with_aid
  if (budgetType === 'with_parents') return item.amount_with_parents
  return item.amount_standard
}
