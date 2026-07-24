import { Analytics } from './components/Analytics'
import { Dashboard } from './components/Dashboard'
import { IncomeActual } from './components/Income'
import { LivingExpenses } from './components/LivingExpenses'
import { Settings } from './components/Settings'
import { Transactions } from './components/Transactions'
import { useAppContext } from './context/AppContext'

export default function App() {
  const { activeNav, setActiveNav, isDefaultDateLoaded } = useAppContext()

  if (!isDefaultDateLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-2">
          <svg className="h-6 w-6 animate-spin text-zinc-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <div className="text-zinc-500 dark:text-zinc-400 text-xs font-medium tracking-wide">
            Loading Finances…
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="fixed inset-y-0 left-0 flex w-[220px] flex-col bg-[#1c1c1e] px-3 py-5">
        <div className="mb-5 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">Scoop Money</div>
        <nav className="flex flex-col gap-0.5">
          <NavButton label="Dashboard" active={activeNav === 'dashboard'} onClick={() => setActiveNav('dashboard')} />
          <NavButton label="Living Expenses" active={activeNav === 'living-expenses'} onClick={() => setActiveNav('living-expenses')} />
          <NavButton label="Income" active={activeNav === 'income'} onClick={() => setActiveNav('income')} />
          <NavButton label="Transactions" active={activeNav === 'transactions'} onClick={() => setActiveNav('transactions')} />
          <NavButton label="Analytics" active={activeNav === 'analytics'} onClick={() => setActiveNav('analytics')} />
          <NavButton label="Settings" active={activeNav === 'settings'} onClick={() => setActiveNav('settings')} />
        </nav>
      </aside>
      <main className="ml-[220px] h-full flex-1 bg-white dark:bg-zinc-950">
        {activeNav === 'dashboard' ? <Dashboard /> : null}
        {activeNav === 'living-expenses' ? <LivingExpenses /> : null}
        {activeNav === 'income' ? <IncomeActual /> : null}
        {activeNav === 'transactions' ? <Transactions /> : null}
        {activeNav === 'analytics' ? <Analytics /> : null}
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
