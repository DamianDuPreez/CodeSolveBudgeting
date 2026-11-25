import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db, setCategory } from '../lib/db'
import { money } from '../lib/format'
import type { Transaction } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  month: string
  filter: 'all' | 'review'
  onFilter: (f: 'all' | 'review') => void
}

const SOURCE_LABEL: Record<Transaction['categorySource'], string> = {
  keyword: 'Auto-sorted · known shop',
  learned: 'Auto-sorted · learned from you',
  rule: 'Auto-sorted · your rule',
  user: '',
  none: '',
}

/** Abbreviations that stay in capitals; every other word is written normally. */
const ACRONYMS = new Set(['FNB', 'ATM', 'KFC', 'MTN', 'BP', 'PNP', 'DSTV', 'SARS', 'EFT', 'CBD', 'SA', 'OK', 'H&M', 'TFG', 'CNA', 'PEP', 'UK', 'USA'])

/** "STEAM PURCHASE" → "Steam Purchase", "KFC ROSEBANK" → "KFC Rosebank". */
function prettyName(merchant: string): string {
  return merchant
    .split(' ')
    .map((w) => (ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ')
}

function dayHeading(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })
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

  const days = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const rows = data.txs
      .filter((t) => filter === 'all' || t.categoryId === null)
      .filter((t) => !q || t.description.toLowerCase().includes(q) || t.merchant.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0))
    const out: { date: string; items: Transaction[] }[] = []
    for (const t of rows) {
      const last = out[out.length - 1]
      if (last && last.date === t.date) last.items.push(t)
      else out.push({ date: t.date, items: [t] })
    }
    return out
  }, [data, filter, query])

  if (!data) return null
  const reviewCount = data.txs.filter((t) => t.categoryId === null).length
  const shown = days.reduce((s, d) => s + d.items.length, 0)

  const change = async (t: Transaction, value: string) => {
    const others = await setCategory(t.id!, value === '' ? null : Number(value))
    if (others > 0) {
      setToast(`Sorted ${others} more from ${prettyName(t.merchant)}. Future ones will be sorted automatically.`)
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
        <div className="search">
          <Icon name="search" size={17} />
          <input className="input" placeholder="Search shops and descriptions" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="summary-text">{shown} transaction{shown === 1 ? '' : 's'}</span>
      </div>

      {days.length === 0 && (
        <div className="card empty">
          {filter === 'review' && data.txs.length > 0 ? (
            <><div className="icon"><Icon name="check" size={24} /></div><b>All sorted</b>Every transaction this month has a category.</>
          ) : (
            <><b>No transactions</b>Nothing for this month yet. Import a statement to see it here.</>
          )}
        </div>
      )}

      {days.map((day) => {
        const net = day.items.reduce((s, t) => s + t.amount, 0)
        return (
          <section className="day" key={day.date}>
            <div className="day-head">
              <span>{dayHeading(day.date)}</span>
              <span className="num">{net > 0 ? '+' : ''}{money(net)}</span>
            </div>
            <div className="card tx-list">
              {day.items.map((t) => {
                const name = prettyName(t.merchant)
                return (
                  <div className={`tx ${t.categoryId === null ? 'needs' : ''}`} key={t.id}>
                    <div className={`tx-avatar ${t.amount > 0 ? 'in' : ''}`} aria-hidden="true">{name.charAt(0)}</div>
                    <div className="main">
                      <div className="merchant">{name}</div>
                      <div className="desc" title={t.description}>{t.description}</div>
                    </div>
                    <div className="cat">
                      <select
                        className={`cat-select ${t.categoryId === null ? 'unset' : ''}`}
                        value={t.categoryId ?? ''}
                        onChange={(e) => change(t, e.target.value)}
                        aria-label={`Category for ${name}`}
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
                      {SOURCE_LABEL[t.categorySource] && (
                        <div className="auto-tag"><Icon name="sparkles" size={12} />{SOURCE_LABEL[t.categorySource]}</div>
                      )}
                    </div>
                    <div className={`num amount ${t.amount > 0 ? 'in' : ''}`}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {toast && <div className="toast" role="status"><Icon name="sparkles" />{toast}</div>}
    </>
  )
}
