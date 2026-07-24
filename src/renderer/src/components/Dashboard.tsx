import { useState, useRef, useEffect, useMemo, ReactNode } from 'react'
import { getDisplayPeriodBounds, stepDisplayAnchor, formatDisplayAnchor, DisplayPeriod } from '../lib/dates'
import { IncomeEntry, Transaction, BudgetLineItem } from '../../../types/money'
import { resolveIncomeTypeColorHex, subscribeIncomeTypeColors } from '../lib/incomeTypeColors'
import { useAppContext } from '../context/AppContext'
import { formatCurrency } from '../lib/currency'
import { netSpendByCategory, netSpendCents } from '../lib/spending'
import { SpendingBreakdownWidget } from './SpendingBreakdownWidget'
import { AssetsWidget } from './AssetsWidget'
import { BudgetAidIndicators } from './BudgetAidIndicators'
import {
  loadStoredBudgetAidFilters,
  scaleMonthlyAmountToPeriod,
  subscribeBudgetAidFilters,
  sumBudgetLinesForAidFilters,
  type BudgetAidFilter
} from '../lib/budget'

const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  Coffee: '#a16207',
  Dining: '#dc2626',
  Shopping: '#db2777',
  Transportation: '#2563eb',
  'Business Expenses': '#0891b2',
  Entertainment: '#7c3aed',
  Groceries: '#16a34a',
  Subscriptions: '#9333ea',
  'Bar/ Alcohol': '#ea580c',
  'AI Fees': '#4f46e5',
  Internet: '#0284c7',
  Insurance: '#0f766e',
  'Gas/Automotive': '#ca8a04',
  'Other Services': '#64748b',
  Rent: '#059669',
  Utilities: '#0d9488',
  Travel: '#f59e0b',
  Uncategorized: '#71717a'
}

function resolveExpenseCategoryColorHex(category: string): string {
  const normalized = category.trim() || 'Uncategorized'
  const known = EXPENSE_CATEGORY_COLORS[normalized]
  if (known) return known

  const palette = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#14b8a6',
    '#0ea5e9',
    '#6366f1',
    '#8b5cf6',
    '#d946ef',
    '#f43f5e'
  ]
  let hash = 0
  for (const char of normalized) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]
}

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
      {children}
    </button>
  )
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'up' ? <path d="m5 12 5-5 5 5" /> : <path d="m5 8 5 5 5-5" />}
    </svg>
  )
}

function formatCurrencyNoCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(cents / 100)
}

function SummaryMetric({
  label,
  value,
  tone = 'default'
}: {
  label: string
  value: string
  tone?: 'default' | 'positive' | 'negative'
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div
        className={`mt-2 text-xl font-semibold tracking-tight tabular-nums ${
          tone === 'positive'
            ? 'text-emerald-700 dark:text-emerald-400'
            : tone === 'negative'
              ? 'text-rose-700 dark:text-rose-400'
              : 'text-zinc-900 dark:text-zinc-100'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function SummaryWidget({ entries, transactions, start, end }: { entries: IncomeEntry[]; transactions: Transaction[]; start: number; end: number }): React.JSX.Element {
  const incomeTotal = useMemo(
    () => entries.filter((entry) => entry.date >= start && entry.date <= end).reduce((sum, entry) => sum + entry.amount, 0),
    [entries, start, end]
  )
  const spendTotal = useMemo(
    () => netSpendCents(transactions.filter((tx) => tx.date >= start && tx.date <= end)),
    [transactions, start, end]
  )
  const transactionCount = useMemo(
    () => transactions.filter((tx) => tx.date >= start && tx.date <= end).length,
    [transactions, start, end]
  )
  const incomeCount = useMemo(
    () => entries.filter((entry) => entry.date >= start && entry.date <= end).length,
    [entries, start, end]
  )
  const net = incomeTotal - spendTotal

  return (
    <div className="flex h-full w-full flex-col">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-200">Summary</h2>
      <div className="grid flex-1 grid-cols-2 gap-3">
        <SummaryMetric label="Spend" value={formatCurrency(spendTotal)} tone={spendTotal > 0 ? 'negative' : 'default'} />
        <SummaryMetric label="Income" value={formatCurrencyNoCents(incomeTotal)} tone={incomeTotal > 0 ? 'positive' : 'default'} />
        <SummaryMetric label="Net" value={formatCurrencyNoCents(net)} tone={net >= 0 ? 'positive' : 'negative'} />
        <SummaryMetric label="Entries" value={`${incomeCount} income · ${transactionCount} tx`} />
      </div>
    </div>
  )
}

function IncomeSourcesWidget({ entries }: { entries: IncomeEntry[] }) {
  const [, setColorVersion] = useState(0)
  const sourceTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const entry of entries) {
      const t = entry.income_type?.trim() || 'Unknown'
      totals.set(t, (totals.get(t) || 0) + entry.amount)
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1])
  }, [entries])

  useEffect(() => subscribeIncomeTypeColors(() => setColorVersion((value) => value + 1)), [])

  const totalIncome = sourceTotals.reduce((sum, [, total]) => sum + total, 0)
  const chartHeightPx = 156

  return (
    <div className="flex h-full w-full flex-col rounded-[20px] bg-[#1c1c1e] p-6 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-white">Income Source</h2>
      <div className="flex min-h-[156px] flex-1 items-end justify-between gap-4 pb-2">
        {sourceTotals.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">No income this period</div>
        ) : (
          sourceTotals.map(([source, total]) => {
            const fraction = totalIncome > 0 ? total / totalIncome : 0
            const heightPx = total > 0 ? Math.max(10, Math.round(fraction * chartHeightPx)) : 0
            const colorHex = resolveIncomeTypeColorHex(source)
            return (
              <div key={source} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <div className="text-sm font-bold text-white">{formatCurrencyNoCents(total)}</div>
                <div
                  className="w-full max-w-[40px] rounded-sm"
                  style={{
                    backgroundColor: colorHex,
                    height: `${heightPx}px`
                  }}
                />
                <div className="mt-1 line-clamp-2 text-center text-[11px] font-medium leading-tight text-white">
                  {source}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function ExpenseTypesWidget({ transactions, start, end }: { transactions: Transaction[]; start: number; end: number }) {
  const categoryTotals = useMemo(() => {
    return Array.from(
      netSpendByCategory(transactions.filter((tx) => tx.date >= start && tx.date <= end)).entries()
    )
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  }, [transactions, start, end])

  const totalSpend = categoryTotals.reduce((sum, [, total]) => sum + total, 0)
  const chartHeightPx = 156

  return (
    <div className="flex h-full w-full flex-col rounded-[20px] bg-[#1c1c1e] p-6 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-white">Expense Type</h2>
      <div className="flex min-h-[156px] flex-1 items-end justify-between gap-4 pb-2">
        {categoryTotals.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">No expenses this period</div>
        ) : (
          categoryTotals.map(([category, total]) => {
            const fraction = totalSpend > 0 ? total / totalSpend : 0
            const heightPx = total > 0 ? Math.max(10, Math.round(fraction * chartHeightPx)) : 0
            const colorHex = resolveExpenseCategoryColorHex(category)
            return (
              <div key={category} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <div className="text-sm font-bold text-white">{formatCurrencyNoCents(total)}</div>
                <div
                  className="w-full max-w-[40px] rounded-sm"
                  style={{
                    backgroundColor: colorHex,
                    height: `${heightPx}px`
                  }}
                />
                <div className="mt-1 line-clamp-2 text-center text-[11px] font-medium leading-tight text-white">
                  {category}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function RecentTransactionsWidget({ transactions, start, end }: { transactions: Transaction[]; start: number; end: number }) {
  const periodTx = useMemo(() => {
    return transactions
      .filter((tx) => tx.date >= start && tx.date <= end)
      .sort((a, b) => b.date - a.date)
      .slice(0, 4)
  }, [transactions, start, end])

  return (
    <div className="flex h-full w-full flex-col justify-between">
      <div className="flex-1">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-sky-800 dark:text-sky-300">
          Recent Transactions
        </h2>
        <div className="mt-3 space-y-2">
          {periodTx.length === 0 ? (
            <div className="text-xs text-sky-600/70 dark:text-sky-400/50 py-4 text-center">No transactions in this period</div>
          ) : (
            periodTx.map((tx) => {
              const formattedDate = new Date(tx.date * 1000).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
              })
              const isExpense = tx.amount < 0
              const amountText = isExpense
                ? `-$${Math.abs(tx.amount / 100).toFixed(2)}`
                : `+$${(tx.amount / 100).toFixed(2)}`

              return (
                <div key={tx.id} className="flex items-center justify-between gap-2 border-b border-sky-100/30 pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-sky-900 dark:text-sky-100">
                      {tx.description || 'Untitled'}
                    </div>
                    <div className="text-[10px] text-sky-700/80 dark:text-sky-400/80 flex items-center gap-1">
                      <span>{formattedDate}</span>
                      {tx.mapped_category && (
                        <>
                          <span>•</span>
                          <span className="truncate">{tx.mapped_category}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className={`text-xs font-bold tabular-nums shrink-0 ${isExpense ? 'text-sky-900 dark:text-sky-100' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {amountText}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function BudgetProgressWidget({
  transactions,
  budgetLineItems,
  aidFilters,
  start,
  end,
  period
}: {
  transactions: Transaction[]
  budgetLineItems: BudgetLineItem[]
  aidFilters: Set<BudgetAidFilter>
  start: number
  end: number
  period: DisplayPeriod
}) {
  const monthlyBudget = useMemo(() => {
    return sumBudgetLinesForAidFilters(budgetLineItems, aidFilters)
  }, [aidFilters, budgetLineItems])

  const periodBudget = useMemo(() => {
    return scaleMonthlyAmountToPeriod(monthlyBudget, period)
  }, [monthlyBudget, period])

  const periodSpend = useMemo(() => {
    return netSpendCents(transactions.filter((tx) => tx.date >= start && tx.date <= end))
  }, [transactions, start, end])

  const percent = periodBudget > 0 ? Math.round((periodSpend / periodBudget) * 100) : 0
  const isOver = periodSpend > periodBudget

  const spentStr = formatCurrencyNoCents(periodSpend)
  const budgetStr = formatCurrencyNoCents(periodBudget)

  return (
    <div className="flex h-full w-full flex-col justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-violet-800 dark:text-violet-300">
            Budget Progress
          </h2>
          <BudgetAidIndicators filters={aidFilters} />
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-2xl font-bold tracking-tight text-violet-900 dark:text-violet-100">
              {percent}%
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-700/80 dark:text-violet-400/80">
              {spentStr} of {budgetStr}
              <BudgetAidIndicators filters={aidFilters} />
            </span>
          </div>

          <div className="h-2 w-full rounded-full bg-violet-200/50 dark:bg-violet-900/30 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                isOver ? 'bg-red-500' : 'bg-violet-600 dark:bg-violet-400'
              }`}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 text-[10px] font-medium text-violet-700/70 dark:text-violet-400/70 leading-normal">
        {isOver ? (
          <span className="text-red-600 dark:text-red-400 font-semibold">
            Over budget by {formatCurrencyNoCents(periodSpend - periodBudget)}
          </span>
        ) : periodBudget > 0 ? (
          <span>
            {formatCurrencyNoCents(periodBudget - periodSpend)} remaining for this {period}
          </span>
        ) : (
          <span>No budget set for this period</span>
        )}
      </div>
    </div>
  )
}


const WIDGET_TYPES = [
  { id: 'summary', label: 'Summary', color: 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-400' },
  { id: 'net-worth', label: 'Net Worth', color: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' },
  { id: 'spending-pie', label: 'Spending Breakdown', color: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400' },
  { id: 'recent-tx', label: 'Recent Transactions', color: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400' },
  { id: 'budget-progress', label: 'Budget Progress', color: 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400' },
  { id: 'income-sources', label: 'Income Sources', color: 'bg-transparent border-none p-0' },
  { id: 'expense-types', label: 'Expense Type', color: 'bg-transparent border-none p-0' }
]

const LAYOUT_KEY = 'scoop_dashboard_layout'

function getInitialLayout() {
  const defaultLayout = WIDGET_TYPES.map(w => w.id)
  try {
    const saved = localStorage.getItem(LAYOUT_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        const savedIds = parsed.filter((value): value is string => typeof value === 'string')
        const known = new Set(WIDGET_TYPES.map((widget) => widget.id))
        const deduped = savedIds.filter((id, index) => known.has(id) && savedIds.indexOf(id) === index)
        const missing = defaultLayout.filter((id) => !deduped.includes(id))
        return [...missing, ...deduped]
      }
    }
  } catch { /* ignore */ }
  return defaultLayout
}

export function Dashboard() {
  const { dataVersion, anchor, setAnchor, period, setPeriod } = useAppContext()
  const [layout, setLayout] = useState<string[]>(getInitialLayout)
  const dragItemRef = useRef<number | null>(null)
  const dragOverItemRef = useRef<number | null>(null)
  
  const [entries, setEntries] = useState<IncomeEntry[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgetLineItems, setBudgetLineItems] = useState<BudgetLineItem[]>([])
  const [aidFilters, setAidFilters] = useState<Set<BudgetAidFilter>>(() => loadStoredBudgetAidFilters())

  useEffect(() => {
    Promise.all([
      window.api.getIncomeEntries(),
      window.api.getTransactions(),
      window.api.getBudgetLineItems()
    ]).then(([nextEntries, nextTransactions, nextBudgetLines]) => {
      setEntries(nextEntries)
      setTransactions(nextTransactions)
      setBudgetLineItems(nextBudgetLines)
    })
  }, [dataVersion])

  useEffect(() => {
    return subscribeBudgetAidFilters(() => setAidFilters(loadStoredBudgetAidFilters()))
  }, [])

  const { start, end } = getDisplayPeriodBounds(anchor, period)
  const periodEntries = useMemo(() => entries.filter(e => e.date >= start && e.date <= end), [entries, start, end])
  const incomeSourceCount = useMemo(() => {
    const unique = new Set<string>()
    for (const entry of periodEntries) unique.add(entry.income_type?.trim() || 'Unknown')
    return unique.size
  }, [periodEntries])

  const handleSort = () => {
    if (dragItemRef.current === null || dragOverItemRef.current === null) return
    const _layout = [...layout]
    const draggedItem = _layout[dragItemRef.current]
    _layout.splice(dragItemRef.current, 1)
    _layout.splice(dragOverItemRef.current, 0, draggedItem)
    setLayout(_layout)
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(_layout))
    dragItemRef.current = null
    dragOverItemRef.current = null
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-8 bg-white dark:bg-zinc-950">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Modular financial overview. Drag to reorder widgets.</p>
        </div>
        
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-full border border-zinc-200 bg-white text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <button type="button" onClick={() => setAnchor((value) => stepDisplayAnchor(value, period, -1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Previous">
                <span className="inline-block -rotate-90"><ChevronIcon direction="up" /></span>
              </button>
              <div className="min-w-[120px] text-center text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{formatDisplayAnchor(anchor, period)}</div>
              <button type="button" onClick={() => setAnchor((value) => stepDisplayAnchor(value, period, 1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Next">
                <span className="inline-block rotate-90"><ChevronIcon direction="up" /></span>
              </button>
            </div>
            <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Dashboard period">
              <SegmentedButton active={period === 'week'} onClick={() => setPeriod('week')}>Week</SegmentedButton>
              <SegmentedButton active={period === 'month'} onClick={() => setPeriod('month')}>Month</SegmentedButton>
              <SegmentedButton active={period === 'year'} onClick={() => setPeriod('year')}>Year</SegmentedButton>
            </div>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {layout.map((id, index) => {
          const widget = WIDGET_TYPES.find(w => w.id === id)
          if (!widget) return null
          
          return (
            <div
              key={id}
              draggable
              onDragStart={() => (dragItemRef.current = index)}
              onDragEnter={() => (dragOverItemRef.current = index)}
              onDragEnd={handleSort}
              onDragOver={(e) => e.preventDefault()}
              className={`cursor-grab active:cursor-grabbing rounded-[20px] transition-transform hover:scale-[1.01] ${
                id === 'summary'
                  ? 'min-h-[220px] border border-zinc-200 dark:border-zinc-800 p-4 shadow-sm md:col-span-2'
                  : 
                id === 'income-sources'
                  ? `min-h-[220px] ${incomeSourceCount > 4 ? 'md:col-span-2' : ''}`
                  : id === 'expense-types'
                    ? 'min-h-[220px] md:col-span-2 lg:col-span-3'
                  : id === 'spending-pie'
                    ? 'min-h-[220px] border border-zinc-200 dark:border-zinc-800 p-0 shadow-sm'
                  : id === 'net-worth'
                    ? `min-h-[220px] border border-zinc-200 dark:border-zinc-800 p-4 shadow-sm ${widget.color} md:col-span-2`
                    : `min-h-[220px] border border-zinc-200 dark:border-zinc-800 p-4 shadow-sm ${widget.color}`
              }`}
            >
              {id === 'summary' ? (
                <SummaryWidget entries={entries} transactions={transactions} start={start} end={end} />
              ) : id === 'income-sources' ? (
                <IncomeSourcesWidget entries={periodEntries} />
              ) : id === 'expense-types' ? (
                <ExpenseTypesWidget transactions={transactions} start={start} end={end} />
              ) : id === 'net-worth' ? (
                <AssetsWidget globalPeriod={period} globalStart={start} globalEnd={end} />
              ) : id === 'spending-pie' ? (
                <SpendingBreakdownWidget period={period} start={start} end={end} />
              ) : id === 'recent-tx' ? (
                <RecentTransactionsWidget transactions={transactions} start={start} end={end} />
              ) : id === 'budget-progress' ? (
                <BudgetProgressWidget transactions={transactions} budgetLineItems={budgetLineItems} aidFilters={aidFilters} start={start} end={end} period={period} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <span className="text-sm font-semibold uppercase tracking-wider">{widget.label}</span>
                  <span className="text-xs opacity-80">(Placeholder)</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
