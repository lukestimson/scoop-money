import type { BudgetItem, BudgetType } from '../../../types/money'
import { BUDGET_CATEGORY_ORDER } from '../../../types/budgetCategories'

export const BUDGET_TYPE_KEY = 'scoop_money_budget_type'
export const BUDGET_PERIOD_KEY = 'scoop_money_budget_period'
export const BUDGET_CATEGORY_SORT_KEY = 'scoop_money_budget_category_sort'
export const BUDGET_CUSTOM_CATEGORY_ORDER_KEY = 'scoop_money_budget_category_order_v1'

export type BudgetDisplayPeriod = 'week' | 'month' | 'year'

/** How to order rows on the Budget categories table. */
export type BudgetCategorySortKey = 'custom' | 'amount_desc' | 'amount_asc' | 'name_asc'

export function getStoredBudgetType(): BudgetType {
  const value = localStorage.getItem(BUDGET_TYPE_KEY)
  return value === 'with_aid' || value === 'with_parents' ? value : 'standard'
}

export function getStoredBudgetPeriod(): BudgetDisplayPeriod {
  const value = localStorage.getItem(BUDGET_PERIOD_KEY)
  return value === 'week' || value === 'year' ? value : 'month'
}

export function getStoredBudgetCategorySort(): BudgetCategorySortKey {
  const value = localStorage.getItem(BUDGET_CATEGORY_SORT_KEY)
  if (value === 'amount_desc' || value === 'amount_asc' || value === 'name_asc') return value
  if (value === 'sheet') return 'custom'
  return 'custom'
}

/** Merge stored order with canonical list so new/custom categories are preserved. */
export function normalizeBudgetCategoryOrder(stored: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of stored) {
    if (seen.has(c) || !c.trim()) continue
    seen.add(c)
    out.push(c)
  }
  for (const c of BUDGET_CATEGORY_ORDER) {
    if (!seen.has(c)) out.push(c)
  }
  return out
}

export function loadStoredBudgetCategoryOrder(): string[] {
  try {
    const raw = localStorage.getItem(BUDGET_CUSTOM_CATEGORY_ORDER_KEY)
    if (!raw) return [...BUDGET_CATEGORY_ORDER]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...BUDGET_CATEGORY_ORDER]
    return normalizeBudgetCategoryOrder(parsed.map(String))
  } catch {
    return [...BUDGET_CATEGORY_ORDER]
  }
}

export function saveStoredBudgetCategoryOrder(order: string[]): void {
  localStorage.setItem(BUDGET_CUSTOM_CATEGORY_ORDER_KEY, JSON.stringify(normalizeBudgetCategoryOrder(order)))
}

/** Scale stored monthly cents to week (÷4, rounded), month (1×), or year (×12). */
export function scaleMonthlyAmountToPeriod(monthlyCents: number, period: BudgetDisplayPeriod): number {
  if (period === 'week') return Math.round(monthlyCents / 4)
  if (period === 'year') return monthlyCents * 12
  return monthlyCents
}

export function getBudgetAmount(item: BudgetItem, budgetType: BudgetType): number {
  if (budgetType === 'with_aid') return item.amount_with_aid
  if (budgetType === 'with_parents') return item.amount_with_parents
  return item.amount_standard
}
