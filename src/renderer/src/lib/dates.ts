import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import type { PeriodGroup, Transaction } from '../../../types/money'

export type PeriodUnit = 'day' | 'week' | 'month'

export function formatDate(unix: number, dateFormat = 'MMM d, yyyy'): string {
  return format(new Date(unix * 1000), dateFormat)
}

export function getPeriodBounds(unit: PeriodUnit, date: Date): { start: number; end: number } {
  const start =
    unit === 'day'
      ? startOfDay(date)
      : unit === 'week'
        ? startOfWeek(date, { weekStartsOn: 1 })
        : startOfMonth(date)
  const end =
    unit === 'day'
      ? endOfDay(date)
      : unit === 'week'
        ? endOfWeek(date, { weekStartsOn: 1 })
        : endOfMonth(date)
  return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) }
}

export function groupTransactionsByPeriod(transactions: Transaction[], unit: PeriodUnit): PeriodGroup[] {
  const groups = new Map<string, PeriodGroup>()
  transactions
    .filter((tx) => tx.amount !== 0)
    .forEach((tx) => {
      const date = new Date(tx.date * 1000)
      const bounds = getPeriodBounds(unit, date)
      const key = String(bounds.start)
      const label = unit === 'day' ? format(date, 'MMM d') : unit === 'week' ? format(date, 'MMM d') : format(date, 'MMM yyyy')
      const current = groups.get(key) ?? { key, label, start: bounds.start, end: bounds.end, amount: 0 }
      current.amount += tx.amount
      groups.set(key, current)
    })
  return Array.from(groups.values()).sort((a, b) => a.start - b.start)
}

export function monthBounds(date = new Date()): { start: number; end: number } {
  return getPeriodBounds('month', date)
}
