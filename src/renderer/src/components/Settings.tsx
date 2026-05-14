import { useEffect, useState } from 'react'
import type { Account, AccountType, AiPromptSettings, AiProvider, AiProviderState, BackupFile, BudgetItem, CategoryMappingRule } from '../../../types/money'
import { BUDGET_CATEGORY_ALLOWLIST, BUDGET_CATEGORY_ORDER } from '../../../types/budgetCategories'
import { useAppContext } from '../context/AppContext'
import { useDateFormat } from '../context/DateFormatContext'
import { useTheme } from '../context/ThemeContext'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'

export function Settings() {
  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Settings</h1>
      <div className="mt-5 space-y-5">
        <DisplaySection />
        <RulesSection />
        <ImportRulesFramework />
        <BudgetCategoriesSection />
        <AccountsSection />
        <AiModelSection />
        <AiPromptsSection />
        <BackupsSection />
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

// ---------------------------------------------------------------------------
// Import rules framework
// ---------------------------------------------------------------------------

const VENMO_CATEGORY_RULES: ReadonlyArray<{ pattern: string; category: string }> = [
  { pattern: 'Rent keywords + 🏠 / housing terms', category: 'Rent' },
  { pattern: 'wifi, eero, internet, broadband', category: 'Internet' },
  { pattern: 'utility, electric, water, PG&E', category: 'Utilities' },
  { pattern: 'insurance, geico, state farm', category: 'Insurance' },
  { pattern: 'doctor, pharmacy, dental, therapy', category: 'Healthcare' },
  { pattern: 'costco, grocery, trader joe, safeway', category: 'Groceries' },
  { pattern: '🍺🍷🍸 emojis, bar, pub, brewery, cocktail, beer, wine', category: 'Bar/ Alcohol' },
  { pattern: '🍕🍔☕ emojis, food, restaurant, cafe, brunch, pizza, sushi', category: 'Dining' },
  { pattern: 'stores, clothes, shoes, retail, amazon, boards', category: 'Shopping' },
  { pattern: 'movie, concert, ticket, sports, theater, festival', category: 'Entertainment' },
  { pattern: 'gas, automotive, tesla, car wash', category: 'Gas/Automotive' },
  { pattern: 'uber, lyft, parking, transit, bart, train', category: 'Transportation' },
  { pattern: 'flight, hotel, airbnb, vacation, travel', category: 'Travel' },
  { pattern: 'subscription, spotify, netflix, gym', category: 'Subscriptions' },
  { pattern: 'phone, tmobile, verizon, mint mobile', category: 'Phone' },
  { pattern: 'photo, camera, studio, client, invoice', category: 'Business Expenses' }
]

const VENMO_INCOME_TERMS = 'photo, photography, editing, edit, photo class, class, teaching, lesson, lessons, tip, tips, shoot'

function ImportRulesFramework() {
  const [venmoOpen, setVenmoOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [checkingOpen, setCheckingOpen] = useState(false)
  const [incomeOpen, setIncomeOpen] = useState(false)

  return (
    <Panel title="Import Rules">
      {/* Venmo */}
      <CollapsibleRuleSection title="Venmo Import CSV Rules" subtitle="Deterministic category matching from Venmo note/description" open={venmoOpen} onToggle={() => setVenmoOpen((v) => !v)}>
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Category detection</p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">When a Venmo CSV is imported, each row&apos;s note is scanned against these keyword patterns. The first match wins.</p>
            <div className="mt-2 space-y-1">
              {VENMO_CATEGORY_RULES.map((rule) => (
                <div key={rule.category} className="flex items-start gap-2 rounded-md bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-950">
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{rule.category}</span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{rule.pattern}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Income candidate detection</p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Positive-amount Venmo transactions whose note matches any of these terms are flagged with a green &ldquo;Income?&rdquo; chip on the Transactions page for manual review.
            </p>
            <div className="mt-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              {VENMO_INCOME_TERMS}
            </div>
          </div>
        </div>
      </CollapsibleRuleSection>

      {/* Credit Cards */}
      <CollapsibleRuleSection title="Capital One Import Rules" subtitle="Capital One auto-detection; debit → negative, credit → positive" open={creditOpen} onToggle={() => setCreditOpen((v) => !v)}>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Capital One CSVs are detected by column headers (Transaction Date, Posted Date, Card No., Debit, Credit). Autopay rows are skipped. Category mapping uses the bank&apos;s raw category field.</p>
      </CollapsibleRuleSection>

      {/* Checking */}
      <CollapsibleRuleSection title="Chase Import Rules" subtitle="Chase account imports" open={checkingOpen} onToggle={() => setCheckingOpen((v) => !v)}>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">No custom rules yet. Imported transactions use the generic category mapping rules above.</p>
      </CollapsibleRuleSection>

      {/* Income */}
      <CollapsibleRuleSection title="Income Rules" subtitle="Actual income import and expected income / tax assumptions" open={incomeOpen} onToggle={() => setIncomeOpen((v) => !v)}>
        <div className="space-y-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Actual income import</p>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Income entries are created via the Income page AI chat. The AI prompt is configurable in the &ldquo;AI Backend Prompts&rdquo; section below (Income Actual system prompt).</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Expected income &amp; tax</p>
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">Tax assumptions and expected income rules are managed on the Income page. No import-level rules are configured here.</p>
          </div>
        </div>
      </CollapsibleRuleSection>
    </Panel>
  )
}

function CollapsibleRuleSection({ title, subtitle, open, onToggle, children }: {
  title: string; subtitle: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-3 py-2 text-left transition-colors hover:bg-zinc-100/90 dark:border-zinc-700/80 dark:bg-zinc-950/60 dark:hover:bg-zinc-800/55"
      >
        <span>
          <span className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">{title}</span>
          <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">{subtitle}</span>
        </span>
        <SettingsChevronIcon expanded={open} />
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-zinc-100 bg-white/60 px-3 py-3 dark:border-zinc-700/80 dark:bg-zinc-950/40">
          {children}
        </div>
      )}
    </div>
  )
}

function BudgetCategoriesSection() {
  const { bumpDataVersion } = useAppContext()
  const [items, setItems] = useState<BudgetItem[]>([])
  const [confirm, setConfirm] = useState<number | null>(null)
  const reload = (): void => { window.api.getBudgetItems().then(setItems) }
  useEffect(reload, [])

  const sortedItems = [...items]
    .filter((item) => BUDGET_CATEGORY_ALLOWLIST.has(item.category))
    .sort((a, b) => {
      const ia = (BUDGET_CATEGORY_ORDER as readonly string[]).indexOf(a.category)
      const ib = (BUDGET_CATEGORY_ORDER as readonly string[]).indexOf(b.category)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    })

  return (
    <Panel title="Budget Categories">
      <div className="mb-2 grid grid-cols-[1fr_96px_115px_115px_115px_72px] gap-3 px-3 text-[11px] uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
        <span>Category</span>
        <span>Group</span>
        <span className="text-right">Standard</span>
        <span className="text-right">With Parents</span>
        <span className="text-right">With Aid</span>
        <span className="text-right">Actions</span>
      </div>
      <div className="space-y-2">
        {sortedItems.map((item) => (
          <div key={item.id} className="grid grid-cols-[1fr_96px_115px_115px_115px_72px] items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-950">
            <EditablePlain value={item.category} onSave={async (value) => { await window.api.updateBudgetItem(item.id, { category: value }); reload(); bumpDataVersion(); }} />
            <button type="button" onClick={async () => { await window.api.updateBudgetItem(item.id, { is_need: !item.is_need }); reload(); bumpDataVersion(); }} className="rounded-full bg-white px-2.5 py-1 text-[12px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{item.is_need ? 'Need' : 'Want'}</button>
            <EditablePlain value={formatCurrency(item.amount_standard)} align="right" onSave={async (value) => { await window.api.updateBudgetItem(item.id, { amount_standard: parseCurrencyInput(value) }); reload(); bumpDataVersion(); }} />
            <EditablePlain value={formatCurrency(item.amount_with_parents)} align="right" onSave={async (value) => { await window.api.updateBudgetItem(item.id, { amount_with_parents: parseCurrencyInput(value) }); reload(); bumpDataVersion(); }} />
            <EditablePlain value={formatCurrency(item.amount_with_aid)} align="right" onSave={async (value) => { await window.api.updateBudgetItem(item.id, { amount_with_aid: parseCurrencyInput(value) }); reload(); bumpDataVersion(); }} />
            {confirm === item.id ? (
              <div className="text-right text-[12px]"><button type="button" onClick={async () => { await window.api.deleteBudgetItem(item.id); reload(); bumpDataVersion(); }} className="text-red-600">delete</button></div>
            ) : (
              <button type="button" onClick={() => setConfirm(item.id)} className="text-right text-[12px] text-zinc-500">Delete</button>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
        Categories are fixed to the app&apos;s budget list; edit amounts here or use the Budget page for line items.
      </p>
    </Panel>
  )
}

function AccountsSection() {
  const { bumpDataVersion } = useAppContext()
  const [accounts, setAccounts] = useState<Account[]>([])
  const reload = (): void => { window.api.getAccounts().then(setAccounts) }
  useEffect(reload, [])
  const types: AccountType[] = ['capital_one', 'venmo', 'ebt', 'chase']

  return (
    <Panel title="Accounts">
      <div className="space-y-2">
        {accounts.map((account) => (
          <div key={account.id} className="grid grid-cols-[1fr_260px_80px] items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-950">
            <EditablePlain value={account.name} onSave={async (value) => { await window.api.updateAccount(account.id, { name: value }); reload(); bumpDataVersion(); }} />
            <div className="flex gap-1">
              {types.map((type) => (
                <button key={type} type="button" onClick={async () => { await window.api.updateAccount(account.id, { type }); reload(); }} className={`rounded-full px-2 py-1 text-[11px] ${account.type === type ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'bg-white text-zinc-500 dark:bg-zinc-800'}`}>{accountTypeLabel(type)}</button>
              ))}
            </div>
            <input type="color" value={account.color} onChange={async (event) => { await window.api.updateAccount(account.id, { color: event.target.value }); reload(); }} className="h-7 w-12 bg-transparent" />
          </div>
        ))}
      </div>
      <button type="button" onClick={async () => { await window.api.createAccount({ name: 'Capital One', type: 'capital_one' }); reload(); bumpDataVersion(); }} className="mt-3 rounded-full bg-zinc-100 px-3 py-1.5 text-[12px] font-medium dark:bg-zinc-800 dark:text-zinc-100">Add account</button>
    </Panel>
  )
}

function accountTypeLabel(type: AccountType): string {
  if (type === 'capital_one') return 'Capital One'
  if (type === 'venmo') return 'Venmo'
  if (type === 'ebt') return 'EBT'
  return 'Chase'
}

function DisplaySection() {
  const { dateFormat, setDateFormat } = useDateFormat()
  const { theme, setTheme } = useTheme()
  const { textScale, setTextScale } = useAppContext()

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Display</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Date format and app appearance.</p>
      <div className="mt-4 grid items-end gap-6 md:grid-cols-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-300">Date format</p>
          <div className="mt-1.5 inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Date display format">
            <SegmentedButton active={dateFormat === 'absolute'} onClick={() => setDateFormat('absolute')}>MM/DD/YY</SegmentedButton>
            <SegmentedButton active={dateFormat === 'relative'} onClick={() => setDateFormat('relative')}>Relative (3 days ago)</SegmentedButton>
          </div>
        </div>
        <div className="min-w-0 justify-self-start md:justify-self-center">
          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-300">Appearance</p>
          <div className="mt-1.5 inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Color theme">
            <SegmentedButton active={theme === 'auto'} onClick={() => setTheme('auto')}>Auto</SegmentedButton>
            <SegmentedButton active={theme === 'light'} onClick={() => setTheme('light')}>Day</SegmentedButton>
            <SegmentedButton active={theme === 'dark'} onClick={() => setTheme('dark')}>Night</SegmentedButton>
          </div>
        </div>
        <div className="min-w-0 justify-self-stretch md:justify-self-end">
          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-300">Text size</p>
          <div className="mt-1.5 flex w-full max-w-[13rem] items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 dark:bg-zinc-800">
            <input
              type="range"
              min={90}
              max={110}
              step={2.5}
              value={Math.round(textScale * 1000) / 10}
              onChange={(event) => setTextScale(Number.parseFloat(event.target.value) / 100)}
              className="h-1.5 min-w-0 flex-1 accent-zinc-700 dark:accent-zinc-300"
              aria-label="Text size"
            />
            <span className="w-[2.75rem] shrink-0 text-right text-xs font-medium tabular-nums text-zinc-600 dark:text-zinc-300">{Math.round(textScale * 100)}%</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
          : 'text-zinc-500 dark:text-zinc-400'
      }`}
    >
      {children}
    </button>
  )
}

function BackupsSection() {
  const [backups, setBackups] = useState<BackupFile[]>([])
  const [keepCount, setKeepCount] = useState(7)
  const [keepDraft, setKeepDraft] = useState('7')
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [lastBackupPath, setLastBackupPath] = useState('')
  const reload = (): void => { window.api.getBackupList().then(setBackups) }

  useEffect(() => {
    reload()
    window.api.getBackupRetention().then((count) => {
      setKeepCount(count)
      setKeepDraft(String(count))
    }).catch(() => undefined)
  }, [])

  async function commitRetention(): Promise<void> {
    const parsed = Number.parseInt(keepDraft, 10)
    try {
      const next = await window.api.setBackupRetention(parsed)
      setKeepCount(next)
      setKeepDraft(String(next))
      reload()
    } catch {
      setKeepDraft(String(keepCount))
    }
  }

  async function backupNow(): Promise<void> {
    setStatus('running')
    try {
      const result = await window.api.backupNow()
      setLastBackupPath(result.path)
      setStatus('success')
      reload()
    } catch {
      setStatus('error')
    }
    window.setTimeout(() => setStatus('idle'), 3000)
  }

  return (
    <section className="mb-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Data &amp; backups</h2>

      <div className="mt-4">
        <button
          type="button"
          title="Coming soon"
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
          disabled
        >
          Export all transactions to CSV
        </button>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Coming soon</p>
      </div>

      <div className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Database backups</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Rotating copies are saved next to your Scoop Money database. When there are more than your chosen limit, the oldest files are removed automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void window.api.openBackupFolder()}
            title="Go to backup folder"
            aria-label="Go to backup folder"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <FolderIcon />
          </button>
        </div>
        <label className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="shrink-0">Keep last</span>
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            value={keepDraft}
            onChange={(event) => setKeepDraft(event.target.value)}
            onBlur={() => void commitRetention()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void commitRetention()
              }
            }}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-center tabular-nums text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <span className="shrink-0">backup files (1-50)</span>
        </label>
        <button
          type="button"
          onClick={() => void backupNow()}
          disabled={status === 'running'}
          className="mt-3 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {status === 'idle' && 'Back Up Now'}
          {status === 'running' && 'Backing up...'}
          {status === 'success' && '✓ Backed up'}
          {status === 'error' && 'Backup failed'}
        </button>
        {lastBackupPath && status !== 'running' ? (
          <p className="mt-2 truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{lastBackupPath}</p>
        ) : null}
        <ul className="mt-4 space-y-2 border-t border-zinc-200/90 pt-3 dark:border-zinc-700/80">
          {backups.length === 0 ? (
            <li className="text-xs text-zinc-400 dark:text-zinc-500">No backups yet</li>
          ) : (
            backups.map((backup) => (
              <li key={backup.path} className="flex items-center justify-between gap-3 text-xs text-zinc-700 dark:text-zinc-300">
                <span className="min-w-0 truncate">{formatBackupFilenameLabel(backup.name, backup.createdAt)}</span>
                <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">{formatBackupFileSize(backup.size)}</span>
              </li>
            ))
          )}
        </ul>
        <p className="mt-4 text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
          Scoop Money backs up automatically at noon and 8 PM, and on quit. Lowering the keep count removes older backups immediately. To restore: quit Scoop Money, open Finder - Go - Library - Application Support - scoop-money - replace <span className="font-mono text-zinc-500 dark:text-zinc-400">money.db</span> with your chosen backup file, then relaunch.
        </p>
      </div>
    </section>
  )
}

function formatBackupFilenameLabel(filename: string, createdAt: number): string {
  const match = /^backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(filename)
  const date = match
    ? new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    )
    : new Date(createdAt * 1000)
  const datePart = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${datePart} - ${timePart}`
}

function formatBackupFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.8 5.8h5l1.5 2h7.9" />
      <path d="M3.2 5.8h13.6a1.2 1.2 0 0 1 1.2 1.2v8.1a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 15.1V7a1.2 1.2 0 0 1 1.2-1.2Z" />
    </svg>
  )
}

function AiModelSection() {
  const [state, setState] = useState<AiProviderState | null>(null)
  const [loadingProvider, setLoadingProvider] = useState<AiProvider | null>(null)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [error, setError] = useState('')

  function reload(): void {
    window.api.getAiProvider()
      .then((next) => {
        setState(next)
        setError('')
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(() => {
    reload()
  }, [])

  async function selectProvider(provider: AiProvider): Promise<void> {
    setLoadingProvider(provider)
    setError('')
    try {
      const next = await window.api.setAiProvider(provider)
      setState(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingProvider(null)
    }
  }

  async function selectModel(id: string): Promise<void> {
    if (!state) return
    setError('')
    const result = await window.api.setModel(id)
    if (!result.success) {
      setError(result.reason ?? 'Could not select model.')
      return
    }
    setState({ ...state, model: id })
  }

  const provider = state?.provider ?? 'anthropic'
  const configured = state?.configured ?? false

  return (
    <Panel title="AI Model">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Provider SDK</div>
          <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="AI provider">
            {(['anthropic', 'openai'] as const).map((item) => {
              const active = provider === item
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => void selectProvider(item)}
                  aria-pressed={active}
                  disabled={loadingProvider !== null}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    active
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  {item === 'anthropic' ? 'Anthropic SDK' : 'OpenAI SDK'}
                </button>
              )
            })}
          </div>
        </div>
        <div className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${configured ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}>
          {configured ? 'API key detected' : provider === 'anthropic' ? 'ANTHROPIC_API_KEY needed' : 'OPENAI_API_KEY needed'}
        </div>
      </div>
      <div className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">Default model: {state?.models.find((model) => model.id === state.model)?.display_name ?? state?.model ?? 'Not loaded'}</div>
      {error ? <div className="mb-2 text-[12px] text-red-600 dark:text-red-400">{error}</div> : null}
      <button
        type="button"
        onClick={() => setModelsOpen((value) => !value)}
        aria-expanded={modelsOpen}
        className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-3 py-2 text-left transition-colors hover:bg-zinc-100/90 dark:border-zinc-700/80 dark:bg-zinc-950/60 dark:hover:bg-zinc-800/55"
      >
        <span>
          <span className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">Default chat model</span>
          <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">Expand to choose which model new chats use for the selected SDK.</span>
        </span>
        <SettingsChevronIcon expanded={modelsOpen} />
      </button>
      {modelsOpen ? (
        <div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-zinc-100 bg-white/60 px-3 py-3 dark:border-zinc-700/80 dark:bg-zinc-950/40">
          {state?.models.map((model) => (
            <button key={model.id} type="button" onClick={() => void selectModel(model.id)} className={`rounded-full px-3 py-1 text-[12px] ${state.model === model.id ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
              {model.display_name || model.id}
            </button>
          ))}
          {state && state.models.length === 0 ? <span className="text-[12px] text-zinc-400">No models loaded.</span> : null}
        </div>
      ) : null}
    </Panel>
  )
}

const AI_PROMPT_FIELDS: Array<{
  key: keyof AiPromptSettings
  label: string
  rows: number
  help: string
}> = [
  {
    key: 'general_system_prompt',
    label: 'General finance system prompt',
    rows: 9,
    help: 'Used by Dashboard, Expenses, Income Summary, and general finance chat. Available placeholders: {accuracy_instruction}, {money_data}, {page_id}.'
  },
  {
    key: 'income_actual_system_prompt',
    label: 'Income Actual system prompt',
    rows: 9,
    help: 'Used by the Income Actual chat when logging or interpreting photography income. Available placeholders: {accuracy_instruction}, {money_data}, {page_id}.'
  },
  {
    key: 'accuracy_instruction',
    label: 'Shared numeric accuracy instruction',
    rows: 5,
    help: 'Injected into prompt templates through {accuracy_instruction}. Keep the cents-to-dollars instruction here so financial math stays reliable.'
  }
]

function AiPromptsSection() {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<AiPromptSettings | null>(null)
  const [draft, setDraft] = useState<AiPromptSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.getAiPromptSettings().then((next) => {
      setSettings(next)
      setDraft(next)
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  async function save(): Promise<void> {
    if (!draft) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const next = await window.api.updateAiPromptSettings(draft)
      setSettings(next)
      setDraft(next)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function reset(): Promise<void> {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const next = await window.api.resetAiPromptSettings()
      setSettings(next)
      setDraft(next)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const dirty = Boolean(settings && draft && AI_PROMPT_FIELDS.some((field) => draft[field.key] !== settings[field.key]))
  const tooShort = Boolean(draft && AI_PROMPT_FIELDS.some((field) => draft[field.key].trim().length < 20))

  return (
    <Panel title="AI Backend Prompts">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-3 py-2 text-left transition-colors hover:bg-zinc-100/90 dark:border-zinc-700/80 dark:bg-zinc-950/60 dark:hover:bg-zinc-800/55"
      >
        <span>
          <span className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">System and page prompts</span>
          <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">Edit the backend instructions sent to the AI chat.</span>
        </span>
        <SettingsChevronIcon expanded={open} />
      </button>

      {open ? (
        <div className="mt-3 rounded-lg border border-zinc-100 bg-white/60 px-3 py-3 dark:border-zinc-700/80 dark:bg-zinc-950/40">
          {!draft ? (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading prompts...</div>
          ) : (
            <>
              <div className="space-y-4">
                {AI_PROMPT_FIELDS.map((field) => (
                  <label key={field.key} className="block">
                    <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">{field.label}</span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{field.help}</span>
                    <textarea
                      value={draft[field.key]}
                      onChange={(event) => {
                        setDraft({ ...draft, [field.key]: event.target.value })
                        setError('')
                      }}
                      rows={field.rows}
                      spellCheck={false}
                      className="mt-2 max-h-[30rem] min-h-[7rem] w-full resize-y rounded-lg border border-zinc-200/80 bg-white px-3 py-2 font-mono text-[11px] leading-snug text-zinc-800 shadow-inner outline-none focus:border-zinc-300 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {saved ? (
                  <span className="mr-auto text-xs font-medium text-emerald-600 dark:text-emerald-400">Saved</span>
                ) : (
                  <span className="mr-auto text-[10px] text-zinc-400 dark:text-zinc-500">Minimum 20 characters per prompt section</span>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void reset()}
                  className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Restore defaults
                </button>
                <button
                  type="button"
                  disabled={saving || tooShort || !dirty}
                  onClick={() => void save()}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  {saving ? 'Saving...' : 'Save prompts'}
                </button>
              </div>
            </>
          )}
          {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
      ) : null}
    </Panel>
  )
}

function SettingsChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-zinc-500 dark:text-zinc-400">
      <path d={expanded ? 'M5 12.5 L10 7.5 L15 12.5' : 'M5 7.5 L10 12.5 L15 7.5'} />
    </svg>
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
  return <button type="button" onDoubleClick={() => { setDraft(value); setEditing(true); }} className={`w-full truncate ${align === 'right' ? 'text-right' : 'text-left'} text-zinc-800 dark:text-zinc-100`}>{value || 'Empty'}</button>
}
