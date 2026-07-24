import type { BudgetItem, BudgetLineItem, BudgetSupportScope, BudgetType } from '../../../types/money'
import { BUDGET_CATEGORY_ORDER } from '../../../types/budgetCategories'

export const BUDGET_TYPE_KEY = 'scoop_money_budget_type'
export const BUDGET_PERIOD_KEY = 'scoop_money_budget_period'
export const BUDGET_CATEGORY_SORT_KEY = 'scoop_money_budget_category_sort'
export const BUDGET_CUSTOM_CATEGORY_ORDER_KEY = 'scoop_money_budget_category_order_v1'
export const BUDGET_AID_FILTERS_KEY = 'scoop_budget_aid_filters'
export const BUDGET_AID_FILTERS_CHANGED_EVENT = 'scoop_budget_aid_filters_changed'

export type BudgetDisplayPeriod = 'week' | 'month' | 'year'
export type BudgetAidFilter = Extract<BudgetSupportScope, 'parental' | 'government'>

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

export function loadStoredBudgetAidFilters(): Set<BudgetAidFilter> {
  try {
    const raw = localStorage.getItem(BUDGET_AID_FILTERS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is BudgetAidFilter => value === 'parental' || value === 'government'))
  } catch {
    return new Set()
  }
}

export function saveStoredBudgetAidFilters(filters: Set<BudgetAidFilter>): void {
  localStorage.setItem(BUDGET_AID_FILTERS_KEY, JSON.stringify([...filters]))
  window.dispatchEvent(new Event(BUDGET_AID_FILTERS_CHANGED_EVENT))
}

export function subscribeBudgetAidFilters(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === BUDGET_AID_FILTERS_KEY) listener()
  }
  window.addEventListener(BUDGET_AID_FILTERS_CHANGED_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(BUDGET_AID_FILTERS_CHANGED_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
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

export function isParentalGovBudgetLine(line: BudgetLineItem): boolean {
  return line.section === 'Parental & Gov Help'
}

export function lineMonthlyForAidFilters(line: BudgetLineItem, aidFilters: Set<string>): number {
  if (aidFilters.has('parental') && line.support_scope === 'parental') return 0
  if (aidFilters.has('government') && line.support_scope === 'government') return 0
  return line.monthly_amount
}

export function sumBudgetLinesForAidFilters(
  lines: BudgetLineItem[],
  aidFilters: Set<string>,
  predicate?: (line: BudgetLineItem) => boolean
): number {
  return lines.reduce((sum, line) => {
    if (isParentalGovBudgetLine(line)) return sum
    if (predicate && !predicate(line)) return sum
    return sum + lineMonthlyForAidFilters(line, aidFilters)
  }, 0)
}
