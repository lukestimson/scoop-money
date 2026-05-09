import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type NavPage = 'Dashboard' | 'Transactions' | 'Budget' | 'Summary' | 'Income' | 'Settings'

interface AppContextValue {
  activeNav: NavPage
  setActiveNav: (nav: NavPage) => void
  dataVersion: number
  bumpDataVersion: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeNav, setActiveNav] = useState<NavPage>('Dashboard')
  const [dataVersion, setDataVersion] = useState(0)
  const bumpDataVersion = useCallback(() => setDataVersion((version) => version + 1), [])
  const value = useMemo(
    () => ({ activeNav, setActiveNav, dataVersion, bumpDataVersion }),
    [activeNav, dataVersion, bumpDataVersion]
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useAppContext must be used inside AppProvider')
  return value
}
