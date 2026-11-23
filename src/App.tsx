import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import logoFull from './assets/brand/logo-full.png'
import { BudgetView } from './components/BudgetView'
import { ImportView } from './components/ImportView'
import { TransactionsView } from './components/TransactionsView'
import { db, ensureDefaults, importParsed, type ImportSummary } from './lib/db'
import { currentMonth, monthLabel, shiftMonth } from './lib/format'
import { parseFile, PdfPasswordError } from './lib/parsers'

type View = 'budget' | 'transactions' | 'import'

const TITLES: Record<View, string> = { budget: 'Budget', transactions: 'Transactions', import: 'Import a statement' }

function PasswordPrompt({ fileName, wrong, onSubmit, onCancel }: {
  fileName: string
  wrong: boolean
  onSubmit: (pw: string) => void
  onCancel: () => void
}) {
  const [pw, setPw] = useState('')
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="pw-title">
      <form className="card modal" onSubmit={(e) => { e.preventDefault(); onSubmit(pw) }}>
        <h3 id="pw-title">This PDF is locked</h3>
        <p>{fileName} needs its password to open. It is only used to read the file on this device.</p>
        <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} aria-label="PDF password" />
        {wrong && <div className="err">That password didn't work. Try again.</div>}
        <div className="row">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!pw}>Open</button>
        </div>
      </form>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<View>('budget')
  const [month, setMonth] = useState(currentMonth())
  const [txFilter, setTxFilter] = useState<'all' | 'review'>('all')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<(ImportSummary & { fileName: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pwPrompt, setPwPrompt] = useState<{ file: File; wrong: boolean; rest: File[] } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => { ensureDefaults() }, [])

  // Open on the most recent month that has transactions.
  const latestMonth = useLiveQuery(async () => (await db.transactions.orderBy('month').last())?.month, [])
  const jumped = useRef(false)
  useEffect(() => {
    if (latestMonth && !jumped.current) { jumped.current = true; setMonth(latestMonth) }
  }, [latestMonth])

  const reviewCount = useLiveQuery(() => db.transactions.where('month').equals(month).filter((t) => t.categoryId === null).count(), [month]) ?? 0

  async function handleFiles(files: File[], password?: string) {
    if (files.length === 0) return
    setView('import')
    setBusy(true)
    setError(null)
    const [file, ...rest] = files
    try {
      const parsed = await parseFile(file, password)
      if (parsed.transactions.length === 0) {
        setResult(null)
        setError(`${file.name}: ${parsed.warnings[0] ?? 'No transactions found.'}`)
      } else {
        const summary = await importParsed(file.name, parsed)
        setResult({ ...summary, fileName: file.name })
        if (summary.months.length) setMonth(summary.months[summary.months.length - 1])
      }
      setPwPrompt(null)
      if (rest.length) await handleFiles(rest)
    } catch (e) {
      if (e instanceof PdfPasswordError) setPwPrompt({ file, wrong: e.wrongPassword, rest })
      else setError(`${file.name}: could not be read (${e instanceof Error ? e.message : String(e)}).`)
    } finally {
      setBusy(false)
    }
  }

  // Let people drop a file anywhere in the app, not just on the drop zone.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => { if (hasFiles(e)) { dragDepth.current++; setDragging(true) } }
    const leave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (e.dataTransfer?.files.length) handleFiles([...e.dataTransfer.files])
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  })

  const nav = (v: View, label: string, extra?: React.ReactNode) => (
    <button className="nav-btn" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
      {label}{extra}
    </button>
  )

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-full" src={logoFull} alt="CodeSolve" />
          <img className="brand-compact" src="/logo-compact.png" alt="CodeSolve" />
          <span className="brand-product">Budgeting</span>
        </div>
        {nav('budget', 'Budget')}
        {nav('transactions', 'Transactions', reviewCount > 0 && <span className="badge">{reviewCount}</span>)}
        {nav('import', 'Import')}
        <div className="sidebar-foot">Your statements are read on this device. Nothing is uploaded.</div>
      </aside>

      <main>
        <div className="page-head">
          <h1>{TITLES[view]}</h1>
          <div className="spacer" />
          {view !== 'import' && (
            <div className="month-switch">
              <button aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
              <span>{monthLabel(month)}</span>
              <button aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
            </div>
          )}
        </div>

        {view === 'budget' && (
          <BudgetView
            month={month}
            onImport={() => setView('import')}
            onReview={() => { setTxFilter('review'); setView('transactions') }}
          />
        )}
        {view === 'transactions' && <TransactionsView month={month} filter={txFilter} onFilter={setTxFilter} />}
        {view === 'import' && (
          <ImportView
            busy={busy}
            result={result}
            error={error}
            onFiles={(f) => handleFiles(f)}
            onReview={(m) => { setMonth(m); setTxFilter('review'); setView('transactions') }}
          />
        )}
      </main>

      {dragging && <div className="drag-overlay"><div>Drop to import your statement</div></div>}
      {pwPrompt && (
        <PasswordPrompt
          fileName={pwPrompt.file.name}
          wrong={pwPrompt.wrong}
          onCancel={() => setPwPrompt(null)}
          onSubmit={(pw) => handleFiles([pwPrompt.file, ...pwPrompt.rest], pw)}
        />
      )}
    </div>
  )
}
