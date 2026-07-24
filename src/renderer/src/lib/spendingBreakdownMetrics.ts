import type { BudgetItem, BudgetLineItem, BudgetType, Transaction } from '../../../types/money'
import { inferLineIsNeed } from '../../../types/budgetNeedRules'
import { getBudgetAmount, isParentalGovBudgetLine, lineMonthlyForAidFilters, scaleMonthlyAmountToPeriod } from './budget'
import type { DisplayPeriod } from './dates'
import { netSpendCents } from './spending'

export interface SpendingBreakdownMetrics {
  needsSpent: number
  wantsSpent: number
  needsBudget: number
  wantsBudget: number
  needsUtilization: number
  wantsUtilization: number
}

function buildCategoryNeedMap(items: BudgetItem[]): Map<string, boolean> {
  const map = new Map<string, boolean>()
  for (const item of items) {
    map.set(item.category, item.is_need)
  }
  return map
}

function isNeedCategory(category: string, map: Map<string, boolean>): boolean {
  const key = category.trim() || 'Uncategorized'
  if (map.has(key)) return map.get(key) === true
  return inferLineIsNeed(key, '')
}

/** Sum net spend in period, split by need vs want using budget category flags. */
export function computeSpendingBreakdown(
  transactions: Transaction[],
  budgetItems: BudgetItem[],
  budgetType: BudgetType,
  period: DisplayPeriod,
  start: number,
  end: number,
  budgetLineItems?: BudgetLineItem[],
  aidFilters: Set<string> = new Set()
): SpendingBreakdownMetrics {
  const categoryNeed = buildCategoryNeedMap(budgetItems)
  let needsSpent = 0
  let wantsSpent = 0

  for (const tx of transactions) {
    if (tx.date < start || tx.date > end || tx.amount === 0) continue
    const spend = netSpendCents([tx])
    const cat = tx.mapped_category?.trim() || 'Uncategorized'
    if (isNeedCategory(cat, categoryNeed)) needsSpent += spend
    else wantsSpent += spend
  }

  let needsBudgetMonthly = 0
  let wantsBudgetMonthly = 0
  if (budgetLineItems) {
    for (const line of budgetLineItems) {
      if (isParentalGovBudgetLine(line)) continue
      const amt = lineMonthlyForAidFilters(line, aidFilters)
      if (line.is_need) needsBudgetMonthly += amt
      else wantsBudgetMonthly += amt
    }
  } else {
    for (const item of budgetItems) {
      const amt = getBudgetAmount(item, budgetType)
      if (item.is_need) needsBudgetMonthly += amt
      else wantsBudgetMonthly += amt
    }
  }

  const needsBudget = scaleMonthlyAmountToPeriod(needsBudgetMonthly, period)
  const wantsBudget = scaleMonthlyAmountToPeriod(wantsBudgetMonthly, period)

  return {
    needsSpent,
    wantsSpent,
    needsBudget,
    wantsBudget,
    needsUtilization: needsBudget > 0 ? Math.round((needsSpent / needsBudget) * 100) : 0,
    wantsUtilization: wantsBudget > 0 ? Math.round((wantsSpent / wantsBudget) * 100) : 0
  }
}
