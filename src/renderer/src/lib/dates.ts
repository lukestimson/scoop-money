import {
  addMonths,
  addWeeks,
  addYears,
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear
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
      current.amount -= tx.amount
      groups.set(key, current)
    })
  return Array.from(groups.values()).sort((a, b) => a.start - b.start)
}

export function monthBounds(date = new Date()): { start: number; end: number } {
  return getPeriodBounds('month', date)
}

export type DisplayPeriod = 'week' | 'month' | 'year'

export function getDisplayPeriodBounds(anchor: Date, period: DisplayPeriod): { start: number; end: number } {
  if (period === 'week') {
    const s = startOfWeek(anchor, { weekStartsOn: 1 })
    const e = endOfWeek(anchor, { weekStartsOn: 1 })
    return { start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000) }
  }
  if (period === 'year') {
    const s = startOfYear(anchor)
    const e = endOfYear(anchor)
    return { start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000) }
  }
  const s = startOfMonth(anchor)
  const e = endOfMonth(anchor)
  return { start: Math.floor(s.getTime() / 1000), end: Math.floor(e.getTime() / 1000) }
}

export function stepDisplayAnchor(anchor: Date, period: DisplayPeriod, dir: 1 | -1): Date {
  if (period === 'week') return addWeeks(anchor, dir)
  if (period === 'year') return addYears(anchor, dir)
  return addMonths(anchor, dir)
}

export function formatDisplayAnchor(anchor: Date, period: DisplayPeriod): string {
  if (period === 'week') {
    const s = startOfWeek(anchor, { weekStartsOn: 1 })
    return `${format(s, 'MMM d')} - ${format(endOfWeek(anchor, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
  }
  if (period === 'year') return format(anchor, 'yyyy')
  return format(anchor, 'MMM yyyy')
}
