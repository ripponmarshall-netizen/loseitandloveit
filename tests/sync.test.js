import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, newId } from '../src/lib/engine.js'
import { createSync, RemoteError } from '../src/lib/sync.js'

const USER = '11111111-1111-4111-8111-111111111111'

// A tiny in-memory stand-in for Supabase.
function fakeRemote() {
  const tables = {}
  const rows = (t) => (tables[t] ||= [])
  const r = {
    tables,
    online: true,
    calls: [],
    reject: null, // (table, row) => RemoteError | null
    hold: null, // a promise the next upsert waits on
    async ready() {
      return true
    },
    net() {
      if (!r.online) throw new RemoteError('No connection')
    },
    async fetch(table, { since, until, limit } = {}) {
      r.net()
      let out = rows(table).filter((x) => (!since || x.log_date >= since) && (!until || x.log_date <= until))
      if (limit) out = out.slice(-limit)
      return out.map((x) => ({ ...x }))
    },
    async upsert(table, list, opts) {
      r.net()
      r.calls.push({ table, n: list.length, opts })
      if (r.hold) await r.hold
      for (const row of list) {
        const err = r.reject?.(table, row, opts)
        if (err) throw err
      }
      for (const row of list) {
        const match = opts?.onConflict ? (x) => x.log_date === row.log_date : (x) => x.id === row.id
        const i = rows(table).findIndex(match)
        if (i >= 0) rows(table)[i] = { ...rows(table)[i], ...row }
        else rows(table).push({ id: row.id || newId(), ...row })
      }
    },
    async remove(table, id) {
      r.net()
      tables[table] = rows(table).filter((x) => x.id !== id)
    },
    async clear(table) {
      r.net()
      tables[table] = []
    },
  }
  return r
}

function setup({ remote = fakeRemote(), initial } = {}) {
  const events = []
  let saved = initial
  let sync
  const engine = createEngine({ initial, profileId: USER, persist: (db) => (saved = JSON.parse(JSON.stringify(db))), onWrite: (...a) => sync.queue(...a) })
  // defer does nothing: tests call flush() themselves.
  sync = createSync({ engine, remote, userId: USER, emit: (e) => events.push(e), defer: () => {} })
  return { engine, sync, remote, events, saved: () => saved }
}

const entry = (over = {}) => ({ log_date: '2026-11-10', meal: 'lunch', name: 'Patty', calories: 470, ...over })

test('first pull loads the account and reports a change', async () => {
  const remote = fakeRemote()
  remote.tables.profiles = [{ id: USER, display_name: 'R', units: 'imperial' }]
  remote.tables.food_entries = [{ id: 'e1', user_id: USER, ...entry(), created_at: '2026-11-10T12:00:00Z' }]
  const { engine, sync, events } = setup({ remote })
  assert.equal(sync.synced, false)
  assert.equal(await sync.pull({ full: true }), true)
  assert.equal((await engine.getProfile()).display_name, 'R')
  const rows = await engine.listEntries('2026-11-10', '2026-11-10')
  assert.equal(rows.length, 1)
  assert.equal('user_id' in rows[0], false)
  assert.ok(events.some((e) => e.type === 'change'))
  assert.equal(sync.synced, true)
})

test('writes made offline wait in the outbox and reach the server later', async () => {
  const { engine, sync, remote, saved } = setup()
  remote.online = false
  const [row] = await engine.addEntries([entry()])
  await engine.saveDailyLog('2026-11-10', { water_ml: 500 })
  assert.equal(await sync.flush(), false)
  assert.equal(sync.status().pending, 2)
  assert.equal(sync.status().offline, true)
  assert.equal(saved().outbox.length, 2) // survives closing the app
  assert.equal((await engine.listEntries('2026-11-10', '2026-11-10')).length, 1) // still readable

  remote.online = true
  assert.equal(await sync.flush(), true)
  assert.equal(sync.status().pending, 0)
  assert.equal(remote.tables.food_entries[0].id, row.id)
  assert.equal(remote.tables.food_entries[0].user_id, USER)
  assert.equal(remote.tables.daily_logs[0].water_ml, 500)
})

test('the outbox is restored from the device after a restart', async () => {
  const a = setup()
  a.remote.online = false
  await a.engine.addEntries([entry()])
  await a.sync.flush()
  const b = setup({ initial: a.saved() })
  assert.equal(b.sync.status().pending, 1)
  assert.equal(await b.sync.flush(), true)
  assert.equal(b.remote.tables.food_entries.length, 1)
})

test('several edits to one row are sent once, with the latest values', async () => {
  const { engine, sync, remote } = setup()
  const [row] = await engine.addEntries([entry()])
  await engine.updateEntry(row.id, { servings: 2 })
  await engine.updateEntry(row.id, { servings: 3 })
  assert.equal(sync.status().pending, 1)
  await sync.flush()
  assert.equal(remote.tables.food_entries.length, 1)
  assert.equal(remote.tables.food_entries[0].servings, 3)
})

test('an edit made while the row is being sent is sent again', async () => {
  const { engine, sync, remote } = setup()
  const [row] = await engine.addEntries([entry()])
  let release
  remote.hold = new Promise((r) => (release = r))
  const flushing = sync.flush()
  await new Promise((r) => setTimeout(r, 5))
  await engine.updateEntry(row.id, { servings: 4 })
  remote.hold = null
  release()
  await flushing
  await sync.flush()
  assert.equal(remote.tables.food_entries[0].servings, 4)
  assert.equal(sync.status().pending, 0)
})

test('a row added and deleted offline leaves nothing on the server', async () => {
  const { engine, sync, remote } = setup()
  remote.online = false
  const [row] = await engine.addEntries([entry()])
  await engine.deleteEntry(row.id)
  remote.online = true
  await sync.flush()
  assert.equal((remote.tables.food_entries || []).length, 0)
  assert.equal(sync.status().pending, 0)
})

test('pull keeps unsent changes and takes everything else from the server', async () => {
  const remote = fakeRemote()
  remote.tables.food_entries = [
    { id: 'keep', ...entry({ name: 'Server copy' }), created_at: '2026-11-10T08:00:00Z' },
    { id: 'edited', ...entry({ name: 'Old name' }), created_at: '2026-11-10T09:00:00Z' },
    { id: 'gone', ...entry({ name: 'Deleted here' }), created_at: '2026-11-10T10:00:00Z' },
  ]
  const { engine, sync } = setup({ remote })
  await sync.pull({ full: true })
  // Offline: edit one, delete one, add one. Meanwhile another device adds and removes rows.
  remote.online = false
  await engine.updateEntry('edited', { name: 'New name' })
  await engine.deleteEntry('gone')
  await engine.addEntries([entry({ name: 'Made offline' })])
  await sync.flush()
  remote.tables.food_entries = remote.tables.food_entries.filter((r) => r.id !== 'keep')
  remote.tables.food_entries.push({ id: 'other-device', ...entry({ name: 'From iPad' }), created_at: '2026-11-10T11:00:00Z' })
  remote.online = true
  await sync.pull()
  const names = (await engine.listEntries('2026-11-10', '2026-11-10')).map((r) => r.name).sort()
  assert.deepEqual(names, ['From iPad', 'Made offline', 'New name'])
  assert.deepEqual(remote.tables.food_entries.map((r) => r.name).sort(), ['From iPad', 'Made offline', 'New name'])
})

test('a routine pull leaves days outside the sync window alone', async () => {
  const remote = fakeRemote()
  const old = { id: 'old', ...entry({ log_date: '2020-01-01' }), created_at: '2020-01-01T08:00:00Z' }
  remote.tables.food_entries = [old]
  const { engine, sync } = setup({ remote })
  await sync.pull({ full: true })
  assert.equal((await engine.listEntries('2020-01-01', '2020-01-01')).length, 1)
  await sync.pull() // windowed: the fake only returns rows since the window start
  assert.equal((await engine.listEntries('2020-01-01', '2020-01-01')).length, 1)
})

test('a change the server refuses is dropped, reported and undone by the next pull', async () => {
  const { engine, sync, remote, events } = setup()
  await sync.pull({ full: true })
  remote.reject = (table, row) => (row.name === 'Bad' ? new RemoteError('violates check constraint', { permanent: true, code: '23514', status: 400 }) : null)
  await engine.addEntries([entry({ name: 'Good' }), entry({ name: 'Bad' }), entry({ name: 'Fine' })])
  assert.equal(await sync.flush(), true)
  assert.deepEqual(remote.tables.food_entries.map((r) => r.name).sort(), ['Fine', 'Good'])
  assert.equal(events.filter((e) => e.type === 'error').length, 1)
  await sync.pull()
  assert.deepEqual((await engine.listEntries('2026-11-10', '2026-11-10')).map((r) => r.name).sort(), ['Fine', 'Good'])
})

test("a day's row made on two devices merges instead of failing", async () => {
  const { engine, sync, remote } = setup()
  await sync.pull({ full: true })
  remote.tables.weights = [{ id: 'server-id', user_id: USER, log_date: '2026-11-10', weight_kg: 100 }]
  remote.reject = (table, row, opts) =>
    table === 'weights' && !opts?.onConflict ? new RemoteError('duplicate key', { permanent: true, code: '23505', status: 409 }) : null
  await engine.upsertWeight({ log_date: '2026-11-10', weight_kg: 99.5 })
  assert.equal(await sync.flush(), true)
  assert.equal(remote.tables.weights.length, 1)
  assert.equal(remote.tables.weights[0].weight_kg, 99.5)
  await sync.pull()
  const w = await engine.listWeights()
  assert.equal(w.length, 1)
  assert.equal(w[0].id, 'server-id')
})

test('profile: saved offline, kept through a pull, then pushed without unknown columns', async () => {
  const remote = fakeRemote()
  remote.tables.profiles = [{ id: USER, display_name: 'Old', units: 'imperial' }]
  const { engine, sync } = setup({ remote })
  await sync.pull({ full: true })
  remote.online = false
  await engine.saveProfile({ display_name: 'New', conditions: [] })
  remote.online = true
  remote.reject = (table, row) => ('conditions' in row ? new RemoteError("Could not find the 'conditions' column of 'profiles' in the schema cache", { permanent: true, code: 'PGRST204', status: 400 }) : null)
  await sync.pull()
  assert.equal((await engine.getProfile()).display_name, 'New')
  assert.equal(remote.tables.profiles[0].display_name, 'New')
  assert.equal(sync.status().pending, 0)
})

test('clearing the chat removes it on the server and keeps later messages', async () => {
  const remote = fakeRemote()
  remote.tables.coach_messages = [{ id: 'm1', role: 'user', content: 'hi', created_at: '2026-11-01T00:00:00Z' }]
  const { engine, sync } = setup({ remote })
  await sync.pull({ full: true })
  remote.online = false
  await engine.clearCoachMessages()
  await engine.addCoachMessage({ role: 'user', content: 'fresh start' })
  remote.online = true
  await sync.pull()
  assert.deepEqual((await engine.listCoachMessages()).map((m) => m.content), ['fresh start'])
  assert.deepEqual(remote.tables.coach_messages.map((m) => m.content), ['fresh start'])
})

test('a missing optional table does not stop the rest from syncing', async () => {
  const remote = fakeRemote()
  remote.tables.food_entries = [{ id: 'e1', ...entry(), created_at: '2026-11-10T12:00:00Z' }]
  const fetch = remote.fetch
  remote.fetch = async (table, opts) => {
    if (table === 'coach_insights') throw new RemoteError("Could not find the table 'public.coach_insights' in the schema cache", { permanent: true, code: 'PGRST205', status: 404 })
    return fetch(table, opts)
  }
  const { engine, sync } = setup({ remote })
  assert.equal(await sync.pull({ full: true }), true)
  assert.equal((await engine.listEntries('2026-11-10', '2026-11-10')).length, 1)
})

test('when storage is short, old days leave the device but unsent rows stay', async () => {
  const { engine, sync, remote } = setup()
  remote.online = false
  await engine.addEntries([entry({ log_date: '2020-01-01', name: 'Old, unsent' })])
  engine.db.entries.push({ id: 'old-synced', ...entry({ log_date: '2020-01-02' }), created_at: '2020-01-02T00:00:00Z' })
  await engine.addEntries([entry({ name: 'Recent' })])
  sync.prune()
  assert.deepEqual(engine.db.entries.map((r) => r.name).sort(), ['Old, unsent', 'Recent'])
  assert.ok(sync.floor)
})

test('engine: one implementation behaves like the old local store', async () => {
  const engine = createEngine({ persist: () => {} })
  const food = await engine.saveFood({ name: 'Box lunch', calories: 800 })
  const [e] = await engine.addEntries([entry({ food_id: food.id }), entry({ food_id: 'builtin:patty', meal: 'nope', servings: 0 })])
  assert.equal(e.food_id, food.id)
  const all = await engine.listEntries('2026-11-10', '2026-11-10')
  assert.equal(all[1].food_id, null)
  assert.equal(all[1].meal, 'snack')
  assert.ok(all[1].servings > 0)
  await engine.deleteFood(food.id)
  assert.equal((await engine.listEntries('2026-11-10', '2026-11-10'))[0].food_id, null)
  await engine.upsertWeight({ log_date: '2026-11-09', weight_kg: 100 })
  const w = await engine.upsertWeight({ log_date: '2026-11-10', weight_kg: 99 })
  await assert.rejects(engine.updateWeight(w.id, { log_date: '2026-11-09', weight_kg: 99 }), /already have a weigh-in/)
  await assert.rejects(engine.upsertWeight({ log_date: '2026-11-10', weight_kg: 5 }), /realistic/)
  assert.match(newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
