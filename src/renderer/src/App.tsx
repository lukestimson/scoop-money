import { useState } from 'react'
import { Budget } from './components/Budget'
import { Dashboard } from './components/Dashboard'
import { IncomeActual, IncomeExpected, IncomeSummary } from './components/Income'
import { Settings } from './components/Settings'
import { Summary } from './components/Summary'
import { Transactions } from './components/Transactions'
import { type NavPage, useAppContext } from './context/AppContext'

type NavGroup = 'expenses' | 'income'

const EXPENSE_PAGES: Array<{ id: NavPage; label: string }> = [
  { id: 'expenses-budget', label: 'Budget' },
  { id: 'expenses-actual', label: 'Actual' },
  { id: 'expenses-summary', label: 'Summary' }
]

const INCOME_PAGES: Array<{ id: NavPage; label: string }> = [
  { id: 'income-expected', label: 'Expected' },
  { id: 'income-actual', label: 'Actual' },
  { id: 'income-summary', label: 'Summary' }
]

export default function App() {
  const { activeNav, setActiveNav } = useAppContext()
  const [openGroups, setOpenGroups] = useState<Record<NavGroup, boolean>>({
    expenses: activeNav.startsWith('expenses'),
    income: activeNav.startsWith('income')
  })

  function toggleGroup(group: NavGroup, fallback: NavPage): void {
    setOpenGroups((current) => ({ ...current, [group]: !current[group] }))
    if ((group === 'expenses' && !activeNav.startsWith('expenses')) || (group === 'income' && !activeNav.startsWith('income'))) {
      setActiveNav(fallback)
    }
  }

  return (
    <div className="flex h-full bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="fixed inset-y-0 left-0 flex w-[220px] flex-col bg-[#1c1c1e] px-3 py-5">
        <div className="mb-5 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">Scoop Money</div>
        <nav className="flex flex-col gap-0.5">
          <NavButton label="Dashboard" active={activeNav === 'dashboard'} onClick={() => setActiveNav('dashboard')} />
          <NavGroupButton
            label="Expenses"
            open={openGroups.expenses}
            active={activeNav.startsWith('expenses')}
            onClick={() => toggleGroup('expenses', 'expenses-actual')}
          />
          {openGroups.expenses ? (
            <div className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-white/10 pl-2">
              {EXPENSE_PAGES.map((page) => (
                <SubNavButton key={page.id} label={page.label} active={activeNav === page.id} onClick={() => setActiveNav(page.id)} />
              ))}
            </div>
          ) : null}
          <NavGroupButton
            label="Income"
            open={openGroups.income}
            active={activeNav.startsWith('income')}
            onClick={() => toggleGroup('income', 'income-expected')}
          />
          {openGroups.income ? (
            <div className="mb-1 ml-3 flex flex-col gap-0.5 border-l border-white/10 pl-2">
              {INCOME_PAGES.map((page) => (
                <SubNavButton key={page.id} label={page.label} active={activeNav === page.id} onClick={() => setActiveNav(page.id)} />
              ))}
            </div>
          ) : null}
          <NavButton label="Settings" active={activeNav === 'settings'} onClick={() => setActiveNav('settings')} />
        </nav>
      </aside>
      <main className="ml-[220px] h-full flex-1 bg-white dark:bg-zinc-950">
        {activeNav === 'dashboard' ? <Dashboard /> : null}
        {activeNav === 'expenses-budget' ? <Budget /> : null}
        {activeNav === 'expenses-actual' ? <Transactions /> : null}
        {activeNav === 'expenses-summary' ? <Summary /> : null}
        {activeNav === 'income-expected' ? <IncomeExpected /> : null}
        {activeNav === 'income-actual' ? <IncomeActual /> : null}
        {activeNav === 'income-summary' ? <IncomeSummary /> : null}
        {activeNav === 'settings' ? <Settings /> : null}
      </main>
    </div>
  )
}

function NavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-left text-[15px] font-medium transition-[background-color,color] duration-150 ease-out ${
        active ? 'bg-white/14 text-white' : 'text-zinc-400 hover:bg-white/8 hover:text-zinc-100'
      }`}
    >
      {label}
    </button>
  )
}

function NavGroupButton({ label, open, active, onClick }: { label: string; open: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between rounded-full px-3 py-2 text-left text-[15px] font-medium transition-[background-color,color] duration-150 ease-out ${
        active ? 'bg-white/14 text-white' : 'text-zinc-400 hover:bg-white/8 hover:text-zinc-100'
      }`}
    >
      <span>{label}</span>
      <span className="text-zinc-500">{open ? <ChevronIcon direction="up" /> : <ChevronIcon direction="down" />}</span>
    </button>
  )
}

function SubNavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-left text-[13px] font-medium transition-colors ${
        active ? 'bg-white/12 text-white' : 'text-zinc-500 hover:bg-white/8 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  )
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === 'down' ? 'M5 7.5 L10 12.5 L15 7.5' : 'M5 12.5 L10 7.5 L15 12.5'} />
    </svg>
  )
}
