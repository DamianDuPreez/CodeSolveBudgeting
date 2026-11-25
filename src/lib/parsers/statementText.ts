import type { ParseResult, ParsedTransaction } from '../types'
import { cleanDescription, monthFromName, parseAmount, parseDate } from './common'

const MONEY = /-?\d{1,3}(?:[ ,]\d{3})*\.\d{2}(?:\s?(?:Cr|Dr))?|-?\d+\.\d{2}(?:\s?(?:Cr|Dr))?/gi
const SKIP = /opening balance|closing balance|balance brought forward|balance carried forward|^total|turnover/i

/** Label for rows FNB prints with a date and amount but no text (in practice: bank charges). */
export const NO_DESCRIPTION_FEE = 'Bank fee (no description on statement)'
export const NO_DESCRIPTION_CREDIT = 'Money in (no description on statement)'

/** One line of statement text, with where it starts on the page (x, y in PDF points) when known. */
export interface TextLine {
  text: string
  x?: number
  y?: number
  page?: number
}

interface Period { startYear: number; startMonth: number; endYear: number }

/** FNB prints e.g. "Statement Period : 14 August 2026 to 14 November 2026". */
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
 * The money values that end a line, e.g. "... 179.00  4,266.61Cr" → ["179.00", "4,266.61Cr"].
 * Values in the middle of a description ("POS Purchase 179.00 Netflix.Com") are not included.
 */
function trailingMoney(rest: string): RegExpMatchArray[] {
  const all = [...rest.matchAll(MONEY)]
  const out: RegExpMatchArray[] = []
  let end = rest.trimEnd().length
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i]
    const mEnd = (m.index ?? 0) + m[0].length
    if (rest.slice(mEnd, end).trim() !== '') break
    out.unshift(m)
    end = m.index ?? 0
  }
  return out
}

/**
 * Turn the text lines of an FNB statement PDF into transactions. Each transaction is one line:
 *   "27 Aug  POS Purchase 179.00 Netflix.Com  412345*9655 25 Aug  179.00  9,808.04Cr  [charges]"
 * The last money values on the line are the amount, the running balance ("Cr" = in credit), and
 * sometimes an accrued bank charge. Credits carry "Cr"; debits have no suffix. When the running
 * balance is available the sign is checked against it.
 */
export function parseStatementLines(input: (string | TextLine)[], fallbackYear = new Date().getFullYear()): ParseResult {
  const warnings: string[] = []
  const lines: TextLine[] = input.map((l) => (typeof l === 'string' ? { text: l } : l))
  const period = findPeriod(lines.map((l) => l.text).join('\n'))
  if (!period) warnings.push('Could not find the statement period; assumed dates are in ' + fallbackYear + '.')

  const transactions: ParsedTransaction[] = []
  let prevBalance: number | undefined

  for (const { text } of lines) {
    const line = text.replace(/\s+/g, ' ').trim()

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
        date = parseDate(`${short[1]} ${short[2]} ${yearFor(mon, period, fallbackYear)}`)
        rest = short[3]
      }
    }
    if (!date || SKIP.test(rest)) continue

    let money = trailingMoney(rest)
    if (money.length === 0) continue
    // Amount, balance, accrued charge: a third value without Cr/Dr is the charges column.
    if (money.length >= 3 && !/(cr|dr)$/i.test(money[money.length - 1][0])) money = money.slice(0, -1)
    const amountTok = money.length >= 2 ? money[money.length - 2] : money[0]
    const balanceTok = money.length >= 2 ? money[money.length - 1] : undefined

    let amount = parseAmount(amountTok[0])
    if (amount === null) continue
    const balance = balanceTok ? parseAmount(balanceTok[0]) ?? undefined : undefined

    // FNB convention: no suffix = debit, "Cr" = credit.
    if (!/cr$/i.test(amountTok[0]) && !amountTok[0].startsWith('-')) amount = -Math.abs(amount)
    // Trust the running balance when it agrees with the size of the amount.
    if (prevBalance !== undefined && balance !== undefined) {
      const diff = balance - prevBalance
      if (Math.abs(Math.abs(diff) - Math.abs(amount)) < 0.01) amount = diff
    }
    if (balance !== undefined) prevBalance = balance

    // FNB prints some charges (e.g. on overseas card purchases) with no text at all.
    const description = cleanDescription(rest.slice(0, money[0].index ?? 0))
      || (amount < 0 ? NO_DESCRIPTION_FEE : NO_DESCRIPTION_CREDIT)

    transactions.push({ date, amount: Math.round(amount * 100) / 100, description, balance })
  }

  if (transactions.length === 0) warnings.push('No transactions were recognised in this PDF.')
  return { format: 'pdf', transactions, warnings }
}
