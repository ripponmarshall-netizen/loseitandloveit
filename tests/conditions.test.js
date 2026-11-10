import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONDITIONS, cleanConditions, computeTargets, inputToKg, isValidWeightKg, milestones, PCOS_MAX_DEFICIT } from '../src/lib/calc.js'
import { exactProfile, exactWeightKg, fromForm, toForm } from '../src/lib/profileForm.js'

const year = new Date().getFullYear()
const man = { sex: 'male', birth_year: year - 35, height_cm: 178, start_weight_kg: 100, goal_weight_kg: 85, activity_level: 'moderate', weekly_rate_kg: 0.5 }
const woman = { sex: 'female', birth_year: year - 32, height_cm: 165, start_weight_kg: 140, goal_weight_kg: 82, activity_level: 'light', weekly_rate_kg: 0.91 }

test('no conditions: targets are unchanged', () => {
  const a = computeTargets(woman, 140)
  const b = computeTargets({ ...woman, conditions: [] }, 140)
  assert.deepEqual(a, b)
  assert.equal(a.split, 'standard')
  assert.ok(a.plannedDeficit > 900, `deficit ${a.plannedDeficit}`)
})

test('PCOS caps the deficit at 750 kcal/day and uses a carb-conscious split', () => {
  const t = computeTargets({ ...woman, conditions: ['pcos'] }, 140)
  assert.equal(t.plannedDeficit, PCOS_MAX_DEFICIT)
  assert.ok(Math.abs(t.deficit - PCOS_MAX_DEFICIT) <= 5, `deficit ${t.deficit}`)
  assert.ok(t.plannedWeeklyLossKg < 0.91 && t.plannedWeeklyLossKg > 0.65, `rate ${t.plannedWeeklyLossKg}`)
  assert.equal(t.split, 'carb-conscious')
  assert.ok(t.warnings.some((w) => w.startsWith('PCOS')))
  assert.ok(t.notes.length >= 2)
  assert.ok(t.carbs * 4 <= t.calories * 0.4 + 4, `carbs ${t.carbs}`)
  assert.ok(t.fat * 9 <= t.calories * 0.35 + 9, `fat ${t.fat}`)
  const kcal = t.protein * 4 + t.carbs * 4 + t.fat * 9
  assert.ok(Math.abs(kcal - t.calories) < 20, `macros ${kcal} vs ${t.calories}`)
})

test('PCOS never pushes the target below the calorie floor', () => {
  const t = computeTargets({ ...woman, height_cm: 150, start_weight_kg: 62, goal_weight_kg: 55, activity_level: 'sedentary', conditions: ['pcos'] }, 62)
  assert.ok(t.calories >= 1200)
})

test('conditions are cleaned: unknown keys dropped, PCOS ignored for men', () => {
  assert.deepEqual(cleanConditions(['pcos', 'nope', 'pcos'], 'female'), ['pcos'])
  assert.deepEqual(cleanConditions(['pcos', 'hypertension'], 'male'), ['hypertension'])
  assert.deepEqual(cleanConditions(null, 'female'), [])
  assert.equal(computeTargets({ ...man, conditions: ['pcos'] }, 100).split, 'standard')
  assert.ok(Object.keys(CONDITIONS).includes('type2_diabetes'))
  const t2 = computeTargets({ ...man, conditions: ['type2_diabetes'] }, 100)
  assert.equal(t2.split, 'carb-conscious')
  assert.ok(t2.warnings.some((w) => w.startsWith('Diabetes')))
})

test('profile form round-trips conditions and drops PCOS when sex is male', () => {
  const f = toForm({ ...woman, conditions: ['pcos', 'hypertension'] })
  assert.deepEqual(f.conditions, ['pcos', 'hypertension'])
  assert.deepEqual(fromForm(f).conditions, ['pcos', 'hypertension'])
  assert.deepEqual(fromForm({ ...f, sex: 'male' }).conditions, ['hypertension'])
  assert.deepEqual(toForm({}).conditions, [])
})

test('5% and 10% milestones', () => {
  const [m5, m10] = milestones(140, 133)
  assert.ok(Math.abs(m5.targetKg - 133) < 1e-9)
  assert.equal(m5.reached, true)
  assert.equal(m10.reached, false)
  assert.ok(Math.abs(m10.progress - 0.5) < 1e-9)
  assert.deepEqual(milestones(null, 100), [])
  assert.equal(milestones(140, 150)[0].progress, 0)
})

test('weight validation', () => {
  assert.ok(Math.abs(inputToKg('220,46', 'imperial') - 100) < 0.01)
  assert.ok(isValidWeightKg(140.6))
  assert.ok(!isValidWeightKg(20))
  assert.ok(!isValidWeightKg(NaN))
})

test('a goal typed in pounds reads back as the pounds that were typed', () => {
  for (const lb of [120, 150, 165.5, 180, 199, 230, 250.5]) {
    const stored = fromForm({ ...toForm({ units: 'imperial' }), goal_weight: String(lb), start_weight: '260' }).goal_weight_kg
    const p = exactProfile({ units: 'imperial', goal_weight_kg: stored, start_weight_kg: 117.9 })
    assert.ok(Math.abs(p.goal_weight_kg * 2.2046226218 - lb) < 1e-6, `${lb} lb`)
    assert.equal(toForm(p).goal_weight, String(lb))
  }
  assert.equal(toForm(exactProfile({ units: 'imperial', start_weight_kg: 117.9 })).start_weight, '260')
})

test('exactWeightKg leaves metric and already precise values alone', () => {
  assert.equal(exactWeightKg(81.6, 'metric'), 81.6)
  assert.equal(exactWeightKg(81.647, 'imperial'), 81.647)
  assert.equal(exactWeightKg(82, 'imperial'), 82) // 180.8 lb: not a whole or half pound
  assert.equal(exactWeightKg(null, 'imperial'), null)
  assert.equal(exactProfile(null), null)
  assert.equal(fromForm({ ...toForm({ units: 'metric' }), goal_weight: '80,5' }).goal_weight_kg, 80.5)
})
