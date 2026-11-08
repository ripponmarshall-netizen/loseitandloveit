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
  // 0003: GLP-1 plan and water goal
  'glp1_med', 'glp1_name', 'glp1_dose', 'glp1_unit', 'glp1_frequency', 'glp1_started_on', 'water_target_ml',
  // 0004: profile photo
  'avatar',
]
const DOSE_FIELDS = 'id,log_date,taken_at,med,med_name,dose,unit,route,site,notes,created_at'
const DAILY_FIELDS = 'id,log_date,mood,energy,appetite,water_ml,symptoms,note,updated_at'
const SITE_IDS = new Set(['abdomen-ul', 'abdomen-ur', 'abdomen-ll', 'abdomen-lr', 'thigh-l', 'thigh-r', 'arm-l', 'arm-r'])
const MIGRATION_0003 = 'supabase/migrations/0003_glp1_checkins.sql'
const MIGRATION_0004 = 'supabase/migrations/0004_avatar_mimi_checkins.sql'
const INSIGHT_FIELDS = 'id,log_date,headline,tips,fingerprint,dismissed,created_at'
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

function cleanDose(d) {
  const oral = d.route === 'oral'
  return {
    log_date: d.log_date,
    taken_at: d.taken_at || new Date().toISOString(),
    med: String(d.med || 'other').slice(0, 40),
    med_name: String(d.med_name || 'GLP-1').slice(0, 80),
    dose: Math.max(0.01, Math.min(1000, Number(d.dose) || 0.01)),
    unit: d.unit === 'mcg' ? 'mcg' : 'mg',
    route: oral ? 'oral' : 'injection',
    site: !oral && SITE_IDS.has(d.site) ? d.site : null,
    notes: d.notes ? String(d.notes).slice(0, 500) : null,
  }
}

const clamp15 = (v) => (v == null || v === '' ? null : Math.max(1, Math.min(5, Math.round(Number(v)))))

// Only the fields present in the patch, so a partial update never wipes the rest.
function cleanDaily(patch) {
  const out = {}
  if ('mood' in patch) out.mood = clamp15(patch.mood)
  if ('energy' in patch) out.energy = clamp15(patch.energy)
  if ('appetite' in patch) out.appetite = clamp15(patch.appetite)
  if ('water_ml' in patch) out.water_ml = Math.max(0, Math.min(15000, Math.round(Number(patch.water_ml) || 0)))
  if ('symptoms' in patch) out.symptoms = [...new Set((patch.symptoms || []).map((x) => String(x).slice(0, 40)))].slice(0, 20)
  if ('note' in patch) out.note = patch.note ? String(patch.note).slice(0, 1000) : null
  return out
}

// Friendlier message when the GLP-1 / check-in migration hasn't been run yet.
function checkinError(error) {
  if (/(medication_doses|daily_logs)/.test(error.message) && /(does not exist|could not find|schema cache)/i.test(error.message)) {
    return new Error(`GLP-1 and check-ins need a database update: run ${MIGRATION_0003} in the Supabase SQL Editor.`)
  }
  return new Error(error.message)
}

// Mimi's check-ins: a headline and up to three short tips.
const TIP_KINDS = new Set(['food', 'protein', 'water', 'move', 'weight', 'mood', 'dose', 'praise', 'rest'])
function cleanInsight(i) {
  return {
    log_date: i.log_date,
    headline: String(i.headline || 'Check-in').slice(0, 200),
    tips: (Array.isArray(i.tips) ? i.tips : [])
      .filter((t) => t && String(t.text || '').trim())
      .slice(0, 3)
      .map((t) => ({ text: String(t.text).slice(0, 300), kind: TIP_KINDS.has(t.kind) ? t.kind : 'food' })),
    fingerprint: i.fingerprint ? String(i.fingerprint).slice(0, 200) : null,
  }
}

function insightError(error) {
  if (/coach_insights/.test(error.message) && /(does not exist|could not find|schema cache)/i.test(error.message)) {
    const e = new Error(`Mimi's check-ins need a database update: run ${MIGRATION_0004} in the Supabase SQL Editor.`)
    e.missingMigration = true
    return e
  }
  return new Error(error.message)
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

// Import helpers shared by both stores: saved foods get new ids on import.
async function importFoods(store, foods = []) {
  const map = new Map()
  for (const f of foods) {
    const saved = await store.saveFood({ ...f, id: undefined })
    if (f.id) map.set(f.id, saved.id)
  }
  return map
}

export function remapEntries(entries = [], foodIds = new Map()) {
  return entries.map((e) => ({ ...e, food_id: e.food_id ? foodIds.get(e.food_id) ?? null : null }))
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
      // A column from a migration that hasn't been run yet: drop it and save
      // the rest. Only complain if the user actually set a value for it.
      const dropped = []
      let res = await sb.from('profiles').upsert(row).select('*').single()
      for (let i = 0; res.error && i < 12; i++) {
        const col = res.error.message.match(/Could not find the '(\w+)' column/)?.[1] || res.error.message.match(/column "?(\w+)"? of relation "profiles" does not exist/)?.[1]
        if (!col || !(col in row)) break
        if (row[col] != null) dropped.push(col)
        delete row[col]
        res = await sb.from('profiles').upsert(row).select('*').single()
      }
      const saved = throwIf(res)
      if (dropped.length) {
        const file = dropped.includes('avatar')
          ? MIGRATION_0004
          : dropped.some((c) => c.startsWith('glp1_') || c === 'water_target_ml') ? MIGRATION_0003 : 'supabase/migrations/0002_workouts.sql'
        const what = dropped.map((c) => (c === 'avatar' ? 'your photo' : c)).join(', ')
        const err = new Error(`Saved, except ${what}: run ${file} in the Supabase SQL Editor first.`)
        err.saved = saved
        throw err
      }
      return saved
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

    // GLP-1 doses
    async listDoses(from, to) {
      const { data, error } = await sb.from('medication_doses').select(DOSE_FIELDS)
        .gte('log_date', from).lte('log_date', to).order('taken_at', { ascending: false })
      if (error) throw checkinError(error)
      return data
    },
    async listRecentDoses(limit = 12) {
      const { data, error } = await sb.from('medication_doses').select(DOSE_FIELDS)
        .order('taken_at', { ascending: false }).limit(limit)
      if (error) throw checkinError(error)
      return data
    },
    async addDose(d) {
      const { data, error } = await sb.from('medication_doses').insert({ ...cleanDose(d), user_id: userId }).select(DOSE_FIELDS).single()
      if (error) throw checkinError(error)
      return data
    },
    async updateDose(id, d) {
      const { data, error } = await sb.from('medication_doses').update(cleanDose(d)).eq('id', id).select(DOSE_FIELDS).single()
      if (error) throw checkinError(error)
      return data
    },
    async deleteDose(id) {
      throwIf(await sb.from('medication_doses').delete().eq('id', id))
    },

    // Daily check-in: mood, energy, appetite, water, symptoms (one row per day)
    async listDailyLogs(from, to) {
      const { data, error } = await sb.from('daily_logs').select(DAILY_FIELDS)
        .gte('log_date', from).lte('log_date', to).order('log_date')
      if (error) throw checkinError(error)
      return data
    },
    async saveDailyLog(log_date, patch) {
      const { data, error } = await sb.from('daily_logs')
        .upsert({ user_id: userId, log_date, ...cleanDaily(patch) }, { onConflict: 'user_id,log_date' })
        .select(DAILY_FIELDS).single()
      if (error) throw checkinError(error)
      return data
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

    // Mimi's check-ins (AI recommendations every few hours)
    async latestInsight() {
      const { data, error } = await sb.from('coach_insights').select(INSIGHT_FIELDS)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw insightError(error)
      return data
    },
    async listInsights(limit = 6) {
      const { data, error } = await sb.from('coach_insights').select(INSIGHT_FIELDS)
        .order('created_at', { ascending: false }).limit(limit)
      if (error) throw insightError(error)
      return data
    },
    async addInsight(i) {
      const { data, error } = await sb.from('coach_insights').insert({ ...cleanInsight(i), user_id: userId }).select(INSIGHT_FIELDS).single()
      if (error) throw insightError(error)
      return data
    },
    async dismissInsight(id) {
      const { error } = await sb.from('coach_insights').update({ dismissed: true }).eq('id', id)
      if (error) throw insightError(error)
    },

    async getAiUsage(day) {
      return throwIf(
        await sb.from('ai_usage').select('*').eq('user_id', userId).eq('day', day).maybeSingle(),
      )
    },

    async exportAll() {
      const [profile, entries, foods, weights, coach, workouts, doses, daily_logs] = await Promise.all([
        this.getProfile(),
        throwIf(await sb.from('food_entries').select(ENTRY_FIELDS).order('log_date')),
        this.listFoods(),
        this.listWeights(),
        throwIf(await sb.from('coach_messages').select('role,content,created_at').order('created_at')),
        this.listWorkouts('1900-01-01', '2999-12-31').catch(() => []),
        this.listDoses('1900-01-01', '2999-12-31').catch(() => []),
        this.listDailyLogs('1900-01-01', '2999-12-31').catch(() => []),
      ])
      return { app: 'loseitandloveit', version: 1, exported_at: new Date().toISOString(), profile, entries, foods, weights, workouts, doses, daily_logs, coach_messages: coach }
    },
    async importAll(data) {
      if (data.profile) await this.saveProfile(data.profile)
      // Foods first: they get new ids, so entries must point at the new ones
      // (the old ids would break the food_id foreign key).
      const foodIds = await importFoods(this, data.foods)
      const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
      for (const c of chunks(remapEntries(data.entries, foodIds), 200)) await this.addEntries(c)
      for (const w of data.weights || []) await this.upsertWeight(w)
      for (const w of data.workouts || []) await this.addWorkout(w)
      for (const d of data.doses || []) await this.addDose(d)
      for (const l of data.daily_logs || []) await this.saveDailyLog(l.log_date, l)
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
  return { profile: null, entries: [], foods: [], weights: [], workouts: [], doses: [], daily_logs: [], coach_messages: [], insights: [] }
}

export function createLocalStore() {
  let db = loadLocal()
  // Stores saved before these existed
  db.workouts ||= []
  db.doses ||= []
  db.daily_logs ||= []
  db.insights ||= []
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

    async listDoses(from, to) {
      return db.doses
        .filter((d) => d.log_date >= from && d.log_date <= to)
        .sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))
    },
    async listRecentDoses(limit = 12) {
      return [...db.doses].sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1)).slice(0, limit)
    },
    async addDose(d) {
      const row = { ...cleanDose(d), id: uid(), created_at: now() }
      db.doses.push(row)
      save()
      return row
    },
    async updateDose(id, d) {
      const row = db.doses.find((x) => x.id === id)
      if (!row) throw new Error('Dose not found')
      Object.assign(row, cleanDose(d))
      save()
      return row
    },
    async deleteDose(id) {
      db.doses = db.doses.filter((x) => x.id !== id)
      save()
    },

    async listDailyLogs(from, to) {
      return db.daily_logs.filter((l) => l.log_date >= from && l.log_date <= to).sort((a, b) => (a.log_date < b.log_date ? -1 : 1))
    },
    async saveDailyLog(log_date, patch) {
      let row = db.daily_logs.find((l) => l.log_date === log_date)
      if (!row) {
        row = { id: uid(), log_date, mood: null, energy: null, appetite: null, water_ml: 0, symptoms: [], note: null }
        db.daily_logs.push(row)
      }
      Object.assign(row, cleanDaily(patch), { updated_at: now() })
      save()
      return row
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

    async latestInsight() {
      return db.insights[db.insights.length - 1] || null
    },
    async listInsights(limit = 6) {
      return db.insights.slice(-limit).reverse()
    },
    async addInsight(i) {
      const row = { ...cleanInsight(i), id: uid(), dismissed: false, created_at: now() }
      db.insights = [...db.insights, row].slice(-30)
      save()
      return row
    },
    async dismissInsight(id) {
      const row = db.insights.find((x) => x.id === id)
      if (row) row.dismissed = true
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
      const foodIds = await importFoods(this, data.foods)
      await this.addEntries(remapEntries(data.entries, foodIds))
      for (const w of data.weights || []) await this.upsertWeight(w)
      for (const w of data.workouts || []) await this.addWorkout(w)
      for (const d of data.doses || []) await this.addDose(d)
      for (const l of data.daily_logs || []) await this.saveDailyLog(l.log_date, l)
    },

    wipe() {
      db = { profile: null, entries: [], foods: [], weights: [], workouts: [], doses: [], daily_logs: [], coach_messages: [], insights: [] }
      try {
        localStorage.removeItem(LOCAL_KEY)
      } catch {
        /* ignore */
      }
    },
  }
}
