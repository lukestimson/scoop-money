export function parseLocalDateToUnix(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const isoDate = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  if (isoDate) {
    return localNoonUnix(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]))
  }

  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed)
  if (slashDate) {
    const rawYear = Number(slashDate[3])
    const year = rawYear < 100 ? 2000 + rawYear : rawYear
    return localNoonUnix(year, Number(slashDate[1]), Number(slashDate[2]))
  }

  return null
}

function localNoonUnix(year: number, month: number, day: number): number | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return Math.floor(date.getTime() / 1000)
}
