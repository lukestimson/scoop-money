import { useEffect, useMemo, useState } from 'react'
import { addMonths, endOfMonth, format, startOfMonth } from 'date-fns'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BudgetItem, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { getBudgetAmount, getStoredBudgetType } from '../lib/budget'
import { formatCurrency } from '../lib/currency'

export function Summary() {
  const { dataVersion } = useAppContext()
  const [range, setRange] = useState(6)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budget, setBudget] = useState<BudgetItem[]>([])

  useEffect(() => {
    Promise.all([window.api.getTransactions(), window.api.getBudgetItems(getStoredBudgetType())]).then(([txs, items]) => {
      setTransactions(txs)
      setBudget(items)
    })
  }, [dataVersion])

  const months = useMemo(() => {
    const current = startOfMonth(new Date())
    return Array.from({ length: range }, (_, index) => startOfMonth(addMonths(current, index - range + 1)))
  }, [range])

  const chartData = months.map((month) => {
    const start = Math.floor(startOfMonth(month).getTime() / 1000)
    const end = Math.floor(endOfMonth(month).getTime() / 1000)
    const spent = transactions.filter((tx) => tx.amount !== 0 && tx.date >= start && tx.date <= end).reduce((sum, tx) => sum - tx.amount, 0)
    const monthlyBudget = budget.reduce((sum, item) => sum + getBudgetAmount(item, getStoredBudgetType()), 0)
    return { month: format(month, 'MMM'), spent: spent / 100, budget: monthlyBudget / 100, spentCents: spent, budgetCents: monthlyBudget }
  })

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Expenses Summary</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Monthly budget comparison by total and category.</p>
        </div>
        <div className="flex rounded-full bg-zinc-100 p-1 text-[12px] dark:bg-zinc-800">
          {[3, 6, 12].map((value) => (
            <button key={value} type="button" onClick={() => setRange(value)} className={`rounded-full px-3 py-1 ${range === value ? 'bg-white shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500'}`}>
              Last {value}
            </button>
          ))}
        </div>
      </div>

      <section className="mb-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#71717a' }} />
              <YAxis tickFormatter={(value) => `$${value}`} tick={{ fontSize: 11, fill: '#71717a' }} />
              <Tooltip formatter={(value) => formatCurrency(Number(value) * 100)} />
              <Bar dataKey="spent" name="Spent" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="budget" name="Budget" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Category</th>
              {months.map((month) => (
                <th key={month.toISOString()} className="px-4 py-3 text-right font-medium text-zinc-500">{format(month, 'MMM yyyy')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {budget.map((item) => (
              <tr key={item.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{item.category}</td>
                {months.map((month) => {
                  const start = Math.floor(startOfMonth(month).getTime() / 1000)
                  const end = Math.floor(endOfMonth(month).getTime() / 1000)
                  const spent = transactions.filter((tx) => tx.amount !== 0 && tx.mapped_category === item.category && tx.date >= start && tx.date <= end).reduce((sum, tx) => sum - tx.amount, 0)
                  const under = spent <= getBudgetAmount(item, getStoredBudgetType())
                  return (
                    <td key={month.toISOString()} className={`px-4 py-3 text-right ${under ? 'bg-emerald-50/40 text-emerald-800 dark:bg-emerald-950/10 dark:text-emerald-300' : 'bg-red-50/50 text-red-800 dark:bg-red-950/10 dark:text-red-300'}`}>
                      {formatCurrency(spent)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
