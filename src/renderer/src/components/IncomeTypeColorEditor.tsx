import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { readIncomeTypeColorHex, setIncomeTypeColorHex } from '../lib/incomeTypeColors'

function hslToHex(h: number, sPct: number, lPct: number): string {
  const s = sPct / 100
  const l = lPct / 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * c)
  }
  const hx = (x: number): string => x.toString(16).padStart(2, '0')
  return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`
}

function angleToHue(rad: number): number {
  let deg = (rad * 180) / Math.PI
  deg = (deg + 90 + 360) % 360
  return deg
}

export interface IncomeTypeColorEditorAnchor {
  clientX: number
  clientY: number
  menuTop?: number
}

export function IncomeTypeColorEditor({
  open,
  anchor,
  typeName,
  initialStep = 'menu',
  onBeginRename,
  onDelete,
  onClose
}: {
  open: boolean
  anchor: IncomeTypeColorEditorAnchor | null
  typeName: string
  initialStep?: 'menu' | 'picker'
  onBeginRename?: () => void
  onDelete?: () => void | Promise<void>
  onClose: () => void
}): ReactElement | null {
  const [step, setStep] = useState<'menu' | 'picker'>('menu')
  const [draftHex, setDraftHex] = useState('#8b5cf6')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const ringRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [panelPosition, setPanelPosition] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setStep(initialStep)
    setConfirmingDelete(false)
    setDraftHex(readIncomeTypeColorHex(typeName) ?? '#8b5cf6')
  }, [initialStep, open, typeName])

  const save = useCallback((): void => {
    if (!typeName.trim()) {
      onClose()
      return
    }
    setIncomeTypeColorHex(typeName, draftHex)
    onClose()
  }, [draftHex, onClose, typeName])

  const confirmDelete = useCallback((): void => {
    void (async (): Promise<void> => {
      await onDelete?.()
      onClose()
    })()
  }, [onDelete, onClose])

  useEffect(() => {
    if (!open || step !== 'picker') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, step, onClose, save])

  const onRingClick = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    const el = ringRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = event.clientX - cx
    const dy = event.clientY - cy
    const rad = Math.atan2(dy, dx)
    const h = angleToHue(rad)
    setDraftHex(hslToHex(h, 72, 48))
  }, [])

  useLayoutEffect(() => {
    if (!open || step !== 'picker') return
    const onDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-income-type-menu]')) return
      onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [open, step, onClose])

  useLayoutEffect(() => {
    if (!open || anchor == null) {
      setPanelPosition(null)
      return
    }
    const panel = panelRef.current
    const estimatedHeight = step === 'picker' ? 176 : 120
    const estimatedWidth = step === 'picker' ? 168 : 140
    const width = panel?.offsetWidth || estimatedWidth
    const height = panel?.offsetHeight || estimatedHeight
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, anchor.clientX - 8))
    const top = anchor.menuTop != null
      ? Math.max(8, anchor.menuTop - height - 8)
      : Math.min(window.innerHeight - height - 8, Math.max(8, anchor.clientY - 8))
    setPanelPosition({ left, top })
  }, [anchor, confirmingDelete, draftHex, open, step])

  if (!open || anchor == null) return null

  const estimatedHeight = step === 'picker' ? 176 : 120
  const estimatedWidth = step === 'picker' ? 168 : 140
  const fallbackLeft = Math.min(window.innerWidth - estimatedWidth - 8, Math.max(8, anchor.clientX - 8))
  const fallbackTop = anchor.menuTop != null
    ? Math.max(8, anchor.menuTop - estimatedHeight - 8)
    : Math.min(window.innerHeight - estimatedHeight - 8, Math.max(8, anchor.clientY - 8))
  const left = panelPosition?.left ?? fallbackLeft
  const top = panelPosition?.top ?? fallbackTop
  const stops = Array.from({ length: 24 }, (_, index) => hslToHex((index / 24) * 360, 82, 56))

  return createPortal(
    <div
      ref={panelRef}
      data-income-type-color-editor
      className="fixed z-[240] rounded-lg border border-zinc-200/90 bg-white p-2 text-zinc-900 shadow-xl dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
      style={{ left, top, minWidth: step === 'menu' ? 140 : 168 }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {step === 'menu' ? (
        <div className="flex flex-col gap-0.5">
          {confirmingDelete ? (
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                onClick={confirmDelete}
              >
                delete
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                onClick={() => setConfirmingDelete(false)}
              >
                cancel
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="rounded-md px-2 py-1.5 text-left text-[12px] font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setStep('picker')}
              >
                Change color
              </button>
              {onBeginRename ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1.5 text-left text-[12px] font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => {
                    onBeginRename()
                    onClose()
                  }}
                >
                  Rename
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                  onClick={() => setConfirmingDelete(true)}
                >
                  delete
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-md px-2 py-1.5 text-left text-[11px] text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/80"
                onClick={onClose}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div
            ref={ringRef}
            role="presentation"
            className="relative h-[108px] w-[108px] shrink-0 cursor-crosshair rounded-full shadow-inner ring-1 ring-zinc-200/80 dark:ring-zinc-600"
            style={{ background: `conic-gradient(from 0deg, ${stops.join(', ')})` }}
            onClick={onRingClick}
          >
            <div
              className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md dark:border-zinc-800"
              style={{ backgroundColor: draftHex }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Save color"
              title="Save (Enter)"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={save}
            >
              <CheckIcon />
            </button>
            <button
              type="button"
              aria-label="Cancel"
              title="Cancel (Esc)"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
              onClick={onClose}
            >
              <span className="text-base leading-none" aria-hidden>
                ×
              </span>
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
