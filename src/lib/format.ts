const zar = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })

export function money(n: number): string {
  // Avoid "-R 0,00" for tiny floating-point leftovers.
  return zar.format(Math.abs(n) < 0.005 ? 0 : n)
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

/** Round to cents to keep sums exact enough for display. */
export function cents(n: number): number {
  return Math.round(n * 100) / 100
}
