import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import type { BudgetItem, ExpectedIncomeEntry, IncomeEntry, IncomeKind, IncomeTaxSettings } from '../../../types/money'
import { useAppContext } from '../context/AppContext'
import { useDateFormat } from '../context/DateFormatContext'
import { getBudgetAmount, getStoredBudgetType } from '../lib/budget'
import { formatCurrency, parseCurrencyInput } from '../lib/currency'
import { monthBounds } from '../lib/dates'
import { calculateIncomeTaxes, groupActualIncomeByMonth } from '../lib/income'
import { ChatBox } from './ChatBox'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const INCOME_TYPES = ['Snappr', 'Thumbtack', 'Upwork', 'Stimsonphoto'] as const
const INCOME_KIND_OPTIONS: Array<{ value: IncomeKind; label: string; detail: string }> = [
  { value: 'w2', label: 'W-2', detail: 'Payroll job' },
  { value: 'self_employment', label: 'Self-employed', detail: '1099 or freelance' },
  { value: 'other', label: 'Other', detail: 'Not payroll taxed here' }
]
type IncomeTypeFilter = (typeof INCOME_TYPES)[number]
type ExplanationPoint = { label: string; value: string }
type Explanation = {
  title: string
  summary: string
  calculation: string
  points: ExplanationPoint[]
  x: number
  y: number
}

export function IncomeExpected() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const [entries, setEntries] = useState<ExpectedIncomeEntry[]>([])
  const [settings, setSettings] = useState<IncomeTaxSettings | null>(null)
  const [budget, setBudget] = useState<BudgetItem[]>([])
  const [explanation, setExplanation] = useState<Explanation | null>(null)

  function reload(): void {
    Promise.all([
      window.api.getExpectedIncomeEntries(),
      window.api.getIncomeTaxSettings(),
      window.api.getBudgetItems(getStoredBudgetType())
    ]).then(([nextEntries, nextSettings, nextBudget]) => {
      setEntries(nextEntries)
      setSettings(nextSettings)
      setBudget(nextBudget)
    })
  }

  useEffect(reload, [dataVersion])

  const tax = settings ? calculateIncomeTaxes(entries, settings) : null
  const needs = budget.filter((item) => item.is_need).reduce((sum, item) => sum + getBudgetAmount(item, getStoredBudgetType()), 0)
  const wants = budget.filter((item) => !item.is_need).reduce((sum, item) => sum + getBudgetAmount(item, getStoredBudgetType()), 0)
  const afterTaxMonthly = tax ? tax.afterTaxIncome / 12 : 0

  async function updateEntry(id: number, data: Partial<ExpectedIncomeEntry>): Promise<void> {
    await window.api.updateExpectedIncomeEntry(id, data)
    reload()
    bumpDataVersion()
  }

  async function updateSettings(data: Partial<IncomeTaxSettings>): Promise<void> {
    const next = await window.api.updateIncomeTaxSettings(data)
    setSettings(next)
    bumpDataVersion()
  }

  async function addIncomeSource(): Promise<void> {
    await window.api.createExpectedIncomeEntry({
      name: 'New Income Source',
      notes: '',
      annual_amount: 0,
      income_kind: 'other'
    })
    reload()
    bumpDataVersion()
  }

  function openExplanation(event: MouseEvent, next: Omit<Explanation, 'x' | 'y'>): void {
    event.preventDefault()
    setExplanation({ ...next, x: event.clientX, y: event.clientY })
  }

  return (
    <div className="relative h-full overflow-y-auto px-8 py-8" onClick={() => explanation && setExplanation(null)}>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Income Expected</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Expected gross income, tax estimate, and after-tax room against your expense plan.</p>
      </div>

      {tax ? (
        <div className="mb-5 grid grid-cols-4 gap-3">
          <StatCard label="Gross annual" value={formatCurrency(tax.grossIncome)} />
          <StatCard label="After tax annual" value={formatCurrency(tax.afterTaxIncome)} accent="text-emerald-600" />
          <StatCard label="Total taxes" value={formatCurrency(tax.totalTaxes)} accent="text-red-600" />
          <StatCard label="Effective rate" value={`${(tax.effectiveRate * 100).toFixed(1)}%`} />
        </div>
      ) : null}

      {tax ? (
        <section className="mb-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Quick View</h2>
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">Monthly run rate</div>
          </div>
          <div className="grid grid-cols-6 gap-3 text-sm">
            <QuickMetric label="Income / mo" value={formatCurrency(tax.grossIncome / 12)} />
            <QuickMetric label="Tax reserve / mo" value={formatCurrency(tax.totalTaxes / 12)} accent="text-red-600" />
            <QuickMetric label="After tax / mo" value={formatCurrency(afterTaxMonthly)} />
            <QuickMetric label="Needs / mo" value={formatCurrency(needs)} />
            <QuickMetric label="Wants / mo" value={formatCurrency(wants)} />
            <QuickMetric label="Left over / mo" value={formatCurrency(afterTaxMonthly - needs - wants)} accent={afterTaxMonthly - needs - wants >= 0 ? 'text-emerald-600' : 'text-red-600'} />
          </div>
        </section>
      ) : null}

      <section className="mb-5 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Income Sources</h2>
            <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">Annual and monthly edits stay linked.</p>
          </div>
          <button type="button" onClick={() => void addIncomeSource()} className="rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-950">Add Source</button>
        </div>
        <div className="grid grid-cols-[1fr_142px_142px_174px_86px] gap-3 border-b border-zinc-100 bg-zinc-50/60 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50">
          <div>Source</div>
          <div className="text-right">Annual</div>
          <div className="text-right">Monthly</div>
          <div>Tax type</div>
          <div className="text-right">Remove</div>
        </div>
        {entries.map((entry) => (
          <ExpectedIncomeRow key={entry.id} entry={entry} onUpdate={updateEntry} onDelete={async () => { await window.api.deleteExpectedIncomeEntry(entry.id); reload(); bumpDataVersion(); }} />
        ))}
      </section>

      {settings && tax ? (
        <section className="grid grid-cols-[1fr_1fr] gap-5">
          <TaxInputs settings={settings} onUpdate={updateSettings} onExplain={openExplanation} />
          <TaxResults result={tax} settings={settings} needs={needs} wants={wants} onExplain={openExplanation} />
        </section>
      ) : null}
      {explanation ? <ExplanationPopover explanation={explanation} onClose={() => setExplanation(null)} /> : null}
    </div>
  )
}

export function IncomeActual() {
  const { dataVersion, bumpDataVersion } = useAppContext()
  const [entries, setEntries] = useState<IncomeEntry[]>([])
  const [selectedTypes, setSelectedTypes] = useState<IncomeTypeFilter[]>([])
  const { start, end } = monthBounds()

  useEffect(() => {
    window.api.getIncomeEntries().then(setEntries)
  }, [dataVersion])

  const monthEntries = useMemo(
    () => entries.filter((entry) => entry.date >= start && entry.date <= end),
    [end, entries, start]
  )
  const visibleEntries = useMemo(
    () =>
      monthEntries.filter((entry) => {
        if (selectedTypes.length === 0) return true
        return selectedTypes.includes(getIncomeType(entry))
      }),
    [monthEntries, selectedTypes]
  )
  const monthTotal = monthEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const visibleTotal = visibleEntries.reduce((sum, entry) => sum + entry.amount, 0)

  function toggleType(type: IncomeTypeFilter): void {
    setSelectedTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type])
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-8 py-8">
      <div className="shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Income Actual</h1>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title={selectedTypes.length ? `${visibleEntries.length} of ${monthEntries.length} shown` : `${monthEntries.length} shown`}>
            {visibleEntries.length}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Logged income from shoots, lessons, and other paid work.</p>
      </div>
      <div className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Total income this month</div>
        <div className="mt-2 text-3xl font-semibold text-emerald-700 dark:text-emerald-300">{formatCurrency(monthTotal)}</div>
        {selectedTypes.length ? <div className="mt-1 text-[12px] font-medium text-emerald-700/80 dark:text-emerald-300/80">Filtered: {formatCurrency(visibleTotal)}</div> : null}
      </div>
      <IncomeTypeFilterBar selected={selectedTypes} onToggle={toggleType} onClear={() => setSelectedTypes([])} />
      <div className="flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-950/40">
        {monthEntries.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Paste a photo shoot summary in chat to add income</div>
        ) : visibleEntries.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No income matches the selected filters.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {visibleEntries.map((entry) => <IncomeCard key={entry.id} entry={entry} onChanged={bumpDataVersion} />)}
          </div>
        )}
      </div>
      <ChatBox pageId="income-actual" fullWidth />
    </div>
  )
}

export function IncomeSummary() {
  const { dataVersion } = useAppContext()
  const [expected, setExpected] = useState<ExpectedIncomeEntry[]>([])
  const [actual, setActual] = useState<IncomeEntry[]>([])
  const year = new Date().getFullYear()

  useEffect(() => {
    Promise.all([window.api.getExpectedIncomeEntries(), window.api.getIncomeEntries()]).then(([nextExpected, nextActual]) => {
      setExpected(nextExpected)
      setActual(nextActual)
    })
  }, [dataVersion])

  const expectedAnnual = expected.reduce((sum, entry) => sum + entry.annual_amount, 0)
  const expectedMonthly = expectedAnnual / 12
  const actualByMonth = groupActualIncomeByMonth(actual, year)
  const actualYtd = actualByMonth.reduce((sum, value) => sum + value, 0)
  const elapsedMonths = new Date().getMonth() + 1
  const expectedYtd = expectedMonthly * elapsedMonths

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Income Summary</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Expected income compared to actual logged income.</p>
      </div>
      <div className="mb-5 grid grid-cols-4 gap-3">
        <StatCard label="Expected YTD" value={formatCurrency(expectedYtd)} />
        <StatCard label="Actual YTD" value={formatCurrency(actualYtd)} accent="text-emerald-600" />
        <StatCard label="YTD variance" value={formatCurrency(actualYtd - expectedYtd)} accent={actualYtd >= expectedYtd ? 'text-emerald-600' : 'text-red-600'} />
        <StatCard label="Expected monthly" value={formatCurrency(expectedMonthly)} />
      </div>
      <section className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Metric</th>
              {MONTH_LABELS.map((month) => (
                <th key={month} className="px-4 py-3 text-right font-medium text-zinc-500">{month}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SummaryRow label="Expected" values={MONTH_LABELS.map(() => expectedMonthly)} />
            <SummaryRow label="Actual" values={actualByMonth} accent="text-emerald-700 dark:text-emerald-300" />
            <SummaryRow label="Difference" values={actualByMonth.map((value) => value - expectedMonthly)} variance />
          </tbody>
        </table>
      </section>
    </div>
  )
}

function ExpectedIncomeRow({ entry, onUpdate, onDelete }: { entry: ExpectedIncomeEntry; onUpdate: (id: number, data: Partial<ExpectedIncomeEntry>) => Promise<void>; onDelete: () => Promise<void> }) {
  const monthlyAmount = entry.annual_amount / 12

  return (
    <div className="grid grid-cols-[1fr_142px_142px_174px_86px] items-center gap-3 border-b border-zinc-100 px-4 py-3 text-sm last:border-b-0 dark:border-zinc-800">
      <div className="min-w-0">
        <EditablePlain value={entry.name} onSave={(value) => onUpdate(entry.id, { name: value })} className="font-medium text-zinc-900 dark:text-zinc-100" />
        <EditablePlain value={entry.notes} onSave={(value) => onUpdate(entry.id, { notes: value })} className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400" fallback="No notes" />
      </div>
      <EditablePlain value={formatCurrency(entry.annual_amount)} align="right" onSave={(value) => onUpdate(entry.id, { annual_amount: parseCurrencyInput(value) })} />
      <EditablePlain value={formatCurrency(monthlyAmount)} align="right" onSave={(value) => onUpdate(entry.id, { annual_amount: parseCurrencyInput(value) * 12 })} className="text-zinc-600 dark:text-zinc-300" />
      <IncomeKindMenu value={entry.income_kind} onChange={(value) => onUpdate(entry.id, { income_kind: value })} />
      <button type="button" onClick={() => void onDelete()} className="justify-self-end rounded-full px-2 py-1 text-[12px] font-medium text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-300">Delete</button>
    </div>
  )
}

function IncomeKindMenu({ value, onChange }: { value: IncomeKind; onChange: (value: IncomeKind) => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const selected = INCOME_KIND_OPTIONS.find((option) => option.value === value) ?? INCOME_KIND_OPTIONS[2]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-left text-sm shadow-sm transition-colors hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600"
      >
        <span>
          <span className="block font-medium text-zinc-800 dark:text-zinc-100">{selected.label}</span>
          <span className="block text-[11px] text-zinc-400">{selected.detail}</span>
        </span>
        <ChevronIcon direction={open ? 'up' : 'down'} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-zinc-200 bg-white/95 p-1 shadow-xl shadow-zinc-900/10 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
          {INCOME_KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setOpen(false)
                void onChange(option.value)
              }}
              className={`block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                value === option.value
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="block text-[12px] font-medium">{option.label}</span>
              <span className={`block text-[11px] ${value === option.value ? 'text-white/70 dark:text-zinc-600' : 'text-zinc-400'}`}>{option.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TaxInputs({
  settings,
  onUpdate,
  onExplain
}: {
  settings: IncomeTaxSettings
  onUpdate: (data: Partial<IncomeTaxSettings>) => Promise<void>
  onExplain: (event: MouseEvent, explanation: Omit<Explanation, 'x' | 'y'>) => void
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Editable Tax Assumptions</h2>
        <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">These are saved assumptions used by the calculation rows.</p>
      </div>
      <div className="space-y-2 text-sm">
        <TaxInput label="401k / IRA contribution" value={settings.retirement_contribution} onSave={(value) => onUpdate({ retirement_contribution: value })} onExplain={(event) => onExplain(event, inputExplanation('401k / IRA contribution', 'Pre-tax retirement contributions reduce the federal AGI estimate used here.', settings.retirement_contribution))} />
        <TaxInput label="Above-the-line deductions" value={settings.above_line_deductions} onSave={(value) => onUpdate({ above_line_deductions: value })} onExplain={(event) => onExplain(event, inputExplanation('Above-the-line deductions', 'Additional deductions subtracted before taxable income is calculated.', settings.above_line_deductions))} />
        <TaxInput label="Federal standard deduction" value={settings.federal_standard_deduction} onSave={(value) => onUpdate({ federal_standard_deduction: value })} onExplain={(event) => onExplain(event, inputExplanation('Federal standard deduction', 'Deduction subtracted from federal AGI to estimate federal taxable income.', settings.federal_standard_deduction))} />
        <TaxInput label="CA standard deduction" value={settings.ca_standard_deduction} onSave={(value) => onUpdate({ ca_standard_deduction: value })} onExplain={(event) => onExplain(event, inputExplanation('CA standard deduction', 'Deduction subtracted from federal AGI for the California taxable estimate.', settings.ca_standard_deduction))} />
        <TaxInput label="CA bracket adjustment" value={settings.ca_bracket_adjustment} onSave={(value) => onUpdate({ ca_bracket_adjustment: value })} onExplain={(event) => onExplain(event, inputExplanation('CA bracket adjustment', 'Adjustment applied before running the California bracket estimate.', settings.ca_bracket_adjustment))} />
        <TaxInput label="Social Security wage base" value={settings.social_security_wage_base} onSave={(value) => onUpdate({ social_security_wage_base: value })} onExplain={(event) => onExplain(event, inputExplanation('Social Security wage base', 'Maximum W-2 wage amount subject to Social Security tax in this estimate.', settings.social_security_wage_base))} />
      </div>
    </section>
  )
}

function TaxResults({
  result,
  settings,
  needs,
  wants,
  onExplain
}: {
  result: ReturnType<typeof calculateIncomeTaxes>
  settings: IncomeTaxSettings
  needs: number
  wants: number
  onExplain: (event: MouseEvent, explanation: Omit<Explanation, 'x' | 'y'>) => void
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tax Calculation</h2>
        <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">Gross income flows through deductions, taxable income, payroll tax, and take-home.</p>
      </div>
      <div className="space-y-4 text-sm">
        <TaxGroup title="Income base">
          <Readout label="Gross income" value={formatCurrency(result.grossIncome)} onExplain={(event) => onExplain(event, taxExplanation('grossIncome', result, settings, needs, wants))} />
          <Readout label="W-2 income" value={formatCurrency(result.w2Income)} onExplain={(event) => onExplain(event, taxExplanation('w2Income', result, settings, needs, wants))} />
          <Readout label="Self-employment income" value={formatCurrency(result.selfEmploymentIncome)} onExplain={(event) => onExplain(event, taxExplanation('selfEmploymentIncome', result, settings, needs, wants))} />
          <Readout label="Half SE tax deduction" value={formatCurrency(result.halfSelfEmploymentTaxDeduction)} onExplain={(event) => onExplain(event, taxExplanation('halfSelfEmploymentTaxDeduction', result, settings, needs, wants))} />
          <Readout label="Federal AGI" value={formatCurrency(result.federalAgi)} strong onExplain={(event) => onExplain(event, taxExplanation('federalAgi', result, settings, needs, wants))} />
        </TaxGroup>
        <TaxGroup title="Taxable income">
          <Readout label="Federal taxable income" value={formatCurrency(result.federalTaxableIncome)} onExplain={(event) => onExplain(event, taxExplanation('federalTaxableIncome', result, settings, needs, wants))} />
          <Readout label="CA taxable income" value={formatCurrency(result.caTaxableIncome)} onExplain={(event) => onExplain(event, taxExplanation('caTaxableIncome', result, settings, needs, wants))} />
        </TaxGroup>
        <TaxGroup title="Estimated taxes">
          <Readout label="Federal income tax" value={formatCurrency(result.federalIncomeTax)} onExplain={(event) => onExplain(event, taxExplanation('federalIncomeTax', result, settings, needs, wants))} />
          <Readout label="California income tax" value={formatCurrency(result.caIncomeTax)} onExplain={(event) => onExplain(event, taxExplanation('caIncomeTax', result, settings, needs, wants))} />
          <Readout label="Social Security" value={formatCurrency(result.socialSecurityTax)} onExplain={(event) => onExplain(event, taxExplanation('socialSecurityTax', result, settings, needs, wants))} />
          <Readout label="Medicare" value={formatCurrency(result.medicareTax)} onExplain={(event) => onExplain(event, taxExplanation('medicareTax', result, settings, needs, wants))} />
          <Readout label="Self-employment tax" value={formatCurrency(result.selfEmploymentTax)} onExplain={(event) => onExplain(event, taxExplanation('selfEmploymentTax', result, settings, needs, wants))} />
        </TaxGroup>
        <TaxGroup title="Take-home">
          <Readout label="Total taxes" value={formatCurrency(result.totalTaxes)} onExplain={(event) => onExplain(event, taxExplanation('totalTaxes', result, settings, needs, wants))} />
          <Readout label="Effective rate" value={`${(result.effectiveRate * 100).toFixed(1)}%`} onExplain={(event) => onExplain(event, taxExplanation('effectiveRate', result, settings, needs, wants))} />
          <Readout label="After taxes" value={formatCurrency(result.afterTaxIncome)} strong onExplain={(event) => onExplain(event, taxExplanation('afterTaxIncome', result, settings, needs, wants))} />
          <Readout label="Monthly left over" value={formatCurrency(result.afterTaxIncome / 12 - needs - wants)} strong={result.afterTaxIncome / 12 >= needs + wants} onExplain={(event) => onExplain(event, taxExplanation('monthlyLeftOver', result, settings, needs, wants))} />
        </TaxGroup>
      </div>
    </section>
  )
}

function inputExplanation(title: string, summary: string, value: number): Omit<Explanation, 'x' | 'y'> {
  return {
    title,
    summary,
    calculation: 'Editable assumption. The saved value is inserted into the tax estimate wherever this row is referenced.',
    points: [{ label: 'Saved value', value: formatCurrency(value) }]
  }
}

function taxExplanation(
  key: string,
  result: ReturnType<typeof calculateIncomeTaxes>,
  settings: IncomeTaxSettings,
  needs: number,
  wants: number
): Omit<Explanation, 'x' | 'y'> {
  const totalPlan = needs + wants
  const monthlyAfterTax = result.afterTaxIncome / 12

  switch (key) {
    case 'grossIncome':
      return {
        title: 'Gross income',
        summary: 'Total expected annual income before deductions and taxes.',
        calculation: 'Sum of every income source annual amount.',
        points: [
          { label: 'W-2 income', value: formatCurrency(result.w2Income) },
          { label: 'Self-employment income', value: formatCurrency(result.selfEmploymentIncome) },
          { label: 'Other income', value: formatCurrency(result.grossIncome - result.w2Income - result.selfEmploymentIncome) },
          { label: 'Gross income', value: formatCurrency(result.grossIncome) }
        ]
      }
    case 'w2Income':
      return {
        title: 'W-2 income',
        summary: 'Income marked as payroll work.',
        calculation: 'Sum of income sources with tax type W-2.',
        points: [{ label: 'W-2 income', value: formatCurrency(result.w2Income) }]
      }
    case 'selfEmploymentIncome':
      return {
        title: 'Self-employment income',
        summary: 'Income marked as freelance, 1099, or self-employed work.',
        calculation: 'Sum of income sources with tax type Self-employed.',
        points: [{ label: 'Self-employment income', value: formatCurrency(result.selfEmploymentIncome) }]
      }
    case 'halfSelfEmploymentTaxDeduction':
      return {
        title: 'Half SE tax deduction',
        summary: 'The deductible half of estimated self-employment tax.',
        calculation: 'Self-employment tax divided by 2.',
        points: [
          { label: 'Self-employment tax', value: formatCurrency(result.selfEmploymentTax) },
          { label: 'Deductible half', value: formatCurrency(result.halfSelfEmploymentTaxDeduction) }
        ]
      }
    case 'federalAgi':
      return {
        title: 'Federal AGI',
        summary: 'Adjusted gross income estimate before the standard deduction.',
        calculation: 'Gross income - retirement contribution - above-the-line deductions - half SE tax deduction.',
        points: [
          { label: 'Gross income', value: formatCurrency(result.grossIncome) },
          { label: 'Retirement contribution', value: `-${formatCurrency(settings.retirement_contribution)}` },
          { label: 'Above-the-line deductions', value: `-${formatCurrency(settings.above_line_deductions)}` },
          { label: 'Half SE tax deduction', value: `-${formatCurrency(result.halfSelfEmploymentTaxDeduction)}` },
          { label: 'Federal AGI', value: formatCurrency(result.federalAgi) }
        ]
      }
    case 'federalTaxableIncome':
      return {
        title: 'Federal taxable income',
        summary: 'Income passed into the federal tax bracket estimate.',
        calculation: 'Federal AGI - federal standard deduction, floored at zero.',
        points: [
          { label: 'Federal AGI', value: formatCurrency(result.federalAgi) },
          { label: 'Standard deduction', value: `-${formatCurrency(settings.federal_standard_deduction)}` },
          { label: 'Taxable income', value: formatCurrency(result.federalTaxableIncome) }
        ]
      }
    case 'caTaxableIncome':
      return {
        title: 'CA taxable income',
        summary: 'California taxable income estimate before the app-level bracket adjustment.',
        calculation: 'Federal AGI - CA standard deduction, floored at zero.',
        points: [
          { label: 'Federal AGI', value: formatCurrency(result.federalAgi) },
          { label: 'CA standard deduction', value: `-${formatCurrency(settings.ca_standard_deduction)}` },
          { label: 'CA taxable income', value: formatCurrency(result.caTaxableIncome) }
        ]
      }
    case 'federalIncomeTax':
      return {
        title: 'Federal income tax',
        summary: 'Estimated federal bracket tax on taxable income.',
        calculation: 'Federal taxable income is passed through the app federal single-filer bracket table.',
        points: [
          { label: 'Federal taxable income', value: formatCurrency(result.federalTaxableIncome) },
          { label: 'Federal income tax', value: formatCurrency(result.federalIncomeTax) }
        ]
      }
    case 'caIncomeTax':
      return {
        title: 'California income tax',
        summary: 'Estimated California bracket tax.',
        calculation: 'Max(CA taxable income - CA bracket adjustment, 0) is passed through the app CA bracket table.',
        points: [
          { label: 'CA taxable income', value: formatCurrency(result.caTaxableIncome) },
          { label: 'CA bracket adjustment', value: `-${formatCurrency(settings.ca_bracket_adjustment)}` },
          { label: 'CA bracket base', value: formatCurrency(Math.max(0, result.caTaxableIncome - settings.ca_bracket_adjustment)) },
          { label: 'California income tax', value: formatCurrency(result.caIncomeTax) }
        ]
      }
    case 'socialSecurityTax':
      return {
        title: 'Social Security',
        summary: 'Payroll Social Security estimate for W-2 income.',
        calculation: 'Min(W-2 income, Social Security wage base) x 6.2%.',
        points: [
          { label: 'W-2 income', value: formatCurrency(result.w2Income) },
          { label: 'Wage base', value: formatCurrency(settings.social_security_wage_base) },
          { label: 'Taxed wages', value: formatCurrency(Math.min(Math.max(0, result.w2Income), settings.social_security_wage_base)) },
          { label: 'Social Security', value: formatCurrency(result.socialSecurityTax) }
        ]
      }
    case 'medicareTax':
      return {
        title: 'Medicare',
        summary: 'Payroll Medicare estimate for W-2 income.',
        calculation: 'W-2 income x 1.45%.',
        points: [
          { label: 'W-2 income', value: formatCurrency(result.w2Income) },
          { label: 'Medicare', value: formatCurrency(result.medicareTax) }
        ]
      }
    case 'selfEmploymentTax':
      return {
        title: 'Self-employment tax',
        summary: 'Estimated Social Security and Medicare tax on self-employment income.',
        calculation: 'Self-employment income x 92.35% x 15.3%.',
        points: [
          { label: 'Self-employment income', value: formatCurrency(result.selfEmploymentIncome) },
          { label: 'Taxable SE base', value: formatCurrency(Math.round(Math.max(0, result.selfEmploymentIncome) * 0.9235)) },
          { label: 'Self-employment tax', value: formatCurrency(result.selfEmploymentTax) }
        ]
      }
    case 'totalTaxes':
      return {
        title: 'Total taxes',
        summary: 'Combined estimated income and payroll taxes.',
        calculation: 'Federal income tax + California income tax + Social Security + Medicare + self-employment tax.',
        points: [
          { label: 'Federal income tax', value: formatCurrency(result.federalIncomeTax) },
          { label: 'California income tax', value: formatCurrency(result.caIncomeTax) },
          { label: 'Social Security', value: formatCurrency(result.socialSecurityTax) },
          { label: 'Medicare', value: formatCurrency(result.medicareTax) },
          { label: 'Self-employment tax', value: formatCurrency(result.selfEmploymentTax) },
          { label: 'Total taxes', value: formatCurrency(result.totalTaxes) }
        ]
      }
    case 'effectiveRate':
      return {
        title: 'Effective rate',
        summary: 'Share of gross income estimated for taxes.',
        calculation: 'Total taxes divided by gross income.',
        points: [
          { label: 'Total taxes', value: formatCurrency(result.totalTaxes) },
          { label: 'Gross income', value: formatCurrency(result.grossIncome) },
          { label: 'Effective rate', value: `${(result.effectiveRate * 100).toFixed(1)}%` }
        ]
      }
    case 'afterTaxIncome':
      return {
        title: 'After taxes',
        summary: 'Expected annual take-home after estimated taxes.',
        calculation: 'Gross income - total taxes.',
        points: [
          { label: 'Gross income', value: formatCurrency(result.grossIncome) },
          { label: 'Total taxes', value: `-${formatCurrency(result.totalTaxes)}` },
          { label: 'After taxes', value: formatCurrency(result.afterTaxIncome) }
        ]
      }
    case 'monthlyLeftOver':
      return {
        title: 'Monthly left over',
        summary: 'Expected monthly money remaining after taxes, needs, and wants.',
        calculation: 'After-tax annual income / 12 - needs per month - wants per month.',
        points: [
          { label: 'After tax / mo', value: formatCurrency(monthlyAfterTax) },
          { label: 'Needs / mo', value: `-${formatCurrency(needs)}` },
          { label: 'Wants / mo', value: `-${formatCurrency(wants)}` },
          { label: 'Budget plan / mo', value: formatCurrency(totalPlan) },
          { label: 'Left over / mo', value: formatCurrency(monthlyAfterTax - totalPlan) }
        ]
      }
    default:
      return {
        title: 'Calculation',
        summary: 'This row is derived from the expected income and tax assumptions.',
        calculation: 'The app recalculates this value when sources or tax inputs change.',
        points: []
      }
  }
}

function ExplanationPopover({ explanation, onClose }: { explanation: Explanation; onClose: () => void }) {
  const left = Math.min(explanation.x + 12, window.innerWidth - 380)
  const top = Math.max(16, Math.min(explanation.y + 12, window.innerHeight - 420))

  return (
    <div
      role="dialog"
      aria-label={explanation.title}
      onClick={(event) => event.stopPropagation()}
      style={{ left: Math.max(16, left), top, maxHeight: `calc(100vh - ${top + 16}px)` }}
      className="fixed z-50 w-[360px] overflow-y-auto rounded-2xl border border-zinc-200 bg-white/92 p-4 shadow-2xl shadow-zinc-900/15 backdrop-blur-xl dark:border-zinc-700 dark:bg-zinc-900/92 dark:shadow-black/35"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">Calculation</div>
          <h3 className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{explanation.title}</h3>
        </div>
        <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-[12px] font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">Close</button>
      </div>
      <p className="mt-3 text-sm leading-5 text-zinc-600 dark:text-zinc-300">{explanation.summary}</p>
      <div className="mt-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">Formula</div>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{explanation.calculation}</p>
      </div>
      {explanation.points.length ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-100 dark:border-zinc-800">
          {explanation.points.map((point) => (
            <div key={point.label} className="flex items-center justify-between gap-4 border-b border-zinc-100 px-3 py-2 text-sm last:border-b-0 dark:border-zinc-800">
              <span className="text-zinc-500 dark:text-zinc-400">{point.label}</span>
              <span className="font-medium tabular-nums text-zinc-800 dark:text-zinc-100">{point.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function IncomeTypeFilterBar({ selected, onToggle, onClear }: { selected: IncomeTypeFilter[]; onToggle: (type: IncomeTypeFilter) => void; onClear: () => void }) {
  return (
    <div className="sticky top-0 z-10 shrink-0 rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FilterGlyph label="Income type" />
        <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label="Income type filters">
          {INCOME_TYPES.map((type) => (
            <FilterPill key={type} label={type} active={selected.includes(type)} tone={incomeTone(type)} onClick={() => onToggle(type)} />
          ))}
        </div>
        {selected.length ? (
          <button type="button" onClick={onClear} className="ml-auto rounded-full px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  )
}

function IncomeCard({ entry, onChanged }: { entry: IncomeEntry; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [field, setField] = useState<'shoot_name' | 'company' | 'amount' | 'notes' | null>(null)
  const [draft, setDraft] = useState('')
  const { formatDate } = useDateFormat()

  function startEdit(next: typeof field, value: string): void {
    setField(next)
    setDraft(value)
  }

  async function save(): Promise<void> {
    if (!field) return
    await window.api.updateIncomeEntry(entry.id, {
      [field]: field === 'amount' ? parseCurrencyInput(draft) : draft
    })
    setField(null)
    onChanged()
  }

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600">
      <div className="grid grid-cols-[1fr_112px] gap-3">
        <div>
          {field === 'shoot_name' ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className="w-full bg-transparent font-medium outline-none" />
          ) : (
            <button type="button" onDoubleClick={() => startEdit('shoot_name', entry.shoot_name)} className="text-left font-semibold text-zinc-900 dark:text-zinc-100">{entry.shoot_name || 'Untitled income'}</button>
          )}
          {field === 'company' ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className="mt-1 w-full bg-transparent text-[12px] outline-none" />
          ) : (
            <button type="button" onDoubleClick={() => startEdit('company', entry.company)} className="mt-1 block text-left text-[12px] text-zinc-500 dark:text-zinc-400">{entry.company || 'No company'}</button>
          )}
        </div>
        {field === 'amount' ? (
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} className="bg-transparent text-right font-semibold outline-none" />
        ) : (
          <button type="button" onDoubleClick={() => startEdit('amount', formatCurrency(entry.amount))} className="text-right font-semibold text-emerald-600">{formatCurrency(entry.amount)}</button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-zinc-500 dark:text-zinc-400">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">{formatDate(entry.date)}</span>
        <span className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${incomeBadgeClass(getIncomeType(entry))}`}>{getIncomeType(entry)}</span>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="ml-auto rounded-full px-2 py-0.5 font-medium hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
          {expanded ? 'Hide notes' : 'Show notes'}
        </button>
      </div>
      {expanded ? (
        field === 'notes' ? (
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} className="mt-2 min-h-20 w-full resize-none rounded-lg border border-zinc-200 bg-transparent p-2 text-sm outline-none dark:border-zinc-700" />
        ) : (
          <button type="button" onDoubleClick={() => startEdit('notes', entry.notes)} className="mt-2 block w-full text-left text-sm text-zinc-700 dark:text-zinc-300">{entry.notes || 'No notes'}</button>
        )
      ) : null}
    </article>
  )
}

function getIncomeType(entry: IncomeEntry): IncomeTypeFilter {
  const haystack = `${entry.company} ${entry.shoot_name} ${entry.notes}`.toLowerCase()
  if (haystack.includes('snappr')) return 'Snappr'
  if (haystack.includes('thumbtack')) return 'Thumbtack'
  if (haystack.includes('upwork')) return 'Upwork'
  return 'Stimsonphoto'
}

function incomeTone(type: IncomeTypeFilter): 'emerald' | 'amber' | 'sky' | 'violet' {
  if (type === 'Snappr') return 'emerald'
  if (type === 'Thumbtack') return 'amber'
  if (type === 'Upwork') return 'sky'
  return 'violet'
}

function incomeBadgeClass(type: IncomeTypeFilter): string {
  const tone = incomeTone(type)
  if (tone === 'emerald') return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900'
  if (tone === 'amber') return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900'
  if (tone === 'sky') return 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900'
  return 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900'
}

function TaxInput({ label, value, onSave, onExplain }: { label: string; value: number; onSave: (value: number) => Promise<void>; onExplain: (event: MouseEvent) => void }) {
  return (
    <div onContextMenu={onExplain} className="flex items-center justify-between gap-4 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
      <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
      <EditablePlain value={formatCurrency(value)} align="right" onSave={(next) => onSave(parseCurrencyInput(next))} className="font-medium" />
    </div>
  )
}

function TaxGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">{title}</div>
      <div className="overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/55">{children}</div>
    </div>
  )
}

function Readout({ label, value, strong = false, onExplain }: { label: string; value: string; strong?: boolean; onExplain?: (event: MouseEvent) => void }) {
  return (
    <div onContextMenu={onExplain} className="flex items-center justify-between gap-4 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={strong ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'font-medium text-zinc-700 dark:text-zinc-200'}>{value}</span>
    </div>
  )
}

function QuickMetric({ label, value, accent = 'text-zinc-900 dark:text-zinc-100' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent}`}>{value}</div>
    </div>
  )
}

function FilterGlyph({ label }: { label: string }) {
  return (
    <div className="group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800" aria-label={label}>
      <FilterIcon />
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-20 -translate-x-1/2 rounded-md bg-zinc-800 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 dark:bg-zinc-100 dark:text-zinc-900">
        {label}
      </span>
    </div>
  )
}

function FilterPill({ label, active, tone, onClick }: { label: string; active: boolean; tone: 'emerald' | 'amber' | 'sky' | 'violet' | 'zinc'; onClick: () => void }) {
  const activeClass =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700 ring-amber-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900'
        : tone === 'sky'
          ? 'bg-sky-50 text-sky-700 ring-sky-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900'
          : tone === 'violet'
            ? 'bg-violet-50 text-violet-700 ring-violet-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900'
            : 'bg-zinc-900 text-white ring-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-zinc-100 dark:text-zinc-950 dark:ring-zinc-100'
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-all duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 ${
        active
          ? activeClass
          : 'bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass(tone, active)}`} />
      {label}
    </button>
  )
}

function dotClass(tone: 'emerald' | 'amber' | 'sky' | 'violet' | 'zinc', active: boolean): string {
  if (!active) return 'bg-zinc-300 dark:bg-zinc-600'
  if (tone === 'emerald') return 'bg-emerald-500'
  if (tone === 'amber') return 'bg-amber-500'
  if (tone === 'sky') return 'bg-sky-500'
  if (tone === 'violet') return 'bg-violet-500'
  return 'bg-zinc-500'
}

function StatCard({ label, value, accent = 'text-zinc-900 dark:text-zinc-100' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
    </div>
  )
}

function SummaryRow({ label, values, accent, variance = false }: { label: string; values: number[]; accent?: string; variance?: boolean }) {
  return (
    <tr className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{label}</td>
      {values.map((value, index) => (
        <td key={`${label}-${MONTH_LABELS[index]}`} className={`px-4 py-3 text-right ${variance ? value >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300' : accent ?? 'text-zinc-700 dark:text-zinc-200'}`}>
          {formatCurrency(value)}
        </td>
      ))}
    </tr>
  )
}

function EditablePlain({ value, onSave, align = 'left', className = '', fallback = 'Empty' }: { value: string; onSave: (value: string) => void | Promise<void>; align?: 'left' | 'right'; className?: string; fallback?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  async function save(): Promise<void> {
    setEditing(false)
    if (draft !== value) await onSave(draft)
  }

  if (editing) {
    return <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => event.key === 'Enter' && save()} className={`w-full bg-transparent outline-none ${align === 'right' ? 'text-right' : ''} ${className}`} />
  }
  return <button type="button" onDoubleClick={() => { setDraft(value); setEditing(true); }} className={`block w-full truncate ${align === 'right' ? 'text-right' : 'text-left'} ${className || 'text-zinc-800 dark:text-zinc-100'}`}>{value || fallback}</button>
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h12" />
      <path d="M6.5 10h7" />
      <path d="M9 14h2" />
    </svg>
  )
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'up' ? <path d="m5 12 5-5 5 5" /> : <path d="m5 8 5 5 5-5" />}
    </svg>
  )
}
