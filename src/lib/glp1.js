// Pure GLP-1 and daily check-in helpers: dose schedule, site rotation,
// water target and gentle intake nudges. No React, no storage: unit-tested.
import { MED_BY_ID, ROTATION_ORDER } from '../data/glp1.js'
import { addDays, daysBetween } from './dates.js'
import { CALORIE_FLOOR } from './calc.js'

export const GLASS_ML = 250
export const BOTTLE_ML = 500

/** The user's GLP-1 plan from the profile, or null if they aren't on one. */
export function glp1Plan(profile) {
  if (!profile?.glp1_med) return null
  const med = MED_BY_ID[profile.glp1_med] || MED_BY_ID.other
  return {
    id: med.id,
    med,
    name: (profile.glp1_med === 'other' && profile.glp1_name) || med.label,
    dose: profile.glp1_dose != null ? Number(profile.glp1_dose) : null,
    unit: profile.glp1_unit || med.unit,
    frequency: profile.glp1_frequency || med.frequency,
    route: med.route,
    startedOn: profile.glp1_started_on || null,
  }
}

export const formatDose = (dose, unit = 'mg') => (dose == null || dose === '' ? '' : `${Number(dose)} ${unit}`)

/** Where this dose sits on the usual escalation ladder, e.g. { step: 2, of: 6 }. */
export function doseStep(medId, dose) {
  const doses = MED_BY_ID[medId]?.doses || []
  const i = doses.findIndex((d) => Math.abs(d - Number(dose)) < 1e-6)
  return i >= 0 ? { step: i + 1, of: doses.length, isTop: i === doses.length - 1 } : null
}

/**
 * When the next dose is due.
 * doses: any order, each { log_date }. startedOn: the plan's start date.
 * With no doses logged, the start date counts as the first dose (people set
 * the plan after their first jab, and the app shouldn't nag for it forever).
 * Returns
 *   { state: 'none' | 'taken' | 'due' | 'overdue' | 'upcoming', nextDate, daysUntil, takenToday, perDay, assumed }
 */
export function doseStatus({ doses = [], frequency = 'weekly', today, startedOn = null }) {
  let sorted = [...doses].filter((d) => d?.log_date).sort((a, b) => (a.log_date < b.log_date ? 1 : -1))
  const perDay = frequency === 'twice_daily' ? 2 : 1
  let assumed = false
  if (!sorted.length && startedOn && startedOn <= today) {
    if (frequency !== 'weekly') return { state: 'due', nextDate: today, daysUntil: 0, takenToday: 0, perDay, assumed: true }
    sorted = [{ log_date: startedOn }]
    assumed = true
  }
  const takenToday = sorted.filter((d) => d.log_date === today).length
  if (!sorted.length) return { state: 'none', nextDate: today, daysUntil: 0, takenToday: 0, perDay, assumed }

  if (frequency === 'weekly') {
    const last = sorted.find((d) => d.log_date <= today) || sorted[sorted.length - 1]
    const nextDate = addDays(last.log_date, 7)
    const daysUntil = daysBetween(today, nextDate)
    if (last.log_date === today) return { state: 'taken', nextDate, daysUntil, takenToday, perDay, assumed }
    const state = daysUntil > 0 ? 'upcoming' : daysUntil === 0 ? 'due' : 'overdue'
    return { state, nextDate, daysUntil, takenToday, perDay, assumed }
  }
  // Daily and twice daily: due until today's doses are all logged.
  if (takenToday >= perDay) return { state: 'taken', nextDate: addDays(today, 1), daysUntil: 1, takenToday, perDay, assumed }
  return { state: 'due', nextDate: today, daysUntil: 0, takenToday, perDay, assumed }
}

/** doseStatus for a plan from glp1Plan(): uses the plan's frequency and start date. */
export function planDoseStatus(plan, doses, today) {
  if (!plan) return null
  return doseStatus({ doses: doses || [], frequency: plan.frequency, today, startedOn: plan.startedOn })
}

/** Short label for the status, e.g. "Due today", "In 3 days", "2 days late". */
export function doseStatusLabel(s) {
  if (!s) return ''
  switch (s.state) {
    case 'none': return 'Log first dose'
    case 'taken': return 'Taken today'
    case 'due': return s.perDay > 1 && s.takenToday ? `Dose ${s.takenToday + 1} of ${s.perDay}` : 'Due today'
    case 'overdue': return `${-s.daysUntil} day${s.daysUntil === -1 ? '' : 's'} late`
    case 'upcoming': return s.daysUntil === 1 ? 'Tomorrow' : `In ${s.daysUntil} days`
    default: return ''
  }
}

/**
 * Suggest the next injection site: never the last one used, otherwise the
 * site that has gone longest without a dose (unused sites first).
 * doses: any order, each { site, log_date, taken_at? }.
 */
export function suggestSite(doses = [], order = ROTATION_ORDER) {
  const used = doses
    .filter((d) => d?.site)
    .sort((a, b) => ((a.taken_at || a.log_date) < (b.taken_at || b.log_date) ? 1 : -1))
  if (!used.length) return order[0]
  const lastUse = new Map()
  for (const d of used) if (!lastUse.has(d.site)) lastUse.set(d.site, d.taken_at || d.log_date)
  const lastSite = used[0].site
  let best = null
  for (const site of order) {
    if (site === lastSite) continue
    const at = lastUse.get(site) ?? ''
    if (best == null || at < best.at) best = { site, at }
  }
  return best?.site ?? order[0]
}

// ---------- Water ----------

/**
 * Daily water goal: ~30 ml per kg of body weight, 2–3.5 L, in 250 ml steps.
 * A rule of thumb: drink more in the heat, on shift and with vomiting or diarrhoea.
 */
export function waterTargetMl(weightKg, override) {
  if (Number(override) > 0) return Math.round(Number(override))
  if (!weightKg) return 2500
  const ml = Math.min(3500, Math.max(2000, weightKg * 30))
  return Math.round(ml / 250) * 250
}

export function formatWater(ml) {
  const n = Number(ml) || 0
  return n >= 1000 ? `${(Math.round(n / 100) / 10).toFixed(1)} L` : `${Math.round(n)} ml`
}

/** Share of the day's water you'd expect by now (07:00 → 0, 21:00 → 1). */
export function waterPaceFraction(hour) {
  return Math.min(1, Math.max(0, (hour - 7) / 14))
}

// ---------- Daily nudge ----------

/**
 * One gentle, evidence-based nudge for the Today screen, or null.
 * The main risks on a GLP-1 are eating and drinking too little, and too little protein.
 */
export function dailyNudge({ onGlp1, hour, eatenKcal, proteinG, targets, sex, waterMl, waterTarget, symptoms = [] }) {
  if (symptoms.some((s) => s === 'severe_pain' || s === 'cant_keep_fluids')) {
    return {
      tone: 'urgent',
      text: 'Severe stomach pain that won’t settle, or not keeping fluids down, needs a doctor today. In an emergency call 110.',
    }
  }
  if (symptoms.includes('vomiting') || symptoms.includes('diarrhoea')) {
    return { tone: 'care', text: 'Sip water or an oral rehydration drink often today. If it lasts more than a day or you feel faint, call your doctor.' }
  }
  if (!onGlp1 || !targets) return null
  const floor = CALORIE_FLOOR[sex] ?? CALORIE_FLOOR.female
  if (hour >= 17 && eatenKcal < floor * 0.7) {
    return {
      tone: 'tip',
      text: `You’re at ${Math.round(eatenKcal)} kcal. On a GLP-1 it’s easy to under-eat: aim for at least ${floor}, protein first (eggs, fish, chicken, Greek yoghurt, a shake).`,
    }
  }
  if (hour >= 15 && targets.protein && proteinG < targets.protein * 0.4) {
    return { tone: 'tip', text: `Protein is ${Math.round(proteinG)} of ${targets.protein} g. Eat the protein part of each meal first to protect muscle.` }
  }
  if (hour >= 14 && waterTarget && waterMl < waterTarget * waterPaceFraction(hour) * 0.5) {
    return { tone: 'tip', text: 'Water is behind. GLP-1 medicines can dull thirst, so sip a glass now.' }
  }
  return null
}

// ---------- Summaries for Progress and the coach ----------

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/** Averages and symptom counts from daily logs. */
export function summariseDailyLogs(logs = []) {
  const moods = logs.map((l) => Number(l.mood)).filter((n) => n >= 1)
  const energy = logs.map((l) => Number(l.energy)).filter((n) => n >= 1)
  const appetite = logs.map((l) => Number(l.appetite)).filter((n) => n >= 1)
  const water = logs.map((l) => Number(l.water_ml)).filter((n) => n > 0)
  const counts = {}
  for (const l of logs) for (const s of l.symptoms || []) counts[s] = (counts[s] || 0) + 1
  const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10)
  return {
    days: logs.length,
    mood: r1(avg(moods)),
    energy: r1(avg(energy)),
    appetite: r1(avg(appetite)),
    waterMl: water.length ? Math.round(avg(water)) : null,
    symptoms: Object.entries(counts).sort((a, b) => b[1] - a[1]),
  }
}

// ---------- Dose trend (Progress chart) ----------

/**
 * The dose you're on each day from `from` to `to`, for a trend line: each
 * dose holds until the next one, and stops after a long gap (a missed run of
 * doses shouldn't look like you were still on it). With no doses logged, the
 * plan's start date and dose stand in as dose one, as in doseStatus.
 * Returns { levels: [{ date, value }], taken: [{ date, value }] } where
 * `taken` is the days a dose was actually logged.
 */
export function doseLevels({ doses = [], from, to, frequency = 'weekly', plan = null }) {
  let rows = doses.filter((d) => d?.log_date && Number(d.dose) > 0)
  if (!rows.length && plan?.startedOn && plan.dose && plan.startedOn <= to) {
    rows = [{ log_date: plan.startedOn, dose: plan.dose, unit: plan.unit }]
  }
  if (!rows.length) return { levels: [], taken: [] }
  // Keep to one unit (mg or mcg): the one the newest dose uses.
  rows = [...rows].sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0))
  const unit = rows[rows.length - 1].unit
  if (unit) rows = rows.filter((d) => !d.unit || d.unit === unit)

  // Highest dose on each logged day.
  const byDay = new Map()
  for (const d of rows) byDay.set(d.log_date, Math.max(byDay.get(d.log_date) || 0, Number(d.dose)))
  const days = [...byDay.keys()]
  const maxGap = frequency === 'weekly' ? 13 : 3

  const levels = []
  let i = -1
  for (let day = from; day <= to; day = addDays(day, 1)) {
    while (i + 1 < days.length && days[i + 1] <= day) i++
    if (i < 0) continue
    if (daysBetween(days[i], day) > maxGap) continue
    levels.push({ date: day, value: byDay.get(days[i]) })
  }
  const taken = days.filter((d) => d >= from && d <= to).map((d) => ({ date: d, value: byDay.get(d) }))
  return { levels, taken }
}
