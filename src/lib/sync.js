// Background sync for cloud mode. The engine holds a copy of the user's data
// on this device; this module keeps that copy and Supabase in step:
//
//   write -> the engine changes the local copy and calls queue(); the change
//            waits in an outbox (saved on the device) until it reaches the
//            server, so logging works with no signal.
//   pull  -> fetches the server's rows and merges them in, keeping anything
//            that is still waiting in the outbox.
//
// Rows get their id on the device and are pushed with upsert, so sending the
// same change twice is harmless. Conflicts are last-write-wins, which is fine
// for one person's log.
//
// Pure: the remote (Supabase) is injected, so tests use a fake one.

import { TABLES, TABLE_NAMES, pickProfile } from './engine.js'
import { addDays, toISODate } from './dates.js'

export const WINDOW_DAYS = 120 // routine syncs re-check this many days of dated rows
export const FULL_EVERY_MS = 7 * 86400000 // and everything about once a week
export const KEEP_DAYS = 400 // kept on the device if storage runs short
const BATCH = 200

export class RemoteError extends Error {
  /** permanent: the server refused this change and always will (bad data, missing table). */
  constructor(message, { permanent = false, code = '', status = 0 } = {}) {
    super(message)
    this.permanent = permanent
    this.code = code
    this.status = status
  }
}

const key = (table, id) => `${table}:${id}`
const pick = (row, cols) => Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]))
const missing = (e) => /(does not exist|could not find|schema cache)/i.test(e.message)
const missingColumn = (e) => e.message.match(/Could not find the '(\w+)' column/)?.[1] || e.message.match(/column "?(\w+)"? of relation "\w+" does not exist/)?.[1]

function friendly(table, e) {
  const t = TABLES[table]
  if (t?.migration && missing(e)) return `Some changes can't sync until the database is updated: run ${t.migration} in the Supabase SQL Editor.`
  if (t?.requires && e.code === '23505') return `Your account's database only allows one of these a day: run ${t.requires} in the Supabase SQL Editor, then log it again.`
  return `A change couldn't be saved to your account and was undone: ${e.message}`
}

/**
 * @param {object} o
 * @param {ReturnType<import('./engine.js').createEngine>} o.engine
 * @param {object} o.remote   { ready(), fetch(table, opts), upsert(table, rows, opts), remove(table, id), clear(table) }
 * @param {string} o.userId
 * @param {(event:{type:'change'|'status'|'error', message?:string})=>void} [o.emit]
 * @param {()=>number} [o.now]
 * @param {(fn:()=>void, ms:number)=>void} [o.defer]  schedule work (setTimeout in the browser)
 */
export function createSync({ engine, remote, userId, emit = () => {}, now = () => Date.now(), defer = (fn) => fn() }) {
  const db = engine.db
  db.outbox ||= []
  db.meta ||= { syncedAt: null, fullAt: null, floor: null }

  let flushing = null
  let pulling = null
  let touched = null // rows written while a pull is in the air
  let offline = false
  let lastError = null
  let flushQueued = false

  const persist = () => {
    try {
      engine.save()
    } catch {
      /* the copy in memory is still right; storage is handled by the store */
    }
  }
  const status = () => ({ pending: db.outbox.length, syncing: !!(flushing || pulling), offline, syncedAt: db.meta.syncedAt, error: lastError })
  const changed = () => emit({ type: 'status' })

  /** Called by the engine for every write. */
  function queue(table, kind, id) {
    touched?.add(key(table, id))
    const box = db.outbox
    if (kind === 'clear') {
      db.outbox = box.filter((op) => op.table !== table)
      db.outbox.push({ table, kind })
    } else if (kind === 'delete') {
      // A row that never left the device needs no delete on the server, but
      // sending one is harmless and keeps this simple.
      db.outbox = box.filter((op) => !(op.table === table && op.id === id))
      db.outbox.push({ table, kind, id })
    } else {
      const waiting = box.find((op) => op.table === table && op.id === id && op.kind === 'upsert')
      if (waiting) waiting.dirty = true // changed again, maybe mid-send: send once more
      else box.push({ table, kind, id })
    }
    changed()
    if (!flushQueued) {
      flushQueued = true
      defer(() => {
        flushQueued = false
        flush()
      }, 400)
    }
  }

  const remoteRow = (table, id) => {
    if (table === 'profile') return db.profile ? { ...pickProfile(db.profile), id: userId } : null
    const row = db[table].find((x) => x.id === id)
    return row ? { ...pick(row, TABLES[table].cols), user_id: userId } : null
  }
  const remoteName = (table) => (table === 'profile' ? 'profiles' : TABLES[table].remote)

  // One upsert, with the repairs that make a retry worthwhile.
  async function upsertOne(table, row) {
    const name = remoteName(table)
    let attempt = { ...row }
    for (let i = 0; i < 14; i++) {
      try {
        return await remote.upsert(name, [attempt])
      } catch (e) {
        if (!e.permanent) throw e
        const col = missingColumn(e)
        if (col && col in attempt && col !== 'id') {
          delete attempt[col] // a column from a migration that hasn't been run
        } else if (e.code === '23505' && TABLES[table]?.perDay && 'id' in attempt) {
          // Another device already made this day's row: update that one.
          const { id, ...rest } = attempt
          return await remote.upsert(name, [rest], { onConflict: 'user_id,log_date' })
        } else if (e.code === '23514' && table === 'workouts' && (attempt.kind === 'other' || attempt.calories_source === 'device')) {
          // Before 0006 the table only knows treadmill/home and estimate/manual:
          // keep the workout as an at-home one rather than lose it.
          attempt = { ...attempt, kind: attempt.kind === 'other' ? 'home' : attempt.kind, distance_km: attempt.kind === 'other' ? null : attempt.distance_km, calories_source: attempt.calories_source === 'device' ? 'manual' : attempt.calories_source }
        } else if (e.code === '23503' && attempt.food_id) {
          attempt = { ...attempt, food_id: null } // the saved food was deleted elsewhere
        } else throw e
      }
    }
  }

  async function sendBatch(ops) {
    const [first] = ops
    if (first.kind === 'clear') return remote.clear(remoteName(first.table))
    if (first.kind === 'delete') return remote.remove(remoteName(first.table), first.id)
    const rows = ops.map((op) => remoteRow(op.table, op.id)).filter(Boolean)
    if (!rows.length) return
    if (rows.length === 1) return upsertOne(first.table, rows[0])
    return remote.upsert(remoteName(first.table), rows)
  }

  function nextBatch() {
    const [first, ...rest] = db.outbox
    const batch = [first]
    if (first.kind === 'upsert' && first.table !== 'profile') {
      for (const op of rest) {
        if (op.kind !== 'upsert' || op.table !== first.table || batch.length >= BATCH) break
        batch.push(op)
      }
    }
    return batch
  }

  const settle = (ops) => {
    const done = new Set(ops.filter((op) => !op.dirty))
    db.outbox = db.outbox.filter((op) => !done.has(op))
  }

  /** Push everything waiting. Resolves true when the outbox is empty. */
  function flush() {
    if (flushing) return flushing
    flushing = (async () => {
      let dropped = false
      try {
        await null // so `flushing` is set before any of this runs
        if (!db.outbox.length) return true
        if (!(await remote.ready())) return false
        while (db.outbox.length) {
          let batch = nextBatch()
          for (const op of batch) op.dirty = false
          try {
            await sendBatch(batch)
          } catch (e) {
            if (!e.permanent) throw e
            if (batch.length > 1) {
              // Find the bad row: send them one at a time.
              const ok = []
              for (const op of batch) {
                try {
                  await sendBatch([op])
                  ok.push(op)
                } catch (e1) {
                  if (!e1.permanent) {
                    settle(ok)
                    throw e1
                  }
                  dropped = true
                  db.outbox = db.outbox.filter((x) => x !== op)
                  emit({ type: 'error', message: friendly(op.table, e1) })
                }
              }
              batch = ok
            } else {
              dropped = true
              db.outbox = db.outbox.filter((x) => x !== batch[0])
              emit({ type: 'error', message: friendly(batch[0].table, e) })
              batch = []
            }
          }
          settle(batch)
          persist()
        }
        offline = false
        lastError = null
        return true
      } catch (e) {
        offline = true
        lastError = e.message
        return false
      } finally {
        persist()
        flushing = null
        changed()
        // Something was refused: fetch the truth so the screen matches the account.
        if (dropped) defer(() => pull(), 0)
      }
    })()
    changed()
    return flushing
  }

  function merge(table, serverRows, { since = null } = {}) {
    const t = TABLES[table]
    const pendingUpsert = new Set()
    const pendingDelete = new Set()
    let cleared = false
    for (const op of db.outbox) {
      if (op.table !== table) continue
      if (op.kind === 'clear') cleared = true
      else (op.kind === 'delete' ? pendingDelete : pendingUpsert).add(op.id)
    }
    const local = new Map(db[table].map((r) => [r.id, r]))
    const mine = (id) => pendingUpsert.has(id) || touched?.has(key(table, id))
    const out = []
    const seen = new Set()
    for (const raw of cleared ? [] : serverRows) {
      const row = pick(raw, t.cols)
      seen.add(row.id)
      if (pendingDelete.has(row.id)) continue
      if (mine(row.id)) {
        if (local.has(row.id)) out.push(local.get(row.id)) // else deleted while the pull was in the air
      } else out.push(row)
    }
    for (const row of db[table]) {
      if (seen.has(row.id)) continue
      const outsideWindow = since && row.log_date < since
      if (mine(row.id) || outsideWindow) out.push(row)
    }
    db[table] = out
  }

  const snapshot = () => JSON.stringify([db.profile, ...TABLE_NAMES.map((t) => db[t])])

  /** Fetch the server's rows and merge them in. Resolves true on success. */
  function pull({ full = false } = {}) {
    if (pulling) return pulling
    pulling = (async () => {
      try {
        await null
        if (!(await remote.ready())) return false
        await flush()
        touched = new Set()
        const isFull = full || !db.meta.fullAt || now() - db.meta.fullAt > FULL_EVERY_MS
        const windowStart = addDays(toISODate(new Date(now())), -WINDOW_DAYS)
        const since = isFull ? db.meta.floor : db.meta.floor && db.meta.floor > windowStart ? db.meta.floor : windowStart

        // Tables from a migration that hasn't been run are skipped, not fatal.
        const optional = async (table, p) => {
          try {
            return await p
          } catch (e) {
            if (e.permanent && TABLES[table].migration && missing(e)) return null
            throw e
          }
        }
        const jobs = TABLE_NAMES.map((table) => {
          const t = TABLES[table]
          const opts = t.recent ? { limit: t.recent, newest: 'created_at' } : t.dated && since ? { since } : {}
          return optional(table, remote.fetch(t.remote, opts))
        })
        const [profiles, ...tables] = await Promise.all([remote.fetch('profiles', {}), ...jobs])

        const before = snapshot()
        if (!db.outbox.some((op) => op.table === 'profile') && !touched.has(key('profile', 'profile'))) {
          db.profile = profiles[0] || null
        }
        TABLE_NAMES.forEach((table, i) => {
          if (!tables[i]) return
          const t = TABLES[table]
          merge(table, tables[i], { since: t.dated ? since : null })
        })
        db.meta.syncedAt = now()
        if (isFull) db.meta.fullAt = now()
        offline = false
        lastError = null
        persist()
        if (snapshot() !== before) emit({ type: 'change' })
        return true
      } catch (e) {
        if (!e.permanent) offline = true
        lastError = e.message
        return false
      } finally {
        touched = null
        pulling = null
        changed()
      }
    })()
    changed()
    return pulling
  }

  /** Rows older than what the device keeps: fetch that range and hold it in memory. */
  async function fetchRange(table, from, to) {
    const rows = await remote.fetch(TABLES[table].remote, { since: from, until: to })
    const have = new Set(db[table].map((r) => r.id))
    const gone = new Set(db.outbox.filter((op) => op.table === table && op.kind === 'delete').map((op) => op.id))
    for (const raw of rows) if (!have.has(raw.id) && !gone.has(raw.id)) db[table].push(pick(raw, TABLES[table].cols))
  }

  /** Storage is full: keep the last KEEP_DAYS of dated rows on the device (the account still has the rest). */
  function prune() {
    const floor = addDays(toISODate(new Date(now())), -KEEP_DAYS)
    const waiting = new Set(db.outbox.map((op) => key(op.table, op.id)))
    for (const table of TABLE_NAMES) {
      if (!TABLES[table].dated) continue
      db[table] = db[table].filter((r) => r.log_date >= floor || waiting.has(key(table, r.id)))
    }
    db.meta.floor = floor
  }

  return { queue, flush, pull, status, fetchRange, prune, get floor() { return db.meta.floor }, get synced() { return !!db.meta.syncedAt } }
}
