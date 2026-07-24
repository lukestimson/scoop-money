import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DisplayPeriod } from '../lib/dates'

export type NavPage =
  | 'dashboard'
  | 'living-expenses'
  | 'income'
  | 'transactions'
  | 'analytics'
  | 'settings'

interface AppContextValue {
  activeNav: NavPage
  setActiveNav: (nav: NavPage) => void
  dataVersion: number
  bumpDataVersion: () => void
  textScale: number
  setTextScale: (scale: number) => void
  adjustTextScale: (delta: number) => void
  anchor: Date
  setAnchor: (dateOrFn: Date | ((prev: Date) => Date)) => void
  period: DisplayPeriod
  setPeriod: (period: DisplayPeriod) => void
  defaultAnchorDate: Date
  isDefaultDateLoaded: boolean
}

const AppContext = createContext<AppContextValue | null>(null)
const TEXT_SCALE_KEY = 'scoop_money_text_scale_v1'
const DEFAULT_TEXT_SCALE = 1
const MIN_TEXT_SCALE = 0.9
const MAX_TEXT_SCALE = 1.1
const TEXT_SCALE_STEP = 0.025

const SESSION_ANCHOR_KEY = 'scoop_session_anchor'
const SESSION_PERIOD_KEY = 'scoop_session_period'

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

  // Global anchor and period state
  const [defaultAnchorDate, setDefaultAnchorDate] = useState<Date>(() => new Date())
  const [isDefaultDateLoaded, setIsDefaultDateLoaded] = useState(false)
  const [anchor, setAnchorState] = useState<Date>(() => {
    const stored = sessionStorage.getItem(SESSION_ANCHOR_KEY)
    if (stored) {
      const parsed = new Date(stored)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
    return new Date() // Fallback until loaded
  })
  const [period, setPeriodState] = useState<DisplayPeriod>(() => {
    const stored = sessionStorage.getItem(SESSION_PERIOD_KEY)
    if (stored === 'week' || stored === 'month' || stored === 'year') return stored
    return 'month'
  })

  // Load default anchor date from database on mount or when dataVersion changes
  useEffect(() => {
    window.api
      .getImportedFiles()
      .then((files) => {
        if (files && files.length > 0) {
          const latest = files[0]
          if (latest.last_transaction_date) {
            const loadedDate = new Date(latest.last_transaction_date * 1000)
            setDefaultAnchorDate(loadedDate)
            // If the user hasn't explicitly set a session anchor yet, or if this is a new import, set the active anchor
            if (!sessionStorage.getItem(SESSION_ANCHOR_KEY)) {
              setAnchorState(loadedDate)
            }
          }
        }
        setIsDefaultDateLoaded(true)
      })
      .catch((err) => {
        console.error('Failed to load imported files for default date:', err)
        setIsDefaultDateLoaded(true)
      })
  }, [dataVersion])

  const setAnchor = useCallback((dateOrFn: Date | ((prev: Date) => Date)) => {
    setAnchorState((prev) => {
      const next = typeof dateOrFn === 'function' ? dateOrFn(prev) : dateOrFn
      sessionStorage.setItem(SESSION_ANCHOR_KEY, next.toISOString())
      return next
    })
  }, [])

  const setPeriod = useCallback((p: DisplayPeriod) => {
    setPeriodState(p)
    sessionStorage.setItem(SESSION_PERIOD_KEY, p)
  }, [])

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
    const unsubscribe = window.api.onMoneyDataMutated(() => bumpDataVersion())
    return unsubscribe
  }, [bumpDataVersion])

  useEffect(() => {
    const unsubscribe = window.api.onTextScaleCommand((command) => {
      if (command.kind === 'reset') setTextScale(DEFAULT_TEXT_SCALE)
      else adjustTextScale(command.delta)
    })
    return unsubscribe
  }, [adjustTextScale, setTextScale])

  const value = useMemo(
    () => ({
      activeNav,
      setActiveNav,
      dataVersion,
      bumpDataVersion,
      textScale,
      setTextScale,
      adjustTextScale,
      anchor,
      setAnchor,
      period,
      setPeriod,
      defaultAnchorDate,
      isDefaultDateLoaded
    }),
    [
      activeNav,
      dataVersion,
      bumpDataVersion,
      setTextScale,
      textScale,
      adjustTextScale,
      anchor,
      setAnchor,
      period,
      setPeriod,
      defaultAnchorDate,
      isDefaultDateLoaded
    ]
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useAppContext must be used inside AppProvider')
  return value
}
