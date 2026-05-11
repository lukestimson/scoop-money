/**
 * Fixed set of expense budget categories for Scoop Money (budget sheet + line items).
 * Order is display order on the Budget page.
 */
export const BUDGET_CATEGORY_ORDER = [
  'Coffee',
  'Dining',
  'Shopping',
  'Transportation',
  'Business Expenses',
  'Entertainment',
  'Groceries',
  'Subscriptions',
  'Bar/ Alcohol',
  'AI Fees',
  'Internet',
  'Insurance',
  'Gas/Automotive',
  'Other Services',
  'Rent',
  'Utilities',
  'Travel'
] as const

export type CanonicalBudgetCategory = (typeof BUDGET_CATEGORY_ORDER)[number]

export const BUDGET_CATEGORY_ALLOWLIST = new Set<string>(BUDGET_CATEGORY_ORDER)

/** Default “need” vs “nice” for category rows and new line items when not specified. */
const NEED_CATEGORIES = new Set<string>([
  'Rent',
  'Utilities',
  'Groceries',
  'Coffee',
  'Subscriptions',
  'Internet',
  'Insurance',
  'Gas/Automotive',
  'Other Services',
  'Transportation'
])

export function defaultIsNeedForBudgetCategory(category: string): boolean {
  return NEED_CATEGORIES.has(category)
}
