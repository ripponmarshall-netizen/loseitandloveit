import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STEP_KG, buildMilestones, computeBadges, longestStreak, milestoneProgress, newBadges, streakReachedOn } from '../src/lib/milestones.js'
import { lbToKg, trendSeries } from '../src/lib/calc.js'
import { addDays } from '../src/lib/dates.js'

const series = (pairs) => pairs.map(([date, trend]) => ({ date, trend, weight: trend }))

test('mini milestones every 5 lb plus 5%, 10% and the goal', () => {
  const start = lbToKg(300)
  const goal = lbToKg(250)
  const ms = buildMilestones({ startKg: start, goalKg: goal, units: 'imperial' })
  const lb = ms.map((m) => Math.round((m.targetKg / lbToKg(1)) * 10) / 10)
  // 5% of 300 = 285 lb and 10% = 270 lb replace the 285 and 270 steps
  assert.deepEqual(lb, [295, 290, 285, 280, 275, 270, 265, 260, 255, 250])
  assert.deepEqual(ms.map((m) => m.kind), ['step', 'step', 'health', 'step', 'step', 'health', 'step', 'step', 'step', 'goal'])
  assert.ok(ms.every((m, i) => i === 0 || m.targetKg < ms[i - 1].targetKg), 'heaviest first')
})

test('metric uses 2 kg steps and no step right next to the goal', () => {
  const ms = buildMilestones({ startKg: 90, goalKg: 83.5, units: 'metric' })
  // steps at 88 and 86 kg; 5% = 85.5 kg replaces the 86 kg step; 84 kg is too close to the goal
  assert.deepEqual(ms.map((m) => m.id), ['step-1', 'pct-5', 'goal'])
  assert.equal(STEP_KG.metric, 2)
  // 84 kg would sit 0.5 kg above the goal: dropped
  assert.ok(!ms.some((m) => Math.abs(m.targetKg - 84) < 1e-9))
})

test('no milestones when not losing weight', () => {
  assert.deepEqual(buildMilestones({ startKg: 80, goalKg: 85 }), [])
  assert.deepEqual(buildMilestones({ startKg: null, goalKg: 70 }), [])
})

test('milestones are reached by the trend, with the first date it got there', () => {
  const s = series([['2026-10-01', 100], ['2026-10-08', 98.5], ['2026-10-15', 97.9], ['2026-10-22', 98.2]])
  const ms = buildMilestones({ startKg: 100, goalKg: 90, series: s, units: 'metric' })
  const step1 = ms.find((m) => m.id === 'step-1') // 98 kg
  assert.equal(step1.reached, true)
  assert.equal(step1.reachedOn, '2026-10-15')
  assert.equal(ms.find((m) => m.id === 'pct-5').reached, false)
  // bouncing back above 98 kg doesn't take the milestone away
  const p = milestoneProgress(ms, 100, 98.2)
  assert.equal(p.reachedCount, 1)
  assert.equal(p.next.id, 'step-2') // 96 kg
  assert.ok(Math.abs(p.toNextKg - 2.2) < 1e-9)
  assert.equal(p.fraction, 0) // above the last milestone again: no progress to the next
  assert.ok(Math.abs(milestoneProgress(ms, 100, 96.5).fraction - 0.75) < 1e-9)
  assert.ok(Math.abs(milestoneProgress(ms, 100, 95).overall - 0.5) < 1e-9)
})

test('trend-based milestones ignore a single light weigh-in', () => {
  const weights = []
  for (let i = 0; i < 10; i++) weights.push({ log_date: addDays('2026-10-01', i), weight_kg: 100 })
  weights.push({ log_date: '2026-10-11', weight_kg: 97 }) // one very light morning
  const ms = buildMilestones({ startKg: 100, goalKg: 90, series: trendSeries(weights), units: 'metric' })
  assert.equal(ms[0].reached, false)
})

test('streaks', () => {
  const d = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06']
  assert.equal(longestStreak(d), 3)
  assert.equal(streakReachedOn(d, 3), '2026-10-03')
  assert.equal(streakReachedOn(d, 4), null)
  // across a month end
  assert.equal(longestStreak(['2026-10-30', '2026-10-31', '2026-11-01']), 3)
  assert.equal(longestStreak([]), 0)
})

test('badges: earned, progress and dates', () => {
  const daily = {}
  for (let i = 0; i < 8; i++) daily[addDays('2026-10-01', i)] = { calories: 1800, protein: i < 5 ? 130 : 60 }
  daily['2026-10-20'] = { calories: 300, protein: 10 } // incomplete day: ignored
  const weights = [{ log_date: '2026-10-01', weight_kg: 100 }, { log_date: '2026-10-08', weight_kg: 98 }]
  const s = series([['2026-10-01', 100], ['2026-10-08', 97.9]])
  const milestones = buildMilestones({ startKg: 100, goalKg: 90, series: s, units: 'metric' })
  const badges = computeBadges({
    weights, daily, workouts: [{ log_date: '2026-10-03' }], targets: { protein: 140 }, milestones,
    startKg: 100, goalKg: 90, currentKg: 97.9, stepLabel: '2 kg',
  })
  const by = Object.fromEntries(badges.map((b) => [b.id, b]))
  assert.equal(by['weigh-1'].earned, true)
  assert.equal(by['weigh-1'].earnedOn, '2026-10-01')
  assert.equal(by['streak-3'].earnedOn, '2026-10-03')
  assert.equal(by['streak-7'].earned, true)
  assert.equal(by['streak-7'].earnedOn, '2026-10-07')
  assert.equal(by['streak-30'].earned, false)
  assert.equal(by['streak-30'].value, 8)
  assert.equal(by['protein-7'].earned, false) // 5 days at >= 90% of 140 g
  assert.equal(by['protein-7'].value, 5)
  assert.equal(by['workout-1'].earned, true)
  assert.equal(by['step-1'].title, 'First 2 kg')
  assert.equal(by['step-1'].earned, true)
  assert.equal(by['step-1'].earnedOn, '2026-10-08')
  assert.equal(by.goal.earned, false)
  assert.equal(by.halfway.earned, false)
  assert.deepEqual(newBadges(badges, ['weigh-1', 'streak-3']).map((b) => b.id).sort(), ['step-1', 'streak-7', 'workout-1'])
})
