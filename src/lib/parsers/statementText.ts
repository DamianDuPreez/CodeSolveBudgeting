import type { ParseResult, ParsedTransaction } from '../types'
import { cleanDescription, monthFromName, parseAmount, parseDate } from './common'

const MONEY = /-?\d{1,3}(?:[ ,]\d{3})*\.\d{2}(?:\s?(?:Cr|Dr))?|-?\d+\.\d{2}(?:\s?(?:Cr|Dr))?/gi
const SKIP = /opening balance|closing balance|balance brought forward|balance carried forward|^total|turnover/i

interface Period { startYear: number; startMonth: number; endYear: number }

/** FNB prints e.g. "Statement Period : 26 December 2025 to 25 January 2026". */
function findPeriod(text: string): Period | null {
  const m = text.match(
    /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\s*(?:to|-|–)\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i,
  )
  if (!m) return null
  const startMonth = monthFromName(m[2])
  if (!startMonth) return null
  return { startYear: +m[3], startMonth, endYear: +m[6] }
}

function yearFor(month: number, period: Period | null, fallbackYear: number): number {
  if (!period) return fallbackYear
  if (period.startYear === period.endYear) return period.startYear
  return month >= period.startMonth ? period.startYear : period.endYear
}

/**
 * Turn the text lines of a bank statement PDF into transactions.
 * Built around the FNB layout — "05 Jan  Description  1,234.56  10,000.00Cr" —
 * where credits carry a "Cr" suffix and the last money value is the running balance.
 * When the running balance is available, the sign is checked against it, which also
 * makes this work for banks that mark debits instead of credits.
 */
export function parseStatementLines(lines: string[], fallbackYear = new Date().getFullYear()): ParseResult {
  const warnings: string[] = []
  const all = lines.join('\n')
  const period = findPeriod(all)
  if (!period) warnings.push('Could not find the statement period; assumed dates are in ' + fallbackYear + '.')

  const transactions: ParsedTransaction[] = []
  let prevBalance: number | undefined

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim()

    if (/opening balance|balance brought forward/i.test(line)) {
      const vals = line.match(MONEY)
      if (vals) prevBalance = parseAmount(vals[vals.length - 1]) ?? prevBalance
      continue
    }

    let date: string | null = null
    let rest = ''
    const short = line.match(/^(\d{1,2})\s+([A-Za-z]{3})\b\s*(.*)$/)
    const full = line.match(/^(\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+(.*)$/)
    if (full) {
      date = parseDate(full[1])
      rest = full[2]
    } else if (short) {
      const mon = monthFromName(short[2])
      if (mon) {
        const y = yearFor(mon, period, fallbackYear)
        date = parseDate(`${short[1]} ${short[2]} ${y}`)
        rest = short[3]
      }
    }
    if (!date || SKIP.test(rest)) continue

    // Money values that end the line: amount, balance, and sometimes a bank-charge column.
    const matches = [...rest.matchAll(MONEY)]
    if (matches.length === 0) continue
    const firstIdx = matches[0].index ?? 0
    const description = cleanDescription(rest.slice(0, firstIdx))
    if (!description) continue

    const rawAmount = matches[0][0]
    let amount = parseAmount(rawAmount)
    if (amount === null) continue
    const balance = matches.length > 1 ? parseAmount(matches[1][0]) ?? undefined : undefined

    // FNB convention: no suffix = debit, "Cr" = credit.
    if (!/cr$/i.test(rawAmount) && !rawAmount.startsWith('-')) amount = -Math.abs(amount)
    // Trust the running balance when it agrees with the size of the amount.
    if (prevBalance !== undefined && balance !== undefined) {
      const diff = balance - prevBalance
      if (Math.abs(Math.abs(diff) - Math.abs(amount)) < 0.01) amount = diff
    }
    if (balance !== undefined) prevBalance = balance

    transactions.push({ date, amount: Math.round(amount * 100) / 100, description, balance })
  }

  if (transactions.length === 0) warnings.push('No transactions were recognised in this PDF.')
  return { format: 'pdf', transactions, warnings }
}
