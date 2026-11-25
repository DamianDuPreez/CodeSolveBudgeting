import Dexie, { type EntityTable } from 'dexie'
import type { BudgetEntry, Category, CategoryGroup, ImportRecord, ParseResult, Rule, Transaction } from './types'
import { categorise, isGenericMerchant, normaliseMerchant } from './categorise'
import { monthKey } from './format'

export type BudgetDb = Dexie & {
  transactions: EntityTable<Transaction, 'id'>
  groups: EntityTable<CategoryGroup, 'id'>
  categories: EntityTable<Category, 'id'>
  budgets: EntityTable<BudgetEntry, 'id'>
  rules: EntityTable<Rule, 'id'>
  imports: EntityTable<ImportRecord, 'id'>
}

export const TABLES = ['groups', 'categories', 'rules', 'imports', 'budgets', 'transactions'] as const
export type TableName = (typeof TABLES)[number]

/** A local change the sync layer should send to the account. */
export type ChangeListener = (table: TableName, id: number, row: object | null) => void

let lastId = 0
/**
 * IDs are unique across devices (time-based plus random), unlike 1, 2, 3, so two devices
 * adding records at the same time never clash once their data is merged in the account.
 * They stay below 2^53, so they are still plain numbers.
 */
export function newId(): number {
  lastId = Math.max(Date.now() * 1024 + Math.floor(Math.random() * 1024), lastId + 1)
  return lastId
}

/** Transactions marked with this flag are changes that came from the account; they are not sent back. */
export const FROM_REMOTE = '__fromRemote'

export function openBudgetDb(name: string, onChange?: ChangeListener): BudgetDb {
  const d = new Dexie(name) as BudgetDb
  d.version(1).stores({
    transactions: '++id, &hash, month, date, categoryId, merchant, importId',
    groups: '++id, order',
    categories: '++id, groupId, name',
    budgets: '++id, &[month+categoryId], month, categoryId',
    rules: '++id, pattern, categoryId',
    imports: '++id, importedAt',
  })
  for (const tableName of TABLES) {
    const table = d.table(tableName)
    const remote = (tx: unknown) => Boolean((tx as Record<string, unknown> | undefined)?.[FROM_REMOTE])
    table.hook('creating', function (primKey, obj: { id?: number }, tx) {
      if (primKey === undefined && obj.id === undefined) obj.id = newId()
      if (onChange && !remote(tx)) this.onsuccess = (key) => onChange(tableName, key as number, { ...obj, id: key })
    })
    table.hook('updating', function (_mods, primKey, _obj, tx) {
      if (onChange && !remote(tx)) this.onsuccess = (updated) => onChange(tableName, primKey as number, updated as object)
    })
    table.hook('deleting', function (primKey, _obj, tx) {
      if (onChange && !remote(tx)) this.onsuccess = () => onChange(tableName, primKey as number, null)
    })
  }
  return d
}

/** Data on this device only: used when no account is set up. */
export const LOCAL_DB_NAME = 'codesolve-budgeting'

/**
 * The database the app reads and writes. Without an account it's this browser's own;
 * when signed in it's a copy of the household's data that the sync layer keeps in step.
 * (Imported elsewhere as a live binding, so switching it here is seen everywhere.)
 */
export let db: BudgetDb = openBudgetDb(LOCAL_DB_NAME)

export function switchDb(next: BudgetDb): void {
  db = next
}

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
  /** Transactions already stored whose description was re-read and improved. */
  updated: number
  categorised: number
  warnings: string[]
  months: string[]
}

/** Store parsed transactions, skipping ones already imported, and categorise them automatically. */
export async function importParsed(fileName: string, result: ParseResult): Promise<ImportSummary> {
  const ctx = await categoriseContext()
  const seen = new Map<string, number>()

  const rows = result.transactions.map((p) => {
    // With a running balance, date + amount + balance is unique on its own, so an improved
    // reading of the description is still recognised as the same transaction.
    const base = p.balance !== undefined
      ? `${p.date}|${p.amount.toFixed(2)}|bal:${p.balance.toFixed(2)}`
      : `${p.date}|${p.amount.toFixed(2)}|${p.description.toLowerCase()}`
    // Two identical purchases on one day are both real: number repeats within the file.
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { p, hash: `${base}|${n}` }
  })

  const existingByHash = new Map(
    (await db.transactions.where('hash').anyOf(rows.map((r) => r.hash)).toArray()).map((t) => [t.hash, t]),
  )

  // Re-importing a statement refreshes transactions that an older version of the reader
  // stored with a poorer description, instead of adding them twice or leaving them as they were.
  let updated = 0
  const refresh = async (old: Transaction, r: (typeof rows)[number]) => {
    const merchant = normaliseMerchant(r.p.description)
    const patch: Partial<Transaction> = { hash: r.hash, description: r.p.description, merchant }
    if (old.categorySource !== 'user') {
      const choice = categorise({ ...r.p, merchant }, ctx.rules, ctx.byName, ctx.known)
      patch.categoryId = choice.categoryId
      patch.categorySource = choice.source
    }
    await db.transactions.update(old.id!, patch)
    updated++
  }

  const fresh: typeof rows = []
  for (const r of rows) {
    const same = existingByHash.get(r.hash)
    if (same) {
      if (same.description !== r.p.description) await refresh(same, r)
      continue
    }
    const old = r.p.balance === undefined ? undefined : await db.transactions
      .where('date').equals(r.p.date)
      .filter((t) => t.amount === r.p.amount && t.balance === r.p.balance && !t.hash.includes('|bal:'))
      .first()
    if (old) await refresh(old, r)
    else fresh.push(r)
  }

  const importId = (await db.imports.add({
    fileName,
    format: result.format,
    importedAt: Date.now(),
    added: fresh.length,
    skipped: rows.length - fresh.length - updated,
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
    skipped: rows.length - fresh.length - updated,
    updated,
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
    // A bare bank label like "POS PURCHASE" says nothing about the shop: don't learn from it.
    if (categoryId === null || isGenericMerchant(tx.merchant)) return 0

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

/** Deletes every row one by one, so the change is also sent to the account when signed in. */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).toCollection().delete()
  })
  await ensureDefaults()
}
