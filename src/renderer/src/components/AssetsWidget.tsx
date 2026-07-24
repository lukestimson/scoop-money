import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { addDays, addMonths, addWeeks, format, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import type { IncomeEntry, Transaction } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { formatCurrency } from '../lib/currency'
import type { DisplayPeriod } from '../lib/dates'
import { netSpendCents } from '../lib/spending'

type AssetsUnit = 'daily' | 'weekly' | 'monthly'

type Point = {
  key: string
  label: string
  income: number
  expense: number
}

type Bucket = {
  key: string
  label: string
  start: number
  end: number
}

const UNIT_OPTIONS: Array<{ id: AssetsUnit; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' }
]

const UNIT_KEY = 'scoop_assets_widget_unit'

function getStoredUnit(): AssetsUnit {
  const raw = localStorage.getItem(UNIT_KEY)
  if (raw === 'daily' || raw === 'weekly' || raw === 'monthly') return raw
  return 'daily'
}

function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function fromUnix(unix: number): Date {
  return new Date(unix * 1000)
}

function bucketEndFor(start: Date, unit: AssetsUnit): Date {
  if (unit === 'daily') return addDays(start, 1)
  if (unit === 'weekly') return addWeeks(start, 1)
  return addMonths(start, 1)
}

function normalizeStart(date: Date, unit: AssetsUnit): Date {
  if (unit === 'daily') return startOfDay(date)
  if (unit === 'weekly') return startOfWeek(date, { weekStartsOn: 1 })
  return startOfMonth(date)
}

function buildBuckets(globalStart: number, globalEnd: number, unit: AssetsUnit): Bucket[] {
  const buckets: Bucket[] = []
  const startDate = normalizeStart(fromUnix(globalStart), unit)
  const endDate = fromUnix(globalEnd)

  let cursor = startDate
  while (toUnix(cursor) <= globalEnd) {
    const next = bucketEndFor(cursor, unit)
    const bucketStart = Math.max(globalStart, toUnix(cursor))
    const bucketEnd = Math.min(globalEnd, toUnix(new Date(next.getTime() - 1000)))

    if (bucketEnd >= bucketStart) {
      const label =
        unit === 'daily'
          ? format(cursor, 'EEE')
          : unit === 'weekly'
            ? format(cursor, 'MMM d')
            : format(cursor, 'MMM')

      buckets.push({
        key: `${unit}-${format(cursor, 'yyyy-MM-dd')}`,
        label,
        start: bucketStart,
        end: bucketEnd
      })
    }

    cursor = next
    if (cursor > endDate && toUnix(cursor) > globalEnd) break
  }

  return buckets
}

function buildSeries(
  globalStart: number,
  globalEnd: number,
  unit: AssetsUnit,
  transactions: Transaction[],
  incomeEntries: IncomeEntry[]
): Point[] {
  const buckets = buildBuckets(globalStart, globalEnd, unit)
  return buckets.map((bucket) => {
    const income = incomeEntries
      .filter((entry) => entry.date >= bucket.start && entry.date <= bucket.end)
      .reduce((sum, entry) => sum + entry.amount, 0)

    const expense = netSpendCents(
      transactions.filter((tx) => tx.date >= bucket.start && tx.date <= bucket.end)
    )

    return {
      key: bucket.key,
      label: bucket.label,
      income,
      expense
    }
  })
}

function axisDomain(points: Point[]): [number, number] {
  const maxValue = points.reduce((max, p) => Math.max(max, p.income, p.expense), 0)
  const padded = Math.max(10000, Math.ceil((maxValue * 1.2) / 10000) * 10000)
  return [0, padded]
}

function isUnitDisabled(globalPeriod: DisplayPeriod, unit: AssetsUnit): boolean {
  if (globalPeriod === 'week') return unit === 'weekly' || unit === 'monthly'
  if (globalPeriod === 'month') return unit === 'monthly'
  return false
}

function fallbackUnitFor(globalPeriod: DisplayPeriod): AssetsUnit {
  if (globalPeriod === 'week') return 'daily'
  if (globalPeriod === 'month') return 'weekly'
  return 'monthly'
}

function AssetsTooltip(props: { active?: boolean; payload?: Array<{ payload?: Point }> }): React.JSX.Element | null {
  const { active, payload } = props
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload as Point | undefined
  if (!row) return null

  return (
    <div className="rounded-xl border border-zinc-200/60 bg-white/70 px-3 py-2 shadow-[0_10px_22px_-14px_rgba(0,0,0,0.35)] backdrop-blur-sm dark:border-zinc-700/60 dark:bg-zinc-900/65">
      <div className="flex min-w-[9rem] items-center justify-between gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Income
        </span>
        <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatCurrency(row.income)}</span>
      </div>
      <div className="mt-1 flex min-w-[9rem] items-center justify-between gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          Expense
        </span>
        <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatCurrency(row.expense)}</span>
      </div>
    </div>
  )
}

function renderAssetsTooltip(props: unknown): React.JSX.Element {
  return <AssetsTooltip {...(props as { active?: boolean; payload?: Array<{ payload?: Point }> })} />
}

function LegendDot({ color, label }: { color: string; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function ChevronDownIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 8 5 5 5-5" />
    </svg>
  )
}

export function AssetsWidget({
  globalPeriod,
  globalStart,
  globalEnd
}: {
  globalPeriod: DisplayPeriod
  globalStart: number
  globalEnd: number
}): React.JSX.Element {
  const { dataVersion } = useAppContext()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [incomeEntries, setIncomeEntries] = useState<IncomeEntry[]>([])
  const [unit, setUnit] = useState<AssetsUnit>(() => getStoredUnit())
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    Promise.all([window.api.getTransactions(), window.api.getIncomeEntries()]).then(([nextTx, nextIncome]) => {
      setTransactions(nextTx)
      setIncomeEntries(nextIncome)
    })
  }, [dataVersion])

  useEffect(() => {
    localStorage.setItem(UNIT_KEY, unit)
  }, [unit])

  useEffect(() => {
    if (!isUnitDisabled(globalPeriod, unit)) return
    const next = fallbackUnitFor(globalPeriod)
    setUnit(next)
  }, [globalPeriod, unit])

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onEsc = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen])

  const points = useMemo(
    () => buildSeries(globalStart, globalEnd, unit, transactions, incomeEntries),
    [globalStart, globalEnd, unit, transactions, incomeEntries]
  )
  const domain = useMemo(() => axisDomain(points), [points])

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-200">Income Vs Expenses</h2>

        <div className="flex items-center gap-3" ref={menuRef}>
          <LegendDot color="#10b981" label="Income" />
          <LegendDot color="#d4a106" label="Expense" />

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {UNIT_OPTIONS.find((opt) => opt.id === unit)?.label ?? 'Daily'}
              <ChevronDownIcon />
            </button>

            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-1 w-28 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900" role="menu">
                {UNIT_OPTIONS.map((opt) => {
                  const disabled = isUnitDisabled(globalPeriod, opt.id)
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (disabled) return
                        setUnit(opt.id)
                        setMenuOpen(false)
                      }}
                      disabled={disabled}
                      className={`flex w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                        disabled
                          ? 'cursor-not-allowed text-zinc-400 opacity-60 dark:text-zinc-500'
                          : opt.id === unit
                            ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                            : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 4, left: -4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e4e4e7" strokeOpacity={0.8} />
            <XAxis dataKey="label" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} dy={6} />
            <YAxis
              domain={domain}
              tickFormatter={(value) => `$${Math.round(Number(value) / 100)}`}
              tick={{ fill: '#a1a1aa', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={42}
            />

            <Tooltip
              content={renderAssetsTooltip}
              cursor={{ stroke: '#a78bfa', strokeDasharray: '4 4', strokeWidth: 1.5, strokeOpacity: 0.7 }}
            />

            <Line
              type="monotone"
              dataKey="income"
              stroke="#10b981"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 7, strokeWidth: 3, stroke: '#10b981', fill: '#ffffff' }}
            />

            <Line
              type="monotone"
              dataKey="expense"
              stroke="#d4a106"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 7, strokeWidth: 3, stroke: '#d4a106', fill: '#ffffff' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
