import { defaultIsNeedForBudgetCategory } from './budgetCategories'

/**
 * Infer need vs nice-to-have for a budget line from the Living Expenses workbook
 * ("Must-Have Expenses" vs "Nice-to-Have Expenses" sections in All Living Expenses 2026).
 */
export function inferLineIsNeed(category: string, label: string): boolean {
  const c = category.trim()
  const l = label.toLowerCase()

  if (c === 'Shopping') {
    if (
      /cleaning|toiletries|cooking|household|supplies|deodorant|shaving|moistur|razor|tooth/.test(l)
    ) {
      return true
    }
    return false
  }

  if (c === 'Other Services') {
    if (/haircut/i.test(l)) return true
    if (/misc|miscellaneous/i.test(l)) return false
    return true
  }

  const niceOnly = new Set([
    'Dining',
    'Bar/ Alcohol',
    'Travel',
    'Business Expenses',
    'Entertainment',
    'AI Fees'
  ])
  if (niceOnly.has(c)) return false

  const needOnly = new Set([
    'Rent',
    'Utilities',
    'Groceries',
    'Coffee',
    'Transportation',
    'Subscriptions',
    'Insurance',
    'Internet',
    'Gas/Automotive'
  ])
  if (needOnly.has(c)) return true

  return defaultIsNeedForBudgetCategory(c)
}

export type CategoryNeedKind = 'need' | 'nice' | 'mixed' | 'empty'

export function categoryNeedKindFromLines(
  lines: ReadonlyArray<{ is_need: boolean; section: string }>
): CategoryNeedKind {
  const relevant = lines.filter((line) => line.section !== 'Parental & Gov Help')
  if (relevant.length === 0) return 'empty'
  if (relevant.every((line) => line.is_need)) return 'need'
  if (relevant.every((line) => !line.is_need)) return 'nice'
  return 'mixed'
}
