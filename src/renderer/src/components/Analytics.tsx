import { useEffect, useMemo, useState, ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { addDays, addMonths, addWeeks, endOfDay, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns'
import type { BudgetLineItem, IncomeEntry, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { useChat } from '../context/ChatContext'
import { formatCurrency } from '../lib/currency'
import { netSpendCents } from '../lib/spending'
import { getDisplayPeriodBounds, stepDisplayAnchor, formatDisplayAnchor } from '../lib/dates'
import {
  loadStoredBudgetAidFilters,
  scaleMonthlyAmountToPeriod,
  subscribeBudgetAidFilters,
  sumBudgetLinesForAidFilters,
  type BudgetAidFilter
} from '../lib/budget'
import { BudgetAidIndicators } from './BudgetAidIndicators'
import { ChatBox } from './ChatBox'

const CHART_UNIT_KEY = 'scoop_money_income_spend_chart_unit'

type ChartUnit = 'day' | 'week' | 'month'
type ChartPoint = {
  label: string
  start: number
  end: number
  spend: number
  income: number
  spendCents: number
  incomeCents: number
}

const CHART_UNITS: ReadonlyArray<{ id: ChartUnit; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' }
]

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

function getChartRangeBounds(anchor: Date, unit: ChartUnit): { start: Date; end: Date; bucket: ChartUnit } {
  if (unit === 'day') return { start: startOfMonth(anchor), end: endOfMonth(anchor), bucket: 'day' }
  if (unit === 'week') return { start: startOfWeek(subWeeks(anchor, 25), { weekStartsOn: 1 }), end: endOfWeek(anchor, { weekStartsOn: 1 }), bucket: 'week' }
  return { start: startOfMonth(subMonths(anchor, 11)), end: endOfMonth(anchor), bucket: 'month' }
}

function buildIncomeSpendChartData(
  transactions: Transaction[],
  income: IncomeEntry[],
  anchor: Date,
  unit: ChartUnit
): ChartPoint[] {
  const { start, end, bucket } = getChartRangeBounds(anchor, unit)
  const points: ChartPoint[] = []
  let cursor = start

  while (cursor <= end) {
    const bucketEnd = bucket === 'day' ? endOfDay(cursor) : bucket === 'week' ? endOfWeek(cursor, { weekStartsOn: 1 }) : endOfMonth(cursor)
    const bucketStartUnix = Math.floor(cursor.getTime() / 1000)
    const bucketEndUnix = Math.floor(Math.min(bucketEnd.getTime(), end.getTime()) / 1000)
    const inBucket = (date: number) => date >= bucketStartUnix && date <= bucketEndUnix
    const spendCents = netSpendCents(transactions.filter((transaction) => inBucket(transaction.date)))
    const incomeCents = income
      .filter((entry) => inBucket(entry.date))
      .reduce((total, entry) => total + entry.amount, 0)
    const label =
      bucket === 'day'
        ? format(cursor, 'd')
        : bucket === 'week'
          ? format(cursor, 'MMM d')
          : format(cursor, 'MMM yy')

    points.push({
      label,
      start: bucketStartUnix,
      end: bucketEndUnix,
      spend: spendCents / 100,
      income: incomeCents / 100,
      spendCents,
      incomeCents
    })
    cursor = bucket === 'day' ? addDays(cursor, 1) : bucket === 'week' ? addWeeks(cursor, 1) : addMonths(cursor, 1)
  }

  return points
}

export function Analytics() {
  const { dataVersion, anchor, setAnchor, period, setPeriod } = useAppContext()
  const { getChat } = useChat()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgetLineItems, setBudgetLineItems] = useState<BudgetLineItem[]>([])
  const [income, setIncome] = useState<IncomeEntry[]>([])
  const [aidFilters, setAidFilters] = useState<Set<BudgetAidFilter>>(() => loadStoredBudgetAidFilters())
  const [chatExpanded, setChatExpanded] = useState(false)
  const [chartUnit, setChartUnit] = useState<ChartUnit>(() => {
    const stored = localStorage.getItem(CHART_UNIT_KEY)
    return stored === 'day' || stored === 'week' || stored === 'month' ? stored : 'week'
  })

  useEffect(() => {
    Promise.all([
      window.api.getTransactions(),
      window.api.getBudgetLineItems(),
      window.api.getIncomeEntries()
    ]).then(([nextTransactions, nextBudgetLines, nextIncome]) => {
      setTransactions(nextTransactions)
      setBudgetLineItems(nextBudgetLines)
      setIncome(nextIncome)
    })
  }, [dataVersion])

  useEffect(() => {
    return subscribeBudgetAidFilters(() => setAidFilters(loadStoredBudgetAidFilters()))
  }, [])

  useEffect(() => localStorage.setItem(CHART_UNIT_KEY, chartUnit), [chartUnit])

  const { start, end } = getDisplayPeriodBounds(anchor, period)
  const periodSpent = useMemo(() => {
    return netSpendCents(
      transactions.filter((tx) => tx.amount !== 0 && tx.date >= start && tx.date <= end)
    )
  }, [transactions, start, end])

  const periodIncome = useMemo(() => {
    return income
      .filter((entry) => entry.date >= start && entry.date <= end)
      .reduce((sum, entry) => sum + entry.amount, 0)
  }, [income, start, end])

  const monthlyBudget = useMemo(() => {
    return sumBudgetLinesForAidFilters(budgetLineItems, aidFilters)
  }, [aidFilters, budgetLineItems])

  const periodBudget = useMemo(() => {
    return scaleMonthlyAmountToPeriod(monthlyBudget, period)
  }, [monthlyBudget, period])

  const chartData = useMemo(
    () => buildIncomeSpendChartData(transactions, income, anchor, chartUnit),
    [anchor, chartUnit, income, transactions]
  )
  const chat = getChat('dashboard')
  const fadeHeight = chatExpanded ? Math.min(chat.height + 128, 680) : 96

  return (
    <div className="relative h-full overflow-hidden bg-white dark:bg-zinc-950">
      <div className="h-full overflow-y-auto px-8 py-8 pb-28">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Analytics</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Spending, budget, income, and net for the selected period.</p>
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
              <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Analytics period">
                <SegmentedButton active={period === 'week'} onClick={() => setPeriod('week')}>Week</SegmentedButton>
                <SegmentedButton active={period === 'month'} onClick={() => setPeriod('month')}>Month</SegmentedButton>
                <SegmentedButton active={period === 'year'} onClick={() => setPeriod('year')}>Year</SegmentedButton>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-3">
          <StatCard label={`Spent this ${period}`} value={formatCurrency(periodSpent)} />
          <StatCard label={`Budget this ${period}`} value={formatCurrency(periodBudget)} aidFilters={aidFilters} />
          <StatCard label={`Income this ${period}`} value={formatCurrency(periodIncome)} accent="text-emerald-600" />
          <StatCard label="Net" value={formatCurrency(periodIncome - periodSpent)} accent={periodIncome - periodSpent >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        </div>

        <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Income vs. spend</h2>
              <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
                {chartUnit === 'day'
                  ? 'One bar pair per day for the selected month.'
                  : chartUnit === 'week'
                    ? 'One bar pair per week across the last six months.'
                    : 'One bar pair per month across the last twelve months.'}
              </p>
            </div>
            <div className="flex rounded-full bg-zinc-100 p-1 text-[12px] dark:bg-zinc-800" role="group" aria-label="Chart time unit">
              {CHART_UNITS.map((unit) => (
                <SegmentedButton key={unit.id} active={chartUnit === unit.id} onClick={() => setChartUnit(unit.id)}>
                  {unit.label}
                </SegmentedButton>
              ))}
            </div>
          </div>
          <div className="mb-4 flex items-center gap-4 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Income</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />Spend</span>
          </div>
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: 12, right: 20, top: 8, bottom: 0 }} barGap={5} barCategoryGap="22%">
                <CartesianGrid stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} interval={chartUnit === 'day' ? 'preserveStartEnd' : 0} minTickGap={12} />
                <YAxis tickFormatter={(value) => `$${value.toLocaleString()}`} tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} width={58} />
                <Tooltip content={(props) => <IncomeSpendTooltip {...props} />} cursor={{ fill: 'rgba(113, 113, 122, 0.08)' }} />
                <Bar dataKey="income" name="Income" fill="#10b981" radius={[5, 5, 0, 0]} maxBarSize={42} />
                <Bar dataKey="spend" name="Spend" fill="#f43f5e" radius={[5, 5, 0, 0]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
      <div className="pointer-events-none absolute inset-x-8 bottom-4 z-20">
        <div
          aria-hidden="true"
          style={{ height: fadeHeight }}
          className="absolute inset-x-0 bottom-0 -z-10 bg-gradient-to-t from-white via-white/95 to-transparent transition-[height] duration-200 dark:from-zinc-950 dark:via-zinc-950/95"
        />
        <div className="pointer-events-auto">
          <ChatBox pageId="dashboard" fullWidth onExpandedChange={setChatExpanded} />
        </div>
      </div>
    </div>
  )
}

function IncomeSpendTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null

  const point = payload.find((item) => item.payload)?.payload as ChartPoint | undefined
  if (!point) return null
  const netCents = point.incomeCents - point.spendCents

  return (
    <div className="min-w-44 rounded-xl border border-zinc-200 bg-white/95 px-3 py-2.5 text-[12px] shadow-lg shadow-zinc-900/10 backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95 dark:shadow-black/25">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-800 dark:text-zinc-200">{label}</div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300"><span className="h-2 w-2 rounded-sm bg-emerald-500" />Income</span>
          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(point.incomeCents)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300"><span className="h-2 w-2 rounded-sm bg-rose-500" />Spend</span>
          <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatCurrency(point.spendCents)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-zinc-100 pt-1.5 dark:border-zinc-700">
          <span className="text-zinc-600 dark:text-zinc-300">Net</span>
          <span className={`font-semibold tabular-nums ${netCents >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatCurrency(netCents)}</span>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, accent = 'text-zinc-900 dark:text-zinc-100', aidFilters }: { label: string; value: string; accent?: string; aidFilters?: Set<BudgetAidFilter> }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
        {label}
        {aidFilters ? <BudgetAidIndicators filters={aidFilters} /> : null}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
    </div>
  )
}
