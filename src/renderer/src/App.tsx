import { Budget } from './components/Budget'
import { Dashboard } from './components/Dashboard'
import { Income } from './components/Income'
import { Settings } from './components/Settings'
import { Summary } from './components/Summary'
import { Transactions } from './components/Transactions'
import { type NavPage, useAppContext } from './context/AppContext'

const NAV_ITEMS: NavPage[] = ['Dashboard', 'Transactions', 'Budget', 'Summary', 'Income', 'Settings']

export default function App() {
  const { activeNav, setActiveNav } = useAppContext()
  return (
    <div className="flex h-full bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="fixed inset-y-0 left-0 flex w-[220px] flex-col bg-[#1c1c1e] px-3 py-5">
        <div className="mb-5 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">Scoop Money</div>
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setActiveNav(item)}
              className={`rounded-full px-3 py-2 text-left text-[15px] font-medium transition-[background-color,color] duration-150 ease-out ${
                activeNav === item ? 'bg-white/14 text-white' : 'text-zinc-400 hover:bg-white/8 hover:text-zinc-100'
              }`}
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>
      <main className="ml-[220px] h-full flex-1 bg-white dark:bg-zinc-950">
        {activeNav === 'Dashboard' ? <Dashboard /> : null}
        {activeNav === 'Transactions' ? <Transactions /> : null}
        {activeNav === 'Budget' ? <Budget /> : null}
        {activeNav === 'Summary' ? <Summary /> : null}
        {activeNav === 'Income' ? <Income /> : null}
        {activeNav === 'Settings' ? <Settings /> : null}
      </main>
    </div>
  )
}
