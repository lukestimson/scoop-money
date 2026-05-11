import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type ThemeMode = 'light' | 'dark' | 'auto'

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const KEY = 'scoop_money_theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(KEY)
    return saved === 'dark' || saved === 'light' || saved === 'auto' ? saved : 'auto'
  })
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'auto' ? systemPrefersDark : theme === 'dark')
  }, [systemPrefersDark, theme])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent): void => setSystemPrefersDark(event.matches)
    setSystemPrefersDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback((next: ThemeMode): void => {
    setThemeState(next)
    localStorage.setItem(KEY, next)
  }, [])

  const toggleTheme = useCallback((): void => {
    setThemeState((current) => {
      const next: ThemeMode = current === 'dark' ? 'light' : 'dark'
      localStorage.setItem(KEY, next)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [setTheme, theme, toggleTheme]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
