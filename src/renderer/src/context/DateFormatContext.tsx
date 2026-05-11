import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type DateFormatMode = 'absolute' | 'relative'

interface DateFormatContextValue {
  dateFormat: DateFormatMode
  setDateFormat: (format: DateFormatMode) => void
  formatDate: (unixTimestamp: number) => string
}

const DateFormatContext = createContext<DateFormatContextValue | null>(null)
const KEY = 'scoop_money_date_format'

function formatAbsolute(unix: number): string {
  const date = new Date(unix * 1000)
  if (Number.isNaN(date.getTime())) return '-'
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${mm}/${dd}/${yy}`
}

function formatRelative(unix: number): string {
  const value = unix * 1000
  if (Number.isNaN(value)) return '-'
  const diffSec = Math.floor((Date.now() - value) / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(value)
  target.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - target.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export function DateFormatProvider({ children }: { children: React.ReactNode }) {
  const [dateFormat, setDateFormatState] = useState<DateFormatMode>(() => localStorage.getItem(KEY) === 'relative' ? 'relative' : 'absolute')
  const setDateFormat = useCallback((format: DateFormatMode) => {
    setDateFormatState(format)
    localStorage.setItem(KEY, format)
  }, [])
  const formatDate = useCallback((unixTimestamp: number) => {
    return dateFormat === 'relative' ? formatRelative(unixTimestamp) : formatAbsolute(unixTimestamp)
  }, [dateFormat])
  const value = useMemo(() => ({ dateFormat, setDateFormat, formatDate }), [dateFormat, formatDate, setDateFormat])
  return <DateFormatContext.Provider value={value}>{children}</DateFormatContext.Provider>
}

export function useDateFormat(): DateFormatContextValue {
  const value = useContext(DateFormatContext)
  if (!value) throw new Error('useDateFormat must be used inside DateFormatProvider')
  return value
}
