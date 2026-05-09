import { useEffect, useState } from 'react'
import type { IncomeEntry } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { formatDate, monthBounds } from '../lib/dates'
import { ChatBox } from './ChatBox'

export function Income() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const [entries, setEntries] = useState<IncomeEntry[]>([])
  const { start, end } = monthBounds()

  useEffect(() => {
    window.api.getIncomeEntries().then(setEntries)
  }, [dataVersion])

  const monthTotal = entries.filter((entry) => entry.date >= start && entry.date <= end).reduce((sum, entry) => sum + entry.amount, 0)

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Income</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Log photography jobs through chat or edit cards directly.</p>
      </div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Total income this month</div>
        <div className="mt-2 text-3xl font-semibold text-emerald-700 dark:text-emerald-300">{formatCurrency(monthTotal)}</div>
      </div>
      <ChatBox pageId="income" />
      <div className="flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        {entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Paste a photo shoot summary in the chat below to add income</div>
        ) : (
          entries.map((entry) => <IncomeCard key={entry.id} entry={entry} onChanged={bumpDataVersion} />)
        )}
      </div>
    </div>
  )
}

function IncomeCard({ entry, onChanged }: { entry: IncomeEntry; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [field, setField] = useState<'shoot_name' | 'company' | 'amount' | 'notes' | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(next: typeof field, value: string): void {
    setField(next)
    setDraft(value)
  }

  async function save(): Promise<void> {
    if (!field) return
    await window.api.updateIncomeEntry(entry.id, {
      [field]: field === 'amount' ? parseCurrencyInput(draft) : draft
    })
    setField(null)
    onChanged()
  }

  return (
    <div className="border-b border-zinc-100 px-4 py-3 last:border-b-0 dark:border-zinc-800">
      <div className="grid grid-cols-[1fr_120px_130px] gap-3">
        <div>
          {field === 'shoot_name' ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className="w-full bg-transparent font-medium outline-none" />
          ) : (
            <button type="button" onDoubleClick={() => startEdit('shoot_name', entry.shoot_name)} className="text-left font-semibold text-zinc-900 dark:text-zinc-100">{entry.shoot_name || 'Untitled shoot'}</button>
          )}
          {field === 'company' ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className="mt-1 w-full bg-transparent text-[12px] outline-none" />
          ) : (
            <button type="button" onDoubleClick={() => startEdit('company', entry.company)} className="mt-1 block text-left text-[12px] text-zinc-500 dark:text-zinc-400">{entry.company || 'No company'}</button>
          )}
        </div>
        <div className="text-right text-sm text-zinc-500 dark:text-zinc-400">{formatDate(entry.date)}</div>
        {field === 'amount' ? (
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className="bg-transparent text-right font-semibold outline-none" />
        ) : (
          <button type="button" onDoubleClick={() => startEdit('amount', formatCurrency(entry.amount))} className="text-right font-semibold text-emerald-600">{formatCurrency(entry.amount)}</button>
        )}
      </div>
      <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-2 text-[12px] text-zinc-500 dark:text-zinc-400">
        {expanded ? 'Hide notes' : 'Show notes'}
      </button>
      {expanded ? (
        field === 'notes' ? (
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} className="mt-2 min-h-20 w-full resize-none rounded-lg border border-zinc-200 bg-transparent p-2 text-sm outline-none dark:border-zinc-700" />
        ) : (
          <button type="button" onDoubleClick={() => startEdit('notes', entry.notes)} className="mt-2 block w-full text-left text-sm text-zinc-700 dark:text-zinc-300">{entry.notes || 'No notes'}</button>
        )
      ) : null}
    </div>
  )
}
