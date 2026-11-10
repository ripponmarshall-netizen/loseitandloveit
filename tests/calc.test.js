import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bmr,
  computeTargets,
  entryTotals,
  sumEntries,
  dailyTotals,
  trendSeries,
  weeklyRate,
  adaptiveTdee,
  inputToKg,
  latestWeight,
  projectGoalDate,
  cmToFtIn,
  ftInToCm,
  kgToLb,
} from '../src/lib/calc.js'
import { logicalToday, addDays, daysBetween, lastNDates, formatEta, formatTimeUntil } from '../src/lib/dates.js'

const year = new Date().getFullYear()
const baseProfile = {
  sex: 'male',
  birth_year: year - 35,
  height_cm: 178,
  start_weight_kg: 100,
  goal_weight_kg: 85,
  activity_level: 'moderate',
  weekly_rate_kg: 0.5,
}

test('Mifflin-St Jeor matches hand calculation', () => {
  // 10*100 + 6.25*178 - 5*35 + 5 = 1942.5
  assert.equal(bmr({ sex: 'male', weightKg: 100, heightCm: 178, age: 35 }), 1942.5)
  // female: same minus 166
  assert.equal(bmr({ sex: 'female', weightKg: 100, heightCm: 178, age: 35 }), 1776.5)
})

test('targets: deficit for 0.5 kg/week is ~550 kcal', () => {
  const t = computeTargets(baseProfile, 100)
  assert.equal(t.tdee, Math.round(1942.5 * 1.55))
  assert.ok(Math.abs(t.deficit - 550) <= 10, `deficit ${t.deficit}`)
  assert.equal(t.warnings.length, 0)
  // macros add up to roughly the calorie target
  const kcal = t.protein * 4 + t.carbs * 4 + t.fat * 9
  assert.ok(Math.abs(kcal - t.calories) < 15, `macros ${kcal} vs ${t.calories}`)
})

test('targets: rate capped at 1% body weight and floor applied', () => {
  const t = computeTargets({ ...baseProfile, sex: 'female', height_cm: 155, start_weight_kg: 60, goal_weight_kg: 50, activity_level: 'sedentary', weekly_rate_kg: 1.5 }, 60)
  assert.equal(t.plannedWeeklyLossKg, 0.6)
  assert.equal(t.calories, 1200)
  assert.equal(t.warnings.length, 2)
})

test('targets: maintenance when at or below goal', () => {
  const t = computeTargets({ ...baseProfile, goal_weight_kg: 100 }, 99)
  assert.equal(t.plannedWeeklyLossKg, 0)
  assert.equal(t.deficit, t.tdee - t.calories)
  assert.ok(Math.abs(t.deficit) <= 5)
})

test('targets: manual override wins', () => {
  const t = computeTargets({ ...baseProfile, calorie_target_override: 2100 }, 100)
  assert.equal(t.calories, 2100)
  assert.equal(t.overridden, true)
})

test('entry totals multiply by servings', () => {
  const e = { calories: 250, protein_g: 10, carbs_g: 30, fat_g: 9.5, servings: 2 }
  assert.deepEqual(entryTotals(e), { calories: 500, protein: 20, carbs: 60, fat: 19 })
  const s = sumEntries([e, { calories: 100, protein_g: 1, carbs_g: 2, fat_g: 3 }])
  assert.equal(s.calories, 600)
  const d = dailyTotals([{ ...e, log_date: '2026-11-01' }, { ...e, log_date: '2026-11-02' }])
  assert.equal(d['2026-11-01'].calories, 500)
  assert.equal(d['2026-11-02'].count, 1)
})

test('trend smooths noise and handles gaps', () => {
  const s = trendSeries([
    { log_date: '2026-11-03', weight_kg: 99 },
    { log_date: '2026-11-01', weight_kg: 100 },
    { log_date: '2026-11-10', weight_kg: 98 },
  ])
  assert.equal(s[0].date, '2026-11-01')
  assert.equal(s[0].trend, 100)
  // 2-day gap: alpha = 1 - 0.9^2 = 0.19 -> 100 - 0.19 = 99.81
  assert.equal(s[1].trend, 99.81)
  assert.ok(s[2].trend < s[1].trend && s[2].trend > 98)
})

test('weekly rate and goal projection on a steady loss', () => {
  const weights = []
  for (let i = 0; i < 60; i++) weights.push({ log_date: addDays('2026-09-01', i), weight_kg: 100 - i * (0.5 / 7) })
  const s = trendSeries(weights)
  const rate = weeklyRate(s)
  assert.ok(rate < -0.45 && rate > -0.55, `rate ${rate}`)
  const eta = projectGoalDate(s, 90, '2026-10-31', rate)
  assert.ok(eta > '2026-11-30' && eta < '2027-02-01', eta)
  assert.equal(projectGoalDate(s, 90, '2026-10-31', 0.1), null)
})

test('adaptive TDEE recovers true maintenance from synthetic data', () => {
  // True TDEE 2600, eating 2050 -> 550/day deficit -> 0.5 kg/week
  const daily = {}
  const weights = []
  const start = '2026-09-01'
  for (let i = 0; i < 50; i++) {
    const d = addDays(start, i)
    daily[d] = { calories: 2050 }
    weights.push({ log_date: d, weight_kg: 100 - (i * 550) / 7700 })
  }
  const res = adaptiveTdee({ daily, series: trendSeries(weights), endDate: addDays(start, 49) })
  assert.ok(res, 'should produce an estimate')
  assert.ok(Math.abs(res.tdee - 2600) <= 60, `tdee ${res.tdee}`)
  assert.equal(res.confidence, 'high')
})

test('adaptive TDEE refuses with too little data', () => {
  const res = adaptiveTdee({ daily: { '2026-11-01': { calories: 2000 } }, series: [], endDate: '2026-11-05' })
  assert.equal(res, null)
})

test('logical day respects day-start hour', () => {
  const lateNight = new Date(2026, 10, 7, 2, 30) // 7 Nov 02:30
  assert.equal(logicalToday(4, lateNight), '2026-11-06')
  assert.equal(logicalToday(0, lateNight), '2026-11-07')
  assert.equal(daysBetween('2026-10-30', '2026-11-02'), 3)
  assert.deepEqual(lastNDates('2026-11-02', 3), ['2026-10-31', '2026-11-01', '2026-11-02'])
})

test('unit conversions round-trip', () => {
  assert.deepEqual(cmToFtIn(178), { ft: 5, in: 10 })
  assert.ok(Math.abs(ftInToCm(5, 10) - 177.8) < 0.01)
  assert.ok(Math.abs(kgToLb(100) - 220.46) < 0.01)
})

import {
  treadmillKcal,
  homeWorkoutKcal,
  estimateWorkoutKcal,
  exerciseAllowance,
  workoutSummary,
  kmhToMph,
  mphToKmh,
} from '../src/lib/calc.js'

test('treadmill burn uses ACSM walking/running equations (net kcal)', () => {
  // 100 kg, 5 km/h flat, 30 min: net VO2 = 0.1*83.33 = 8.33 -> 8.33*0.1*5*30 = 125
  assert.equal(treadmillKcal({ weightKg: 100, minutes: 30, speedKmh: 5, inclinePct: 0 }), 125)
  // Same walk at 10% incline adds 1.8*83.33*0.1 = 15 -> net 23.33 -> 350
  assert.equal(treadmillKcal({ weightKg: 100, minutes: 30, speedKmh: 5, inclinePct: 10 }), 350)
  // Running 10 km/h flat, 30 min: net 0.2*166.67 = 33.33 -> 500 (~1 kcal/kg/km)
  assert.equal(treadmillKcal({ weightKg: 100, minutes: 30, speedKmh: 10 }), 500)
  // Auto mode: >= 8 km/h counts as running unless told otherwise
  assert.ok(treadmillKcal({ weightKg: 80, minutes: 20, speedKmh: 8.5, mode: 'walk' }) < treadmillKcal({ weightKg: 80, minutes: 20, speedKmh: 8.5 }))
  // Declines are treated as flat, missing inputs give 0
  assert.equal(treadmillKcal({ weightKg: 100, minutes: 30, speedKmh: 5, inclinePct: -3 }), 125)
  assert.equal(treadmillKcal({ weightKg: 100, minutes: 0, speedKmh: 5 }), 0)
})

test('home workout burn uses net METs', () => {
  // Hard bodyweight circuit MET 8 -> (8-1)*100kg*20/60 = 233
  assert.equal(homeWorkoutKcal({ weightKg: 100, minutes: 20, activity: 'bodyweight', intensity: 'hard' }), 233)
  // Light mobility MET 2.3 -> 1.3*90*10/60 = 19.5 (19.4999… in floating point) -> 19
  assert.equal(homeWorkoutKcal({ weightKg: 90, minutes: 10, activity: 'mobility', intensity: 'light' }), 19)
  assert.equal(estimateWorkoutKcal({ kind: 'home', duration_min: 20, activity: 'bodyweight', intensity: 'hard' }, 100), 233)
  assert.equal(estimateWorkoutKcal({ kind: 'treadmill', duration_min: 30, speed_kmh: 5, incline_pct: 0 }, 100), 125)
})

test('exercise allowance and weekly summary', () => {
  assert.equal(exerciseAllowance(300, 0), 0)
  assert.equal(exerciseAllowance(300, 50), 150)
  const s = workoutSummary([
    { kind: 'treadmill', duration_min: 30, speed_kmh: 5, calories_burned: 125 },
    { kind: 'home', activity: 'weights', duration_min: 25, calories_burned: 150 },
    { kind: 'home', activity: 'mobility', duration_min: 10, calories_burned: 20 },
  ])
  assert.deepEqual(s, { sessions: 3, minutes: 65, kcal: 295, strength: 1, treadmill: 1, treadmillKm: 2.5 })
  assert.ok(Math.abs(kmhToMph(mphToKmh(3)) - 3) < 1e-9)
})

test('weight input accepts a comma decimal and blanks', () => {
  assert.equal(inputToKg('80,5', 'metric'), 80.5)
  assert.ok(Math.abs(inputToKg(' 200 ', 'imperial') - 90.718) < 0.01)
  assert.equal(inputToKg('', 'metric'), null)
  assert.equal(inputToKg('abc', 'metric'), null)
})

test('adaptive TDEE ignores a weigh-in from long before the window', () => {
  const end = '2026-10-31'
  const start = addDays(end, -20)
  const daily = {}
  for (let i = 0; i < 21; i++) daily[addDays(start, i)] = { calories: 2200 }
  // One old weigh-in 60 days back at a much higher weight, then steady weights in the window.
  const weights = [{ log_date: addDays(end, -80), weight_kg: 110 }]
  for (let i = 0; i < 21; i += 2) weights.push({ log_date: addDays(start, i), weight_kg: 90 })
  const res = adaptiveTdee({ daily, series: trendSeries(weights), endDate: end })
  assert.ok(res, 'should still estimate')
  assert.ok(res.spanDays <= 21, `span ${res.spanDays} should stay inside the window`)
})

test('adaptive target uses the planned deficit, so re-applying it does not drift', async () => {
  const { adaptiveTarget } = await import('../src/lib/calc.js')
  const t1 = computeTargets(baseProfile, 100)
  const adaptive = { tdee: 2600 }
  const first = adaptiveTarget(adaptive, t1)
  const t2 = computeTargets({ ...baseProfile, calorie_target_override: first }, 100)
  assert.equal(adaptiveTarget(adaptive, t2), first)
  assert.ok(Math.abs(first - (2600 - 550)) <= 10, `first ${first}`)
})

test('adaptive target never goes below the floor', async () => {
  const { adaptiveTarget } = await import('../src/lib/calc.js')
  const t = computeTargets({ ...baseProfile, sex: 'female' }, 100)
  assert.equal(adaptiveTarget({ tdee: 1300 }, t), 1200)
})

test('manual target: no "raised to the minimum" warning', () => {
  const t = computeTargets({ ...baseProfile, sex: 'female', height_cm: 150, start_weight_kg: 55, goal_weight_kg: 50, activity_level: 'sedentary', calorie_target_override: 1400 }, 55)
  assert.equal(t.calories, 1400)
  assert.ok(!t.warnings.some((w) => /raised/.test(w)), t.warnings.join())
})

// ---------- Meal breakdown ----------
import { macroBreakdown, wholePercents } from '../src/lib/calc.js'

test('wholePercents always sums to 100 and handles zeros', () => {
  assert.deepEqual(wholePercents([1, 1, 1]), [34, 33, 33])
  assert.equal(wholePercents([10, 20, 33.3]).reduce((s, v) => s + v, 0), 100)
  assert.deepEqual(wholePercents([0, 0]), [0, 0])
  assert.deepEqual(wholePercents([5, -3]), [100, 0])
})

test('macroBreakdown: calories by macro, share of day and foods sorted', () => {
  const entries = [
    { id: 'a', name: 'Ackee and saltfish', servings: 1, calories: 380, protein_g: 22, carbs_g: 8, fat_g: 29 },
    { id: 'b', name: 'Fried dumpling', servings: 2, calories: 170, protein_g: 3, carbs_g: 22, fat_g: 8 },
  ]
  const b = macroBreakdown(entries, { calories: 2000, protein: 150, carbs: 200, fat: 60 })
  assert.equal(b.totals.calories, 720)
  assert.deepEqual(b.kcalFrom, { protein: 112, carbs: 208, fat: 405 })
  assert.equal(b.split.protein + b.split.carbs + b.split.fat, 100)
  assert.equal(b.split.fat, 56)
  assert.equal(b.ofDay.calories, 36)
  assert.equal(b.ofDay.protein, 19)
  assert.deepEqual(b.items.map((i) => i.id), ['a', 'b'])
  assert.equal(b.items[0].share + b.items[1].share, 100)
})

test('macroBreakdown: empty meal and no targets', () => {
  const b = macroBreakdown([], null)
  assert.equal(b.totals.calories, 0)
  assert.deepEqual(b.split, { protein: 0, carbs: 0, fat: 0 })
  assert.equal(b.ofDay.calories, null)
  assert.deepEqual(b.items, [])
})

test('weekStart is the Monday of the week', async () => {
  const { weekStart } = await import('../src/lib/calc.js')
  assert.equal(weekStart('2026-11-08'), '2026-11-02') // Sunday → Monday before
  assert.equal(weekStart('2026-11-09'), '2026-11-09') // Monday
  assert.equal(weekStart('2026-11-01'), '2026-10-26')
})

test('bucketAverages: daily, weekly and monthly averages ending today', async () => {
  const { bucketAverages, bucketStats } = await import('../src/lib/calc.js')
  const pts = [
    { date: '2026-11-08', value: 100 },
    { date: '2026-11-07', value: 200 },
    { date: '2026-11-02', value: 300 },
    { date: '2026-10-31', value: 50 },
    { date: '2026-11-09', value: 999 }, // after the end date: ignored
    { date: '2026-11-06', value: 'x' }, // not a number: ignored
  ]
  const days = bucketAverages(pts, 'day', '2026-11-08', 3)
  assert.deepEqual(days.map((b) => b.key), ['2026-11-06', '2026-11-07', '2026-11-08'])
  assert.deepEqual(days.map((b) => b.value), [null, 200, 100])

  const weeks = bucketAverages(pts, 'week', '2026-11-08', 2)
  assert.deepEqual(weeks.map((b) => b.key), ['2026-10-26', '2026-11-02'])
  assert.equal(weeks[1].end, '2026-11-08')
  assert.equal(weeks[1].value, 200) // (100 + 200 + 300) / 3
  assert.equal(weeks[0].value, 50)

  const months = bucketAverages(pts, 'month', '2026-11-08', 3)
  assert.deepEqual(months.map((b) => b.key), ['2026-09-01', '2026-10-01', '2026-11-01'])
  assert.equal(months[1].end, '2026-10-31')
  assert.equal(months[2].value, 200)
  assert.equal(months[0].value, null)

  // Month stepping crosses the year boundary.
  assert.deepEqual(bucketAverages([], 'month', '2026-01-15', 2).map((b) => b.key), ['2025-12-01', '2026-01-01'])

  const s = bucketStats(weeks)
  assert.equal(s.avg, 125)
  assert.equal(s.change, 150)
  assert.equal(bucketStats(bucketAverages([], 'day', '2026-11-08', 3)), null)
})

test('bucketAverages with agg "last" keeps the latest value in each bucket', async () => {
  const { bucketAverages } = await import('../src/lib/calc.js')
  const pts = [
    { date: '2026-11-02', value: 2.5 },
    { date: '2026-11-05', value: 5 },
    { date: '2026-11-03', value: 2.5 },
  ]
  const [wk] = bucketAverages(pts, 'week', '2026-11-08', 1, 'last')
  assert.equal(wk.value, 5)
  assert.equal(bucketAverages(pts, 'week', '2026-11-08', 1)[0].value, 10 / 3)
})

test('goal ETA fits a small tile and says how far away it is', () => {
  assert.equal(formatEta('2026-12-20', '2026-11-09'), '20 Dec')
  assert.equal(formatEta('2027-05-20', '2026-11-09'), 'May ’27')
  assert.equal(formatTimeUntil('2026-11-12', '2026-11-09'), 'in 3 days')
  assert.equal(formatTimeUntil('2026-11-10', '2026-11-09'), 'in 1 day')
  assert.equal(formatTimeUntil('2026-12-20', '2026-11-09'), 'in 6 weeks')
  assert.equal(formatTimeUntil('2027-09-01', '2026-11-09'), 'in 10 months')
  assert.equal(formatTimeUntil('2029-11-09', '2026-11-09'), 'in 3 years')
  assert.equal(formatTimeUntil('2026-11-09', '2026-11-09'), 'now')
})

test('latestWeight is the most recent weigh-in, not the smoothed trend', () => {
  assert.equal(latestWeight([]), null)
  const s = trendSeries([
    { log_date: '2026-01-03', weight_kg: 98 },
    { log_date: '2026-01-01', weight_kg: 100 },
    { log_date: '2026-01-02', weight_kg: 100 },
  ])
  assert.equal(latestWeight(s), 98)
  assert.notEqual(s[s.length - 1].trend, 98)
})
