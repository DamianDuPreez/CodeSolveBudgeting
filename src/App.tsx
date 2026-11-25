import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import logoFull from './assets/brand/logo-full.png'
import { BudgetView } from './components/BudgetView'
import { Icon, type IconName } from './components/Icon'
import { ImportView } from './components/ImportView'
import { TransactionsView } from './components/TransactionsView'
import { useAuth } from './lib/auth'
import { db, ensureDefaults, importParsed, type ImportSummary } from './lib/db'
import { isFirebaseConfigured } from './lib/firebase'
import { isSyncing } from './lib/sync'
import { currentMonth, monthLabel, shiftMonth } from './lib/format'
import { parseFile, PdfPasswordError } from './lib/parsers'

type View = 'budget' | 'transactions' | 'import'

const HEADINGS: Record<View, { title: string; sub: (month: string) => string }> = {
  budget: { title: 'Budget', sub: (m) => `Where your money stands for ${monthLabel(m)}.` },
  transactions: { title: 'Transactions', sub: (m) => `Everything that went in and out in ${monthLabel(m)}.` },
  import: { title: 'Import a statement', sub: () => 'Drop in your FNB statement and the sorting is done for you.' },
}

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
        <div className="micon"><Icon name="lock" size={20} /></div>
        <h3 id="pw-title">This PDF is locked</h3>
        <p>{fileName} needs its password to open. It's only used to read the file on this device.</p>
        <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} aria-label="PDF password" />
        {wrong && <div className="err">That password didn't work. Try again.</div>}
        <div className="row">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!pw}>Open statement</button>
        </div>
      </form>
    </div>
  )
}

function SideUser() {
  const { user, profile, signOut } = useAuth()
  if (!user) return null
  const name = profile?.name || user.displayName || user.email || 'Signed in'
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
  return (
    <div className="side-user">
      <div className="avatar">{user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : initials}</div>
      <div className="who">
        <b>{name}</b>
        <span>{user.email}</span>
      </div>
      <button aria-label="Sign out" title="Sign out" onClick={() => signOut()}><Icon name="logout" size={17} /></button>
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

  // Signed in, the account's data is set up by the sync layer instead.
  useEffect(() => { if (!isSyncing()) ensureDefaults() }, [])

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
    // Capture phase: runs before any element can stop the event, so the overlay always closes.
    const drop = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (e.dataTransfer?.files.length) handleFiles([...e.dataTransfer.files])
    }
    const reset = () => { dragDepth.current = 0; setDragging(false) }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop, true)
    window.addEventListener('dragend', reset)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop, true)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('blur', reset)
    }
  })

  const nav = (v: View, label: string, icon: IconName, extra?: ReactNode) => (
    <button className="nav-btn" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
      <Icon name={icon} size={19} />
      {label}
      {extra}
    </button>
  )

  const heading = HEADINGS[view]

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-full" src={logoFull} alt="CodeSolve" />
          <img className="brand-compact" src="/logo-compact.png" alt="CodeSolve" />
          <span className="brand-product">Budgeting</span>
        </div>
        <div className="nav-label">Menu</div>
        {nav('budget', 'Budget', 'wallet')}
        {nav('transactions', 'Transactions', 'list', reviewCount > 0 && <span className="badge">{reviewCount}</span>)}
        {nav('import', 'Import', 'upload')}
        <div className="side-card">
          <b><Icon name="lock" size={15} /> Private by design</b>
          {isFirebaseConfigured
            ? 'Statements are read on this device and never uploaded. Only the transactions are saved to your account.'
            : 'Statements are read on this device. Nothing is uploaded anywhere.'}
        </div>
        {isFirebaseConfigured && <SideUser />}
      </aside>

      <main>
        <div className="page-head">
          <div>
            <h1>{heading.title}</h1>
            <p>{heading.sub(month)}</p>
          </div>
          <div className="spacer" />
          {view !== 'import' && (
            <div className="month-switch">
              <button aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" /></button>
              <span>{monthLabel(month)}</span>
              <button aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" /></button>
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

      {dragging && <div className="drag-overlay"><div><Icon name="upload" size={26} /> Drop to import your statement</div></div>}
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
