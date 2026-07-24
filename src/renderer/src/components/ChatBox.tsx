import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent, type Ref } from 'react'
import { flushSync } from 'react-dom'
import type { AiProvider, AiUsageSummary, ChatAttachment, ChatMessage, ModelInfo, PageId } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { chatMessagesToTurns, newChatMessageId, useChat } from '../context/ChatContext'

type PendingAttachment = ChatAttachment & {
  id: string
  size: string
}

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const DOC_MIMES = new Set(['application/pdf'])
const MAX_FILE_BYTES = 10 * 1024 * 1024
const COLLAPSE_DRAG_THRESHOLD_PX = 168
const MIN_HEIGHT_WITH_HISTORY_PX = 280
const PEEK_OPEN_HEIGHT_PX = 216
const MAX_PANEL_FRACTION = 0.58
/** Form pt-3 + pb-2 + toolbar mt-2 (space reserved below textarea). */
const COMPOSER_FORM_VERTICAL_PADDING_PX = 28
/** mb-2 under attachment chips is not included in offsetHeight. */
const ATTACHMENT_STRIP_MARGIN_BOTTOM_PX = 8

function totalMessageChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0)
}

function suggestThreadPanelHeight(messages: ChatMessage[], isSending: boolean, windowHeight: number): number {
  const maxHeight = windowHeight * MAX_PANEL_FRACTION
  if (messages.length === 0 && !isSending) return Math.min(PEEK_OPEN_HEIGHT_PX, maxHeight)
  const estimated = 128 + (messages.length + (isSending ? 1 : 0)) * 46 + (totalMessageChars(messages) / 45) * 11
  return Math.min(maxHeight, Math.max(MIN_HEIGHT_WITH_HISTORY_PX, Math.round(estimated)))
}

export function ChatBox({
  pageId,
  fullWidth = false,
  onExpandedChange
}: {
  pageId: PageId
  fullWidth?: boolean
  onExpandedChange?: (expanded: boolean) => void
}) {
  const { getChat, setMessages, setDraft, setHeight, setScrollTop } = useChat()
  const { bumpDataVersion } = useAppContext()
  const chat = getChat(pageId)

  const [isExpanded, setIsExpanded] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dictationArmed, setDictationArmed] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [provider, setProvider] = useState<AiProvider>('anthropic')
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [lastUsage, setLastUsage] = useState<AiUsageSummary | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const attachBtnRef = useRef<HTMLButtonElement | null>(null)
  const attachPopoverRef = useRef<HTMLDivElement | null>(null)
  const modelBtnRef = useRef<HTMLButtonElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const threadColumnRef = useRef<HTMLDivElement | null>(null)
  const composerToolbarRef = useRef<HTMLDivElement | null>(null)
  const attachmentBoxRef = useRef<HTMLDivElement | null>(null)
  const scrollRaf = useRef<number | null>(null)
  const prevMessageLength = useRef(0)
  const lastRawHeightRef = useRef(0)
  const hadResizeMoveRef = useRef(false)
  const lastDropSignatureRef = useRef<{ sig: string; at: number } | null>(null)

  useEffect(() => {
    onExpandedChange?.(isExpanded)
  }, [isExpanded, onExpandedChange])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || !isExpanded) return
    element.scrollTop = getChat(pageId).scrollTop
    prevMessageLength.current = getChat(pageId).messages.length
  }, [getChat, isExpanded, pageId])

  useEffect(() => {
    const element = scrollRef.current
    if (chat.messages.length > prevMessageLength.current && element && isExpanded) {
      element.scrollTop = element.scrollHeight
    }
    prevMessageLength.current = chat.messages.length
  }, [chat.messages.length, isExpanded])

  useEffect(() => {
    let cancelled = false
    window.api.getAiProvider()
      .then((state) => {
        if (cancelled) return
        setProvider(state.provider)
        setModelId(state.model)
        setModels(state.models)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!attachOpen) return
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        attachPopoverRef.current &&
        !attachPopoverRef.current.contains(target) &&
        attachBtnRef.current &&
        !attachBtnRef.current.contains(target)
      ) {
        setAttachOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAttachOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [attachOpen])

  useEffect(() => {
    if (!modelMenuOpen) return
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(target) &&
        modelBtnRef.current &&
        !modelBtnRef.current.contains(target)
      ) {
        setModelMenuOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setModelMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [modelMenuOpen])

  useEffect(() => {
    if (!resizing) return
    const onMove = (event: MouseEvent): void => {
      const rawHeight = window.innerHeight - event.clientY
      lastRawHeightRef.current = rawHeight
      hadResizeMoveRef.current = true
      setHeight(pageId, rawHeight)
    }
    const onUp = (): void => {
      if (hadResizeMoveRef.current && lastRawHeightRef.current < COLLAPSE_DRAG_THRESHOLD_PX) {
        setIsExpanded(false)
      }
      hadResizeMoveRef.current = false
      setResizing(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mouseleave', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mouseleave', onUp)
    }
  }, [pageId, resizing, setHeight])

  const syncComposerTextareaHeight = useCallback((): void => {
    const column = threadColumnRef.current
    const textarea = textareaRef.current
    const toolbar = composerToolbarRef.current
    if (!column || !textarea || !isExpanded) return

    const columnHeight = column.clientHeight
    const toolbarHeight = toolbar?.offsetHeight ?? 44
    const attachmentHeight = attachmentBoxRef.current?.offsetHeight ?? 0
    const attachmentMargin = attachments.length > 0 ? ATTACHMENT_STRIP_MARGIN_BOTTOM_PX : 0
    const maxTextarea = Math.max(
      44,
      columnHeight - toolbarHeight - attachmentHeight - attachmentMargin - COMPOSER_FORM_VERTICAL_PADDING_PX
    )

    textarea.style.height = 'auto'
    const scrollWant = textarea.scrollHeight
    const next = Math.min(scrollWant, maxTextarea)
    textarea.style.height = `${next}px`
    textarea.style.overflowY = scrollWant > maxTextarea ? 'auto' : 'hidden'
  }, [attachments.length, isExpanded])

  useLayoutEffect(() => {
    syncComposerTextareaHeight()
  }, [chat.draft, chat.height, isExpanded, attachments.length, syncComposerTextareaHeight])

  useEffect(() => {
    const column = threadColumnRef.current
    if (!column || !isExpanded) return
    const observer = new ResizeObserver(() => {
      syncComposerTextareaHeight()
    })
    observer.observe(column)
    return () => {
      observer.disconnect()
    }
  }, [isExpanded, syncComposerTextareaHeight])

  const openExpandedSmart = useCallback((): void => {
    const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800
    flushSync(() => setIsExpanded(true))
    const suggested = suggestThreadPanelHeight(chat.messages, isSending, windowHeight)
    setHeight(pageId, Math.max(suggested, Math.min(chat.height, windowHeight * MAX_PANEL_FRACTION)))
  }, [chat.height, chat.messages, isSending, pageId, setHeight])

  const beginResizeFromCollapsed = useCallback((): void => {
    openExpandedSmart()
    setResizing(true)
  }, [openExpandedSmart])

  const addFiles = useCallback(
    async (files: FileList | File[]): Promise<void> => {
      const list = Array.from(files)
      if (list.length === 0) return

      const sig = list.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join('|')
      const now = Date.now()
      const last = lastDropSignatureRef.current
      if (last && last.sig === sig && now - last.at < 500) return
      lastDropSignatureRef.current = { sig, at: now }

      const accepted: PendingAttachment[] = []
      const rejected: string[] = []
      for (const file of list) {
        const isImage = IMAGE_MIMES.has(file.type)
        const isDocument = DOC_MIMES.has(file.type)
        if (!isImage && !isDocument) {
          rejected.push(`${file.name} (unsupported type)`)
          continue
        }
        if (file.size > MAX_FILE_BYTES) {
          rejected.push(`${file.name} (over 10 MB)`)
          continue
        }
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: isImage ? 'image' : 'document',
          mediaType: file.type,
          dataBase64: await readAsBase64(file),
          name: file.name,
          size: formatSize(file.size)
        })
      }

      if (accepted.length > 0) setAttachments((current) => [...current, ...accepted])
      if (rejected.length > 0) {
        setMessages(pageId, (current) => [
          ...current,
          {
            id: newChatMessageId(),
            role: 'assistant',
            content: `Skipped: ${rejected.join(', ')}. Images (PNG/JPEG/GIF/WEBP) and PDFs under 10 MB only.`,
            createdAt: Date.now(),
            error: true
          }
        ])
      }
    },
    [pageId, setMessages]
  )

  const triggerDictation = useCallback(async (): Promise<void> => {
    setVoiceError(null)
    textareaRef.current?.focus()
    setDictationArmed(true)
    window.setTimeout(() => setDictationArmed(false), 1200)
    try {
      await window.api.startMacDictation()
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const toggleModelMenu = useCallback((): void => {
    setModelMenuOpen((open) => {
      const next = !open
      if (next) {
        const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800
        const pickerHeight = Math.min(Math.round(windowHeight * MAX_PANEL_FRACTION), 420)
        setHeight(pageId, Math.max(chat.height, pickerHeight))
      }
      return next
    })
  }, [chat.height, pageId, setHeight])

  const handleSelectModel = useCallback(
    async (id: string): Promise<void> => {
      try {
        const result = await window.api.setModel(id)
        if (!result.success) throw new Error(result.reason ?? 'Could not select model.')
        setModelId(id)
      } catch (error) {
        setMessages(pageId, (current) => [
          ...current,
          {
            id: newChatMessageId(),
            role: 'assistant',
            content: error instanceof Error ? error.message : String(error),
            createdAt: Date.now(),
            error: true
          }
        ])
      } finally {
        setModelMenuOpen(false)
      }
    },
    [pageId, setMessages]
  )

  const handleSubmit = async (event?: FormEvent): Promise<void> => {
    if (event) event.preventDefault()
    const trimmed = chat.draft.trim()
    if ((!trimmed && attachments.length === 0) || isSending) return

    if (!isExpanded) flushSync(() => setIsExpanded(true))
    const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800
    setHeight(pageId, Math.max(MIN_HEIGHT_WITH_HISTORY_PX, suggestThreadPanelHeight(chat.messages, true, windowHeight), chat.height))

    const priorHistory = chatMessagesToTurns(chat.messages)
    const payload = attachments.map(({ kind, mediaType, dataBase64, name }) => ({ kind, mediaType, dataBase64, name }))
    const attachmentList =
      attachments.length > 0
        ? `\n\n[${attachments.length} attachment${attachments.length === 1 ? '' : 's'}: ${attachments.map((item) => item.name).join(', ')}]`
        : ''

    setMessages(pageId, (current) => [
      ...current,
      {
        id: newChatMessageId(),
        role: 'user',
        content: `${trimmed}${attachmentList}`.trim() || '(attachments only)',
        createdAt: Date.now()
      }
    ])
    setDraft(pageId, '')
    setAttachments([])
    setIsSending(true)
    setLastUsage(null)

    try {
      const result = await window.api.chat(pageId, trimmed, priorHistory, payload)
      setMessages(pageId, (current) => [
        ...current,
        { id: newChatMessageId(), role: 'assistant', content: result.text, createdAt: Date.now() }
      ])
      if (result.usage) setLastUsage(result.usage)
      if (result.dataChanged) bumpDataVersion()
    } catch (error) {
      setMessages(pageId, (current) => [
        ...current,
        {
          id: newChatMessageId(),
          role: 'assistant',
          content: error instanceof Error ? error.message : String(error),
          createdAt: Date.now(),
          error: true
        }
      ])
    } finally {
      setIsSending(false)
    }
  }

  const onScrollLog = (): void => {
    const element = scrollRef.current
    if (!element) return
    if (scrollRaf.current != null) cancelAnimationFrame(scrollRaf.current)
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null
      setScrollTop(pageId, element.scrollTop)
    })
  }

  const onDragOver = (event: DragEvent<HTMLFormElement>): void => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault()
      setIsDragging(true)
    }
  }
  const onDragLeave = (event: DragEvent<HTMLFormElement>): void => {
    if (event.currentTarget === event.target) setIsDragging(false)
  }
  const onDrop = async (event: DragEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setIsDragging(false)
    if (event.dataTransfer.files.length > 0) {
      await addFiles(event.dataTransfer.files)
      setAttachOpen(false)
    }
  }

  const canSend = !isSending && (chat.draft.trim().length > 0 || attachments.length > 0)
  const modelLabel = models.find((model) => model.id === modelId)?.display_name ?? formatModelLabel(modelId)
  const providerLabel = provider === 'anthropic' ? 'Anthropic' : 'OpenAI'
  const formShellExpanded = [
    'relative z-10 flex max-h-full min-h-0 shrink-0 flex-col overflow-visible border-t border-zinc-100 bg-white px-3 pb-2 pt-3 transition-colors dark:border-zinc-800 dark:bg-zinc-900',
    isDragging ? 'ring-2 ring-inset ring-zinc-300 dark:ring-zinc-600' : 'focus-within:ring-2 focus-within:ring-inset focus-within:ring-zinc-200 dark:focus-within:ring-zinc-700'
  ].join(' ')

  const composer = (
    <>
      {isDragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-white/85 text-sm font-medium text-zinc-700 dark:bg-zinc-950/90 dark:text-zinc-200">
          Drop files to attach
        </div>
      ) : null}

      <div className="flex min-w-0 shrink-0 flex-col overflow-hidden">
        <div ref={attachmentBoxRef} className={attachments.length > 0 ? 'mb-2 shrink-0 flex flex-wrap gap-1.5' : 'shrink-0'}>
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
            />
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={chat.draft}
          onChange={(event) => setDraft(pageId, event.target.value)}
          onFocus={() => {
            if (!isExpanded) openExpandedSmart()
            else if (chat.messages.length > 0 && chat.height < MIN_HEIGHT_WITH_HISTORY_PX) setHeight(pageId, MIN_HEIGHT_WITH_HISTORY_PX)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setAttachOpen(false)
              setModelMenuOpen(false)
              setIsExpanded(false)
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void handleSubmit()
            }
          }}
          placeholder="Reply..."
          rows={1}
          className="block min-h-[44px] min-w-0 w-full shrink-0 resize-none overflow-y-hidden overscroll-contain bg-transparent px-2 py-2 text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
      </div>

      <div ref={composerToolbarRef} className="mt-2 flex shrink-0 items-center justify-between gap-2 px-1">
        <div className="relative">
          <button
            ref={attachBtnRef}
            type="button"
            onClick={() => setAttachOpen((value) => !value)}
            aria-label="Attach files"
            aria-expanded={attachOpen}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 transition-colors ${
              attachOpen ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
            }`}
          >
            <PlusIcon />
          </button>
          {attachOpen ? (
            <AttachPopover
              innerRef={attachPopoverRef}
              onPickFiles={() => fileInputRef.current?.click()}
              onFiles={async (files) => {
                await addFiles(files)
                setAttachOpen(false)
              }}
            />
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            className="hidden"
            onChange={async (event) => {
              if (event.target.files && event.target.files.length > 0) {
                await addFiles(event.target.files)
                event.target.value = ''
                setAttachOpen(false)
              }
            }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {voiceError ? (
            <span className="mr-1 max-w-[160px] truncate text-[11px] text-zinc-400" title={voiceError}>
              {voiceError}
            </span>
          ) : null}

          {isExpanded && lastUsage && !isSending ? (
            <AssistantRunStatus isSending={false} usage={lastUsage} className="mr-1.5" />
          ) : null}

          <div className="relative">
            <button
              ref={modelBtnRef}
              type="button"
              onClick={toggleModelMenu}
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              title={modelId ? `${providerLabel} model: ${modelId}` : 'Loading model...'}
              className={`inline-flex max-w-[min(17rem,46vw)] shrink-0 items-center gap-1 truncate rounded-full px-2 py-1 text-[12px] font-medium transition-colors ${
                modelMenuOpen ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <span className="min-w-0 truncate">{modelLabel}</span>
              <ChevronDownIcon />
            </button>
            {modelMenuOpen ? (
              <ModelMenu innerRef={modelMenuRef} models={models} activeId={modelId} providerLabel={providerLabel} onSelect={handleSelectModel} />
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void triggerDictation()}
            aria-label="Start Mac Dictation"
            title="Start Mac Dictation (free, built into macOS)"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors ${
              dictationArmed
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
            }`}
          >
            <WaveformIcon active={dictationArmed} />
          </button>

          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white transition-opacity hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSending ? <SpinnerIcon /> : <ArrowUpIcon />}
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div className={`mx-auto flex w-full min-h-0 flex-col ${fullWidth ? 'max-w-none' : 'max-w-3xl'}`}>
      <div
        style={isExpanded ? { height: chat.height } : undefined}
        className={isExpanded ? 'mb-2 flex min-h-0 flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900' : 'flex min-h-0 flex-col'}
      >
        {isExpanded ? (
          <>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize chat panel"
              className="relative flex shrink-0 cursor-ns-resize select-none items-center border-b border-zinc-100 px-4 py-2 dark:border-zinc-800"
              onMouseDown={(event) => {
                if ((event.target as HTMLElement).closest('button')) return
                event.preventDefault()
                setResizing(true)
              }}
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Assistant</span>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setIsExpanded(false)}
                aria-label="Minimize chat to reply bar"
                title="Minimize"
                className="absolute left-1/2 top-1/2 inline-flex h-7 w-7 -translate-x-1/2 translate-y-[calc(-50%+3px)] items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <PanelChevronDownIcon />
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setMessages(pageId, [])
                  setIsExpanded(false)
                }}
                className="ml-auto text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                Clear
              </button>
            </div>
            <div ref={threadColumnRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div ref={scrollRef} onScroll={onScrollLog} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite">
                {chat.messages.length === 0 && !isSending ? (
                  <p className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                    Ask about spending, budgets, income, or imported transactions.
                  </p>
                ) : null}
                {chat.messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {isSending ? <LoadingBubble /> : null}
              </div>
              <form onSubmit={handleSubmit} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} className={formShellExpanded}>
                {composer}
              </form>
            </div>
          </>
        ) : (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize chat panel"
            className="relative mb-0.5 flex h-5 w-full shrink-0 cursor-ns-resize items-center justify-center"
            onMouseDown={(event) => {
              if ((event.target as HTMLElement).closest('button')) return
              event.preventDefault()
              beginResizeFromCollapsed()
            }}
          >
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={openExpandedSmart}
              aria-label="Open conversation"
              title="Open chat"
              className="absolute left-1/2 top-1/2 inline-flex h-5 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <PanelChevronUpIcon />
            </button>
            {isSending || lastUsage ? (
              <AssistantRunStatus
                isSending={isSending}
                usage={lastUsage}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
            : message.error
              ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900'
              : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
        }`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label={copied ? 'Copied' : 'Copy message'}
            title={copied ? 'Copied' : 'Copy'}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
              isUser
                ? 'text-white/55 hover:bg-white/12 hover:text-white dark:text-zinc-900/55 dark:hover:bg-zinc-900/10 dark:hover:text-zinc-900'
                : 'text-zinc-400 hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/8 dark:hover:text-zinc-200'
            }`}
          >
            {copied ? <CheckCopyIcon /> : <CopyIcon />}
          </button>
        </div>
      </div>
    </div>
  )
}

function LoadingBubble() {
  return (
    <div className="flex w-full justify-start">
      <div className="flex items-center gap-1 rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
      </div>
    </div>
  )
}

function formatAiCostUsd(usd: number): string {
  if (usd >= 0.01) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(3)}`
}

function AssistantRunStatus({
  isSending,
  usage,
  className
}: {
  isSending: boolean
  usage: AiUsageSummary | null
  className?: string
}): React.JSX.Element | null {
  if (isSending) {
    return (
      <span
        className={['inline-flex items-center text-zinc-400 dark:text-zinc-500', className].filter(Boolean).join(' ')}
        aria-label="Assistant is replying"
        title="Assistant is replying"
      >
        <SpinnerIcon />
      </span>
    )
  }
  if (!usage) return null

  const callLabel = usage.apiCalls === 1 ? '1 call' : `${usage.apiCalls} calls`
  const tokenDetail = `${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out tokens`

  return (
    <span
      className={[
        'inline-flex items-center text-[10px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500',
        className
      ].filter(Boolean).join(' ')}
      title={`${callLabel} · ${tokenDetail}`}
    >
      {callLabel} · {formatAiCostUsd(usage.costUsd)}
    </span>
  )
}

function ModelMenu({ innerRef, models, activeId, providerLabel, onSelect }: { innerRef: Ref<HTMLDivElement>; models: ModelInfo[]; activeId: string; providerLabel: string; onSelect: (id: string) => void }) {
  return (
    <div ref={innerRef} role="listbox" aria-label={`Select ${providerLabel} model`} className="absolute bottom-[calc(100%+8px)] right-0 z-50 flex max-h-[min(300px,48vh)] w-max min-w-[12rem] max-w-[18rem] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-600 dark:bg-zinc-900">
      <div className="border-b border-zinc-100 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {providerLabel} models
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {models.length === 0 ? <div className="px-2.5 py-1.5 text-[11px] text-zinc-400">No models loaded</div> : null}
        {models.map((model) => {
          const active = model.id === activeId
          return (
            <button key={model.id} type="button" role="option" aria-selected={active} onClick={() => onSelect(model.id)} title={`${model.display_name || formatModelLabel(model.id)}\n${model.id}`} className={`flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors ${active ? 'bg-zinc-50 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}>
              <span className="flex h-4 w-3 shrink-0 justify-center pt-0.5">{active ? <CheckIcon /> : null}</span>
              <span className="min-w-0 flex-1 whitespace-nowrap">
                <span className="block text-[12px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">{model.display_name || formatModelLabel(model.id)}</span>
                <span className="mt-0.5 block font-mono text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">{model.id}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 py-1 pl-2 pr-1 text-[12px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-200">
      <span className="text-zinc-400" aria-hidden="true">{attachment.kind === 'image' ? <ImageIcon /> : <DocIcon />}</span>
      <span className="max-w-[180px] truncate">{attachment.name}</span>
      <span className="text-[11px] text-zinc-400">{attachment.size}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${attachment.name}`} className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-600 dark:hover:text-zinc-200">
        <XIcon />
      </button>
    </span>
  )
}

function AttachPopover({ innerRef, onPickFiles, onFiles }: { innerRef: Ref<HTMLDivElement>; onPickFiles: () => void; onFiles: (files: FileList | File[]) => Promise<void> }) {
  const [over, setOver] = useState(false)
  return (
    <div
      ref={innerRef}
      className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-[320px] rounded-2xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.stopPropagation()
          setOver(true)
        }
      }}
      onDragLeave={(event) => {
        event.stopPropagation()
        setOver(false)
      }}
      onDrop={async (event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(false)
        if (event.dataTransfer.files.length > 0) await onFiles(event.dataTransfer.files)
      }}
    >
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Add files</h3>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Drag-and-drop screenshots or PDFs, or browse.</p>
      </div>
      <button type="button" onClick={onPickFiles} className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed py-6 text-center transition-colors ${over ? 'border-zinc-900 bg-zinc-50 text-zinc-900 dark:border-zinc-300 dark:bg-zinc-800 dark:text-zinc-100' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'}`}>
        <UploadIcon />
        <span className="text-[13px] font-medium">{over ? 'Release to attach' : 'Drop files here or click to browse'}</span>
        <span className="text-[11px] text-zinc-400">PNG, JPEG, GIF, WEBP, PDF · up to 10 MB</span>
      </button>
    </div>
  )
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result.'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('File read failed.'))
    reader.readAsDataURL(file)
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatModelLabel(id: string): string {
  if (!id) return 'Loading...'
  const match = id.match(/^claude-(haiku|sonnet|opus)-([0-9]+(?:\.[0-9]+)?)/i)
  if (!match) return id
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1)
  return `Claude ${family} ${match[2]}`
}

function PanelChevronUpIcon() { return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 L10 7.5 L15 12.5" /></svg> }
function PanelChevronDownIcon() { return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7.5 L10 12.5 L15 7.5" /></svg> }
function PlusIcon() { return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M10 4v12M4 10h12" /></svg> }
function ArrowUpIcon() { return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" /></svg> }
function SpinnerIcon() { return <svg width="14" height="14" viewBox="0 0 20 20" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 3a7 7 0 1 1-4.95 2.05" /></svg> }
function WaveformIcon({ active }: { active: boolean }) { return <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">{[0, 1, 2, 3].map((index) => <rect key={index} x={3 + index * 4} y={6} width="2" height={8} rx="1" fill="currentColor">{active ? <><animate attributeName="y" values="7;3;7" dur={`${0.7 + index * 0.15}s`} repeatCount="indefinite" /><animate attributeName="height" values="6;14;6" dur={`${0.7 + index * 0.15}s`} repeatCount="indefinite" /></> : null}</rect>)}</svg> }
function ImageIcon() { return <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="14" height="12" rx="2" /><circle cx="8" cy="9" r="1.25" /><path d="m4 15 4-4 4 4 3-3 1 1" /></svg> }
function DocIcon() { return <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h6l3 3v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M12 3v3h3" /></svg> }
function UploadIcon() { return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 14V4M5.5 8.5 10 4l4.5 4.5" /><path d="M4 14v1.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14" /></svg> }
function XIcon() { return <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m3 3 6 6M9 3l-6 6" /></svg> }
function ChevronDownIcon() { return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7.5 L10 12.5 L15 7.5" /></svg> }
function CheckIcon() { return <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-900"><path d="m3 7.5 2.5 2.5L11 4" /></svg> }
function CopyIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.25" y="3.25" width="7.5" height="9" rx="1.5" /><path d="M10.75 3.25V2.5A1.25 1.25 0 0 0 9.5 1.25H3.5A1.25 1.25 0 0 0 2.25 2.5v8A1.25 1.25 0 0 0 3.5 11.75h1" /></svg> }
function CheckCopyIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 2.25 2.25L12.5 4" /></svg> }
