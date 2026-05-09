import { useEffect, useState } from 'react'

export function useInlineEdit<T>(value: T) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (!isEditing) setDraft(value)
  }, [isEditing, value])

  return {
    isEditing,
    draft,
    setDraft,
    start: () => setIsEditing(true),
    cancel: () => {
      setDraft(value)
      setIsEditing(false)
    },
    finish: () => setIsEditing(false)
  }
}
