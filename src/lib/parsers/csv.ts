import type { ParseResult, ParsedTransaction } from '../types'
import { cleanDescription, parseAmount, parseDate } from './common'

/** Split one CSV line, honouring quotes. Detects ; or tab separators too. */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ }
      else quoted = !quoted
    } else if (c === sep && !quoted) {
      out.push(cur.trim()); cur = ''
    } else cur += c
  }
  out.push(cur.trim())
  return out
}

function detectSeparator(lines: string[]): string {
  const sample = lines.slice(0, 30).join('\n')
  const counts = [',', ';', '\t'].map((s) => [s, sample.split(s).length] as const)
  return counts.sort((a, b) => b[1] - a[1])[0][0]
}

type Cols = { date: number; desc: number[]; amount?: number; debit?: number; credit?: number; balance?: number }

/** Find the header row and which column holds what. Banks put account info above the header. */
function findHeader(rows: string[][]): { index: number; cols: Cols } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = rows[i].map((c) => c.toLowerCase())
    const date = h.findIndex((c) => /date/.test(c))
    if (date < 0) continue
    const amount = h.findIndex((c) => /^(amount|amt|transaction amount|value)/.test(c))
    const debit = h.findIndex((c) => /debit|money out|withdrawal/.test(c))
    const credit = h.findIndex((c) => /credit|money in|deposit/.test(c))
    const balance = h.findIndex((c) => /balance/.test(c))
    const desc = h
      .map((c, idx) => (/desc|narr|details|reference|particular|payee|merchant/.test(c) ? idx : -1))
      .filter((idx) => idx >= 0)
    if (amount < 0 && debit < 0 && credit < 0) continue
    return {
      index: i,
      cols: {
        date,
        desc,
        amount: amount >= 0 ? amount : undefined,
        debit: debit >= 0 ? debit : undefined,
        credit: credit >= 0 ? credit : undefined,
        balance: balance >= 0 ? balance : undefined,
      },
    }
  }
  return null
}

/** Headerless fallback (some FNB exports): guess columns from the first data rows. */
function guessColumns(rows: string[][]): { index: number; cols: Cols } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i]
    const date = r.findIndex((c) => parseDate(c) !== null)
    if (date < 0) continue
    const numeric = r.map((c, idx) => (idx !== date && parseAmount(c) !== null ? idx : -1)).filter((x) => x >= 0)
    const text = r.map((c, idx) => (idx !== date && parseAmount(c) === null && c.length > 2 ? idx : -1)).filter((x) => x >= 0)
    if (numeric.length === 0 || text.length === 0) continue
    return {
      index: i - 1,
      cols: { date, desc: text, amount: numeric[0], balance: numeric.length > 1 ? numeric[1] : undefined },
    }
  }
  return null
}

export function parseCsv(text: string): ParseResult {
  const warnings: string[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const sep = detectSeparator(lines)
  const rows = lines.map((l) => splitCsvLine(l, sep))
  const header = findHeader(rows) ?? guessColumns(rows)
  if (!header) {
    return { format: 'csv', transactions: [], warnings: ['Could not find the date and amount columns in this CSV.'] }
  }
  const { cols } = header
  const transactions: ParsedTransaction[] = []

  for (const r of rows.slice(header.index + 1)) {
    const date = parseDate(r[cols.date] ?? '')
    if (!date) continue
    let amount: number | null = null
    if (cols.amount !== undefined) amount = parseAmount(r[cols.amount] ?? '')
    else {
      const out = cols.debit !== undefined ? parseAmount(r[cols.debit] ?? '') : null
      const inn = cols.credit !== undefined ? parseAmount(r[cols.credit] ?? '') : null
      if (out !== null || inn !== null) amount = (inn ? Math.abs(inn) : 0) - (out ? Math.abs(out) : 0)
    }
    if (amount === null) { warnings.push(`Skipped a row on ${date} with no readable amount.`); continue }
    const description = cleanDescription(cols.desc.map((i) => r[i] ?? '').filter(Boolean).join(' '))
    const balance = cols.balance !== undefined ? parseAmount(r[cols.balance] ?? '') ?? undefined : undefined
    transactions.push({ date, amount, description: description || '(no description)', balance })
  }

  const accountLine = rows
    .slice(0, header.index)
    .find((r) => /account/i.test(r[0] ?? '') && r.some((c) => /\d{6,}/.test(c)))
  const acctNum = accountLine?.find((c) => /\d{6,}/.test(c))?.replace(/\D/g, '')
  return {
    format: 'csv',
    accountName: acctNum ? `Account ••${acctNum.slice(-4)}` : undefined,
    transactions,
    warnings,
  }
}
