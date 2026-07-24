import { useEffect, useMemo, useState } from 'react'
import type { BudgetDisplayPeriod } from '../lib/budget'
import { getStoredBudgetType, loadStoredBudgetAidFilters, subscribeBudgetAidFilters, type BudgetAidFilter } from '../lib/budget'
import { formatCurrency } from '../lib/currency'
import type { BudgetItem, BudgetLineItem, ExpectedIncomeEntry, IncomeTaxSettings, LivingExpensesSettings } from '../../../types/money'
import { Budget } from './Budget'
import { IncomeExpected } from './Income'
import { useAppContext } from '../context/AppContext'
import { DisplayPeriod, formatDisplayAnchor, stepDisplayAnchor } from '../lib/dates'
import { computeLivingExpensesMetrics } from '../lib/livingExpensesMetrics'
import { BudgetAidIndicators } from './BudgetAidIndicators'

function PeriodSlider({
  period,
  onChange
}: {
  period: BudgetDisplayPeriod
  onChange: (period: BudgetDisplayPeriod) => void
}) {
  return (
    <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Living expenses period">
      <button type="button" onClick={() => onChange('week')} className={`rounded-full px-3 py-1.5 text-xs font-medium ${period === 'week' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>Week</button>
      <button type="button" onClick={() => onChange('month')} className={`rounded-full px-3 py-1.5 text-xs font-medium ${period === 'month' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>Month</button>
      <button type="button" onClick={() => onChange('year')} className={`rounded-full px-3 py-1.5 text-xs font-medium ${period === 'year' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>Year</button>
    </div>
  )
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'up' ? <path d="m5 12 5-5 5 5" /> : <path d="m5 8 5 5 5-5" />}
    </svg>
  )
}

function SummaryMetric({ label, value, chip, aidFilters }: { label: string; value: string; chip?: string; aidFilters?: Set<BudgetAidFilter> }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{label}</div>
        <div className="flex items-center gap-1.5">
          {aidFilters ? <BudgetAidIndicators filters={aidFilters} /> : null}
          {chip ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{chip}</span> : null}
        </div>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  )
}

export function LivingExpenses() {
  const { dataVersion, anchor, setAnchor, period, setPeriod } = useAppContext()
  const [incomeEntries, setIncomeEntries] = useState<ExpectedIncomeEntry[]>([])
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([])
  const [budgetLineItems, setBudgetLineItems] = useState<BudgetLineItem[]>([])
  const [taxSettings, setTaxSettings] = useState<IncomeTaxSettings | null>(null)
  const [livingSettings, setLivingSettings] = useState<LivingExpensesSettings | null>(null)
  const [aidFilters, setAidFilters] = useState<Set<BudgetAidFilter>>(() => loadStoredBudgetAidFilters())
  const budgetType = getStoredBudgetType()

  useEffect(() => {
    Promise.all([
      window.api.getExpectedIncomeEntries(),
      window.api.getIncomeTaxSettings(),
      window.api.getBudgetItems(budgetType),
      window.api.getBudgetLineItems(),
      window.api.getLivingExpensesSettings()
    ]).then(([expected, tax, budget, lines, settings]) => {
        setIncomeEntries(expected)
        setTaxSettings(tax)
        setBudgetItems(budget)
        setBudgetLineItems(lines)
        setLivingSettings(settings)
      }
    )
  }, [dataVersion, budgetType])

  useEffect(() => {
    return subscribeBudgetAidFilters(() => setAidFilters(loadStoredBudgetAidFilters()))
  }, [])

  const displayPeriod: DisplayPeriod = period

  const metrics = useMemo(
    () =>
      computeLivingExpensesMetrics({
        entries: incomeEntries,
        taxSettings,
        budgetItems,
        budgetLineItems,
        aidFilters,
        budgetType,
        period,
        livingSettings
      }),
    [incomeEntries, taxSettings, budgetItems, budgetLineItems, aidFilters, budgetType, period, livingSettings]
  )

  return (
    <div className="h-full overflow-y-auto bg-zinc-50 dark:bg-zinc-950">
      <div className="px-6 pb-28 pt-6 md:px-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Living Expenses</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Unified view of income, taxes, budget spending targets, and leftover cash flow across each period.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <PeriodSlider period={period} onChange={setPeriod} />
            <div className="flex items-center rounded-full border border-zinc-200 bg-white text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <button type="button" onClick={() => setAnchor((value) => stepDisplayAnchor(value, displayPeriod, -1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Previous">
                <span className="inline-block -rotate-90"><ChevronIcon direction="up" /></span>
              </button>
              <div className="min-w-[120px] text-center text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{formatDisplayAnchor(anchor, displayPeriod)}</div>
              <button type="button" onClick={() => setAnchor((value) => stepDisplayAnchor(value, displayPeriod, 1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Next">
                <span className="inline-block rotate-90"><ChevronIcon direction="up" /></span>
              </button>
            </div>
          </div>
        </div>

        <section className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SummaryMetric label="Gross Income" value={formatCurrency(metrics.grossForPeriod)} chip={period} />
          <SummaryMetric label="After Tax" value={formatCurrency(metrics.afterTaxForPeriod)} chip="net" />
          <SummaryMetric label="Budget Use" value={`${metrics.budgetUtilizationPct}%`} chip="of net" aidFilters={aidFilters} />
          <SummaryMetric label="Allowance" value={formatCurrency(metrics.allowanceForPeriod)} chip="left over" aidFilters={aidFilters} />
          <SummaryMetric label="6 Mo Reserve" value={formatCurrency(metrics.reserveSixMonths)} chip="target" aidFilters={aidFilters} />
          <SummaryMetric label="Income:Rent" value={`${metrics.incomeRentRatio.toFixed(2)}x`} chip="monthly" aidFilters={aidFilters} />
        </section>

        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <IncomeExpected period={period} showTitle={false} embedded />
          <Budget period={period} onPeriodChange={setPeriod} onAidFiltersChange={setAidFilters} embedded />
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-zinc-200 bg-white/95 px-6 py-3 backdrop-blur md:px-8 dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-5 text-sm">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">After Budget</div>
              <div className="flex items-center gap-1.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatCurrency(metrics.afterBudgetForPeriod)}<BudgetAidIndicators filters={aidFilters} /></div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Allowance</div>
              <div className="flex items-center gap-1.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatCurrency(metrics.allowanceForPeriod)}<BudgetAidIndicators filters={aidFilters} /></div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Reserve Progress</div>
              <div className="flex items-center gap-1.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{metrics.reserveProgressPct}%<BudgetAidIndicators filters={aidFilters} /></div>
            </div>
          </div>
          <PeriodSlider period={period} onChange={setPeriod} />
        </div>
      </div>
    </div>
  )
}
