import { useEffect, useMemo, useState } from 'react'
import type { BudgetItem, BudgetType, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { BUDGET_TYPE_KEY, getBudgetAmount, getStoredBudgetType } from '../lib/budget'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { monthBounds } from '../lib/dates'

export function Budget() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const [budgetType, setBudgetType] = useState<BudgetType>(() => getStoredBudgetType())
  const [items, setItems] = useState<BudgetItem[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const { start, end } = monthBounds()

  useEffect(() => {
    localStorage.setItem(BUDGET_TYPE_KEY, budgetType)
  }, [budgetType])

  useEffect(() => {
    Promise.all([
      window.api.getBudgetItems(budgetType),
      window.api.getTransactions({ start, end })
    ]).then(([nextItems, nextTransactions]) => {
      setItems(nextItems)
      setTransactions(nextTransactions)
    })
  }, [budgetType, dataVersion, end, start])

  const spentByCategory = useMemo(() => {
    const map = new Map<string, number>()
    transactions.forEach((tx) => {
      if (tx.amount > 0) map.set(tx.mapped_category, (map.get(tx.mapped_category) ?? 0) + tx.amount)
    })
    return map
  }, [transactions])

  const needs = items.filter((item) => item.is_need)
  const nice = items.filter((item) => !item.is_need)

  async function addCategory(isNeed: boolean): Promise<void> {
    await window.api.createBudgetItem({ category: 'New Category', is_need: isNeed, amount_standard: 0 })
    bumpDataVersion()
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Budget</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Monthly categories, spending, and variance.</p>
        </div>
        <div className="flex rounded-full bg-zinc-100 p-1 text-[12px] dark:bg-zinc-800">
          {[
            ['standard', 'Standard'],
            ['with_aid', 'With Aid'],
            ['with_parents', 'With Parents']
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setBudgetType(value as BudgetType)}
              className={`rounded-full px-3 py-1 transition-colors ${
                budgetType === value ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <BudgetSection title="Needs" items={needs} spentByCategory={spentByCategory} budgetType={budgetType} onChanged={bumpDataVersion} />
      <button type="button" onClick={() => addCategory(true)} className="mb-6 rounded-full bg-zinc-100 px-3 py-1.5 text-[12px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">Add Category</button>
      <BudgetSection title="Nice to Haves" items={nice} spentByCategory={spentByCategory} budgetType={budgetType} onChanged={bumpDataVersion} />
      <button type="button" onClick={() => addCategory(false)} className="rounded-full bg-zinc-100 px-3 py-1.5 text-[12px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">Add Category</button>
    </div>
  )
}

function BudgetSection({ title, items, spentByCategory, budgetType, onChanged }: { title: string; items: BudgetItem[]; spentByCategory: Map<string, number>; budgetType: BudgetType; onChanged: () => void }) {
  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">{title}</h2>
      {items.map((item) => (
        <BudgetRow key={item.id} item={item} spent={spentByCategory.get(item.category) ?? 0} budgetType={budgetType} onChanged={onChanged} />
      ))}
    </section>
  )
}

function BudgetRow({ item, spent, budgetType, onChanged }: { item: BudgetItem; spent: number; budgetType: BudgetType; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(formatCurrency(getBudgetAmount(item, budgetType)))
  const budget = getBudgetAmount(item, budgetType)
  const diff = budget - spent

  async function save(): Promise<void> {
    const amount = parseCurrencyInput(draft)
    await window.api.updateBudgetItem(item.id, {
      [budgetType === 'standard' ? 'amount_standard' : budgetType === 'with_aid' ? 'amount_with_aid' : 'amount_with_parents']: amount
    })
    setEditing(false)
    onChanged()
  }

  return (
    <div className={`grid grid-cols-[1fr_150px_150px_150px] items-center gap-3 border-b border-zinc-100 px-4 py-3 text-sm last:border-b-0 dark:border-zinc-800 ${diff >= 0 ? 'bg-emerald-50/35 dark:bg-emerald-950/10' : 'bg-red-50/45 dark:bg-red-950/10'}`}>
      <div className="font-medium text-zinc-900 dark:text-zinc-100">{item.category}</div>
      {editing ? (
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className="bg-transparent text-right outline-none" />
      ) : (
        <button type="button" onDoubleClick={() => setEditing(true)} className="text-right text-zinc-900 dark:text-zinc-100">{formatCurrency(budget)}</button>
      )}
      <div className="text-right text-zinc-600 dark:text-zinc-300">{formatCurrency(spent)}</div>
      <div className={`text-right font-medium ${diff >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{formatCurrency(diff)}</div>
    </div>
  )
}
