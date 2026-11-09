import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuickLog, suggestLogActions } from '../src/lib/quicklog.js'

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

test('suggestions follow the clock and what is due', () => {
  const morning = suggestLogActions({ hour: 7, onGlp1: false, weighed: false, moodLogged: false })
  assert.equal(morning[0].id, 'weight')
  const doseDay = suggestLogActions({ hour: 12, onGlp1: true, dose: { state: 'due', label: 'Due today' }, weighed: true })
  assert.equal(doseDay[0].id, 'dose')
  const evening = suggestLogActions({ hour: 20, onGlp1: false, weighed: true, moodLogged: false, mealsLogged: { dinner: true } })
  assert.equal(evening[0].id, 'mood')
  const lunch = suggestLogActions({ hour: 12.5, onGlp1: false, weighed: true, moodLogged: true, waterMl: 2000 })
  assert.equal(lunch[0].id, 'meal')
  assert.equal(lunch[0].reason, 'Log lunch')
})

test('water crackers are food, not water', () => {
  assert.deepEqual(parseQuickLog('water crackers'), { type: 'food', query: 'water crackers', drink: false })
  assert.equal(parseQuickLog('2 water crackers and cheese').type, 'food')
  assert.equal(parseQuickLog('Excelsior water crackers').type, 'food')
  // plain water still works
  assert.deepEqual(parseQuickLog('2 glasses water'), { type: 'water', ml: 500 })
  assert.equal(parseQuickLog('water').type, 'water')
})
