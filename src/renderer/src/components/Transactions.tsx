import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { addMonths, addWeeks, addYears, endOfMonth, endOfWeek, endOfYear, format, getDay, getDaysInMonth, startOfMonth, startOfWeek, startOfYear } from 'date-fns'
import type { Account, ImportedFileRecord, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { useChat } from '../context/ChatContext'
import { useDateFormat } from '../context/DateFormatContext'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { ChatBox } from './ChatBox'

type DisplayPeriod = 'week' | 'month' | 'year'
type SortKey = 'date' | 'amount' | 'category' | 'recent'

interface UndoAction {
  type: 'delete_one' | 'delete_all'
  transactions: Transaction[]
}

const ACCOUNT_NAMES = ['Capital One', 'Venmo', 'EBT', 'Chase'] as const
const IMPORT_COLLAPSED_KEY = 'scoop_import_collapsed'
const PERIOD_KEY = 'scoop_txn_period'
const SORT_KEY = 'scoop_txn_sort'

const SORT_OPTIONS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: 'date', label: 'Date' },
  { id: 'amount', label: 'Amount' },
  { id: 'category', label: 'Category' },
  { id: 'recent', label: 'Recently Added' }
]

function periodBounds(anchor: Date, period: DisplayPeriod): { start: number; end: number } {
  if (period === 'week') {
    const s = startOfWeek(anchor, { weekStartsOn: 1 })
    const e = endOfWeek(anchor, { weekStartsOn: 1 })
    return { start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000) }
  }
  if (period === 'year') {
    const s = startOfYear(anchor)
    const e = endOfYear(anchor)
    return { start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000) }
  }
  const s = startOfMonth(anchor)
  const e = endOfMonth(anchor)
  return { start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000) }
}

function stepAnchor(anchor: Date, period: DisplayPeriod, dir: 1 | -1): Date {
  if (period === 'week') return addWeeks(anchor, dir)
  if (period === 'year') return addYears(anchor, dir)
  return addMonths(anchor, dir)
}

function formatAnchor(anchor: Date, period: DisplayPeriod): string {
  if (period === 'week') { const s = startOfWeek(anchor, { weekStartsOn: 1 }); return `${format(s, 'MMM d')} – ${format(endOfWeek(anchor, { weekStartsOn: 1 }), 'MMM d, yyyy')}` }
  if (period === 'year') return format(anchor, 'yyyy')
  return format(anchor, 'MMM yyyy')
}

function getStoredPeriod(): DisplayPeriod {
  const v = localStorage.getItem(PERIOD_KEY)
  if (v === 'week' || v === 'month' || v === 'year') return v
  return 'month'
}

function getStoredSort(): SortKey {
  const v = localStorage.getItem(SORT_KEY)
  if (v === 'date' || v === 'amount' || v === 'category' || v === 'recent') return v
  return 'date'
}

export function Transactions() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const { getChat } = useChat()
  const { formatDate } = useDateFormat()
  const [chatExpanded, setChatExpanded] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [importedFiles, setImportedFiles] = useState<ImportedFileRecord[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [anchor, setAnchor] = useState(() => new Date())
  const [period, setPeriod] = useState<DisplayPeriod>(() => getStoredPeriod())
  const [sortKey, setSortKey] = useState<SortKey>(() => getStoredSort())
  const [sortOpen, setSortOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [deleteAllArmed, setDeleteAllArmed] = useState(false)
  const [error, setError] = useState('')
  const [importCollapsed, setImportCollapsed] = useState(() => localStorage.getItem(IMPORT_COLLAPSED_KEY) === 'true')
  const [hasUndoActions, setHasUndoActions] = useState(false)
  const undoStackRef = useRef<UndoAction[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)

  const { start, end } = periodBounds(anchor, period)
  const monthBoundsForImport = useMemo(() => {
    const s = startOfMonth(anchor)
    const e = endOfMonth(anchor)
    return { start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000) }
  }, [anchor])

  useEffect(() => { localStorage.setItem(IMPORT_COLLAPSED_KEY, String(importCollapsed)) }, [importCollapsed])
  useEffect(() => { localStorage.setItem(PERIOD_KEY, period) }, [period])
  useEffect(() => { localStorage.setItem(SORT_KEY, sortKey) }, [sortKey])

  useEffect(() => {
    if (!sortOpen) return
    function onClickAway(e: MouseEvent): void { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false) }
    function onEsc(e: KeyboardEvent): void { if (e.key === 'Escape') setSortOpen(false) }
    document.addEventListener('pointerdown', onClickAway)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('pointerdown', onClickAway); document.removeEventListener('keydown', onEsc) }
  }, [sortOpen])

  useEffect(() => {
    if (!calendarOpen) return
    function onClickAway(e: MouseEvent): void { if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) setCalendarOpen(false) }
    function onEsc(e: KeyboardEvent): void { if (e.key === 'Escape') setCalendarOpen(false) }
    document.addEventListener('pointerdown', onClickAway)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('pointerdown', onClickAway); document.removeEventListener('keydown', onEsc) }
  }, [calendarOpen])

  useEffect(() => {
    Promise.all([
      window.api.getAccounts(),
      window.api.getTransactions(),
      window.api.getImportedFiles({ start: monthBoundsForImport.start, end: monthBoundsForImport.end })
    ]).then(([nextAccounts, nextTransactions, nextImportedFiles]) => {
      setAccounts(nextAccounts)
      setTransactions(nextTransactions)
      setImportedFiles(nextImportedFiles)
    })
  }, [dataVersion, monthBoundsForImport.end, monthBoundsForImport.start])

  const categories = useMemo(
    () => Array.from(new Set(transactions.map((tx) => tx.mapped_category).filter(Boolean))).sort(),
    [transactions]
  )

  const visibleTransactions = useMemo(
    () =>
      transactions.filter((tx) => {
        if (tx.date < start || tx.date > end) return false
        if (selectedAccountIds.length > 0 && (!tx.account_id || !selectedAccountIds.includes(tx.account_id))) return false
        if (selectedCategories.length > 0 && !selectedCategories.includes(tx.mapped_category)) return false
        return true
      }),
    [end, selectedAccountIds, selectedCategories, start, transactions]
  )

  const categorySpendRank = useMemo(() => {
    const totals = new Map<string, number>()
    for (const tx of visibleTransactions) {
      const cat = tx.mapped_category || 'Uncategorized'
      totals.set(cat, (totals.get(cat) ?? 0) + Math.abs(tx.amount))
    }
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
    const rank = new Map<string, number>()
    sorted.forEach(([cat], i) => rank.set(cat, i))
    return rank
  }, [visibleTransactions])

  const sortedTransactions = useMemo(() => {
    const list = [...visibleTransactions]
    if (sortKey === 'amount') return list.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    if (sortKey === 'category') {
      return list.sort((a, b) => {
        const ra = categorySpendRank.get(a.mapped_category || 'Uncategorized') ?? 999
        const rb = categorySpendRank.get(b.mapped_category || 'Uncategorized') ?? 999
        return ra !== rb ? ra - rb : b.date - a.date
      })
    }
    if (sortKey === 'recent') return list.sort((a, b) => b.id - a.id)
    return list.sort((a, b) => b.date - a.date)
  }, [categorySpendRank, sortKey, visibleTransactions])

  const totalSpent = useMemo(
    () => visibleTransactions.reduce((sum, tx) => sum + tx.amount, 0),
    [visibleTransactions]
  )

  function pushUndo(action: UndoAction): void {
    undoStackRef.current.push(action)
    setHasUndoActions(true)
  }

  const undoLastAction = useCallback(async () => {
    const action = undoStackRef.current.pop()
    if (!action) return
    if (undoStackRef.current.length === 0) setHasUndoActions(false)
    for (const tx of action.transactions) {
      await window.api.createTransaction({
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        mapped_category: tx.mapped_category,
        raw_category: tx.raw_category ?? tx.mapped_category,
        account_id: tx.account_id ?? null,
        source: tx.source ?? 'manual'
      })
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

  async function importFile(file: File): Promise<void> {
    const path = window.api.getPathForFile(file)
    setError('')
    if (!path) { setError('Could not read the selected file path.'); return }
    const targetAccountId = selectedAccountIds[0] ?? accounts[0]?.id
    if (!targetAccountId) { setError('Create an account before importing transactions.'); return }
    const result = await window.api.importTransactions(path, targetAccountId)
    setError(result.errors[0] ?? '')
    const [nextTransactions, nextImportedFiles] = await Promise.all([
      window.api.getTransactions(),
      window.api.getImportedFiles({ start: monthBoundsForImport.start, end: monthBoundsForImport.end })
    ])
    setTransactions(nextTransactions)
    setImportedFiles(nextImportedFiles)
    bumpDataVersion()
  }

  function toggleAccount(id: number): void {
    setSelectedAccountIds((c) => c.includes(id) ? c.filter((i) => i !== id) : [...c, id])
  }
  function toggleCategory(cat: string): void {
    setSelectedCategories((c) => c.includes(cat) ? c.filter((i) => i !== cat) : [...c, cat])
  }

  async function deleteTransaction(id: number): Promise<void> {
    const tx = transactions.find((t) => t.id === id)
    if (tx) pushUndo({ type: 'delete_one', transactions: [tx] })
    await window.api.deleteTransaction(id)
    bumpDataVersion()
  }

  async function deleteAllTransactions(): Promise<void> {
    if (!deleteAllArmed) { setDeleteAllArmed(true); window.setTimeout(() => setDeleteAllArmed(false), 3500); return }
    pushUndo({ type: 'delete_all', transactions: [...visibleTransactions] })
    for (const tx of visibleTransactions) {
      await window.api.deleteTransaction(tx.id)
    }
    setDeleteAllArmed(false)
    bumpDataVersion()
  }

  const handleAddDone = useCallback((created: boolean) => {
    setAdding(false)
    if (created) bumpDataVersion()
  }, [bumpDataVersion])

  const txChat = getChat('expenses-actual')
  const chatFadeHeight = chatExpanded ? Math.min(txChat.height + 128, 680) : 96

  return (
    <div className="relative h-full overflow-hidden bg-white dark:bg-zinc-950">
      <div className="h-full overflow-y-auto px-4 py-6 pb-28 md:px-8">
        <input ref={inputRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) { void importFile(file).finally(() => { input.value = '' }) } else { input.value = '' } }} />

        {/* Header — full width */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Transactions</h1>
            <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Total Spent</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-100">{formatCurrency(totalSpent)}</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <div ref={sortRef} className="relative">
                <button type="button" onClick={() => setSortOpen((v) => !v)} className="cursor-pointer rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                  Sort: {SORT_OPTIONS.find((o) => o.id === sortKey)?.label ?? 'Date'}
                </button>
                {sortOpen && (
                  <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[11.5rem] rounded-lg border border-zinc-200/80 bg-white p-1 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
                    {SORT_OPTIONS.map((opt) => (
                      <button key={opt.id} type="button" role="menuitem" onClick={() => { setSortKey(opt.id); setSortOpen(false) }} className={`flex w-full rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors ${sortKey === opt.id ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Display period">
                <SegmentedButton active={period === 'week'} onClick={() => setPeriod('week')}>Week</SegmentedButton>
                <SegmentedButton active={period === 'month'} onClick={() => setPeriod('month')}>Month</SegmentedButton>
                <SegmentedButton active={period === 'year'} onClick={() => setPeriod('year')}>Year</SegmentedButton>
              </div>
            </div>
            <div ref={calendarRef} className="relative">
              <div className="flex items-center rounded-full border border-zinc-200 bg-white text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <button type="button" onClick={() => setAnchor((a) => stepAnchor(a, period, -1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Previous">
                  <span className="inline-block -rotate-90"><ChevronIcon direction="up" /></span>
                </button>
                <div className="min-w-[120px] text-center text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{formatAnchor(anchor, period)}</div>
                <button type="button" onClick={() => setCalendarOpen((v) => !v)} className="px-1 text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200" aria-label="Open calendar"><CalendarIcon /></button>
                <button type="button" onClick={() => setAnchor((a) => stepAnchor(a, period, 1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Next">
                  <span className="inline-block rotate-90"><ChevronIcon direction="up" /></span>
                </button>
              </div>
              {calendarOpen && (
                <CalendarDropdown period={period} anchor={anchor} onSelect={(d) => { setAnchor(d); setCalendarOpen(false) }} />
              )}
            </div>
          </div>
        </div>

        {/* Import section — full width */}
        <div className="relative z-20 mb-5 rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900" style={{ overflow: 'visible' }}>
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">Import Transactions</span>
            <span className="text-[11px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">{importedFiles.length} file{importedFiles.length !== 1 ? 's' : ''} imported</span>
          </div>
          {!importCollapsed && (
            <div className="border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
              <div className="flex items-start gap-4">
                <button type="button" onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) void importFile(file) }} className="flex min-h-[62px] w-[260px] shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 text-[12px] font-medium text-zinc-500 transition-colors hover:border-zinc-400 hover:bg-white hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-200">
                  Drop CSV or Excel here
                </button>
                <div className="min-w-0 flex-1">
                  {importedFiles.length === 0 ? (
                    <span className="text-[12px] text-zinc-500 dark:text-zinc-400">No files for this month</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {importedFiles.map((file) => <ImportedFileEntry key={file.id} file={file} formatDate={formatDate} />)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <button type="button" onClick={() => setImportCollapsed((v) => !v)} className="flex w-full items-center justify-center border-t border-zinc-100 py-1 text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-zinc-600 dark:border-zinc-800 dark:hover:bg-zinc-950 dark:hover:text-zinc-300" aria-label={importCollapsed ? 'Expand' : 'Collapse'}>
            <CollapseChevron collapsed={importCollapsed} />
          </button>
        </div>

        {/* Grid: filter rail + transactions list */}
        <div className="md:grid md:grid-cols-[auto_minmax(0,1fr)] md:items-start md:gap-x-4">
          {/* Left filter rail */}
          <div className="mb-4 md:col-start-1 md:row-start-1 md:mb-0">
            <div className="sticky top-6 w-full pt-7 md:w-[7.5rem]">
              <TransactionsFilterRail
                accounts={accounts} categories={categories} selectedAccountIds={selectedAccountIds} selectedCategories={selectedCategories}
                onToggleAccount={toggleAccount} onToggleCategory={toggleCategory} onClearAccounts={() => setSelectedAccountIds([])} onClearCategories={() => setSelectedCategories([])}
              />
            </div>
          </div>

          {/* Transactions list */}
          <div className="min-w-0 md:col-start-2 md:row-start-1">
            {/* + add / undo / edit / delete-all buttons */}
            <div className="mb-1 flex items-center justify-between">
              <button type="button" onClick={() => setAdding(true)} className="flex h-6 w-6 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200" aria-label="Add transaction"><PlusIcon /></button>
              <div className="flex items-center gap-1">
                {hasUndoActions && (
                  <button type="button" onClick={() => void undoLastAction()} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label="Undo (⌘Z)"><UndoIcon /></button>
                )}
                {editMode ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void deleteAllTransactions()}
                      className={`rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${deleteAllArmed ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900' : 'text-zinc-400 hover:text-red-600 dark:hover:text-red-300'}`}
                    >
                      {deleteAllArmed ? 'Confirm Delete All' : 'Delete All'}
                    </button>
                    <button type="button" onClick={() => { setEditMode(false); setDeleteAllArmed(false) }} className="flex h-6 w-6 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30" aria-label="Done editing"><CheckIcon /></button>
                  </>
                ) : (
                  <button type="button" onClick={() => setEditMode(true)} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label="Edit transactions"><PencilIcon /></button>
                )}
              </div>
            </div>

            {error ? <div className="mb-2 text-[12px] text-red-600 dark:text-red-400">{error}</div> : null}
            <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <div className="grid grid-cols-[110px_1fr_170px_120px_24px] items-center gap-3 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
                <div>Date</div>
                <div>Description</div>
                <div>Category</div>
                <div className="text-right">Amount</div>
                <div aria-hidden="true" />
              </div>
              {adding ? <AddTransactionRow accounts={accounts} categories={categories} onDone={handleAddDone} /> : null}
              {sortedTransactions.length === 0 && !adding ? (
                <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No transactions for this period — use the controls above or import a CSV</div>
              ) : (
                sortedTransactions.map((tx) => (
                  <TransactionRow key={tx.id} transaction={tx} editMode={editMode} onChanged={bumpDataVersion} onDelete={() => deleteTransaction(tx.id)} />
                ))
              )}
            </section>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-8 bottom-4 z-20">
        <div
          aria-hidden="true"
          style={{ height: chatFadeHeight }}
          className="absolute inset-x-0 bottom-0 -z-10 bg-gradient-to-t from-white via-white/95 to-transparent transition-[height] duration-200 dark:from-zinc-950 dark:via-zinc-950/95"
        />
        <div className="pointer-events-auto">
          <ChatBox pageId="expenses-actual" fullWidth onExpandedChange={setChatExpanded} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Segmented button (matches Budget page)
// ---------------------------------------------------------------------------

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Calendar dropdown — adapts to week / month / year period
// ---------------------------------------------------------------------------

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function CalendarDropdown({ period, anchor, onSelect }: { period: DisplayPeriod; anchor: Date; onSelect: (d: Date) => void }) {
  if (period === 'year') return <YearPicker anchor={anchor} onSelect={onSelect} />
  if (period === 'month') return <MonthPicker anchor={anchor} onSelect={onSelect} />
  return <WeekPicker anchor={anchor} onSelect={onSelect} />
}

function YearPicker({ anchor, onSelect }: { anchor: Date; onSelect: (d: Date) => void }) {
  const current = anchor.getFullYear()
  const years = [current - 2, current - 1, current, current + 1, current + 2]
  return (
    <div className="absolute right-0 z-40 mt-1 rounded-lg border border-zinc-200/80 bg-white p-1 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
      <div className="flex gap-1">
        {years.map((y) => (
          <button key={y} type="button" onClick={() => onSelect(new Date(y, 0, 1))} className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${y === current ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950'}`}>
            {y}
          </button>
        ))}
      </div>
    </div>
  )
}

function MonthPicker({ anchor, onSelect }: { anchor: Date; onSelect: (d: Date) => void }) {
  const [viewYear, setViewYear] = useState(anchor.getFullYear())
  const selectedMonth = anchor.getMonth()
  const selectedYear = anchor.getFullYear()
  return (
    <div className="absolute right-0 z-40 mt-1 w-[200px] rounded-lg border border-zinc-200/80 bg-white p-2 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setViewYear((y) => y - 1)} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block -rotate-90"><SmallChevron /></span></button>
        <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200">{viewYear}</span>
        <button type="button" onClick={() => setViewYear((y) => y + 1)} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block rotate-90"><SmallChevron /></span></button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTH_LABELS.map((label, i) => {
          const isSelected = viewYear === selectedYear && i === selectedMonth
          return (
            <button key={label} type="button" onClick={() => onSelect(new Date(viewYear, i, 1))} className={`rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors ${isSelected ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950'}`}>
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WeekPicker({ anchor, onSelect }: { anchor: Date; onSelect: (d: Date) => void }) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(anchor))
  const selectedWeekStart = startOfWeek(anchor, { weekStartsOn: 1 })

  const daysInMonth = getDaysInMonth(viewMonth)
  const firstDayOfMonth = getDay(viewMonth)
  const startOffset = (firstDayOfMonth + 6) % 7

  const cells: Array<{ date: Date; inMonth: boolean }> = []
  for (let i = 0; i < startOffset; i++) {
    const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1 - startOffset + i)
    cells.push({ date: d, inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d), inMonth: true })
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false })
  }

  const weeks: Array<typeof cells> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <div className="absolute right-0 z-40 mt-1 w-[240px] rounded-lg border border-zinc-200/80 bg-white p-2 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setViewMonth((m) => addMonths(m, -1))} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block -rotate-90"><SmallChevron /></span></button>
        <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200">{format(viewMonth, 'MMMM yyyy')}</span>
        <button type="button" onClick={() => setViewMonth((m) => addMonths(m, 1))} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"><span className="inline-block rotate-90"><SmallChevron /></span></button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-0">
        {WEEKDAY_LABELS.map((d) => <div key={d} className="py-0.5 text-center text-[9px] font-medium text-zinc-400 dark:text-zinc-500">{d}</div>)}
      </div>
      <div className="flex flex-col">
        {weeks.map((week, wi) => {
          const weekStart = startOfWeek(week[0].date, { weekStartsOn: 1 })
          const isSelected = weekStart.getTime() === selectedWeekStart.getTime()
          return (
            <button key={wi} type="button" onClick={() => onSelect(weekStart)} className={`grid grid-cols-7 gap-0 rounded-md transition-colors ${isSelected ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'hover:bg-zinc-50 dark:hover:bg-zinc-950'}`}>
              {week.map((cell, ci) => (
                <div key={ci} className={`py-1 text-center text-[11px] ${isSelected ? '' : cell.inMonth ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-300 dark:text-zinc-600'}`}>
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

function SmallChevron() {
  return (<svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 L10 7.5 L15 12.5" /></svg>)
}

// ---------------------------------------------------------------------------
// Left filter rail (matches Budget page style)
// ---------------------------------------------------------------------------

function TransactionsFilterRail({
  accounts, categories, selectedAccountIds, selectedCategories, onToggleAccount, onToggleCategory, onClearAccounts, onClearCategories
}: {
  accounts: Account[]; categories: string[]; selectedAccountIds: number[]; selectedCategories: string[]
  onToggleAccount: (id: number) => void; onToggleCategory: (category: string) => void; onClearAccounts: () => void; onClearCategories: () => void
}) {
  const accountsForDisplay = useMemo(() => {
    const mapped: Array<{ id: number; name: string }> = []
    for (const name of ACCOUNT_NAMES) {
      const match = accounts.find((a) => a.name.toLowerCase().includes(name.toLowerCase()))
      if (match) mapped.push({ id: match.id, name })
      else mapped.push({ id: -(mapped.length + 1), name })
    }
    return mapped
  }, [accounts])

  return (
    <div className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="border-b border-zinc-100 bg-zinc-50/80 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">Filters</div>
      <div className="px-2 py-1.5">
        <FilterGroup ariaLabel="Accounts" hasSelection={selectedAccountIds.length > 0} onClear={onClearAccounts}>
          {accountsForDisplay.map((a) => (
            <FilterPill key={a.id} label={a.name} active={selectedAccountIds.includes(a.id)} tone="sky" onClick={() => { if (a.id > 0) onToggleAccount(a.id) }} />
          ))}
        </FilterGroup>
        {categories.length > 0 && (
          <FilterGroup ariaLabel="Categories" hasSelection={selectedCategories.length > 0} onClear={onClearCategories}>
            {categories.map((cat) => (
              <FilterPill key={cat} label={cat} active={selectedCategories.includes(cat)} tone={categoryTone(cat)} onClick={() => onToggleCategory(cat)} />
            ))}
          </FilterGroup>
        )}
      </div>
    </div>
  )
}

function FilterGroup({ ariaLabel, hasSelection, onClear, children }: { ariaLabel: string; hasSelection: boolean; onClear: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-zinc-100 py-1.5 last:border-b-0 dark:border-zinc-800" role="group" aria-label={ariaLabel}>
      {children}
      {hasSelection ? <button type="button" onClick={onClear} className="mt-0.5 self-start text-[10px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Clear</button> : null}
    </div>
  )
}

function FilterPill({ label, active, tone, onClick }: { label: string; active: boolean; tone: 'emerald' | 'amber' | 'sky' | 'violet' | 'red' | 'zinc'; onClick: () => void }) {
  const activeClass = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900'
    : tone === 'amber' ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900'
    : tone === 'sky' ? 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900'
    : tone === 'violet' ? 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900'
    : tone === 'red' ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900'
    : 'bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:ring-zinc-100'
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`w-full rounded-md px-2 py-1 text-left text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 ${active ? activeClass : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'}`}>
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Import section helpers
// ---------------------------------------------------------------------------

function ImportedFileEntry({ file, formatDate }: { file: ImportedFileRecord; formatDate: (unix: number) => string }) {
  return (
    <div className="relative flex items-start justify-end gap-2" style={{ overflow: 'visible' }}>
      <div className="group/file min-w-0 text-right">
        <span className="block text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{file.file_name}</span>
        <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{formatFileSize(file.file_size)} · {file.imported_count} imported · {formatImportSpan(file, formatDate)}</span>
        <div className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-[60] hidden w-[420px] overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-xl group-hover/file:block dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-start gap-3 border-b border-zinc-100 p-3 dark:border-zinc-800">
            <CsvFileIcon label={file.file_type || 'CSV'} />
            <div className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{file.file_name}</span>
              <span className="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400">
                {formatFileSize(file.file_size)} · {file.preview.rowCount} rows · {file.preview.columnCount} columns · {file.imported_count} imported · {file.skipped_count} skipped
              </span>
              <span className="mt-0.5 block text-[11px] text-zinc-400 dark:text-zinc-500">{formatImportSpan(file, formatDate)}</span>
            </div>
          </div>
          <div className="overflow-x-auto p-3">
            <table className="w-full min-w-[360px] table-fixed border-collapse text-[10px]">
              <thead>
                <tr>
                  {file.preview.headers.slice(0, 6).map((header) => (
                    <th key={header} className="truncate border border-zinc-200 bg-zinc-50 px-1.5 py-1 text-left font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {file.preview.rows.slice(0, 5).map((row, rowIndex) => (
                  <tr key={`${file.id}-${rowIndex}`}>
                    {row.slice(0, 6).map((cell, cellIndex) => (
                      <td key={`${file.id}-${rowIndex}-${cellIndex}`} className="truncate border border-zinc-200 px-1.5 py-1 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{cell || ' '}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function categoryTone(category: string): 'emerald' | 'amber' | 'sky' | 'violet' | 'red' | 'zinc' {
  const n = category.toLowerCase()
  if (n.includes('groceries') || n.includes('income')) return 'emerald'
  if (n.includes('bar') || n.includes('entertainment') || n.includes('travel')) return 'amber'
  if (n.includes('transportation') || n.includes('gas') || n.includes('car')) return 'sky'
  if (n.includes('business') || n.includes('ai') || n.includes('subscription')) return 'violet'
  if (n.includes('rent') || n.includes('health') || n.includes('insurance')) return 'red'
  return 'zinc'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatImportSpan(file: ImportedFileRecord, formatDate: (unix: number) => string): string {
  if (file.first_transaction_date && file.last_transaction_date) {
    if (file.first_transaction_date === file.last_transaction_date) return `Transactions on ${formatDate(file.first_transaction_date)}`
    return `${formatDate(file.first_transaction_date)} - ${formatDate(file.last_transaction_date)}`
  }
  return `Imported ${formatDate(file.created_at)}`
}

// ---------------------------------------------------------------------------
// Transaction rows
// ---------------------------------------------------------------------------

function TransactionRow({ transaction, editMode, onChanged, onDelete }: { transaction: Transaction; editMode: boolean; onChanged: () => void; onDelete: () => Promise<void> }) {
  const [editing, setEditing] = useState<'description' | 'category' | null>(null)
  const [description, setDescription] = useState(transaction.description)
  const [category, setCategory] = useState(transaction.mapped_category)
  const { formatDate } = useDateFormat()

  async function save(): Promise<void> {
    await window.api.updateTransaction(transaction.id, { description, mapped_category: category })
    setEditing(null)
    onChanged()
  }

  return (
    <div className="group/row grid grid-cols-[110px_1fr_170px_120px_24px] items-center gap-3 border-b border-zinc-100 px-4 py-3 text-sm last:border-b-0 dark:border-zinc-800">
      <div className="text-zinc-500 dark:text-zinc-400">{formatDate(transaction.date)}</div>
      {editing === 'description' ? (
        <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(null) }} className="bg-transparent outline-none" />
      ) : (
        <button type="button" onDoubleClick={() => setEditing('description')} className="truncate text-left text-zinc-900 dark:text-zinc-100">{transaction.description || 'Untitled'}</button>
      )}
      {editing === 'category' ? (
        <input autoFocus value={category} onChange={(e) => setCategory(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(null) }} className="bg-transparent outline-none" />
      ) : (
        <button type="button" onDoubleClick={() => setEditing('category')} className="truncate text-left text-zinc-500 dark:text-zinc-400">{transaction.mapped_category || 'Uncategorized'}</button>
      )}
      <div className={`text-right font-medium ${transaction.amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(transaction.amount)}</div>
      {editMode ? (
        <button type="button" onClick={() => void onDelete()} aria-label={`Delete ${transaction.description || 'transaction'}`} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-300">
          <XIcon />
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add transaction row with category dropdown
// ---------------------------------------------------------------------------

function AddTransactionRow({ accounts, categories, onDone }: { accounts: Account[]; categories: string[]; onDone: (created: boolean) => void }) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const catInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const filteredCategories = useMemo(() => {
    if (!category.trim()) return categories
    const lower = category.toLowerCase()
    return categories.filter((c) => c.toLowerCase().includes(lower))
  }, [categories, category])

  useEffect(() => { setHighlightIdx(0) }, [filteredCategories])

  useEffect(() => {
    if (!showDropdown || !dropdownRef.current) return
    const el = dropdownRef.current.children[highlightIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx, showDropdown])

  async function create(): Promise<void> {
    if (!description.trim() && !amount.trim()) { onDone(false); return }
    await window.api.createTransaction({
      date: Math.floor(Date.now() / 1000),
      description,
      amount: parseCurrencyInput(amount),
      mapped_category: category || 'Uncategorized',
      raw_category: category || 'Uncategorized',
      account_id: accounts[0]?.id ?? null,
      source: 'manual'
    })
    onDone(true)
  }

  function handleEsc(): void {
    onDone(false)
  }

  function handleCatKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') { setShowDropdown(false); handleEsc(); return }
    if (!showDropdown) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setShowDropdown(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx((i) => Math.min(i + 1, filteredCategories.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx((i) => Math.max(i - 1, 0)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredCategories[highlightIdx]) setCategory(filteredCategories[highlightIdx])
      setShowDropdown(false)
      return
    }
  }

  return (
    <div className="relative grid grid-cols-[110px_1fr_170px_120px_24px] items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-zinc-500">Today</div>
      <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') handleEsc(); if (e.key === 'Enter') catInputRef.current?.focus() }} placeholder="Description" className="bg-transparent outline-none" />
      <div className="relative">
        <input
          ref={catInputRef}
          value={category}
          onChange={(e) => { setCategory(e.target.value); setShowDropdown(true) }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => { window.setTimeout(() => setShowDropdown(false), 150) }}
          onKeyDown={handleCatKeyDown}
          placeholder="Category"
          className="w-full bg-transparent outline-none"
        />
        {showDropdown && filteredCategories.length > 0 && (
          <div ref={dropdownRef} className="absolute left-0 top-full z-40 mt-1 max-h-[180px] w-[200px] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {filteredCategories.map((cat, i) => (
              <button
                key={cat}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setCategory(cat); setShowDropdown(false) }}
                className={`flex w-full rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors ${i === highlightIdx ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950'}`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') handleEsc() }} placeholder="$0.00" className="bg-transparent text-right outline-none" />
      <button type="button" onClick={() => void create()} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30" aria-label="Confirm"><CheckIcon /></button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'down' ? 'M5 7.5 L10 12.5 L15 7.5' : 'M5 12.5 L10 7.5 L15 12.5'} /></svg>)
}
function CalendarIcon() {
  return (<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 7h12M5 1v3M11 1v3" /></svg>)
}
function CollapseChevron({ collapsed }: { collapsed: boolean }) {
  return (<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={collapsed ? 'M5 7.5 L10 12.5 L15 7.5' : 'M5 12.5 L10 7.5 L15 12.5'} /></svg>)
}
function CsvFileIcon({ label }: { label: string }) {
  return (<span className="relative inline-flex h-12 w-10 shrink-0 items-end justify-center rounded-md border border-zinc-200 bg-white pb-1 text-[8px] font-semibold text-emerald-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-emerald-300"><span className="absolute right-0 top-0 h-3 w-3 rounded-bl border-b border-l border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800" />{label.slice(0, 4)}</span>)
}
function PencilIcon() {
  return (<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.8 3.1 12.9 6.2M2.8 10.1 10.7 2.2a1.5 1.5 0 0 1 2.1 0l1 1a1.5 1.5 0 0 1 0 2.1L5.9 13.2l-3.6.6.5-3.7Z" /></svg>)
}
function CheckIcon() {
  return (<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7.3 2.6 2.6L11 4.1" /></svg>)
}
function UndoIcon() {
  return (<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h7a3 3 0 0 1 0 6H8" /><path d="M5 5 3 7l2 2" /></svg>)
}
function PlusIcon() {
  return (<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M6 1v10M1 6h10" /></svg>)
}
function XIcon() {
  return (<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" /></svg>)
}
