// Profile <-> form conversion and validation. Pure, so it is unit-tested.
import { cleanConditions, cmToFtIn, ftInToCm, kgToLb, lbToKg } from './calc.js'

export const PACES = {
  metric: [0.25, 0.5, 0.75, 1].map((kg) => [kg, `${kg} kg a week`]),
  imperial: [0.5, 1, 1.5, 2].map((lb) => [Math.round(lbToKg(lb) * 100) / 100, `${lb} lb a week`]),
}

const r1 = (n) => Math.round(n * 10) / 10

// Snap a stored kg/week pace to the closest option for the chosen units.
export const snapPace = (kg, units) =>
  PACES[units].reduce((best, [v]) => (Math.abs(v - kg) < Math.abs(best - kg) ? v : best), PACES[units][1][0])

export function toForm(p = {}) {
  const units = p.units || 'imperial'
  const ftin = p.height_cm ? cmToFtIn(Number(p.height_cm)) : { ft: '', in: '' }
  const w = (kg) => (kg ? String(r1(units === 'imperial' ? kgToLb(Number(kg)) : Number(kg))) : '')
  return {
    display_name: p.display_name || '',
    sex: p.sex || 'male',
    birth_year: p.birth_year ? String(p.birth_year) : '',
    units,
    height_cm: p.height_cm ? String(p.height_cm) : '',
    ft: String(ftin.ft),
    inch: String(ftin.in),
    start_weight: w(p.start_weight_kg),
    goal_weight: w(p.goal_weight_kg),
    activity_level: p.activity_level || 'light',
    weekly_rate_kg: p.weekly_rate_kg != null ? snapPace(Number(p.weekly_rate_kg), units) : PACES[units][1][0],
    day_start_hour: p.day_start_hour ?? 4,
    coach_notes: p.coach_notes || '',
    calorie_target_override: p.calorie_target_override ? String(p.calorie_target_override) : '',
    protein_target_override: p.protein_target_override ? String(p.protein_target_override) : '',
    exercise_eatback_pct: String(p.exercise_eatback_pct ?? 0),
    conditions: Array.isArray(p.conditions) ? p.conditions : [],
  }
}

export function fromForm(f) {
  const toKg = (v) => (v ? r1(f.units === 'imperial' ? lbToKg(Number(v)) : Number(v)) : null)
  const height =
    f.units === 'imperial' ? (f.ft ? r1(ftInToCm(f.ft, f.inch || 0)) : null) : f.height_cm ? Number(f.height_cm) : null
  return {
    display_name: f.display_name.trim() || null,
    sex: f.sex,
    birth_year: f.birth_year ? Number(f.birth_year) : null,
    units: f.units,
    height_cm: height,
    start_weight_kg: toKg(f.start_weight),
    goal_weight_kg: toKg(f.goal_weight),
    activity_level: f.activity_level,
    weekly_rate_kg: Number(f.weekly_rate_kg),
    day_start_hour: Number(f.day_start_hour),
    coach_notes: f.coach_notes.trim() || null,
    calorie_target_override: f.calorie_target_override ? Number(f.calorie_target_override) : null,
    protein_target_override: f.protein_target_override ? Number(f.protein_target_override) : null,
    exercise_eatback_pct: Number(f.exercise_eatback_pct) || 0,
    conditions: cleanConditions(f.conditions, f.sex),
  }
}

// Re-express the form in other units without losing what was typed.
export const convertUnits = (f, units) => (units === f.units ? f : toForm({ ...fromForm(f), units }))

/**
 * Friendly checks that mirror the database constraints, so people see a clear
 * message instead of a Postgres error. `groups` limits which fields are checked
 * (onboarding validates one step at a time). Returns an error string or null.
 */
export function validateProfile(v, groups = ['about', 'body', 'goal', 'targets'], thisYear = new Date().getFullYear()) {
  const has = (g) => groups.includes(g)
  if (has('about')) {
    if (!v.birth_year) return 'Enter your birth year.'
    if (!Number.isInteger(v.birth_year) || v.birth_year < 1900 || v.birth_year > thisYear) return 'Check your birth year.'
    if (v.birth_year > thisYear - 18) return 'This app is for adults (18+). Please talk to a doctor about weight goals for teens.'
  }
  if (has('body')) {
    if (!v.height_cm) return 'Enter your height.'
    if (v.height_cm < 100 || v.height_cm > 250) return 'Height should be between 100 and 250 cm (3′3″ to 8′2″).'
    if (!v.start_weight_kg) return 'Enter your current weight.'
    if (v.start_weight_kg < 30 || v.start_weight_kg > 350) return 'Weight should be between 30 and 350 kg (66 to 770 lb).'
  }
  if (has('goal')) {
    if (!v.goal_weight_kg) return 'Enter a goal weight.'
    if (v.goal_weight_kg < 30 || v.goal_weight_kg > 350) return 'Goal weight should be between 30 and 350 kg (66 to 770 lb).'
  }
  if (has('targets')) {
    const c = v.calorie_target_override
    if (c != null && (c < 800 || c > 6000)) return 'A manual calorie target must be between 800 and 6000 kcal.'
    const p = v.protein_target_override
    if (p != null && (p < 20 || p > 400)) return 'A manual protein target must be between 20 and 400 g.'
  }
  return null
}
