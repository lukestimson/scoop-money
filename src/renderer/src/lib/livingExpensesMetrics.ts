import type {
  BudgetItem,
  BudgetLineItem,
  BudgetType,
  ExpectedIncomeEntry,
  IncomeTaxSettings,
  LivingExpensesSettings
} from '../../../types/money'
import type { DisplayPeriod } from './dates'
import { getBudgetAmount, isParentalGovBudgetLine, lineMonthlyForAidFilters, scaleMonthlyAmountToPeriod } from './budget'
import { calculateIncomeTaxes, type IncomeTaxResult } from './income'

type NeedWantTotals = {
  needsMonthly: number
  wantsMonthly: number
  totalMonthly: number
}

export interface LivingExpensesMetrics {
  tax: IncomeTaxResult | null
  grossAnnual: number
  afterTaxAnnual: number
  taxAnnual: number
  grossForPeriod: number
  taxForPeriod: number
  afterTaxForPeriod: number
  needsForPeriod: number
  wantsForPeriod: number
  needsMonthly: number
  wantsMonthly: number
  budgetForPeriod: number
  allowanceForPeriod: number
  afterBudgetForPeriod: number
  reserveSixMonths: number
  reserveProgressPct: number
  budgetUtilizationPct: number
  incomeRentRatio: number
  variants: Record<BudgetType, NeedWantTotals>
}

function summarizeNeedsWants(items: BudgetItem[], budgetType: BudgetType): NeedWantTotals {
  const needsMonthly = items.filter((item) => item.is_need).reduce((sum, item) => sum + getBudgetAmount(item, budgetType), 0)
  const wantsMonthly = items.filter((item) => !item.is_need).reduce((sum, item) => sum + getBudgetAmount(item, budgetType), 0)
  return { needsMonthly, wantsMonthly, totalMonthly: needsMonthly + wantsMonthly }
}

function summarizeLineNeedsWants(lines: BudgetLineItem[], aidFilters: Set<string>): NeedWantTotals {
  let needsMonthly = 0
  let wantsMonthly = 0
  for (const line of lines) {
    if (isParentalGovBudgetLine(line)) continue
    const amount = lineMonthlyForAidFilters(line, aidFilters)
    if (line.is_need) needsMonthly += amount
    else wantsMonthly += amount
  }
  return { needsMonthly, wantsMonthly, totalMonthly: needsMonthly + wantsMonthly }
}

export function computeLivingExpensesMetrics({
  entries,
  taxSettings,
  budgetItems,
  budgetLineItems,
  aidFilters = new Set(),
  budgetType,
  period,
  livingSettings
}: {
  entries: ExpectedIncomeEntry[]
  taxSettings: IncomeTaxSettings | null
  budgetItems: BudgetItem[]
  budgetLineItems?: BudgetLineItem[]
  aidFilters?: Set<string>
  budgetType: BudgetType
  period: DisplayPeriod
  livingSettings?: LivingExpensesSettings | null
}): LivingExpensesMetrics {
  const tax = taxSettings ? calculateIncomeTaxes(entries, taxSettings) : null
  const grossAnnual = tax?.grossIncome ?? 0
  const afterTaxAnnual = tax?.afterTaxIncome ?? 0
  const taxAnnual = tax?.totalTaxes ?? 0
  const afterTaxMonthly = Math.round(afterTaxAnnual / 12)

  const variants: Record<BudgetType, NeedWantTotals> = {
    standard: summarizeNeedsWants(budgetItems, 'standard'),
    with_aid: summarizeNeedsWants(budgetItems, 'with_aid'),
    with_parents: summarizeNeedsWants(budgetItems, 'with_parents')
  }
  const active = budgetLineItems ? summarizeLineNeedsWants(budgetLineItems, aidFilters) : variants[budgetType]

  const grossMonthly = Math.round(grossAnnual / 12)
  const taxMonthly = Math.round(taxAnnual / 12)
  const allowanceMonthly = afterTaxMonthly - active.totalMonthly
  const reserveMonths = livingSettings?.reserve_target_months ?? 6
  const reserveTarget = active.totalMonthly * reserveMonths
  const budgetUtilizationPct = afterTaxMonthly > 0 ? Math.max(0, Math.round((active.totalMonthly / afterTaxMonthly) * 100)) : 0
  const reserveProgressPct =
    reserveTarget > 0 ? Math.max(0, Math.min(100, Math.round((Math.max(0, allowanceMonthly) / reserveTarget) * 100))) : 0
  const rentMonthly = budgetLineItems
    ? budgetLineItems
      .filter((line) => line.category === 'Rent' && !isParentalGovBudgetLine(line))
      .reduce((sum, line) => sum + lineMonthlyForAidFilters(line, aidFilters), 0)
    : budgetItems
      .filter((item) => item.category === 'Rent')
      .reduce((sum, item) => sum + getBudgetAmount(item, budgetType), 0)
  const incomeRentRatio = rentMonthly > 0 ? grossMonthly / rentMonthly : 0

  // Reuse existing period scaler to keep all page surfaces in sync.
  const grossForPeriod = scaleMonthlyAmountToPeriod(grossMonthly, period)
  const taxForPeriod = scaleMonthlyAmountToPeriod(taxMonthly, period)
  const afterTaxForPeriod = scaleMonthlyAmountToPeriod(afterTaxMonthly, period)
  const needsForPeriod = scaleMonthlyAmountToPeriod(active.needsMonthly, period)
  const wantsForPeriod = scaleMonthlyAmountToPeriod(active.wantsMonthly, period)
  const budgetForPeriod = scaleMonthlyAmountToPeriod(active.totalMonthly, period)
  const allowanceForPeriod = scaleMonthlyAmountToPeriod(allowanceMonthly, period)

  return {
    tax,
    grossAnnual,
    afterTaxAnnual,
    taxAnnual,
    grossForPeriod,
    taxForPeriod,
    afterTaxForPeriod,
    needsForPeriod,
    wantsForPeriod,
    needsMonthly: active.needsMonthly,
    wantsMonthly: active.wantsMonthly,
    budgetForPeriod,
    allowanceForPeriod,
    afterBudgetForPeriod: allowanceForPeriod,
    reserveSixMonths: reserveTarget,
    reserveProgressPct,
    budgetUtilizationPct,
    incomeRentRatio,
    variants
  }
}
