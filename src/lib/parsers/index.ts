import type { ParseResult } from '../types'
import { parseCsv } from './csv'
import { parseOfx } from './ofx'
import { parsePdf } from './pdf'

export { PdfPasswordError } from './pdf'

/** Work out what kind of file was dropped and read it. Everything happens in the browser. */
export async function parseFile(file: File, password?: string): Promise<ParseResult> {
  const name = file.name.toLowerCase()
  const buf = await file.arrayBuffer()
  const head = new TextDecoder().decode(buf.slice(0, 5))

  if (head.startsWith('%PDF') || name.endsWith('.pdf')) return parsePdf(buf, password)

  const text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '')
  if (/<OFX>|OFXHEADER/i.test(text.slice(0, 2000)) || /\.(ofx|qfx)$/.test(name)) return parseOfx(text)
  if (/\.(csv|txt)$/.test(name) || text.includes(',')) return parseCsv(text)

  return { format: 'csv', transactions: [], warnings: ['This file type is not supported. Use a PDF, CSV or OFX statement.'] }
}
