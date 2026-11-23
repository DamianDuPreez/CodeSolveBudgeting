import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { clearAllData, db, type ImportSummary } from '../lib/db'
import { monthLabel } from '../lib/format'

interface Props {
  busy: boolean
  result: (ImportSummary & { fileName: string }) | null
  error: string | null
  onFiles: (files: File[]) => void
  onReview: (month: string) => void
}

export function ImportView({ busy, result, error, onFiles, onReview }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const history = useLiveQuery(() => db.imports.orderBy('importedAt').reverse().limit(20).toArray(), [])

  return (
    <>
      <div
        className={`dropzone ${over ? 'active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); onFiles([...e.dataTransfer.files]) }}
      >
        <div className="icon">
          {busy ? <span className="spinner" /> : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
            </svg>
          )}
        </div>
        <h2>{busy ? 'Reading your statement…' : 'Drop your FNB statement here'}</h2>
        <p>or click to choose a file. We read it, sort every transaction and update your budget.</p>
        <div className="formats">PDF statement · CSV · OFX — read on this device, never uploaded</div>
        <input
          ref={input}
          type="file"
          accept=".pdf,.csv,.ofx,.qfx,.txt"
          multiple
          hidden
          onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }}
        />
      </div>

      {error && <div className="notice" style={{ marginTop: 18 }}>{error}</div>}

      {result && (
        <div className="card result">
          <h3>{result.fileName}</h3>
          <div className="result-stats">
            <div><b>{result.added}</b><span>new transactions</span></div>
            <div><b>{result.categorised}</b><span>sorted automatically</span></div>
            <div><b>{result.added - result.categorised}</b><span>need your review</span></div>
            {result.skipped > 0 && <div><b>{result.skipped}</b><span>already imported</span></div>}
          </div>
          {result.warnings.length > 0 && (
            <ul>{[...new Set(result.warnings)].slice(0, 5).map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          {result.months.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {result.months.map((m) => (
                <button key={m} className="btn" onClick={() => onReview(m)}>Review {monthLabel(m)}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="help">
        <div className="card"><b>Best: PDF statement</b>FNB app or Online Banking → Accounts → Statements → download the PDF.</div>
        <div className="card"><b>Also works: CSV or OFX</b>Online Banking → your account → Transaction history → Download.</div>
        <div className="card"><b>It learns</b>Fix a category once and every future transaction from that shop is sorted for you.</div>
      </div>

      {history && history.length > 0 && (
        <>
          <div className="section-title">Previous imports</div>
          <div className="card history">
            {history.map((h) => (
              <div className="history-row" key={h.id}>
                <div>{h.fileName}</div>
                <div className="num">{h.added} added</div>
                <div className="num" style={{ color: 'var(--muted)' }}>{new Date(h.importedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <button
              className="btn ghost danger"
              onClick={async () => {
                if (confirm('Delete all transactions, budgets and learned rules from this browser? This cannot be undone.')) await clearAllData()
              }}
            >
              Delete all data on this device
            </button>
          </div>
        </>
      )}
    </>
  )
}
