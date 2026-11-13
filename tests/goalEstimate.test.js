import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGoalContext, cleanGoalEstimate, goalEstimateDue, goalFingerprint } from '../src/lib/goalEstimate.js'
import { trendSeries } from '../src/lib/calc.js'

const profile = { units: 'imperial', sex: 'female', birth_year: 1990, height_cm: 165, start_weight_kg: 147.4, goal_weight_kg: 81.65, weekly_rate_kg: 0.91, conditions: ['pcos'] }
const weights = [
  ['2026-11-07', 146.51], ['2026-11-09', 145.51], ['2026-11-10', 145.24], ['2026-11-11', 144.61], ['2026-11-12', 143.97],
].map(([log_date, weight_kg], i) => ({ id: `w${i}`, log_date, weight_kg }))
const series = trendSeries(weights)

test('buildGoalContext: the main goal and the weigh-ins, in the user’s units', () => {
  const c = buildGoalContext({ profile, series, targets: { calories: 2100 }, today: '2026-11-13', formulaEta: '2027-03-01', weeklyRateKg: -2.5 })
  assert.equal(c.units, 'lb')
  assert.equal(c.goal_weight, 180) // the profile's goal, not a milestone
  assert.equal(c.start_weight, 325)
  assert.equal(c.weigh_ins.length, 5)
  assert.equal(c.weigh_ins[4].weight, 317.4)
  assert.equal(c.days_of_data, 6)
  assert.deepEqual(c.conditions, ['pcos'])
  assert.equal(c.trend_rate_per_week, -5.5)
  assert.equal(c.straight_line_eta, '2027-03-01')
})

test('goalEstimateDue: asks once, again only when the data or goal changes', () => {
  const fp = goalFingerprint({ profile, series })
  const now = Date.parse('2026-11-13T12:00:00Z')
  assert.equal(goalEstimateDue({ cached: null, fingerprint: fp, series, goalReached: false, now }), true)
  const cached = { fingerprint: fp, result: { eta: '2028-01-01' }, at: now - 3600e3 }
  assert.equal(goalEstimateDue({ cached, fingerprint: fp, series, goalReached: false, now }), false)
  const newGoal = goalFingerprint({ profile: { ...profile, goal_weight_kg: 77 }, series })
  assert.notEqual(newGoal, fp)
  assert.equal(goalEstimateDue({ cached, fingerprint: newGoal, series, goalReached: false, now }), true)
  // a week old: refresh
  assert.equal(goalEstimateDue({ cached: { ...cached, at: now - 8 * 86400e3 }, fingerprint: fp, series, goalReached: false, now }), true)
  // failed recently: wait an hour
  assert.equal(goalEstimateDue({ cached: { failedAt: now - 60e3 }, fingerprint: fp, series, goalReached: false, now }), false)
  // nothing to estimate
  assert.equal(goalEstimateDue({ cached: null, fingerprint: fp, series: series.slice(0, 1), goalReached: false, now }), false)
  assert.equal(goalEstimateDue({ cached: null, fingerprint: fp, series, goalReached: true, now }), false)
})

test('cleanGoalEstimate: keeps real, ordered, future dates and drops the rest', () => {
  const today = '2026-11-13'
  const ok = cleanGoalEstimate({ eta: '2028-02-01', earliest: '2027-11-01', latest: '2028-08-01', realistic_rate_per_week: 1.3, confidence: 'low', summary: ' Early days. ' }, today)
  assert.deepEqual(ok, { eta: '2028-02-01', earliest: '2027-11-01', latest: '2028-08-01', ratePerWeek: 1.3, confidence: 'low', summary: 'Early days.' })
  assert.equal(cleanGoalEstimate({ eta: '2026-01-01' }, today), null) // in the past
  assert.equal(cleanGoalEstimate({ eta: 'soon' }, today), null)
  assert.equal(cleanGoalEstimate({ eta: '2050-01-01' }, today), null) // absurdly far
  const swapped = cleanGoalEstimate({ eta: '2028-02-01', earliest: '2028-05-01', latest: '2027-01-01', confidence: 'certain' }, today)
  assert.equal(swapped.earliest, '2028-02-01')
  assert.equal(swapped.latest, '2028-02-01')
  assert.equal(swapped.confidence, 'low')
  assert.equal(swapped.ratePerWeek, null)
})
