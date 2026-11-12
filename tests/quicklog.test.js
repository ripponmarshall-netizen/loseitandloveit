import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuickLog } from '../src/lib/quicklog.js'

test('water phrases', () => {
  assert.deepEqual(parseQuickLog('water'), { type: 'water', ml: 250 })
  assert.deepEqual(parseQuickLog('500ml water'), { type: 'water', ml: 500 })
  assert.deepEqual(parseQuickLog('2 cups of water'), { type: 'water', ml: 500 })
  assert.deepEqual(parseQuickLog('1.5 L water'), { type: 'water', ml: 1500 })
  assert.deepEqual(parseQuickLog('a bottle of water'), { type: 'water', ml: 500 })
  assert.deepEqual(parseQuickLog('water 750'), { type: 'water', ml: 750 })
  assert.equal(parseQuickLog('coconut water').type, 'food')
})

test('weight, mood, dose, exercise', () => {
  assert.deepEqual(parseQuickLog('weighed 212.4 lb'), { type: 'weight', value: 212.4, unit: 'lb' })
  assert.deepEqual(parseQuickLog('96 kg'), { type: 'weight', value: 96, unit: 'kg' })
  assert.deepEqual(parseQuickLog('feeling great'), { type: 'mood', mood: 5 })
  assert.deepEqual(parseQuickLog('Mounjaro 5 mg'), { type: 'dose', med: 'mounjaro', dose: 5 })
  assert.deepEqual(parseQuickLog('took my jab'), { type: 'dose', med: null, dose: null })
  assert.deepEqual(parseQuickLog('30 min walk'), { type: 'exercise', minutes: 30, kind: 'treadmill', mode: 'walk' })
  assert.deepEqual(parseQuickLog('1 hr gym'), { type: 'exercise', minutes: 60, kind: 'home', activity: 'weights' })
})

test('everything else is food; drinks are flagged', () => {
  assert.deepEqual(parseQuickLog('beef patty'), { type: 'food', query: 'beef patty', drink: false })
  assert.equal(parseQuickLog('sorrel').drink, true)
  assert.equal(parseQuickLog('protein shake after gym').type, 'food')
  assert.equal(parseQuickLog('  '), null)
})

test('water crackers are food, not water', () => {
  assert.deepEqual(parseQuickLog('water crackers'), { type: 'food', query: 'water crackers', drink: false })
  assert.equal(parseQuickLog('2 water crackers and cheese').type, 'food')
  assert.equal(parseQuickLog('Excelsior water crackers').type, 'food')
  // plain water still works
  assert.deepEqual(parseQuickLog('2 glasses water'), { type: 'water', ml: 500 })
  assert.equal(parseQuickLog('water').type, 'water')
})

test('any Apple workout type is recognised when it has a duration or stands alone', () => {
  assert.deepEqual(parseQuickLog('45 min cycling'), { type: 'exercise', minutes: 45, kind: 'other', typeKey: 'Cycling', name: 'Cycle' })
  assert.deepEqual(parseQuickLog('1 hr cricket'), { type: 'exercise', minutes: 60, kind: 'other', typeKey: 'Cricket', name: 'Cricket' })
  assert.equal(parseQuickLog('30 mins table tennis').typeKey, 'TableTennis') // not plain Tennis
  assert.equal(parseQuickLog('pilates').typeKey, 'Pilates')
  assert.equal(parseQuickLog('20 min pool swim').typeKey, 'Swimming')
  // Existing at-home and treadmill words keep their forms.
  assert.equal(parseQuickLog('20 min yoga').kind, 'home')
  assert.equal(parseQuickLog('30 min walk').kind, 'treadmill')
  // Foods are never sport.
  assert.equal(parseQuickLog('golf ball cake').type, 'food')
  assert.equal(parseQuickLog('curling iron').type, 'food')
})
