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

  const wantsToLose = profile.goal_weight_kg && profile.goal_weight_kg < weightKg
  let rate = wantsToLose ? Number(profile.weekly_rate_kg || 0.5) : 0
  const maxRate = weightKg * MAX_WEEKLY_LOSS_FRACTION
  if (rate > maxRate) {
    rate = maxRate
    warnings.push(`Weekly loss capped at ${maxRate.toFixed(2)} kg (1% of body weight).`)
  }

  const deficit = (rate * KCAL_PER_KG) / 7
  let calories = tdee - deficit
  const floor = CALORIE_FLOOR[profile.sex] ?? CALORIE_FLOOR.female
  if (calories < floor) {
    calories = floor
    warnings.push(`Target raised to the ${floor} kcal minimum. Loss will be slower than planned.`)
  }

  let overridden = false
  if (profile.calorie_target_override) {
    calories = Number(profile.calorie_target_override)
    overridden = true
    if (calories < floor) warnings.push(`Your manual target is below ${floor} kcal. Check with a doctor first.`)
  }
  calories = Math.round(calories / 10) * 10

  // Protein: ~1.8 g per kg of goal weight (a proxy for lean mass when
  // overweight), capped at 40% of calories. Fat ~28% of calories. Carbs fill the rest.
  const refWeight = wantsToLose ? profile.goal_weight_kg : weightKg
  let protein = profile.protein_target_override
    ? Number(profile.protein_target_override)
    : Math.min(1.8 * refWeight, (calories * 0.4) / 4)
  protein = Math.round(protein)
  const fat = Math.round((calories * 0.28) / 9)
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4))

  return {
    bmr: Math.round(bmrVal),
    tdee: Math.round(tdee),
    calories,
    protein,
    carbs,
    fat,
    plannedWeeklyLossKg: Number(rate.toFixed(2)),
    deficit: Math.round(tdee - calories),
    // Deficit implied by the chosen pace alone, ignoring overrides and the floor.
    plannedDeficit: Math.round(deficit),
    floor,
    overridden,
    warnings,
  }
}

/**
 * Calorie target based on measured (adaptive) maintenance: measured TDEE
 * minus the deficit for the chosen pace, never below the safety floor.
 * Uses the pace, not the current target, so adopting it twice gives the
 * same number instead of compounding the deficit.
 */
export function adaptiveTarget(adaptiveTdeeKcal, targets) {
  if (!adaptiveTdeeKcal || !targets) return null
  const raw = adaptiveTdeeKcal - Math.max(0, targets.plannedDeficit || 0)
  return Math.round(Math.max(targets.floor || 0, raw) / 10) * 10
}

/**
 * Check profile values (kg/cm) before saving. Returns an error message or null.
 * Ranges match the database check constraints.
 */
export function validateProfile(v, now = new Date()) {
  const year = now.getFullYear()
  if (!v.height_cm || !v.birth_year || !v.start_weight_kg || !v.goal_weight_kg) {
    return 'Fill in height, birth year, current weight and goal weight.'
  }
  if (v.birth_year < 1900 || v.birth_year > year) return 'Enter a four-digit birth year, e.g. 1990.'
  if (v.birth_year > year - 18) return 'This app is for adults (18+). Please talk to a doctor about weight goals for teens.'
  if (v.height_cm < 100 || v.height_cm > 250) return 'Height looks off. Check the number and the units.'
  if (v.start_weight_kg < 30 || v.start_weight_kg > 350) return 'Current weight looks off. Check the number and the units.'
  if (v.goal_weight_kg < 30 || v.goal_weight_kg > 350) return 'Goal weight looks off. Check the number and the units.'
  if (v.calorie_target_override != null && (v.calorie_target_override < 800 || v.calorie_target_override > 6000)) {
    return 'Calorie override must be between 800 and 6000, or blank for auto.'
  }
  if (v.protein_target_override != null && (v.protein_target_override < 20 || v.protein_target_override > 400)) {
    return 'Protein override must be between 20 and 400 g, or blank for auto.'
  }
  return null
}

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
    out.push({ date: w.log_date, weight: kg, trend: Math.round(trend * 100) / 100, id: w.id })
  }
  return out
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
  if (!series.length || !goalKg || rate == null || rate >= -0.02) return null
  const current = series[series.length - 1].trend
  if (current <= goalKg) return todayIso
  const weeks = (current - goalKg) / -rate
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

  const startPt = trendOn(series, addDays(startDate, 4)) // allow a few days' slack
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
  const n = Number(value)
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
