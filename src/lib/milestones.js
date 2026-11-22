// Mini milestones between the starting weight and the goal, and badges.
// Pure functions: unit-tested in tests/milestones.test.js.
//
// Milestones are judged on the smoothed TREND, not single weigh-ins, so a
// salty dinner can't take one away and one light morning can't award one.

import { lbToKg, loggingStreak } from './calc.js'
import { daysBetween } from './dates.js'

// One mini milestone every 5 lb, or every 2 kg.
export const STEP_KG = { imperial: lbToKg(5), metric: 2 }

const EPS = 1e-6

// First date the trend reached `targetKg` or lower (series sorted by date).
function reachedOn(series, targetKg) {
  for (const p of series) if (p.trend <= targetKg + EPS) return p.date
  return null
}

/**
 * Milestones from start to goal, heaviest first:
 *   kind 'step'   every STEP_KG lost
 *   kind 'health' 5% and 10% of starting weight (replace a step that is too close)
 *   kind 'goal'   the goal weight
 * Each: { id, kind, targetKg, lostKg, pct?, reached, reachedOn }.
 */
export function buildMilestones({ startKg, goalKg, series = [], units = 'imperial' }) {
  const start = Number(startKg)
  const goal = Number(goalKg)
  if (!start || !goal || goal >= start) return []
  const step = STEP_KG[units] || STEP_KG.metric

  const raw = []
  for (let i = 1; ; i++) {
    const t = start - i * step
    if (t <= goal + step * 0.4) break // too close to the goal: the goal itself is next
    raw.push({ id: `step-${i}`, kind: 'step', targetKg: t })
  }
  for (const pct of [5, 10]) {
    const t = start * (1 - pct / 100)
    if (t > goal + step * 0.25) raw.push({ id: `pct-${pct}`, kind: 'health', pct, targetKg: t })
  }
  raw.push({ id: 'goal', kind: 'goal', targetKg: goal })

  // A health milestone wins over a step that sits within 40% of a step of it.
  const health = raw.filter((m) => m.kind === 'health')
  const kept = raw.filter((m) => m.kind !== 'step' || !health.some((h) => Math.abs(h.targetKg - m.targetKg) < step * 0.4))

  return kept
    .sort((a, b) => b.targetKg - a.targetKg)
    .map((m) => {
      const on = reachedOn(series, m.targetKg)
      return { ...m, lostKg: start - m.targetKg, reached: Boolean(on), reachedOn: on }
    })
}

/** Where the user is on the milestone path right now. */
export function milestoneProgress(milestones, startKg, currentKg) {
  if (!milestones.length) return null
  const start = Number(startKg)
  const now = Number(currentKg) || start
  const reached = milestones.filter((m) => m.reached)
  const next = milestones.find((m) => !m.reached) || null
  const prevKg = reached.length ? reached[reached.length - 1].targetKg : start
  const fraction = next ? Math.max(0, Math.min(1, (prevKg - now) / (prevKg - next.targetKg))) : 1
  return {
    reachedCount: reached.length,
    total: milestones.length,
    last: reached[reached.length - 1] || null,
    next,
    toNextKg: next ? Math.max(0, now - next.targetKg) : 0,
    fraction,
    overall: Math.max(0, Math.min(1, (start - now) / (start - milestones[milestones.length - 1].targetKg))),
  }
}

// ---------- Badges ----------

// The Dashboard's streak forgives one missed day in any 7 (a rest day): the
// badges count the same way, so a "40-day streak" there is never "12 / 30" here.
export const REST_GAP_DAYS = 7

/**
 * [date, run length so far] for each date (sorted ISO strings). With
 * `graceGap`, a single missed day between logged days doesn't break the run,
 * as long as the last forgiven one was at least that many days before.
 */
function runs(dates, graceGap = 0) {
  const out = []
  let run = 0
  let prev = null
  let lastRest = null
  let sinceRest = 0 // logged days since the last forgiven miss
  for (const d of dates) {
    const missed = prev && dayAfter(prev)
    if (prev && missed === d) {
      run++
      sinceRest++
    } else if (graceGap && prev && dayAfter(missed) === d) {
      // One missed day. Forgiven if the last one was long enough ago; if not,
      // the earlier rest day ends the old run and this one starts after it
      // (as the Dashboard counts back from today).
      run = !lastRest || daysBetween(lastRest, missed) >= graceGap ? run + 1 : sinceRest + 1
      lastRest = missed
      sinceRest = 1
    } else {
      run = 1
      lastRest = null
      sinceRest = 1
    }
    prev = d
    out.push([d, run])
  }
  return out
}

// Date on which a run of days first reached n (dates: sorted ISO strings).
export function streakReachedOn(dates, n, graceGap = 0) {
  return runs(dates, graceGap).find(([, r]) => r >= n)?.[0] ?? null
}

export function longestStreak(dates, graceGap = 0) {
  return runs(dates, graceGap).reduce((best, [, r]) => Math.max(best, r), 0)
}

function dayAfter(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + 1))
  return t.toISOString().slice(0, 10)
}

const nth = (sortedDates, n) => (sortedDates.length >= n ? sortedDates[n - 1] : null)

/**
 * Badge list with progress. Inputs are what the Progress screen already has:
 * weights, daily food totals keyed by date, workouts, targets and milestones.
 * Each: { id, title, desc, emoji, color, earned, earnedOn, value, goal }.
 */
export function computeBadges({ weights = [], daily = {}, workouts = [], targets, milestones = [], startKg, goalKg, currentKg, stepLabel = '5 lb', today = null }) {
  const weighDates = [...new Set(weights.map((w) => w.log_date))].sort()
  const logged = Object.keys(daily).filter((d) => daily[d]?.calories >= 500).sort()
  const proteinGoal = targets?.protein ? targets.protein * 0.9 : null
  const proteinDays = proteinGoal ? logged.filter((d) => daily[d].protein >= proteinGoal) : []
  const workoutDates = workouts.map((w) => w.log_date).sort()
  // The streak shown on the Dashboard right now counts too (it can start with a rest day the walk above splits differently).
  const current = today ? loggingStreak(daily, today, { graceGap: REST_GAP_DAYS }) : null
  const best = Math.max(longestStreak(logged, REST_GAP_DAYS), current?.days || 0)
  const streakOn = (n) =>
    streakReachedOn(logged, n, REST_GAP_DAYS) ?? (current?.days >= n ? logged.filter((d) => d >= current.since)[n - 1] ?? null : null)
  const ms = (pred) => milestones.find(pred)
  const firstStep = ms((m) => m.kind === 'step') || ms((m) => m.kind !== 'step')
  const pct5 = ms((m) => m.id === 'pct-5')
  const pct10 = ms((m) => m.id === 'pct-10')
  const goal = ms((m) => m.kind === 'goal')
  const lostKg = Math.max(0, Number(startKg) - Number(currentKg || startKg))
  const toLose = Number(startKg) - Number(goalKg)
  const halfwayTarget = toLose > 0 ? Number(startKg) - toLose / 2 : null

  const count = (id, title, desc, emoji, color, list, n) => ({
    id, title, desc, emoji, color, earned: list.length >= n, earnedOn: nth(list, n), value: Math.min(list.length, n), goal: n,
  })
  const streak = (id, title, desc, emoji, color, n) => ({
    id, title, desc, emoji, color, earned: best >= n, earnedOn: best >= n ? streakOn(n) : null, value: Math.min(best, n), goal: n,
  })
  const weight = (id, title, desc, emoji, color, m) =>
    m && {
      id, title, desc, emoji, color, earned: m.reached, earnedOn: m.reachedOn,
      value: Math.min(lostKg, m.lostKg), goal: m.lostKg, weightBased: true,
    }

  return [
    count('weigh-1', 'First step', 'Log your first weigh-in', '🌱', 'var(--green)', weighDates, 1),
    streak('streak-3', 'On a roll', 'Reach a 3-day logging streak', '🔥', 'var(--orange)', 3),
    weight('step-1', `First ${stepLabel}`, `Trend down ${stepLabel} from your start`, '🎯', 'var(--blue)', firstStep),
    count('protein-7', 'Protein pro', 'Hit your protein target on 7 days', '💪', 'var(--protein, var(--blue))', proteinDays, 7),
    streak('streak-7', 'Full week', 'Reach a 7-day logging streak', '📅', 'var(--teal)', 7),
    count('weigh-10', 'Steady scale', 'Log 10 weigh-ins', '⚖️', 'var(--indigo)', weighDates, 10),
    count('workout-1', 'Moving', 'Log your first workout', '👟', 'var(--red)', workoutDates, 1),
    weight('pct-5', '5% lighter', 'The first health milestone', '💚', 'var(--green)', pct5),
    count('workout-10', 'Ten sessions', 'Log 10 workouts', '🏋️', 'var(--pink)', workoutDates, 10),
    weight('pct-10', '10% lighter', 'Big health benefits kick in', '💎', 'var(--cyan)', pct10),
    halfwayTarget && {
      id: 'halfway', title: 'Halfway', desc: 'Half the way to your goal', emoji: '🌗', color: 'var(--purple)',
      earned: lostKg >= toLose / 2, earnedOn: milestones.length ? reachedOnFromMilestones(milestones, halfwayTarget) : null,
      value: Math.min(lostKg, toLose / 2), goal: toLose / 2, weightBased: true,
    },
    streak('streak-30', 'Habit made', 'Reach a 30-day logging streak (a rest day a week is fine)', '🏅', 'var(--yellow)', 30),
    weight('goal', 'Goal reached', 'You made it', '🏆', 'var(--yellow)', goal),
  ].filter(Boolean)
}

// Halfway isn't a milestone, so take the date of the first reached milestone at or below it.
function reachedOnFromMilestones(milestones, targetKg) {
  return milestones.find((m) => m.reached && m.targetKg <= targetKg + EPS)?.reachedOn ?? null
}

/** Badges earned now that aren't in `seen` (a list of ids). */
export function newBadges(badges, seen) {
  const s = new Set(seen)
  return badges.filter((b) => b.earned && !s.has(b.id))
}
