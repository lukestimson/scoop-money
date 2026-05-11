import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BudgetLineItem, BudgetType } from '../../../types/money'
import { BUDGET_CATEGORY_ORDER } from '../../../types/budgetCategories'
import { categoryNeedKindFromLines, inferLineIsNeed } from '../../../types/budgetNeedRules'
import { useAppContext } from '../context/AppContext'
import {
  BUDGET_CATEGORY_SORT_KEY,
  BUDGET_PERIOD_KEY,
  BUDGET_TYPE_KEY,
  type BudgetCategorySortKey,
  type BudgetDisplayPeriod,
  getStoredBudgetCategorySort,
  getStoredBudgetPeriod,
  getStoredBudgetType,
  scaleMonthlyAmountToPeriod
} from '../lib/budget'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'

type LineNeedFilter = 'all' | 'needs' | 'nice'
type EditFocus = 'label' | 'amount'

function lineMonthlyForBudgetType(line: BudgetLineItem, budgetType: BudgetType): number {
  if (budgetType === 'with_parents' && line.support_scope === 'parental') return 0
  if (budgetType === 'with_aid' && (line.support_scope === 'parental' || line.support_scope === 'government')) return 0
  return line.monthly_amount
}

function isParentalGovLine(line: BudgetLineItem): boolean {
  return line.section === 'Parental & Gov Help'
}

const SORT_OPTIONS: ReadonlyArray<{ id: BudgetCategorySortKey; label: string }> = [
  { id: 'sheet', label: 'Workbook order' },
  { id: 'amount_desc', label: 'Amount (high → low)' },
  { id: 'amount_asc', label: 'Amount (low → high)' },
  { id: 'name_asc', label: 'Name (A → Z)' }
]

function NeedTypeChip({ kind }: { kind: 'need' | 'nice' | 'mixed' | 'empty' }) {
  if (kind === 'empty') {
    return (
      <span className="inline-flex justify-center text-[10px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500">—</span>
    )
  }
  const label = kind === 'need' ? 'Need' : kind === 'nice' ? 'Nice' : 'Mixed'
  const cls =
    kind === 'need'
      ? 'bg-emerald-100/90 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
      : kind === 'nice'
        ? 'bg-violet-100/90 text-violet-900 dark:bg-violet-950/50 dark:text-violet-300'
        : 'bg-amber-100/90 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
  return (
    <span
      className={`inline-flex min-w-[2.75rem] justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${cls}`}
    >
      {label}
    </span>
  )
}

function SegmentedButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
      }`}
    >
      {children}
    </button>
  )
}

export function Budget() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const [budgetType, setBudgetType] = useState<BudgetType>(() => getStoredBudgetType())
  const [period, setPeriod] = useState<BudgetDisplayPeriod>(() => getStoredBudgetPeriod())
  const [lineItems, setLineItems] = useState<BudgetLineItem[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [needFilter, setNeedFilter] = useState<LineNeedFilter>('all')
  const [editingLineId, setEditingLineId] = useState<number | null>(null)
  const [editingFocus, setEditingFocus] = useState<EditFocus>('label')
  const [categorySort, setCategorySort] = useState<BudgetCategorySortKey>(() => getStoredBudgetCategorySort())

  useEffect(() => {
    localStorage.setItem(BUDGET_TYPE_KEY, budgetType)
  }, [budgetType])

  useEffect(() => {
    localStorage.setItem(BUDGET_PERIOD_KEY, period)
  }, [period])

  useEffect(() => {
    localStorage.setItem(BUDGET_CATEGORY_SORT_KEY, categorySort)
  }, [categorySort])

  useEffect(() => {
    window.api.getBudgetLineItems().then(setLineItems)
  }, [dataVersion])

  const linesByCategory = useMemo(() => {
    const map = new Map<string, BudgetLineItem[]>()
    lineItems.forEach((line) => {
      if (!line.category.trim() || isParentalGovLine(line)) return
      if (needFilter === 'needs' && !line.is_need) return
      if (needFilter === 'nice' && line.is_need) return
      const list = map.get(line.category) ?? []
      list.push(line)
      map.set(line.category, list)
    })
    return map
  }, [lineItems, needFilter])

  const categoryMonthlyTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const category of BUDGET_CATEGORY_ORDER) {
      const lines = lineItems.filter(
        (line) =>
          line.category === category &&
          !isParentalGovLine(line) &&
          (needFilter === 'all' || (needFilter === 'needs' ? line.is_need : !line.is_need))
      )
      const sum = lines.reduce((acc, line) => acc + lineMonthlyForBudgetType(line, budgetType), 0)
      totals.set(category, sum)
    }
    return totals
  }, [budgetType, lineItems, needFilter])

  const totalBudgetScaled = useMemo(() => {
    let sum = 0
    categoryMonthlyTotals.forEach((monthly) => {
      sum += scaleMonthlyAmountToPeriod(monthly, period)
    })
    return sum
  }, [categoryMonthlyTotals, period])

  const categoryKindByCategory = useMemo(() => {
    const map = new Map<string, ReturnType<typeof categoryNeedKindFromLines>>()
    for (const category of BUDGET_CATEGORY_ORDER) {
      const allForCategory = lineItems.filter((line) => line.category === category && !isParentalGovLine(line))
      map.set(category, categoryNeedKindFromLines(allForCategory))
    }
    return map
  }, [lineItems])

  const sortedCategories = useMemo(() => {
    const keys = [...BUDGET_CATEGORY_ORDER]
    const sheetIndex = (c: string): number => (BUDGET_CATEGORY_ORDER as readonly string[]).indexOf(c)
    const monthlyTotal = (cat: string): number => categoryMonthlyTotals.get(cat) ?? 0
    const scaledTotal = (cat: string): number => scaleMonthlyAmountToPeriod(monthlyTotal(cat), period)
    if (categorySort === 'sheet') return keys
    if (categorySort === 'name_asc') return keys.sort((a, b) => a.localeCompare(b))
    if (categorySort === 'amount_desc') {
      return keys.sort((a, b) => {
        const d = scaledTotal(b) - scaledTotal(a)
        return d !== 0 ? d : sheetIndex(a) - sheetIndex(b)
      })
    }
    if (categorySort === 'amount_asc') {
      return keys.sort((a, b) => {
        const d = scaledTotal(a) - scaledTotal(b)
        return d !== 0 ? d : sheetIndex(a) - sheetIndex(b)
      })
    }
    return keys
  }, [categoryMonthlyTotals, categorySort, period])

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

  function inferIsNeedForNewLine(category: string): boolean {
    if (needFilter === 'needs') return true
    if (needFilter === 'nice') return false
    return inferLineIsNeed(category, '')
  }

  async function addLineItem(category: string): Promise<void> {
    const isNeed = inferIsNeedForNewLine(category)
    const created = await window.api.createBudgetLineItem({
      category,
      section: '',
      label: '',
      monthly_amount: 0,
      annual_amount: 0,
      notes: '',
      support_scope: 'none',
      is_need: isNeed
    })
    setLineItems((current) => [...current.filter((line) => line.id !== created.id), created])
    setExpanded((current) => new Set(current).add(category))
    setEditingLineId(created.id)
    setEditingFocus('label')
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Budget</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-100">
            {formatCurrency(totalBudgetScaled)}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <details className="group relative">
            <summary className="cursor-pointer list-none rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors marker:content-none hover:bg-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 [&::-webkit-details-marker]:hidden">
              Sort: {SORT_OPTIONS.find((o) => o.id === categorySort)?.label ?? 'Workbook order'}
            </summary>
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 min-w-[11.5rem] rounded-lg border border-zinc-200/80 bg-white p-1 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900"
            >
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCategorySort(opt.id)
                    const el = document.activeElement as HTMLElement | null
                    el?.closest('details')?.removeAttribute('open')
                  }}
                  className={`flex w-full rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors ${
                    categorySort === opt.id
                      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </details>
          <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Need filter">
            <SegmentedButton active={needFilter === 'all'} onClick={() => setNeedFilter('all')}>
              All
            </SegmentedButton>
            <SegmentedButton active={needFilter === 'needs'} onClick={() => setNeedFilter('needs')}>
              Needs
            </SegmentedButton>
            <SegmentedButton active={needFilter === 'nice'} onClick={() => setNeedFilter('nice')}>
              Nice
            </SegmentedButton>
          </div>
          <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Budget period">
            <SegmentedButton active={period === 'week'} onClick={() => setPeriod('week')}>
              Week
            </SegmentedButton>
            <SegmentedButton active={period === 'month'} onClick={() => setPeriod('month')}>
              Month
            </SegmentedButton>
            <SegmentedButton active={period === 'year'} onClick={() => setPeriod('year')}>
              Year
            </SegmentedButton>
          </div>
          <div className="flex rounded-full bg-zinc-100 p-1 text-[12px] dark:bg-zinc-800">
            {(
              [
                ['standard', 'Standard'],
                ['with_aid', 'With Aid'],
                ['with_parents', 'With Parents']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setBudgetType(value)}
                className={`rounded-full px-3 py-1 transition-colors ${
                  budgetType === value ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(64px,76px)_minmax(96px,120px)_32px] items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
          <div>Category</div>
          <div className="text-center">Type</div>
          <div className="text-right">Amount</div>
          <div aria-hidden="true" />
        </div>
        {sortedCategories.map((category) => {
          const isExpanded = expanded.has(category)
          const monthlyTotal = categoryMonthlyTotals.get(category) ?? 0
          const displayTotal = scaleMonthlyAmountToPeriod(monthlyTotal, period)
          const visibleLines = linesByCategory.get(category) ?? []
          const catKind = categoryKindByCategory.get(category) ?? 'empty'
          return (
            <div key={category} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => toggleExpanded(category)}
                className="grid w-full grid-cols-[minmax(0,1fr)_minmax(64px,76px)_minmax(96px,120px)_32px] items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-950/40"
                aria-expanded={isExpanded}
              >
                <span className="min-w-0 truncate font-semibold text-zinc-900 dark:text-zinc-100">{category}</span>
                <span className="flex justify-center">
                  <NeedTypeChip kind={catKind} />
                </span>
                <span className="text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(displayTotal)}
                </span>
                <span className="flex justify-end text-zinc-400 dark:text-zinc-500">
                  <ChevronIcon expanded={isExpanded} />
                </span>
              </button>
              {isExpanded ? (
                <div className="border-t border-zinc-100 bg-zinc-50/50 py-1 dark:border-zinc-800 dark:bg-zinc-950/25">
                  <div className="ml-6 grid grid-cols-[minmax(0,1fr)_minmax(76px,92px)_minmax(72px,96px)_auto] items-center gap-2 px-4 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400 dark:text-zinc-500">
                    <span>Line item</span>
                    <span className="text-center">Type</span>
                    <span className="text-right">Amount</span>
                    <span className="w-[52px]" aria-hidden="true" />
                  </div>
                  {visibleLines.length ? (
                    visibleLines.map((line) => (
                      <BudgetLineRow
                        key={line.id}
                        line={line}
                        budgetType={budgetType}
                        period={period}
                        editing={editingLineId === line.id}
                        initialFocus={editingFocus}
                        onStartEdit={(focus) => {
                          setEditingLineId(line.id)
                          setEditingFocus(focus)
                        }}
                        onFinishEdit={(nextLine) => {
                          setEditingLineId(null)
                          if (nextLine) updateLocalLine(nextLine)
                          bumpDataVersion()
                        }}
                      />
                    ))
                  ) : (
                    <div className="px-8 py-3 text-[12px] text-zinc-500 dark:text-zinc-400">
                      {needFilter === 'all' ? 'No line items yet.' : `No ${needFilter === 'needs' ? 'need' : 'nice-to-have'} lines in this category.`}
                    </div>
                  )}
                  <div className="flex justify-end px-3 pb-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void addLineItem(category)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200/90 bg-white text-zinc-500 shadow-sm transition-colors hover:border-zinc-300 hover:text-zinc-800 active:scale-[0.97] dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
                      aria-label={`Add line item in ${category}`}
                    >
                      <PlusCircleIcon />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </section>
    </div>
  )
}

function BudgetLineRow({
  line,
  budgetType,
  period,
  editing,
  initialFocus,
  onStartEdit,
  onFinishEdit
}: {
  line: BudgetLineItem
  budgetType: BudgetType
  period: BudgetDisplayPeriod
  editing: boolean
  initialFocus: EditFocus
  onStartEdit: (focus: EditFocus) => void
  onFinishEdit: (nextLine?: BudgetLineItem) => void
}) {
  const [labelDraft, setLabelDraft] = useState(line.label)
  const [amountDraft, setAmountDraft] = useState(formatCurrency(line.monthly_amount))
  const [needDraft, setNeedDraft] = useState(line.is_need)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const labelInputRef = useRef<HTMLInputElement | null>(null)
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const savingRef = useRef(false)
  const monthlyForType = lineMonthlyForBudgetType(line, budgetType)
  const shownAmount = scaleMonthlyAmountToPeriod(monthlyForType, period)

  useEffect(() => {
    if (editing) return
    setLabelDraft(line.label)
    setAmountDraft(formatCurrency(line.monthly_amount))
    setNeedDraft(line.is_need)
  }, [editing, line])

  useEffect(() => {
    if (!editing) return
    const input = initialFocus === 'amount' ? amountInputRef.current : labelInputRef.current
    window.requestAnimationFrame(() => {
      input?.focus()
      input?.select()
    })
  }, [editing, initialFocus])

  const save = useCallback(async (): Promise<void> => {
    if (savingRef.current) return
    savingRef.current = true
    try {
      const monthly = parseCurrencyInput(amountDraft)
      const nextLine = await window.api.updateBudgetLineItem(line.id, {
        label: labelDraft.trim(),
        monthly_amount: monthly,
        annual_amount: monthly * 12,
        is_need: needDraft
      })
      onFinishEdit(nextLine)
    } finally {
      savingRef.current = false
    }
  }, [amountDraft, labelDraft, line.id, needDraft, onFinishEdit])

  useEffect(() => {
    if (!editing) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (rowRef.current?.contains(event.target as Node | null)) return
      void save()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [editing, save])

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
      className="ml-6 grid grid-cols-[minmax(0,1fr)_minmax(76px,92px)_minmax(72px,96px)_auto] items-center gap-2 border-b border-zinc-100/80 px-4 py-2 text-sm last:border-b-0 dark:border-zinc-800/80"
    >
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
      <div className="flex justify-center">
        {editing ? (
          <div className="inline-flex rounded-full bg-zinc-200/80 p-0.5 dark:bg-zinc-800" role="group" aria-label="Need or nice-to-have">
            <button
              type="button"
              onClick={() => setNeedDraft(true)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${needDraft ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500'}`}
            >
              Need
            </button>
            <button
              type="button"
              onClick={() => setNeedDraft(false)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${!needDraft ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500'}`}
            >
              Nice
            </button>
          </div>
        ) : (
          <NeedTypeChip kind={line.is_need ? 'need' : 'nice'} />
        )}
      </div>
      {editing ? (
        <div className="flex min-w-0 flex-col items-end gap-1">
          <input
            ref={amountInputRef}
            value={amountDraft}
            onChange={(event) => setAmountDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-right text-sm tabular-nums text-zinc-900 outline-none transition-shadow focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800"
          />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Monthly $</span>
        </div>
      ) : (
        <button type="button" onClick={() => onStartEdit('amount')} className="min-w-0 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
          {formatCurrency(shownAmount)}
        </button>
      )}
      <div className="flex shrink-0 justify-end gap-1">
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
            aria-label="Save line item"
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

function PlusCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 5.5v5M5.5 8h5" />
    </svg>
  )
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
