import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { autoFillBudget, db, setAssigned } from '../lib/db'
import { cents, money, shiftMonth } from '../lib/format'
import type { Category } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  month: string
  onReview: () => void
  onImport: () => void
}

function AssignInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value ? money(value) : '')
  const commit = () => {
    if (draft === null) return
    const n = parseFloat(draft.replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
    onCommit(Number.isFinite(n) ? cents(n) : 0)
    setDraft(null)
  }
  return (
    <input
      className="assign-input"
      inputMode="decimal"
      placeholder="R 0,00"
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

function initials(name: string): string {
  const words = name.replace(/&/g, ' ').split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase()
}

/** Ranked bars of this month's spending: one hue, sized by amount, labelled with the value. */
function SpendingBreakdown({ items, total }: { items: { name: string; value: number }[]; total: number }) {
  const top = items.slice(0, 6)
  const rest = items.slice(6).reduce((s, i) => s + i.value, 0)
  const rows = rest > 0 ? [...top, { name: 'Everything else', value: rest, other: true }] : top
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="card">
      <div className="card-head">
        <h2>Where it went</h2>
        <span className="sub">This month</span>
      </div>
      <div className="breakdown">
        {rows.length === 0 && <div className="bd-empty">No spending recorded for this month yet.</div>}
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.value / total) * 100) : 0
          return (
            <div className="bd-row" key={r.name} title={`${r.name}: ${money(r.value)} (${pct}% of spending)`}>
              <div className="bd-top">
                <span className="name">{r.name}</span>
                <span className="num"><span className="val">{money(r.value)}</span><span className="pct">{pct}%</span></span>
              </div>
              <div className={`bd-bar ${'other' in r ? 'other' : ''}`} style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          )
        })}
        {rows.length > 0 && (
          <div className="bd-total"><span>Total spent</span><span className="num">{money(total)}</span></div>
        )}
      </div>
    </div>
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
  const isIncome = (id: number | null) => id !== null && incomeIds.has(id)

  const assignedThis = (id: number) => budgets.find((b) => b.month === month && b.categoryId === id)?.assigned ?? 0
  const assignedToDate = (id: number) => budgets.filter((b) => b.categoryId === id).reduce((s, b) => s + b.assigned, 0)
  const spentIn = (id: number, onlyThisMonth: boolean) =>
    -txs.filter((t) => t.categoryId === id && (!onlyThisMonth || t.month === month)).reduce((s, t) => s + t.amount, 0)

  const thisMonthTx = txs.filter((t) => t.month === month)
  const incomeTx = thisMonthTx.filter((t) => isIncome(t.categoryId))
  const spendTx = thisMonthTx.filter((t) => t.amount < 0 && !isIncome(t.categoryId))
  const incomeThisMonth = incomeTx.reduce((s, t) => s + t.amount, 0)
  const spentThisMonth = -spendTx.reduce((s, t) => s + t.amount, 0)
  const incomeToDate = txs.filter((t) => isIncome(t.categoryId)).reduce((s, t) => s + t.amount, 0)
  const assignedTotal = budgets.filter((b) => !incomeIds.has(b.categoryId)).reduce((s, b) => s + b.assigned, 0)
  const leftToAssign = cents(incomeToDate - assignedTotal)
  const needsReview = thisMonthTx.filter((t) => t.categoryId === null).length
  const hasAnyData = txs.length > 0

  const byCategory = new Map<string, number>()
  for (const t of spendTx) {
    const name = t.categoryId === null ? 'Not sorted yet' : categories.find((c) => c.id === t.categoryId)?.name ?? 'Other'
    byCategory.set(name, (byCategory.get(name) ?? 0) - t.amount)
  }
  const breakdown = [...byCategory.entries()].map(([name, value]) => ({ name, value: cents(value) })).sort((a, b) => b.value - a.value)

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
    const state = assigned === 0 ? 'unbudgeted' : available < 0 ? 'over' : spent >= assigned ? 'full' : ''
    return (
      <div className="budget-row" key={id}>
        <div className="cat-cell">
          <div className="cat-avatar" aria-hidden="true">{initials(c.name)}</div>
          <div className="cat-info">
            <div className="name">{c.name}</div>
            <div className="meter"><i className={state} style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
        <AssignInput value={assigned} onCommit={(n) => setAssigned(month, id, n)} />
        <div className="num right col-spent spent">{money(spent)}</div>
        <div className="right">
          <span className={`pill ${available > 0 ? 'pos' : available < 0 ? 'neg' : 'zero'}`}>{money(available)}</span>
        </div>
      </div>
    )
  }

  const visibleGroups = groups.filter((g) => !categories.some((c) => c.groupId === g.id && c.isIncome))

  return (
    <>
      <div className="overview">
        <div className={`hero ${leftToAssign < 0 ? 'over' : ''}`}>
          <div className="label"><Icon name="wallet" size={16} /> {leftToAssign < 0 ? 'Assigned more than you have' : 'Left to assign'}</div>
          <div className="value num">{money(leftToAssign)}</div>
          {incomeToDate > 0 && (
            <div className="hero-meter" title={`${Math.round(Math.min(100, (assignedTotal / incomeToDate) * 100))}% of your money has a job`}>
              <i style={{ width: `${Math.min(100, Math.max(0, (assignedTotal / incomeToDate) * 100))}%` }} />
            </div>
          )}
          <div className="hint">
            {leftToAssign > 0 ? 'Give every rand a job in the categories below.'
              : leftToAssign < 0 ? 'Lower some category amounts below.'
              : hasAnyData ? 'Every rand has a job. Nicely done.' : 'Import a statement to get started.'}
          </div>
          <div className="actions">
            {hasAnyData ? (
              <button className="btn light" onClick={fill} disabled={filling} title="Sets each category to your average spending over the last 3 months">
                {filling ? <span className="spinner dark" /> : <Icon name="sparkles" size={16} />} Auto-fill my budget
              </button>
            ) : (
              <button className="btn light" onClick={onImport}><Icon name="upload" size={16} /> Import a statement</button>
            )}
          </div>
        </div>
        <div className="card stat">
          <div className="top"><span className="label">Income this month</span><span className="icon in"><Icon name="in" size={15} /></span></div>
          <div className="value num">{money(incomeThisMonth)}</div>
          <div className="meta">{incomeTx.length} payment{incomeTx.length === 1 ? '' : 's'} in</div>
        </div>
        <div className="card stat">
          <div className="top"><span className="label">Spent this month</span><span className="icon out"><Icon name="out" size={15} /></span></div>
          <div className="value num">{money(spentThisMonth)}</div>
          <div className="meta">{spendTx.length} transaction{spendTx.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div className="budget-layout">
        <div className="card budget">
          <div className="budget-row head">
            <div>Category</div>
            <div className="right">Assigned</div>
            <div className="right col-spent">Spent</div>
            <div className="right">Available</div>
          </div>
          {visibleGroups.map((g) => {
            const cats = categories.filter((c) => c.groupId === g.id && !c.hidden).sort((a, b) => a.order - b.order)
            const groupAvail = cents(cats.reduce((s, c) => s + assignedToDate(c.id!) - spentIn(c.id!, false), 0))
            return (
              <div key={g.id}>
                <div className="budget-row group">
                  <div className="gname">{g.name}</div>
                  <div className="num right">{money(cats.reduce((s, c) => s + assignedThis(c.id!), 0))}</div>
                  <div className="num right col-spent">{money(cents(cats.reduce((s, c) => s + spentIn(c.id!, true), 0)))}</div>
                  <div className="num right">{money(groupAvail)}</div>
                </div>
                {cats.map(row)}
              </div>
            )
          })}
        </div>

        <div className="side-stack">
          {needsReview > 0 ? (
            <div className="card review-card">
              <h3><span className="badge">{needsReview}</span> Need a category</h3>
              <p>Sort {needsReview === 1 ? 'this one' : 'these'} once and the app remembers the shop for next time.</p>
              <button className="btn primary" onClick={onReview}>Review transactions</button>
            </div>
          ) : hasAnyData ? (
            <div className="notice good" style={{ margin: 0 }}><Icon name="check" /> Everything this month is sorted.</div>
          ) : null}
          <SpendingBreakdown items={breakdown} total={cents(spentThisMonth)} />
        </div>
      </div>
    </>
  )
}
