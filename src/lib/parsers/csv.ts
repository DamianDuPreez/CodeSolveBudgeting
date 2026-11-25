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

type Cols = { date: number; desc: number[]; amount?: number; debit?: number; credit?: number; fee?: number; balance?: number }

/** First header matching `re`, never a date column ("Value Date" is not an amount). */
const findCol = (h: string[], re: RegExp) => h.findIndex((c) => re.test(c) && !/date/.test(c))

/** Find the header row and which column holds what. Banks put account info above the header. */
function findHeader(rows: string[][]): { index: number; cols: Cols } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = rows[i].map((c) => c.toLowerCase().trim())
    // Prefer the transaction or posting date over a "Value Date" column.
    let date = h.findIndex((c) => /trans.*date/.test(c))
    if (date < 0) date = h.findIndex((c) => /date/.test(c) && !/value/.test(c))
    if (date < 0) date = h.findIndex((c) => /date/.test(c))
    if (date < 0) continue
    const amount = findCol(h, /^(amount|amt|transaction amount|value)/)
    const debit = findCol(h, /debit|money out|withdrawal/)
    const credit = findCol(h, /credit|money in|deposit/)
    const fee = findCol(h, /^(fees?|charges?|bank charges?|service fees?)$/)
    const balance = findCol(h, /balance/)
    const desc = h
      .map((c, idx) => (/desc|narr|details|reference|particular|payee|merchant/.test(c) && !/date/.test(c) ? idx : -1))
      .filter((idx) => idx >= 0)
    if (amount < 0 && debit < 0 && credit < 0) continue
    const opt = (n: number) => (n >= 0 ? n : undefined)
    return {
      index: i,
      cols: { date, desc, amount: opt(amount), debit: opt(debit), credit: opt(credit), fee: opt(fee), balance: opt(balance) },
    }
  }
  return null
}

function mostCommonShare(values: string[]): number {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return Math.max(...counts.values()) / values.length
}

/**
 * Headerless fallback (some FNB and Standard Bank exports): guess columns from the data rows.
 * A text column that mostly repeats one value (a record type like "HIST") is left out.
 */
function guessColumns(rows: string[][]): { index: number; cols: Cols } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i]
    const date = r.findIndex((c) => parseDate(c) !== null)
    if (date < 0) continue
    // Decide each column from all the dated rows, not just the first (often an opening balance).
    const data = rows.slice(i).filter((row) => parseDate(row[date] ?? '') !== null)
    const width = Math.max(...data.map((row) => row.length))
    const share = (idx: number, test: (c: string) => boolean) => data.filter((row) => test(row[idx] ?? '')).length / data.length
    const cols = [...Array(width).keys()].filter((idx) => idx !== date)
    const numeric = cols.filter((idx) => share(idx, (c) => parseAmount(c) !== null) >= 0.5)
    let text = cols.filter((idx) => !numeric.includes(idx) && share(idx, (c) => c.length > 2 && parseAmount(c) === null) >= 0.5)
    const varied = text.filter((idx) => data.length < 3 || mostCommonShare(data.map((row) => row[idx] ?? '')) < 0.6)
    if (varied.length) text = varied
    if (numeric.length === 0 || text.length === 0) continue
    return {
      index: i - 1,
      cols: { date, desc: text, amount: numeric[0], balance: numeric.length > 1 ? numeric[1] : undefined },
    }
  }
  return null
}

/** Opening and closing balance lines are not transactions. */
const BALANCE_LINE = /\b(opening|closing|open|close) balance\b|\bbalance (brought|carried) (forward|down)\b|^bal(ance)? [bc]\/?f\b/i

/** Join the description columns, dropping one that only repeats another. */
function joinDescription(parts: string[]): string {
  const kept = parts.map(cleanDescription).filter(Boolean)
  const repeats = (p: string, i: number) =>
    kept.some((q, j) => j !== i && q.toLowerCase().includes(p.toLowerCase()) && (q.length > p.length || j < i))
  return kept.filter((p, i) => !repeats(p, i)).join(' ')
}

export function parseCsv(text: string): ParseResult {
  const warnings: string[] = []
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0)
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
    // Some banks (Capitec) put a transaction's fee in its own column on the same row.
    const fee = cols.fee !== undefined ? parseAmount(r[cols.fee] ?? '') : null
    if (fee) amount = (amount ?? 0) - Math.abs(fee)
    const description = joinDescription(cols.desc.map((i) => r[i] ?? ''))
    if (BALANCE_LINE.test(description)) continue
    if (amount === null) { warnings.push(`Skipped a row on ${date} with no readable amount.`); continue }
    const balance = cols.balance !== undefined ? parseAmount(r[cols.balance] ?? '') ?? undefined : undefined
    transactions.push({ date, amount, description: description || '(no description)', balance })
  }

  const accountLine = rows
    .slice(0, header.index)
    .find((r) => /acc/i.test(r[0] ?? '') && r.some((c) => /\d{6,}/.test(c)))
  const acctNum = accountLine?.find((c) => /\d{6,}/.test(c))?.replace(/\D/g, '')
  return {
    format: 'csv',
    accountName: acctNum ? `Account ••${acctNum.slice(-4)}` : undefined,
    transactions,
    warnings,
  }
}
