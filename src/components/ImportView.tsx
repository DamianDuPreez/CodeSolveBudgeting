import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { clearAllData, db, type ImportSummary } from '../lib/db'
import { isFirebaseConfigured } from '../lib/firebase'
import { monthLabel } from '../lib/format'
import { Icon } from './Icon'
import { StatementInspector } from './StatementInspector'

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
      <div className="import-grid">
        <div>
          <div
            className={`dropzone ${over ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            // The app-wide drop handler imports the file; this only resets the highlight.
            onDrop={() => setOver(false)}
          >
            <div className="icon">{busy ? <span className="spinner" /> : <Icon name="upload" size={30} />}</div>
            <h2>{busy ? 'Reading your statement…' : 'Drop your FNB statement here'}</h2>
            <p>or click to choose a file. Every transaction is read, sorted into a category and added to your budget.</p>
            <div className="formats">
              <span className="chip"><Icon name="file" size={13} /> PDF statement</span>
              <span className="chip"><Icon name="file" size={13} /> CSV</span>
              <span className="chip"><Icon name="file" size={13} /> OFX</span>
            </div>
            <div className="privacy"><Icon name="lock" size={14} /> {isFirebaseConfigured ? 'The file is read on this device and never uploaded.' : 'Read on this device. Never uploaded.'}</div>
            <input
              ref={input}
              type="file"
              accept=".pdf,.csv,.ofx,.qfx,.txt"
              multiple
              hidden
              onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }}
            />
          </div>

          {error && <div className="notice" style={{ marginTop: 22, marginBottom: 0 }}><Icon name="alert" /> {error}</div>}

          {result && (
            <div className="card result">
              <div className="result-head">
                <div className="ok"><Icon name="check" size={20} /></div>
                <div>
                  <h3>Statement imported</h3>
                  <span>{result.fileName}</span>
                </div>
              </div>
              <div className="result-stats">
                <div><b>{result.added}</b><span>New transactions</span></div>
                <div><b>{result.categorised}</b><span>Sorted automatically</span></div>
                <div><b>{result.added - result.categorised}</b><span>Need your review</span></div>
                {result.updated > 0 && <div><b>{result.updated}</b><span>Shop names improved</span></div>}
                {result.skipped > 0 && <div><b>{result.skipped}</b><span>Already imported</span></div>}
              </div>
              {result.warnings.length > 0 && (
                <ul>{[...new Set(result.warnings)].slice(0, 5).map((w) => <li key={w}>{w}</li>)}</ul>
              )}
              {result.months.length > 0 && (
                <div className="actions">
                  {result.months.map((m) => (
                    <button key={m} className="btn" onClick={() => onReview(m)}>Review {monthLabel(m)}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card steps">
          <h2>Getting your statement</h2>
          <div className="step"><span className="n">1</span><div><b>Open the FNB app</b><span>Tap your account, then Statements.</span></div></div>
          <div className="step"><span className="n">2</span><div><b>Download the PDF</b><span>Pick a month and save or share the PDF to this computer.</span></div></div>
          <div className="step"><span className="n">3</span><div><b>Drop it here</b><span>Fix a category once and that shop is sorted for you from then on.</span></div></div>
        </div>
      </div>

      <StatementInspector />

      {history && history.length > 0 && (
        <>
          <div className="section-title">Previous imports</div>
          <div className="card history">
            {history.map((h) => (
              <div className="history-row" key={h.id}>
                <div className="ficon"><Icon name="file" size={17} /></div>
                <div className="fname">{h.fileName}</div>
                <div className="num right">{h.added} added</div>
                <div className="when">{new Date(h.importedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <button
              className="btn ghost danger sm"
              onClick={async () => {
                if (confirm(isFirebaseConfigured ? 'Delete all transactions, budgets and learned rules from your account, on every device? This cannot be undone.' : 'Delete all transactions, budgets and learned rules from this browser? This cannot be undone.')) await clearAllData()
              }}
            >
              <Icon name="trash" size={15} /> {isFirebaseConfigured ? 'Delete all my budget data' : 'Delete all data on this device'}
            </button>
          </div>
        </>
      )}
    </>
  )
}
