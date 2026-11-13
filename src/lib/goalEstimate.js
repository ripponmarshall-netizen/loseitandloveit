// Mimi's goal-date estimate: the AI (Haiku, on the server) reads the weigh-ins
// and the plan and says when the goal is realistically reachable, with a
// range. A straight-line projection from a few early weigh-ins is badly
// optimistic (the first weeks are mostly water), which is what this replaces.
//
// Pure: building the request, deciding when to ask again, and checking the
// answer. The request itself is in ai.js; the screen is Progress.jsx.

import { addDays, daysBetween } from './dates.js'
import { ageFromBirthYear, cleanConditions, weightUnit, weightValue } from './calc.js'

const r1 = (n) => Math.round(n * 10) / 10
const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * What the AI needs, in the user's own units. `series` is trendSeries output
 * (one point per day: the day's first weigh-in and the smoothed trend).
 */
export function buildGoalContext({ profile, series, targets, today, formulaEta = null, weeklyRateKg = null, glp1 = null }) {
  const units = profile.units || 'imperial'
  const w = (kg) => r1(weightValue(Number(kg), units))
  const pts = series.slice(-120)
  return {
    today,
    units: weightUnit(units),
    sex: profile.sex,
    age: ageFromBirthYear(profile.birth_year) || null,
    height_cm: Number(profile.height_cm) || null,
    start_weight: w(profile.start_weight_kg),
    goal_weight: w(profile.goal_weight_kg),
    chosen_pace_per_week: w(profile.weekly_rate_kg),
    daily_calorie_target: targets?.calories ?? null,
    conditions: cleanConditions(profile.conditions, profile.sex),
    glp1,
    weigh_ins: pts.map((p) => ({ date: p.date, weight: w(p.weight), trend: w(p.trend) })),
    days_of_data: pts.length ? daysBetween(pts[0].date, pts[pts.length - 1].date) + 1 : 0,
    trend_rate_per_week: weeklyRateKg == null ? null : r1(weightValue(weeklyRateKg, units)),
    straight_line_eta: formulaEta,
  }
}

/** Changes whenever the answer could: a new or edited weigh-in, or a new goal, pace or start. */
export function goalFingerprint({ profile, series }) {
  const last = series[series.length - 1]
  return [
    profile.goal_weight_kg, profile.start_weight_kg, profile.weekly_rate_kg, profile.units,
    series.length, last?.date, last?.weight,
  ].join('|')
}

const RETRY_AFTER_FAIL_MS = 60 * 60e3
const MAX_AGE_MS = 7 * 86400e3

/** Ask the AI now? Only with enough data, and when the cached answer no longer fits. */
export function goalEstimateDue({ cached, fingerprint, series, goalReached, now = Date.now() }) {
  if (goalReached || series.length < 2) return false
  if (cached?.failedAt && now - cached.failedAt < RETRY_AFTER_FAIL_MS) return false
  if (!cached?.result) return true
  return cached.fingerprint !== fingerprint || now - (cached.at || 0) > MAX_AGE_MS
}

const CONFIDENCE = new Set(['low', 'medium', 'high'])

/** Check the model's answer: real dates, in order, not in the past, not absurdly far. */
export function cleanGoalEstimate(raw, today) {
  if (!raw || typeof raw !== 'object') return null
  const latest = addDays(today, 365 * 10)
  const date = (v) => (typeof v === 'string' && ISO.test(v) && v >= today && v <= latest ? v : null)
  const eta = date(raw.eta)
  if (!eta) return null
  let early = date(raw.earliest) || eta
  let late = date(raw.latest) || eta
  if (early > eta) early = eta
  if (late < eta) late = eta
  const rate = Number(raw.realistic_rate_per_week)
  return {
    eta,
    earliest: early,
    latest: late,
    ratePerWeek: Number.isFinite(rate) && rate > 0 && rate < 20 ? r1(rate) : null,
    confidence: CONFIDENCE.has(raw.confidence) ? raw.confidence : 'low',
    summary: String(raw.summary || '').trim().slice(0, 400),
  }
}
