import { useEffect, useState } from 'react'
import type { Account, AccountType, BackupFile, BudgetItem, CategoryMappingRule, ModelInfo } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { formatDate } from '../lib/dates'

export function Settings() {
  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Settings</h1>
      <div className="mt-5 space-y-5">
        <RulesSection />
        <BudgetCategoriesSection />
        <AccountsSection />
        <AppearanceSection />
        <BackupsSection />
        <AiModelSection />
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {children}
    </section>
  )
}

function RulesSection() {
  const { bumpDataVersion } = useAppContext()
  const [rules, setRules] = useState<CategoryMappingRule[]>([])
  const [confirm, setConfirm] = useState<number | null>(null)

  function reload(): void {
    window.api.getCategoryRules().then(setRules)
  }
  useEffect(reload, [])

  async function update(id: number, data: Partial<CategoryMappingRule>): Promise<void> {
    await window.api.updateCategoryRule(id, data)
    reload()
  }

  return (
    <Panel title="Category Mapping Rules">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-zinc-500">
              <th className="py-2">Raw Category</th>
              <th>Contains</th>
              <th>Mapped To</th>
              <th>Priority</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <EditableCell value={rule.raw_category} onSave={(value) => update(rule.id, { raw_category: value })} />
                <EditableCell value={rule.description_contains} onSave={(value) => update(rule.id, { description_contains: value })} />
                <EditableCell value={rule.mapped_category} onSave={(value) => update(rule.id, { mapped_category: value })} />
                <EditableCell value={String(rule.priority)} onSave={(value) => update(rule.id, { priority: Number(value) || 0 })} align="right" />
                <td className="py-2 text-right">
                  {confirm === rule.id ? (
                    <span className="space-x-2">
                      <button type="button" onClick={async () => { await window.api.deleteCategoryRule(rule.id); reload(); }} className="text-red-600">delete</button>
                      <button type="button" onClick={() => setConfirm(null)} className="text-zinc-500">cancel</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirm(rule.id)} className="text-zinc-500">Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={async () => { await window.api.createCategoryRule({ mapped_category: 'Uncategorized' }); reload(); }} className="rounded-full bg-zinc-100 px-3 py-1.5 text-[12px] font-medium dark:bg-zinc-800 dark:text-zinc-100">Add rule</button>
        <button type="button" onClick={async () => { await window.api.recategorizeAllTransactions(); bumpDataVersion(); }} className="rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-950">Re-categorize All Transactions</button>
      </div>
    </Panel>
  )
}

function BudgetCategoriesSection() {
  const { bumpDataVersion } = useAppContext()
  const [items, setItems] = useState<BudgetItem[]>([])
  const [confirm, setConfirm] = useState<number | null>(null)
  const reload = (): void => { window.api.getBudgetItems().then(setItems) }
  useEffect(reload, [])

  return (
    <Panel title="Budget Categories">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="grid grid-cols-[1fr_120px_140px_90px] items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-950">
            <EditablePlain value={item.category} onSave={async (value) => { await window.api.updateBudgetItem(item.id, { category: value }); reload(); bumpDataVersion(); }} />
            <button type="button" onClick={async () => { await window.api.updateBudgetItem(item.id, { is_need: !item.is_need }); reload(); bumpDataVersion(); }} className="rounded-full bg-white px-2.5 py-1 text-[12px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{item.is_need ? 'Need' : 'Nice'}</button>
            <EditablePlain value={formatCurrency(item.amount_standard)} align="right" onSave={async (value) => { await window.api.updateBudgetItem(item.id, { amount_standard: parseCurrencyInput(value) }); reload(); bumpDataVersion(); }} />
            {confirm === item.id ? (
              <div className="text-right text-[12px]"><button type="button" onClick={async () => { await window.api.deleteBudgetItem(item.id); reload(); bumpDataVersion(); }} className="text-red-600">delete</button></div>
            ) : (
              <button type="button" onClick={() => setConfirm(item.id)} className="text-right text-[12px] text-zinc-500">Delete</button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={async () => { await window.api.createBudgetItem({ category: 'New Category' }); reload(); bumpDataVersion(); }} className="mt-3 rounded-full bg-zinc-100 px-3 py-1.5 text-[12px] font-medium dark:bg-zinc-800 dark:text-zinc-100">Add category</button>
    </Panel>
  )
}

function AccountsSection() {
  const { bumpDataVersion } = useAppContext()
  const [accounts, setAccounts] = useState<Account[]>([])
  const reload = (): void => { window.api.getAccounts().then(setAccounts) }
  useEffect(reload, [])
  const types: AccountType[] = ['checking', 'savings', 'credit', 'venmo']

  return (
    <Panel title="Accounts">
      <div className="space-y-2">
        {accounts.map((account) => (
          <div key={account.id} className="grid grid-cols-[1fr_260px_80px] items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-950">
            <EditablePlain value={account.name} onSave={async (value) => { await window.api.updateAccount(account.id, { name: value }); reload(); bumpDataVersion(); }} />
            <div className="flex gap-1">
              {types.map((type) => (
                <button key={type} type="button" onClick={async () => { await window.api.updateAccount(account.id, { type }); reload(); }} className={`rounded-full px-2 py-1 text-[11px] ${account.type === type ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'bg-white text-zinc-500 dark:bg-zinc-800'}`}>{type}</button>
              ))}
            </div>
            <input type="color" value={account.color} onChange={async (event) => { await window.api.updateAccount(account.id, { color: event.target.value }); reload(); }} className="h-7 w-12 bg-transparent" />
          </div>
        ))}
      </div>
      <button type="button" onClick={async () => { await window.api.createAccount({ name: 'New Account' }); reload(); bumpDataVersion(); }} className="mt-3 rounded-full bg-zinc-100 px-3 py-1.5 text-[12px] font-medium dark:bg-zinc-800 dark:text-zinc-100">Add account</button>
    </Panel>
  )
}

function AppearanceSection() {
  const { theme, toggleTheme } = useTheme()
  return (
    <Panel title="Appearance">
      <button type="button" onClick={toggleTheme} className="rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-950">
        {theme === 'dark' ? 'Use Light Mode' : 'Use Dark Mode'}
      </button>
    </Panel>
  )
}

function BackupsSection() {
  const [backups, setBackups] = useState<BackupFile[]>([])
  const [busy, setBusy] = useState(false)
  const reload = (): void => { window.api.getBackupList().then(setBackups) }
  useEffect(reload, [])

  return (
    <Panel title="Data & Backups">
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); await window.api.backupNow(); reload(); setBusy(false); }} className="rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-950">{busy ? 'Backing up' : 'Back Up Now'}</button>
      <div className="mt-3 space-y-1 text-[12px] text-zinc-500 dark:text-zinc-400">
        {backups.slice(0, 7).map((backup) => <div key={backup.path}>{backup.name} · {formatDate(backup.createdAt)}</div>)}
        <div>Restore by replacing money.db in the Scoop Money userData folder while the app is closed.</div>
      </div>
    </Panel>
  )
}

function AiModelSection() {
  const [current, setCurrent] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    window.api.getModel().then(setCurrent)
    window.api.getAvailableModels().then(setModels).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <Panel title="AI Model">
      <div className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">Current: {current || 'Not loaded'}</div>
      {error ? <div className="mb-2 text-[12px] text-red-600 dark:text-red-400">{error}</div> : null}
      <div className="flex flex-wrap gap-2">
        {models.map((model) => (
          <button key={model.id} type="button" onClick={async () => { const result = await window.api.setModel(model.id); if (result.success) setCurrent(model.id); }} className={`rounded-full px-3 py-1 text-[12px] ${current === model.id ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
            {model.display_name || model.id}
          </button>
        ))}
      </div>
    </Panel>
  )
}

function EditableCell({ value, onSave, align = 'left' }: { value: string; onSave: (value: string) => void | Promise<void>; align?: 'left' | 'right' }) {
  return <td className={`py-2 ${align === 'right' ? 'text-right' : ''}`}><EditablePlain value={value} onSave={onSave} align={align} /></td>
}

function EditablePlain({ value, onSave, align = 'left' }: { value: string; onSave: (value: string) => void | Promise<void>; align?: 'left' | 'right' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  async function save(): Promise<void> {
    setEditing(false)
    if (draft !== value) await onSave(draft)
  }
  if (editing) {
    return <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className={`w-full bg-transparent outline-none ${align === 'right' ? 'text-right' : ''}`} />
  }
  return <button type="button" onDoubleClick={() => { setDraft(value); setEditing(true); }} className={`w-full truncate text-${align} text-zinc-800 dark:text-zinc-100`}>{value || 'Empty'}</button>
}
