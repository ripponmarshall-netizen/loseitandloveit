import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRefs, dbItemToFood, gramsToServings, isBarcode, rankFoods, words } from '../src/lib/foodSearch.js'
import { convertUnits, fromForm, snapPace, toForm, validateProfile } from '../src/lib/profileForm.js'
import { BUILTIN_FOODS } from '../src/data/foods.js'

test('words strips accents and punctuation', () => {
  assert.deepEqual(words('Café-style Rice & Peas!'), ['cafe', 'style', 'rice', 'peas'])
})

test('rankFoods needs every word and puts name-prefix matches first', () => {
  const list = [
    { name: 'Chicken and rice and peas', tags: '' },
    { name: 'Rice and peas', tags: 'jamaican' },
    { name: 'White rice, cooked', tags: 'side' },
  ]
  const out = rankFoods(list, 'rice peas')
  assert.equal(out.length, 2)
  assert.equal(out[0].name, 'Rice and peas')
  assert.equal(rankFoods(list, '').length, 3)
  assert.equal(rankFoods(list, 'jamaican')[0].name, 'Rice and peas')
})

test('dbItemToFood scales per-100 g values to the label serving', () => {
  const f = dbItemToFood({
    id: 'off:1',
    source: 'off',
    name: 'Corned beef',
    brand: 'Grace',
    per100: { calories: 232, protein_g: 25, carbs_g: 1.8, fat_g: 14.3 },
    serving_g: 56,
    serving_text: '2 oz',
  })
  assert.equal(f.name, 'Corned beef (Grace)')
  assert.equal(f.serving, '2 oz (56 g)')
  assert.equal(f.calories, 130) // 232 * 0.56 = 129.9
  assert.equal(f.protein_g, 14)
  assert.equal(f.serving_g, 56)
  // No serving weight: log per 100 g; brand already in the name isn't repeated
  const g = dbItemToFood({ id: 'off:2', source: 'off', name: 'Grace corned beef', brand: 'Grace', per100: { calories: 232, protein_g: 25, carbs_g: 1.8, fat_g: 14.3 } })
  assert.equal(g.name, 'Grace corned beef')
  assert.equal(g.serving, '100 g')
  assert.equal(g.calories, 232)
})

test('grams to servings', () => {
  assert.equal(gramsToServings(150, 100), 1.5)
  assert.equal(gramsToServings('', 100), 0)
  assert.equal(gramsToServings(84, 56), 1.5)
})

test('buildRefs lists the user foods first and marks the source', () => {
  const refs = buildRefs(BUILTIN_FOODS, [{ name: 'My porridge', calories: '310.5', protein_g: '9' }])
  assert.equal(refs[0].src, 'mine')
  assert.equal(refs[0].calories, 311)
  assert.equal(refs[0].protein_g, 9)
  assert.equal(refs.length, BUILTIN_FOODS.length + 1)
  assert.ok(refs.slice(1).every((r) => r.src === 'jamaican'))
})

test('built-in foods are sane', () => {
  const ids = new Set()
  for (const f of BUILTIN_FOODS) {
    assert.ok(!ids.has(f.id), `duplicate ${f.name}`)
    ids.add(f.id)
    // Atwater check: macros should roughly add up to the calories (alcohol and fibre aside)
    const kcal = f.protein_g * 4 + f.carbs_g * 4 + f.fat_g * 9
    assert.ok(Math.abs(kcal - f.calories) <= Math.max(40, f.calories * 0.2), `${f.name}: ${kcal} vs ${f.calories}`)
  }
})

test('barcode detection', () => {
  assert.ok(isBarcode('0737628064502'))
  assert.ok(isBarcode('7376 2806 4502'))
  assert.ok(!isBarcode('1234567'))
  assert.ok(!isBarcode('ackee'))
})

test('profile form round-trips in both unit systems', () => {
  const p = { units: 'imperial', sex: 'male', birth_year: 1990, height_cm: 177.8, start_weight_kg: 100, goal_weight_kg: 85, activity_level: 'moderate', weekly_rate_kg: 0.45, day_start_hour: 4 }
  const f = toForm(p)
  assert.equal(f.ft, '5')
  assert.equal(f.inch, '10')
  assert.equal(f.start_weight, '220.5')
  const back = fromForm(f)
  assert.equal(back.height_cm, 177.8)
  assert.equal(back.start_weight_kg, 100)
  const metric = convertUnits(f, 'metric')
  assert.equal(metric.start_weight, '100')
  assert.equal(metric.height_cm, '177.8')
  assert.equal(snapPace(0.45, 'imperial'), 0.45)
  assert.equal(snapPace(0.45, 'metric'), 0.5)
})

test('profile validation gives friendly messages', () => {
  const ok = { birth_year: 1990, height_cm: 178, start_weight_kg: 100, goal_weight_kg: 85, calorie_target_override: null, protein_target_override: null }
  assert.equal(validateProfile(ok, undefined, 2026), null)
  assert.match(validateProfile({ ...ok, birth_year: 2015 }, undefined, 2026), /adults/)
  assert.match(validateProfile({ ...ok, birth_year: 1850 }, undefined, 2026), /birth year/)
  assert.match(validateProfile({ ...ok, height_cm: 60 }, undefined, 2026), /Height/)
  assert.match(validateProfile({ ...ok, calorie_target_override: 500 }, undefined, 2026), /800/)
  // Step-by-step: only the requested group is checked
  assert.equal(validateProfile({ ...ok, goal_weight_kg: null }, ['about', 'body'], 2026), null)
})
