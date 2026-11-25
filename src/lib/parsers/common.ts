const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Parse the date styles South African banks use:
 * 2026/01/05, 2026-01-05, 20260105, 05/01/2026, 05 Jan 2026, 5 January 2026.
 * Numeric d/m/y is read day-first (SA convention).
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, '')
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) return iso(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{2,4})/)
  if (m) {
    const mon = monthFromName(m[2])
    if (mon) return iso(+m[3], mon, +m[1])
  }
  return null
}

export function monthFromName(name: string): number | undefined {
  return MONTHS[name.toLowerCase().slice(0, 3)]
}

/**
 * Parse an amount like "1 234.56", "1,234.56", "-150.00", "150.00Cr", "150.00 Dr", "(150.00)".
 * Returns null when the text is not money.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/^"|"$/g, '').replace(/^R\s?/i, '')
  if (!s) return null
  let sign = 1
  if (/cr$/i.test(s)) s = s.replace(/\s*cr$/i, '')
  else if (/dr$/i.test(s)) { sign = -1; s = s.replace(/\s*dr$/i, '') }
  if (/^\(.*\)$/.test(s)) { sign = -sign; s = s.slice(1, -1) }
  if (s.endsWith('-')) { sign = -sign; s = s.slice(0, -1) }
  s = s.replace(/[\s ]/g, '')
  // "1.234,56" style: comma is the decimal mark.
  if (/^[-+]?(\d{1,3}(\.\d{3})*|\d+),\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null
  return sign * parseFloat(s)
}

export function cleanDescription(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}
