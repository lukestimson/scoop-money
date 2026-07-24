import type { BudgetAidFilter } from '../lib/budget'

export function ParentalAidIcon(): React.JSX.Element {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-orange-500 dark:text-orange-400">
      <circle cx="4" cy="2.2" r="1.4" />
      <path d="M1.5 9c0-1.8 1.2-2.8 2.5-2.8s2.5 1 2.5 2.8" />
      <circle cx="10" cy="2.2" r="1.4" />
      <path d="M7.5 9c0-1.8 1.2-2.8 2.5-2.8s2.5 1 2.5 2.8" />
    </svg>
  )
}

export function GovAidIcon(): React.JSX.Element {
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-amber-700 dark:text-amber-500">
      <path d="M6 0.8 L1.5 3.5 H10.5 Z" />
      <line x1="1.5" y1="9" x2="10.5" y2="9" />
      <line x1="3" y1="3.5" x2="3" y2="9" />
      <line x1="5" y1="3.5" x2="5" y2="9" />
      <line x1="7" y1="3.5" x2="7" y2="9" />
      <line x1="9" y1="3.5" x2="9" y2="9" />
    </svg>
  )
}

export function BudgetAidIndicators({
  filters,
  className = ''
}: {
  filters: Set<BudgetAidFilter> | Set<string>
  className?: string
}): React.JSX.Element | null {
  if (!filters.has('parental') && !filters.has('government')) return null

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label="Aid-adjusted budget">
      {filters.has('parental') ? <ParentalAidIcon /> : null}
      {filters.has('government') ? <GovAidIcon /> : null}
    </span>
  )
}
