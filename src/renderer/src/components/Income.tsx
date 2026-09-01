import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode } from 'react'
import { addMonths, format, getDay, getDaysInMonth, startOfMonth, startOfWeek } from 'date-fns'
import type { BudgetItem, BudgetLineItem, ExpectedIncomeEntry, IncomeEntry, IncomeKind, IncomeTaxSettings } from '../../../types/money'
import { parseLocalDateToUnix } from '../../../types/dateParsing'
import { useAppContext } from '../context/AppContext'
import { useDateFormat } from '../context/DateFormatContext'
import { getStoredBudgetType, loadStoredBudgetAidFilters, subscribeBudgetAidFilters, type BudgetAidFilter } from '../lib/budget'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { calculateIncomeTaxes } from '../lib/income'
import { computeLivingExpensesMetrics } from '../lib/livingExpensesMetrics'
import { ChatBox } from './ChatBox'
import { BudgetAidIndicators } from './BudgetAidIndicators'
import { IncomeNotesPanel, type IncomeNotesPanelHandle } from './IncomeNotesPanel'
import { IncomeTypeField, INCOME_TYPE_COLOR_EDITOR_SELECTOR, INCOME_TYPE_MENU_SELECTOR } from './IncomeTypeField'
import { ListSectionSearchBar, type ListSearchPhase } from './ListSectionSearchBar'
import { incomeTypeChipPresentation, readIncomeTypeColorHex, removeIncomeTypeColorHex, resolveIncomeTypeColorHex, setIncomeTypeColorHex, subscribeIncomeTypeColors } from '../lib/incomeTypeColors'
import { DisplayPeriod, getDisplayPeriodBounds, stepDisplayAnchor, formatDisplayAnchor } from '../lib/dates'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const DEFAULT_INCOME_TYPES = ['Snappr', 'Thumbtack', 'Upwork', 'Stimsonphoto'] as const
const INCOME_CUSTOM_TYPES_KEY = 'scoop_income_custom_types'
const INCOME_HIDDEN_TYPES_KEY = 'scoop_income_hidden_types'
const INCOME_KIND_OPTIONS: Array<{ value: IncomeKind; label: string; detail: string }> = [
  { value: 'w2', label: 'W-2', detail: 'Payroll job' },
  { value: 'self_employment', label: 'Self-employed', detail: '1099 or freelance' },
  { value: 'other', label: 'Other', detail: 'Not payroll taxed here' }
]
type IncomeSortKey = 'date' | 'amount' | 'type'
type IncomeEditField = 'date' | 'shoot_name' | 'company' | 'income_type' | 'tip' | 'amount' | 'notes' | 'all' | null
type ExplanationPoint = { label: string; value: string; aidAdjusted?: boolean }
type Explanation = {
  title: string
  summary: string
  calculation: string
  points: ExplanationPoint[]
  x: number
  y: number
}

const INCOME_SORT_KEY = 'scoop_income_actual_sort'
const INCOME_SORT_OPTIONS: ReadonlyArray<{ id: IncomeSortKey; label: string }> = [
  { id: 'date', label: 'Date' },
  { id: 'type', label: 'Type' },
  { id: 'amount', label: 'Amount: High to Low' }
]

function roundCentsToWholeDollars(cents: number): number {
  return Math.round(cents / 100) * 100
}

function parseWholeDollarInput(value: string): number {
  return roundCentsToWholeDollars(parseCurrencyInput(value))
}

function formatWholeDollarCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(cents / 100))
}

function normalizeWholeDollarDraft(value: string): string {
  const cleaned = value.replace(/[^\d-]/g, '')
  if (!cleaned) return ''
  if (cleaned === '-') return '-'
  const isNegative = cleaned.startsWith('-')
  const digits = cleaned.replace(/-/g, '')
  if (!digits) return isNegative ? '-' : ''
  return `${isNegative ? '-' : ''}$${digits}`
}

interface IncomeUndoAction {
  type: 'create_entry' | 'delete_entry'
  entryId?: number
  entries?: IncomeEntry[]
}

function getStoredIncomeSort(): IncomeSortKey {
  const value = localStorage.getItem(INCOME_SORT_KEY)
  if (value === 'date' || value === 'amount' || value === 'type') return value
  if (value === 'name' || value === 'company') return 'type'
  return 'date'
}

export function IncomeExpected({
  period = 'month',
  showTitle = true,
  embedded = false
}: {
  period?: DisplayPeriod
  showTitle?: boolean
  embedded?: boolean
} = {}) {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const [entries, setEntries] = useState<ExpectedIncomeEntry[]>([])
  const [settings, setSettings] = useState<IncomeTaxSettings | null>(null)
  const [budget, setBudget] = useState<BudgetItem[]>([])
  const [budgetLines, setBudgetLines] = useState<BudgetLineItem[]>([])
  const [aidFilters, setAidFilters] = useState<Set<BudgetAidFilter>>(() => loadStoredBudgetAidFilters())
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [busy, setBusy] = useState<'idle' | 'loading' | 'saving'>('loading')
  const budgetType = getStoredBudgetType()

  function reload(): void {
    setBusy('loading')
    Promise.all([
      window.api.getExpectedIncomeEntries(),
      window.api.getIncomeTaxSettings(),
      window.api.getBudgetItems(budgetType),
      window.api.getBudgetLineItems()
    ]).then(([nextEntries, nextSettings, nextBudget, nextBudgetLines]) => {
      setEntries(nextEntries)
      setSettings(nextSettings)
      setBudget(nextBudget)
      setBudgetLines(nextBudgetLines)
      setBusy('idle')
    }).catch(() => {
      setBusy('idle')
    })
  }

  useEffect(reload, [dataVersion, budgetType])

  useEffect(() => {
    return subscribeBudgetAidFilters(() => setAidFilters(loadStoredBudgetAidFilters()))
  }, [])

  const metrics = useMemo(
    () => computeLivingExpensesMetrics({ entries, taxSettings: settings, budgetItems: budget, budgetLineItems: budgetLines, aidFilters, budgetType, period }),
    [entries, settings, budget, budgetLines, aidFilters, budgetType, period]
  )
  const tax = metrics.tax
  const periodLabel = period === 'week' ? 'Week' : period === 'year' ? 'Year' : 'Month'

  async function updateEntry(id: number, data: Partial<ExpectedIncomeEntry>): Promise<void> {
    setBusy('saving')
    await window.api.updateExpectedIncomeEntry(id, data)
    reload()
    bumpDataVersion()
  }

  async function updateSettings(data: Partial<IncomeTaxSettings>): Promise<void> {
    setBusy('saving')
    const next = await window.api.updateIncomeTaxSettings(data)
    setSettings(next)
    setBusy('idle')
    bumpDataVersion()
  }

  async function addIncomeSource(): Promise<void> {
    setBusy('saving')
    await window.api.createExpectedIncomeEntry({
      name: 'New Income Source',
      notes: '',
      annual_amount: 0,
      income_kind: 'other'
    })
    reload()
    bumpDataVersion()
  }

  function openExplanation(event: MouseEvent, next: Omit<Explanation, 'x' | 'y'>): void {
    event.preventDefault()
    setExplanation({ ...next, x: event.clientX, y: event.clientY })
  }

  return (
    <div className={`relative px-8 py-8 ${embedded ? 'border-b border-zinc-200 dark:border-zinc-800' : ''}`} onClick={() => explanation && setExplanation(null)}>
      {showTitle ? (
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Income & Taxes</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Expected gross income, tax estimate, and after-tax room against your expense plan.</p>
        </div>
      ) : null}

      {tax ? (
        <div className="mb-5 grid grid-cols-4 gap-3">
          <StatCard label="Gross annual" value={formatCurrency(tax.grossIncome)} />
          <StatCard label="After tax annual" value={formatCurrency(tax.afterTaxIncome)} accent="text-emerald-600" />
          <StatCard label="Total taxes" value={formatCurrency(tax.totalTaxes)} accent="text-red-600" />
          <StatCard label="Effective rate" value={`${(tax.effectiveRate * 100).toFixed(1)}%`} />
        </div>
      ) : null}

      {tax ? (
        <section className="mb-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Quick View</h2>
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">{periodLabel} run rate</div>
          </div>
          <div className="grid grid-cols-6 gap-3 text-sm">
            <QuickMetric label={`Income / ${periodLabel.toLowerCase()}`} value={formatCurrency(metrics.grossForPeriod)} />
            <QuickMetric label={`Tax reserve / ${periodLabel.toLowerCase()}`} value={formatCurrency(metrics.taxForPeriod)} accent="text-red-600" />
            <QuickMetric label={`After tax / ${periodLabel.toLowerCase()}`} value={formatCurrency(metrics.afterTaxForPeriod)} />
            <QuickMetric label={`Needs / ${periodLabel.toLowerCase()}`} value={formatCurrency(metrics.needsForPeriod)} aidFilters={aidFilters} />
            <QuickMetric label={`Wants / ${periodLabel.toLowerCase()}`} value={formatCurrency(metrics.wantsForPeriod)} aidFilters={aidFilters} />
            <QuickMetric
              label={`Left over / ${periodLabel.toLowerCase()}`}
              value={formatCurrency(metrics.allowanceForPeriod)}
              accent={metrics.allowanceForPeriod >= 0 ? 'text-emerald-600' : 'text-red-600'}
              aidFilters={aidFilters}
            />
          </div>
        </section>
      ) : null}

      <section className="mb-5 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Income Sources</h2>
            <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">Annual and monthly edits stay linked.</p>
          </div>
          <button type="button" onClick={() => void addIncomeSource()} className="rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-950">Add Source</button>
        </div>
        <div className="grid grid-cols-[1fr_142px_142px_174px_86px] gap-3 border-b border-zinc-100 bg-zinc-50/60 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50">
          <div>Source</div>
          <div className="text-right">Annual</div>
          <div className="text-right">Monthly</div>
          <div>Tax type</div>
          <div className="text-right">Remove</div>
        </div>
        {entries.map((entry) => (
          <ExpectedIncomeRow
            key={entry.id}
            entry={entry}
            onUpdate={updateEntry}
            onDelete={async () => {
              setBusy('saving')
              await window.api.deleteExpectedIncomeEntry(entry.id)
              reload()
              bumpDataVersion()
            }}
          />
        ))}
      </section>

      {settings && tax ? (
        <section className="grid grid-cols-[1fr_1fr] gap-5">
          <TaxInputs settings={settings} onUpdate={updateSettings} onExplain={openExplanation} />
          <TaxResults
            result={tax}
            settings={settings}
            needs={metrics.needsMonthly}
            wants={metrics.wantsMonthly}
            onExplain={openExplanation}
          />
        </section>
      ) : null}
      {explanation ? <ExplanationPopover explanation={explanation} aidFilters={aidFilters} onClose={() => setExplanation(null)} /> : null}
      {busy !== 'idle' ? (
        <div className="pointer-events-none absolute right-8 top-8 rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.1em] text-white dark:bg-zinc-100 dark:text-zinc-950">
          {busy === 'loading' ? 'Loading…' : 'Saving…'}
        </div>
      ) : null}
    </div>
  )
}

export function IncomeActual() {
  const { dataVersion, bumpDataVersion, anchor, setAnchor, period, setPeriod } = useAppContext()
  const { formatDate } = useDateFormat()
  const [entries, setEntries] = useState<IncomeEntry[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [customIncomeTypes, setCustomIncomeTypes] = useState<string[]>(() => loadCustomIncomeTypes())
  const [hiddenIncomeTypes, setHiddenIncomeTypes] = useState<Set<string>>(() => loadHiddenIncomeTypes())
  const [, setIncomeTypeColorRevision] = useState(0)
  const [sortKey, setSortKey] = useState<IncomeSortKey>(() => getStoredIncomeSort())
  const [sortOpen, setSortOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [deleteAllArmed, setDeleteAllArmed] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ entryId: number; x: number; y: number; confirming?: boolean } | null>(null)
  const [hasUndoActions, setHasUndoActions] = useState(false)
  const [incomeSearchFieldOpen, setIncomeSearchFieldOpen] = useState(false)
  const [incomeSearchQuery, setIncomeSearchQuery] = useState('')
  const [incomeSearchPhase, setIncomeSearchPhase] = useState<ListSearchPhase>(1)
  const undoStackRef = useRef<IncomeUndoAction[]>([])
  const sortRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return subscribeIncomeTypeColors(() => {
      setIncomeTypeColorRevision((value) => value + 1)
    })
  }, [])

  const { start, end } = getDisplayPeriodBounds(anchor, period)

  useEffect(() => {
    window.api.getIncomeEntries().then(setEntries)
  }, [dataVersion])

  useEffect(() => { localStorage.setItem(INCOME_SORT_KEY, sortKey) }, [sortKey])

  useEffect(() => {
    if (!sortOpen) return
    function onClickAway(e: PointerEvent): void { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false) }
    function onEsc(e: KeyboardEvent): void { if (e.key === 'Escape') setSortOpen(false) }
    document.addEventListener('pointerdown', onClickAway)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('pointerdown', onClickAway); document.removeEventListener('keydown', onEsc) }
  }, [sortOpen])

  useEffect(() => {
    if (!calendarOpen) return
    function onClickAway(e: PointerEvent): void { if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) setCalendarOpen(false) }
    function onEsc(e: KeyboardEvent): void { if (e.key === 'Escape') setCalendarOpen(false) }
    document.addEventListener('pointerdown', onClickAway)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('pointerdown', onClickAway); document.removeEventListener('keydown', onEsc) }
  }, [calendarOpen])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey) }
  }, [contextMenu])

  const periodEntries = useMemo(
    () => entries.filter((entry) => entry.date >= start && entry.date <= end),
    [end, entries, start]
  )
  const incomeTypeOptions = useMemo(() => buildIncomeTypeOptions(entries, customIncomeTypes, hiddenIncomeTypes), [customIncomeTypes, entries, hiddenIncomeTypes])
  const periodIncomeTypeOptions = useMemo(() => buildPeriodIncomeTypeOptions(periodEntries, hiddenIncomeTypes), [hiddenIncomeTypes, periodEntries])
  const visibleEntries = useMemo(
    () =>
      periodEntries.filter((entry) => {
        if (selectedTypes.length === 0) return true
        if (!selectedTypes.includes(resolveIncomeType(entry))) return false
        return true
      }),
    [periodEntries, selectedTypes]
  )
  const sortedEntries = useMemo(
    () => {
      const list = [...visibleEntries]
      if (sortKey === 'amount') return list.sort((a, b) => b.amount - a.amount)
      if (sortKey === 'type') return list.sort((a, b) => {
        const byType = resolveIncomeType(a).localeCompare(resolveIncomeType(b))
        return byType !== 0 ? byType : b.date - a.date
      })
      return list.sort((a, b) => b.date - a.date)
    },
    [visibleEntries, sortKey]
  )

  const incomePhase1Filtered = useMemo(() => {
    const q = incomeSearchQuery.trim().toLowerCase()
    if (!q) return sortedEntries
    return sortedEntries.filter((entry) => `${entry.shoot_name} ${entry.company}`.toLowerCase().includes(q))
  }, [sortedEntries, incomeSearchQuery])

  const incomeSearchFiltered = useMemo(() => {
    const q = incomeSearchQuery.trim().toLowerCase()
    if (!q) return sortedEntries
    if (incomeSearchPhase === 1) {
      return sortedEntries.filter((entry) => `${entry.shoot_name} ${entry.company}`.toLowerCase().includes(q))
    }
    return sortedEntries.filter((entry) => {
      const blob = [
        entry.shoot_name,
        entry.company,
        resolveIncomeType(entry),
        entry.notes,
        formatCurrency(entry.amount),
        String(entry.amount),
        formatDate(entry.date)
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [formatDate, incomeSearchPhase, incomeSearchQuery, sortedEntries])

  const incomeSearchShowEnterHint =
    incomeSearchFieldOpen && incomeSearchPhase === 1 && Boolean(incomeSearchQuery.trim()) && incomePhase1Filtered.length === 0

  const handleIncomeSearchKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (incomeSearchPhase !== 1) return
      const q = incomeSearchQuery.trim()
      if (!q) return
      const any = sortedEntries.some((entry) => `${entry.shoot_name} ${entry.company}`.toLowerCase().includes(q.toLowerCase()))
      if (!any) setIncomeSearchPhase(2)
    },
    [incomeSearchPhase, incomeSearchQuery, sortedEntries]
  )

  useEffect(() => {
    setSelectedTypes((current) => current.filter((type) => periodIncomeTypeOptions.includes(type)))
  }, [periodIncomeTypeOptions])

  const periodTotal = periodEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const visibleTotal = visibleEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const periodTipTotal = periodEntries.reduce((sum, entry) => sum + (entry.tip ?? 0), 0)
  const filteredTotalPresentation = incomeFilteredTotalPresentation(selectedTypes)

  function toggleType(type: string): void {
    setSelectedTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type])
  }

  const registerCustomIncomeType = useCallback((type: string): void => {
    const trimmed = type.trim()
    if (!trimmed) return
    setCustomIncomeTypes((current) => {
      if (current.includes(trimmed) || DEFAULT_INCOME_TYPES.includes(trimmed as (typeof DEFAULT_INCOME_TYPES)[number])) return current
      const next = [...current, trimmed].sort((a, b) => a.localeCompare(b))
      localStorage.setItem(INCOME_CUSTOM_TYPES_KEY, JSON.stringify(next))
      return next
    })
    setHiddenIncomeTypes((current) => {
      if (!current.has(trimmed)) return current
      const next = new Set(current)
      next.delete(trimmed)
      saveHiddenIncomeTypes(next)
      return next
    })
  }, [])

  const unregisterCustomIncomeType = useCallback((type: string): void => {
    const trimmed = type.trim()
    if (!trimmed) return
    setCustomIncomeTypes((current) => {
      const next = current.filter((item) => item !== trimmed)
      localStorage.setItem(INCOME_CUSTOM_TYPES_KEY, JSON.stringify(next))
      return next
    })
    setSelectedTypes((current) => current.filter((item) => item !== trimmed))
    setHiddenIncomeTypes((current) => {
      const next = new Set(current)
      next.add(trimmed)
      saveHiddenIncomeTypes(next)
      return next
    })
    const affected = entries.filter((entry) => entry.income_type.trim() === trimmed)
    if (affected.length > 0) {
      setEntries((current) => current.map((entry) => (
        entry.income_type.trim() === trimmed ? { ...entry, income_type: '' } : entry
      )))
      void (async () => {
        for (const entry of affected) {
          await window.api.updateIncomeEntry(entry.id, { income_type: '' })
        }
        bumpDataVersion()
      })()
    }
    removeIncomeTypeColorHex(trimmed)
  }, [bumpDataVersion, entries])

  const renameCustomIncomeType = useCallback((from: string, to: string): void => {
    const fromTrimmed = from.trim()
    const toTrimmed = to.trim()
    if (!fromTrimmed || !toTrimmed || fromTrimmed === toTrimmed) return
    if (DEFAULT_INCOME_TYPES.includes(toTrimmed as (typeof DEFAULT_INCOME_TYPES)[number])) return

    setCustomIncomeTypes((current) => {
      const withoutFrom = current.filter((item) => item !== fromTrimmed)
      const next = withoutFrom.includes(toTrimmed) ? withoutFrom : [...withoutFrom, toTrimmed]
      next.sort((a, b) => a.localeCompare(b))
      localStorage.setItem(INCOME_CUSTOM_TYPES_KEY, JSON.stringify(next))
      return next
    })
    setHiddenIncomeTypes((current) => {
      const next = new Set(current)
      next.add(fromTrimmed)
      next.delete(toTrimmed)
      saveHiddenIncomeTypes(next)
      return next
    })
    setSelectedTypes((current) => current.map((item) => (item === fromTrimmed ? toTrimmed : item)))
    const hex = readIncomeTypeColorHex(fromTrimmed)
    if (hex) {
      setIncomeTypeColorHex(toTrimmed, hex)
      removeIncomeTypeColorHex(fromTrimmed)
    }
    setEntries((current) =>
      current.map((entry) => (
        entry.income_type.trim() === fromTrimmed ? { ...entry, income_type: toTrimmed } : entry
      ))
    )
    const affected = entries.filter((entry) => entry.income_type.trim() === fromTrimmed)
    if (affected.length > 0) {
      void (async () => {
        for (const entry of affected) {
          await window.api.updateIncomeEntry(entry.id, { income_type: toTrimmed })
        }
        bumpDataVersion()
      })()
    }
  }, [bumpDataVersion, entries])

  function pushUndo(action: IncomeUndoAction): void {
    undoStackRef.current.push(action)
    setHasUndoActions(true)
  }

  const undoLastAction = useCallback(async () => {
    const action = undoStackRef.current.pop()
    if (!action) return
    if (undoStackRef.current.length === 0) setHasUndoActions(false)
    if (action.type === 'create_entry' && action.entryId) {
      await window.api.deleteIncomeEntry(action.entryId)
    } else if (action.type === 'delete_entry' && action.entries) {
      for (const entry of action.entries) {
        await window.api.createIncomeEntry({
          shoot_name: entry.shoot_name,
          company: entry.company,
          income_type: entry.income_type,
          date: entry.date,
          amount: entry.amount,
          notes: entry.notes
        })
      }
    }
    bumpDataVersion()
  }, [bumpDataVersion])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void undoLastAction()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [undoLastAction])

  async function deleteEntry(id: number): Promise<void> {
    const entry = entries.find((item) => item.id === id)
    if (entry) pushUndo({ type: 'delete_entry', entries: [entry] })
    await window.api.deleteIncomeEntry(id)
    bumpDataVersion()
  }

  async function deleteAllIncomeEntries(): Promise<void> {
    if (!deleteAllArmed) {
      setDeleteAllArmed(true)
      window.setTimeout(() => setDeleteAllArmed(false), 3500)
      return
    }
    const toDelete = [...visibleEntries]
    if (toDelete.length === 0) return
    pushUndo({ type: 'delete_entry', entries: toDelete })
    for (const entry of toDelete) {
      await window.api.deleteIncomeEntry(entry.id)
    }
    setDeleteAllArmed(false)
    bumpDataVersion()
  }

  const handleAddDone = useCallback((created?: IncomeEntry) => {
    setAdding(false)
    if (created) {
      pushUndo({ type: 'create_entry', entryId: created.id })
      bumpDataVersion()
    }
  }, [bumpDataVersion])

  const hasFilterSelection = selectedTypes.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="flex min-h-0 flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Income</h1>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title={`${incomeSearchFiltered.length} visible of ${periodEntries.length} in period`}>
                  {incomeSearchFiltered.length}
                </span>
              </div>
              <div className="mt-2 flex items-end gap-6">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Total Income</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight text-emerald-700 tabular-nums dark:text-emerald-300">{formatCurrency(periodTotal)}</div>
                </div>
                {hasFilterSelection ? (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Filtered Income</div>
                    <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums" style={filteredTotalPresentation.style}>{formatCurrency(visibleTotal)}</div>
                  </div>
                ) : null}
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Total Tips</div>
                  <div className="mt-1 text-lg font-semibold tracking-tight text-emerald-700 tabular-nums dark:text-emerald-300">{formatCurrency(periodTipTotal)}</div>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Income period">
                  <SegmentedButton active={period === 'week'} onClick={() => setPeriod('week')}>Week</SegmentedButton>
                  <SegmentedButton active={period === 'month'} onClick={() => setPeriod('month')}>Month</SegmentedButton>
                  <SegmentedButton active={period === 'year'} onClick={() => setPeriod('year')}>Year</SegmentedButton>
                </div>
              </div>
              <div ref={calendarRef} className="relative">
                <div className="flex items-center rounded-full border border-zinc-200 bg-white text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <button type="button" onClick={() => setAnchor((value) => stepDisplayAnchor(value, period, -1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Previous">
                    <span className="inline-block -rotate-90"><ChevronIcon direction="up" /></span>
                  </button>
                  <div className="min-w-[120px] text-center text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{formatDisplayAnchor(anchor, period)}</div>
                  <button type="button" onClick={() => setCalendarOpen((value) => !value)} className="px-1 text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200" aria-label="Open calendar"><CalendarIcon /></button>
                  <button type="button" onClick={() => setAnchor((value) => stepDisplayAnchor(value, period, 1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Next">
                    <span className="inline-block rotate-90"><ChevronIcon direction="up" /></span>
                  </button>
                </div>
                {calendarOpen ? <IncomeCalendarDropdown period={period} anchor={anchor} onSelect={(date) => { setAnchor(date); setCalendarOpen(false) }} /> : null}
              </div>
            </div>
          </div>

          <div className="min-w-0">
              {periodIncomeTypeOptions.length > 0 ? (
                <IncomeTypeFilterBar
                  incomeTypes={periodIncomeTypeOptions}
                  selectedTypes={selectedTypes}
                  onToggleType={toggleType}
                />
              ) : null}
          <section className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <div className="relative flex items-start gap-2 px-4 pb-1 pt-2">
                <div className="flex min-w-0 flex-1 items-start justify-start">
                  <ListSectionSearchBar
                  placeholder="Search income..."
                  value={incomeSearchQuery}
                  onChange={(value) => {
                    setIncomeSearchQuery(value)
                    setIncomeSearchPhase(1)
                  }}
                  fieldOpen={incomeSearchFieldOpen}
                  onFieldOpen={() => setIncomeSearchFieldOpen(true)}
                  onFieldClose={() => {
                    setIncomeSearchFieldOpen(false)
                    setIncomeSearchQuery('')
                    setIncomeSearchPhase(1)
                  }}
                  phase={incomeSearchPhase}
                  onPhaseReset={() => setIncomeSearchPhase(1)}
                  showPressEnterHint={incomeSearchShowEnterHint}
                  enterHintText="Press Enter to search all income data"
                  onInputKeyDown={handleIncomeSearchKeyDown}
                />
                </div>
                <div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 items-center">
                  <button type="button" onClick={() => setAdding(true)} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:shadow-none dark:hover:border-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" aria-label="Add income"><PlusIcon /></button>
                </div>
                <div ref={sortRef} className="absolute right-12 top-2 md:right-[148px]">
                  <button type="button" onClick={() => setSortOpen((value) => !value)} className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700" aria-haspopup="menu" aria-expanded={sortOpen}>
                    Sort by: {INCOME_SORT_OPTIONS.find((option) => option.id === sortKey)?.label ?? 'Date'}
                  </button>
                  {sortOpen ? (
                    <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[11.5rem] rounded-lg border border-zinc-200/80 bg-white p-1 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
                      {INCOME_SORT_OPTIONS.map((option) => (
                        <button key={option.id} type="button" role="menuitem" onClick={() => { setSortKey(option.id); setSortOpen(false) }} className={`flex w-full rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors ${sortKey === option.id ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950'}`}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 items-start justify-end gap-1">
                  {hasUndoActions ? (
                    <button type="button" onClick={() => void undoLastAction()} className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label="Undo (⌘Z)"><UndoIcon /></button>
                  ) : null}
                  {editMode ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void deleteAllIncomeEntries()}
                        className={`rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${deleteAllArmed ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900' : 'text-zinc-400 hover:text-red-600 dark:hover:text-red-300'}`}
                      >
                        {deleteAllArmed ? 'Confirm Delete All' : 'Delete All'}
                      </button>
                      <button type="button" onClick={() => { setEditMode(false); setDeleteAllArmed(false) }} className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30" aria-label="Done editing"><CheckIcon /></button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setEditMode(true)} className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label="Edit income"><PencilIcon /></button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-[90px_minmax(0,1fr)_130px_minmax(140px,max-content)_50px_100px_64px] items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
                <div>Date</div>
                <div>Shoot</div>
                <div>Name</div>
                <div>Type</div>
                <div className="text-center">Tip</div>
                <div className="text-right">Amount</div>
                <div aria-hidden="true" />
              </div>
              {adding ? <AddIncomeRow anchor={anchor} incomeTypes={incomeTypeOptions} onRegisterType={registerCustomIncomeType} onUnregisterType={unregisterCustomIncomeType} onRenameType={renameCustomIncomeType} onDone={handleAddDone} /> : null}
              {periodEntries.length === 0 && !adding ? (
                <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Paste a shoot summary in chat or add an income row.</div>
              ) : visibleEntries.length === 0 && !adding ? (
                <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No income matches the selected filters.</div>
              ) : incomeSearchFiltered.length === 0 && !adding ? (
                <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No income matches your search.</div>
              ) : (
                incomeSearchFiltered.map((entry) => (
                  <IncomeRow
                    key={entry.id}
                    entry={entry}
                    incomeTypes={incomeTypeOptions}
                    onRegisterType={registerCustomIncomeType}
                    onUnregisterType={unregisterCustomIncomeType}
                    onRenameType={renameCustomIncomeType}
                    editMode={editMode}
                    onChanged={bumpDataVersion}
                    onDelete={() => deleteEntry(entry.id)}
                    onContextMenu={(event) => { event.preventDefault(); setContextMenu({ entryId: entry.id, x: event.clientX, y: event.clientY }) }}
                  />
                ))
              )}
            </section>

            {contextMenu ? (
              <div
                className="fixed z-[100] min-w-[120px] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {contextMenu.confirming ? (
                  <>
                    <button type="button" onClick={async () => { await deleteEntry(contextMenu.entryId); setContextMenu(null) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30">Delete</button>
                    <button type="button" onClick={() => setContextMenu(null)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800">Cancel</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setContextMenu({ ...contextMenu, confirming: true })} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30">
                    <XIcon />Delete
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-zinc-200 bg-white px-4 pb-2 pt-1 md:px-8 dark:border-zinc-800 dark:bg-zinc-950">
        <ChatBox pageId="income-actual" fullWidth />
      </div>
    </div>
  )
}

function ExpectedIncomeRow({ entry, onUpdate, onDelete }: { entry: ExpectedIncomeEntry; onUpdate: (id: number, data: Partial<ExpectedIncomeEntry>) => Promise<void>; onDelete: () => Promise<void> }) {
  const monthlyAmount = entry.annual_amount / 12

  return (
    <div className="grid grid-cols-[1fr_142px_142px_174px_86px] items-center gap-3 border-b border-zinc-100 px-4 py-3 text-sm last:border-b-0 dark:border-zinc-800">
      <div className="min-w-0">
        <EditablePlain value={entry.name} onSave={(value) => onUpdate(entry.id, { name: value })} className="font-medium text-zinc-900 dark:text-zinc-100" />
        <EditablePlain value={entry.notes} onSave={(value) => onUpdate(entry.id, { notes: value })} className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400" fallback="No notes" />
      </div>
      <EditablePlain value={formatCurrency(entry.annual_amount)} align="right" onSave={(value) => onUpdate(entry.id, { annual_amount: parseCurrencyInput(value) })} />
      <EditablePlain value={formatCurrency(monthlyAmount)} align="right" onSave={(value) => onUpdate(entry.id, { annual_amount: parseCurrencyInput(value) * 12 })} className="text-zinc-600 dark:text-zinc-300" />
      <IncomeKindMenu value={entry.income_kind} onChange={(value) => onUpdate(entry.id, { income_kind: value })} />
      <button type="button" onClick={() => void onDelete()} className="justify-self-end rounded-full px-2 py-1 text-[12px] font-medium text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-300">Delete</button>
    </div>
  )
}

function IncomeKindMenu({ value, onChange }: { value: IncomeKind; onChange: (value: IncomeKind) => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const selected = INCOME_KIND_OPTIONS.find((option) => option.value === value) ?? INCOME_KIND_OPTIONS[2]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-left text-sm shadow-sm transition-colors hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600"
      >
        <span>
          <span className="block font-medium text-zinc-800 dark:text-zinc-100">{selected.label}</span>
          <span className="block text-[11px] text-zinc-400">{selected.detail}</span>
        </span>
        <ChevronIcon direction={open ? 'up' : 'down'} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-zinc-200 bg-white/95 p-1 shadow-xl shadow-zinc-900/10 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
          {INCOME_KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setOpen(false)
                void onChange(option.value)
              }}
              className={`block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                value === option.value
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="block text-[12px] font-medium">{option.label}</span>
              <span className={`block text-[11px] ${value === option.value ? 'text-white/70 dark:text-zinc-600' : 'text-zinc-400'}`}>{option.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TaxInputs({
  settings,
  onUpdate,
  onExplain
}: {
  settings: IncomeTaxSettings
  onUpdate: (data: Partial<IncomeTaxSettings>) => Promise<void>
  onExplain: (event: MouseEvent, explanation: Omit<Explanation, 'x' | 'y'>) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [globalEditMode, setGlobalEditMode] = useState(false)
  const [draft, setDraft] = useState<IncomeTaxSettings>(settings)

  useEffect(() => {
    if (!globalEditMode) setDraft(settings)
  }, [settings, globalEditMode])

  async function saveGlobalEdits(): Promise<void> {
    await onUpdate({
      retirement_contribution: draft.retirement_contribution,
      above_line_deductions: draft.above_line_deductions,
      federal_standard_deduction: draft.federal_standard_deduction,
      ca_standard_deduction: draft.ca_standard_deduction,
      ca_bracket_adjustment: draft.ca_bracket_adjustment,
      social_security_wage_base: draft.social_security_wage_base
    })
    setGlobalEditMode(false)
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <button 
        type="button" 
        onClick={() => setIsOpen(!isOpen)} 
        className="flex w-full items-center justify-between p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300"
      >
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Editable Tax Assumptions</h2>
            <PencilIcon />
          </div>
          <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">These are saved assumptions used by the calculation rows.</p>
        </div>
        <div className="text-zinc-400 dark:text-zinc-500">
          <ChevronIcon direction={isOpen ? 'up' : 'down'} />
        </div>
      </button>
      {isOpen ? (
        <div className="border-t border-zinc-100 p-4 pt-0 text-sm dark:border-zinc-800">
          <div className="mt-3 flex justify-end">
            {globalEditMode ? (
              <button
                type="button"
                onClick={() => void saveGlobalEdits()}
                className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                aria-label="Save tax assumptions"
              >
                <CheckIcon />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setGlobalEditMode(true)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Edit all tax assumptions"
              >
                <PencilIcon />
              </button>
            )}
          </div>
          <div className="mt-4 space-y-2">
            <TaxInput label="401k / IRA contribution" value={settings.retirement_contribution} draftValue={draft.retirement_contribution} globalEditMode={globalEditMode} onDraftChange={(value) => setDraft((d) => ({ ...d, retirement_contribution: value }))} onSave={(value) => onUpdate({ retirement_contribution: value })} onExplain={(event) => onExplain(event, inputExplanation('401k / IRA contribution', 'Pre-tax retirement contributions reduce the federal AGI estimate used here.', globalEditMode ? draft.retirement_contribution : settings.retirement_contribution))} />
            <TaxInput label="Above-the-line deductions" value={settings.above_line_deductions} draftValue={draft.above_line_deductions} globalEditMode={globalEditMode} onDraftChange={(value) => setDraft((d) => ({ ...d, above_line_deductions: value }))} onSave={(value) => onUpdate({ above_line_deductions: value })} onExplain={(event) => onExplain(event, inputExplanation('Above-the-line deductions', 'Additional deductions subtracted before taxable income is calculated.', globalEditMode ? draft.above_line_deductions : settings.above_line_deductions))} />
            <TaxInput label="Federal standard deduction" value={settings.federal_standard_deduction} draftValue={draft.federal_standard_deduction} globalEditMode={globalEditMode} onDraftChange={(value) => setDraft((d) => ({ ...d, federal_standard_deduction: value }))} onSave={(value) => onUpdate({ federal_standard_deduction: value })} onExplain={(event) => onExplain(event, inputExplanation('Federal standard deduction', 'Deduction subtracted from federal AGI to estimate federal taxable income.', globalEditMode ? draft.federal_standard_deduction : settings.federal_standard_deduction))} />
            <TaxInput label="CA standard deduction" value={settings.ca_standard_deduction} draftValue={draft.ca_standard_deduction} globalEditMode={globalEditMode} onDraftChange={(value) => setDraft((d) => ({ ...d, ca_standard_deduction: value }))} onSave={(value) => onUpdate({ ca_standard_deduction: value })} onExplain={(event) => onExplain(event, inputExplanation('CA standard deduction', 'Deduction subtracted from federal AGI for the California taxable estimate.', globalEditMode ? draft.ca_standard_deduction : settings.ca_standard_deduction))} />
            <TaxInput label="CA bracket adjustment" value={settings.ca_bracket_adjustment} draftValue={draft.ca_bracket_adjustment} globalEditMode={globalEditMode} onDraftChange={(value) => setDraft((d) => ({ ...d, ca_bracket_adjustment: value }))} onSave={(value) => onUpdate({ ca_bracket_adjustment: value })} onExplain={(event) => onExplain(event, inputExplanation('CA bracket adjustment', 'Adjustment applied before running the California bracket estimate.', globalEditMode ? draft.ca_bracket_adjustment : settings.ca_bracket_adjustment))} />
            <TaxInput label="Social Security wage base" value={settings.social_security_wage_base} draftValue={draft.social_security_wage_base} globalEditMode={globalEditMode} onDraftChange={(value) => setDraft((d) => ({ ...d, social_security_wage_base: value }))} onSave={(value) => onUpdate({ social_security_wage_base: value })} onExplain={(event) => onExplain(event, inputExplanation('Social Security wage base', 'Maximum W-2 wage amount subject to Social Security tax in this estimate.', globalEditMode ? draft.social_security_wage_base : settings.social_security_wage_base))} />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function TaxResults({
  result,
  settings,
  needs,
  wants,
  onExplain
}: {
  result: ReturnType<typeof calculateIncomeTaxes>
  settings: IncomeTaxSettings
  needs: number
  wants: number
  onExplain: (event: MouseEvent, explanation: Omit<Explanation, 'x' | 'y'>) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <button 
        type="button" 
        onClick={() => setIsOpen(!isOpen)} 
        className="flex w-full items-center justify-between p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300"
      >
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tax Calculation</h2>
          <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">Gross income flows through deductions, taxable income, payroll tax, and take-home.</p>
        </div>
        <div className="text-zinc-400 dark:text-zinc-500">
          <ChevronIcon direction={isOpen ? 'up' : 'down'} />
        </div>
      </button>
      {isOpen ? (
        <div className="border-t border-zinc-100 p-4 pt-0 text-sm dark:border-zinc-800">
          <div className="mt-4 space-y-4">
            <TaxGroup title="Income base">
              <Readout label="Gross income" value={formatCurrency(result.grossIncome)} onExplain={(event) => onExplain(event, taxExplanation('grossIncome', result, settings, needs, wants))} />
              <Readout label="W-2 income" value={formatCurrency(result.w2Income)} onExplain={(event) => onExplain(event, taxExplanation('w2Income', result, settings, needs, wants))} />
              <Readout label="Self-employment income" value={formatCurrency(result.selfEmploymentIncome)} onExplain={(event) => onExplain(event, taxExplanation('selfEmploymentIncome', result, settings, needs, wants))} />
              <Readout label="Half SE tax deduction" value={formatCurrency(result.halfSelfEmploymentTaxDeduction)} onExplain={(event) => onExplain(event, taxExplanation('halfSelfEmploymentTaxDeduction', result, settings, needs, wants))} />
              <Readout label="Federal AGI" value={formatCurrency(result.federalAgi)} strong onExplain={(event) => onExplain(event, taxExplanation('federalAgi', result, settings, needs, wants))} />
            </TaxGroup>
            <TaxGroup title="Taxable income">
              <Readout label="Federal taxable income" value={formatCurrency(result.federalTaxableIncome)} onExplain={(event) => onExplain(event, taxExplanation('federalTaxableIncome', result, settings, needs, wants))} />
              <Readout label="CA taxable income" value={formatCurrency(result.caTaxableIncome)} onExplain={(event) => onExplain(event, taxExplanation('caTaxableIncome', result, settings, needs, wants))} />
            </TaxGroup>
            <TaxGroup title="Estimated taxes">
              <Readout label="Federal income tax" value={formatCurrency(result.federalIncomeTax)} onExplain={(event) => onExplain(event, taxExplanation('federalIncomeTax', result, settings, needs, wants))} />
              <Readout label="California income tax" value={formatCurrency(result.caIncomeTax)} onExplain={(event) => onExplain(event, taxExplanation('caIncomeTax', result, settings, needs, wants))} />
              <Readout label="Social Security" value={formatCurrency(result.socialSecurityTax)} onExplain={(event) => onExplain(event, taxExplanation('socialSecurityTax', result, settings, needs, wants))} />
              <Readout label="Medicare" value={formatCurrency(result.medicareTax)} onExplain={(event) => onExplain(event, taxExplanation('medicareTax', result, settings, needs, wants))} />
              <Readout label="Self-employment tax" value={formatCurrency(result.selfEmploymentTax)} onExplain={(event) => onExplain(event, taxExplanation('selfEmploymentTax', result, settings, needs, wants))} />
            </TaxGroup>
            <TaxGroup title="Take-home">
              <Readout label="Total taxes" value={formatCurrency(result.totalTaxes)} onExplain={(event) => onExplain(event, taxExplanation('totalTaxes', result, settings, needs, wants))} />
              <Readout label="Effective rate" value={`${(result.effectiveRate * 100).toFixed(1)}%`} onExplain={(event) => onExplain(event, taxExplanation('effectiveRate', result, settings, needs, wants))} />
              <Readout label="After taxes" value={formatCurrency(result.afterTaxIncome)} strong onExplain={(event) => onExplain(event, taxExplanation('afterTaxIncome', result, settings, needs, wants))} />
            </TaxGroup>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function inputExplanation(title: string, summary: string, value: number): Omit<Explanation, 'x' | 'y'> {
  return {
    title,
    summary,
    calculation: 'Editable assumption. The saved value is inserted into the tax estimate wherever this row is referenced.',
    points: [{ label: 'Saved value', value: formatCurrency(value) }]
  }
}

function taxExplanation(
  key: string,
  result: ReturnType<typeof calculateIncomeTaxes>,
  settings: IncomeTaxSettings,
  needs: number,
  wants: number
): Omit<Explanation, 'x' | 'y'> {
  const totalPlan = needs + wants
  const monthlyAfterTax = result.afterTaxIncome / 12

  switch (key) {
    case 'grossIncome':
      return {
        title: 'Gross income',
        summary: 'Total expected annual income before deductions and taxes.',
        calculation: 'Sum of every income source annual amount.',
        points: [
          { label: 'W-2 income', value: formatCurrency(result.w2Income) },
          { label: 'Self-employment income', value: formatCurrency(result.selfEmploymentIncome) },
          { label: 'Other income', value: formatCurrency(result.grossIncome - result.w2Income - result.selfEmploymentIncome) },
          { label: 'Gross income', value: formatCurrency(result.grossIncome) }
        ]
      }
    case 'w2Income':
      return {
        title: 'W-2 income',
        summary: 'Income marked as payroll work.',
        calculation: 'Sum of income sources with tax type W-2.',
        points: [{ label: 'W-2 income', value: formatCurrency(result.w2Income) }]
      }
    case 'selfEmploymentIncome':
      return {
        title: 'Self-employment income',
        summary: 'Income marked as freelance, 1099, or self-employed work.',
        calculation: 'Sum of income sources with tax type Self-employed.',
        points: [{ label: 'Self-employment income', value: formatCurrency(result.selfEmploymentIncome) }]
      }
    case 'halfSelfEmploymentTaxDeduction':
      return {
        title: 'Half SE tax deduction',
        summary: 'The deductible half of estimated self-employment tax.',
        calculation: 'Self-employment tax divided by 2.',
        points: [
          { label: 'Self-employment tax', value: formatCurrency(result.selfEmploymentTax) },
          { label: 'Deductible half', value: formatCurrency(result.halfSelfEmploymentTaxDeduction) }
        ]
      }
    case 'federalAgi':
      return {
        title: 'Federal AGI',
        summary: 'Adjusted gross income estimate before the standard deduction.',
        calculation: 'Gross income - retirement contribution - above-the-line deductions - half SE tax deduction.',
        points: [
          { label: 'Gross income', value: formatCurrency(result.grossIncome) },
          { label: 'Retirement contribution', value: `-${formatCurrency(settings.retirement_contribution)}` },
          { label: 'Above-the-line deductions', value: `-${formatCurrency(settings.above_line_deductions)}` },
          { label: 'Half SE tax deduction', value: `-${formatCurrency(result.halfSelfEmploymentTaxDeduction)}` },
          { label: 'Federal AGI', value: formatCurrency(result.federalAgi) }
        ]
      }
    case 'federalTaxableIncome':
      return {
        title: 'Federal taxable income',
        summary: 'Income passed into the federal tax bracket estimate.',
        calculation: 'Federal AGI - federal standard deduction, floored at zero.',
        points: [
          { label: 'Federal AGI', value: formatCurrency(result.federalAgi) },
          { label: 'Standard deduction', value: `-${formatCurrency(settings.federal_standard_deduction)}` },
          { label: 'Taxable income', value: formatCurrency(result.federalTaxableIncome) }
        ]
      }
    case 'caTaxableIncome':
      return {
        title: 'CA taxable income',
        summary: 'California taxable income estimate before the app-level bracket adjustment.',
        calculation: 'Federal AGI - CA standard deduction, floored at zero.',
        points: [
          { label: 'Federal AGI', value: formatCurrency(result.federalAgi) },
          { label: 'CA standard deduction', value: `-${formatCurrency(settings.ca_standard_deduction)}` },
          { label: 'CA taxable income', value: formatCurrency(result.caTaxableIncome) }
        ]
      }
    case 'federalIncomeTax':
      return {
        title: 'Federal income tax',
        summary: 'Estimated federal bracket tax on taxable income.',
        calculation: 'Federal taxable income is passed through the app federal single-filer bracket table.',
        points: [
          { label: 'Federal taxable income', value: formatCurrency(result.federalTaxableIncome) },
          { label: 'Federal income tax', value: formatCurrency(result.federalIncomeTax) }
        ]
      }
    case 'caIncomeTax':
      return {
        title: 'California income tax',
        summary: 'Estimated California bracket tax.',
        calculation: 'Max(CA taxable income - CA bracket adjustment, 0) is passed through the app CA bracket table.',
        points: [
          { label: 'CA taxable income', value: formatCurrency(result.caTaxableIncome) },
          { label: 'CA bracket adjustment', value: `-${formatCurrency(settings.ca_bracket_adjustment)}` },
          { label: 'CA bracket base', value: formatCurrency(Math.max(0, result.caTaxableIncome - settings.ca_bracket_adjustment)) },
          { label: 'California income tax', value: formatCurrency(result.caIncomeTax) }
        ]
      }
    case 'socialSecurityTax':
      return {
        title: 'Social Security',
        summary: 'Payroll Social Security estimate for W-2 income.',
        calculation: 'Min(W-2 income, Social Security wage base) x 6.2%.',
        points: [
          { label: 'W-2 income', value: formatCurrency(result.w2Income) },
          { label: 'Wage base', value: formatCurrency(settings.social_security_wage_base) },
          { label: 'Taxed wages', value: formatCurrency(Math.min(Math.max(0, result.w2Income), settings.social_security_wage_base)) },
          { label: 'Social Security', value: formatCurrency(result.socialSecurityTax) }
        ]
      }
    case 'medicareTax':
      return {
        title: 'Medicare',
        summary: 'Payroll Medicare estimate for W-2 income.',
        calculation: 'W-2 income x 1.45%.',
        points: [
          { label: 'W-2 income', value: formatCurrency(result.w2Income) },
          { label: 'Medicare', value: formatCurrency(result.medicareTax) }
        ]
      }
    case 'selfEmploymentTax':
      return {
        title: 'Self-employment tax',
        summary: 'Estimated Social Security and Medicare tax on self-employment income.',
        calculation: 'Self-employment income x 92.35% x 15.3%.',
        points: [
          { label: 'Self-employment income', value: formatCurrency(result.selfEmploymentIncome) },
          { label: 'Taxable SE base', value: formatCurrency(Math.round(Math.max(0, result.selfEmploymentIncome) * 0.9235)) },
          { label: 'Self-employment tax', value: formatCurrency(result.selfEmploymentTax) }
        ]
      }
    case 'totalTaxes':
      return {
        title: 'Total taxes',
        summary: 'Combined estimated income and payroll taxes.',
        calculation: 'Federal income tax + California income tax + Social Security + Medicare + self-employment tax.',
        points: [
          { label: 'Federal income tax', value: formatCurrency(result.federalIncomeTax) },
          { label: 'California income tax', value: formatCurrency(result.caIncomeTax) },
          { label: 'Social Security', value: formatCurrency(result.socialSecurityTax) },
          { label: 'Medicare', value: formatCurrency(result.medicareTax) },
          { label: 'Self-employment tax', value: formatCurrency(result.selfEmploymentTax) },
          { label: 'Total taxes', value: formatCurrency(result.totalTaxes) }
        ]
      }
    case 'effectiveRate':
      return {
        title: 'Effective rate',
        summary: 'Share of gross income estimated for taxes.',
        calculation: 'Total taxes divided by gross income.',
        points: [
          { label: 'Total taxes', value: formatCurrency(result.totalTaxes) },
          { label: 'Gross income', value: formatCurrency(result.grossIncome) },
          { label: 'Effective rate', value: `${(result.effectiveRate * 100).toFixed(1)}%` }
        ]
      }
    case 'afterTaxIncome':
      return {
        title: 'After taxes',
        summary: 'Expected annual take-home after estimated taxes.',
        calculation: 'Gross income - total taxes.',
        points: [
          { label: 'Gross income', value: formatCurrency(result.grossIncome) },
          { label: 'Total taxes', value: `-${formatCurrency(result.totalTaxes)}` },
          { label: 'After taxes', value: formatCurrency(result.afterTaxIncome) }
        ]
      }
    case 'monthlyLeftOver':
      return {
        title: 'Monthly left over',
        summary: 'Expected monthly money remaining after taxes, needs, and wants.',
        calculation: 'After-tax annual income / 12 - needs per month - wants per month.',
        points: [
          { label: 'After tax / mo', value: formatCurrency(monthlyAfterTax) },
          { label: 'Needs / mo', value: `-${formatCurrency(needs)}`, aidAdjusted: true },
          { label: 'Wants / mo', value: `-${formatCurrency(wants)}`, aidAdjusted: true },
          { label: 'Budget plan / mo', value: formatCurrency(totalPlan), aidAdjusted: true },
          { label: 'Left over / mo', value: formatCurrency(monthlyAfterTax - totalPlan), aidAdjusted: true }
        ]
      }
    default:
      return {
        title: 'Calculation',
        summary: 'This row is derived from the expected income and tax assumptions.',
        calculation: 'The app recalculates this value when sources or tax inputs change.',
        points: []
      }
  }
}

function ExplanationPopover({ explanation, aidFilters, onClose }: { explanation: Explanation; aidFilters: Set<BudgetAidFilter>; onClose: () => void }) {
  const left = Math.min(explanation.x + 12, window.innerWidth - 380)
  const top = Math.max(16, Math.min(explanation.y + 12, window.innerHeight - 420))

  return (
    <div
      role="dialog"
      aria-label={explanation.title}
      onClick={(event) => event.stopPropagation()}
      style={{ left: Math.max(16, left), top, maxHeight: `calc(100vh - ${top + 16}px)` }}
      className="fixed z-50 w-[360px] overflow-y-auto rounded-2xl border border-zinc-200 bg-white/92 p-4 shadow-2xl shadow-zinc-900/15 backdrop-blur-xl dark:border-zinc-700 dark:bg-zinc-900/92 dark:shadow-black/35"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">Calculation</div>
          <h3 className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{explanation.title}</h3>
        </div>
        <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-[12px] font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">Close</button>
      </div>
      <p className="mt-3 text-sm leading-5 text-zinc-600 dark:text-zinc-300">{explanation.summary}</p>
      <div className="mt-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">Formula</div>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{explanation.calculation}</p>
      </div>
      {explanation.points.length ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-100 dark:border-zinc-800">
          {explanation.points.map((point) => (
            <div key={point.label} className="flex items-center justify-between gap-4 border-b border-zinc-100 px-3 py-2 text-sm last:border-b-0 dark:border-zinc-800">
              <span className="inline-flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                {point.label}
                {point.aidAdjusted ? <BudgetAidIndicators filters={aidFilters} /> : null}
              </span>
              <span className="font-medium tabular-nums text-zinc-800 dark:text-zinc-100">{point.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
      {children}
    </button>
  )
}

function IncomeTypeFilterBar({
  incomeTypes,
  selectedTypes,
  onToggleType
}: {
  incomeTypes: string[]
  selectedTypes: string[]
  onToggleType: (type: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="shrink-0 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">Filters</div>
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-3 py-2" role="group" aria-label="Income type filters">
        {incomeTypes.map((type) => (
          <IncomeTypeFilterPill key={type} type={type} active={selectedTypes.includes(type)} onClick={() => onToggleType(type)} />
        ))}
      </div>
    </div>
  )
}

function IncomeTypeFilterPill({ type, active, onClick }: { type: string; active: boolean; onClick: () => void }) {
  const activePresentation = active
    ? incomeTypeChipPresentation(
      type,
      `inline-flex shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 ${incomeBadgeClass(type)}`
    )
    : null
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={activePresentation?.className ?? 'inline-flex shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'}
      style={activePresentation?.style}
    >
      {type}
    </button>
  )
}


function IncomeRow({ entry, incomeTypes, onRegisterType, onUnregisterType, onRenameType, editMode, onChanged, onDelete, onContextMenu }: {
  entry: IncomeEntry
  incomeTypes: string[]
  onRegisterType: (type: string) => void
  onUnregisterType: (type: string) => void
  onRenameType: (from: string, to: string) => void
  editMode: boolean
  onChanged: () => void
  onDelete: () => Promise<void>
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const [activeField, setActiveField] = useState<IncomeEditField>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [dateDraft, setDateDraft] = useState(formatIncomeDateInput(entry.date))
  const [shootDraft, setShootDraft] = useState(entry.shoot_name)
  const [companyDraft, setCompanyDraft] = useState(entry.company)
  const [typeDraft, setTypeDraft] = useState(resolveIncomeType(entry))
  const [tipDraft, setTipDraft] = useState(entry.tip ? formatWholeDollarCurrency(entry.tip) : '')
  const [amountDraft, setAmountDraft] = useState(formatCurrency(entry.amount))
  const [notesDraft, setNotesDraft] = useState(entry.notes)
  const rowRef = useRef<HTMLDivElement>(null)
  const notesPanelRef = useRef<IncomeNotesPanelHandle>(null)
  const savingRef = useRef(false)
  const commitRef = useRef<() => void>(() => {})
  const { formatDate } = useDateFormat()

  useEffect(() => {
    if (activeField) return
    setDateDraft(formatIncomeDateInput(entry.date))
    setShootDraft(entry.shoot_name)
    setCompanyDraft(entry.company)
    setTypeDraft(resolveIncomeType(entry))
    setTipDraft(entry.tip ? formatWholeDollarCurrency(entry.tip) : '')
    setAmountDraft(formatCurrency(entry.amount))
    setNotesDraft(entry.notes)
  }, [activeField, entry])

  const saveField = useCallback(async (): Promise<void> => {
    if (savingRef.current) return
    savingRef.current = true
    try {
      await window.api.updateIncomeEntry(entry.id, {
        date: parseIncomeDateInput(dateDraft, entry.date),
        shoot_name: shootDraft.trim(),
        company: companyDraft.trim(),
        income_type: typeDraft.trim(),
        amount: parseCurrencyInput(amountDraft),
        tip: tipDraft.trim() ? parseWholeDollarInput(tipDraft) : null,
        notes: notesDraft
      })
      onChanged()
    } finally {
      savingRef.current = false
    }
  }, [amountDraft, companyDraft, dateDraft, entry, notesDraft, onChanged, shootDraft, tipDraft, typeDraft])

  const commitAndDeactivate = useCallback((): void => {
    if (activeField === 'notes') {
      const next = notesPanelRef.current?.save()
      if (next !== undefined) setNotesDraft(next)
      setActiveField(null)
      return
    }
    void saveField()
    setActiveField(null)
  }, [activeField, saveField])
  commitRef.current = commitAndDeactivate

  useEffect(() => {
    if (!activeField) return
    const handler = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rowRef.current?.contains(target)) return
      if (target instanceof Element && target.closest(`${INCOME_TYPE_MENU_SELECTOR}, ${INCOME_TYPE_COLOR_EDITOR_SELECTOR}`)) return
      commitRef.current()
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [activeField])

  function handleKeyDown(event: ReactKeyboardEvent): void {
    if (event.key === 'Enter' && activeField !== 'notes') {
      event.preventDefault()
      commitAndDeactivate()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDateDraft(formatIncomeDateInput(entry.date))
      setShootDraft(entry.shoot_name)
      setCompanyDraft(entry.company)
      setTypeDraft(resolveIncomeType(entry))
      setTipDraft(entry.tip ? formatWholeDollarCurrency(entry.tip) : '')
      setAmountDraft(formatCurrency(entry.amount))
      setNotesDraft(entry.notes)
      setActiveField(null)
    }
  }

  function toggleNotes(): void {
    if (notesOpen) {
      if (activeField === 'notes') {
        const next = notesPanelRef.current?.save()
        if (next !== undefined) setNotesDraft(next)
      }
      setActiveField(null)
      setNotesOpen(false)
      return
    }
    setNotesOpen(true)
  }

  const resolvedType = resolveIncomeType(entry)
  const editAllTextFields = activeField === 'all'
  const unsetTypeClassName = 'inline-flex h-6 w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400 ring-1 ring-inset ring-zinc-200 bg-zinc-50 dark:bg-zinc-900/70 dark:text-zinc-500 dark:ring-zinc-800'
  const typeChipPresentation = resolvedType
    ? incomeTypeChipPresentation(
      resolvedType,
      `inline-flex h-6 w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset ${incomeBadgeClass(resolvedType)}`
    )
    : { className: unsetTypeClassName, style: undefined }

  return (
    <div ref={rowRef} className="group/row border-b border-zinc-100 last:border-b-0 dark:border-zinc-800" onContextMenu={onContextMenu}>
      <div className="grid grid-cols-[90px_minmax(0,1fr)_130px_minmax(140px,max-content)_50px_100px_64px] items-center gap-2 px-4 py-2.5 text-sm">
        {activeField === 'date' || editAllTextFields ? (
          <input autoFocus={activeField === 'date' || activeField === 'all'} value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} onKeyDown={handleKeyDown} className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-sm tabular-nums text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800" />
        ) : (
          <button type="button" onClick={() => setActiveField('date')} className="flex h-7 min-w-0 items-center text-left text-zinc-500 dark:text-zinc-400">{formatDate(entry.date)}</button>
        )}

        {activeField === 'shoot_name' || editAllTextFields ? (
          <input autoFocus={activeField === 'shoot_name'} value={shootDraft} onChange={(event) => setShootDraft(event.target.value)} onKeyDown={handleKeyDown} className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800" />
        ) : (
          <button type="button" onClick={() => setActiveField('shoot_name')} className="flex h-7 min-w-0 items-center truncate text-left font-medium text-zinc-900 dark:text-zinc-100">{entry.shoot_name || 'Untitled income'}</button>
        )}

        {activeField === 'company' || editAllTextFields ? (
          <input autoFocus={activeField === 'company'} value={companyDraft} onChange={(event) => setCompanyDraft(event.target.value)} onKeyDown={handleKeyDown} className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800" />
        ) : (
          <button type="button" onClick={() => setActiveField('company')} className="flex h-7 min-w-0 items-center truncate text-left text-zinc-500 dark:text-zinc-400">{entry.company || 'No name'}</button>
        )}

        {activeField === 'income_type' ? (
          <IncomeTypeField
            value={typeDraft}
            incomeTypes={incomeTypes}
            onChange={setTypeDraft}
            onRegisterType={onRegisterType}
            onUnregisterType={onUnregisterType}
            onRenameType={onRenameType}
            onCommittedPick={(type) => {
              setTypeDraft(type)
              void (async () => {
                await window.api.updateIncomeEntry(entry.id, { income_type: type })
                onChanged()
                if (!type.trim()) return
                setActiveField(null)
              })()
            }}
            onKeyDown={handleKeyDown}
            placeholder="-"
            buttonClassName={typeDraft.trim() ? undefined : unsetTypeClassName}
          />
        ) : (
          <button type="button" onClick={() => setActiveField('income_type')} className={typeChipPresentation.className} style={typeChipPresentation.style}>{resolvedType || '-'}</button>
        )}

        {/* --- TIP --- */}
        {activeField === 'tip' || editAllTextFields ? (
          <input autoFocus={activeField === 'tip'} value={tipDraft} onChange={(event) => setTipDraft(normalizeWholeDollarDraft(event.target.value))} onKeyDown={handleKeyDown} inputMode="numeric" className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-center text-xs tabular-nums text-emerald-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-emerald-400 dark:focus:ring-zinc-800" placeholder="-" />
        ) : (
          <button type="button" onClick={() => setActiveField('tip')} className="flex h-7 min-w-0 flex-col items-center justify-center transition-opacity hover:opacity-80">
            {entry.tip ? (
              <>
                <span className="rounded-sm bg-emerald-100 px-1 text-[9px] font-bold leading-tight text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-500">TIP</span>
                <span className="text-[11px] font-semibold leading-tight tabular-nums text-emerald-600 dark:text-emerald-500">{formatWholeDollarCurrency(entry.tip)}</span>
              </>
            ) : (
              <span className="text-sm font-medium text-zinc-300 dark:text-zinc-600">—</span>
            )}
          </button>
        )}

        {/* --- AMOUNT --- */}
        {activeField === 'amount' || editAllTextFields ? (
          <input autoFocus={activeField === 'amount'} value={amountDraft} onChange={(event) => setAmountDraft(event.target.value)} onKeyDown={handleKeyDown} className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-right text-sm tabular-nums text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800" />
        ) : (
          <button type="button" onClick={() => setActiveField('amount')} className="flex h-7 min-w-0 items-center justify-end font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{formatCurrency(entry.amount)}</button>
        )}

        {editMode ? (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={() => setActiveField('all')} aria-label={`Edit ${entry.shoot_name || 'income entry'}`} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
              <PencilIcon />
            </button>
            <button type="button" onClick={() => void onDelete()} aria-label={`Delete ${entry.shoot_name || 'income entry'}`} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-300">
              <XIcon />
            </button>
          </div>
        ) : (
          <button type="button" onClick={toggleNotes} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label={notesOpen ? 'Hide notes' : 'Show notes'}>
            <ChevronIcon direction={notesOpen ? 'up' : 'down'} />
          </button>
        )}
      </div>
      {notesOpen ? (
        <IncomeNotesPanel
          ref={notesPanelRef}
          notes={activeField === 'notes' ? notesDraft : entry.notes}
          editing={activeField === 'notes'}
          onStartEdit={() => {
            setNotesOpen(true)
            setActiveField('notes')
          }}
          onCommit={(next) => {
            setNotesDraft(next)
            void (async () => {
              if (savingRef.current) return
              savingRef.current = true
              try {
                await window.api.updateIncomeEntry(entry.id, { notes: next })
                onChanged()
              } finally {
                savingRef.current = false
              }
            })()
          }}
          onCollapse={() => {
            setActiveField(null)
            setNotesOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function AddIncomeRow({ anchor, incomeTypes, onRegisterType, onUnregisterType, onRenameType, onDone }: { anchor: Date; incomeTypes: string[]; onRegisterType: (type: string) => void; onUnregisterType: (type: string) => void; onRenameType: (from: string, to: string) => void; onDone: (created?: IncomeEntry) => void }) {
  const [dateValue, setDateValue] = useState<Date>(anchor)
  const [shootDraft, setShootDraft] = useState('')
  const [companyDraft, setCompanyDraft] = useState('')
  const [typeDraft, setTypeDraft] = useState('')
  const [tipDraft, setTipDraft] = useState('')
  const [amountDraft, setAmountDraft] = useState('')
  const shootRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLDivElement>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)

  useEffect(() => shootRef.current?.focus(), [])
  useEffect(() => { setDateValue(anchor) }, [anchor])

  useEffect(() => {
    if (!showDatePicker) return
    const close = (e: PointerEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setShowDatePicker(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowDatePicker(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [showDatePicker])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDone])

  async function create(): Promise<void> {
    if (!amountDraft) return
    const created = await window.api.createIncomeEntry({
      date: Math.floor(new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate(), 12, 0, 0, 0).getTime() / 1000),
      shoot_name: shootDraft.trim(),
      company: companyDraft.trim(),
      income_type: typeDraft.trim(),
      amount: parseCurrencyInput(amountDraft),
      tip: tipDraft.trim() ? parseWholeDollarInput(tipDraft) : null,
      notes: ''
    })
    onDone(created)
  }

  function handleEsc(): void {
    onDone()
  }

  function handleKeyDown(event: ReactKeyboardEvent): void {
    if (event.key === 'Enter') void create()
    if (event.key === 'Escape') handleEsc()
  }

  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)_130px_minmax(140px,max-content)_50px_100px_64px] items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div ref={dateRef} className="relative">
        <button
          type="button"
          onClick={() => setShowDatePicker((value) => !value)}
          className="truncate text-left text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {format(dateValue, 'MMM d')}
        </button>
        {showDatePicker ? (
          <IncomeMonthDayPicker
            anchor={anchor}
            selected={dateValue}
            onSelect={(next) => {
              setDateValue(next)
              setShowDatePicker(false)
            }}
          />
        ) : null}
      </div>
      <input ref={shootRef} placeholder="Shoot name" value={shootDraft} onChange={(e) => setShootDraft(e.target.value)} onKeyDown={handleKeyDown} className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-800" />
      <input placeholder="Company" value={companyDraft} onChange={(e) => setCompanyDraft(e.target.value)} onKeyDown={handleKeyDown} className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-800" />
      <IncomeTypeField value={typeDraft} incomeTypes={incomeTypes} onChange={setTypeDraft} onRegisterType={onRegisterType} onUnregisterType={onUnregisterType} onRenameType={onRenameType} placeholder="Type" onKeyDown={handleKeyDown} onCommittedPick={(type) => setTypeDraft(type)} />
      <input placeholder="Tip" value={tipDraft} onChange={(e) => setTipDraft(normalizeWholeDollarDraft(e.target.value))} onKeyDown={handleKeyDown} inputMode="numeric" className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-center text-xs tabular-nums text-emerald-700 outline-none placeholder:text-zinc-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-emerald-400 dark:focus:ring-zinc-800" />
      <input placeholder="$0.00" value={amountDraft} onChange={(e) => setAmountDraft(e.target.value)} onKeyDown={handleKeyDown} className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-right text-sm tabular-nums text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-800" />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => void create()} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30" aria-label="Confirm income"><CheckIcon /></button>
      </div>
    </div>
  )
}

function IncomeMonthDayPicker({ anchor, selected, onSelect }: { anchor: Date; selected: Date; onSelect: (date: Date) => void }) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(anchor))
  const selectedYear = selected.getFullYear()
  const selectedMonth = selected.getMonth()
  const selectedDate = selected.getDate()
  const daysInMonth = getDaysInMonth(viewMonth)
  const firstDayOfMonth = getDay(viewMonth)
  const startOffset = (firstDayOfMonth + 6) % 7
  const cells: Array<{ date: Date; inMonth: boolean }> = []

  for (let index = 0; index < startOffset; index += 1) {
    cells.push({ date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - startOffset + index), inMonth: false })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day), inMonth: true })
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false })
  }

  return (
    <div className="absolute left-0 top-full z-40 mt-1 w-[240px] rounded-lg border border-zinc-200/80 bg-white p-2 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setViewMonth((month) => addMonths(month, -1))} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block -rotate-90"><SmallChevron /></span></button>
        <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200">{format(viewMonth, 'MMMM yyyy')}</span>
        <button type="button" onClick={() => setViewMonth((month) => addMonths(month, 1))} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block rotate-90"><SmallChevron /></span></button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-0">
        {WEEKDAY_LABELS.map((day) => <div key={day} className="py-0.5 text-center text-[9px] font-medium text-zinc-400 dark:text-zinc-500">{day}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0">
        {cells.map((cell, cellIndex) => {
          const isSelected =
            cell.date.getFullYear() === selectedYear &&
            cell.date.getMonth() === selectedMonth &&
            cell.date.getDate() === selectedDate
          return (
            <button
              key={`${cell.date.toISOString()}-${cellIndex}`}
              type="button"
              onClick={() => onSelect(cell.date)}
              className={`rounded-md py-1 text-center text-[11px] transition-colors ${
                isSelected
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : cell.inMonth
                    ? 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-950'
                    : 'text-zinc-300 hover:bg-zinc-50 dark:text-zinc-600 dark:hover:bg-zinc-950'
              }`}
            >
              {cell.date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function IncomeCalendarDropdown({ period, anchor, onSelect }: { period: DisplayPeriod; anchor: Date; onSelect: (date: Date) => void }) {
  if (period === 'year') return <IncomeYearPicker anchor={anchor} onSelect={onSelect} />
  if (period === 'month') return <IncomeMonthPicker anchor={anchor} onSelect={onSelect} />
  return <IncomeWeekPicker anchor={anchor} onSelect={onSelect} />
}

function IncomeYearPicker({ anchor, onSelect }: { anchor: Date; onSelect: (date: Date) => void }) {
  const current = anchor.getFullYear()
  const years = [current - 2, current - 1, current, current + 1, current + 2]
  return (
    <div className="absolute right-0 z-40 mt-1 rounded-lg border border-zinc-200/80 bg-white p-1 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
      <div className="flex gap-1">
        {years.map((year) => (
          <button key={year} type="button" onClick={() => onSelect(new Date(year, 0, 1))} className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${year === current ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950'}`}>
            {year}
          </button>
        ))}
      </div>
    </div>
  )
}

function IncomeMonthPicker({ anchor, onSelect }: { anchor: Date; onSelect: (date: Date) => void }) {
  const [viewYear, setViewYear] = useState(anchor.getFullYear())
  const selectedMonth = anchor.getMonth()
  const selectedYear = anchor.getFullYear()
  return (
    <div className="absolute right-0 z-40 mt-1 w-[200px] rounded-lg border border-zinc-200/80 bg-white p-2 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setViewYear((year) => year - 1)} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block -rotate-90"><SmallChevron /></span></button>
        <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200">{viewYear}</span>
        <button type="button" onClick={() => setViewYear((year) => year + 1)} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block rotate-90"><SmallChevron /></span></button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTH_LABELS.map((label, index) => {
          const selected = viewYear === selectedYear && index === selectedMonth
          return (
            <button key={label} type="button" onClick={() => onSelect(new Date(viewYear, index, 1))} className={`rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors ${selected ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950'}`}>
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function IncomeWeekPicker({ anchor, onSelect }: { anchor: Date; onSelect: (date: Date) => void }) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(anchor))
  const selectedWeekStart = startOfWeek(anchor, { weekStartsOn: 1 })
  const daysInMonth = getDaysInMonth(viewMonth)
  const firstDayOfMonth = getDay(viewMonth)
  const startOffset = (firstDayOfMonth + 6) % 7
  const cells: Array<{ date: Date; inMonth: boolean }> = []

  for (let index = 0; index < startOffset; index += 1) {
    cells.push({ date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - startOffset + index), inMonth: false })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day), inMonth: true })
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false })
  }
  const weeks: Array<typeof cells> = []
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7))

  return (
    <div className="absolute right-0 z-40 mt-1 w-[240px] rounded-lg border border-zinc-200/80 bg-white p-2 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setViewMonth((month) => addMonths(month, -1))} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block -rotate-90"><SmallChevron /></span></button>
        <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200">{format(viewMonth, 'MMMM yyyy')}</span>
        <button type="button" onClick={() => setViewMonth((month) => addMonths(month, 1))} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block rotate-90"><SmallChevron /></span></button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-0">
        {WEEKDAY_LABELS.map((day) => <div key={day} className="py-0.5 text-center text-[9px] font-medium text-zinc-400 dark:text-zinc-500">{day}</div>)}
      </div>
      <div className="flex flex-col">
        {weeks.map((week, weekIndex) => {
          const weekStart = startOfWeek(week[0].date, { weekStartsOn: 1 })
          const selected = weekStart.getTime() === selectedWeekStart.getTime()
          return (
            <button key={weekIndex} type="button" onClick={() => onSelect(weekStart)} className={`grid grid-cols-7 gap-0 rounded-md transition-colors ${selected ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'hover:bg-zinc-50 dark:hover:bg-zinc-950'}`}>
              {week.map((cell, cellIndex) => (
                <div key={cellIndex} className={`py-1 text-center text-[11px] ${selected ? '' : cell.inMonth ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-300 dark:text-zinc-600'}`}>
                  {cell.date.getDate()}
                </div>
              ))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatIncomeDateInput(unix: number): string {
  return format(new Date(unix * 1000), 'M/d/yyyy')
}

function parseIncomeDateInput(value: string, fallback: number): number {
  const localDate = parseLocalDateToUnix(value)
  if (localDate !== null) return localDate
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? fallback : Math.floor(parsed / 1000)
}

function loadCustomIncomeTypes(): string[] {
  try {
    const raw = localStorage.getItem(INCOME_CUSTOM_TYPES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((value) => String(value).trim()).filter(Boolean)
  } catch {
    return []
  }
}

function loadHiddenIncomeTypes(): Set<string> {
  try {
    const raw = localStorage.getItem(INCOME_HIDDEN_TYPES_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map((value) => String(value).trim()).filter(Boolean))
  } catch {
    return new Set()
  }
}

function saveHiddenIncomeTypes(types: Set<string>): void {
  localStorage.setItem(INCOME_HIDDEN_TYPES_KEY, JSON.stringify([...types]))
}

function buildIncomeTypeOptions(entries: IncomeEntry[], customTypes: string[], hiddenTypes: Set<string>): string[] {
  const values = new Set<string>([...DEFAULT_INCOME_TYPES, ...customTypes])
  for (const entry of entries) {
    const resolved = resolveIncomeType(entry)
    if (resolved) values.add(resolved)
  }
  return [...values].filter((type) => !hiddenTypes.has(type)).sort((a, b) => a.localeCompare(b))
}

function buildPeriodIncomeTypeOptions(entries: IncomeEntry[], hiddenTypes: Set<string>): string[] {
  const values = new Set<string>()
  for (const entry of entries) {
    const resolved = resolveIncomeType(entry)
    if (resolved && !hiddenTypes.has(resolved)) values.add(resolved)
  }
  return [...values].sort((a, b) => a.localeCompare(b))
}

function resolveIncomeType(entry: IncomeEntry): string {
  return entry.income_type?.trim() ?? ''
}

function incomeFilteredTotalPresentation(types: string[]): { style: CSSProperties } {
  const colors = types.map((type) => incomeTypeColor(type)).filter(Boolean)
  if (colors.length === 0) return { style: { color: '#047857' } }
  if (colors.length === 1) return { style: { color: colors[0] } }
  const mixed = colors.reduce(
    (sum, color) => {
      const rgb = hexToRgb(color)
      if (!rgb) return sum
      return { red: sum.red + rgb.red, green: sum.green + rgb.green, blue: sum.blue + rgb.blue, count: sum.count + 1 }
    },
    { red: 0, green: 0, blue: 0, count: 0 }
  )
  if (mixed.count === 0) return { style: { color: '#047857' } }
  return {
    style: {
      color: rgbToHex(
        Math.round(mixed.red / mixed.count),
        Math.round(mixed.green / mixed.count),
        Math.round(mixed.blue / mixed.count)
      )
    }
  }
}

function incomeTypeColor(type: string): string {
  return resolveIncomeTypeColorHex(type)
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16)
  }
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function incomeTone(type: string): 'emerald' | 'amber' | 'sky' | 'violet' {
  if (type === 'Snappr') return 'emerald'
  if (type === 'Thumbtack') return 'amber'
  if (type === 'Upwork') return 'sky'
  return 'violet'
}

function incomeBadgeClass(type: string): string {
  const tone = incomeTone(type)
  if (tone === 'emerald') return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900'
  if (tone === 'amber') return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900'
  if (tone === 'sky') return 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900'
  return 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900'
}

function TaxInput({
  label,
  value,
  draftValue,
  globalEditMode,
  onDraftChange,
  onSave,
  onExplain
}: {
  label: string
  value: number
  draftValue: number
  globalEditMode: boolean
  onDraftChange: (value: number) => void
  onSave: (value: number) => Promise<void>
  onExplain: (event: MouseEvent) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(formatCurrency(value))
  const [globalDraft, setGlobalDraft] = useState(formatCurrency(draftValue))

  useEffect(() => {
    if (!globalEditMode && !editing) setDraft(formatCurrency(value))
  }, [value, globalEditMode, editing])

  useEffect(() => {
    if (globalEditMode) setGlobalDraft(formatCurrency(draftValue))
  }, [globalEditMode, draftValue])

  function updateDraftValue(nextRaw: string): void {
    setDraft(nextRaw)
    onDraftChange(parseCurrencyInput(nextRaw))
  }

  async function commitSingleEdit(): Promise<void> {
    const parsed = parseCurrencyInput(draft)
    await onSave(parsed)
    setEditing(false)
  }

  return (
    <div onContextMenu={onExplain} className="flex items-center justify-between gap-4 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
      <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
      {globalEditMode ? (
        <input
          value={globalDraft}
          onChange={(event) => {
            const next = event.target.value
            setGlobalDraft(next)
            updateDraftValue(next)
          }}
          className="w-36 rounded border border-zinc-300 bg-white px-2 py-1 text-right font-medium tabular-nums text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800"
        />
      ) : editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commitSingleEdit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commitSingleEdit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(formatCurrency(value))
              setEditing(false)
            }
          }}
          className="w-36 rounded border border-zinc-300 bg-white px-2 py-1 text-right font-medium tabular-nums text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800"
        />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="text-right font-medium tabular-nums text-zinc-800 dark:text-zinc-100">
          {formatCurrency(value)}
        </button>
      )}
    </div>
  )
}

function TaxGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">{title}</div>
      <div className="overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/55">{children}</div>
    </div>
  )
}

function Readout({ label, value, strong = false, onExplain }: { label: string; value: string; strong?: boolean; onExplain?: (event: MouseEvent) => void }) {
  return (
    <div onContextMenu={onExplain} className="flex items-center justify-between gap-4 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={strong ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'font-medium text-zinc-700 dark:text-zinc-200'}>{value}</span>
    </div>
  )
}

function QuickMetric({ label, value, accent = 'text-zinc-900 dark:text-zinc-100', aidFilters }: { label: string; value: string; accent?: string; aidFilters?: Set<BudgetAidFilter> }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
        {label}
        {aidFilters ? <BudgetAidIndicators filters={aidFilters} /> : null}
      </div>
      <div className={`mt-1 text-lg font-semibold ${accent}`}>{value}</div>
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

function EditablePlain({ value, onSave, align = 'left', className = '', fallback = 'Empty' }: { value: string; onSave: (value: string) => void | Promise<void>; align?: 'left' | 'right'; className?: string; fallback?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  async function save(): Promise<void> {
    setEditing(false)
    if (draft !== value) await onSave(draft)
  }

  if (editing) {
    return <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => event.key === 'Enter' && save()} className={`w-full bg-transparent outline-none ${align === 'right' ? 'text-right' : ''} ${className}`} />
  }
  return <button type="button" onDoubleClick={() => { setDraft(value); setEditing(true); }} className={`block w-full truncate ${align === 'right' ? 'text-right' : 'text-left'} ${className || 'text-zinc-800 dark:text-zinc-100'}`}>{value || fallback}</button>
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'up' ? <path d="m5 12 5-5 5 5" /> : <path d="m5 8 5 5 5-5" />}
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 7h12M5 1v3M11 1v3" />
    </svg>
  )
}

function SmallChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5 L10 7.5 L15 12.5" />
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

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 7.3 2.6 2.6L11 4.1" />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7h7a3 3 0 0 1 0 6H8" />
      <path d="M5 5 3 7l2 2" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6 1v10M1 6h10" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="m3 3 6 6M9 3 3 9" />
    </svg>
  )
}
