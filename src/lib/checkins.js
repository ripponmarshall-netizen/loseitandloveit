// Mimi's check-ins: when to ask the AI for a fresh recommendation, and the
// small data snapshot it reads. Pure and unit-tested; the screen does the I/O.
//
// Cost control, in order of effect:
//   1. Only when the app is open (no background jobs).
//   2. At most every `everyHours` (default 3), and only if something changed
//      since the last one, or it has been twice that long (a gentle reminder).
//   3. At most MAX_PER_DAY a day, and an hour's pause after a failure.
//   4. A compact snapshot (well under 1k tokens) and a low-effort, small reply.

import { sumEntries } from './calc.js'
import { MEALS } from './meals.js'

export const CHECKIN_EVERY_DEFAULT = 3
export const MAX_PER_DAY = 6
const HOUR = 3600e3

/** A short summary of what's logged today; a new check-in is only worth it when this changes. */
export function checkinFingerprint({ entries = [], waterMl = 0, mood = null, workouts = [], weighed = false, dosesToday = 0 } = {}) {
  const kcal = sumEntries(entries).calories
  return `e${entries.length}:${kcal}|w${Math.round(waterMl / 250)}|m${mood || 0}|x${workouts.length}|wt${weighed ? 1 : 0}|d${dosesToday}`
}

/**
 * Is a new check-in due?
 * last: the latest check-in { log_date, created_at, fingerprint } or null.
 */
export function checkinDue({ now = Date.now(), today, last, fingerprint, everyHours = CHECKIN_EVERY_DEFAULT, todayCount = 0, failedAt = null }) {
  if (!everyHours || everyHours <= 0) return false
  if (failedAt && now - failedAt < HOUR) return false
  if (todayCount >= MAX_PER_DAY) return false
  if (!last) return true
  if (last.log_date !== today) return true
  const hours = (now - Date.parse(last.created_at)) / HOUR
  if (!(hours >= everyHours)) return false
  return last.fingerprint !== fingerprint || hours >= everyHours * 2
}

const r = (n) => Math.round(Number(n) || 0)

/**
 * The snapshot Mimi reads. Everything is optional except today and the day's entries.
 * recentDaily: { 'YYYY-MM-DD': { calories, protein } } for the last few days.
 */
export function buildCheckinContext({
  now = new Date(),
  today,
  profile = {},
  targets = null,
  entries = [],
  waterMl = 0,
  waterTarget = null,
  daily = null,
  workouts = [],
  weighedToday = false,
  recentDaily = {},
  trendKg = null,
  weeklyChangeKg = null,
  glp1 = null,
  previous = null,
}) {
  const t = sumEntries(entries)
  const byMeal = {}
  for (const m of MEALS) {
    const list = entries.filter((e) => e.meal === m)
    if (list.length) byMeal[m] = sumEntries(list).calories
  }
  const days = Object.keys(recentDaily).filter((d) => d < today).sort().slice(-3)
  return {
    local_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    today,
    name: profile.display_name || undefined,
    sex: profile.sex || undefined,
    preferred_units: profile.units === 'metric' ? 'kg' : 'lb',
    targets: targets ? { kcal: targets.calories, protein_g: targets.protein, carbs_g: targets.carbs, fat_g: targets.fat } : undefined,
    so_far_today: {
      kcal: t.calories,
      protein_g: r(t.protein),
      carbs_g: r(t.carbs),
      fat_g: r(t.fat),
      kcal_by_meal: byMeal,
      meals_not_logged: MEALS.filter((m) => !(m in byMeal)),
      foods: entries.slice(-8).map((e) => e.name),
      water_ml: r(waterMl),
      water_target_ml: waterTarget || undefined,
      workouts: workouts.map((w) => `${w.name} ${r(w.duration_min)} min`),
      weighed_in: weighedToday,
      mood_1to5: daily?.mood || undefined,
      energy_1to5: daily?.energy || undefined,
      symptoms: daily?.symptoms?.length ? daily.symptoms : undefined,
    },
    previous_days: days.map((d) => ({ date: d, kcal: r(recentDaily[d]?.calories), protein_g: r(recentDaily[d]?.protein) })),
    weight: trendKg ? { trend_kg: Math.round(trendKg * 10) / 10, weekly_change_kg: weeklyChangeKg, goal_kg: Number(profile.goal_weight_kg) || undefined } : undefined,
    glp1: glp1 || undefined,
    coach_notes: profile.coach_notes ? String(profile.coach_notes).slice(0, 300) : undefined,
    previous_checkin: previous ? { headline: previous.headline, tips: (previous.tips || []).map((x) => x.text) } : undefined,
  }
}
