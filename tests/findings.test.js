import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeFindings, glp1Timing, lightDays, lowSteps, maintenanceGap, mealPattern, recentHealth, scaleJump, sleepAndFood, topFoods } from '../src/lib/findings.js'
import { dailyTotals, trendSeries } from '../src/lib/calc.js'
import { addDays } from '../src/lib/dates.js'

const TODAY = '2026-11-22'
const day = (n) => addDays(TODAY, -n)
// A local time on a day, as the device stores it.
const at = (iso, h, m = 0) => {
  const [y, mo, d] = iso.split('-').map(Number)
  return new Date(y, mo - 1, d, h, m).toISOString()
}
let n = 0
const food = (log_date, meal, name, calories, extra = {}) => ({ id: `e${++n}`, log_date, meal, name, calories, protein_g: 10, carbs_g: 30, fat_g: 10, servings: 1, created_at: at(log_date, { breakfast: 8, lunch: 13, dinner: 19, snack: 16 }[meal]), ...extra })
const fullDay = (d, extra = []) => [food(d, 'breakfast', 'Porridge', 400), food(d, 'lunch', 'Chicken and rice', 700), food(d, 'dinner', 'Fish and callaloo', 600), ...extra]
const ctx = (o) => {
  const entries = o.entries || []
  return { today: TODAY, entries, daily: dailyTotals(entries), logs: Object.fromEntries((o.dailyLogs || []).map((l) => [l.log_date, l])), dailyLogs: [], weights: [], series: [], doses: [], plan: null, targets: { calories: 1700, tdee: 2100 }, units: 'imperial', dayStartHour: 0, ...o }
}

test('a jump on the scale is explained with the note, salty food, carbs and water from the day before', () => {
  const weights = [...Array.from({ length: 10 }, (_, i) => ({ log_date: day(12 - i), weight_kg: 80 })), { log_date: day(2), weight_kg: 80 }, { log_date: TODAY, weight_kg: 80.9, note: 'salty dinner' }]
  const entries = [...Array.from({ length: 10 }, (_, i) => fullDay(day(i + 2))).flat(), food(day(1), 'dinner', 'Ackee and saltfish', 500, { carbs_g: 300 }), food(day(1), 'lunch', 'Rice and peas', 300)]
  const dailyLogs = [...Array.from({ length: 10 }, (_, i) => ({ log_date: day(i + 2), water_ml: 2000 })), { log_date: day(1), water_ml: 1000 }, { log_date: TODAY, sleep_min: 300 }]
  const f = scaleJump(ctx({ weights, series: trendSeries(weights), entries, dailyLogs }))
  assert.equal(f.id, 'scale-jump')
  assert.equal(f.score, 0.95)
  assert.match(f.text, /Today’s weigh-in is 2\.0 lb above the one 2 days before/)
  assert.match(f.text, /salty dinner/)
  assert.match(f.text, /Ackee and saltfish/)
  assert.match(f.text, /Carbs the day before/)
  assert.match(f.text, /1\.0 L vs about 2\.0 L/)
  assert.match(f.text, /Slept 5\.0 h/)
})

test('no scale-jump finding for a small rise, an old weigh-in, or a trend that is really climbing', () => {
  const flat = Array.from({ length: 10 }, (_, i) => ({ log_date: day(10 - i), weight_kg: 80 }))
  const small = [...flat, { log_date: TODAY, weight_kg: 80.4 }]
  assert.equal(scaleJump(ctx({ weights: small, series: trendSeries(small) })), null)
  const old = [...flat.slice(0, 6), { log_date: day(3), weight_kg: 81.5 }]
  assert.equal(scaleJump(ctx({ weights: old, series: trendSeries(old) })), null)
  const climbing = Array.from({ length: 10 }, (_, i) => ({ log_date: day(9 - i), weight_kg: 78 + i * 0.4 }))
  climbing.push({ log_date: TODAY, weight_kg: 83 })
  assert.equal(scaleJump(ctx({ weights: climbing, series: trendSeries(climbing) })), null)
})

test('light days: several near-empty days in two weeks are flagged, worded for GLP-1 users', () => {
  const entries = [...[1, 2, 3, 4, 5].map((i) => fullDay(day(i))).flat(), ...[6, 7, 8, 9].map((i) => food(day(i), 'lunch', 'Patty', 450))]
  const f = lightDays(ctx({ entries }))
  assert.match(f.text, /On 4 of the 9 days .* under 950 kcal/)
  assert.match(f.text, /miss a meal or snacks/)
  assert.match(lightDays(ctx({ entries, plan: { frequency: 'weekly' } })).text, /On a GLP-1/)
  // Three light days isn't a pattern.
  assert.equal(lightDays(ctx({ entries: entries.filter((e) => e.log_date !== day(9)) })), null)
})

test('maintenance gap: logged food far below what the weight trend implies', () => {
  const entries = Array.from({ length: 21 }, (_, i) => fullDay(day(i + 1))).flat() // 1,700 a day
  const weights = Array.from({ length: 11 }, (_, i) => ({ log_date: day(1 + i * 2), weight_kg: 80 }))
  const f = maintenanceGap(ctx({ entries, series: trendSeries(weights), targets: { calories: 1700, tdee: 2200 } }))
  assert.match(f.text, /about 1,700 kcal .* 500 below the formula’s 2,200/)
  assert.equal(maintenanceGap(ctx({ entries, series: trendSeries(weights), targets: { calories: 1700, tdee: 1900 } })), null)
})

test('GLP-1: symptoms and low intake the days after a weekly dose, and where today sits', () => {
  const doses = [28, 21, 14, 7].map((k) => ({ log_date: day(k), dose: 5 }))
  const entries = []
  const dailyLogs = []
  for (let k = 28; k >= 1; k--) {
    const since = (28 - k) % 7
    const early = since === 1 || since === 2
    entries.push(food(day(k), 'lunch', 'Meal', early ? 1100 : 1700))
    dailyLogs.push({ log_date: day(k), symptoms: early ? ['nausea'] : k % 5 === 0 ? ['bloating'] : [] })
  }
  const f = glp1Timing(ctx({ entries, dailyLogs, doses, plan: { frequency: 'weekly' } }))
  assert.match(f.text, /mostly nausea\) were logged on 8 of 8 check-ins 1–2 days after a dose/)
  assert.match(f.text, /average 1,100 vs 1,700/)
  assert.match(f.text, /The next dose is due\.$/) // last dose a week ago
  assert.equal(f.score, 0.6)
  assert.match(glp1Timing(ctx({ entries, dailyLogs, doses: [...doses, { log_date: day(1), dose: 5 }], plan: { frequency: 'weekly' } })).text, /Today is day 1 after the dose\.$/)
  assert.equal(glp1Timing(ctx({ entries, dailyLogs, doses, plan: null })), null)
  assert.equal(glp1Timing(ctx({ entries, dailyLogs, doses: doses.slice(2), plan: { frequency: 'weekly' } })), null)
})

test('sleep and food: short nights followed by bigger days, with enough nights each side', () => {
  const entries = []
  const dailyLogs = []
  for (let k = 1; k <= 10; k++) {
    const short = k % 2 === 0
    entries.push(food(day(k), 'lunch', 'Meal', short ? 2200 : 1800))
    dailyLogs.push({ log_date: day(k), sleep_min: short ? 330 : 450 })
  }
  const f = sleepAndFood(ctx({ entries, dailyLogs }))
  assert.match(f.text, /400 kcal more was logged the next day .* \(5 short nights vs 5/)
  assert.equal(f.score, 0.45)
  const withLastNight = sleepAndFood(ctx({ entries, dailyLogs: [...dailyLogs, { log_date: TODAY, sleep_min: 300 }] }))
  assert.equal(withLastNight.score, 0.75)
  assert.equal(sleepAndFood(ctx({ entries, dailyLogs: dailyLogs.slice(0, 6) })), null)
})

test('meal pattern: skipped breakfasts, evening-heavy days and late eating; copied days are ignored', () => {
  const entries = []
  for (let k = 1; k <= 12; k++) {
    entries.push(food(day(k), 'lunch', 'Patty', 450), food(day(k), 'dinner', 'Curry chicken', 900))
    if (k <= 5) entries.push(food(day(k), 'snack', 'Bun and cheese', 400, { created_at: at(day(k), 22, 15) }))
  }
  const f = mealPattern(ctx({ entries }))
  assert.match(f.text, /Breakfast was logged on 0 of 12 days/)
  assert.match(f.text, /Dinner and snacks are/)
  assert.match(f.text, /On 5 of 12 days, 300\+ kcal was logged after 9 pm/)
  // "Copy the day before" at 10 pm (several meals in one go) isn't late eating.
  const copied = entries.map((e) => (e.meal === 'snack' ? { ...e, meal: 'lunch', created_at: at(e.log_date, 13) } : e))
  for (let k = 1; k <= 5; k++) copied.push(...fullDay(day(k)).map((e, i) => ({ ...e, id: `c${k}${i}`, created_at: new Date(Date.parse(at(day(k), 22)) + i).toISOString() })))
  assert.doesNotMatch(mealPattern(ctx({ entries: copied }))?.text || '', /after 9 pm/)
})

test('top foods: the few foods behind most calories, and the one lowest in protein', () => {
  const entries = []
  for (let k = 0; k < 10; k++) {
    entries.push(food(day(k), 'lunch', 'Rice and peas', 600, { protein_g: 12 }), food(day(k), 'dinner', 'Jerk chicken', 500, { protein_g: 40 }))
    entries.push(food(day(k), 'breakfast', `Different breakfast ${k}`, 300))
  }
  const f = topFoods(ctx({ entries }))
  assert.match(f.text, /Rice and peas 43% \(10 times, 2\.0 g protein per 100 kcal\); Jerk chicken 36%/)
  assert.match(f.text, /Lowest in protein for its calories: Rice and peas/)
  assert.equal(topFoods(ctx({ entries: entries.slice(0, 15) })), null) // too few days
})

test('steps and recent health from Apple Health', () => {
  const dailyLogs = [1, 2, 3, 4, 5].map((k) => ({ log_date: day(k), steps: 3000 + k * 100, sleep_min: 400 }))
  assert.match(lowSteps(ctx({ dailyLogs })).text, /Steps averaged 3,300 a day over 5 recent days/)
  assert.equal(lowSteps(ctx({ dailyLogs: dailyLogs.map((l) => ({ ...l, steps: 8000 })) })), null)
  assert.deepEqual(recentHealth({ today: TODAY, dailyLogs: [...dailyLogs, { log_date: TODAY, sleep_min: 390 }] }), { sleep_avg_hours: 6.6, sleep_last_night_hours: 6.5, steps_avg: 3300, days: 6 })
  assert.equal(recentHealth({ today: TODAY, dailyLogs: [{ log_date: day(20), steps: 100 }] }), null)
})

test('computeFindings: most useful first, nothing from an empty log', () => {
  assert.deepEqual(computeFindings({ today: TODAY }), [])
  const entries = [...[1, 2, 3, 4, 5].map((i) => fullDay(day(i))).flat(), ...[6, 7, 8, 9].map((i) => food(day(i), 'lunch', 'Patty', 450))]
  const weights = [{ log_date: day(1), weight_kg: 80 }, { log_date: TODAY, weight_kg: 81 }]
  const list = computeFindings({ today: TODAY, entries, weights, series: trendSeries(weights), targets: { calories: 1700, tdee: 2000 } })
  assert.deepEqual(list.map((f) => f.id).slice(0, 2), ['scale-jump', 'light-days'])
  assert.ok(list.every((f, i) => i === 0 || list[i - 1].score >= f.score))
})
