const BULLET_PREFIX_RE = /^[\s]*(•|[*\-–—]|[\u2022\u25CF\u25CB\u25E6\u2043\u2219]|\d+[.)])\s*/

export function stripIncomeNoteBulletPrefix(line: string): string {
  let next = line
  while (BULLET_PREFIX_RE.test(next)) {
    next = next.replace(BULLET_PREFIX_RE, '')
  }
  return next
}

export function parseIncomeNotesLines(stored: string): string[] {
  if (!stored) return []
  return stored.split(/\r?\n/).map((line) => stripIncomeNoteBulletPrefix(line))
}

export function serializeIncomeNotesLines(lines: string[]): string {
  return lines.map((line) => stripIncomeNoteBulletPrefix(line)).join('\n').replace(/\n+$/, '')
}

export function hasVisibleIncomeNotes(stored: string): boolean {
  return parseIncomeNotesLines(stored).some((line) => line.trim().length > 0)
}

export function normalizePastedIncomeNoteLines(paste: string): string[] {
  if (!paste) return ['']
  const parts = paste.split(/\r?\n/)
  return parts.length > 0 ? parts.map((line) => stripIncomeNoteBulletPrefix(line)) : ['']
}
