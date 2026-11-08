// One data API, two backends:
//   cloud  -> Supabase Postgres (RLS: every row belongs to auth.uid())
//   local  -> localStorage on this device only (no account, no AI)
// Screens only ever call the functions returned here.

import { supabase } from './supabase.js'

const ENTRY_FIELDS = 'id,log_date,meal,name,serving,servings,calories,protein_g,carbs_g,fat_g,source,food_id,created_at'
const PROFILE_FIELDS = [
  'display_name', 'sex', 'birth_year', 'height_cm', 'start_weight_kg', 'goal_weight_kg',
  'activity_level', 'weekly_rate_kg', 'units', 'day_start_hour',
  'calorie_target_override', 'protein_target_override', 'coach_notes', 'exercise_eatback_pct',
]
const WORKOUT_FIELDS =
  'id,log_date,kind,name,duration_min,speed_kmh,incline_pct,distance_km,mode,activity,intensity,exercises,calories_burned,calories_source,notes,created_at'

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))

function cleanWorkout(w) {
  const treadmill = w.kind === 'treadmill'
  return {
    log_date: w.log_date,
    kind: treadmill ? 'treadmill' : 'home',
    name: String(w.name || (treadmill ? 'Treadmill' : 'Home workout')).slice(0, 120),
    duration_min: Number(w.duration_min) || 1,
    speed_kmh: treadmill ? num(w.speed_kmh) : null,
    incline_pct: treadmill ? num(w.incline_pct) ?? 0 : null,
    distance_km: treadmill ? num(w.distance_km) : null,
    mode: treadmill ? (w.mode === 'run' ? 'run' : 'walk') : null,
    activity: treadmill ? null : w.activity || 'bodyweight',
    intensity: treadmill ? null : w.intensity || 'moderate',
    exercises: treadmill
      ? []
      : (w.exercises || [])
          .filter((x) => x && String(x.name || '').trim())
          .slice(0, 30)
          .map((x) => ({ name: String(x.name).slice(0, 80), sets: num(x.sets), reps: String(x.reps ?? '').slice(0, 20) })),
    calories_burned: Math.max(0, Math.min(5000, Math.round(Number(w.calories_burned) || 0))),
    calories_source: w.calories_source === 'manual' ? 'manual' : 'estimate',
    notes: w.notes ? String(w.notes).slice(0, 1000) : null,
  }
}

// Friendlier message when the workouts migration hasn't been run yet.
function workoutError(error) {
  if (/workouts|exercise_eatback_pct/.test(error.message) && /(does not exist|could not find|schema cache)/i.test(error.message)) {
    return new Error('Workouts need a database update: run supabase/migrations/0002_workouts.sql in the Supabase SQL Editor.')
  }
  return new Error(error.message)
}

function pickProfile(p) {
  const out = {}
  for (const k of PROFILE_FIELDS) if (k in p) out[k] = p[k] === '' ? null : p[k]
  return out
}

// Non-negative number (the database rejects negatives with a cryptic error).
const pos = (v) => Math.max(0, Number(v) || 0)
// Servings must be > 0 and <= 50 (table check constraint).
const servingsOf = (v) => Math.min(50, Math.max(0.01, Number(v ?? 1) || 1))
const MEAL_SET = new Set(['breakfast', 'lunch', 'dinner', 'snack'])
const SOURCE_SET = new Set(['manual', 'library', 'recent', 'ai', 'quick'])

function cleanEntry(e) {
  return {
    log_date: e.log_date,
    meal: MEAL_SET.has(e.meal) ? e.meal : 'snack',
    name: String(e.name || 'Food').slice(0, 200),
    serving: e.serving || null,
    servings: servingsOf(e.servings),
    calories: pos(e.calories),
    protein_g: pos(e.protein_g),
    carbs_g: pos(e.carbs_g),
    fat_g: pos(e.fat_g),
    source: SOURCE_SET.has(e.source) ? e.source : 'manual',
    food_id: e.food_id && !String(e.food_id).startsWith('builtin:') ? e.food_id : null,
  }
}

// Only the editable fields of an entry, cleaned the same way as a new one.
function cleanEntryPatch(p) {
  const out = {}
  if ('name' in p) out.name = String(p.name || 'Food').slice(0, 200)
  if ('meal' in p && MEAL_SET.has(p.meal)) out.meal = p.meal
  if ('servings' in p) out.servings = servingsOf(p.servings)
  for (const k of ['calories', 'protein_g', 'carbs_g', 'fat_g']) if (k in p) out[k] = pos(p[k])
  return out
}

function cleanFood(f) {
  return {
    name: String(f.name || 'Food').slice(0, 200),
    serving: f.serving || null,
    calories: pos(f.calories),
    protein_g: pos(f.protein_g),
    carbs_g: pos(f.carbs_g),
    fat_g: pos(f.fat_g),
  }
}

// Saved-food ids in a backup belong to the account (or device) that made it.
// Re-pointing them at this account would break the foreign key, so drop them.
const forImport = (entries) => (entries || []).map((e) => ({ ...e, food_id: null }))

function dedupeRecent(entries, limit) {
  const seen = new Set()
  const out = []
  for (const e of entries) {
    const key = `${e.name.toLowerCase()}|${e.calories}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: `recent:${e.id}`,
      name: e.name,
      serving: e.serving,
      calories: e.calories,
      protein_g: e.protein_g,
      carbs_g: e.carbs_g,
      fat_g: e.fat_g,
      food_id: e.food_id,
      recent: true,
    })
    if (out.length >= limit) break
  }
  return out
}

const throwIf = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}

// ---------------- Cloud (Supabase) ----------------

export function createCloudStore(userId) {
  const sb = supabase
  return {
    mode: 'cloud',

    async getProfile() {
      return throwIf(await sb.from('profiles').select('*').eq('id', userId).maybeSingle())
    },
    async saveProfile(p) {
      const row = { id: userId, ...pickProfile(p) }
      let res = await sb.from('profiles').upsert(row).select('*').single()
      if (res.error && /exercise_eatback_pct/.test(res.error.message)) {
        // Migration 0002 not applied yet: save everything else.
        delete row.exercise_eatback_pct
        res = await sb.from('profiles').upsert(row).select('*').single()
      }
      return throwIf(res)
    },

    async listEntries(from, to) {
      return throwIf(
        await sb.from('food_entries').select(ENTRY_FIELDS)
          .gte('log_date', from).lte('log_date', to)
          .order('created_at', { ascending: true }),
      )
    },
    async addEntries(entries) {
      const rows = entries.map((e) => ({ ...cleanEntry(e), user_id: userId }))
      return throwIf(await sb.from('food_entries').insert(rows).select(ENTRY_FIELDS))
    },
    async updateEntry(id, patch) {
      return throwIf(
        await sb.from('food_entries').update(cleanEntryPatch(patch)).eq('id', id).select(ENTRY_FIELDS).single(),
      )
    },
    async deleteEntry(id) {
      throwIf(await sb.from('food_entries').delete().eq('id', id))
    },
    async listRecentFoods(limit = 30) {
      const rows = throwIf(
        await sb.from('food_entries').select(ENTRY_FIELDS)
          .order('created_at', { ascending: false }).limit(300),
      )
      return dedupeRecent(rows, limit)
    },

    async listFoods() {
      return throwIf(await sb.from('foods').select('*').order('name'))
    },
    async saveFood(f) {
      const row = { ...cleanFood(f), user_id: userId }
      if (f.id && !String(f.id).includes(':')) row.id = f.id
      return throwIf(await sb.from('foods').upsert(row).select('*').single())
    },
    async deleteFood(id) {
      throwIf(await sb.from('foods').delete().eq('id', id))
    },

    async listWeights() {
      return throwIf(
        await sb.from('weights').select('id,log_date,weight_kg,note').order('log_date'),
      )
    },
    async upsertWeight({ log_date, weight_kg, note = null }) {
      return throwIf(
        await sb.from('weights')
          .upsert({ user_id: userId, log_date, weight_kg, note }, { onConflict: 'user_id,log_date' })
          .select('id,log_date,weight_kg,note').single(),
      )
    },
    async deleteWeight(id) {
      throwIf(await sb.from('weights').delete().eq('id', id))
    },

    async listWorkouts(from, to) {
      const { data, error } = await sb.from('workouts').select(WORKOUT_FIELDS)
        .gte('log_date', from).lte('log_date', to).order('created_at', { ascending: true })
      if (error) throw workoutError(error)
      return data
    },
    async addWorkout(w) {
      const { data, error } = await sb.from('workouts').insert({ ...cleanWorkout(w), user_id: userId })
        .select(WORKOUT_FIELDS).single()
      if (error) throw workoutError(error)
      return data
    },
    async updateWorkout(id, w) {
      const { log_date, ...patch } = cleanWorkout(w)
      const { data, error } = await sb.from('workouts').update(patch).eq('id', id).select(WORKOUT_FIELDS).single()
      if (error) throw workoutError(error)
      return data
    },
    async deleteWorkout(id) {
      throwIf(await sb.from('workouts').delete().eq('id', id))
    },

    async listCoachMessages(limit = 60) {
      const rows = throwIf(
        await sb.from('coach_messages').select('id,role,content,created_at')
          .order('created_at', { ascending: false }).limit(limit),
      )
      return rows.reverse()
    },
    async addCoachMessage({ role, content }) {
      return throwIf(
        await sb.from('coach_messages').insert({ user_id: userId, role, content })
          .select('id,role,content,created_at').single(),
      )
    },
    async clearCoachMessages() {
      throwIf(await sb.from('coach_messages').delete().eq('user_id', userId))
    },

    async getAiUsage(day) {
      return throwIf(
        await sb.from('ai_usage').select('*').eq('user_id', userId).eq('day', day).maybeSingle(),
      )
    },

    async exportAll() {
      const [profile, entries, foods, weights, coach, workouts] = await Promise.all([
        this.getProfile(),
        throwIf(await sb.from('food_entries').select(ENTRY_FIELDS).order('log_date')),
        this.listFoods(),
        this.listWeights(),
        throwIf(await sb.from('coach_messages').select('role,content,created_at').order('created_at')),
        this.listWorkouts('1900-01-01', '2999-12-31').catch(() => []),
      ])
      return { app: 'loseitandloveit', version: 1, exported_at: new Date().toISOString(), profile, entries, foods, weights, workouts, coach_messages: coach }
    },
    async importAll(data) {
      if (data.profile) await this.saveProfile(data.profile)
      const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
      for (const c of chunks(forImport(data.entries), 200)) await this.addEntries(c)
      for (const f of data.foods || []) await this.saveFood({ ...f, id: undefined })
      for (const w of data.weights || []) await this.upsertWeight(w)
      for (const w of data.workouts || []) await this.addWorkout(w)
    },
  }
}

// ---------------- Local (this device only) ----------------

const LOCAL_KEY = 'lili:local:v1'
const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* storage blocked or corrupt: start empty */
  }
  return { profile: null, entries: [], foods: [], weights: [], workouts: [], coach_messages: [] }
}

export function createLocalStore() {
  let db = loadLocal()
  db.workouts ||= [] // stores saved before workouts existed
  const save = () => {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(db))
    } catch (e) {
      throw new Error('Could not save on this device (storage full or blocked).')
    }
  }
  const now = () => new Date().toISOString()

  return {
    mode: 'local',

    async getProfile() {
      return db.profile
    },
    async saveProfile(p) {
      db.profile = { ...(db.profile || {}), ...pickProfile(p), id: 'local' }
      save()
      return db.profile
    },

    async listEntries(from, to) {
      return db.entries
        .filter((e) => e.log_date >= from && e.log_date <= to)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    },
    async addEntries(entries) {
      const rows = entries.map((e) => ({ ...cleanEntry(e), id: uid(), created_at: now() }))
      db.entries.push(...rows)
      save()
      return rows
    },
    async updateEntry(id, patch) {
      const e = db.entries.find((x) => x.id === id)
      if (!e) throw new Error('Entry not found')
      Object.assign(e, cleanEntryPatch(patch))
      save()
      return e
    },
    async deleteEntry(id) {
      db.entries = db.entries.filter((x) => x.id !== id)
      save()
    },
    async listRecentFoods(limit = 30) {
      const rows = [...db.entries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 300)
      return dedupeRecent(rows, limit)
    },

    async listFoods() {
      return [...db.foods].sort((a, b) => a.name.localeCompare(b.name))
    },
    async saveFood(f) {
      const existing = f.id && db.foods.find((x) => x.id === f.id)
      if (existing) {
        Object.assign(existing, cleanFood(f))
        save()
        return existing
      }
      const row = { ...cleanFood(f), id: uid(), created_at: now() }
      db.foods.push(row)
      save()
      return row
    },
    async deleteFood(id) {
      db.foods = db.foods.filter((x) => x.id !== id)
      save()
    },

    async listWeights() {
      return [...db.weights].sort((a, b) => (a.log_date < b.log_date ? -1 : 1))
    },
    async upsertWeight({ log_date, weight_kg, note = null }) {
      let w = db.weights.find((x) => x.log_date === log_date)
      if (w) Object.assign(w, { weight_kg, note })
      else {
        w = { id: uid(), log_date, weight_kg, note }
        db.weights.push(w)
      }
      save()
      return w
    },
    async deleteWeight(id) {
      db.weights = db.weights.filter((x) => x.id !== id)
      save()
    },

    async listWorkouts(from, to) {
      return db.workouts
        .filter((w) => w.log_date >= from && w.log_date <= to)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    },
    async addWorkout(w) {
      const row = { ...cleanWorkout(w), id: uid(), created_at: now() }
      db.workouts.push(row)
      save()
      return row
    },
    async updateWorkout(id, w) {
      const row = db.workouts.find((x) => x.id === id)
      if (!row) throw new Error('Workout not found')
      const { log_date, ...patch } = cleanWorkout(w)
      Object.assign(row, patch)
      save()
      return row
    },
    async deleteWorkout(id) {
      db.workouts = db.workouts.filter((x) => x.id !== id)
      save()
    },

    async listCoachMessages(limit = 60) {
      return db.coach_messages.slice(-limit)
    },
    async addCoachMessage({ role, content }) {
      const m = { id: uid(), role, content, created_at: now() }
      db.coach_messages.push(m)
      save()
      return m
    },
    async clearCoachMessages() {
      db.coach_messages = []
      save()
    },

    async getAiUsage() {
      return null
    },

    async exportAll() {
      return { app: 'loseitandloveit', version: 1, exported_at: now(), ...db }
    },
    async importAll(data) {
      if (data.profile) await this.saveProfile(data.profile)
      await this.addEntries(forImport(data.entries))
      for (const f of data.foods || []) await this.saveFood({ ...f, id: undefined })
      for (const w of data.weights || []) await this.upsertWeight(w)
      for (const w of data.workouts || []) await this.addWorkout(w)
    },

    wipe() {
      db = { profile: null, entries: [], foods: [], weights: [], workouts: [], coach_messages: [] }
      try {
        localStorage.removeItem(LOCAL_KEY)
      } catch {
        /* ignore */
      }
    },
  }
}
