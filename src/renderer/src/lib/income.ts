import type { ExpectedIncomeEntry, IncomeEntry, IncomeTaxSettings } from '../../../types/money'

type Bracket = readonly [limit: number, rate: number]

const FEDERAL_SINGLE_BRACKETS: Bracket[] = [
  [1192500, 0.1],
  [4715000, 0.12],
  [10052500, 0.22],
  [19195000, 0.24],
  [24372500, 0.32],
  [60935000, 0.35],
  [Number.POSITIVE_INFINITY, 0.37]
]

const CA_SINGLE_BRACKETS: Bracket[] = [
  [1145000, 0.01],
  [2749000, 0.02],
  [3895900, 0.04],
  [5408100, 0.06],
  [6835000, 0.08],
  [33863900, 0.093],
  [40636400, 0.113],
  [67727500, 0.123],
  [Number.POSITIVE_INFINITY, 0.133]
]

export interface IncomeTaxResult {
  grossIncome: number
  w2Income: number
  selfEmploymentIncome: number
  halfSelfEmploymentTaxDeduction: number
  federalAgi: number
  federalTaxableIncome: number
  caTaxableIncome: number
  federalIncomeTax: number
  caIncomeTax: number
  socialSecurityTax: number
  medicareTax: number
  selfEmploymentTax: number
  totalTaxes: number
  afterTaxIncome: number
  effectiveRate: number
}

export function calculateIncomeTaxes(entries: ExpectedIncomeEntry[], settings: IncomeTaxSettings): IncomeTaxResult {
  const grossIncome = entries.reduce((sum, entry) => sum + entry.annual_amount, 0)
  const w2Income = entries.filter((entry) => entry.income_kind === 'w2').reduce((sum, entry) => sum + entry.annual_amount, 0)
  const selfEmploymentIncome = entries
    .filter((entry) => entry.income_kind === 'self_employment')
    .reduce((sum, entry) => sum + entry.annual_amount, 0)
  const selfEmploymentTax = Math.round(Math.max(0, selfEmploymentIncome) * 0.9235 * 0.153)
  const halfSelfEmploymentTaxDeduction = Math.round(selfEmploymentTax / 2)
  const federalAgi = Math.max(
    0,
    grossIncome - settings.retirement_contribution - settings.above_line_deductions - halfSelfEmploymentTaxDeduction
  )
  const federalTaxableIncome = Math.max(0, federalAgi - settings.federal_standard_deduction)
  const caTaxableIncome = Math.max(0, federalAgi - settings.ca_standard_deduction)
  const federalIncomeTax = calculateBracketTax(federalTaxableIncome, FEDERAL_SINGLE_BRACKETS)
  const caIncomeTax = calculateBracketTax(Math.max(0, caTaxableIncome - settings.ca_bracket_adjustment), CA_SINGLE_BRACKETS)
  const socialSecurityTax = Math.round(Math.min(Math.max(0, w2Income), settings.social_security_wage_base) * 0.062)
  const medicareTax = Math.round(Math.max(0, w2Income) * 0.0145)
  const totalTaxes = federalIncomeTax + caIncomeTax + socialSecurityTax + medicareTax + selfEmploymentTax
  const afterTaxIncome = grossIncome - totalTaxes
  return {
    grossIncome,
    w2Income,
    selfEmploymentIncome,
    halfSelfEmploymentTaxDeduction,
    federalAgi,
    federalTaxableIncome,
    caTaxableIncome,
    federalIncomeTax,
    caIncomeTax,
    socialSecurityTax,
    medicareTax,
    selfEmploymentTax,
    totalTaxes,
    afterTaxIncome,
    effectiveRate: grossIncome > 0 ? totalTaxes / grossIncome : 0
  }
}

export function groupActualIncomeByMonth(entries: IncomeEntry[], year: number): number[] {
  const totals = Array.from({ length: 12 }, () => 0)
  entries.forEach((entry) => {
    const date = new Date(entry.date * 1000)
    if (date.getFullYear() === year) totals[date.getMonth()] += entry.amount
  })
  return totals
}

function calculateBracketTax(income: number, brackets: Bracket[]): number {
  let previous = 0
  let tax = 0
  for (const [limit, rate] of brackets) {
    if (income <= previous) break
    const taxable = Math.min(income, limit) - previous
    tax += taxable * rate
    previous = limit
  }
  return Math.round(tax)
}
