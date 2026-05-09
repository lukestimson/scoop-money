import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ChatMessage, PageId } from '../../../types/money'

interface ChatPageState {
  messages: ChatMessage[]
  draft: string
  height: number
}

type ChatStore = Record<string, ChatPageState>

interface ChatContextValue {
  getPageState: (pageId: PageId) => ChatPageState
  setDraft: (pageId: PageId, draft: string) => void
  setHeight: (pageId: PageId, height: number) => void
  appendMessage: (pageId: PageId, message: ChatMessage) => void
  replaceMessage: (pageId: PageId, id: string, message: ChatMessage) => void
}

const KEY = 'scoop_money_chat_store'
const DEFAULT_HEIGHT = 220
const ChatContext = createContext<ChatContextValue | null>(null)

function defaultState(): ChatPageState {
  return { messages: [], draft: '', height: DEFAULT_HEIGHT }
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<ChatStore>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}') as ChatStore
    } catch {
      return {}
    }
  })

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(store))
  }, [store])

  const updatePage = useCallback((pageId: PageId, updater: (state: ChatPageState) => ChatPageState) => {
    setStore((current) => ({
      ...current,
      [pageId]: updater(current[pageId] ?? defaultState())
    }))
  }, [])

  const value = useMemo<ChatContextValue>(
    () => ({
      getPageState: (pageId) => store[pageId] ?? defaultState(),
      setDraft: (pageId, draft) => updatePage(pageId, (state) => ({ ...state, draft })),
      setHeight: (pageId, height) => updatePage(pageId, (state) => ({ ...state, height })),
      appendMessage: (pageId, message) =>
        updatePage(pageId, (state) => ({ ...state, messages: [...state.messages, message] })),
      replaceMessage: (pageId, id, message) =>
        updatePage(pageId, (state) => ({
          ...state,
          messages: state.messages.map((item) => (item.id === id ? message : item))
        }))
    }),
    [store, updatePage]
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChatContext(): ChatContextValue {
  const value = useContext(ChatContext)
  if (!value) throw new Error('useChatContext must be used inside ChatProvider')
  return value
}
