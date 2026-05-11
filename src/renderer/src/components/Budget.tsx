import { useEffect, useMemo, useRef, useState } from 'react'
import type { BudgetItem, BudgetLineItem, BudgetType, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { BUDGET_TYPE_KEY, getBudgetAmount, getStoredBudgetType } from '../lib/budget'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { monthBounds } from '../lib/dates'

type EditFocus = 'label' | 'amount'

interface CategorySummary {
  category: string
  isNeed: boolean
  lines: BudgetLineItem[]
  budget: number
  spent: number
  diff: number
}

export function Budget() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const [budgetType, setBudgetType] = useState<BudgetType>(() => getStoredBudgetType())
  const [items, setItems] = useState<BudgetItem[]>([])
  const [lineItems, setLineItems] = useState<BudgetLineItem[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [editingLineId, setEditingLineId] = useState<number | null>(null)
  const [editingFocus, setEditingFocus] = useState<EditFocus>('label')
  const { start, end } = monthBounds()

  useEffect(() => {
    localStorage.setItem(BUDGET_TYPE_KEY, budgetType)
  }, [budgetType])

  useEffect(() => {
    Promise.all([
      window.api.getBudgetItems(budgetType),
      window.api.getTransactions({ start, end }),
      window.api.getBudgetLineItems()
    ]).then(([nextItems, nextTransactions, nextLineItems]) => {
      setItems(nextItems)
      setTransactions(nextTransactions)
      setLineItems(nextLineItems)
    })
  }, [budgetType, dataVersion, end, start])

  const spentByCategory = useMemo(() => {
    const map = new Map<string, number>()
    transactions.forEach((tx) => {
      if (tx.amount !== 0) map.set(tx.mapped_category, (map.get(tx.mapped_category) ?? 0) + tx.amount)
    })
    return map
  }, [transactions])

  const summaries = useMemo(
    () => buildCategorySummaries(items, lineItems, spentByCategory, budgetType),
    [budgetType, items, lineItems, spentByCategory]
  )
  const needs = summaries.filter((summary) => summary.isNeed)
  const nice = summaries.filter((summary) => !summary.isNeed)
  const totalBudget = summaries.reduce((sum, summary) => sum + summary.budget, 0)
  const totalSpent = Array.from(spentByCategory.values()).reduce((sum, amount) => sum + amount, 0)

  function toggleExpanded(category: string): void {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  function updateLocalLine(nextLine: BudgetLineItem): void {
    setLineItems((current) => current.map((line) => (line.id === nextLine.id ? nextLine : line)))
  }

  async function addLineItem(summary: CategorySummary): Promise<void> {
    const created = await window.api.createBudgetLineItem({
      category: summary.category,
      section: summary.isNeed ? 'Must-Have Expenses' : 'Nice-to-Have Expenses',
      label: '',
      monthly_amount: 0,
      annual_amount: 0,
      notes: '',
      support_scope: 'none'
    })
    setLineItems((current) => [...current.filter((line) => line.id !== created.id), created])
    setExpanded((current) => new Set(current).add(summary.category))
    setEditingLineId(created.id)
    setEditingFocus('label')
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Expenses Budget</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Category totals, source line items, and current-month variance.</p>
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

      <div className="mb-5 grid grid-cols-3 gap-3">
        <BudgetStat label="Budget" value={formatCurrency(totalBudget)} />
        <BudgetStat label="Actual" value={formatCurrency(totalSpent)} />
        <BudgetStat label="Remaining" value={formatCurrency(totalBudget - totalSpent)} />
      </div>

      <BudgetSummarySection
        title="Needs"
        summaries={needs}
        budgetType={budgetType}
        expanded={expanded}
        editingLineId={editingLineId}
        editingFocus={editingFocus}
        onToggle={toggleExpanded}
        onAddLine={addLineItem}
        onStartEdit={(id, focus) => {
          setEditingLineId(id)
          setEditingFocus(focus)
        }}
        onFinishEdit={(nextLine) => {
          setEditingLineId(null)
          if (nextLine) updateLocalLine(nextLine)
          bumpDataVersion()
        }}
      />
      <BudgetSummarySection
        title="Nice to Haves"
        summaries={nice}
        budgetType={budgetType}
        expanded={expanded}
        editingLineId={editingLineId}
        editingFocus={editingFocus}
        onToggle={toggleExpanded}
        onAddLine={addLineItem}
        onStartEdit={(id, focus) => {
          setEditingLineId(id)
          setEditingFocus(focus)
        }}
        onFinishEdit={(nextLine) => {
          setEditingLineId(null)
          if (nextLine) updateLocalLine(nextLine)
          bumpDataVersion()
        }}
      />
    </div>
  )
}

function BudgetStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  )
}

function BudgetSummarySection({
  title,
  summaries,
  budgetType,
  expanded,
  editingLineId,
  editingFocus,
  onToggle,
  onAddLine,
  onStartEdit,
  onFinishEdit
}: {
  title: string
  summaries: CategorySummary[]
  budgetType: BudgetType
  expanded: Set<string>
  editingLineId: number | null
  editingFocus: EditFocus
  onToggle: (category: string) => void
  onAddLine: (summary: CategorySummary) => Promise<void>
  onStartEdit: (id: number, focus: EditFocus) => void
  onFinishEdit: (nextLine?: BudgetLineItem) => void
}) {
  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">{title}</h2>
      <div className="grid grid-cols-[minmax(150px,1fr)_minmax(88px,112px)_minmax(82px,104px)_minmax(82px,104px)_30px] items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
        <div>Category</div>
        <div className="text-right">Monthly</div>
        <div className="text-right">Spent</div>
        <div className="text-right">Left</div>
        <div aria-hidden="true" />
      </div>
      {summaries.map((summary) => {
        const isExpanded = expanded.has(summary.category)
        return (
          <div key={summary.category} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => onToggle(summary.category)}
              className={`grid w-full grid-cols-[minmax(150px,1fr)_minmax(88px,112px)_minmax(82px,104px)_minmax(82px,104px)_30px] items-center gap-2 px-4 py-3 text-left text-sm transition-colors ${summary.diff >= 0 ? 'bg-emerald-50/35 hover:bg-emerald-50/70 dark:bg-emerald-950/10 dark:hover:bg-emerald-950/20' : 'bg-red-50/45 hover:bg-red-50/80 dark:bg-red-950/10 dark:hover:bg-red-950/20'}`}
              aria-expanded={isExpanded}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-zinc-900 dark:text-zinc-100">{summary.category || 'Uncategorized'}</span>
                <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                  {summary.lines.length} {summary.lines.length === 1 ? 'item' : 'items'}
                </span>
              </span>
              <span className="text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{formatCurrency(summary.budget)}</span>
              <span className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">{formatCurrency(summary.spent)}</span>
              <span className={`text-right font-medium tabular-nums ${summary.diff >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{formatCurrency(summary.diff)}</span>
              <span className="flex justify-end text-zinc-400 dark:text-zinc-500">
                <ChevronIcon expanded={isExpanded} />
              </span>
            </button>
            {isExpanded ? (
              <div className="bg-zinc-50/60 py-1.5 dark:bg-zinc-950/30">
                {summary.lines.length ? (
                  summary.lines.map((line) => (
                    <BudgetLineRow
                      key={line.id}
                      line={line}
                      budgetType={budgetType}
                      editing={editingLineId === line.id}
                      initialFocus={editingFocus}
                      onStartEdit={(focus) => onStartEdit(line.id, focus)}
                      onFinishEdit={onFinishEdit}
                    />
                  ))
                ) : (
                  <div className="px-10 py-3 text-[12px] text-zinc-500 dark:text-zinc-400">No line items yet.</div>
                )}
                <button
                  type="button"
                  onClick={() => void onAddLine(summary)}
                  className="ml-10 mt-1 rounded-full px-3 py-1.5 text-[12px] font-medium text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                >
                  Add item
                </button>
              </div>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

function BudgetLineRow({
  line,
  budgetType,
  editing,
  initialFocus,
  onStartEdit,
  onFinishEdit
}: {
  line: BudgetLineItem
  budgetType: BudgetType
  editing: boolean
  initialFocus: EditFocus
  onStartEdit: (focus: EditFocus) => void
  onFinishEdit: (nextLine?: BudgetLineItem) => void
}) {
  const [labelDraft, setLabelDraft] = useState(line.label)
  const [amountDraft, setAmountDraft] = useState(formatCurrency(line.monthly_amount))
  const rowRef = useRef<HTMLDivElement | null>(null)
  const labelInputRef = useRef<HTMLInputElement | null>(null)
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const savingRef = useRef(false)
  const shownAmount = lineAmountForBudgetType(line, budgetType)

  useEffect(() => {
    if (editing) return
    setLabelDraft(line.label)
    setAmountDraft(formatCurrency(line.monthly_amount))
  }, [editing, line])

  useEffect(() => {
    if (!editing) return
    const input = initialFocus === 'amount' ? amountInputRef.current : labelInputRef.current
    window.requestAnimationFrame(() => {
      input?.focus()
      input?.select()
    })
  }, [editing, initialFocus])

  useEffect(() => {
    if (!editing) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (rowRef.current?.contains(event.target as Node | null)) return
      void save()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  })

  async function save(): Promise<void> {
    if (savingRef.current) return
    savingRef.current = true
    try {
      const monthly = parseCurrencyInput(amountDraft)
      const nextLine = await window.api.updateBudgetLineItem(line.id, {
        label: labelDraft.trim(),
        monthly_amount: monthly,
        annual_amount: monthly * 12
      })
      onFinishEdit(nextLine)
    } finally {
      savingRef.current = false
    }
  }

  async function deleteLine(): Promise<void> {
    await window.api.deleteBudgetLineItem(line.id)
    onFinishEdit()
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>): void {
    if (!editing) return
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    void save()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void save()
  }

  return (
    <div
      ref={rowRef}
      onBlur={handleBlur}
      className="grid grid-cols-[24px_minmax(150px,1fr)_minmax(90px,112px)_58px] items-center gap-2 px-4 py-2 text-sm"
    >
      <div aria-hidden="true" />
      {editing ? (
        <input
          ref={labelInputRef}
          value={labelDraft}
          onChange={(event) => setLabelDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Line item"
          className="min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1 font-medium text-zinc-900 outline-none transition-shadow focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800"
        />
      ) : (
        <button type="button" onClick={() => onStartEdit('label')} className="min-w-0 truncate text-left font-medium text-zinc-700 dark:text-zinc-200">
          {line.label || <span className="text-zinc-400 dark:text-zinc-500">Line item</span>}
        </button>
      )}
      {editing ? (
        <input
          ref={amountInputRef}
          value={amountDraft}
          onChange={(event) => setAmountDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-w-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-right tabular-nums text-zinc-900 outline-none transition-shadow focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800"
        />
      ) : (
        <button type="button" onClick={() => onStartEdit('amount')} className="min-w-0 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
          {formatCurrency(shownAmount)}
        </button>
      )}
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={() => onStartEdit('label')}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${editing ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'text-zinc-400 hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200'}`}
          aria-label={`Edit ${line.label || 'line item'}`}
        >
          <PencilIcon />
        </button>
        {editing ? (
          <button
            type="button"
            onClick={() => void save()}
            className="flex h-6 w-6 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-white dark:text-emerald-300 dark:hover:bg-zinc-900"
            aria-label={`Save ${labelDraft || 'line item'}`}
          >
            <CheckIcon />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void deleteLine()}
            className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-300"
            aria-label={`Delete ${line.label || 'line item'}`}
          >
            <XIcon />
          </button>
        )}
      </div>
    </div>
  )
}

function buildCategorySummaries(
  items: BudgetItem[],
  lineItems: BudgetLineItem[],
  spentByCategory: Map<string, number>,
  budgetType: BudgetType
): CategorySummary[] {
  const itemByCategory = new Map(items.map((item) => [item.category, item]))
  const linesByCategory = new Map<string, BudgetLineItem[]>()
  lineItems.forEach((line) => {
    if (!line.category.trim()) return
    if (line.section === 'Parental & Gov Help') return
    const lines = linesByCategory.get(line.category) ?? []
    lines.push(line)
    linesByCategory.set(line.category, lines)
  })
  const categories = new Set<string>([...itemByCategory.keys(), ...linesByCategory.keys()])
  return Array.from(categories)
    .map((category) => {
      const item = itemByCategory.get(category)
      const lines = linesByCategory.get(category) ?? []
      const budget = lines.length > 0
        ? lines.reduce((sum, line) => sum + lineAmountForBudgetType(line, budgetType), 0)
        : item
          ? getBudgetAmount(item, budgetType)
          : 0
      const spent = spentByCategory.get(category) ?? 0
      return {
        category,
        isNeed: item?.is_need ?? !lines.some((line) => line.section.toLowerCase().includes('nice')),
        lines,
        budget,
        spent,
        diff: budget - spent
      }
    })
    .sort((a, b) => Number(b.isNeed) - Number(a.isNeed) || a.category.localeCompare(b.category))
}

function lineAmountForBudgetType(line: BudgetLineItem, budgetType: BudgetType): number {
  if (budgetType === 'with_parents' && line.support_scope === 'parental') return 0
  if (budgetType === 'with_aid' && (line.support_scope === 'parental' || line.support_scope === 'government')) return 0
  return line.monthly_amount
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={expanded ? 'M5 12.5 L10 7.5 L15 12.5' : 'M7.5 5 L12.5 10 L7.5 15'} />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.8 3.1 12.9 6.2M2.8 10.1 10.7 2.2a1.5 1.5 0 0 1 2.1 0l1 1a1.5 1.5 0 0 1 0 2.1L5.9 13.2l-3.6.6.5-3.7Z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="m3 3 6 6M9 3 3 9" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 7.3 2.6 2.6L11 4.1" />
    </svg>
  )
}
