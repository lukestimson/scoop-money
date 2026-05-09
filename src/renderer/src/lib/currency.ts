export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(cents / 100)
}

export function parseCurrencyInput(value: string): number {
  const negative = value.trim().startsWith('-')
  const cleaned = value.replace(/[,$]/g, '').replace(/[^0-9.]/g, '')
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed * 100) * (negative ? -1 : 1)
}
