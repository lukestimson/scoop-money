const INCOME_TYPE_COLORS_KEY = 'scoop_income_type_colors_v1'

type HexOverrideMap = Record<string, string>

const listeners = new Set<() => void>()

function isValidHex6(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

function normalizeTypeKey(type: string): string {
  return type.trim()
}

function readOverrides(): HexOverrideMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(INCOME_TYPE_COLORS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as HexOverrideMap
    if (!parsed || typeof parsed !== 'object') return {}
    const out: HexOverrideMap = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && isValidHex6(value)) out[normalizeTypeKey(key)] = value
    }
    return out
  } catch {
    return {}
  }
}

function writeOverrides(map: HexOverrideMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(INCOME_TYPE_COLORS_KEY, JSON.stringify(map))
    for (const listener of listeners) listener()
  } catch {
    // no-op
  }
}

export function subscribeIncomeTypeColors(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readIncomeTypeColorHex(type: string): string | null {
  const key = normalizeTypeKey(type)
  if (!key) return null
  return readOverrides()[key] ?? null
}

export function setIncomeTypeColorHex(type: string, hex: string): void {
  const key = normalizeTypeKey(type)
  if (!key || !isValidHex6(hex)) return
  const next = { ...readOverrides(), [key]: hex }
  writeOverrides(next)
}

export function removeIncomeTypeColorHex(type: string): void {
  const key = normalizeTypeKey(type)
  if (!key) return
  const next = { ...readOverrides() }
  delete next[key]
  writeOverrides(next)
}

export function readAllIncomeTypeColorHexes(): HexOverrideMap {
  return readOverrides()
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!isValidHex6(hex)) return null
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}

export function incomeTypeChipPresentation(type: string, fallbackClass: string): {
  className: string
  style?: { backgroundColor: string; color: string; boxShadow: string }
} {
  const hex = readIncomeTypeColorHex(type)
  if (!hex) return { className: fallbackClass }
  const rgb = hexToRgb(hex)
  if (!rgb) return { className: fallbackClass }
  return {
    className: 'inline-flex h-6 w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset',
    style: {
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`,
      color: hex,
      boxShadow: `inset 0 0 0 1px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`
    }
  }
}
