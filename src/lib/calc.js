import { addDays, daysBetween } from './dates.js'

// ~7700 kcal per kg of body-fat loss. A rule of thumb, not physics:
// early weeks include water/glycogen, so real-world loss is front-loaded.
export const KCAL_PER_KG = 7700

export const ACTIVITY = {
  sedentary: { mult: 1.2, label: 'Sedentary', desc: 'Desk work, little exercise' },
  light: { mult: 1.375, label: 'Lightly active', desc: 'On your feet some, exercise 1–3×/week' },
  moderate: { mult: 1.55, label: 'Moderately active', desc: 'Active job or exercise 3–5×/week' },
  active: { mult: 1.725, label: 'Very active', desc: 'Physical job plus regular training' },
  athlete: { mult: 1.9, label: 'Extremely active', desc: 'Hard training most days' },
}

// Common minimums used by dietitians when there is no medical supervision.
export const CALORIE_FLOOR = { female: 1200, male: 1500 }

// Never plan to lose more than this fraction of body weight per week.
export const MAX_WEEKLY_LOSS_FRACTION = 0.01

// ---------- Health conditions ----------
//
// Self-reported, doctor-diagnosed conditions that change the guidance. Stored
// as text[] on the profile (migration 0005). Keys must match its check constraint.
export const CONDITIONS = {
  pcos: { label: 'PCOS (polycystic ovary syndrome)', short: 'PCOS', female: true },
  insulin_resistance: { label: 'Insulin resistance or prediabetes', short: 'Insulin resistance' },
  type2_diabetes: { label: 'Type 2 diabetes', short: 'Type 2 diabetes' },
  hypothyroidism: { label: 'Underactive thyroid (hypothyroidism)', short: 'Hypothyroidism' },
  hypertension: { label: 'High blood pressure', short: 'High blood pressure' },
}

// Conditions where carb amount and quality matter most for blood sugar.
const INSULIN_RELATED = ['pcos', 'insulin_resistance', 'type2_diabetes']

// International Evidence-based Guideline for PCOS (2023): a 500–750 kcal/day
// deficit for weight loss. The planned deficit is capped at the top of that range.
export const PCOS_MAX_DEFICIT = 750

export function cleanConditions(list, sex) {
  const arr = Array.isArray(list) ? list : []
  return [...new Set(arr)].filter((c) => CONDITIONS[c] && !(CONDITIONS[c].female && sex === 'male'))
}

export function hasCondition(profile, key) {
  return cleanConditions(profile?.conditions, profile?.sex).includes(key)
}

export function ageFromBirthYear(birthYear, now = new Date()) {
  if (!birthYear) return null
  return now.getFullYear() - Number(birthYear)
}

// Mifflin-St Jeor (1990). The best-validated simple BMR equation for adults.
export function bmr({ sex, weightKg, heightCm, age }) {
  if (!weightKg || !heightCm || !age) return null
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return sex === 'female' ? base - 161 : base + 5
}

export function tdeeFromProfile(profile, weightKg) {
  const b = bmr({
    sex: profile.sex,
    weightKg,
    heightCm: profile.height_cm,
    age: ageFromBirthYear(profile.birth_year),
  })
  if (b == null) return null
  const mult = ACTIVITY[profile.activity_level]?.mult ?? ACTIVITY.light.mult
  return b * mult
}

/**
 * Daily targets from the profile and the latest (trend) weight.
 * Returns calories and macros in grams plus any safety warnings applied.
 */
export function computeTargets(profile, currentWeightKg) {
  const weightKg = currentWeightKg || profile.start_weight_kg
  const warnings = []
  const bmrVal = bmr({
    sex: profile.sex,
    weightKg,
    heightCm: profile.height_cm,
    age: ageFromBirthYear(profile.birth_year),
  })
  const tdee = tdeeFromProfile(profile, weightKg)
  if (tdee == null) return null

  const goalKg = Number(profile.goal_weight_kg) || null
  const wantsToLose = goalKg != null && goalKg < weightKg
  let rate = wantsToLose ? Number(profile.weekly_rate_kg || 0.5) : 0
  const maxRate = weightKg * MAX_WEEKLY_LOSS_FRACTION
  if (rate > maxRate) {
    rate = maxRate
    warnings.push(`Weekly loss capped at ${maxRate.toFixed(2)} kg (1% of body weight).`)
  }

  const conditions = cleanConditions(profile.conditions, profile.sex)
  const pcos = conditions.includes('pcos')
  const carbConscious = conditions.some((c) => INSULIN_RELATED.includes(c))
  const notes = []

  let deficit = (rate * KCAL_PER_KG) / 7
  if (pcos && deficit > PCOS_MAX_DEFICIT) {
    deficit = PCOS_MAX_DEFICIT
    rate = (deficit * 7) / KCAL_PER_KG
    warnings.push(`PCOS: deficit capped at ${PCOS_MAX_DEFICIT} kcal a day (about ${rate.toFixed(2)} kg a week), the top of the PCOS guideline range.`)
  }
  let calories = tdee - deficit
  const floor = CALORIE_FLOOR[profile.sex] ?? CALORIE_FLOOR.female
  const overridden = !!profile.calorie_target_override
  if (overridden) {
    // A manual target replaces the formula, so the floor warning is about it alone.
    calories = Number(profile.calorie_target_override)
    if (calories < floor) warnings.push(`Your manual target is below ${floor} kcal. Check with a doctor first.`)
  } else if (calories < floor) {
    calories = floor
    warnings.push(`Target raised to the ${floor} kcal minimum. Loss will be slower than planned.`)
  }
  calories = Math.round(calories / 10) * 10

  // Protein: ~1.8 g per kg of goal weight (a proxy for lean mass when
  // overweight), capped at 40% of calories. Fat ~28% of calories. Carbs fill the rest.
  const refWeight = wantsToLose ? goalKg : weightKg
  let protein = profile.protein_target_override
    ? Number(profile.protein_target_override)
    : Math.min(1.8 * refWeight, (calories * 0.4) / 4)
  protein = Math.round(protein)
  let fat = Math.round((calories * 0.28) / 9)
  let carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4))

  // Carb-conscious split for PCOS, insulin resistance and type 2 diabetes:
  // carbs at most 40% of calories, the spare energy goes to fat (up to 35%).
  // Common practice, not proven better for weight loss: carb QUALITY (fibre,
  // low GI) matters more than the exact split.
  if (carbConscious) {
    const maxCarbs = Math.round((calories * 0.4) / 4)
    if (carbs > maxCarbs) {
      const maxFat = Math.round((calories * 0.35) / 9)
      fat = Math.min(maxFat, Math.max(fat, Math.round((calories - protein * 4 - maxCarbs * 4) / 9)))
      carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4))
    }
  }

  if (pcos) {
    notes.push('PCOS: losing just 5–10% of your weight can improve cycles, fertility and blood sugar. That is the first milestone.')
    notes.push('PCOS: no single diet is best. Aim for fibre and low-GI carbs, protein at every meal, and strength training twice a week.')
  }
  if (conditions.includes('type2_diabetes')) {
    warnings.push('Diabetes: if you take insulin or gliclazide-type tablets, check with your doctor before cutting calories or carbs (risk of lows).')
  }
  if (conditions.includes('hypertension')) {
    notes.push('Blood pressure: watch salt from saltfish, seasoning cubes, soup mixes and processed meat.')
  }

  return {
    bmr: Math.round(bmrVal),
    tdee: Math.round(tdee),
    calories,
    protein,
    carbs,
    fat,
    plannedWeeklyLossKg: Number(rate.toFixed(2)),
    plannedDeficit: Math.round(deficit),
    floor,
    deficit: Math.round(tdee - calories),
    overridden,
    warnings,
    notes,
    conditions,
    split: carbConscious ? 'carb-conscious' : 'standard',
  }
}

// ---------- Milestones ----------

// 5% and 10% of starting weight: the losses with proven health benefits
// (blood pressure, blood sugar; with PCOS, cycles and fertility too).
export function milestones(startKg, currentKg) {
  const start = Number(startKg)
  if (!start) return []
  const now = Number(currentKg) || start
  return [5, 10].map((pct) => {
    const target = start * (1 - pct / 100)
    const lost = Math.max(0, start - now)
    return { pct, targetKg: target, reached: now <= target, progress: Math.min(1, lost / (start - target)) }
  })
}

/**
 * Progress toward the main goal weight entered in the profile. Every "to goal"
 * figure in the app comes from here, so they always agree.
 * currentKg is the latest weigh-in (what the user sees as their weight).
 * Returns null without a goal below the start weight.
 */
export function goalProgress(startKg, goalKg, currentKg) {
  const start = Number(startKg)
  const goal = Number(goalKg)
  if (!start || !goal || goal >= start) return null
  const now = Number(currentKg) || start
  const totalKg = start - goal
  const lostKg = start - now // negative if above the start weight
  return {
    goalKg: goal,
    totalKg,
    lostKg,
    toGoalKg: Math.max(0, now - goal),
    fraction: Math.max(0, Math.min(1, lostKg / totalKg)),
    reached: now <= goal,
  }
}

// Realistic adult range, matching the database check (30–350 kg).
export const isValidWeightKg = (kg) => Number.isFinite(kg) && kg >= 30 && kg <= 350

// ---------- Food entries ----------

const r1 = (n) => Math.round(n * 10) / 10

export function entryTotals(e) {
  const s = Number(e.servings ?? 1)
  return {
    calories: Math.round(Number(e.calories || 0) * s),
    protein: r1(Number(e.protein_g || 0) * s),
    carbs: r1(Number(e.carbs_g || 0) * s),
    fat: r1(Number(e.fat_g || 0) * s),
  }
}

export function sumEntries(entries) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 }
  for (const e of entries) {
    const x = entryTotals(e)
    t.calories += x.calories
    t.protein += x.protein
    t.carbs += x.carbs
    t.fat += x.fat
  }
  return { calories: Math.round(t.calories), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) }
}

// Split whole percentages so they always add up to exactly 100 (largest remainder).
export function wholePercents(values) {
  const total = values.reduce((s, v) => s + Math.max(0, Number(v) || 0), 0)
  if (total <= 0) return values.map(() => 0)
  const raw = values.map((v) => (Math.max(0, Number(v) || 0) / total) * 100)
  const out = raw.map(Math.floor)
  let left = 100 - out.reduce((s, v) => s + v, 0)
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out
}

/**
 * Nutrition breakdown for a meal (or a whole day): totals, where the calories
 * come from (protein and carbs 4 kcal/g, fat 9 kcal/g), each macro's share,
 * how much of the daily targets it covers, and each food's share of the calories.
 */
export function macroBreakdown(entries = [], targets = null) {
  const totals = sumEntries(entries)
  const kcalFrom = { protein: totals.protein * 4, carbs: totals.carbs * 4, fat: totals.fat * 9 }
  const [protein, carbs, fat] = wholePercents([kcalFrom.protein, kcalFrom.carbs, kcalFrom.fat])
  const ofTarget = (v, t) => (t > 0 ? Math.round((v / t) * 100) : null)
  const items = entries
    .map((e) => ({ id: e.id, name: e.name, ...entryTotals(e) }))
    .sort((a, b) => b.calories - a.calories)
  const itemShares = wholePercents(items.map((i) => i.calories))
  return {
    totals,
    kcalFrom: { protein: Math.round(kcalFrom.protein), carbs: Math.round(kcalFrom.carbs), fat: Math.round(kcalFrom.fat) },
    split: { protein, carbs, fat },
    ofDay: {
      calories: ofTarget(totals.calories, targets?.calories),
      protein: ofTarget(totals.protein, targets?.protein),
      carbs: ofTarget(totals.carbs, targets?.carbs),
      fat: ofTarget(totals.fat, targets?.fat),
    },
    items: items.map((it, i) => ({ ...it, share: itemShares[i] })),
  }
}

// { 'YYYY-MM-DD': totals } for a list of entries
export function dailyTotals(entries) {
  const byDay = {}
  for (const e of entries) (byDay[e.log_date] ||= []).push(e)
  const out = {}
  for (const [d, list] of Object.entries(byDay)) out[d] = { ...sumEntries(list), count: list.length }
  return out
}

// ---------- Weight trend ----------

// Exponentially smoothed trend (Hacker's Diet style, 10% per day).
// Gaps are handled by compounding the smoothing over the missing days,
// so someone who weighs weekly still gets a sensible trend.
export const TREND_ALPHA = 0.1

export function trendSeries(weights) {
  const sorted = [...weights]
    .filter((w) => w && w.log_date && Number(w.weight_kg) > 0)
    .sort((a, b) => (a.log_date < b.log_date ? -1 : 1))
  const out = []
  let trend = null
  let prevDate = null
  for (const w of sorted) {
    const kg = Number(w.weight_kg)
    if (trend == null) trend = kg
    else {
      const gap = Math.max(1, daysBetween(prevDate, w.log_date))
      const a = 1 - Math.pow(1 - TREND_ALPHA, gap)
      trend = trend + a * (kg - trend)
    }
    prevDate = w.log_date
    out.push({ date: w.log_date, weight: kg, trend: Math.round(trend * 100) / 100, id: w.id, note: w.note || null })
  }
  return out
}

// The weight to show as "current": the most recent weigh-in itself, not the
// smoothed trend. The trend is for judging direction, rate and milestones.
export function latestWeight(series) {
  return series.length ? series[series.length - 1].weight : null
}

// Trend value on a given date: the last point on or before it.
export function trendOn(series, iso) {
  let v = null
  for (const p of series) {
    if (p.date <= iso) v = p
    else break
  }
  return v
}

// kg per week over the last `days` days of trend (negative = losing).
export function weeklyRate(series, days = 14) {
  if (series.length < 2) return null
  const last = series[series.length - 1]
  const start = trendOn(series, addDays(last.date, -days)) || series[0]
  const span = daysBetween(start.date, last.date)
  if (span < 5) return null
  return ((last.trend - start.trend) / span) * 7
}

export function projectGoalDate(series, goalKg, todayIso, rate = weeklyRate(series)) {
  const goal = Number(goalKg)
  if (!series.length || !goal) return null
  const current = series[series.length - 1].trend
  // Already there: no rate needed (it used to show no date once the loss levelled off).
  if (current <= goal) return todayIso
  if (rate == null || rate >= -0.02) return null
  const weeks = (current - goal) / -rate
  if (weeks > 260) return null
  return addDays(todayIso, Math.round(weeks * 7))
}

/**
 * Estimate real maintenance calories from what you ate and how your trend moved.
 * TDEE ≈ average intake − (trend change × 7700 / days).
 * Only meaningful when logging is honest and consistent.
 *
 * @param {object} p
 * @param {Record<string, {calories:number}>} p.daily  totals keyed by date
 * @param {Array} p.series  output of trendSeries
 * @param {string} p.endDate  last complete day (usually yesterday)
 * @param {number} [p.windowDays=21]
 */
export function adaptiveTdee({ daily, series, endDate, windowDays = 21 }) {
  const startDate = addDays(endDate, -(windowDays - 1))
  const logged = Object.entries(daily).filter(
    ([d, t]) => d >= startDate && d <= endDate && t.calories >= 500,
  )
  if (logged.length < 10) return null

  // Trend at the start of the window (a few days' slack either side). A weigh-in
  // from long before the window would compare intake and weight change over
  // different periods, so fall back to the first weigh-in inside the window.
  let startPt = trendOn(series, addDays(startDate, 4))
  if (!startPt || startPt.date < addDays(startDate, -7)) {
    startPt = series.find((p) => p.date >= startDate && p.date <= endDate) || null
  }
  const endPt = trendOn(series, endDate)
  if (!startPt || !endPt) return null
  const span = daysBetween(startPt.date, endPt.date)
  if (span < 10) return null

  const avgIntake = logged.reduce((s, [, t]) => s + t.calories, 0) / logged.length
  const tdee = avgIntake - ((endPt.trend - startPt.trend) * KCAL_PER_KG) / span
  const weighIns = series.filter((p) => p.date >= startDate && p.date <= endDate).length
  const confidence =
    logged.length >= 18 && weighIns >= 8 ? 'high' : logged.length >= 14 && weighIns >= 4 ? 'medium' : 'low'

  return {
    tdee: Math.round(tdee / 10) * 10,
    avgIntake: Math.round(avgIntake),
    trendChangeKg: Math.round((endPt.trend - startPt.trend) * 100) / 100,
    loggedDays: logged.length,
    weighIns,
    spanDays: span,
    confidence,
  }
}

/**
 * A calorie target built on measured maintenance: adaptive TDEE minus the
 * deficit for the chosen pace (not minus the gap to the current target,
 * which would shrink the target again every time it is applied).
 * Never below the safety floor. Returns null when there is nothing to suggest.
 */
export function adaptiveTarget(adaptive, targets) {
  if (!adaptive?.tdee || !targets) return null
  const raw = adaptive.tdee - Math.max(0, targets.plannedDeficit ?? 0)
  return Math.max(targets.floor ?? CALORIE_FLOOR.female, Math.round(raw / 10) * 10)
}

// ---------- Units ----------

export const kgToLb = (kg) => kg * 2.2046226218
export const lbToKg = (lb) => lb / 2.2046226218

export function cmToFtIn(cm) {
  const totalIn = cm / 2.54
  let ft = Math.floor(totalIn / 12)
  let inch = Math.round(totalIn - ft * 12)
  if (inch === 12) {
    ft += 1
    inch = 0
  }
  return { ft, in: inch }
}

export const ftInToCm = (ft, inch) => (Number(ft) * 12 + Number(inch || 0)) * 2.54

export function displayWeight(kg, units, digits = 1) {
  if (kg == null || Number.isNaN(kg)) return '—'
  return units === 'imperial' ? `${kgToLb(kg).toFixed(digits)} lb` : `${Number(kg).toFixed(digits)} kg`
}

export function weightValue(kg, units) {
  return units === 'imperial' ? kgToLb(kg) : kg
}

export function weightUnit(units) {
  return units === 'imperial' ? 'lb' : 'kg'
}

export function inputToKg(value, units) {
  const n = Number(String(value ?? '').trim().replace(',', '.'))
  if (!n) return null
  return units === 'imperial' ? lbToKg(n) : n
}

// ---------- Exercise ----------
//
// All burn figures are NET calories: energy above what you'd burn resting
// anyway. Your maintenance estimate already counts resting burn, so gross
// numbers (what treadmills usually show) would double count.

export const kmhToMph = (kmh) => kmh / 1.609344
export const mphToKmh = (mph) => mph * 1.609344

// Treadmill: ACSM metabolic equations (walking and running, with grade).
// VO2 in ml/kg/min; ~5 kcal per litre of oxygen.
export function treadmillKcal({ weightKg, minutes, speedKmh, inclinePct = 0, mode }) {
  if (!weightKg || !minutes || !speedKmh) return 0
  const m = (speedKmh * 1000) / 60 // metres per minute
  const g = Math.max(0, Number(inclinePct) || 0) / 100 // declines treated as flat
  const run = mode ? mode === 'run' : speedKmh >= 8
  const vo2 = run ? 0.2 * m + 0.9 * m * g + 3.5 : 0.1 * m + 1.8 * m * g + 3.5
  return Math.round((((vo2 - 3.5) * weightKg) / 1000) * 5 * minutes)
}

// Home workouts: approximate MET values from the Compendium of Physical Activities.
export const HOME_ACTIVITIES = {
  bodyweight: { label: 'Bodyweight circuit', hint: 'Push-ups, squats, lunges, planks', met: { light: 2.8, moderate: 3.8, hard: 8.0 } },
  weights: { label: 'Dumbbells / weights', hint: 'Sets of 8–15 reps', met: { light: 3.5, moderate: 5.0, hard: 6.0 } },
  hiit: { label: 'HIIT / cardio circuit', hint: 'Burpees, jumping jacks, mountain climbers', met: { light: 4.3, moderate: 6.0, hard: 8.0 } },
  skipping: { label: 'Skipping rope', hint: 'Jump rope', met: { light: 8.8, moderate: 11.8, hard: 12.3 } },
  mobility: { label: 'Yoga / stretching', hint: 'Mobility, stretching, yoga', met: { light: 2.3, moderate: 2.5, hard: 4.0 } },
}

export function homeWorkoutKcal({ weightKg, minutes, activity, intensity = 'moderate' }) {
  if (!weightKg || !minutes) return 0
  const met = HOME_ACTIVITIES[activity]?.met[intensity] ?? 4
  return Math.round(((met - 1) * weightKg * minutes) / 60)
}

export function estimateWorkoutKcal(w, weightKg) {
  return w.kind === 'treadmill'
    ? treadmillKcal({ weightKg, minutes: w.duration_min, speedKmh: w.speed_kmh, inclinePct: w.incline_pct, mode: w.mode })
    : homeWorkoutKcal({ weightKg, minutes: w.duration_min, activity: w.activity, intensity: w.intensity })
}

// How much of today's exercise to add to the food target (0, 25, 50 or 100 %).
export function exerciseAllowance(burned, eatbackPct = 0) {
  return Math.round((Number(burned) || 0) * (Number(eatbackPct) || 0) / 100)
}

const STRENGTH = new Set(['bodyweight', 'weights', 'hiit'])

export function workoutSummary(workouts) {
  const s = { sessions: 0, minutes: 0, kcal: 0, strength: 0, treadmill: 0, treadmillKm: 0 }
  for (const w of workouts) {
    s.sessions += 1
    s.minutes += Number(w.duration_min) || 0
    s.kcal += Number(w.calories_burned) || 0
    if (w.kind === 'treadmill') {
      s.treadmill += 1
      s.treadmillKm += Number(w.distance_km) || ((Number(w.speed_kmh) || 0) * (Number(w.duration_min) || 0)) / 60
    } else if (STRENGTH.has(w.activity)) s.strength += 1
  }
  s.minutes = Math.round(s.minutes)
  s.treadmillKm = Math.round(s.treadmillKm * 10) / 10
  return s
}

// ---------- Trend buckets (Progress charts) ----------

/** Monday of the week containing iso (weeks start on Monday, as in Jamaica and the UK). */
export function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7 // 0 = Monday
  return addDays(iso, -dow)
}

/**
 * Group dated values into day, week or month buckets ending at endIso and
 * average each one. points: [{ date: 'YYYY-MM-DD', value }]. Returns the last
 * `count` buckets oldest first: [{ key, start, end, value, n }], value null
 * when the bucket has no points (so charts can leave a gap).
 * agg 'last' takes each bucket's latest value instead of the average (a dose
 * level shouldn't average 2.5 and 5 into 3.2).
 */
export function bucketAverages(points, granularity, endIso, count, agg = 'avg') {
  const keyOf =
    granularity === 'month' ? (iso) => `${iso.slice(0, 7)}-01` : granularity === 'week' ? weekStart : (iso) => iso
  const buckets = []
  let start = keyOf(endIso)
  for (let i = 0; i < count; i++) {
    let end
    if (granularity === 'month') {
      const [y, m] = start.split('-').map(Number)
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
      end = addDays(next, -1)
    } else end = granularity === 'week' ? addDays(start, 6) : start
    buckets.unshift({ key: start, start, end, sum: 0, n: 0, lastDate: '', last: null })
    if (granularity === 'month') {
      const [y, m] = start.split('-').map(Number)
      start = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
    } else start = addDays(start, granularity === 'week' ? -7 : -1)
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]))
  for (const p of points) {
    const v = Number(p?.value)
    if (!p?.date || p.date > endIso || !Number.isFinite(v)) continue
    const b = byKey.get(keyOf(p.date))
    if (b) {
      b.sum += v
      b.n += 1
      if (p.date >= b.lastDate) {
        b.lastDate = p.date
        b.last = v
      }
    }
  }
  return buckets.map(({ key, start: s, end, sum, n, last }) => ({ key, start: s, end, n, value: n ? (agg === 'last' ? last : sum / n) : null }))
}

/** Average, min and max of the non-null bucket values, plus the change first → last. */
export function bucketStats(buckets) {
  const vals = buckets.map((b) => b.value).filter((v) => v != null)
  if (!vals.length) return null
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length
  return { avg, min: Math.min(...vals), max: Math.max(...vals), first: vals[0], last: vals[vals.length - 1], change: vals[vals.length - 1] - vals[0], count: vals.length }
}
