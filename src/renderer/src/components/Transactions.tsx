import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { addMonths, format, startOfMonth } from 'date-fns'
import type { Account, ImportedFileRecord, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { useDateFormat } from '../context/DateFormatContext'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { monthBounds } from '../lib/dates'

export function Transactions() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const { formatDate } = useDateFormat()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [importedFiles, setImportedFiles] = useState<ImportedFileRecord[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()))
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [deleteAllArmed, setDeleteAllArmed] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { start, end } = monthBounds(selectedMonth)

  useEffect(() => {
    Promise.all([
      window.api.getAccounts(),
      window.api.getTransactions(),
      window.api.getImportedFiles({ start, end })
    ]).then(([nextAccounts, nextTransactions, nextImportedFiles]) => {
      setAccounts(nextAccounts)
      setTransactions(nextTransactions)
      setImportedFiles(nextImportedFiles)
    })
  }, [dataVersion, end, start])

  useEffect(() => {
    if (transactions.length === 0 || hasTransactionsInMonth(transactions, selectedMonth)) return
    if (startOfMonth(selectedMonth).getTime() !== startOfMonth(new Date()).getTime()) return
    const latest = transactions.reduce((max, transaction) => Math.max(max, transaction.date), 0)
    if (latest > 0) setSelectedMonth(startOfMonth(new Date(latest * 1000)))
  }, [selectedMonth, transactions])

  const categories = useMemo(
    () => Array.from(new Set(transactions.map((tx) => tx.mapped_category).filter(Boolean))).sort(),
    [transactions]
  )

  const visibleTransactions = useMemo(
    () =>
      transactions.filter((transaction) => {
        if (transaction.date < start || transaction.date > end) return false
        if (selectedAccountIds.length > 0 && (!transaction.account_id || !selectedAccountIds.includes(transaction.account_id))) return false
        if (selectedCategories.length > 0 && !selectedCategories.includes(transaction.mapped_category)) return false
        return true
      }),
    [end, selectedAccountIds, selectedCategories, start, transactions]
  )
  const monthTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.date >= start && transaction.date <= end),
    [end, start, transactions]
  )

  async function importFile(file: File): Promise<void> {
    const path = window.api.getPathForFile(file)
    setError('')
    if (!path) {
      setError('Could not read the selected file path.')
      return
    }
    const targetAccountId = selectedAccountIds[0] ?? accounts[0]?.id
    if (!targetAccountId) {
      setError('Create an account before importing transactions.')
      return
    }
    const result = await window.api.importTransactions(path, targetAccountId)
    setError(result.errors[0] ?? '')
    const [nextTransactions, nextImportedFiles] = await Promise.all([
      window.api.getTransactions(),
      window.api.getImportedFiles({ start, end })
    ])
    setTransactions(nextTransactions)
    setImportedFiles(nextImportedFiles)
    bumpDataVersion()
  }

  function toggleAccount(id: number): void {
    setSelectedAccountIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleCategory(nextCategory: string): void {
    setSelectedCategories((current) => current.includes(nextCategory) ? current.filter((item) => item !== nextCategory) : [...current, nextCategory])
  }

  async function deleteAllExpenses(): Promise<void> {
    if (!deleteAllArmed) {
      setDeleteAllArmed(true)
      window.setTimeout(() => setDeleteAllArmed(false), 3500)
      return
    }
    const result = await window.api.deleteAllTransactions()
    setDeleteAllArmed(false)
    setTransactions([])
    setSelectedAccountIds([])
    setSelectedCategories([])
    setError(result.deleted ? '' : 'No transactions were deleted.')
    bumpDataVersion()
  }

  async function deleteExpense(id: number): Promise<void> {
    await window.api.deleteTransaction(id)
    bumpDataVersion()
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Expenses Actual</h1>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title={selectedAccountIds.length || selectedCategories.length ? `${visibleTransactions.length} of ${monthTransactions.length} shown` : `${monthTransactions.length} shown`}>
              {visibleTransactions.length}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Import, review, and lightly edit this month’s money movement.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center rounded-full border border-zinc-200 bg-white text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <button type="button" onClick={() => setSelectedMonth((month) => addMonths(month, -1))} className="px-3 py-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Previous month">
              <span className="inline-block -rotate-90"><ChevronIcon direction="up" /></span>
            </button>
            <div className="min-w-[120px] text-center text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{format(selectedMonth, 'MMM yyyy')}</div>
            <button type="button" onClick={() => setSelectedMonth((month) => addMonths(month, 1))} className="px-3 py-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Next month">
              <span className="inline-block rotate-90"><ChevronIcon direction="up" /></span>
            </button>
          </div>
          <button type="button" onClick={() => setAdding(true)} className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-950">
            Add Transaction
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            className="hidden"
            onChange={(event) => {
              const input = event.currentTarget
              const file = input.files?.[0]
              if (file) {
                void importFile(file).finally(() => {
                  input.value = ''
                })
              } else {
                input.value = ''
              }
            }}
          />
        </div>
      </div>

      <div className="shrink-0 overflow-visible rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between gap-4">
          <span className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">Import Transactions</span>
          <span className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">Imported</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const file = event.dataTransfer.files[0]
              if (file) void importFile(file)
            }}
            className="flex min-h-[62px] w-[260px] shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 text-[12px] font-medium text-zinc-500 transition-colors hover:border-zinc-400 hover:bg-white hover:text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            Drop CSV or Excel here
          </button>
          <ImportedFilesList files={importedFiles} formatDate={formatDate} />
        </div>
      </div>

      <ExpensesFilterBar
        accounts={accounts}
        categories={categories}
        selectedAccountIds={selectedAccountIds}
        selectedCategories={selectedCategories}
        onToggleAccount={toggleAccount}
        onToggleCategory={toggleCategory}
        onClearAccounts={() => setSelectedAccountIds([])}
        onClearCategories={() => setSelectedCategories([])}
      />
      {error ? <div className="text-[12px] text-red-600 dark:text-red-400">{error}</div> : null}

      <div className="group/list flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        {transactions.length > 0 ? (
          <div className="sticky top-0 z-10 flex justify-end border-b border-zinc-100 bg-white/90 px-3 py-1.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
            <button
              type="button"
              onClick={() => void deleteAllExpenses()}
              className={`rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                deleteAllArmed
                  ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900'
                  : 'text-zinc-300 hover:text-red-600 dark:text-zinc-600 dark:hover:text-red-300'
              }`}
            >
              {deleteAllArmed ? `Confirm Delete All ${transactions.length}` : 'Delete All'}
            </button>
          </div>
        ) : null}
        {adding ? <AddTransactionRow accounts={accounts} onDone={() => { setAdding(false); bumpDataVersion() }} /> : null}
        {visibleTransactions.length === 0 && !adding ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No transactions for {format(selectedMonth, 'MMMM yyyy')} — use the month controls above or import a CSV</div>
        ) : (
          visibleTransactions.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} onChanged={bumpDataVersion} onDelete={() => deleteExpense(transaction.id)} />
          ))
        )}
      </div>
    </div>
  )
}

function hasTransactionsInMonth(transactions: Transaction[], month: Date): boolean {
  const { start, end } = monthBounds(month)
  return transactions.some((transaction) => transaction.date >= start && transaction.date <= end)
}

function ImportedFilesList({ files, formatDate }: { files: ImportedFileRecord[]; formatDate: (unix: number) => string }) {
  return (
    <div className="relative flex min-h-[62px] min-w-0 flex-1 items-start justify-end text-[12px] text-zinc-500 dark:text-zinc-400">
      {files.length === 0 ? (
        <span className="truncate pt-1 text-right">No files for this month</span>
      ) : (
        <div className="flex min-w-0 flex-wrap justify-end gap-x-1 gap-y-0.5 pt-1 text-right">
          {files.map((file, index) => (
            <span key={file.id} className="relative">
              <ImportedFileHover file={file} formatDate={formatDate} />
              {index < files.length - 1 ? <span>,</span> : null}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ImportedFileHover({ file, formatDate }: { file: ImportedFileRecord; formatDate: (unix: number) => string }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" className="max-w-[150px] truncate rounded-md px-1 text-left text-zinc-600 underline decoration-zinc-300 decoration-dotted underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:decoration-zinc-600 dark:hover:text-zinc-100">
        {file.file_name}
      </button>
      <div className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-40 hidden w-[420px] overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-xl group-hover:block dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-start gap-3 border-b border-zinc-100 p-3 dark:border-zinc-800">
          <CsvFileIcon label={file.file_type || 'CSV'} />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{file.file_name}</span>
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
                  <th key={header} className="truncate border border-zinc-200 bg-zinc-50 px-1.5 py-1 text-left font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {file.preview.rows.slice(0, 5).map((row, rowIndex) => (
                <tr key={`${file.id}-${rowIndex}`}>
                  {row.slice(0, 6).map((cell, cellIndex) => (
                    <td key={`${file.id}-${rowIndex}-${cellIndex}`} className="truncate border border-zinc-200 px-1.5 py-1 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                      {cell || ' '}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </span>
  )
}

function ExpensesFilterBar({
  accounts,
  categories,
  selectedAccountIds,
  selectedCategories,
  onToggleAccount,
  onToggleCategory,
  onClearAccounts,
  onClearCategories
}: {
  accounts: Account[]
  categories: string[]
  selectedAccountIds: number[]
  selectedCategories: string[]
  onToggleAccount: (id: number) => void
  onToggleCategory: (category: string) => void
  onClearAccounts: () => void
  onClearCategories: () => void
}) {
  return (
    <div className="sticky top-0 z-10 shrink-0 rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      <FilterRow label="Accounts" hasSelection={selectedAccountIds.length > 0} onClear={onClearAccounts}>
        {accounts.map((account) => (
          <FilterPill key={account.id} label={account.name} active={selectedAccountIds.includes(account.id)} tone="sky" onClick={() => onToggleAccount(account.id)} />
        ))}
      </FilterRow>
      <FilterRow label="Categories" hasSelection={selectedCategories.length > 0} onClear={onClearCategories}>
        {categories.map((category) => (
          <FilterPill key={category} label={category} active={selectedCategories.includes(category)} tone={categoryTone(category)} onClick={() => onToggleCategory(category)} />
        ))}
      </FilterRow>
    </div>
  )
}

function FilterRow({ label, hasSelection, onClear, children }: { label: string; hasSelection: boolean; onClear: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1">
      <FilterGlyph label={label} />
      <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label={`${label} filters`}>
        {children}
      </div>
      {hasSelection ? (
        <button type="button" onClick={onClear} className="ml-auto rounded-full px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
          Clear
        </button>
      ) : null}
    </div>
  )
}

function FilterGlyph({ label }: { label: string }) {
  return (
    <div className="group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800" aria-label={label}>
      <FilterIcon />
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-20 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 dark:bg-zinc-100 dark:text-zinc-900">
        {label}
      </span>
    </div>
  )
}

function FilterPill({ label, active, tone, onClick }: { label: string; active: boolean; tone: 'emerald' | 'amber' | 'sky' | 'violet' | 'red' | 'zinc'; onClick: () => void }) {
  const activeClass =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700 ring-amber-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900'
        : tone === 'sky'
          ? 'bg-sky-50 text-sky-700 ring-sky-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900'
          : tone === 'violet'
            ? 'bg-violet-50 text-violet-700 ring-violet-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900'
            : tone === 'red'
              ? 'bg-red-50 text-red-700 ring-red-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900'
              : 'bg-zinc-900 text-white ring-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-zinc-100 dark:text-zinc-950 dark:ring-zinc-100'
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-all duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 ${
        active
          ? activeClass
          : 'bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass(tone, active)}`} />
      {label}
    </button>
  )
}

function categoryTone(category: string): 'emerald' | 'amber' | 'sky' | 'violet' | 'red' | 'zinc' {
  const normalized = category.toLowerCase()
  if (normalized.includes('groceries') || normalized.includes('income')) return 'emerald'
  if (normalized.includes('bar') || normalized.includes('entertainment') || normalized.includes('travel')) return 'amber'
  if (normalized.includes('transportation') || normalized.includes('gas') || normalized.includes('car')) return 'sky'
  if (normalized.includes('business') || normalized.includes('ai') || normalized.includes('subscription')) return 'violet'
  if (normalized.includes('rent') || normalized.includes('health') || normalized.includes('insurance')) return 'red'
  return 'zinc'
}

function dotClass(tone: 'emerald' | 'amber' | 'sky' | 'violet' | 'red' | 'zinc', active: boolean): string {
  if (!active) return 'bg-zinc-300 dark:bg-zinc-600'
  if (tone === 'emerald') return 'bg-emerald-500'
  if (tone === 'amber') return 'bg-amber-500'
  if (tone === 'sky') return 'bg-sky-500'
  if (tone === 'violet') return 'bg-violet-500'
  if (tone === 'red') return 'bg-red-500'
  return 'bg-zinc-500'
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h12" />
      <path d="M6.5 10h7" />
      <path d="M9 14h2" />
    </svg>
  )
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === 'down' ? 'M5 7.5 L10 12.5 L15 7.5' : 'M5 12.5 L10 7.5 L15 12.5'} />
    </svg>
  )
}

function CsvFileIcon({ label }: { label: string }) {
  return (
    <span className="relative inline-flex h-12 w-10 shrink-0 items-end justify-center rounded-md border border-zinc-200 bg-white pb-1 text-[8px] font-semibold text-emerald-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-emerald-300">
      <span className="absolute right-0 top-0 h-3 w-3 rounded-bl border-b border-l border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800" />
      {label.slice(0, 4)}
    </span>
  )
}

function XIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="m3 3 6 6M9 3 3 9" />
    </svg>
  )
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

function TransactionRow({ transaction, onChanged, onDelete }: { transaction: Transaction; onChanged: () => void; onDelete: () => Promise<void> }) {
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
        <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className="bg-transparent outline-none" />
      ) : (
        <button type="button" onDoubleClick={() => setEditing('description')} className="truncate text-left text-zinc-900 dark:text-zinc-100">{transaction.description || 'Untitled'}</button>
      )}
      {editing === 'category' ? (
        <input autoFocus value={category} onChange={(e) => setCategory(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className="bg-transparent outline-none" />
      ) : (
        <button type="button" onDoubleClick={() => setEditing('category')} className="truncate text-left text-zinc-500 dark:text-zinc-400">{transaction.mapped_category || 'Uncategorized'}</button>
      )}
      <div className={`text-right font-medium ${transaction.amount < 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(transaction.amount)}</div>
      <button
        type="button"
        onClick={() => void onDelete()}
        aria-label={`Delete ${transaction.description || 'transaction'}`}
        title="Delete expense"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover/row:opacity-100 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-300"
      >
        <XIcon />
      </button>
    </div>
  )
}

function AddTransactionRow({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Uncategorized')

  async function create(): Promise<void> {
    await window.api.createTransaction({
      date: Math.floor(Date.now() / 1000),
      description,
      amount: parseCurrencyInput(amount),
      mapped_category: category,
      raw_category: category,
      account_id: accounts[0]?.id ?? null,
      source: 'manual'
    })
    onDone()
  }

  return (
    <div className="grid grid-cols-[110px_1fr_170px_120px] items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-zinc-500">Today</div>
      <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="bg-transparent outline-none" />
      <input value={category} onChange={(e) => setCategory(e.target.value)} className="bg-transparent outline-none" />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={create} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="$0.00" className="bg-transparent text-right outline-none" />
    </div>
  )
}
