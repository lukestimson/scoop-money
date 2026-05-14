import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

function MagnifyingGlassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ClearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export type ListSearchPhase = 1 | 2

type ListSectionSearchBarProps = {
  placeholder: string
  value: string
  onChange: (next: string) => void
  fieldOpen: boolean
  onFieldOpen: () => void
  onFieldClose: () => void
  phase: ListSearchPhase
  onPhaseReset: () => void
  showPressEnterHint: boolean
  enterHintText: string
  onInputKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void
}

export function ListSectionSearchBar({
  placeholder,
  value,
  onChange,
  fieldOpen,
  onFieldOpen,
  onFieldClose,
  phase,
  onPhaseReset,
  showPressEnterHint,
  enterHintText,
  onInputKeyDown
}: ListSectionSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!fieldOpen) return
    function onEsc(e: Event): void {
      const ke = e as globalThis.KeyboardEvent
      if (ke.key !== 'Escape') return
      ke.preventDefault()
      ke.stopPropagation()
      onFieldClose()
    }
    document.addEventListener('keydown', onEsc, true)
    return () => document.removeEventListener('keydown', onEsc, true)
  }, [fieldOpen, onFieldClose])

  useEffect(() => {
    function onDocKey(e: Event): void {
      const ke = e as globalThis.KeyboardEvent
      if (!(ke.metaKey || ke.ctrlKey) || ke.key !== 'f') return
      ke.preventDefault()
      onFieldOpen()
      queueMicrotask(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    document.addEventListener('keydown', onDocKey)
    return () => document.removeEventListener('keydown', onDocKey)
  }, [onFieldOpen])

  function openAndFocus(): void {
    onFieldOpen()
    queueMicrotask(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  function clearField(): void {
    onChange('')
    onPhaseReset()
  }

  function mergedInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onFieldClose()
      return
    }
    onInputKeyDown?.(e)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => (fieldOpen ? onFieldClose() : openAndFocus())}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:shadow-none dark:hover:border-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label={fieldOpen ? 'Close search' : 'Open search'}
          aria-expanded={fieldOpen}
        >
          <MagnifyingGlassIcon />
        </button>
        {fieldOpen ? (
          <div className="relative min-w-0 flex-1 basis-[12rem]">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={mergedInputKeyDown}
              placeholder={placeholder}
              className="w-full rounded-full border border-zinc-200 bg-white py-1.5 pl-3.5 pr-9 text-[13px] leading-snug text-zinc-900 outline-none ring-zinc-200 transition-[box-shadow] placeholder:text-zinc-400 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-200/80 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-700 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700/60"
            />
            {value ? (
              <button
                type="button"
                onClick={() => clearField()}
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Clear search"
              >
                <ClearIcon />
              </button>
            ) : null}
          </div>
        ) : null}
        {phase === 2 ? (
          <button
            type="button"
            onClick={onPhaseReset}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200/90 bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-950 transition-colors hover:bg-amber-200/90 dark:border-amber-700/80 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/60"
          >
            Searching all data
            <span className="text-sm font-normal leading-none" aria-hidden>
              ×
            </span>
          </button>
        ) : null}
      </div>
      {showPressEnterHint ? <p className="text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{enterHintText}</p> : null}
    </div>
  )
}
