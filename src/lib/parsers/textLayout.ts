import type { TextLine } from './statementText'

export interface TextPiece {
  x: number
  y: number
  s: string
  w: number
}

/** Rebuild visual lines from positioned text pieces of one PDF page. */
export function groupTextPieces(pieces: TextPiece[], page: number): TextLine[] {
  const items = pieces.filter((p) => p.s.trim()).sort((a, b) => b.y - a.y)
  // Pieces within ~2.5pt vertically belong to the same row.
  const rows: { y: number; parts: TextPiece[] }[] = []
  for (const it of items) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row.y - it.y) <= 2.5) row.parts.push(it)
    else rows.push({ y: it.y, parts: [it] })
  }
  return rows.map((row) => {
    const parts = row.parts.sort((a, b) => a.x - b.x)
    let text = ''
    let end = -Infinity
    for (const part of parts) {
      // A wide gap means a new column; keep at least two spaces there.
      text += text && part.x - end > 4 ? '  ' : text ? ' ' : ''
      text += part.s
      end = part.x + part.w
    }
    return { text, x: parts[0].x, y: row.y, page }
  })
}
