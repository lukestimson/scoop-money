import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type NavPage =
  | 'dashboard'
  | 'expenses-budget'
  | 'expenses-actual'
  | 'expenses-summary'
  | 'income-expected'
  | 'income-actual'
  | 'income-summary'
  | 'settings'

interface AppContextValue {
  activeNav: NavPage
  setActiveNav: (nav: NavPage) => void
  dataVersion: number
  bumpDataVersion: () => void
  textScale: number
  setTextScale: (scale: number) => void
  adjustTextScale: (delta: number) => void
}

const AppContext = createContext<AppContextValue | null>(null)
const TEXT_SCALE_KEY = 'scoop_money_text_scale_v1'
const DEFAULT_TEXT_SCALE = 1
const MIN_TEXT_SCALE = 0.9
const MAX_TEXT_SCALE = 1.1
const TEXT_SCALE_STEP = 0.025

function clampTextScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEXT_SCALE
  return Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, value))
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeNav, setActiveNav] = useState<NavPage>('dashboard')
  const [dataVersion, setDataVersion] = useState(0)
  const [textScale, setTextScaleState] = useState<number>(() => {
    const parsed = Number(localStorage.getItem(TEXT_SCALE_KEY))
    return clampTextScale(parsed)
  })
  const bumpDataVersion = useCallback(() => setDataVersion((version) => version + 1), [])
  const setTextScale = useCallback((scale: number) => {
    const next = clampTextScale(scale)
    setTextScaleState(next)
    localStorage.setItem(TEXT_SCALE_KEY, String(next))
  }, [])
  const adjustTextScale = useCallback((delta: number): void => {
    setTextScaleState((current) => {
      const next = clampTextScale(current + delta)
      localStorage.setItem(TEXT_SCALE_KEY, String(next))
      return next
    })
  }, [])

  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * textScale}px`
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [textScale])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.altKey) return
      const key = event.key
      if (key === '=' || key === '+') {
        event.preventDefault()
        adjustTextScale(TEXT_SCALE_STEP)
      } else if (key === '-' || key === '_') {
        event.preventDefault()
        adjustTextScale(-TEXT_SCALE_STEP)
      } else if (key === '0') {
        event.preventDefault()
        setTextScale(DEFAULT_TEXT_SCALE)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [adjustTextScale, setTextScale])

  useEffect(() => {
    const unsubscribe = window.api.onTextScaleCommand((command) => {
      if (command.kind === 'reset') setTextScale(DEFAULT_TEXT_SCALE)
      else adjustTextScale(command.delta)
    })
    return unsubscribe
  }, [adjustTextScale, setTextScale])

  const value = useMemo(
    () => ({ activeNav, setActiveNav, dataVersion, bumpDataVersion, textScale, setTextScale, adjustTextScale }),
    [activeNav, dataVersion, bumpDataVersion, setTextScale, textScale, adjustTextScale]
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useAppContext must be used inside AppProvider')
  return value
}
