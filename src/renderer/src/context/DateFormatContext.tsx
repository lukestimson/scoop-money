import { createContext, useContext, useMemo, useState } from 'react'

interface DateFormatContextValue {
  dateFormat: string
  setDateFormat: (format: string) => void
}

const DateFormatContext = createContext<DateFormatContextValue | null>(null)

export function DateFormatProvider({ children }: { children: React.ReactNode }) {
  const [dateFormat, setDateFormat] = useState('MMM d, yyyy')
  const value = useMemo(() => ({ dateFormat, setDateFormat }), [dateFormat])
  return <DateFormatContext.Provider value={value}>{children}</DateFormatContext.Provider>
}

export function useDateFormat(): DateFormatContextValue {
  const value = useContext(DateFormatContext)
  if (!value) throw new Error('useDateFormat must be used inside DateFormatProvider')
  return value
}
