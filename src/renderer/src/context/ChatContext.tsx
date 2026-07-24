import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type SetStateAction
} from 'react'
import type { ChatMessage, ChatTurn, PageId } from '../../../types/money'

export type ChatState = {
  messages: ChatMessage[]
  draft: string
  height: number
  scrollTop: number
}

const STORAGE_KEY = 'scoop_money_chat_store'
const ALL_PAGES: PageId[] = [
  'dashboard',
  'living-expenses',
  'analytics',
  'expenses-budget',
  'expenses-actual',
  'expenses-summary',
  'income-expected',
  'income-actual',
  'income-summary',
  'settings',
  'transactions',
  'budget',
  'summary',
  'income'
]
const CHAT_DEFAULT_DOCK_HEIGHT = 120

function emptyState(): ChatState {
  return { messages: [], draft: '', height: CHAT_DEFAULT_DOCK_HEIGHT, scrollTop: 0 }
}

const EMPTY_CHAT = emptyState()

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    (typeof message.createdAt === 'number' || typeof message.timestamp === 'number')
  )
}

function normalizeMessage(message: ChatMessage & { timestamp?: number }): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: typeof message.createdAt === 'number' ? message.createdAt : (message.timestamp ?? Date.now()),
    pending: false,
    error: message.error === true ? true : undefined
  }
}

function defaultStore(): Record<PageId, ChatState> {
  return {
    dashboard: emptyState(),
    'living-expenses': emptyState(),
    analytics: emptyState(),
    'expenses-budget': emptyState(),
    'expenses-actual': emptyState(),
    'expenses-summary': emptyState(),
    'income-expected': emptyState(),
    'income-actual': emptyState(),
    'income-summary': emptyState(),
    settings: emptyState(),
    transactions: emptyState(),
    budget: emptyState(),
    summary: emptyState(),
    income: emptyState()
  }
}

function clampHeight(height: number): number {
  const max = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 640
  return Math.min(Math.max(100, height), max)
}

function loadStore(): Record<PageId, ChatState> {
  const base = defaultStore()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<Record<PageId, unknown>>
    for (const page of ALL_PAGES) {
      const row = parsed[page]
      if (!row || typeof row !== 'object') continue
      const state = row as Record<string, unknown>
      const messages = Array.isArray(state.messages)
        ? state.messages.filter(isChatMessage).map((message) => normalizeMessage(message))
        : []
      const draft = typeof state.draft === 'string' ? state.draft : ''
      const height = typeof state.height === 'number' && Number.isFinite(state.height) ? state.height : CHAT_DEFAULT_DOCK_HEIGHT
      const scrollTop = typeof state.scrollTop === 'number' && Number.isFinite(state.scrollTop) ? state.scrollTop : 0
      base[page] = { messages, draft, height: clampHeight(height), scrollTop }
    }
    if (
      parsed.income &&
      !parsed['income-actual'] &&
      (base.income.messages.length > 0 || base.income.draft.trim().length > 0)
    ) {
      base['income-actual'] = base.income
    }
  } catch {
    /* ignore corrupt storage */
  }
  return base
}

export function chatMessagesToTurns(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((message) => !message.pending && !message.error)
    .map(({ role, content }) => ({ role, content }))
}

interface ChatContextValue {
  getChat: (pageId: PageId) => ChatState
  setMessages: (pageId: PageId, value: SetStateAction<ChatMessage[]>) => void
  setDraft: (pageId: PageId, draft: string) => void
  setHeight: (pageId: PageId, height: number) => void
  setScrollTop: (pageId: PageId, scrollTop: number) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<Record<PageId, ChatState>>(loadStore)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    } catch {
      /* quota */
    }
  }, [store])

  const getChat = useCallback((pageId: PageId): ChatState => store[pageId] ?? EMPTY_CHAT, [store])

  const patchPage = useCallback(
    (pageId: PageId, patch: Partial<ChatState> | ((previous: ChatState) => Partial<ChatState>)): void => {
      setStore((previous) => {
        const current = previous[pageId] ?? emptyState()
        const nextPatch = typeof patch === 'function' ? patch(current) : patch
        return { ...previous, [pageId]: { ...current, ...nextPatch } }
      })
    },
    []
  )

  const setMessages = useCallback(
    (pageId: PageId, value: SetStateAction<ChatMessage[]>): void => {
      patchPage(pageId, (previous) => ({
        messages: typeof value === 'function' ? value(previous.messages) : value
      }))
    },
    [patchPage]
  )

  const setDraft = useCallback((pageId: PageId, draft: string): void => patchPage(pageId, { draft }), [patchPage])

  const setHeight = useCallback(
    (pageId: PageId, height: number): void => patchPage(pageId, { height: clampHeight(height) }),
    [patchPage]
  )

  const setScrollTop = useCallback(
    (pageId: PageId, scrollTop: number): void => patchPage(pageId, { scrollTop }),
    [patchPage]
  )

  const value = useMemo(
    () => ({ getChat, setMessages, setDraft, setHeight, setScrollTop }),
    [getChat, setMessages, setDraft, setHeight, setScrollTop]
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext)
  if (!value) throw new Error('useChat must be used inside ChatProvider')
  return value
}

export function newChatMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
