import { useState, useRef, useEffect, useMemo, ReactNode } from 'react'
import { DisplayPeriod, getDisplayPeriodBounds, stepDisplayAnchor, formatDisplayAnchor } from '../lib/dates'
import { IncomeEntry } from '../../../types/money'

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
      {children}
    </button>
  )
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'up' ? <path d="m5 12 5-5 5 5" /> : <path d="m5 8 5 5 5-5" />}
    </svg>
  )
}

function formatCurrencyNoCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(cents / 100)
}

function IncomeSourcesWidget({ entries }: { entries: IncomeEntry[] }) {
  const sourceTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const entry of entries) {
      const t = entry.type || entry.income_kind || 'Unknown'
      totals.set(t, (totals.get(t) || 0) + entry.amount)
    }
    return Array.from(totals.entries()).sort((a, b) => a[1] - b[1]) // Ascending to match typical "growth" visuals, or just sort stable
  }, [entries])

  const maxTotal = Math.max(...sourceTotals.map(([, total]) => total), 1)

  const colors = [
    'bg-white',
    'bg-[#f43f5e]', // rose-500 equivalent
    'bg-white',
    'bg-[#34d399]' // emerald-400 equivalent
  ]

  return (
    <div className="flex h-full w-full flex-col rounded-[20px] bg-[#1c1c1e] p-6 shadow-sm">
      <h2 className="mb-6 text-lg font-semibold tracking-tight text-white">Income Source</h2>
      <div className="flex h-full min-h-[140px] flex-1 items-end justify-between gap-4 overflow-x-auto pb-2">
        {sourceTotals.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">No income this period</div>
        ) : (
          sourceTotals.map(([source, total], idx) => {
            const heightPercent = Math.max((total / maxTotal) * 100, 8)
            return (
              <div key={source} className="flex flex-col items-center justify-end gap-2 shrink-0 flex-1">
                <div className="text-sm font-bold text-white">{formatCurrencyNoCents(total)}</div>
                <div 
                  className={`w-full max-w-[40px] rounded-sm ${colors[idx % colors.length]}`} 
                  style={{ height: `${heightPercent}%`, minHeight: '6px' }} 
                />
                <div className="mt-1 text-[11px] font-medium text-white text-center leading-tight">{source}</div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

const WIDGET_TYPES = [
  { id: 'net-worth', label: 'Net Worth', color: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' },
  { id: 'spending-pie', label: 'Spending Breakdown', color: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400' },
  { id: 'recent-tx', label: 'Recent Transactions', color: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400' },
  { id: 'budget-progress', label: 'Budget Progress', color: 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400' },
  { id: 'income-sources', label: 'Income Sources', color: 'bg-transparent border-none p-0' }, // Override for custom widget
  { id: 'savings-rate', label: 'Savings Rate', color: 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-400' }
]

const LAYOUT_KEY = 'scoop_dashboard_layout'
const DASHBOARD_PERIOD_KEY = 'scoop_dashboard_period'

function getInitialLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length === WIDGET_TYPES.length) {
        return parsed
      }
    }
  } catch { /* ignore */ }
  return WIDGET_TYPES.map(w => w.id)
}

export function Dashboard() {
  const [layout, setLayout] = useState<string[]>(getInitialLayout)
  const dragItemRef = useRef<number | null>(null)
  const dragOverItemRef = useRef<number | null>(null)
  
  const [period, setPeriod] = useState<DisplayPeriod>(() => {
    const p = localStorage.getItem(DASHBOARD_PERIOD_KEY)
    return (p === 'week' || p === 'month' || p === 'year') ? p : 'month'
  })
  const [anchor, setAnchor] = useState(() => new Date())
  const [entries, setEntries] = useState<IncomeEntry[]>([])

  useEffect(() => {
    window.api.getIncomeEntries().then(setEntries)
  }, [])

  useEffect(() => {
    localStorage.setItem(DASHBOARD_PERIOD_KEY, period)
  }, [period])

  const { start, end } = getDisplayPeriodBounds(anchor, period)
  const periodEntries = useMemo(() => entries.filter(e => e.date >= start && e.date <= end), [entries, start, end])

  const handleSort = () => {
    if (dragItemRef.current === null || dragOverItemRef.current === null) return
    const _layout = [...layout]
    const draggedItem = _layout[dragItemRef.current]
    _layout.splice(dragItemRef.current, 1)
    _layout.splice(dragOverItemRef.current, 0, draggedItem)
    setLayout(_layout)
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(_layout))
    dragItemRef.current = null
    dragOverItemRef.current = null
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-8 bg-white dark:bg-zinc-950">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Modular financial overview. Drag to reorder widgets.</p>
        </div>
        
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-full border border-zinc-200 bg-white text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <button type="button" onClick={() => setAnchor((value) => stepDisplayAnchor(value, period, -1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Previous">
                <span className="inline-block -rotate-90"><ChevronIcon direction="up" /></span>
              </button>
              <div className="min-w-[120px] text-center text-[12px] font-medium text-zinc-700 dark:text-zinc-200">{formatDisplayAnchor(anchor, period)}</div>
              <button type="button" onClick={() => setAnchor((value) => stepDisplayAnchor(value, period, 1))} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Next">
                <span className="inline-block rotate-90"><ChevronIcon direction="up" /></span>
              </button>
            </div>
            <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Dashboard period">
              <SegmentedButton active={period === 'week'} onClick={() => setPeriod('week')}>Week</SegmentedButton>
              <SegmentedButton active={period === 'month'} onClick={() => setPeriod('month')}>Month</SegmentedButton>
              <SegmentedButton active={period === 'year'} onClick={() => setPeriod('year')}>Year</SegmentedButton>
            </div>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {layout.map((id, index) => {
          const widget = WIDGET_TYPES.find(w => w.id === id)
          if (!widget) return null
          
          return (
            <div
              key={id}
              draggable
              onDragStart={() => (dragItemRef.current = index)}
              onDragEnter={() => (dragOverItemRef.current = index)}
              onDragEnd={handleSort}
              onDragOver={(e) => e.preventDefault()}
              className={`min-h-[220px] cursor-grab active:cursor-grabbing rounded-[20px] transition-transform hover:scale-[1.01] ${id === 'income-sources' ? '' : `border border-zinc-200 dark:border-zinc-800 p-4 shadow-sm ${widget.color}`}`}
            >
              {id === 'income-sources' ? (
                <IncomeSourcesWidget entries={periodEntries} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <span className="text-sm font-semibold uppercase tracking-wider">{widget.label}</span>
                  <span className="text-xs opacity-80">(Placeholder)</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
