import { IncomeExpected } from './Income'
import { Budget } from './Budget'

export function LivingExpenses() {
  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-zinc-950">
      <IncomeExpected />
      <div className="my-8 h-px bg-zinc-200 dark:bg-zinc-800" />
      <Budget />
    </div>
  )
}
