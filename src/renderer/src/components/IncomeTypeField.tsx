import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useId
} from 'react'
import { createPortal } from 'react-dom'
import { incomeTypeChipPresentation } from '../lib/incomeTypeColors'
import { IncomeTypeColorEditor, type IncomeTypeColorEditorAnchor } from './IncomeTypeColorEditor'

export const INCOME_TYPE_MENU_SELECTOR = '[data-income-type-menu]'
export const INCOME_TYPE_COLOR_EDITOR_SELECTOR = '[data-income-type-color-editor]'

function incomeBadgeClass(type: string): string {
  if (type === 'Snappr') return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900'
  if (type === 'Thumbtack') return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900'
  if (type === 'Upwork') return 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900'
  return 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900'
}

function TypeChip({ type }: { type: string }) {
  const presentation = incomeTypeChipPresentation(type, `inline-flex h-6 w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset ${incomeBadgeClass(type)}`)
  return (
    <span className={presentation.className} style={presentation.style}>
      <span className="block whitespace-nowrap">{type}</span>
    </span>
  )
}

export function IncomeTypeField({
  value,
  incomeTypes,
  onChange,
  onRegisterType,
  onUnregisterType,
  onRenameType,
  onCommittedPick,
  onKeyDown,
  autoFocus = true,
  inputClassName,
  inputRef: externalInputRef,
  placeholder = 'Type',
  buttonClassName
}: {
  value: string
  incomeTypes: string[]
  onChange: (value: string) => void
  onRegisterType: (type: string) => void
  onUnregisterType?: (type: string) => void
  onRenameType?: (from: string, to: string) => void
  onCommittedPick?: (type: string) => void
  onKeyDown?: (event: ReactKeyboardEvent) => void
  autoFocus?: boolean
  inputClassName?: string
  inputRef?: RefObject<HTMLInputElement | null>
  placeholder?: string
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(true)
  const [creatingType, setCreatingType] = useState(false)
  const [newTypeDraft, setNewTypeDraft] = useState('')
  const [renamingType, setRenamingType] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [colorEditor, setColorEditor] = useState<{ anchor: IncomeTypeColorEditorAnchor; typeName: string } | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const newTypeInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const colorEditorOpenRef = useRef(false)
  const colorWheelGradientId = `income-type-wheel-${useId().replace(/:/g, '')}`

  useEffect(() => {
    colorEditorOpenRef.current = colorEditor !== null
  }, [colorEditor])

  function assignInputRef(element: HTMLInputElement | null): void {
    inputRef.current = element
    if (externalInputRef) externalInputRef.current = element
  }

  const filtered = incomeTypes

  const preferredMenuWidth = useMemo(() => {
    const labels = [...incomeTypes, value, newTypeDraft, renameDraft].filter(Boolean)
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 10)
    return Math.min(640, Math.max(300, Math.ceil(longest * 7.5) + 208))
  }, [incomeTypes, newTypeDraft, renameDraft, value])

  const updateMenuPosition = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const viewportPadding = 8
    const width = Math.min(
      Math.max(rect.width, preferredMenuWidth),
      Math.max(300, window.innerWidth - viewportPadding * 2)
    )
    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding))
    setMenuPosition({
      left,
      top: rect.bottom + 4,
      width
    })
  }, [preferredMenuWidth])

  useEffect(() => {
    if (value) {
      const idx = filtered.findIndex((type) => type === value)
      setHighlightIdx(idx >= 0 ? idx : 0)
    } else {
      setHighlightIdx(0)
    }
  }, [filtered, value])

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
    const onLayout = (): void => updateMenuPosition()
    window.addEventListener('resize', onLayout)
    window.addEventListener('scroll', onLayout, true)
    return () => {
      window.removeEventListener('resize', onLayout)
      window.removeEventListener('scroll', onLayout, true)
    }
  }, [open, updateMenuPosition, filtered.length, creatingType, renamingType])

  useEffect(() => {
    if (!open || !dropdownRef.current) return
    const el = dropdownRef.current.children[highlightIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx, open, filtered.length, creatingType])

  function scheduleCloseMenu(): void {
    window.setTimeout(() => {
      if (colorEditorOpenRef.current) return
      const active = document.activeElement
      if (dropdownRef.current?.contains(active)) return
      if (rootRef.current?.contains(active)) return
      if (active instanceof Element && active.closest(INCOME_TYPE_COLOR_EDITOR_SELECTOR)) return
      setOpen(false)
    }, 150)
  }

  function pickType(type: string): void {
    const trimmed = type.trim()
    if (!trimmed) return
    onRegisterType(trimmed)
    onChange(trimmed)
    onCommittedPick?.(trimmed)
    setCreatingType(false)
    setNewTypeDraft('')
    setRenamingType(null)
    setRenameDraft('')
    setOpen(false)
  }

  function beginCreateType(): void {
    setCreatingType(true)
    setNewTypeDraft('')
    setRenamingType(null)
    setRenameDraft('')
    setOpen(true)
    setHighlightIdx(0)
    queueMicrotask(() => newTypeInputRef.current?.focus())
  }

  function commitNewType(): void {
    const trimmed = newTypeDraft.trim()
    if (!trimmed) return
    pickType(trimmed)
  }

  function beginRenameType(type: string): void {
    setRenamingType(type)
    setRenameDraft(type)
    setCreatingType(false)
    setNewTypeDraft('')
    setOpen(true)
    queueMicrotask(() => renameInputRef.current?.focus())
  }

  function cancelRename(): void {
    setRenamingType(null)
    setRenameDraft('')
  }

  function commitRename(): void {
    const from = renamingType?.trim()
    const to = renameDraft.trim()
    if (!from || !to) {
      cancelRename()
      return
    }
    if (from !== to) onRenameType?.(from, to)
    if (value.trim() === from) onChange(to)
    cancelRename()
  }

  function openColorPicker(event: ReactMouseEvent, typeName: string): void {
    event.preventDefault()
    event.stopPropagation()
    setOpen(true)
    const menuTop = dropdownRef.current?.getBoundingClientRect().top ?? menuPosition?.top
    setColorEditor({ anchor: { clientX: event.clientX, clientY: event.clientY, menuTop }, typeName })
  }

  function removeType(type: string): void {
    const trimmed = type.trim()
    if (!trimmed) return
    const isCurrentValue = value.trim() === trimmed
    onUnregisterType?.(trimmed)
    if (isCurrentValue) {
      onChange('')
      onCommittedPick?.('')
    }
    setColorEditor(null)
    cancelRename()
    setOpen(true)
    queueMicrotask(() => buttonRef.current?.focus())
  }

  function toggleMenu(): void {
    setOpen((current) => {
      if (current) {
        setCreatingType(false)
        setNewTypeDraft('')
        setRenamingType(null)
        setRenameDraft('')
        setColorEditor(null)
        return false
      }
      return true
    })
  }

  function handleKey(event: ReactKeyboardEvent): void {
    if (event.key === 'Escape') {
      setCreatingType(false)
      setNewTypeDraft('')
      setRenamingType(null)
      setRenameDraft('')
      setOpen(false)
      onKeyDown?.(event)
      return
    }
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        setOpen(true)
        return
      }
      onKeyDown?.(event)
      return
    }
    if (creatingType || renamingType) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightIdx((index) => Math.min(index + 1, Math.max(0, filtered.length - 1)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightIdx((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (filtered.length > 0 && highlightIdx < filtered.length && filtered[highlightIdx]) {
        pickType(filtered[highlightIdx])
        return
      }
      onKeyDown?.(event)
      return
    }
    onKeyDown?.(event)
  }

  const selectedType = value.trim()
  const selectedPresentation = selectedType
    ? incomeTypeChipPresentation(
        selectedType,
        `inline-flex h-6 w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset ${incomeBadgeClass(selectedType)}`
      )
    : null

  const menu = open && menuPosition ? (
    <div
      ref={dropdownRef}
      data-income-type-menu
      style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}
      className="fixed z-[220] max-h-[min(280px,42vh)] overflow-x-hidden overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      onMouseDown={(event) => {
        if (event.target instanceof HTMLInputElement) return
        event.preventDefault()
      }}
    >
      {creatingType ? (
        <div className="rounded-md px-2.5 py-1.5">
          <input
            ref={newTypeInputRef}
            value={newTypeDraft}
            onChange={(event) => setNewTypeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitNewType()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setCreatingType(false)
                setNewTypeDraft('')
              }
            }}
            placeholder="Type name"
            className="w-full min-w-0 bg-transparent text-[12px] font-medium text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        </div>
      ) : (
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault()
            beginCreateType()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            if (!creatingType) beginCreateType()
          }}
          className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-left text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950"
        >
          <PlusIcon />
          New type
        </button>
      )}
      {filtered.length === 0 ? (
        <div className="px-2.5 py-2 text-[12px] text-zinc-500 dark:text-zinc-400">No types match.</div>
      ) : (
        filtered.map((type, index) => (
          renamingType === type ? (
            <div key={`rename-${type}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_24px_24px_24px] items-center gap-1 rounded-md px-2 py-1.5">
              <input
                ref={renameInputRef}
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitRename()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelRename()
                  }
                }}
                onDoubleClick={(event) => {
                  event.currentTarget.select()
                }}
                className="h-6 min-w-0 bg-transparent text-[12px] font-medium text-zinc-800 outline-none dark:text-zinc-100"
              />
              <button
                type="button"
                aria-label={`Change color for ${type}`}
                onMouseDown={(event) => openColorPicker(event, type)}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <RainbowDropIcon gradientId={colorWheelGradientId} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${type}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  removeType(type)
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-300"
              >
                <XIcon />
              </button>
              <button
                type="button"
                aria-label={`Confirm rename for ${type}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  commitRename()
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                <CheckIcon />
              </button>
            </div>
          ) : (
            <div
              key={type}
              className={`grid min-w-0 grid-cols-[minmax(0,1fr)_24px] items-center gap-0.5 rounded-md transition-colors ${index === highlightIdx ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-950'}`}
            >
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  pickType(type)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  beginRenameType(type)
                }}
                className="flex min-w-0 items-center rounded-md px-2 py-1.5 text-left"
              >
                <TypeChip type={type} />
              </button>
              <button
                type="button"
                aria-label={`Edit ${type}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  beginRenameType(type)
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <PencilIcon />
              </button>
            </div>
          )
        ))
      )}
    </div>
  ) : null

  return (
    <div ref={rootRef} className="relative min-w-0">
      <input
        ref={assignInputRef}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onFocus={() => {
          setOpen(true)
          buttonRef.current?.focus()
        }}
      />
      <button
        ref={buttonRef}
        type="button"
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onBlur={scheduleCloseMenu}
        onKeyDown={handleKey}
        onClick={toggleMenu}
        className={buttonClassName ?? selectedPresentation?.className ?? inputClassName ?? 'inline-flex h-6 w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset text-zinc-500 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'}
        style={selectedPresentation?.style}
      >
        {selectedType ? (
          <span className="whitespace-nowrap">{selectedType}</span>
        ) : (
          <span className="text-[11px] font-medium normal-case tracking-normal text-zinc-400">{placeholder}</span>
        )}
      </button>
      {menu ? createPortal(menu, document.body) : null}
      {colorEditor ? (
        <IncomeTypeColorEditor
          open
          anchor={colorEditor.anchor}
          typeName={colorEditor.typeName}
          initialStep="picker"
          onBeginRename={colorEditor.typeName ? () => beginRenameType(colorEditor.typeName) : undefined}
          onDelete={colorEditor.typeName && onUnregisterType ? () => removeType(colorEditor.typeName) : undefined}
          onClose={() => setColorEditor(null)}
        />
      ) : null}
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M6 1v10M1 6h10" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.25 1.75 10.25 3.75 4.25 9.75H2.25V7.75L8.25 1.75Z" />
    </svg>
  )
}

function RainbowDropIcon({ gradientId }: { gradientId: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="2" y1="2" x2="12" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="22%" stopColor="#f59e0b" />
          <stop offset="44%" stopColor="#22c55e" />
          <stop offset="66%" stopColor="#06b6d4" />
          <stop offset="82%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <path d="M7 1.4c1.85 2.15 3.6 4.2 3.6 6.25A3.62 3.62 0 0 1 7 11.4a3.62 3.62 0 0 1-3.6-3.75C3.4 5.6 5.15 3.55 7 1.4Z" fill={`url(#${gradientId})`} />
      <path d="M7 1.4c1.85 2.15 3.6 4.2 3.6 6.25A3.62 3.62 0 0 1 7 11.4a3.62 3.62 0 0 1-3.6-3.75C3.4 5.6 5.15 3.55 7 1.4Z" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="0.8" />
      <path d="M5.4 6.2c.3-1.1 1.15-2.2 1.9-3.05" fill="none" stroke="#fff" strokeOpacity="0.62" strokeWidth="0.85" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M3 3l6 6M9 3 3 9" />
    </svg>
  )
}
