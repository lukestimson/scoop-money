import { useEffect, useMemo, useState } from 'react'
import type { BudgetItem, BudgetLineItem, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { getStoredBudgetType, loadStoredBudgetAidFilters, subscribeBudgetAidFilters, type BudgetAidFilter } from '../lib/budget'
import { formatCurrency } from '../lib/currency'
import type { DisplayPeriod } from '../lib/dates'
import { computeSpendingBreakdown } from '../lib/spendingBreakdownMetrics'
import { BudgetAidIndicators } from './BudgetAidIndicators'

type BarTone = 'needs' | 'wants'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function percent(spent: number, budget: number): number {
  if (budget <= 0) return 0
  return Math.round((spent / budget) * 100)
}

function BreakdownBar({
  label,
  spent,
  budget,
  tone,
  scaleMaxPercent,
  aidFilters
}: {
  label: 'Needs' | 'Wants'
  spent: number
  budget: number
  tone: BarTone
  scaleMaxPercent: number
  aidFilters: Set<BudgetAidFilter>
}): React.JSX.Element {
  const pct = percent(spent, budget)
  const fillPct = clamp((pct / scaleMaxPercent) * 100, 0, 100)
  const budgetLinePct = clamp((100 / scaleMaxPercent) * 100, 0, 100)
  const over = pct > 100

  const trackClass =
    tone === 'needs'
      ? 'bg-emerald-100/80 dark:bg-emerald-950/30'
      : 'bg-violet-100/80 dark:bg-violet-950/30'
  const fillClass =
    tone === 'needs'
      ? over
        ? 'bg-rose-500/85'
        : 'bg-emerald-500/90'
      : over
        ? 'bg-rose-500/85'
        : 'bg-violet-500/90'

  return (
    <div className="group relative flex flex-1 flex-col items-center">
      <div className={`relative h-36 w-14 overflow-hidden rounded-md ${trackClass}`}>
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-md ${fillClass} transition-[height] duration-300`}
          style={{ height: `${fillPct}%` }}
        />

        <div
          className={`pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 text-center font-semibold tabular-nums ${
            fillPct >= 22
              ? 'bottom-2 text-[14px] text-white'
              : 'text-[14px] text-zinc-800 dark:text-zinc-100'
          }`}
          style={fillPct >= 22 ? undefined : { bottom: `calc(${fillPct}% + 6px)` }}
        >
          {pct}%
        </div>

        <div
          className="pointer-events-none absolute left-1 right-1 border-t border-dashed border-white/70 dark:border-zinc-100/70"
          style={{ bottom: `${budgetLinePct}%` }}
          aria-hidden
        />
      </div>

      <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-300">
        {label}
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 w-28 -translate-x-1/2 -translate-y-1/2 rounded-md border border-white/20 bg-white/45 px-2 py-1.5 text-[10px] text-zinc-900 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 dark:border-zinc-200/20 dark:bg-zinc-950/40 dark:text-zinc-100">
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-800 dark:text-zinc-200">
          {label}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-zinc-700/90 dark:text-zinc-300/90">
            Budget:
            <BudgetAidIndicators filters={aidFilters} />
          </span>
          <span className="font-medium tabular-nums">{formatCurrency(budget)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-zinc-700/90 dark:text-zinc-300/90">Spend:</span>
          <span className="font-medium tabular-nums">{formatCurrency(spent)}</span>
        </div>
      </div>
    </div>
  )
}

export function SpendingBreakdownWidget({
  period,
  start,
  end
}: {
  period: DisplayPeriod
  start: number
  end: number
}): React.JSX.Element {
  const { dataVersion } = useAppContext()
  const budgetType = getStoredBudgetType()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([])
  const [budgetLineItems, setBudgetLineItems] = useState<BudgetLineItem[]>([])
  const [aidFilters, setAidFilters] = useState<Set<BudgetAidFilter>>(() => loadStoredBudgetAidFilters())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.all([window.api.getTransactions(), window.api.getBudgetItems(budgetType), window.api.getBudgetLineItems()])
      .then(([nextTx, nextBudget, nextBudgetLines]) => {
        if (cancelled) return
        setTransactions(nextTx)
        setBudgetItems(nextBudget)
        setBudgetLineItems(nextBudgetLines)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [dataVersion, budgetType])

  useEffect(() => {
    return subscribeBudgetAidFilters(() => setAidFilters(loadStoredBudgetAidFilters()))
  }, [])

  const metrics = useMemo(
    () => computeSpendingBreakdown(transactions, budgetItems, budgetType, period, start, end, budgetLineItems, aidFilters),
    [transactions, budgetItems, budgetType, period, start, end, budgetLineItems, aidFilters]
  )

  const isOverBudget = metrics.needsUtilization > 100 || metrics.wantsUtilization > 100
  const scaleMaxPercent = Math.max(100, metrics.needsUtilization, metrics.wantsUtilization)
  const surfaceClass = isOverBudget
    ? 'rounded-[18px] bg-rose-50/65 dark:bg-rose-950/18'
    : 'rounded-[18px] bg-emerald-50/55 dark:bg-emerald-950/14'

  return (
    <div className={`flex h-full w-full flex-col p-3 ${surfaceClass}`} role="region" aria-label="Spending breakdown">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-200">
          Spending Breakdown
        </h2>
        <BudgetAidIndicators filters={aidFilters} />
      </div>

      {loading ? (
        <div className="flex flex-1 items-end justify-center gap-6 pb-3">
          <div className="h-36 w-14 animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800/70" />
          <div className="h-36 w-14 animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800/70" />
        </div>
      ) : (
        <div className="flex flex-1 items-end justify-center gap-6 pb-3">
          <BreakdownBar label="Needs" spent={metrics.needsSpent} budget={metrics.needsBudget} tone="needs" scaleMaxPercent={scaleMaxPercent} aidFilters={aidFilters} />
          <BreakdownBar label="Wants" spent={metrics.wantsSpent} budget={metrics.wantsBudget} tone="wants" scaleMaxPercent={scaleMaxPercent} aidFilters={aidFilters} />
        </div>
      )}
    </div>
  )
}
