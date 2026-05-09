import { useMemo, useRef, useState } from 'react'
import type { PageId } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { useChatContext } from '../context/ChatContext'

export function ChatBox({ pageId }: { pageId: PageId }) {
  const { getPageState, setDraft, setHeight, appendMessage, replaceMessage } = useChatContext()
  const { bumpDataVersion } = useAppContext()
  const state = getPageState(pageId)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const startY = useRef(0)
  const startHeight = useRef(state.height)

  const history = useMemo(() => state.messages.filter((message) => !message.pending && !message.error), [state.messages])

  async function submit(): Promise<void> {
    const content = state.draft.trim()
    if (!content || busy) return
    const userMessage = { id: crypto.randomUUID(), role: 'user' as const, content, createdAt: Date.now() }
    const pendingId = crypto.randomUUID()
    appendMessage(pageId, userMessage)
    appendMessage(pageId, {
      id: pendingId,
      role: 'assistant',
      content: 'Thinking...',
      createdAt: Date.now(),
      pending: true
    })
    setDraft(pageId, '')
    setBusy(true)
    try {
      const result = await window.api.chat(pageId, content, history)
      replaceMessage(pageId, pendingId, {
        id: pendingId,
        role: 'assistant',
        content: result.text,
        createdAt: Date.now()
      })
      if (result.dataChanged) bumpDataVersion()
    } catch (error) {
      replaceMessage(pageId, pendingId, {
        id: pendingId,
        role: 'assistant',
        content: error instanceof Error ? error.message : String(error),
        createdAt: Date.now(),
        error: true
      })
    } finally {
      setBusy(false)
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    setDragging(true)
    startY.current = event.clientY
    startHeight.current = state.height
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging) return
    const next = Math.min(420, Math.max(160, startHeight.current - (event.clientY - startY.current)))
    setHeight(pageId, next)
  }

  return (
    <section
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
      style={{ height: state.height }}
    >
      <div
        className="h-2 cursor-row-resize bg-zinc-100 dark:bg-zinc-800"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
      />
      <div className="flex h-[calc(100%-0.5rem)] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {state.messages.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Ask about spending, budgets, or income.</p>
          ) : (
            state.messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[86%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'ml-auto bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                    : message.error
                      ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                      : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                }`}
              >
                {message.content}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <textarea
              value={state.draft}
              onChange={(event) => setDraft(pageId, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit()
                }
              }}
              rows={1}
              className="max-h-24 min-h-9 flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              placeholder="Ask Scoop Money..."
            />
            <button
              type="submit"
              disabled={busy || !state.draft.trim()}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-950 dark:disabled:bg-zinc-700"
            >
              {busy ? 'Sending' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
