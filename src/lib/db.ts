import Dexie, { type EntityTable } from 'dexie'
import type { BudgetEntry, Category, CategoryGroup, ImportRecord, ParseResult, Rule, Transaction } from './types'
import { categorise, normaliseMerchant } from './categorise'
import { monthKey } from './format'

/** All data lives in this browser (IndexedDB). Nothing is sent to a server. */
export const db = new Dexie('codesolve-budgeting') as Dexie & {
  transactions: EntityTable<Transaction, 'id'>
  groups: EntityTable<CategoryGroup, 'id'>
  categories: EntityTable<Category, 'id'>
  budgets: EntityTable<BudgetEntry, 'id'>
  rules: EntityTable<Rule, 'id'>
  imports: EntityTable<ImportRecord, 'id'>
}

db.version(1).stores({
  transactions: '++id, &hash, month, date, categoryId, merchant, importId',
  groups: '++id, order',
  categories: '++id, groupId, name',
  budgets: '++id, &[month+categoryId], month, categoryId',
  rules: '++id, pattern, categoryId',
  imports: '++id, importedAt',
})

const DEFAULTS: { group: string; categories: string[] }[] = [
  { group: 'Income', categories: ['Salary', 'Other income'] },
  { group: 'Bills', categories: ['Rent & bond', 'Electricity & water', 'Phone & internet', 'Insurance', 'Medical aid'] },
  { group: 'Everyday', categories: ['Groceries', 'Fuel & transport', 'Eating out', 'Household', 'Health & pharmacy'] },
  { group: 'Lifestyle', categories: ['Subscriptions', 'Entertainment', 'Clothing', 'Gifts'] },
  { group: 'Money', categories: ['Savings', 'Bank fees', 'Transfers'] },
]

export async function ensureDefaults(): Promise<void> {
  await db.transaction('rw', db.groups, db.categories, async () => {
    if ((await db.groups.count()) > 0) return
    for (const [gi, g] of DEFAULTS.entries()) {
      const groupId = (await db.groups.add({ name: g.group, order: gi })) as number
      for (const [ci, name] of g.categories.entries()) {
        await db.categories.add({ groupId, name, order: ci, isIncome: g.group === 'Income' })
      }
    }
  })
}

async function categoriseContext() {
  const [rules, cats, userTx] = await Promise.all([
    db.rules.toArray(),
    db.categories.toArray(),
    db.transactions.filter((t) => t.categorySource === 'user' && t.categoryId !== null).toArray(),
  ])
  const byName = new Map(cats.map((c) => [c.name, c.id!]))
  const known = userTx.map((t) => ({ merchant: t.merchant, categoryId: t.categoryId! }))
  return { rules, byName, known }
}

export interface ImportSummary {
  added: number
  skipped: number
  categorised: number
  warnings: string[]
  months: string[]
}

/** Store parsed transactions, skipping ones already imported, and categorise them automatically. */
export async function importParsed(fileName: string, result: ParseResult): Promise<ImportSummary> {
  const ctx = await categoriseContext()
  const seen = new Map<string, number>()

  const rows = result.transactions.map((p) => {
    const base = `${p.date}|${p.amount.toFixed(2)}|${p.description.toLowerCase()}|${p.balance ?? ''}`
    // Two identical purchases on one day are both real: number repeats within the file.
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { p, hash: `${base}|${n}` }
  })

  const existing = new Set(
    (await db.transactions.where('hash').anyOf(rows.map((r) => r.hash)).toArray()).map((t) => t.hash),
  )
  const fresh = rows.filter((r) => !existing.has(r.hash))

  const importId = (await db.imports.add({
    fileName,
    format: result.format,
    importedAt: Date.now(),
    added: fresh.length,
    skipped: rows.length - fresh.length,
  })) as number

  let categorised = 0
  const txs: Transaction[] = fresh.map(({ p, hash }) => {
    const merchant = normaliseMerchant(p.description)
    const choice = categorise({ ...p, merchant }, ctx.rules, ctx.byName, ctx.known)
    if (choice.categoryId !== null) categorised++
    return {
      ...p,
      hash,
      merchant,
      categoryId: choice.categoryId,
      categorySource: choice.source,
      month: monthKey(p.date),
      importId,
    }
  })
  await db.transactions.bulkAdd(txs)

  return {
    added: txs.length,
    skipped: rows.length - fresh.length,
    categorised,
    warnings: result.warnings,
    months: [...new Set(txs.map((t) => t.month))].sort(),
  }
}

/**
 * The user picked a category. Remember it as a rule for this merchant and
 * re-categorise every other transaction from that merchant the user hasn't set by hand.
 */
export async function setCategory(txId: number, categoryId: number | null): Promise<number> {
  return db.transaction('rw', db.transactions, db.rules, async () => {
    const tx = await db.transactions.get(txId)
    if (!tx) return 0
    await db.transactions.update(txId, { categoryId, categorySource: categoryId === null ? 'none' : 'user' })
    if (categoryId === null) return 0

    const pattern = tx.merchant
    const existing = await db.rules.where('pattern').equals(pattern).first()
    if (existing) await db.rules.update(existing.id!, { categoryId, source: existing.source })
    else await db.rules.add({ pattern, categoryId, source: 'learned', createdAt: Date.now() })

    const others = await db.transactions
      .where('merchant').equals(tx.merchant)
      .filter((t) => t.id !== txId && t.categorySource !== 'user')
      .toArray()
    await Promise.all(others.map((t) => db.transactions.update(t.id!, { categoryId, categorySource: 'learned' })))
    return others.length
  })
}

export async function setAssigned(month: string, categoryId: number, assigned: number): Promise<void> {
  const existing = await db.budgets.where('[month+categoryId]').equals([month, categoryId]).first()
  if (existing) await db.budgets.update(existing.id!, { assigned })
  else await db.budgets.add({ month, categoryId, assigned })
}

/**
 * Auto-fill a month's budget: each spending category gets its average
 * spend over the previous three months (rounded up to the nearest R50).
 * With no earlier history, it uses the given month's own spending.
 */
export async function autoFillBudget(month: string, previousMonths: string[]): Promise<number> {
  const cats = await db.categories.filter((c) => !c.isIncome && !c.hidden).toArray()
  let txs = await db.transactions.where('month').anyOf(previousMonths).toArray()
  // First month with data: base it on what has been spent so far this month.
  if (txs.length === 0) txs = await db.transactions.where('month').equals(month).toArray()
  const monthsWithData = new Set(txs.map((t) => t.month)).size || 1
  let filled = 0
  for (const c of cats) {
    const spent = -txs.filter((t) => t.categoryId === c.id).reduce((s, t) => s + t.amount, 0)
    if (spent <= 0) continue
    const avg = Math.ceil(spent / monthsWithData / 50) * 50
    await setAssigned(month, c.id!, avg)
    filled++
  }
  return filled
}

export async function clearAllData(): Promise<void> {
  await db.delete()
  await db.open()
  await ensureDefaults()
}
