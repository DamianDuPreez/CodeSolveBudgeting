import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentReference,
  type QuerySnapshot,
} from 'firebase/firestore'
import {
  ensureDefaults,
  FROM_REMOTE,
  LOCAL_DB_NAME,
  openBudgetDb,
  switchDb,
  TABLES,
  type BudgetDb,
  type TableName,
} from './db'
import { firestore } from './firebase'

/*
 * How syncing works
 * - Firestore holds the household's data: households/{id}/{table}/{rowId}.
 * - This browser keeps a copy (IndexedDB) that the screens read from, so the app stays fast and works offline.
 * - Local changes are sent up in small batches; changes from other devices come down through live listeners.
 */

type Pending = Map<string, { table: TableName; id: number; row: object | null }>

let session: {
  householdId: string
  db: BudgetDb
  pending: Pending
  timer: ReturnType<typeof setTimeout> | null
  unsubscribers: (() => void)[]
} | null = null

export const isSyncing = () => session !== null

function ref(householdId: string, table: TableName, id: number): DocumentReference {
  return doc(firestore!, 'households', householdId, table, String(id))
}

function queue(table: TableName, id: number, row: object | null) {
  if (!session) return
  session.pending.set(`${table}/${id}`, { table, id, row })
  if (!session.timer) session.timer = setTimeout(flush, 400)
}

/** Sends queued changes to Firestore. While offline, Firestore holds them and sends them on reconnect. */
export async function flush(): Promise<void> {
  if (!session) return
  const s = session
  if (s.timer) { clearTimeout(s.timer); s.timer = null }
  const items = [...s.pending.values()]
  s.pending.clear()
  for (let i = 0; i < items.length; i += 450) {
    const batch = writeBatch(firestore!)
    for (const { table, id, row } of items.slice(i, i + 450)) {
      if (row) batch.set(ref(s.householdId, table, id), row)
      else batch.delete(ref(s.householdId, table, id))
    }
    try { await batch.commit() } catch (e) { console.error('Sync: could not save changes', e) }
  }
}


/** Applies changes from the account to this browser's copy, without sending them back up. */
async function applyRemote(d: BudgetDb, table: TableName, snap: QuerySnapshot, first: boolean) {
  await d.transaction('rw', d.table(table), async (tx) => {
    (tx as unknown as Record<string, boolean>)[FROM_REMOTE] = true
    const t = d.table(table)
    if (first) {
      // Full picture: also drop rows deleted elsewhere while this device was away.
      const keep = new Set(snap.docs.map((x) => Number(x.id)))
      const gone = (await t.toCollection().primaryKeys()).filter((k) => !keep.has(k as number))
      await t.bulkDelete(gone)
    }
    const changes = first ? snap.docs.map((x) => ({ type: 'added' as const, doc: x })) : snap.docChanges()
    for (const c of changes) {
      // Our own writes come back too; the copy here already has them.
      if (!first && c.doc.metadata.hasPendingWrites) continue
      const id = Number(c.doc.id)
      if (c.type === 'removed') { await t.delete(id); continue }
      const row = { ...c.doc.data(), id } as { id: number; hash?: string; month?: string; categoryId?: number }
      // Two devices can add the same statement line (or budget cell) at once. The account's version wins.
      const clash = table === 'transactions'
        ? await t.where('hash').equals(row.hash ?? "").first()
        : table === 'budgets'
          ? await t.where('[month+categoryId]').equals([row.month ?? "", row.categoryId ?? 0]).first()
          : undefined
      if (clash && clash.id !== id) {
        await t.delete(clash.id)
        queue(table, clash.id, null)
      }
      await t.put(row)
    }
  })
}

/** Copies data made before signing in (this browser only) into the account, the first time. */
async function seedHousehold(d: BudgetDb): Promise<'copied' | 'fresh'> {
  const local = openBudgetDb(LOCAL_DB_NAME)
  try {
    const hasLocal = (await local.transactions.count()) > 0 || (await local.budgets.count()) > 0
    if (hasLocal) {
      for (const t of TABLES) {
        const rows = await local.table(t).toArray()
        await d.table(t).bulkPut(rows) // goes through the hooks, so it's sent up
      }
      return 'copied'
    }
  } finally {
    local.close()
  }
  await ensureDefaults()
  return 'fresh'
}

/**
 * Starts syncing a household and makes its data the app's database.
 * Resolves once this browser's copy matches the account, so screens never flash empty or duplicate data.
 */
export async function startSync(householdId: string): Promise<void> {
  if (!firestore) throw new Error('Firebase is not configured')
  if (session?.householdId === householdId) return
  await stopSync()

  const d = openBudgetDb(`${LOCAL_DB_NAME}-${householdId}`, (table, id, row) => queue(table, id, row))
  session = { householdId, db: d, pending: new Map(), timer: null, unsubscribers: [] }
  switchDb(d)

  const metaRef = doc(firestore, 'households', householdId, 'meta', 'state')
  const meta = await getDoc(metaRef).catch(() => null)
  if (meta && !meta.exists()) {
    // Check it's really empty (not just an older account from before the meta doc existed).
    const any = await getDocs(collection(firestore, 'households', householdId, 'groups'))
    if (any.empty) {
      const how = await seedHousehold(d)
      await flush()
      await setDoc(metaRef, { seeded: true, seededAt: serverTimestamp(), from: how })
    }
  }

  const s = session
  await Promise.all(TABLES.map((table) => new Promise<void>((resolve) => {
    let first = true
    const unsub = onSnapshot(
      collection(firestore!, 'households', householdId, table),
      async (snap) => {
        const isFirst = first
        first = false
        try { await applyRemote(d, table, snap, isFirst) } catch (e) { console.error(`Sync: ${table}`, e) }
        if (isFirst) resolve()
      },
      (e) => { console.error(`Sync: lost connection to ${table}`, e); resolve() },
    )
    s.unsubscribers.push(unsub)
  })))
}

/** Stops syncing (on sign-out). Unsent changes are handed to Firestore first; this browser's copy is removed. */
export async function stopSync(): Promise<void> {
  if (!session) return
  const s = session
  await flush()
  s.unsubscribers.forEach((u) => u())
  session = null
  s.db.close()
  await s.db.delete().catch(() => {})
  switchDb(openBudgetDb(LOCAL_DB_NAME))
}
