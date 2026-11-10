// The data engine: every store method, working on an in-memory copy of the
// user's data that is persisted to this device.
//
//   local mode -> the engine is the whole store.
//   cloud mode -> the engine is a mirror of Supabase. Reads never wait for the
//                 network; each write is reported through onWrite so sync.js
//                 can queue it and push it in the background.
//
// Pure: no browser or Supabase imports. Storage is injected so it runs in tests.

import { cleanConditions } from './calc.js'

export const PROFILE_FIELDS = [
  'display_name', 'sex', 'birth_year', 'height_cm', 'start_weight_kg', 'goal_weight_kg',
  'activity_level', 'weekly_rate_kg', 'units', 'day_start_hour',
  'calorie_target_override', 'protein_target_override', 'coach_notes', 'exercise_eatback_pct',
  // 0003: GLP-1 plan and water goal
  'glp1_med', 'glp1_name', 'glp1_dose', 'glp1_unit', 'glp1_frequency', 'glp1_started_on', 'water_target_ml',
  // 0004: profile photo
  'avatar',
  // 0005: health conditions (PCOS etc.)
  'conditions',
]

// Local table -> Supabase table and the columns that are synced.
//   dated:   has log_date; routine syncs only fetch a recent window
//   perDay:  one row per day (unique on user_id + log_date)
//   recent:  only the newest N rows are kept on the device
//   migration: the file to run if the table is missing
export const TABLES = {
  foods: { remote: 'foods', cols: ['id', 'name', 'serving', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'created_at'] },
  entries: {
    remote: 'food_entries',
    cols: ['id', 'log_date', 'meal', 'name', 'serving', 'servings', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'source', 'food_id', 'created_at'],
    dated: true,
  },
  weights: { remote: 'weights', cols: ['id', 'log_date', 'weight_kg', 'note'], perDay: true },
  workouts: {
    remote: 'workouts',
    cols: ['id', 'log_date', 'kind', 'name', 'duration_min', 'speed_kmh', 'incline_pct', 'distance_km', 'mode', 'activity', 'intensity', 'exercises', 'calories_burned', 'calories_source', 'notes', 'created_at'],
    dated: true,
    migration: 'supabase/migrations/0002_workouts.sql',
  },
  doses: {
    remote: 'medication_doses',
    cols: ['id', 'log_date', 'taken_at', 'med', 'med_name', 'dose', 'unit', 'route', 'site', 'notes', 'created_at'],
    dated: true,
    migration: 'supabase/migrations/0003_glp1_checkins.sql',
  },
  daily_logs: {
    remote: 'daily_logs',
    cols: ['id', 'log_date', 'mood', 'energy', 'appetite', 'water_ml', 'symptoms', 'note', 'updated_at'],
    dated: true,
    perDay: true,
    migration: 'supabase/migrations/0003_glp1_checkins.sql',
  },
  coach_messages: { remote: 'coach_messages', cols: ['id', 'role', 'content', 'created_at'], recent: 100 },
  insights: {
    remote: 'coach_insights',
    cols: ['id', 'log_date', 'headline', 'tips', 'fingerprint', 'dismissed', 'created_at'],
    recent: 30,
    migration: 'supabase/migrations/0004_avatar_mimi_checkins.sql',
  },
}
export const TABLE_NAMES = Object.keys(TABLES)

export const emptyDb = () => ({ profile: null, entries: [], foods: [], weights: [], workouts: [], doses: [], daily_logs: [], coach_messages: [], insights: [] })

// ---------- cleaning: the same rules the database enforces ----------

const SITE_IDS = new Set(['abdomen-ul', 'abdomen-ur', 'abdomen-ll', 'abdomen-lr', 'thigh-l', 'thigh-r', 'arm-l', 'arm-r'])
const MEAL_SET = new Set(['breakfast', 'lunch', 'dinner', 'snack'])
const SOURCE_SET = new Set(['manual', 'library', 'recent', 'ai', 'quick'])
const TIP_KINDS = new Set(['food', 'protein', 'water', 'move', 'weight', 'mood', 'dose', 'praise', 'rest'])

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
// Non-negative number (the database rejects negatives).
const pos = (v) => Math.max(0, Number(v) || 0)
// Servings must be > 0 and <= 50 (table check constraint).
const servingsOf = (v) => Math.min(50, Math.max(0.01, Number(v ?? 1) || 1))
const clamp15 = (v) => (v == null || v === '' ? null : Math.max(1, Math.min(5, Math.round(Number(v)))))

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

function cleanDose(d, nowIso) {
  const oral = d.route === 'oral'
  return {
    log_date: d.log_date,
    taken_at: d.taken_at || nowIso,
    med: String(d.med || 'other').slice(0, 40),
    med_name: String(d.med_name || 'GLP-1').slice(0, 80),
    dose: Math.max(0.01, Math.min(1000, Number(d.dose) || 0.01)),
    unit: d.unit === 'mcg' ? 'mcg' : 'mg',
    route: oral ? 'oral' : 'injection',
    site: !oral && SITE_IDS.has(d.site) ? d.site : null,
    notes: d.notes ? String(d.notes).slice(0, 500) : null,
  }
}

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

export function pickProfile(p) {
  const out = {}
  for (const k of PROFILE_FIELDS) if (k in p) out[k] = p[k] === '' ? null : p[k]
  if ('conditions' in out) out.conditions = cleanConditions(out.conditions, out.sex ?? p.sex)
  return out
}

function cleanWeight({ log_date, weight_kg, note }) {
  const kg = Math.round(Number(weight_kg) * 100) / 100
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(log_date || ''))) throw new Error('Pick a date for the weigh-in.')
  if (!(kg >= 30 && kg <= 350)) throw new Error('Enter a realistic weight.')
  const n = note == null ? '' : String(note).trim().slice(0, 300)
  return { log_date, weight_kg: kg, note: n || null }
}

const duplicateWeighIn = (date) => new Error(`You already have a weigh-in on ${date}. Edit or delete that one instead.`)

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
    food_id: e.food_id && !String(e.food_id).includes(':') ? e.food_id : null,
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

export function remapEntries(entries = [], foodIds = new Map()) {
  return entries.map((e) => ({ ...e, food_id: e.food_id ? foodIds.get(e.food_id) ?? null : null }))
}

// Rows get their id on the device, so they can be created offline. Postgres
// needs real UUIDs, hence the fallback for browsers without randomUUID.
export function newId() {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const byCreated = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)
const byDate = (a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0)
const byTakenDesc = (a, b) => (a.taken_at < b.taken_at ? 1 : a.taken_at > b.taken_at ? -1 : 0)
const copy = (row) => (row ? { ...row } : row)

/**
 * @param {object} o
 * @param {object} [o.initial]   a previously saved database
 * @param {(db:object)=>void} o.persist  save the database; may throw
 * @param {(table:string, kind:'upsert'|'delete'|'clear', id?:string)=>void} [o.onWrite]
 * @param {string} [o.profileId]
 */
export function createEngine({ initial, persist, onWrite = () => {}, profileId = 'local', now = () => new Date().toISOString() }) {
  let db = { ...emptyDb(), ...(initial || {}) }
  for (const t of TABLE_NAMES) if (!Array.isArray(db[t])) db[t] = []

  const save = () => persist(db)
  const wrote = (table, kind, id) => onWrite(table, kind, id)
  const find = (table, id, what) => {
    const row = db[table].find((x) => x.id === id)
    if (!row) throw new Error(`${what} not found`)
    return row
  }
  const remove = (table, id) => {
    db[table] = db[table].filter((x) => x.id !== id)
    wrote(table, 'delete', id)
    save()
  }

  const api = {
    /** The live database object (sync.js merges server rows into it). */
    get db() {
      return db
    },
    save,

    async getProfile() {
      return copy(db.profile)
    },
    async saveProfile(p) {
      db.profile = { ...(db.profile || {}), ...pickProfile(p), id: profileId, updated_at: now() }
      wrote('profile', 'upsert', 'profile')
      save()
      return copy(db.profile)
    },

    async listEntries(from, to) {
      return db.entries.filter((e) => e.log_date >= from && e.log_date <= to).sort(byCreated).map(copy)
    },
    async addEntries(entries) {
      const stamp = Date.parse(now())
      // One millisecond apart so a batch keeps its order when sorted by time.
      const rows = entries.map((e, i) => ({ ...cleanEntry(e), id: newId(), created_at: new Date(stamp + i).toISOString() }))
      db.entries.push(...rows)
      for (const r of rows) wrote('entries', 'upsert', r.id)
      save()
      return rows.map(copy)
    },
    async updateEntry(id, patch) {
      const e = find('entries', id, 'Entry')
      Object.assign(e, cleanEntryPatch(patch))
      wrote('entries', 'upsert', id)
      save()
      return copy(e)
    },
    async deleteEntry(id) {
      remove('entries', id)
    },
    async listRecentFoods(limit = 30) {
      const rows = [...db.entries].sort((a, b) => byCreated(b, a)).slice(0, 300)
      return dedupeRecent(rows, limit)
    },

    async listFoods() {
      return [...db.foods].sort((a, b) => a.name.localeCompare(b.name)).map(copy)
    },
    async saveFood(f) {
      const existing = f.id && db.foods.find((x) => x.id === f.id)
      const row = existing || { id: newId(), created_at: now() }
      Object.assign(row, cleanFood(f))
      if (!existing) db.foods.push(row)
      wrote('foods', 'upsert', row.id)
      save()
      return copy(row)
    },
    async deleteFood(id) {
      // The database clears food_id on entries that pointed at this food.
      for (const e of db.entries) if (e.food_id === id) e.food_id = null
      remove('foods', id)
    },

    async listWeights() {
      return [...db.weights].sort(byDate).map(copy)
    },
    // One weigh-in per day: logging the same date again replaces it.
    async upsertWeight(input) {
      const row = cleanWeight(input)
      let w = db.weights.find((x) => x.log_date === row.log_date)
      if (w) Object.assign(w, row)
      else {
        w = { id: newId(), ...row }
        db.weights.push(w)
      }
      wrote('weights', 'upsert', w.id)
      save()
      return copy(w)
    },
    async updateWeight(id, input) {
      const row = cleanWeight(input)
      const w = find('weights', id, 'Weigh-in')
      if (db.weights.some((x) => x.id !== id && x.log_date === row.log_date)) throw duplicateWeighIn(row.log_date)
      Object.assign(w, row)
      wrote('weights', 'upsert', id)
      save()
      return copy(w)
    },
    async deleteWeight(id) {
      remove('weights', id)
    },

    async listWorkouts(from, to) {
      return db.workouts.filter((w) => w.log_date >= from && w.log_date <= to).sort(byCreated).map(copy)
    },
    async addWorkout(w) {
      const row = { ...cleanWorkout(w), id: newId(), created_at: now() }
      db.workouts.push(row)
      wrote('workouts', 'upsert', row.id)
      save()
      return copy(row)
    },
    async updateWorkout(id, w) {
      const row = find('workouts', id, 'Workout')
      const { log_date, ...patch } = cleanWorkout(w)
      Object.assign(row, patch)
      wrote('workouts', 'upsert', id)
      save()
      return copy(row)
    },
    async deleteWorkout(id) {
      remove('workouts', id)
    },

    // GLP-1 doses
    async listDoses(from, to) {
      return db.doses.filter((d) => d.log_date >= from && d.log_date <= to).sort(byTakenDesc).map(copy)
    },
    async listRecentDoses(limit = 12) {
      return [...db.doses].sort(byTakenDesc).slice(0, limit).map(copy)
    },
    async addDose(d) {
      const row = { ...cleanDose(d, now()), id: newId(), created_at: now() }
      db.doses.push(row)
      wrote('doses', 'upsert', row.id)
      save()
      return copy(row)
    },
    async updateDose(id, d) {
      const row = find('doses', id, 'Dose')
      Object.assign(row, cleanDose(d, now()))
      wrote('doses', 'upsert', id)
      save()
      return copy(row)
    },
    async deleteDose(id) {
      remove('doses', id)
    },

    // Daily check-in: mood, energy, appetite, water, symptoms (one row per day)
    async listDailyLogs(from, to) {
      return db.daily_logs.filter((l) => l.log_date >= from && l.log_date <= to).sort(byDate).map(copy)
    },
    async saveDailyLog(log_date, patch) {
      let row = db.daily_logs.find((l) => l.log_date === log_date)
      if (!row) {
        row = { id: newId(), log_date, mood: null, energy: null, appetite: null, water_ml: 0, symptoms: [], note: null }
        db.daily_logs.push(row)
      }
      Object.assign(row, cleanDaily(patch), { updated_at: now() })
      wrote('daily_logs', 'upsert', row.id)
      save()
      return copy(row)
    },

    async listCoachMessages(limit = 60) {
      return [...db.coach_messages].sort(byCreated).slice(-limit).map(copy)
    },
    async addCoachMessage({ role, content }) {
      const m = { id: newId(), role, content, created_at: now() }
      db.coach_messages.push(m)
      wrote('coach_messages', 'upsert', m.id)
      save()
      return copy(m)
    },
    async clearCoachMessages() {
      db.coach_messages = []
      wrote('coach_messages', 'clear')
      save()
    },

    // Mimi's check-ins (AI recommendations every few hours)
    async latestInsight() {
      return copy([...db.insights].sort(byCreated).pop() || null)
    },
    async listInsights(limit = 6) {
      return [...db.insights].sort(byCreated).slice(-limit).reverse().map(copy)
    },
    async addInsight(i) {
      const row = { ...cleanInsight(i), id: newId(), dismissed: false, created_at: now() }
      db.insights = [...db.insights, row].sort(byCreated).slice(-30)
      wrote('insights', 'upsert', row.id)
      save()
      return copy(row)
    },
    async dismissInsight(id) {
      const row = db.insights.find((x) => x.id === id)
      if (!row) return
      row.dismissed = true
      wrote('insights', 'upsert', id)
      save()
    },

    async getAiUsage() {
      return null
    },

    async exportAll() {
      const out = { app: 'loseitandloveit', version: 1, exported_at: now(), profile: copy(db.profile) }
      for (const t of TABLE_NAMES) out[t] = db[t].map(copy)
      return out
    },
    async importAll(data) {
      if (data.profile) await api.saveProfile(data.profile)
      // Foods first: they get new ids, so entries must point at the new ones.
      const foodIds = new Map()
      for (const f of data.foods || []) {
        const saved = await api.saveFood({ ...f, id: undefined })
        if (f.id) foodIds.set(f.id, saved.id)
      }
      await api.addEntries(remapEntries(data.entries, foodIds))
      for (const w of data.weights || []) await api.upsertWeight(w)
      for (const w of data.workouts || []) await api.addWorkout(w)
      for (const d of data.doses || []) await api.addDose(d)
      for (const l of data.daily_logs || []) await api.saveDailyLog(l.log_date, l)
    },

    /** Forget everything on this device. */
    reset() {
      db = emptyDb()
    },
  }
  return api
}
