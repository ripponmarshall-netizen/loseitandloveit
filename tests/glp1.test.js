import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dailyNudge, doseLevels, doseStatus, planDoseStatus, doseStatusLabel, doseStep, glp1Plan, suggestSite, summariseDailyLogs, waterTargetMl, formatWater } from '../src/lib/glp1.js'

test('weekly dose: due, upcoming, taken, overdue', () => {
  const doses = [{ log_date: '2026-11-01' }, { log_date: '2026-10-25' }]
  assert.equal(doseStatus({ doses, frequency: 'weekly', today: '2026-11-08' }).state, 'due')
  const up = doseStatus({ doses, frequency: 'weekly', today: '2026-11-05' })
  assert.equal(up.state, 'upcoming')
  assert.equal(up.daysUntil, 3)
  assert.equal(doseStatusLabel(up), 'In 3 days')
  const late = doseStatus({ doses, frequency: 'weekly', today: '2026-11-10' })
  assert.equal(late.state, 'overdue')
  assert.equal(doseStatusLabel(late), '2 days late')
  const taken = doseStatus({ doses: [...doses, { log_date: '2026-11-08' }], frequency: 'weekly', today: '2026-11-08' })
  assert.equal(taken.state, 'taken')
  assert.equal(taken.nextDate, '2026-11-15')
})

test('no doses yet: prompts for the first one', () => {
  const s = doseStatus({ doses: [], frequency: 'weekly', today: '2026-11-08' })
  assert.equal(s.state, 'none')
  assert.equal(doseStatusLabel(s), 'Log first dose')
})

test('no doses logged but a start date: the start date counts as dose one', () => {
  const s = doseStatus({ doses: [], frequency: 'weekly', today: '2026-11-08', startedOn: '2026-11-05' })
  assert.equal(s.state, 'upcoming')
  assert.equal(s.assumed, true)
  assert.equal(s.nextDate, '2026-11-12')
  assert.equal(doseStatusLabel(s), 'In 4 days')
  assert.equal(doseStatus({ doses: [], frequency: 'weekly', today: '2026-11-05', startedOn: '2026-11-05' }).state, 'taken')
  assert.equal(doseStatus({ doses: [], frequency: 'weekly', today: '2026-11-14', startedOn: '2026-11-05' }).state, 'overdue')
  // A future start date doesn't count yet.
  assert.equal(doseStatus({ doses: [], frequency: 'weekly', today: '2026-11-08', startedOn: '2026-11-20' }).state, 'none')
  // Daily plans: due today, never "first dose".
  const daily = doseStatus({ doses: [], frequency: 'daily', today: '2026-11-08', startedOn: '2026-11-01' })
  assert.equal(daily.state, 'due')
  // Real doses win over the start date.
  const real = doseStatus({ doses: [{ log_date: '2026-11-07' }], frequency: 'weekly', today: '2026-11-08', startedOn: '2026-11-01' })
  assert.equal(real.assumed, false)
  assert.equal(real.nextDate, '2026-11-14')
})

test('planDoseStatus uses the plan frequency and start date', () => {
  assert.equal(planDoseStatus(null, [], '2026-11-08'), null)
  const plan = glp1Plan({ glp1_med: 'mounjaro', glp1_dose: 2.5, glp1_frequency: 'weekly', glp1_started_on: '2026-11-05' })
  assert.equal(planDoseStatus(plan, [], '2026-11-08').nextDate, '2026-11-12')
})

test('twice daily needs two doses today', () => {
  const one = doseStatus({ doses: [{ log_date: '2026-11-08' }], frequency: 'twice_daily', today: '2026-11-08' })
  assert.equal(one.state, 'due')
  assert.equal(doseStatusLabel(one), 'Dose 2 of 2')
  const two = doseStatus({ doses: [{ log_date: '2026-11-08' }, { log_date: '2026-11-08' }], frequency: 'twice_daily', today: '2026-11-08' })
  assert.equal(two.state, 'taken')
})

test('site rotation never repeats the last site and prefers unused sites', () => {
  assert.equal(suggestSite([]), 'abdomen-ll')
  const doses = [
    { site: 'abdomen-ll', log_date: '2026-10-25' },
    { site: 'abdomen-lr', log_date: '2026-11-01' },
  ]
  assert.equal(suggestSite(doses), 'thigh-l')
  // All used: pick the one used longest ago, but never the latest.
  const order = ['a', 'b', 'c']
  const all = [
    { site: 'a', log_date: '2026-10-18' },
    { site: 'b', log_date: '2026-10-25' },
    { site: 'c', log_date: '2026-11-01' },
  ]
  assert.equal(suggestSite(all, order), 'a')
  assert.notEqual(suggestSite([{ site: 'a', log_date: '2026-11-01' }], order), 'a')
})

test('dose step on the label ladder', () => {
  assert.deepEqual(doseStep('mounjaro', 5), { step: 2, of: 6, isTop: false })
  assert.equal(doseStep('wegovy', 2.4).isTop, true)
  assert.equal(doseStep('wegovy', 3), null)
})

test('plan from profile', () => {
  assert.equal(glp1Plan({}), null)
  const p = glp1Plan({ glp1_med: 'byetta', glp1_dose: 5 })
  assert.equal(p.unit, 'mcg')
  assert.equal(p.frequency, 'twice_daily')
  assert.equal(glp1Plan({ glp1_med: 'other', glp1_name: 'Compounded sema' }).name, 'Compounded sema')
})

test('water target: ~30 ml/kg, clamped, override wins', () => {
  assert.equal(waterTargetMl(100), 3000)
  assert.equal(waterTargetMl(50), 2000)
  assert.equal(waterTargetMl(160), 3500)
  assert.equal(waterTargetMl(100, 2200), 2200)
  assert.equal(formatWater(1250), '1.3 L')
  assert.equal(formatWater(250), '250 ml')
})

test('nudges: urgent symptoms first, under-eating on GLP-1 in the evening', () => {
  const targets = { protein: 150 }
  const base = { onGlp1: true, hour: 19, eatenKcal: 600, proteinG: 40, targets, sex: 'male', waterMl: 2000, waterTarget: 3000 }
  assert.equal(dailyNudge({ ...base, symptoms: ['severe_pain'] }).tone, 'urgent')
  assert.match(dailyNudge(base).text, /at least 1500/)
  assert.equal(dailyNudge({ ...base, onGlp1: false }), null)
  assert.equal(dailyNudge({ ...base, eatenKcal: 1600, proteinG: 120 }), null)
})

test('daily log summary', () => {
  const s = summariseDailyLogs([
    { mood: 4, energy: 3, water_ml: 2000, symptoms: ['nausea'] },
    { mood: 2, energy: null, water_ml: 0, symptoms: ['nausea', 'fatigue'] },
  ])
  assert.equal(s.mood, 3)
  assert.equal(s.energy, 3)
  assert.equal(s.waterMl, 2000)
  assert.deepEqual(s.symptoms[0], ['nausea', 2])
})

test('doseLevels: each dose holds until the next, and stops after a long gap', () => {
  const doses = [
    { log_date: '2026-10-01', dose: 2.5, unit: 'mg' },
    { log_date: '2026-10-08', dose: 2.5, unit: 'mg' },
    { log_date: '2026-10-15', dose: 5, unit: 'mg' },
  ]
  const { levels, taken } = doseLevels({ doses, from: '2026-10-01', to: '2026-11-08', frequency: 'weekly' })
  const at = (d) => levels.find((l) => l.date === d)?.value
  assert.equal(at('2026-10-01'), 2.5)
  assert.equal(at('2026-10-14'), 2.5)
  assert.equal(at('2026-10-15'), 5)
  assert.equal(at('2026-10-28'), 5) // 13 days after the last dose: still on it
  assert.equal(at('2026-10-29'), undefined) // 14 days: stopped
  assert.deepEqual(taken.map((t) => t.value), [2.5, 2.5, 5])

  // Starts before the range: the earlier dose carries in.
  assert.equal(doseLevels({ doses, from: '2026-10-20', to: '2026-10-20' }).levels[0].value, 5)
  // Daily medicines stop after 3 days without a dose.
  const daily = doseLevels({ doses: [{ log_date: '2026-11-01', dose: 3, unit: 'mg' }], from: '2026-11-01', to: '2026-11-08', frequency: 'daily' })
  assert.equal(daily.levels.length, 4)
})

test('doseLevels: the plan stands in when no doses are logged', () => {
  const plan = { startedOn: '2026-11-05', dose: 2.5, unit: 'mg' }
  const { levels, taken } = doseLevels({ doses: [], from: '2026-11-01', to: '2026-11-08', plan })
  assert.deepEqual(levels.map((l) => l.date), ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
  assert.equal(taken.length, 1)
  assert.deepEqual(doseLevels({ doses: [], from: '2026-11-01', to: '2026-11-08' }), { levels: [], taken: [] })
})

test('doseLevels: mixed units keep the newest unit only', () => {
  const doses = [
    { log_date: '2026-11-01', dose: 600, unit: 'mcg' },
    { log_date: '2026-11-03', dose: 1.2, unit: 'mg' },
  ]
  const { taken } = doseLevels({ doses, from: '2026-11-01', to: '2026-11-04', frequency: 'daily' })
  assert.deepEqual(taken, [{ date: '2026-11-03', value: 1.2 }])
})

test('daily log summary: a day with several mood check-ins counts once, as their average', () => {
  const s = summariseDailyLogs(
    [
      { log_date: '2026-11-10', mood: 1, energy: 2 }, // latest of 5, 1 below
      { log_date: '2026-11-11', mood: 4, energy: 4 }, // logged before moods could repeat
    ],
    [
      { log_date: '2026-11-10', mood: 5, energy: 4 },
      { log_date: '2026-11-10', mood: 1, energy: null },
      { log_date: '2026-11-12', mood: 2, energy: 2 }, // no daily row yet
    ],
  )
  assert.equal(s.mood, 3) // (3 + 4 + 2) / 3
  assert.equal(s.energy, 3.3) // (4 + 4 + 2) / 3
})
