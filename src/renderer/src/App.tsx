import { Analytics } from './components/Analytics'
import { Dashboard } from './components/Dashboard'
import { IncomeActual } from './components/Income'
import { LivingExpenses } from './components/LivingExpenses'
import { Settings } from './components/Settings'
import { Transactions } from './components/Transactions'
import { useAppContext } from './context/AppContext'
import waxSeal from './assets/scoop-wax-seal.jpg'

export default function App() {
  const { activeNav, setActiveNav } = useAppContext()

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
        <div className="mt-auto flex w-full px-3 pb-3">
          <img
            src={waxSeal}
            alt="Scoop wax seal"
            className="w-full rounded-xl object-contain opacity-95 shadow-[0_12px_20px_-12px_rgba(15,23,42,0.75)]"
          />
        </div>
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
