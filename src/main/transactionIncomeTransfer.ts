import type { IncomeEntry, Transaction } from '../types/money'

const TRAILING_NAME_IN_PARENS = /^(.*?)(?:\s*)\(([^()]+)\)\s*$/u
const PERSON_NAME_PATTERN = /^[\p{L}\p{M} .'-]+$/u
const TIP_WORD_PATTERN = /\btip\b/i

function extractTrailingParenthesizedName(description: string): { subject: string; name: string } | null {
  const match = description.match(TRAILING_NAME_IN_PARENS)
  if (!match) return null

  const subject = match[1]?.trim()
  const name = match[2]?.trim()
  if (!subject || !name) return null
  if (!PERSON_NAME_PATTERN.test(name) || !/\p{L}/u.test(name)) return null

  return { subject, name }
}

function tipSubject(subject: string): string {
  return TIP_WORD_PATTERN.test(subject) ? subject : `${subject} tip`.trim()
}

/** Maps fields that exist in both transaction and income records without changing their values. */
export function incomeDataFromPositiveTransaction(
  transaction: Transaction,
  options: { isTip?: boolean } = {}
): Partial<IncomeEntry> {
  if (transaction.amount <= 0) {
    throw new Error('Only positive transactions can be moved to income.')
  }

  const venmoName = extractTrailingParenthesizedName(transaction.description)
  const subject = venmoName?.subject ?? transaction.description

  return {
    date: transaction.date,
    shoot_name: options.isTip ? tipSubject(subject) : subject,
    company: venmoName?.name ?? '',
    amount: transaction.amount,
    ...(options.isTip ? { tip: transaction.amount } : {}),
    notes: transaction.notes
  }
}
