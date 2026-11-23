import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { autoFillBudget, db, setAssigned } from '../lib/db'
import { cents, money, shiftMonth } from '../lib/format'
import type { Category } from '../lib/types'

interface Props {
  month: string
  onReview: () => void
  onImport: () => void
}

function AssignInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value ? value.toFixed(2) : '')
  const commit = () => {
    if (draft === null) return
    const n = parseFloat(draft.replace(/[^\d.-]/g, ''))
    onCommit(Number.isFinite(n) ? cents(n) : 0)
    setDraft(null)
  }
  return (
    <input
      className="assign-input"
      inputMode="decimal"
      placeholder="0.00"
      aria-label="Assigned amount"
      value={shown}
      onFocus={(e) => { setDraft(value ? String(value) : ''); requestAnimationFrame(() => e.target.select()) }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}

export function BudgetView({ month, onReview, onImport }: Props) {
  const data = useLiveQuery(async () => {
    const [groups, categories, budgets, txs] = await Promise.all([
      db.groups.orderBy('order').toArray(),
      db.categories.toArray(),
      db.budgets.where('month').belowOrEqual(month).toArray(),
      db.transactions.where('month').belowOrEqual(month).toArray(),
    ])
    return { groups, categories, budgets, txs }
  }, [month])
  const [filling, setFilling] = useState(false)

  if (!data) return null
  const { groups, categories, budgets, txs } = data
  const incomeIds = new Set(categories.filter((c) => c.isIncome).map((c) => c.id))

  const assignedThis = (id: number) => budgets.find((b) => b.month === month && b.categoryId === id)?.assigned ?? 0
  const assignedToDate = (id: number) => budgets.filter((b) => b.categoryId === id).reduce((s, b) => s + b.assigned, 0)
  const spentIn = (id: number, onlyThisMonth: boolean) =>
    -txs.filter((t) => t.categoryId === id && (!onlyThisMonth || t.month === month)).reduce((s, t) => s + t.amount, 0)

  const thisMonthTx = txs.filter((t) => t.month === month)
  const incomeThisMonth = thisMonthTx.filter((t) => t.categoryId !== null && incomeIds.has(t.categoryId)).reduce((s, t) => s + t.amount, 0)
  const spentThisMonth = -thisMonthTx.filter((t) => t.amount < 0 && !(t.categoryId !== null && incomeIds.has(t.categoryId))).reduce((s, t) => s + t.amount, 0)
  const incomeToDate = txs.filter((t) => t.categoryId !== null && incomeIds.has(t.categoryId)).reduce((s, t) => s + t.amount, 0)
  const assignedTotal = budgets.filter((b) => !incomeIds.has(b.categoryId)).reduce((s, b) => s + b.assigned, 0)
  const leftToAssign = cents(incomeToDate - assignedTotal)
  const needsReview = thisMonthTx.filter((t) => t.categoryId === null).length
  const hasAnyData = txs.length > 0

  const fill = async () => {
    setFilling(true)
    await autoFillBudget(month, [shiftMonth(month, -1), shiftMonth(month, -2), shiftMonth(month, -3)])
    setFilling(false)
  }

  const row = (c: Category) => {
    const id = c.id!
    const assigned = assignedThis(id)
    const spent = cents(spentIn(id, true))
    const available = cents(assignedToDate(id) - spentIn(id, false))
    const pct = assigned > 0 ? Math.min(100, (spent / assigned) * 100) : spent > 0 ? 100 : 0
    return (
      <div className="budget-row" key={id}>
        <div className="cat-name">
          {c.name}
          <div className="bar"><i className={available < 0 ? 'over' : ''} style={{ width: `${pct}%` }} /></div>
        </div>
        <AssignInput value={assigned} onCommit={(n) => setAssigned(month, id, n)} />
        <div className="num col-spent">{money(spent)}</div>
        <div className="num">
          <span className={`pill ${available > 0 ? 'pos' : available < 0 ? 'neg' : 'zero'}`}>{money(available)}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="summary">
        <div className={`card stat hero ${leftToAssign < 0 ? 'over' : ''}`}>
          <div className="label">{leftToAssign < 0 ? 'Assigned more than you have' : 'Left to assign'}</div>
          <div className="value num" style={{ textAlign: 'left' }}>{money(leftToAssign)}</div>
          <div className="hint">
            {leftToAssign > 0 ? 'Give every rand a job below.' : leftToAssign < 0 ? 'Lower some amounts below.' : hasAnyData ? 'Every rand has a job.' : 'Import a statement to get started.'}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Income this month</div>
          <div className="value num" style={{ textAlign: 'left' }}>{money(incomeThisMonth)}</div>
        </div>
        <div className="card stat">
          <div className="label">Spent this month</div>
          <div className="value num" style={{ textAlign: 'left' }}>{money(spentThisMonth)}</div>
        </div>
      </div>

      {!hasAnyData && (
        <div className="notice good">
          No transactions yet. Drop an FNB statement anywhere on this page, or
          <button className="btn primary" onClick={onImport}>Import a statement</button>
        </div>
      )}
      {needsReview > 0 && (
        <div className="notice">
          <span className="badge">{needsReview}</span>
          {needsReview === 1 ? 'transaction this month needs a category.' : 'transactions this month need a category.'}
          <button className="btn" onClick={onReview}>Review</button>
        </div>
      )}

      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="spacer" />
        <button className="btn" onClick={fill} disabled={filling || !hasAnyData} title="Sets each category to your average spending over the last 3 months">
          {filling ? <span className="spinner" /> : '✦'} Auto-fill from past spending
        </button>
      </div>

      <div className="card budget">
        <div className="budget-row head">
          <div>Category</div>
          <div className="num">Assigned</div>
          <div className="num col-spent">Spent</div>
          <div className="num">Available</div>
        </div>
        {groups
          .filter((g) => !categories.some((c) => c.groupId === g.id && c.isIncome))
          .map((g) => (
            <div key={g.id}>
              <div className="budget-row group"><div>{g.name}</div></div>
              {categories.filter((c) => c.groupId === g.id && !c.hidden).sort((a, b) => a.order - b.order).map(row)}
            </div>
          ))}
      </div>
    </>
  )
}
