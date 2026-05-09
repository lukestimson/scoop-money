import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { BudgetItem, IncomeEntry, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { formatCurrency } from '../lib/currency'
import { groupTransactionsByPeriod, monthBounds, type PeriodUnit } from '../lib/dates'
import { getBudgetAmount, getStoredBudgetType } from '../lib/budget'
import { ChatBox } from './ChatBox'

const UNIT_KEY = 'scoop_money_chart_unit'

export function Dashboard() {
  const { dataVersion } = useAppContext()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([])
  const [income, setIncome] = useState<IncomeEntry[]>([])
  const [unit, setUnit] = useState<PeriodUnit>(() => {
    const stored = localStorage.getItem(UNIT_KEY)
    return stored === 'week' || stored === 'month' ? stored : 'day'
  })

  useEffect(() => {
    Promise.all([
      window.api.getTransactions(),
      window.api.getBudgetItems(getStoredBudgetType()),
      window.api.getIncomeEntries()
    ]).then(([nextTransactions, nextBudget, nextIncome]) => {
      setTransactions(nextTransactions)
      setBudgetItems(nextBudget)
      setIncome(nextIncome)
    })
  }, [dataVersion])

  useEffect(() => {
    localStorage.setItem(UNIT_KEY, unit)
  }, [unit])

  const { start, end } = monthBounds()
  const monthSpent = transactions
    .filter((tx) => tx.amount > 0 && tx.date >= start && tx.date <= end)
    .reduce((sum, tx) => sum + tx.amount, 0)
  const monthIncome = income
    .filter((entry) => entry.date >= start && entry.date <= end)
    .reduce((sum, entry) => sum + entry.amount, 0)
  const monthlyBudget = budgetItems.reduce((sum, item) => sum + getBudgetAmount(item, getStoredBudgetType()), 0)

  const chartData = useMemo(() => {
    const grouped = groupTransactionsByPeriod(transactions, unit)
    const budgetLevel = getPeriodBudget(monthlyBudget, unit)
    if (grouped.length === 0) {
      return [{ label: 'No data', actual: 0, budget: budgetLevel / 100 }]
    }
    return grouped.map((group) => ({
      label: group.label,
      actual: group.amount / 100,
      budget: budgetLevel / 100,
      amount: group.amount
    }))
  }, [monthlyBudget, transactions, unit])

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Spending, budget, income, and net for the current month.</p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="This month spent" value={formatCurrency(monthSpent)} />
        <StatCard label="This month budget" value={formatCurrency(monthlyBudget)} />
        <StatCard label="This month income" value={formatCurrency(monthIncome)} accent="text-emerald-600" />
        <StatCard label="Net" value={formatCurrency(monthIncome - monthSpent)} accent={monthIncome - monthSpent >= 0 ? 'text-emerald-600' : 'text-red-600'} />
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Spending over time</h2>
          <div className="flex rounded-full bg-zinc-100 p-1 text-[12px] dark:bg-zinc-800">
            {(['day', 'week', 'month'] as PeriodUnit[]).map((next) => (
              <button
                key={next}
                type="button"
                onClick={() => setUnit(next)}
                className={`rounded-full px-3 py-1 capitalize transition-colors ${
                  unit === next
                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {next}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ left: 12, right: 20, top: 10, bottom: 0 }}>
              <CartesianGrid stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71717a' }} />
              <YAxis tickFormatter={(value) => `$${value}`} tick={{ fontSize: 11, fill: '#71717a' }} />
              <Tooltip formatter={(value) => formatCurrency(Number(value) * 100)} />
              <Line type="monotone" dataKey="budget" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="actual" stroke="#ef4444" strokeWidth={2} dot={false} />
              <Scatter dataKey="actual" fill="#ef4444" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <ChatBox pageId="dashboard" />
    </div>
  )
}

function StatCard({ label, value, accent = 'text-zinc-900 dark:text-zinc-100' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
    </div>
  )
}

function getPeriodBudget(monthlyBudget: number, unit: PeriodUnit): number {
  if (unit === 'day') {
    const date = new Date()
    return monthlyBudget / new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }
  if (unit === 'week') return (monthlyBudget * 12) / 52
  return monthlyBudget
}
