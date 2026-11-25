import type { ParseResult } from '../types'
import { parseStatementLines, type TextLine } from './statementText'
import { groupTextPieces, type TextPiece } from './textLayout'

export class PdfPasswordError extends Error {
  readonly wrongPassword: boolean
  constructor(wrongPassword: boolean) {
    super(wrongPassword ? 'That password did not open the PDF.' : 'This PDF is password protected.')
    this.wrongPassword = wrongPassword
  }
}

/** Read a PDF in the browser and rebuild its text lines from positioned text pieces. */
export async function extractPdfLines(data: ArrayBuffer, password?: string): Promise<TextLine[]> {
  // Loaded only when a PDF is dropped, to keep the app quick to open.
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), password }).promise
  } catch (e) {
    if (e && typeof e === 'object' && 'name' in e && e.name === 'PasswordException') {
      throw new PdfPasswordError(Boolean(password))
    }
    throw e
  }

  const lines: TextLine[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const pieces: TextPiece[] = []
    for (const item of content.items) {
      if ('str' in item) pieces.push({ x: item.transform[4], y: item.transform[5], s: item.str, w: item.width })
    }
    lines.push(...groupTextPieces(pieces, p))
  }
  return lines
}

export async function parsePdf(data: ArrayBuffer, password?: string): Promise<ParseResult> {
  const lines = await extractPdfLines(data, password)
  if (lines.length === 0) {
    return {
      format: 'pdf',
      transactions: [],
      warnings: ['This PDF has no readable text (it may be a scan). Try the CSV or OFX download from FNB instead.'],
    }
  }
  return parseStatementLines(lines)
}
