import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { formatDate, monthBounds } from '../lib/dates'

export function Transactions() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState<number | null>(null)
  const [category, setCategory] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { start, end } = monthBounds()

  useEffect(() => {
    Promise.all([
      window.api.getAccounts(),
      window.api.getTransactions({ accountId, category: category || undefined, start, end })
    ]).then(([nextAccounts, nextTransactions]) => {
      setAccounts(nextAccounts)
      setTransactions(nextTransactions)
    })
  }, [accountId, category, dataVersion, end, start])

  const categories = useMemo(
    () => Array.from(new Set(transactions.map((tx) => tx.mapped_category).filter(Boolean))).sort(),
    [transactions]
  )

  async function importFile(file: File): Promise<void> {
    const path = (file as File & { path?: string }).path
    if (!path) {
      setError('Could not read the selected file path.')
      return
    }
    const targetAccountId = accountId ?? accounts[0]?.id
    if (!targetAccountId) {
      setError('Create an account before importing transactions.')
      return
    }
    const result = await window.api.importTransactions(path, targetAccountId)
    setError(result.errors[0] ?? '')
    bumpDataVersion()
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Transactions</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Import, review, and lightly edit this month’s money movement.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAdding(true)} className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-950">
            Add Transaction
          </button>
          <button type="button" onClick={() => inputRef.current?.click()} className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-100">
            Import
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) importFile(file)
              event.currentTarget.value = ''
            }}
          />
        </div>
      </div>

      <div
        className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-400"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file) importFile(file)
        }}
      >
        Drop a CSV or Excel file here, or use Import.
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <FilterChip label="All accounts" active={accountId === null} onClick={() => setAccountId(null)} />
        {accounts.map((account) => (
          <FilterChip key={account.id} label={account.name} active={accountId === account.id} onClick={() => setAccountId(account.id)} />
        ))}
        <div className="mx-1 h-7 w-px bg-zinc-200 dark:bg-zinc-700" />
        <FilterChip label="All categories" active={!category} onClick={() => setCategory('')} />
        {categories.map((item) => (
          <FilterChip key={item} label={item} active={category === item} onClick={() => setCategory(item)} />
        ))}
      </div>
      {error ? <div className="text-[12px] text-red-600 dark:text-red-400">{error}</div> : null}

      <div className="flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        {adding ? <AddTransactionRow accounts={accounts} onDone={() => { setAdding(false); bumpDataVersion() }} /> : null}
        {transactions.length === 0 && !adding ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No transactions yet — import a CSV or add one manually</div>
        ) : (
          transactions.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} onChanged={bumpDataVersion} />
          ))
        )}
      </div>
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
        active ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
      }`}
    >
      {label}
    </button>
  )
}

function TransactionRow({ transaction, onChanged }: { transaction: Transaction; onChanged: () => void }) {
  const [editing, setEditing] = useState<'description' | 'category' | null>(null)
  const [description, setDescription] = useState(transaction.description)
  const [category, setCategory] = useState(transaction.mapped_category)

  async function save(): Promise<void> {
    await window.api.updateTransaction(transaction.id, { description, mapped_category: category })
    setEditing(null)
    onChanged()
  }

  return (
    <div className="grid grid-cols-[110px_1fr_170px_120px] items-center gap-3 border-b border-zinc-100 px-4 py-3 text-sm last:border-b-0 dark:border-zinc-800">
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
