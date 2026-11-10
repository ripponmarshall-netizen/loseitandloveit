// One data API, two backends:
//   cloud  -> a copy on this device, synced with Supabase Postgres in the
//             background (RLS: every row belongs to auth.uid()). Screens read
//             the copy, so they open instantly and logging works offline.
//   local  -> this device only (no account, no AI)
// Screens only ever call the functions returned here.
//
// The methods themselves live in engine.js (one implementation for both
// backends); sync.js queues and pushes cloud writes. This file wires them to
// localStorage, Supabase and the browser's online/foreground events.

import { supabase } from './supabase.js'
import { createEngine, TABLES, TABLE_NAMES } from './engine.js'
import { createSync, RemoteError } from './sync.js'

export { remapEntries } from './engine.js'

const LOCAL_KEY = 'lili:local:v1'
const cloudKey = (userId) => `lili:cloud:${userId}:v1`

function read(key) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch {
    /* storage blocked or corrupt: start empty */
  }
  return null
}

// ---------------- Local (this device only) ----------------

export function createLocalStore() {
  const engine = createEngine({
    initial: read(LOCAL_KEY),
    persist(db) {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(db))
      } catch {
        throw new Error('Could not save on this device (storage full or blocked).')
      }
    },
  })
  const { db: _db, save: _save, reset, ...methods } = Object.getOwnPropertyDescriptors(engine)
  const store = Object.defineProperties({ mode: 'local' }, methods)
  store.wipe = () => {
    engine.reset()
    try {
      localStorage.removeItem(LOCAL_KEY)
    } catch {
      /* ignore */
    }
  }
  return store
}

// ---------------- Cloud (Supabase) ----------------

const PAGE = 1000 // PostgREST returns at most this many rows per request

// Network trouble and expired sessions are worth retrying; anything else the
// server will refuse again, so the change is dropped and reported.
function toRemoteError({ error, status }) {
  const msg = error?.message || 'Request failed'
  const network = !status || /failed to fetch|load failed|networkerror|network request failed/i.test(msg)
  const retry = network || status === 401 || status === 408 || status === 429 || status >= 500
  return new RemoteError(network ? 'No connection' : msg, { permanent: !retry, code: error?.code || '', status })
}
const check = (res) => {
  if (res.error) throw toRemoteError(res)
  return res.data
}

function supabaseRemote(userId) {
  const sb = supabase
  const own = (q, table) => q.eq(table === 'profiles' ? 'id' : 'user_id', userId)
  return {
    // Only sync while this user is the one signed in.
    async ready() {
      const { data } = await sb.auth.getSession()
      return data.session?.user?.id === userId
    },
    async fetch(table, { since, until, limit, newest } = {}) {
      const build = () => {
        let q = own(sb.from(table).select('*'), table)
        if (since) q = q.gte('log_date', since)
        if (until) q = q.lte('log_date', until)
        return q
      }
      if (limit) return check(await build().order(newest, { ascending: false }).limit(limit))
      const rows = []
      for (let from = 0; ; from += PAGE) {
        const page = check(await build().order('id').range(from, from + PAGE - 1))
        rows.push(...page)
        if (page.length < PAGE) return rows
      }
    },
    async upsert(table, rows, opts) {
      check(await sb.from(table).upsert(rows, opts))
    },
    async remove(table, id) {
      check(await own(sb.from(table).delete().eq('id', id), table))
    },
    async clear(table) {
      check(await own(sb.from(table).delete(), table))
    },
  }
}

const RETRY_MS = 20000 // while changes are waiting
const STALE_MS = 60000 // re-check the account when the app comes back after this long
const stores = new Map() // one store per signed-in user

export function createCloudStore(userId) {
  if (stores.has(userId)) return stores.get(userId)
  const listeners = new Set()
  const emit = (event) => listeners.forEach((fn) => fn(event))
  const remote = supabaseRemote(userId)
  const key = cloudKey(userId)
  let sync
  let storageFull = false

  const engine = createEngine({
    initial: read(key),
    profileId: userId,
    onWrite: (table, kind, id) => sync.queue(table, kind, id),
    // The copy on the device is a cache of the account, so a full disk must
    // never block logging: trim old days and carry on in memory if need be.
    persist(db) {
      for (const attempt of [0, 1]) {
        try {
          localStorage.setItem(key, JSON.stringify(db))
          storageFull = false
          return
        } catch {
          if (attempt === 0) sync?.prune()
          else storageFull = true
        }
      }
    },
  })
  sync = createSync({ engine, remote, userId, emit, defer: (fn, ms) => setTimeout(fn, ms) })

  // First run on this device: nothing to show until the account has been fetched.
  let first = null
  const ready = () => {
    if (sync.synced) return Promise.resolve()
    first ||= sync.pull({ full: true }).then((ok) => {
      first = null
      if (!ok) throw new Error(sync.status().offline ? 'No connection. Connect once to load your account; after that the app works offline.' : sync.status().error || 'Could not load your account.')
    })
    return first
  }

  const store = { mode: 'cloud' }
  const { db: _db, save: _save, reset: _reset, ...methods } = Object.getOwnPropertyDescriptors(engine)
  for (const [name, d] of Object.entries(methods)) {
    store[name] = async (...args) => {
      await ready()
      return d.value(...args)
    }
  }

  // Days older than what the device keeps (only after storage ran short).
  for (const [name, table] of [['listEntries', 'entries'], ['listWorkouts', 'workouts'], ['listDoses', 'doses'], ['listDailyLogs', 'daily_logs']]) {
    const base = store[name]
    store[name] = async (from, to) => {
      await ready()
      if (sync.floor && from < sync.floor) await sync.fetchRange(table, from, to).catch(() => {})
      return base(from, to)
    }
  }

  store.getAiUsage = async (day) => {
    const { data, error } = await supabase.from('ai_usage').select('*').eq('user_id', userId).eq('day', day).maybeSingle()
    if (error) throw new Error(error.message)
    return data
  }

  // Backups come straight from the account, so they are complete even when
  // the device only holds recent days; offline, they cover what's on the device.
  store.exportAll = async () => {
    await ready()
    const out = await engine.exportAll()
    if (!(await sync.flush())) return out
    try {
      const [profiles, ...tables] = await Promise.all([remote.fetch('profiles'), ...TABLE_NAMES.map((t) => remote.fetch(TABLES[t].remote).catch((e) => (e.permanent ? null : Promise.reject(e))))])
      out.profile = profiles[0] || out.profile
      TABLE_NAMES.forEach((t, i) => {
        if (tables[i]) out[t] = tables[i].map(({ user_id, ...row }) => row)
      })
    } catch {
      /* connection dropped mid-export: the device copy is still a good backup */
    }
    return out
  }

  // ----- sync controls for the UI -----
  store.subscribe = (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
  store.syncStatus = () => ({ ...sync.status(), storageFull })
  store.syncNow = async () => {
    const ok = (await sync.flush()) && (await sync.pull())
    if (!ok) throw new Error(sync.status().offline ? 'No connection. Your changes are saved on this phone and will sync later.' : sync.status().error || 'Sync failed.')
  }

  // Push when the connection returns, catch up when the app is reopened, and
  // keep retrying while anything is waiting.
  if (typeof window !== 'undefined') {
    const catchUp = () => {
      if (document.visibilityState !== 'visible') return
      const { syncedAt, pending } = sync.status()
      if (pending) sync.flush()
      if (syncedAt && Date.now() - syncedAt > STALE_MS) sync.pull()
    }
    window.addEventListener('online', () => sync.flush().then(() => sync.pull()))
    window.addEventListener('offline', () => emit({ type: 'status' }))
    document.addEventListener('visibilitychange', catchUp)
    setInterval(() => sync.status().pending && sync.flush(), RETRY_MS)
    if (sync.synced) sync.pull()
  }

  stores.set(userId, store)
  return store
}
