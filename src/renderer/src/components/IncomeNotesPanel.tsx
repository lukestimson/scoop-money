import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import {
  hasVisibleIncomeNotes,
  normalizePastedIncomeNoteLines,
  parseIncomeNotesLines,
  serializeIncomeNotesLines
} from '../lib/incomeNotes'

export type IncomeNotesPanelHandle = {
  save: () => string
}

const PANEL_CLASS = 'border-t border-zinc-100 bg-zinc-50/60 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/30'
const LIST_CLASS = 'space-y-1 pl-6'
const ROW_CLASS = 'flex min-h-6 items-start gap-2 text-sm leading-6'
const BULLET_CLASS = 'mt-0.5 w-3 shrink-0 select-none text-center text-sm text-zinc-400 dark:text-zinc-500'
const TEXT_CLASS = 'min-w-0 flex-1 text-left text-sm leading-6 text-zinc-600 dark:text-zinc-300'
const INPUT_CLASS = 'min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-6 text-zinc-600 outline-none focus:ring-0 dark:text-zinc-300'

export const IncomeNotesPanel = forwardRef<
  IncomeNotesPanelHandle,
  {
    notes: string
    editing: boolean
    onStartEdit: () => void
    onCommit: (next: string) => void
    onCollapse: () => void
  }
>(function IncomeNotesPanel({ notes, editing, onStartEdit, onCommit, onCollapse }, ref) {
  const [lineDrafts, setLineDrafts] = useState<string[]>(() => parseIncomeNotesLines(notes))
  const focusIndexRef = useRef(0)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    if (!editing) return
    const lines = parseIncomeNotesLines(notes)
    setLineDrafts(lines.length > 0 ? lines : [''])
    focusIndexRef.current = 0
    queueMicrotask(() => inputRefs.current[0]?.focus())
  }, [editing, notes])

  const commitDraft = useCallback((): string => {
    const next = serializeIncomeNotesLines(lineDrafts)
    onCommit(next)
    return next
  }, [lineDrafts, onCommit])

  function commitAndCollapse(): void {
    commitDraft()
    onCollapse()
  }

  useImperativeHandle(ref, () => ({
    save: commitDraft
  }), [commitDraft])

  function updateLine(index: number, value: string): void {
    setLineDrafts((current) => current.map((line, lineIndex) => (lineIndex === index ? value : line)))
  }

  function insertLineAfter(index: number): void {
    setLineDrafts((current) => {
      const next = [...current]
      next.splice(index + 1, 0, '')
      return next
    })
    focusIndexRef.current = index + 1
    queueMicrotask(() => inputRefs.current[index + 1]?.focus())
  }

  function removeBlankLine(index: number): void {
    setLineDrafts((current) => {
      if ((current[index] ?? '').trim().length > 0) return current
      if (current.length <= 1) return ['']
      const next = current.filter((_, lineIndex) => lineIndex !== index)
      focusIndexRef.current = Math.max(0, Math.min(index - 1, next.length - 1))
      return next
    })
    queueMicrotask(() => inputRefs.current[focusIndexRef.current]?.focus())
  }

  function handleLineKeyDown(index: number, event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      commitAndCollapse()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      insertLineAfter(index)
      return
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && lineDrafts[index]?.trim().length === 0 && lineDrafts.length > 1) {
      event.preventDefault()
      removeBlankLine(index)
    }
  }

  function handlePaste(index: number, event: React.ClipboardEvent<HTMLInputElement>): void {
    const paste = event.clipboardData.getData('text')
    if (!paste.includes('\n') && !paste.includes('\r')) return
    event.preventDefault()
    const pasted = normalizePastedIncomeNoteLines(paste)
    setLineDrafts((current) => {
      const next = [...current]
      const head = [...pasted]
      const first = head.shift() ?? ''
      next[index] = `${next[index] ?? ''}${first}`
      next.splice(index + 1, 0, ...head)
      return next.length > 0 ? next : ['']
    })
  }

  const visibleLines = parseIncomeNotesLines(notes).filter((line) => line.trim().length > 0)

  function renderRows(lines: string[], mode: 'view' | 'edit'): ReactNode {
    return lines.map((line, index) => (
      <div key={`note-line-${index}`} className={ROW_CLASS}>
        <span className={BULLET_CLASS} aria-hidden>
          •
        </span>
        {mode === 'edit' ? (
          <input
            ref={(element) => {
              inputRefs.current[index] = element
            }}
            value={line}
            onChange={(event) => updateLine(index, event.target.value)}
            onKeyDown={(event) => handleLineKeyDown(index, event)}
            onPaste={(event) => handlePaste(index, event)}
            className={INPUT_CLASS}
          />
        ) : (
          <span className={TEXT_CLASS}>{line}</span>
        )}
      </div>
    ))
  }

  if (!editing) {
    return (
    <div className={PANEL_CLASS}>
      {!hasVisibleIncomeNotes(notes) ? (
        <button
          type="button"
          onClick={onStartEdit}
          className="block w-full pl-6 text-left text-sm leading-6 text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          No notes
        </button>
      ) : (
        <button
          type="button"
          onClick={onStartEdit}
          className="block w-full text-left transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-950/40"
        >
          <div className={LIST_CLASS}>{renderRows(visibleLines, 'view')}</div>
        </button>
      )}
    </div>
  )
  }

  return (
    <div className={PANEL_CLASS}>
      <div className={LIST_CLASS}>{renderRows(lineDrafts, 'edit')}</div>
    </div>
  )
})
