import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BudgetLineItem, BudgetSupportScope } from '../../../types/money'
import { BUDGET_CATEGORY_ALLOWLIST, BUDGET_CATEGORY_ORDER } from '../../../types/budgetCategories'
import { categoryNeedKindFromLines, inferLineIsNeed } from '../../../types/budgetNeedRules'
import { useAppContext } from '../context/AppContext'
import { useChat } from '../context/ChatContext'
import {
  BUDGET_CATEGORY_SORT_KEY,
  BUDGET_PERIOD_KEY,
  type BudgetCategorySortKey,
  type BudgetDisplayPeriod,
  getStoredBudgetCategorySort,
  getStoredBudgetPeriod,
  loadStoredBudgetCategoryOrder,
  saveStoredBudgetCategoryOrder,
  scaleMonthlyAmountToPeriod
} from '../lib/budget'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { ChatBox } from './ChatBox'

type LineNeedFilter = 'all' | 'needs' | 'wants'
type LineEditField = 'label' | 'amount' | 'all'

// ---------------------------------------------------------------------------
// Undo system types
// ---------------------------------------------------------------------------

type UndoAction =
  | { type: 'create_line'; lineId: number }
  | { type: 'update_line'; lineId: number; prev: Partial<BudgetLineItem> }
  | { type: 'delete_line'; data: Partial<BudgetLineItem> }
  | { type: 'delete_category'; category: string; lines: Array<Partial<BudgetLineItem>>; wasBuiltIn: boolean; wasCustom: boolean }
  | { type: 'rename_category'; oldName: string; newName: string; wasBuiltIn: boolean }
  | { type: 'batch'; actions: UndoAction[] }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SORT_OPTIONS: ReadonlyArray<{ id: BudgetCategorySortKey; label: string }> = [
  { id: 'custom', label: 'Custom' },
  { id: 'amount_desc', label: 'Amount (high → low)' },
  { id: 'amount_asc', label: 'Amount (low → high)' },
  { id: 'name_asc', label: 'Name (A → Z)' }
]

const CUSTOM_CATEGORIES_KEY = 'scoop_budget_custom_categories'
const HIDDEN_CATEGORIES_KEY = 'scoop_budget_hidden_categories'
const AID_FILTERS_KEY = 'scoop_budget_aid_filters'

interface DragState {
  category: string
  origIdx: number
  startClientY: number
  deltaY: number
  draggedHeight: number
  rowMidpoints: number[]
}

function computeDragTarget(ds: DragState, count: number): number {
  const draggedCenter = ds.rowMidpoints[ds.origIdx] + ds.deltaY
  let above = 0
  for (let i = 0; i < count; i++) {
    if (i === ds.origIdx) continue
    if (ds.rowMidpoints[i] < draggedCenter) above++
  }
  return above
}

function lineMonthlyForAidMode(line: BudgetLineItem, aidActive: Set<string>): number {
  if (aidActive.has('parental') && line.support_scope === 'parental') return 0
  if (aidActive.has('government') && line.support_scope === 'government') return 0
  return line.monthly_amount
}

function isParentalGovLine(line: BudgetLineItem): boolean {
  return line.section === 'Parental & Gov Help'
}

function loadCustomCategories(): string[] {
  try { const r = localStorage.getItem(CUSTOM_CATEGORIES_KEY); if (r) { const p = JSON.parse(r); if (Array.isArray(p)) return p.map(String).filter(Boolean) } } catch { /* */ }
  return []
}
function saveCustomCategories(cats: string[]): void { localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(cats)) }

function loadHiddenCategories(): string[] {
  try { const r = localStorage.getItem(HIDDEN_CATEGORIES_KEY); if (r) { const p = JSON.parse(r); if (Array.isArray(p)) return p.map(String) } } catch { /* */ }
  return []
}
function saveHiddenCategoriesList(cats: string[]): void { localStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify(cats)) }

function loadAidFilters(): Set<'parental' | 'government'> {
  try { const r = localStorage.getItem(AID_FILTERS_KEY); if (r) { const p = JSON.parse(r); if (Array.isArray(p)) return new Set(p.filter((x: string) => x === 'parental' || x === 'government')) } } catch { /* */ }
  return new Set()
}
function saveAidFilters(filters: Set<string>): void { localStorage.setItem(AID_FILTERS_KEY, JSON.stringify([...filters])) }

function lineToPartial(line: BudgetLineItem): Partial<BudgetLineItem> {
  return { category: line.category, section: line.section, label: line.label, monthly_amount: line.monthly_amount, annual_amount: line.annual_amount, notes: line.notes, support_scope: line.support_scope, is_need: line.is_need, source_sheet: line.source_sheet, source_row: line.source_row }
}

function nextSupportScope(current: BudgetSupportScope): BudgetSupportScope {
  if (current === 'none') return 'parental'
  if (current === 'parental') return 'government'
  return 'none'
}

// ---------------------------------------------------------------------------
// Small UI components
// ---------------------------------------------------------------------------

function NeedTypeChip({ kind }: { kind: 'need' | 'wants' | 'mixed' | 'empty' }) {
  if (kind === 'empty') return <span className="inline-flex justify-center text-[10px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500">—</span>
  const label = kind === 'need' ? 'Need' : kind === 'wants' ? 'Wants' : 'Mixed'
  const cls = kind === 'need'
    ? 'bg-emerald-100/90 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
    : kind === 'wants'
      ? 'bg-violet-100/90 text-violet-900 dark:bg-violet-950/50 dark:text-violet-300'
      : 'bg-amber-100/90 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
  return <span className={`inline-flex min-w-[2.75rem] justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${cls}`}>{label}</span>
}

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
      {children}
    </button>
  )
}

function AidFilterButton({ active, color, onClick, children }: { active: boolean; color: 'orange' | 'brown'; onClick: () => void; children: ReactNode }) {
  const activeClass = color === 'orange'
    ? 'bg-orange-100 text-orange-800 shadow-sm dark:bg-orange-950/60 dark:text-orange-200'
    : 'bg-amber-100 text-amber-900 shadow-sm dark:bg-amber-950/60 dark:text-amber-100'
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${active ? activeClass : 'text-zinc-500 dark:text-zinc-400'}`}>
      {children}
    </button>
  )
}

function BudgetFilterRail({ needFilter, onNeedFilter }: { needFilter: LineNeedFilter; onNeedFilter: (v: LineNeedFilter) => void }) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="border-b border-zinc-100 bg-zinc-50/80 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">Filters</div>
      <div className="px-2 py-1.5">
        <FilterGroup ariaLabel="Need or want" hasSelection={needFilter !== 'all'} onClear={() => onNeedFilter('all')}>
          <FilterPill label="All" active={needFilter === 'all'} tone="zinc" onClick={() => onNeedFilter('all')} />
          <FilterPill label="Needs" active={needFilter === 'needs'} tone="emerald" onClick={() => onNeedFilter('needs')} />
          <FilterPill label="Wants" active={needFilter === 'wants'} tone="violet" onClick={() => onNeedFilter('wants')} />
        </FilterGroup>
      </div>
    </div>
  )
}

function FilterGroup({ ariaLabel, hasSelection, onClear, children }: { ariaLabel: string; hasSelection: boolean; onClear: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5" role="group" aria-label={ariaLabel}>
      {children}
      {hasSelection ? <button type="button" onClick={onClear} className="mt-0.5 self-start text-[10px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Clear</button> : null}
    </div>
  )
}

function FilterPill({ label, active, tone, onClick }: { label: string; active: boolean; tone: 'emerald' | 'amber' | 'sky' | 'violet' | 'zinc'; onClick: () => void }) {
  const activeClass = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900'
    : tone === 'amber' ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900'
    : tone === 'sky' ? 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900'
    : tone === 'violet' ? 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900'
    : 'bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:ring-zinc-100'
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`w-full rounded-md px-2 py-1 text-left text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 ${active ? activeClass : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'}`}>
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main Budget component
// ---------------------------------------------------------------------------

export function Budget() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const { getChat } = useChat()
  const [chatExpanded, setChatExpanded] = useState(false)
  const [period, setPeriod] = useState<BudgetDisplayPeriod>(() => getStoredBudgetPeriod())
  const [lineItems, setLineItems] = useState<BudgetLineItem[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [needFilter, setNeedFilter] = useState<LineNeedFilter>('all')
  const [editingLineId, setEditingLineId] = useState<number | null>(null)
  const [editingField, setEditingField] = useState<LineEditField | null>(null)
  const [categorySort, setCategorySort] = useState<BudgetCategorySortKey>(() => getStoredBudgetCategorySort())
  const [customOrder, setCustomOrder] = useState<string[]>(() => loadStoredBudgetCategoryOrder())
  const [userCategories, setUserCategories] = useState<string[]>(() => loadCustomCategories())
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(() => new Set(loadHiddenCategories()))
  const [newCategoryDraft, setNewCategoryDraft] = useState<string | null>(null)
  const [categoryEditMode, setCategoryEditMode] = useState(false)
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set())
  const [sortOpen, setSortOpen] = useState(false)
  const [editingCategoryName, setEditingCategoryName] = useState<string | null>(null)
  const [categoryNameDraft, setCategoryNameDraft] = useState('')
  const [contextMenu, setContextMenu] = useState<{ category: string; x: number; y: number; confirming?: boolean } | null>(null)
  const [aidFilters, setAidFilters] = useState<Set<'parental' | 'government'>>(() => loadAidFilters())

  // Undo system
  const undoStackRef = useRef<UndoAction[]>([])
  const [hasUndoActions, setHasUndoActions] = useState(false)

  const dragRef = useRef<DragState | null>(null)
  const [, setDragTick] = useState(0)
  const rowRefsMap = useRef(new Map<string, HTMLDivElement>())
  const sortRef = useRef<HTMLDivElement>(null)

  useEffect(() => { localStorage.setItem(BUDGET_PERIOD_KEY, period) }, [period])
  useEffect(() => { localStorage.setItem(BUDGET_CATEGORY_SORT_KEY, categorySort) }, [categorySort])

  useEffect(() => {
    if (!sortOpen) return
    function onClickAway(e: MouseEvent): void { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false) }
    function onEsc(e: KeyboardEvent): void { if (e.key === 'Escape') setSortOpen(false) }
    document.addEventListener('pointerdown', onClickAway)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('pointerdown', onClickAway); document.removeEventListener('keydown', onEsc) }
  }, [sortOpen])
  useEffect(() => { saveStoredBudgetCategoryOrder(customOrder) }, [customOrder])
  useEffect(() => { saveCustomCategories(userCategories) }, [userCategories])
  useEffect(() => { saveHiddenCategoriesList(Array.from(hiddenCategories)) }, [hiddenCategories])
  useEffect(() => { saveAidFilters(aidFilters) }, [aidFilters])
  useEffect(() => { window.api.getBudgetLineItems().then(setLineItems) }, [dataVersion])

  // Close context menu on any pointer down outside
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [contextMenu])

  // Enter/Escape in category edit mode
  useEffect(() => {
    if (!categoryEditMode) return
    const handler = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Enter') { e.preventDefault(); confirmCategoryEdits() }
      if (e.key === 'Escape') { e.preventDefault(); revertCategoryEdits() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  // Global Cmd+Z / Ctrl+Z undo
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if ((e.target as HTMLElement)?.tagName === 'INPUT') return
        e.preventDefault()
        void undoLastAction()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  // --- Undo helpers ---

  function pushUndo(action: UndoAction): void {
    undoStackRef.current.push(action)
    setHasUndoActions(true)
  }

  async function executeUndo(action: UndoAction): Promise<void> {
    try {
      switch (action.type) {
        case 'create_line':
          await window.api.deleteBudgetLineItem(action.lineId)
          break
        case 'update_line':
          await window.api.updateBudgetLineItem(action.lineId, action.prev)
          break
        case 'delete_line':
          await window.api.createBudgetLineItem(action.data)
          break
        case 'delete_category':
          for (const lineData of action.lines) await window.api.createBudgetLineItem(lineData)
          if (action.wasBuiltIn) setHiddenCategories((p) => { const n = new Set(p); n.delete(action.category); return n })
          if (action.wasCustom) setUserCategories((p) => [...p, action.category])
          break
        case 'rename_category': {
          const allLines = await window.api.getBudgetLineItems()
          const renamedLines = allLines.filter((l) => l.category === action.newName)
          for (const l of renamedLines) await window.api.updateBudgetLineItem(l.id, { category: action.oldName })
          if (action.wasBuiltIn) setHiddenCategories((p) => { const n = new Set(p); n.delete(action.oldName); return n })
          setUserCategories((p) => { const f = p.filter((c) => c !== action.newName); if (!BUDGET_CATEGORY_ALLOWLIST.has(action.oldName)) f.push(action.oldName); return f })
          break
        }
        case 'batch':
          for (const sub of [...action.actions].reverse()) await executeUndo(sub)
          break
      }
    } catch { /* silently skip failed undo ops */ }
  }

  async function undoLastAction(): Promise<void> {
    const action = undoStackRef.current.pop()
    if (!action) return
    setHasUndoActions(undoStackRef.current.length > 0)
    await executeUndo(action)
    bumpDataVersion()
  }

  // --- Aid filter toggle ---

  function toggleAidFilter(scope: 'parental' | 'government'): void {
    setAidFilters((prev) => {
      const next = new Set(prev)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })
  }

  // --- Memos ---

  const allCategoryKeys = useMemo(() => {
    const combined: string[] = []
    const seen = new Set<string>()
    for (const cat of BUDGET_CATEGORY_ORDER) {
      if (hiddenCategories.has(cat)) continue
      combined.push(cat); seen.add(cat)
    }
    for (const cat of userCategories) {
      if (!seen.has(cat) && cat.trim()) { combined.push(cat); seen.add(cat) }
    }
    lineItems.forEach((line) => {
      if (line.category.trim() && !seen.has(line.category) && !isParentalGovLine(line)) { combined.push(line.category); seen.add(line.category) }
    })
    return combined
  }, [hiddenCategories, lineItems, userCategories])

  const allCategorySet = useMemo(() => new Set(allCategoryKeys), [allCategoryKeys])

  const linesByCategory = useMemo(() => {
    const map = new Map<string, BudgetLineItem[]>()
    lineItems.forEach((line) => {
      if (!line.category.trim() || isParentalGovLine(line)) return
      if (needFilter === 'needs' && !line.is_need) return
      if (needFilter === 'wants' && line.is_need) return
      const list = map.get(line.category) ?? []
      list.push(line)
      map.set(line.category, list)
    })
    return map
  }, [lineItems, needFilter])

  const categoryMonthlyTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const category of allCategoryKeys) {
      const lines = lineItems.filter((l) => l.category === category && !isParentalGovLine(l) && (needFilter === 'all' || (needFilter === 'needs' ? l.is_need : !l.is_need)))
      totals.set(category, lines.reduce((acc, l) => acc + lineMonthlyForAidMode(l, aidFilters), 0))
    }
    return totals
  }, [allCategoryKeys, aidFilters, lineItems, needFilter])

  const totalBudgetScaled = useMemo(() => {
    let sum = 0
    categoryMonthlyTotals.forEach((m) => { sum += scaleMonthlyAmountToPeriod(m, period) })
    return sum
  }, [categoryMonthlyTotals, period])

  const categoryKindByCategory = useMemo(() => {
    const map = new Map<string, ReturnType<typeof categoryNeedKindFromLines>>()
    for (const category of allCategoryKeys) map.set(category, categoryNeedKindFromLines(lineItems.filter((l) => l.category === category && !isParentalGovLine(l))))
    return map
  }, [allCategoryKeys, lineItems])

  const categoriesWithParental = useMemo(() => {
    const set = new Set<string>()
    lineItems.forEach((l) => { if (l.support_scope === 'parental' && !isParentalGovLine(l)) set.add(l.category) })
    return set
  }, [lineItems])

  const categoriesWithGov = useMemo(() => {
    const set = new Set<string>()
    lineItems.forEach((l) => { if (l.support_scope === 'government' && !isParentalGovLine(l)) set.add(l.category) })
    return set
  }, [lineItems])

  const sheetIndex = useCallback((c: string) => { const i = allCategoryKeys.indexOf(c); return i >= 0 ? i : allCategoryKeys.length }, [allCategoryKeys])

  const sortedCategories = useMemo(() => {
    const keys = [...allCategoryKeys]
    const scaledTotal = (cat: string): number => scaleMonthlyAmountToPeriod(categoryMonthlyTotals.get(cat) ?? 0, period)
    if (categorySort === 'custom') {
      const order = customOrder.filter((c) => allCategorySet.has(c))
      const rest = keys.filter((c) => !order.includes(c))
      return [...order, ...rest]
    }
    if (categorySort === 'name_asc') return [...keys].sort((a, b) => a.localeCompare(b))
    if (categorySort === 'amount_desc') return [...keys].sort((a, b) => { const d = scaledTotal(b) - scaledTotal(a); return d !== 0 ? d : sheetIndex(a) - sheetIndex(b) })
    if (categorySort === 'amount_asc') return [...keys].sort((a, b) => { const d = scaledTotal(a) - scaledTotal(b); return d !== 0 ? d : sheetIndex(a) - sheetIndex(b) })
    return keys
  }, [allCategoryKeys, allCategorySet, categoryMonthlyTotals, categorySort, customOrder, period, sheetIndex])

  // --- Handlers ---

  function toggleExpanded(category: string): void {
    setExpanded((cur) => { const n = new Set(cur); if (n.has(category)) n.delete(category); else n.add(category); return n })
  }

  function updateLocalLine(nextLine: BudgetLineItem): void {
    setLineItems((cur) => cur.map((l) => (l.id === nextLine.id ? nextLine : l)))
  }

  async function addLineItem(category: string): Promise<void> {
    const isNeed = needFilter === 'needs' ? true : needFilter === 'wants' ? false : inferLineIsNeed(category, '')
    const created = await window.api.createBudgetLineItem({ category, section: '', label: '', monthly_amount: 0, annual_amount: 0, notes: '', support_scope: 'none', is_need: isNeed })
    pushUndo({ type: 'create_line', lineId: created.id })
    setLineItems((cur) => [...cur.filter((l) => l.id !== created.id), created])
    setExpanded((cur) => new Set(cur).add(category))
    setEditingLineId(created.id)
    setEditingField('all')
  }

  function commitNewCategory(name: string): void {
    if (!name.trim()) { setNewCategoryDraft(null); return }
    const trimmed = name.trim()
    if (!userCategories.includes(trimmed) && !allCategorySet.has(trimmed)) setUserCategories((p) => [...p, trimmed])
    setNewCategoryDraft(null)
    setExpanded((p) => new Set(p).add(trimmed))
    setCategorySort('custom')
  }

  // --- Category edit mode ---

  function enterCategoryEditMode(): void {
    setCategoryEditMode(true)
    setExpanded(new Set())
  }

  function confirmCategoryEdits(): void {
    if (pendingDeletes.size > 0) {
      const batchActions: UndoAction[] = []
      for (const category of pendingDeletes) {
        const lines = lineItems.filter((l) => l.category === category && !isParentalGovLine(l))
        const linesData = lines.map(lineToPartial)
        lines.forEach((l) => void window.api.deleteBudgetLineItem(l.id))
        const wasBuiltIn = BUDGET_CATEGORY_ALLOWLIST.has(category)
        const wasCustom = userCategories.includes(category)
        if (wasBuiltIn) setHiddenCategories((p) => { const n = new Set(p); n.add(category); return n })
        setUserCategories((p) => p.filter((c) => c !== category))
        batchActions.push({ type: 'delete_category', category, lines: linesData, wasBuiltIn, wasCustom })
      }
      pushUndo({ type: 'batch', actions: batchActions })
      bumpDataVersion()
    }
    setPendingDeletes(new Set())
    setCategoryEditMode(false)
    setEditingCategoryName(null)
  }

  function revertCategoryEdits(): void {
    setPendingDeletes(new Set())
    setCategoryEditMode(false)
    setEditingCategoryName(null)
  }

  function startEditCategoryName(category: string): void {
    setEditingCategoryName(category)
    setCategoryNameDraft(category)
    setContextMenu(null)
  }

  async function commitCategoryRename(oldName: string): Promise<void> {
    const newName = categoryNameDraft.trim()
    setEditingCategoryName(null)
    if (!newName || newName === oldName) return
    const lines = lineItems.filter((l) => l.category === oldName)
    for (const l of lines) await window.api.updateBudgetLineItem(l.id, { category: newName })
    const wasBuiltIn = BUDGET_CATEGORY_ALLOWLIST.has(oldName)
    if (wasBuiltIn) setHiddenCategories((p) => { const n = new Set(p); n.add(oldName); return n })
    setUserCategories((p) => { const f = p.filter((c) => c !== oldName); if (!BUDGET_CATEGORY_ALLOWLIST.has(newName)) f.push(newName); return f })
    pushUndo({ type: 'rename_category', oldName, newName, wasBuiltIn })
    bumpDataVersion()
  }

  async function deleteCategoryImmediate(category: string): Promise<void> {
    setContextMenu(null)
    const lines = lineItems.filter((l) => l.category === category && !isParentalGovLine(l))
    const linesData = lines.map(lineToPartial)
    for (const l of lines) await window.api.deleteBudgetLineItem(l.id)
    const wasBuiltIn = BUDGET_CATEGORY_ALLOWLIST.has(category)
    const wasCustom = userCategories.includes(category)
    if (wasBuiltIn) setHiddenCategories((p) => { const n = new Set(p); n.add(category); return n })
    setUserCategories((p) => p.filter((c) => c !== category))
    pushUndo({ type: 'delete_category', category, lines: linesData, wasBuiltIn, wasCustom })
    bumpDataVersion()
  }

  // --- Drag-and-drop ---

  function startCategoryDrag(e: React.PointerEvent, category: string): void {
    if (categorySort !== 'custom' || categoryEditMode) return
    e.preventDefault()
    e.stopPropagation()
    const cats = sortedCategories
    const origIdx = cats.indexOf(category)
    if (origIdx < 0) return
    const rowMidpoints: number[] = []
    let draggedHeight = 48
    for (let i = 0; i < cats.length; i++) {
      const el = rowRefsMap.current.get(cats[i])
      if (el) { const r = el.getBoundingClientRect(); rowMidpoints.push(r.top + r.height / 2); if (i === origIdx) draggedHeight = r.height }
      else rowMidpoints.push(0)
    }
    dragRef.current = { category, origIdx, startClientY: e.clientY, deltaY: 0, draggedHeight, rowMidpoints }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
    const onMove = (ev: PointerEvent): void => { if (!dragRef.current) return; dragRef.current.deltaY = ev.clientY - dragRef.current.startClientY; setDragTick((t) => t + 1) }
    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      const ds = dragRef.current
      if (ds) {
        const targetIdx = computeDragTarget(ds, cats.length)
        if (ds.origIdx !== targetIdx) { const next = [...cats]; next.splice(ds.origIdx, 1); next.splice(targetIdx, 0, ds.category); setCustomOrder(next); setCategorySort('custom') }
        dragRef.current = null
        setDragTick((t) => t + 1)
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    setDragTick((t) => t + 1)
  }

  function getCategoryDragStyle(category: string, index: number): React.CSSProperties {
    const ds = dragRef.current
    if (!ds) return {}
    if (ds.category === category) {
      return { position: 'relative', zIndex: 50, transform: `translateY(${ds.deltaY}px) scale(1.02)`, boxShadow: '0 8px 32px -8px rgba(0,0,0,0.18), 0 4px 12px -4px rgba(0,0,0,0.08)', transition: 'box-shadow 150ms ease' }
    }
    const targetIdx = computeDragTarget(ds, sortedCategories.length)
    let shift = 0
    if (ds.origIdx < targetIdx && index > ds.origIdx && index <= targetIdx) shift = -ds.draggedHeight
    else if (ds.origIdx > targetIdx && index >= targetIdx && index < ds.origIdx) shift = ds.draggedHeight
    return { transform: shift ? `translateY(${shift}px)` : 'translateY(0)', transition: 'transform 250ms cubic-bezier(0.25, 1, 0.5, 1)' }
  }

  const isDragActive = dragRef.current !== null

  // --- Category border class for aid highlighting ---

  function categoryAidBorderClass(category: string): string {
    const hasP = aidFilters.has('parental') && categoriesWithParental.has(category)
    const hasG = aidFilters.has('government') && categoriesWithGov.has(category)
    if (hasP && hasG) return 'ring-1 ring-inset ring-orange-300 dark:ring-orange-500/60'
    if (hasP) return 'ring-1 ring-inset ring-orange-300 dark:ring-orange-500/60'
    if (hasG) return 'ring-1 ring-inset ring-amber-700/50 dark:ring-amber-500/50'
    return ''
  }

  // --- Render ---

  const budgetChat = getChat('expenses-budget')
  const chatFadeHeight = chatExpanded ? Math.min(budgetChat.height + 128, 680) : 96

  return (
    <div className="relative h-full overflow-hidden bg-white dark:bg-zinc-950">
      <div className="h-full overflow-y-auto px-4 py-6 pb-28 md:px-8">
        <div className="mb-4 md:hidden">
          <BudgetFilterRail needFilter={needFilter} onNeedFilter={setNeedFilter} />
        </div>

        <div className="md:grid md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-[auto_auto] md:items-start md:gap-x-4 md:gap-y-5">
          <div className="hidden md:col-start-1 md:row-start-2 md:block">
            <div className="sticky top-6 w-[7.5rem] pt-7">
              <BudgetFilterRail needFilter={needFilter} onNeedFilter={setNeedFilter} />
            </div>
          </div>

          <div className="mb-5 flex flex-wrap items-start justify-between gap-4 md:col-start-2 md:row-start-1 md:mb-0">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Budget</h1>
              <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Total</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-100">{formatCurrency(totalBudgetScaled)}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <div ref={sortRef} className="relative">
                  <button type="button" onClick={() => setSortOpen((v) => !v)} className="cursor-pointer rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                    Sort: {SORT_OPTIONS.find((o) => o.id === categorySort)?.label ?? 'Custom'}
                  </button>
                  {sortOpen && (
                    <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[11.5rem] rounded-lg border border-zinc-200/80 bg-white p-1 shadow-[0_4px_12px_rgba(0,0,0,0.12)] dark:border-zinc-600 dark:bg-zinc-900">
                      {SORT_OPTIONS.map((opt) => (
                        <button key={opt.id} type="button" role="menuitem" onClick={() => { setCategorySort(opt.id); setSortOpen(false) }} className={`flex w-full rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors ${categorySort === opt.id ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-950'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Budget period">
                  <SegmentedButton active={period === 'week'} onClick={() => setPeriod('week')}>Week</SegmentedButton>
                  <SegmentedButton active={period === 'month'} onClick={() => setPeriod('month')}>Month</SegmentedButton>
                  <SegmentedButton active={period === 'year'} onClick={() => setPeriod('year')}>Year</SegmentedButton>
                </div>
              </div>
              <div className="inline-flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="Aid filters">
                <AidFilterButton active={aidFilters.has('parental')} color="orange" onClick={() => toggleAidFilter('parental')}>
                  <ParentalIcon /> Parental
                </AidFilterButton>
                <AidFilterButton active={aidFilters.has('government')} color="brown" onClick={() => toggleAidFilter('government')}>
                  <GovIcon /> Gov
                </AidFilterButton>
              </div>
            </div>
          </div>

          <div className="min-w-0 md:col-start-2 md:row-start-2">
            {/* Edit categories + undo buttons */}
            <div className="mb-1 flex justify-end">
              <div className="flex items-center gap-1">
                {hasUndoActions && (
                  <button type="button" onClick={() => void undoLastAction()} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label="Undo (⌘Z)"><UndoIcon /></button>
                )}
                {categoryEditMode ? (
                  <button type="button" onClick={confirmCategoryEdits} className="flex h-6 w-6 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30" aria-label="Confirm changes"><CheckIcon /></button>
                ) : (
                  <button type="button" onClick={enterCategoryEditMode} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label="Edit categories"><PencilIcon /></button>
                )}
              </div>
            </div>

            <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <div className="grid grid-cols-[24px_minmax(0,1fr)_24px_minmax(64px,76px)_minmax(96px,120px)_auto] items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400 md:grid-cols-[28px_minmax(0,1fr)_24px_minmax(64px,76px)_minmax(96px,120px)_auto]">
                <div aria-hidden="true" />
                <div>Category</div>
                <div aria-hidden="true" />
                <div className="text-center">Type</div>
                <div className="text-right">Amount</div>
                <div className="w-[56px]" aria-hidden="true" />
              </div>
              {sortedCategories.map((category, idx) => {
                const isExpanded = expanded.has(category) && !categoryEditMode
                const displayTotal = scaleMonthlyAmountToPeriod(categoryMonthlyTotals.get(category) ?? 0, period)
                const visibleLines = linesByCategory.get(category) ?? []
                const catKind = categoryKindByCategory.get(category) ?? 'empty'
                const isDragging = dragRef.current?.category === category
                const isMarkedForDelete = pendingDeletes.has(category)
                const isEditingName = editingCategoryName === category
                const aidBorder = categoryAidBorderClass(category)
                return (
                  <div
                    key={category}
                    ref={(el) => { if (el) rowRefsMap.current.set(category, el); else rowRefsMap.current.delete(category) }}
                    style={getCategoryDragStyle(category, idx)}
                    className={`border-b border-zinc-100 last:border-b-0 dark:border-zinc-800 ${isDragging ? 'rounded-xl bg-white overflow-hidden dark:bg-zinc-900' : isDragActive ? 'rounded-md' : ''} ${isMarkedForDelete ? 'opacity-50' : ''} ${aidBorder}`}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ category, x: e.clientX, y: e.clientY }) }}
                  >
                    <div className="flex items-stretch">
                      <div
                        className={`flex w-7 shrink-0 items-center justify-center border-r border-transparent text-zinc-300 dark:text-zinc-600 ${categorySort === 'custom' && !categoryEditMode ? 'cursor-grab touch-none active:cursor-grabbing hover:text-zinc-500 dark:hover:text-zinc-400' : 'opacity-30'}`}
                        onPointerDown={(e) => startCategoryDrag(e, category)}
                      >
                        <GripIcon />
                      </div>
                      {categoryEditMode ? (
                        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_24px_minmax(64px,76px)_minmax(96px,120px)_auto] items-center gap-2 px-2 py-3 text-sm">
                          {isEditingName ? (
                            <input
                              autoFocus
                              value={categoryNameDraft}
                              onChange={(e) => setCategoryNameDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitCategoryRename(category) } if (e.key === 'Escape') { e.preventDefault(); setEditingCategoryName(null) } }}
                              onBlur={() => void commitCategoryRename(category)}
                              className="h-7 min-w-0 rounded border border-zinc-300 bg-white px-1.5 font-semibold text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                            />
                          ) : (
                            <span className={`min-w-0 truncate font-semibold text-zinc-900 dark:text-zinc-100 ${isMarkedForDelete ? 'line-through' : ''}`}>{category}</span>
                          )}
                          <span />
                          <span className="flex justify-center"><NeedTypeChip kind={catKind} /></span>
                          <span className="text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{formatCurrency(displayTotal)}</span>
                          <div className="flex shrink-0 justify-end gap-1">
                            {isMarkedForDelete ? (
                              <button type="button" onClick={() => setPendingDeletes((p) => { const n = new Set(p); n.delete(category); return n })} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200" aria-label="Undo delete"><UndoIcon /></button>
                            ) : (
                              <>
                                <button type="button" onClick={() => startEditCategoryName(category)} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200" aria-label="Edit category name"><PencilIcon /></button>
                                <button type="button" onClick={() => setPendingDeletes((p) => new Set(p).add(category))} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-300" aria-label="Delete category"><XIcon /></button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { if (!isEditingName) toggleExpanded(category) }}
                          className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_24px_minmax(64px,76px)_minmax(96px,120px)_auto] items-center gap-2 px-2 py-3 text-left text-sm transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-950/40"
                          aria-expanded={isExpanded}
                        >
                          {isEditingName ? (
                            <input
                              autoFocus
                              value={categoryNameDraft}
                              onChange={(e) => setCategoryNameDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitCategoryRename(category) } if (e.key === 'Escape') { e.preventDefault(); setEditingCategoryName(null) } }}
                              onBlur={() => void commitCategoryRename(category)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 min-w-0 rounded border border-zinc-300 bg-white px-1.5 font-semibold text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                            />
                          ) : (
                            <span className="min-w-0 truncate font-semibold text-zinc-900 dark:text-zinc-100">{category}</span>
                          )}
                          <span />
                          <span className="flex justify-center"><NeedTypeChip kind={catKind} /></span>
                          <span className="text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{formatCurrency(displayTotal)}</span>
                          <span className="flex w-[56px] items-center justify-end gap-1 text-zinc-400 dark:text-zinc-500">
                            {isEditingName && (
                              <button type="button" onClick={(e) => { e.stopPropagation(); void commitCategoryRename(category) }} className="flex h-6 w-6 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30" aria-label="Confirm edit"><CheckIcon /></button>
                            )}
                            <ChevronIcon expanded={isExpanded} />
                          </span>
                        </button>
                      )}
                    </div>
                    {isExpanded ? (
                      <div className="border-t border-zinc-100 bg-zinc-50/50 py-1 dark:border-zinc-800 dark:bg-zinc-950/25">
                        {visibleLines.length ? (
                          visibleLines.map((line) => (
                            <BudgetLineRow
                              key={line.id}
                              line={line}
                              period={period}
                              aidFilters={aidFilters}
                              activeField={editingLineId === line.id ? editingField : null}
                              onActivateField={(field) => { setEditingLineId(line.id); setEditingField(field) }}
                              onDeactivate={() => { setEditingLineId(null); setEditingField(null) }}
                              onLineChanged={(next) => { updateLocalLine(next); bumpDataVersion() }}
                              onDelete={() => { setEditingLineId(null); setEditingField(null); bumpDataVersion() }}
                              onPushUndo={pushUndo}
                            />
                          ))
                        ) : (
                          <div className="ml-6 px-4 py-3 text-[12px] text-zinc-500 dark:text-zinc-400">
                            {needFilter === 'all' ? 'No line items yet.' : `No ${needFilter === 'needs' ? 'need' : 'want'} lines in this category.`}
                          </div>
                        )}
                        <div className="ml-6 flex justify-start px-4 pb-2 pt-1">
                          <button type="button" onClick={() => void addLineItem(category)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 active:scale-[0.97] dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100" aria-label={`Add line item in ${category}`}>
                            <AddLinePlusIcon />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {newCategoryDraft !== null ? (
                <NewCategoryRow onCommit={commitNewCategory} onCancel={() => setNewCategoryDraft(null)} />
              ) : (
                <div className="flex items-center px-2 py-2">
                  <button type="button" onClick={() => setNewCategoryDraft('')} className="ml-[1.75rem] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 active:scale-[0.97] dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100" aria-label="Add category">
                    <AddLinePlusIcon />
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu ? (
        <div
          className="fixed z-[100] overflow-hidden rounded-lg border border-zinc-200/80 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.confirming ? (
            <>
              <button type="button" onClick={() => { void deleteCategoryImmediate(contextMenu.category) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30">
                Delete
              </button>
              <button type="button" onClick={() => setContextMenu(null)} className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => { startEditCategoryName(contextMenu.category); setContextMenu(null) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800">
                <PencilIcon /> Edit
              </button>
              <button type="button" onClick={() => setContextMenu((m) => m ? { ...m, confirming: true } : null)} className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30">
                <XIcon /> Delete
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-8 bottom-4 z-20">
        <div
          aria-hidden="true"
          style={{ height: chatFadeHeight }}
          className="absolute inset-x-0 bottom-0 -z-10 bg-gradient-to-t from-white via-white/95 to-transparent transition-[height] duration-200 dark:from-zinc-950 dark:via-zinc-950/95"
        />
        <div className="pointer-events-auto">
          <ChatBox pageId="expenses-budget" fullWidth onExpandedChange={setChatExpanded} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New category row
// ---------------------------------------------------------------------------

function NewCategoryRow({ onCommit, onCancel }: { onCommit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); name.trim() ? onCommit(name.trim()) : onCancel() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }
  function handleBlur() { name.trim() ? onCommit(name.trim()) : onCancel() }
  return (
    <div className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
      <div className="flex items-stretch">
        <div className="flex w-7 shrink-0 items-center justify-center text-zinc-300 opacity-30 dark:text-zinc-600"><GripIcon /></div>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_24px_minmax(64px,76px)_minmax(96px,120px)_auto] items-center gap-2 px-2 py-3 text-sm">
          <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={handleKeyDown} onBlur={handleBlur} placeholder="Category name" className="h-7 min-w-0 rounded border border-zinc-300 bg-white px-1.5 font-semibold text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
          <span />
          <span className="flex justify-center"><NeedTypeChip kind="need" /></span>
          <span className="text-right font-medium tabular-nums text-zinc-400 dark:text-zinc-500">$0.00</span>
          <span className="w-[56px]" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Budget line item row
// ---------------------------------------------------------------------------

function BudgetLineRow({ line, period, aidFilters, activeField, onActivateField, onDeactivate, onLineChanged, onDelete, onPushUndo }: {
  line: BudgetLineItem; period: BudgetDisplayPeriod; aidFilters: Set<string>; activeField: LineEditField | null
  onActivateField: (field: LineEditField) => void; onDeactivate: () => void; onLineChanged: (nextLine: BudgetLineItem) => void; onDelete: () => void; onPushUndo: (action: UndoAction) => void
}) {
  const [labelDraft, setLabelDraft] = useState(line.label)
  const [amountDraft, setAmountDraft] = useState(formatCurrency(line.monthly_amount))
  const rowRef = useRef<HTMLDivElement | null>(null)
  const labelInputRef = useRef<HTMLInputElement | null>(null)
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const savingRef = useRef(false)
  const commitRef = useRef<() => void>(() => {})
  const shownAmount = scaleMonthlyAmountToPeriod(line.monthly_amount, period)
  const isLabelEditing = activeField === 'label' || activeField === 'all'
  const isAmountEditing = activeField === 'amount' || activeField === 'all'
  const isAnyEditing = activeField !== null

  const isAidHighlighted = (aidFilters.has('parental') && line.support_scope === 'parental') || (aidFilters.has('government') && line.support_scope === 'government')
  const aidRingClass = isAidHighlighted
    ? line.support_scope === 'parental' ? 'ring-1 ring-inset ring-orange-300 rounded-md dark:ring-orange-500/60' : 'ring-1 ring-inset ring-amber-700/50 rounded-md dark:ring-amber-500/50'
    : ''

  useEffect(() => { if (activeField) return; setLabelDraft(line.label); setAmountDraft(formatCurrency(line.monthly_amount)) }, [activeField, line])
  useEffect(() => { if (!activeField) return; const input = activeField === 'amount' ? amountInputRef.current : labelInputRef.current; window.requestAnimationFrame(() => { input?.focus(); input?.select() }) }, [activeField])

  const saveValues = useCallback(async (): Promise<void> => {
    if (savingRef.current) return
    savingRef.current = true
    try {
      const m = parseCurrencyInput(amountDraft)
      const prevData: Partial<BudgetLineItem> = { label: line.label, monthly_amount: line.monthly_amount, annual_amount: line.annual_amount }
      const next = await window.api.updateBudgetLineItem(line.id, { label: labelDraft.trim(), monthly_amount: m, annual_amount: m * 12 })
      if (labelDraft.trim() !== line.label || m !== line.monthly_amount) {
        onPushUndo({ type: 'update_line', lineId: line.id, prev: prevData })
      }
      onLineChanged(next)
    } finally { savingRef.current = false }
  }, [amountDraft, labelDraft, line, onLineChanged, onPushUndo])

  const commitAndDeactivate = useCallback((): void => { void saveValues(); onDeactivate() }, [saveValues, onDeactivate])
  commitRef.current = commitAndDeactivate

  useEffect(() => {
    if (!activeField) return
    const handler = (event: PointerEvent): void => { if (rowRef.current?.contains(event.target as Node | null)) return; commitRef.current() }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [activeField])

  async function toggleNeed(): Promise<void> {
    onPushUndo({ type: 'update_line', lineId: line.id, prev: { is_need: line.is_need } })
    const next = await window.api.updateBudgetLineItem(line.id, { is_need: !line.is_need })
    onLineChanged(next)
  }

  async function cycleSupportScope(): Promise<void> {
    const nextScope = nextSupportScope(line.support_scope)
    onPushUndo({ type: 'update_line', lineId: line.id, prev: { support_scope: line.support_scope } })
    const next = await window.api.updateBudgetLineItem(line.id, { support_scope: nextScope })
    onLineChanged(next)
  }

  async function deleteLine(): Promise<void> {
    onPushUndo({ type: 'delete_line', data: lineToPartial(line) })
    await window.api.deleteBudgetLineItem(line.id)
    onDelete()
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>): void { if (!activeField) return; if (event.currentTarget.contains(event.relatedTarget as Node | null)) return; commitAndDeactivate() }

  function handleEscape(): void {
    if (!line.label && line.monthly_amount === 0) {
      void deleteLine()
    } else {
      setLabelDraft(line.label)
      setAmountDraft(formatCurrency(line.monthly_amount))
      onDeactivate()
    }
  }

  function handleLabelKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') { e.preventDefault(); commitAndDeactivate() }
    if (e.key === 'Tab' && activeField === 'all' && !e.shiftKey) { e.preventDefault(); amountInputRef.current?.focus(); amountInputRef.current?.select() }
    if (e.key === 'Escape') { e.preventDefault(); handleEscape() }
  }
  function handleAmountKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') { e.preventDefault(); commitAndDeactivate() }
    if (e.key === 'Escape') { e.preventDefault(); handleEscape() }
  }

  return (
    <div ref={rowRef} onBlur={handleBlur} className={`ml-6 grid h-10 grid-cols-[minmax(0,1fr)_24px_minmax(76px,92px)_minmax(72px,96px)_auto] items-center gap-2 border-b border-zinc-100/80 px-4 text-sm last:border-b-0 dark:border-zinc-800/80 ${aidRingClass}`}>
      {isLabelEditing ? (
        <input ref={labelInputRef} value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} onKeyDown={handleLabelKeyDown} placeholder="Line item" className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800" />
      ) : (
        <button type="button" onClick={() => onActivateField('label')} className="flex h-7 min-w-0 items-center truncate text-left font-medium text-zinc-700 dark:text-zinc-200">
          {line.label || <span className="text-zinc-400 dark:text-zinc-500">Line item</span>}
        </button>
      )}
      {/* Support scope icon / toggle */}
      <div className="flex items-center justify-center">
        {isAnyEditing ? (
          <button type="button" onClick={() => void cycleSupportScope()} className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" aria-label="Toggle aid type">
            <SupportScopeIndicator scope={line.support_scope} />
          </button>
        ) : (
          line.support_scope !== 'none' ? <SupportScopeIndicator scope={line.support_scope} /> : null
        )}
      </div>
      <div className="flex justify-center">
        <button type="button" onClick={() => void toggleNeed()} aria-label={line.is_need ? 'Switch to want' : 'Switch to need'}><NeedTypeChip kind={line.is_need ? 'need' : 'wants'} /></button>
      </div>
      {isAmountEditing ? (
        <div className="flex h-7 items-center gap-1">
          <span className="shrink-0 text-[8px] font-medium uppercase text-zinc-400">Mo.</span>
          <input ref={amountInputRef} value={amountDraft} onChange={(e) => setAmountDraft(e.target.value)} onKeyDown={handleAmountKeyDown} placeholder="$0.00" className="h-7 w-full min-w-0 rounded border border-zinc-200 bg-white px-1.5 text-right text-sm tabular-nums text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800" />
        </div>
      ) : (
        <button type="button" onClick={() => onActivateField('amount')} className={`flex h-7 min-w-0 items-center justify-end tabular-nums ${isAidHighlighted ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-200'}`}>{formatCurrency(shownAmount)}</button>
      )}
      <div className="flex shrink-0 justify-end gap-1">
        {isAnyEditing ? (
          <button type="button" onClick={commitAndDeactivate} className="flex h-6 w-6 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-white dark:text-emerald-300 dark:hover:bg-zinc-900" aria-label="Save"><CheckIcon /></button>
        ) : (
          <button type="button" onClick={() => onActivateField('all')} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200" aria-label={`Edit ${line.label || 'line item'}`}><PencilIcon /></button>
        )}
        <button type="button" onClick={() => void deleteLine()} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-300" aria-label={`Delete ${line.label || 'line item'}`}><XIcon /></button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Support scope indicator (dash / icon)
// ---------------------------------------------------------------------------

function SupportScopeIndicator({ scope }: { scope: BudgetSupportScope }) {
  if (scope === 'parental') return <ParentalIcon />
  if (scope === 'government') return <GovIcon />
  return <span className="text-[10px] text-zinc-300 dark:text-zinc-600">—</span>
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function GripIcon() {
  return (<svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" className="opacity-70" aria-hidden="true"><circle cx="3" cy="2.5" r="1" /><circle cx="9" cy="2.5" r="1" /><circle cx="3" cy="7" r="1" /><circle cx="9" cy="7" r="1" /><circle cx="3" cy="11.5" r="1" /><circle cx="9" cy="11.5" r="1" /></svg>)
}
function AddLinePlusIcon() {
  return (<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>)
}
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={expanded ? 'M5 12.5 L10 7.5 L15 12.5' : 'M7.5 5 L12.5 10 L7.5 15'} /></svg>)
}
function PencilIcon() {
  return (<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.8 3.1 12.9 6.2M2.8 10.1 10.7 2.2a1.5 1.5 0 0 1 2.1 0l1 1a1.5 1.5 0 0 1 0 2.1L5.9 13.2l-3.6.6.5-3.7Z" /></svg>)
}
function XIcon() {
  return (<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m3 3 6 6M9 3 3 9" /></svg>)
}
function CheckIcon() {
  return (<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7.3 2.6 2.6L11 4.1" /></svg>)
}
function UndoIcon() {
  return (<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h6a4 4 0 0 1 0 8H7" /><path d="M6 4 3 7l3 3" /></svg>)
}
function ParentalIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-orange-500 dark:text-orange-400">
      <circle cx="4" cy="2.2" r="1.4" />
      <path d="M1.5 9c0-1.8 1.2-2.8 2.5-2.8s2.5 1 2.5 2.8" />
      <circle cx="10" cy="2.2" r="1.4" />
      <path d="M7.5 9c0-1.8 1.2-2.8 2.5-2.8s2.5 1 2.5 2.8" />
    </svg>
  )
}
function GovIcon() {
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-amber-700 dark:text-amber-500">
      <path d="M6 0.8 L1.5 3.5 H10.5 Z" />
      <line x1="1.5" y1="9" x2="10.5" y2="9" />
      <line x1="3" y1="3.5" x2="3" y2="9" />
      <line x1="5" y1="3.5" x2="5" y2="9" />
      <line x1="7" y1="3.5" x2="7" y2="9" />
      <line x1="9" y1="3.5" x2="9" y2="9" />
    </svg>
  )
}
