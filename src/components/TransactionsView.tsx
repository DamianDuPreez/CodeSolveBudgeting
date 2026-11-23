import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db, setCategory } from '../lib/db'
import { dayLabel, money } from '../lib/format'
import type { Transaction } from '../lib/types'

interface Props {
  month: string
  filter: 'all' | 'review'
  onFilter: (f: 'all' | 'review') => void
}

const SOURCE_LABEL: Record<Transaction['categorySource'], string> = {
  keyword: 'Auto · known merchant',
  learned: 'Auto · learned from you',
  rule: 'Auto · your rule',
  user: '',
  none: '',
}

export function TransactionsView({ month, filter, onFilter }: Props) {
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const [txs, categories, groups] = await Promise.all([
      db.transactions.where('month').equals(month).toArray(),
      db.categories.toArray(),
      db.groups.orderBy('order').toArray(),
    ])
    return { txs, categories, groups }
  }, [month])

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.txs
      .filter((t) => filter === 'all' || t.categoryId === null)
      .filter((t) => !q || t.description.toLowerCase().includes(q) || t.merchant.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0))
  }, [data, filter, query])

  if (!data) return null
  const reviewCount = data.txs.filter((t) => t.categoryId === null).length

  const change = async (t: Transaction, value: string) => {
    const others = await setCategory(t.id!, value === '' ? null : Number(value))
    if (others > 0) {
      setToast(`Also categorised ${others} other ${t.merchant} transaction${others === 1 ? '' : 's'}. Future ones will be done automatically.`)
      setTimeout(() => setToast(null), 4500)
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter">
          <button aria-pressed={filter === 'all'} onClick={() => onFilter('all')}>All</button>
          <button aria-pressed={filter === 'review'} onClick={() => onFilter('review')}>
            Needs review {reviewCount > 0 && <span className="badge">{reviewCount}</span>}
          </button>
        </div>
        <input className="input" placeholder="Search transactions" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {toast && <div className="notice good">{toast}</div>}

      <div className="card tx-list">
        {rows.length === 0 && (
          <div className="empty">
            {filter === 'review' && data.txs.length > 0 ? 'Nothing to review — everything this month has a category.' : 'No transactions for this month.'}
          </div>
        )}
        {rows.map((t) => (
          <div className={`tx ${t.categoryId === null ? 'needs' : ''}`} key={t.id}>
            <div className="date">{dayLabel(t.date)}</div>
            <div className="main">
              <div className="merchant">{t.merchant}</div>
              <div className="desc" title={t.description}>{t.description}</div>
            </div>
            <div className="cat">
              <select
                className={`select cat-select ${t.categoryId === null ? 'unset' : ''}`}
                value={t.categoryId ?? ''}
                onChange={(e) => change(t, e.target.value)}
                aria-label={`Category for ${t.merchant}`}
              >
                <option value="">Choose a category…</option>
                {data.groups.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {data.categories.filter((c) => c.groupId === g.id).sort((a, b) => a.order - b.order).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {SOURCE_LABEL[t.categorySource] && <div className="auto-tag">{SOURCE_LABEL[t.categorySource]}</div>}
            </div>
            <div className={`num amount ${t.amount > 0 ? 'in' : ''}`}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</div>
          </div>
        ))}
      </div>
    </>
  )
}
