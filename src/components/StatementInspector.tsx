import { useRef, useState } from 'react'
import { extractPdfLines, PdfPasswordError } from '../lib/parsers/pdf'
import { Icon } from './Icon'

/** Mask anything that could identify an account or card: runs of 4+ digits, emails, ID-like numbers. */
function mask(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\d[\d ]{3,}\d/g, (m) => (/\d{4,}/.test(m.replace(/ /g, '')) ? '••••' : m))
}

/**
 * Shows the raw text layout around "POS Purchase" rows, masked, so the user can share it to
 * help tune the reader without sending their statement.
 */
export function StatementInspector() {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [output, setOutput] = useState('')
  const [copied, setCopied] = useState(false)

  const run = async (f: File, pw?: string) => {
    setFile(f)
    setOutput('')
    try {
      const lines = await extractPdfLines(await f.arrayBuffer(), pw || undefined)
      setNeedsPassword(false)
      const keep = new Set<number>()
      // Card purchases, plus rows that are only a date and amounts: both show how FNB lays these out.
      const interesting = (t: string) => /pos purchase/i.test(t) || /^\s*\d{1,2}\s+[A-Za-z]{3}\s+-?[\d ,]+\.\d{2}/.test(t)
      lines.forEach((l, i) => {
        if (interesting(l.text)) for (let j = i - 3; j <= i + 3; j++) if (j >= 0 && j < lines.length) keep.add(j)
      })
      const picked = [...keep].sort((a, b) => a - b).slice(0, 60)
      let prev = -2
      const out: string[] = []
      for (const i of picked) {
        if (i !== prev + 1) out.push('---')
        const l = lines[i]
        out.push(`p${l.page} x${Math.round(l.x ?? 0)} y${Math.round(l.y ?? 0)} | ${mask(l.text)}`)
        prev = i
      }
      setOutput(out.length ? out.join('\n') : 'No "POS Purchase" rows were found in this PDF.')
    } catch (e) {
      if (e instanceof PdfPasswordError) setNeedsPassword(true)
      else setOutput(`Could not read the PDF: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <details className="card inspector">
      <summary><Icon name="search" size={16} /> Shop names missing? Inspect a statement</summary>
      <div className="inspector-body">
        <p>
          Choose your FNB PDF to see how its text is laid out around card purchases. Only those rows are shown,
          with long numbers and email addresses masked. Check the text, then copy it to Claude to tune the reader.
        </p>
        <div className="inspector-actions">
          <button className="btn sm" onClick={() => input.current?.click()}><Icon name="file" size={15} /> Choose PDF</button>
          {needsPassword && file && (
            <form onSubmit={(e) => { e.preventDefault(); run(file, password) }} style={{ display: 'flex', gap: 8 }}>
              <input className="input" type="password" placeholder="PDF password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="PDF password" />
              <button className="btn sm primary" type="submit">Open</button>
            </form>
          )}
          {output && (
            <button
              className="btn sm"
              onClick={async () => { await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            >
              <Icon name={copied ? 'check' : 'list'} size={15} /> {copied ? 'Copied' : 'Copy text'}
            </button>
          )}
        </div>
        <input ref={input} type="file" accept=".pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = '' }} />
        {output && <pre className="inspector-output">{output}</pre>}
      </div>
    </details>
  )
}
