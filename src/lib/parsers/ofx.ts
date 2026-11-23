import type { ParseResult, ParsedTransaction } from '../types'
import { cleanDescription, parseAmount, parseDate } from './common'

/** Read a tag's value from OFX 1.x (SGML, often no closing tags) or OFX 2.x (XML). */
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'))
  return m ? m[1].trim() : undefined
}

export function parseOfx(text: string): ParseResult {
  const warnings: string[] = []
  const transactions: ParsedTransaction[] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1)

  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0]
    const date = parseDate(tag(block, 'DTPOSTED') ?? '')
    const amount = parseAmount(tag(block, 'TRNAMT') ?? '')
    if (!date || amount === null) {
      warnings.push('Skipped a transaction with a missing date or amount.')
      continue
    }
    const name = tag(block, 'NAME') ?? ''
    const memo = tag(block, 'MEMO') ?? ''
    const description = cleanDescription(
      name && memo && !memo.includes(name) ? `${name} ${memo}` : name || memo,
    )
    transactions.push({ date, amount, description: description || '(no description)' })
  }

  const acct = tag(text, 'ACCTID')
  return {
    format: 'ofx',
    accountName: acct ? `Account ••${acct.slice(-4)}` : undefined,
    transactions,
    warnings,
  }
}
